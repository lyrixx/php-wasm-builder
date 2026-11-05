# Changelog

## Unreleased

### Features

* BC break: PHP allocates with Zend MM, its own allocator, instead of
  `malloc()`: `memory_limit` works, and `memory_get_usage()` too. Going over it,
  or filling the memory of the module, is a fatal error of PHP: the module does
  not abort, and the next run starts with all of its memory.
* BC break: `memory_limit` defaults to 7/8 of what the module has after its data
  and what it embeds, `107M` with the 128 MB by default, instead of `128M`.
* Add the `phar` extension.
* Add the `sodium` extension, with libsodium 1.0.22 (`LIBSODIUM_VERSION`).
* Add the `zip` extension, with libzip 1.12.1 (`LIBZIP_VERSION`), and only
  deflate.
* Add the `zlib` extension.
* Add `serveInFrame()`, in `php-web.mjs`: it shows an application in an
  `<iframe>`, with a service worker.
* Add `php-sw.js`, built for the web next to `php-web.mjs`: the service worker
  of a project imports it, and calls `forwardToPhp()`.
* Add `keepCookies()` and `withCookies()`, in `php-web.mjs`: the cookies of the
  application, for a service worker that runs PHP itself.
* Add `Target::files()` and `Stack::targetArtifacts()`. `artifacts()` lists
  `php-sw.js` too.
* The Symfony example uses them: `public/cookies.mjs` is gone, and the cookies
  of its framed page are under another key: a visitor starts a new session.

### Fixes

* A module does not run out of memory by itself anymore: what a run leaves is
  gone with it. The Symfony example aborted after about 1,900 requests.

### Minor

* Document what PHP can not do with the network, and what the backward
  compatibility covers.

## 0.11.0 (2026-11-05)

### Features

* Add the `gd` extension, with zlib 1.3.2, libpng 1.6.59, libjpeg-turbo 3.2.1
  and libwebp 1.6.0 (`ZLIB_VERSION`, `LIBPNG_VERSION`,
  `LIBJPEG_TURBO_VERSION`, `LIBWEBP_VERSION`).
* Add the `exif` extension.

## 0.10.0 (2026-11-05)

### Features

* BC break: `targets()` takes `Target`s, and `artifact()` a `Target`:
  `->targets(Target::Web)`. `Stack::TARGETS` is gone.
* BC break: `icuData()` takes an `IcuData`: `->icuData(IcuData::None)`.
* BC break: the stacks are named after what they are: `php-8.5` instead of
  `default`, `php-8.5-intl` instead of `intl`. `intl-without-data` and
  `full-without-intl-data` are gone: the playground has every extension.
* BC break: `castor wasm:serve` takes `--php`, `--with` and `--opcache`,
  instead of `--stack`.
* BC break: nothing is embedded by default: `EMBED_AT` is empty, and
  `examples/embed/` is gone.
* Add `request()`: it runs PHP as a web server does, for an HTTP request.
  `PHP_SAPI` is then `wasm`.
* Add `createPhpInWorker()`: PHP in a Web Worker, off the main thread.
* Add the `WARMUP` build argument, `warmup()` of a stack: a file of the
  embedded directory runs when PHP is built, and what it writes is embedded.
* Add the `OPCACHE` build argument, `opcache()` of a stack, PHP 8.5 and later:
  opcache keeps what it compiles in files, as they run (`runtime`), or when
  PHP is built (`precompiled`).
* Add the Symfony example: a Symfony 8 application with Doctrine and SQLite,
  in a frame, and on its own page, with PHP in its service worker.
