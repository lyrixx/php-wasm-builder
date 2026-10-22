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
#   libiconv
#   openssl
#   sqlite
#   php         configures and compiles PHP
#   link        compiles run.c, and links the .mjs/.wasm files with api.js
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

flags=""
libiconv=0
libxml2=0
oniguruma=0
icu=0
openssl=0
pdo=0
sqlite=0
# Sorted, so that the same extensions always give the same ./configure flags.
# Keep in sync with Stack::EXTENSIONS, in src/Stack.php
for extension in $(printf '%s\n' $EXTENSIONS | sort -u); do
    case $extension in
        bcmath|calendar|ctype|fileinfo|filter|session|tokenizer) flags="$flags --enable-$extension" ;;
        dom|simplexml|xml|xmlreader|xmlwriter)                   flags="$flags --enable-$extension"; libxml2=1 ;;
        iconv)                                                   flags="$flags --with-iconv=/local/install"; libiconv=1 ;;
        libxml)                                                  libxml2=1 ;;
        mbstring)                                                flags="$flags --enable-mbstring"; oniguruma=1 ;;
        intl)                                                    flags="$flags --enable-intl"; icu=1 ;;
        openssl)                                                 flags="$flags --with-openssl"; openssl=1 ;;
        pdo)                                                     pdo=1 ;;
        pdo_sqlite)                                              flags="$flags --with-pdo-sqlite"; pdo=1; sqlite=1 ;;
        sqlite3)                                                 flags="$flags --with-sqlite3"; sqlite=1 ;;
        *) echo "Unknown extension '$extension'" >&2; exit 1 ;;
    esac
done

link=""
# The PDO drivers need PDO
if [ $pdo = 1 ]; then
    flags=" --enable-pdo$flags"
fi
if [ $libxml2 = 1 ]; then
    flags="--with-libxml$flags"
    link="$link /local/install/lib/libxml2.a"
fi
if [ $oniguruma = 1 ]; then
    link="$link /local/install/lib/libonig.a"
fi
if [ $libiconv = 1 ]; then
    link="$link /local/install/lib/libiconv.a"
fi
if [ $openssl = 1 ]; then
    # libssl needs libcrypto: it comes first. The configuration of OpenSSL is
    # where it looks for it: keep in sync with the openssl stage.
    link="$link /local/install/lib/libssl.a /local/install/lib/libcrypto.a --embed-file /local/install/ssl/openssl.cnf@/etc/ssl/openssl.cnf"
fi
if [ $sqlite = 1 ]; then
    link="$link /local/install/lib/libsqlite3.a"
fi
if [ $icu = 1 ]; then
    # The icu stage builds both: libicudata.a is the empty stub that ICU
    # installs. Keep in sync with Stack::ICU_DATA, in src/Stack.php
    case $ICU_DATA in
        all)  icudata=libicudata-all.a ;;
        none) icudata=libicudata.a ;;
        *) echo "Unknown ICU data '$ICU_DATA', supported values: all none" >&2; exit 1 ;;
    esac
    # ICU and intl are C++: DEFAULT_TO_CXX links the C++ standard library,
    # as em++ would
    link="$link /local/install/lib/libicui18n.a /local/install/lib/libicuio.a /local/install/lib/libicuuc.a /local/install/lib/$icudata -sDEFAULT_TO_CXX"
fi

# <output file name> <emscripten environment> [<libraries>], by target. IDBFS
# keeps files in IndexedDB, across the reloads of a page (the persist option of
# createPhp()). Keep in sync with Stack::TARGETS, in src/Stack.php
: > /plan/targets
for target in $TARGETS; do
    case $target in
        web)  echo "php-web web -lidbfs.js" >> /plan/targets ;;
        node) echo "php-node node" >> /plan/targets ;;
        *)    echo "Unknown target '$target', supported targets: web node" >&2; exit 1 ;;
    esac
done

echo "$flags" > /plan/configure
echo "$link" > /plan/link
echo "$libiconv" > /plan/libiconv
echo "$libxml2" > /plan/libxml2
echo "$oniguruma" > /plan/oniguruma
echo "$icu" > /plan/icu
echo "$openssl" > /plan/openssl
echo "$sqlite" > /plan/sqlite

echo "./configure:$flags"
echo "link:$link"
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
ARG PHP_VERSION=8.5.12
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

# Compile GNU libiconv, for iconv: the iconv of the C library of emscripten
# (musl) does not know //TRANSLIT nor //IGNORE
FROM base AS libiconv
ARG LIBICONV_VERSION=1.19
COPY --from=resolve /plan/libiconv /plan/libiconv
RUN <<EOF
set -eu
[ "$(cat /plan/libiconv)" = 1 ] || exit 0
curl -fsSL --retry 3 --connect-timeout 30 -o libiconv.tgz \
    https://ftp.gnu.org/pub/gnu/libiconv/libiconv-$LIBICONV_VERSION.tar.gz
tar -xzf libiconv.tgz
cd libiconv-$LIBICONV_VERSION
emconfigure ./configure --prefix=/local/install --enable-static --disable-shared --disable-nls
emmake make -j`nproc`
emmake make install
EOF

# Compile OpenSSL, for openssl
FROM base AS openssl
ARG OPENSSL_VERSION=3.5.9
COPY --from=resolve /plan/openssl /plan/openssl
RUN <<EOF
set -eu
[ "$(cat /plan/openssl)" = 1 ] || exit 0
curl -fsSL --retry 3 --connect-timeout 30 -o openssl.tgz \
    https://github.com/openssl/openssl/releases/download/openssl-$OPENSSL_VERSION/openssl-$OPENSSL_VERSION.tar.gz
