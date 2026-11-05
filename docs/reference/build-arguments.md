# Build arguments

The Dockerfile builds what its build arguments say. They are given to `docker buildx bake` with
`--set`, or in a [bake file](../your-project/build.md), and castor gives them from a
[stack](../repository/stacks.md):

```
docker buildx bake --set default.args.PHP_VERSION=8.4.26                    # another PHP version
docker buildx bake --set default.args.EXTENSIONS="ctype tokenizer bcmath"   # other extensions
docker buildx bake --set default.args.TARGETS=node                          # only php-node.mjs and php-node.wasm
```

## What to build

| Argument      | Default                                                    | What it is                                                                                                                                                                                                                  |
|---------------|------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `PHP_VERSION` | `8.5.12`                                                   | The PHP version to build.                                                                                                                                                                                                   |
| `EXTENSIONS`  | `calendar ctype dom mbstring simplexml xml xmlreader xmlwriter` | The extensions to build, separated by spaces (see [Supported extensions](extensions.md)). The libraries that they need (oniguruma for `mbstring`, libxml2 for the xml ones) are only built when an extension asks for them. |
| `TARGETS`     | `web node`                                                 | The files to build: `web` for `php-web.mjs` and `php-web.wasm`, `node` for `php-node.mjs` and `php-node.wasm`.                                                                                                              |
| `MEMORY`      | `128mb`                                                    | The memory of the WASM module, initial and maximum.                                                                                                                                                                         |
| `ICU_DATA`    | `all`                                                      | The data of ICU that intl links: `all` or `none` (see [intl](extensions.md#intl)).                                                                                                                                          |
| `OPCACHE`     | `none`                                                     | When opcache compiles the PHP files, with PHP 8.5 and later: `none`, `runtime` or `precompiled` (see [opcache](opcache.md)).                                                                                               |

## What to embed

| Argument   | Default | What it is                                                                                                                                                                                                                       |
|------------|---------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `EMBED_AT` | empty   | Where the embedded directory is in the WASM filesystem, `/app` for example. Nothing is embedded without it.                                                                                                                      |
| `WARMUP`   | empty   | A PHP file of the embedded directory, relative to it, and its arguments, separated by spaces: it runs when PHP is built, and what it writes in the directory is embedded too. For a cache that a framework makes with the paths of the WASM filesystem: `bin/console cache:warmup`. |

The directory to embed is the `embed` named build context:

```
docker buildx bake --set default.contexts.embed=./my-app --set default.args.EMBED_AT=/app
```

## The libraries

They are pinned, so that the same arguments always give the same build. The defaults are in
`docker/Dockerfile`.

| Argument                | What it is                                                                                                                          |
|-------------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| `EMSDK_VERSION`         | The version of the Emscripten SDK that compiles everything, a tag of the [emscripten/emsdk](https://hub.docker.com/r/emscripten/emsdk) image. |
| `ICU_VERSION`           | ICU, that intl uses, for example `78.3`.                                                                                            |
| `LIBICONV_VERSION`      | GNU libiconv, that iconv uses, for example `1.19`.                                                                                  |
| `LIBJPEG_TURBO_VERSION` | libjpeg-turbo, that gd uses, for example `3.2.1`.                                                                                   |
| `LIBPNG_VERSION`        | libpng, that gd uses, for example `1.6.59`.                                                                                         |
| `LIBWEBP_VERSION`       | libwebp, that gd uses, for example `1.6.0`.                                                                                         |
| `LIBXML_VERSION`        | libxml2, that the xml extensions use.                                                                                               |
| `ONIGURUMA_VERSION`     | Oniguruma, that mbstring uses for regular expressions.                                                                              |
| `OPENSSL_VERSION`       | OpenSSL, that openssl uses, for example `3.5.9`.                                                                                    |
| `SQLITE_VERSION`        | SQLite, that pdo_sqlite and sqlite3 use, for example `3.54.1`.                                                                      |
| `SQLITE_YEAR`           | The year of the release of `SQLITE_VERSION`, that is in its URL: for example `2026`.                                                |
| `ZLIB_VERSION`          | zlib, that libpng uses, for example `1.3.2`.                                                                                        |