* Add the website, https://lyrixx.github.io/php-wasm-builder/: `castor
  site:build`, `castor site:serve`, and `.github/workflows/pages.yml`.
* `castor wasm:sizes` gives the gzipped size too, and `--json` prints JSON.
* `castor wasm:stacks` lists what each stack embeds, its warmup and its
  opcache.

### Fixes

* The C stack is 1 MB, and checked: PHP overflowed the 64 KB of emscripten,
  and wrote over its own memory. An overflow aborts the module now.
* opcache is disabled unless it has its files: it can not start without them.

### Minor

* Each example is a directory, laid out as a project: `stack.php`, `public/`,
  `app/` and a README. The stacks are `example-playground` and
  `example-symfony`.
* The notes example is gone: the Symfony one keeps its database too.
* The documentation is in `docs/`, in Markdown, rendered by zensical. It shows
  how to use the builder with castor, and with Composer and Docker only.
* The website shows this changelog.
* The README is short, and in Markdown.
* Document that PHP can write over what is embedded, in memory.
* A link to the website shows an image, that `castor site:social-image`
  renders.

## 0.9.0 (2026-11-02)

### Features

* Add the `fileinfo` extension.
* Add the `iconv` extension, with GNU libiconv 1.19 (`LIBICONV_VERSION`):
  `//TRANSLIT` and `//IGNORE` work.
* Add the `openssl` extension, with OpenSSL 3.5.9 (`OPENSSL_VERSION`).
* Add the `session` extension. The headers are still never sent, but sessions
  start.
* Add the `full-without-intl-data` stack: every extension, intl without ICU's
  data.
* `PhpWasm\check_stack()` checks iconv, OpenSSL and the sessions.

### Fixes

* `proc_open()` with an array, as Symfony Process gives, aborted the module:
  it fails with a warning now, as `exec()` and `popen()` do.
* `runFile()` and `runCode()` do not print the `#!` line of a script anymore.
* `$_SERVER` has `PHP_SELF`, `SCRIPT_NAME`, `SCRIPT_FILENAME`,
  `PATH_TRANSLATED` and `DOCUMENT_ROOT`.

### Minor

* Document that a Fiber aborts the module, and that integers are 32 bits.

## 0.8.0 (2026-10-22)

### Features

* BC break: the JavaScript API is `createPhp()`, with `runFile()` and
  `runCode()`: they take arguments and stdin, and resolve with the exit status,
  stdout and stderr. `createPhpModule()` and `ccall('phpw', …)` are gone.
* BC break: `phpw.c` is `docker/run.c`, and the module only exports what the
  API needs.
* BC break: the build for node is `php-node.mjs` and `php-node.wasm`, instead
  of `php-cli.mjs` and `php-cli.wasm`.
* BC break: `->embed('build/embed', at: '/app')` replaces
  `->embed('build/embed', 'app')`, `$embedAt` replaces `$embedPath`, and
  `EMBED_AT`, with the `/`, replaces `EMBED_PATH`.
* BC break: `PhpWasm\run_wasm()` is `run_code()`: it keeps the line breaks at
  the end, and takes stdin.
* BC break: `castor wasm:test` is `castor wasm:check`, and checks the
  JavaScript API too.
* BC break: `Dockerfile` is `docker/Dockerfile`, `run.mjs` is `node/run.mjs`,
  and `page.mjs` is `node/fetch-files.mjs`.
* Add the `pdo`, `pdo_sqlite` and `sqlite3` extensions, with SQLite 3.54.1
  (`SQLITE_VERSION`, `SQLITE_YEAR`), FTS5 and its math functions.
* Add `createPhp({ persist })`: a directory stays in IndexedDB, across the
  reloads and the tabs of the page.
* Add `examples/notes/`, and `castor wasm:serve` to serve it.
* Add `examples/playground/`, and its `playground` stack.
* `node/run.mjs` gives PHP its arguments and stdin.
* `castor wasm:run` offers to build the stack when it is not built yet.

### Fixes

* A big script does not crash the module anymore: its code is not copied on
  the stack.

### Minor

* The castor tasks say what they do, and what to do next.
* The scripts of `examples/embed/` say which stack they need.
* In `examples/`, `embed/` is what is embedded, `public/` what is served.
* The README embeds `build/embed/` in place of `build/app/`.
* The CI does not comment the sizes of the `.wasm` files on the pull requests
  anymore.

## 0.7.1 (2026-10-22)

### Minor

* Build PHP 8.5.12 by default.

## 0.7.0 (2026-10-21)

### Features

* Add `PhpWasm\test_page()` and `page.mjs`, to test the JavaScript of a page
  in node: `fetch()` reads the files from the disk.

