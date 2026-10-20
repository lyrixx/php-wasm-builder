# Builds PHP as WebAssembly (see README.rst for the build arguments).
#
# Stages:
#
#   resolve     turns EXTENSIONS and TARGETS into a build plan (/plan). This is
#               where the extension -> ./configure flags / libraries map lives.
#   base        the toolchain: the emscripten SDK image, and build tools
#   php-src     PHP's sources, only depends on PHP_VERSION
#   oniguruma   third-party libraries, each one only built when the plan says
#   libxml2     an extension needs it (the others do nothing and stay tiny)
#   icu
#   php         configures and compiles PHP
#   link        compiles the shim and links the .mjs/.wasm files
#
# Every stage only reads the parts of the plan it needs, and the plan is made
# of small files: changing EXTENSIONS, TARGETS, ... only rebuilds what actually
# depends on what changed.

ARG EMSDK_VERSION=6.0.13

# The same image as base: one image less to pull
FROM emscripten/emsdk:$EMSDK_VERSION AS resolve
# Keep in sync with the default stack, in stacks.php
ARG EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter"
ARG TARGETS="web node"
ARG ICU_DATA=all
COPY <<'EOF' /resolve.sh
set -eu
mkdir -p /plan

EXTENSIONS=$(echo "$EXTENSIONS" | tr ',\n' '  ')
TARGETS=$(echo "$TARGETS" | tr ',\n' '  ')

flags=""
libs=""
known=""

has() {
    case " $1 " in *" $2 "*) return 0 ;; esac
    return 1
}

# ext <name> <library or -> [<./configure flag>]
#
# The order of the lines is the order of the flags on the ./configure command
# line, which phpinfo() shows: it is kept as it always was, so that the default
# extensions still give the exact same command line.
ext() {
    known="$known $1"
    has "$EXTENSIONS" "$1" || return 0
    if [ "$2" != "-" ] && ! has "$libs" "$2"; then
        libs="$libs $2"
    fi
    if [ -n "${3:-}" ]; then
        flags="$flags $3"
    fi
}

ext libxml    libxml2
ext simplexml libxml2 --enable-simplexml
ext xml       libxml2 --enable-xml
ext xmlreader libxml2 --enable-xmlreader
ext xmlwriter libxml2 --enable-xmlwriter
ext dom       libxml2 --enable-dom
ext mbstring  oniguruma --enable-mbstring
ext calendar  - --enable-calendar
ext ctype     - --enable-ctype
ext bcmath    - --enable-bcmath
ext filter    - --enable-filter
ext tokenizer - --enable-tokenizer
ext intl      icu --enable-intl

for extension in $EXTENSIONS; do
    has "$known" "$extension" || { echo "Unknown extension '$extension', supported extensions:$known" >&2; exit 1; }
done

# Keep in sync with Build::ICU_DATA, in src/Build.php
case $ICU_DATA in
    all|none) ;;
    *) echo "Unknown ICU data '$ICU_DATA', supported values: all none" >&2; exit 1 ;;
esac

link=""
libxml2=0
oniguruma=0
icu=0
if has "$libs" libxml2; then
    libxml2=1
    flags="--with-libxml$flags"
    link="$link /local/install/lib/libxml2.a"
fi
if has "$libs" oniguruma; then
    oniguruma=1
    link="$link /local/install/lib/libonig.a"
fi
if has "$libs" icu; then
    icu=1
    # The icu stage builds both, only the link depends on ICU_DATA: libicudata.a
    # is the empty stub that ICU installs
    icudata=/local/install/lib/libicudata.a
    if [ "$ICU_DATA" = all ]; then
        icudata=/local/install/lib/libicudata-all.a
    fi
    # ICU and intl are C++: DEFAULT_TO_CXX links the C++ standard library,
    # as em++ would
    link="$link /local/install/lib/libicui18n.a /local/install/lib/libicuio.a /local/install/lib/libicuuc.a $icudata -sDEFAULT_TO_CXX"
fi

# targets: <output file name> <emscripten environment>
: > /plan/targets
for target in $TARGETS; do
    case $target in
        web)  echo "php-web web" >> /plan/targets ;;
        node) echo "php-cli node" >> /plan/targets ;;
        *)    echo "Unknown target '$target', supported targets: web node" >&2; exit 1 ;;
    esac
done

echo "$flags" > /plan/configure
echo "$link" > /plan/link
echo "$libxml2" > /plan/libxml2
echo "$oniguruma" > /plan/oniguruma
echo "$icu" > /plan/icu

echo "./configure:$flags"
echo "libraries:$libs"
echo "targets: $TARGETS"
EOF
RUN sh /resolve.sh

FROM emscripten/emsdk:$EMSDK_VERSION AS base
WORKDIR /local/src

# What the emscripten SDK image does not have: the autotools, to build the
# libraries and PHP from git, and pkg-config, for intl to find ICU
RUN apt-get update && \
    apt-get --no-install-recommends -y install \
    autoconf \
    automake \
    bison \
    flex \
    libtool \
    pkg-config \
    re2c

# Create install directory
RUN mkdir -p /local/install

# Download PHP and Set-Up Configure
FROM base AS php-src
# Keep in sync with the default stack, in stacks.php
ARG PHP_VERSION=8.5.11
RUN \
    git clone https://github.com/php/php-src.git php-src --branch php-$PHP_VERSION --single-branch --depth 1 && \
    cd php-src && \
    ./buildconf --force

# Compile mbstring regex library
FROM base AS oniguruma
ARG ONIGURUMA_VERSION=6.9.10
COPY --from=resolve /plan/oniguruma /plan/oniguruma
RUN <<EOF
set -eu
[ "$(cat /plan/oniguruma)" = 1 ] || exit 0
git clone https://github.com/kkos/oniguruma --branch v$ONIGURUMA_VERSION --single-branch --depth 1
cd oniguruma
autoreconf -vfi
emconfigure ./configure --prefix=/local/install --disable-shared
emmake make
emmake make install
EOF