tar -xzf openssl.tgz
cd openssl-$OPENSSL_VERSION
# The generic 32-bit target, without assembly: WASM is neither x86 nor ARM. No
# threads, and nothing to load: there is no dlopen() in a static build. Not
# with emconfigure: OpenSSL would prefix emcc with the CROSS_COMPILE it sets.
# Its configuration is in /etc/ssl, in the WASM filesystem: keep in sync with
# the "resolve" stage.
./Configure linux-generic32 CC=emcc AR=emar RANLIB=emranlib \
    --prefix=/local/install --libdir=lib --openssldir=/etc/ssl \
    no-asm no-threads no-shared no-dso no-module no-engine no-afalgeng no-tests
# Only the libraries, with their headers and pkg-config files
make -j`nproc` build_libs
make install_dev
# The configuration that the distributions install: openssl_pkey_new() and
# openssl_csr_new() take their defaults from it
mkdir -p /local/install/ssl
cp apps/openssl.cnf /local/install/ssl/
EOF

# Compile SQLite, for sqlite3 and pdo_sqlite
FROM base AS sqlite
ARG SQLITE_VERSION=3.54.1
# The year of the release, that is in its URL
ARG SQLITE_YEAR=2026
COPY --from=resolve /plan/sqlite /plan/sqlite
RUN <<EOF
set -eu
[ "$(cat /plan/sqlite)" = 1 ] || exit 0
# 3.54.1 is 3540100 in the name of the file
release=$(printf '%d%02d%02d00' $(echo $SQLITE_VERSION | tr . ' '))
curl -fsSL --retry 3 --connect-timeout 30 -o sqlite.zip \
    https://www.sqlite.org/$SQLITE_YEAR/sqlite-amalgamation-$release.zip
unzip -q sqlite.zip
cd sqlite-amalgamation-$release
# No threads, and no extension to load: there is no dlopen() in a static build.
# FTS5 (full-text search) and the math functions, as the SQLite of the
# distributions has them.
emcc -O2 -DSQLITE_THREADSAFE=0 -DSQLITE_OMIT_LOAD_EXTENSION \
    -DSQLITE_ENABLE_FTS5 -DSQLITE_ENABLE_MATH_FUNCTIONS \
    -c sqlite3.c -o sqlite3.o
mkdir -p /local/install/include /local/install/lib
emar rcs /local/install/lib/libsqlite3.a sqlite3.o
cp sqlite3.h sqlite3ext.h /local/install/include/
EOF

# Configure and compile PHP
FROM php-src AS php
COPY --from=oniguruma /local/install /local/install
COPY --from=libxml2 /local/install /local/install
COPY --from=icu /local/install /local/install
COPY --from=libiconv /local/install /local/install
COPY --from=openssl /local/install /local/install
COPY --from=sqlite /local/install /local/install
COPY --from=resolve /plan/configure /plan/configure

ENV ONIG_LIBS="-L/local/install"
ENV ONIG_CFLAGS="-I/local/install/include"
ENV LIBXML_LIBS="-L/local/install"
ENV LIBXML_CFLAGS="-I/local/install/include/libxml2"
# What pkg-config would give, SQLite is not installed with its .pc file
ENV SQLITE_CFLAGS="-I/local/install/include"
ENV SQLITE_LIBS="-L/local/install/lib -lsqlite3"
# intl finds ICU, and its version, with pkg-config, and openssl finds OpenSSL
ENV EM_PKG_CONFIG_PATH=/local/install/lib/pkgconfig

RUN cd php-src && \
    emconfigure ./configure --host=$(emcc -dumpmachine) --enable-embed=static \
    --disable-all --without-pcre-jit --disable-fiber-asm --disable-cgi --disable-cli --disable-phpdbg \
    $(cat /plan/configure)

RUN \
    cd php-src && \
    emmake make -j`nproc`

# The directory to embed in the WASM filesystem is the named build context
# "embed" (empty unless given, see docker-bake.hcl), it shows up at $EMBED_AT
FROM scratch AS embed

# Compile run.c, and link everything
FROM php AS link
ARG EMBED_AT=/examples
ARG MEMORY=128mb

COPY run.c api.js /local/src/
RUN \
    emcc -O2 -I php-src/. -I php-src/Zend -I php-src/main -I php-src/TSRM -c run.c -o run.o

COPY --from=embed / /embed
COPY --from=resolve /plan/link /plan/link
COPY --from=resolve /plan/targets /plan/targets

# The functions of run.c and what api.js needs are exported from the .wasm
# file. createPhp() is what the .mjs file exports.
RUN <<EOF
set -eu
mkdir -p /build /embed
while read -r output environment libraries; do
    emcc -o /build/$output.mjs \
    -O2 \
    -s EXPORTED_FUNCTIONS=_free,_malloc,_run_code,_run_file \
    -s EXPORTED_RUNTIME_METHODS=FS \
    --pre-js api.js \
    $libraries \
    -s ENVIRONMENT=$environment \
    -s INITIAL_MEMORY=$MEMORY -s ALLOW_MEMORY_GROWTH=0 \
    -s ASSERTIONS=0 -s ERROR_ON_UNDEFINED_SYMBOLS=0 -s MODULARIZE=1 -s INVOKE_RUN=0 -s LZ4=1 -s EXPORT_ES6=1 \
    -s EXPORT_NAME=createPhp \
    ${EMBED_AT:+--embed-file "/embed@$EMBED_AT"} \
    run.o php-src/.libs/libphp.a \
    $(cat /plan/link) \
    php-src/.libs/libphp.a < /dev/null
done < /plan/targets
EOF

# Save file
FROM scratch
COPY --from=link /build/ .