### Minor

* `run.mjs` loads the build for the web with `page.mjs`.

## 0.6.0 (2026-10-21)

### Features

* Add `PhpWasm\check_stack()` and `PhpWasm\run_wasm()`, to check in CI that a
  build boots and answers, without a browser.
* `run.mjs` runs the build for the web too.

### Minor

* `castor wasm:run` runs the build of the first target of the stack.
* `castor wasm:test` checks every build of the stacks, and does not build the
  node target for them anymore.

## 0.5.0 (2026-10-21)

### Features

* BC break: `PhpWasm\Build` is gone: `build()` returns the stacks it is given.
* BC break: the getters of `Stack` are gone, its fields are public and
  read-only. `embed` and `outputDir` are absolute, `targets` is never null.
* BC break: `renamed()` builds in `build/<name>/`: two stacks can not share
  their output directory.
* `castor wasm:build --all` takes the overrides (`--php`, `--target`…).

### Fixes

* `extensions()` rejects an unknown extension at once, instead of the build
  failing.
* `EXTENSIONS` and `TARGETS` are separated by spaces only, as documented.
* `phpw_exec()` returns a copy of the value: it pointed to a string that PHP
  freed.
* `phpw()` does not print "Failed to execute PHP script." anymore: PHP already
  says why.

### Minor

* The `./configure` flags are sorted: the same extensions always give the same
  flags.

## 0.4.0 (2026-10-21)

### Features

* BC break: `build()` takes a list of stacks: `build([$stack])`. Its second
  argument goes to `docker buildx bake --set`, for a cache.
* Add `ICU_DATA` (`->icuData()`, `--icu-data`): `none` links intl without
  ICU's data, 2 MB bigger instead of 33 MB. Add the `intl-without-data` stack.
* `phpw()` and `phpw_run()` return the exit status of PHP, and `run.mjs` and
  `castor wasm:run` exit with it.
* `embed()` takes the name of the directory in the WASM filesystem.
* Add `->outputDir()`, to build a stack somewhere else.

### Fixes

* The output directory gets the default permissions back: buildx gave it 0700.

### Minor

* The bake file is `build/bake.json`, not in the directory of the stack
  anymore.
* Drop the `--llvm-lto` and `MAXIMUM_MEMORY` options of emcc: they did nothing.

## 0.3.0 (2026-10-20)

### Features

* BC break: `build()` takes the stacks, `build(Stack ...$stacks)`, instead of
  their names.
* BC break: a stack never changes: `renamed()` derives it, `from()` is gone.
  `embed()` is relative to the root of the project.
* BC break: the `wasm:*` tasks only build the stacks of this repository, and
  of `stacks.override.php`: they can not be imported with `composer://`
  anymore.

## 0.2.0 (2026-10-20)

### Features

* Add `PhpWasm\build(string ...$stacks)`, to build stacks from a project. The
  `wasm:*` tasks need `import('composer://lyrixx/php-wasm-builder')`.

### Fixes

* Build on the `emscripten/emsdk` image: the download of the SDK hung some
  cold builds. `EMSDK_VERSION` is a tag of the image.
* Allow buildx to read the builder and the stacks, and to write the builds: it
  waited forever for a confirmation.

## 0.1.0 (2026-10-20)

First release of this fork of
[derickr/php-wasm-builder](https://github.com/derickr/php-wasm-builder).

### Features

* Build PHP as WebAssembly with `docker buildx bake`: PHP 8.5.11 by default,
  for the browser and for node (`TARGETS`).
* Choose the extensions with `EXTENSIONS`: only the libraries they need are
  built. Add bcmath, filter, tokenizer and intl, with all of ICU's data.
* Choose the memory with `MEMORY`, and the directory to embed.
* Declare stacks in `stacks.php`, and use them with the castor tasks
  `wasm:build`, `wasm:stacks`, `wasm:run`, `wasm:test` and `wasm:sizes`.
* Run PHP in what is built with `node run.mjs`.

### Minor

* Pin the emscripten SDK: the same arguments always give the same build.
* Build and test every stack in CI, with a cache.