# Compile libxml and related extensions
FROM base AS libxml2
ARG LIBXML_VERSION=2.13.5
COPY --from=resolve /plan/libxml2 /plan/libxml2
RUN <<EOF
set -eu
[ "$(cat /plan/libxml2)" = 1 ] || exit 0
git clone https://gitlab.gnome.org/GNOME/libxml2.git libxml2 --branch v$LIBXML_VERSION --single-branch --depth 1
cd libxml2
emconfigure ./autogen.sh --prefix=/local/install --enable-static --disable-shared --with-python=no --with-threads=no
emmake make -j`nproc`
emmake make install
EOF

# Compile ICU and its data, for intl
FROM base AS icu
ARG ICU_VERSION=78.3
COPY --from=resolve /plan/icu /plan/icu
RUN <<EOF
set -eu
[ "$(cat /plan/icu)" = 1 ] || exit 0
# The data comes already built with the release sources only, not with git
curl -fsSL --retry 3 --connect-timeout 30 -o icu.tgz \
    https://github.com/unicode-org/icu/releases/download/release-$ICU_VERSION/icu4c-$ICU_VERSION-sources.tgz
tar -xzf icu.tgz
cd icu/source
# -Os: ICU is big, and it is only in the builds that ask for intl
CFLAGS=-Os CXXFLAGS=-Os emconfigure ./configure --prefix=/local/install \
    --enable-static --disable-shared --disable-dyload \
    --disable-extras --disable-samples --disable-tests --disable-tools \
    --with-data-packaging=archive
emmake make -j`nproc`
emmake make install

# ICU finds its data through a single symbol, icudt<major>_dat, of which
# libicudata.a only has an empty stub (the data tools are not built for
# WASM). The sources come with the data, already built: libicudata-all.a has
# it, to link instead of the stub when ICU_DATA is "all", so that the data is
# in the .wasm file, and there is no file to load.
major=${ICU_VERSION%%.*}
test -s data/in/icudt${major}l.dat
cat > icudata.c <<C
#include <stdalign.h>

alignas(16) const unsigned char icudt${major}_dat[] = {
#embed "data/in/icudt${major}l.dat"
};
C
emcc -std=c23 -c icudata.c -o icudata.o
emar rcs /local/install/lib/libicudata-all.a icudata.o
EOF

# Configure and compile PHP
FROM php-src AS php
COPY --from=oniguruma /local/install /local/install
COPY --from=libxml2 /local/install /local/install
COPY --from=icu /local/install /local/install
COPY --from=resolve /plan/configure /plan/configure
COPY --from=resolve /plan/icu /plan/icu

ENV ONIG_LIBS="-L/local/install"
ENV ONIG_CFLAGS="-I/local/install/include"
ENV LIBXML_LIBS="-L/local/install"
ENV LIBXML_CFLAGS="-I/local/install/include/libxml2"

# intl finds ICU, and its version, with pkg-config
RUN cd php-src && \
    if [ "$(cat /plan/icu)" = 1 ]; then export EM_PKG_CONFIG_PATH=/local/install/lib/pkgconfig; fi && \
    emconfigure ./configure --host=$(emcc -dumpmachine) --enable-embed=static \
    --disable-all --without-pcre-jit --disable-fiber-asm --disable-cgi --disable-cli --disable-phpdbg \
    $(cat /plan/configure)

RUN \
    cd php-src && \
    emmake make -j`nproc`

# The directory to embed in the WASM filesystem is the named build context
# "embed" (empty unless given, see docker-bake.hcl), it shows up as /$EMBED_PATH
FROM scratch AS embed

# Compile the WASM shim, and link everything
FROM php AS link
ARG EMBED_PATH=examples
ARG MEMORY=128mb

# Compile WASM shim
COPY phpw.c /local/src/phpw.c
RUN \
    emcc -O2 -I php-src/. -I php-src/Zend -I php-src/main -I php-src/TSRM -c phpw.c -o phpw.o

COPY --from=embed / /local/src/$EMBED_PATH
COPY --from=resolve /plan/link /plan/link
COPY --from=resolve /plan/targets /plan/targets

# Create PHP-WASM
RUN <<EOF
set -eu
mkdir -p /build
[ -z "$EMBED_PATH" ] || mkdir -p "$EMBED_PATH"
while read -r output environment; do
    emcc -o /build/$output.mjs \
    -O2 \
    -s EXPORTED_FUNCTIONS='["_phpw", "_phpw_flush", "_phpw_exec", "_phpw_run", "_chdir", "_setenv", "_php_embed_init", "_php_embed_shutdown", "_zend_eval_string"]' \
    -s EXPORTED_RUNTIME_METHODS='["ccall", "UTF8ToString", "lengthBytesUTF8", "FS"]' \
    -s ENVIRONMENT=$environment \
    -s INITIAL_MEMORY=$MEMORY -s ALLOW_MEMORY_GROWTH=0 \
    -s ASSERTIONS=0 -s ERROR_ON_UNDEFINED_SYMBOLS=0 -s MODULARIZE=1 -s INVOKE_RUN=0 -s LZ4=1 -s EXPORT_ES6=1 \
    -s EXPORT_NAME=createPhpModule \
    ${EMBED_PATH:+--embed-file "$EMBED_PATH"} \
    phpw.o php-src/.libs/libphp.a \
    $(cat /plan/link) \
    php-src/.libs/libphp.a < /dev/null
done < /plan/targets
EOF

# Save file
FROM scratch
COPY --from=link /build/ .
