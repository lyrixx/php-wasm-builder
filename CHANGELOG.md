# Changelog

## Unreleased

* Add `request()` to the JavaScript API: it runs PHP as a web server does,
  for an HTTP request (`$_GET`, `$_POST`, `$_COOKIE`, `$_FILES`,
  `php://input`), and resolves with the status, the headers and the body of
  the response. The file of `documentRoot` that the URL asks for runs, or is
  the response as it is, `index.php` otherwise. `PHP_SAPI` is then `wasm`,
  not `embed`, that Symfony takes for the command line.
* Add `createPhpInWorker()` to the build for the web: PHP in a Web Worker,
  off the main thread of the page, with the same API, but for `FS`, whose
  methods return a promise, and `terminate()`. `createPhp()` does not change.
  The build for the web says it runs in a worker too
  (`ENVIRONMENT=web,worker`).
* Add the `symfony` stack, and the page of `examples/symfony/`: a Symfony 8
  application, with Doctrine and SQLite, forms and a session, in a frame,
  that a service worker hands to PHP, in a worker. castor installs its
  `vendor/` with the composer of Docker.
* Fix: the C stack is 1 MB, and checked. It was the 64 KB of emscripten: PHP
  overflowed it without a word through the callbacks of its functions
  (Symfony, when it compiles its container), and wrote over its own memory.
  A stack that overflows aborts the module now.
* The README says that PHP can write over what is embedded, in memory: it is
  not read only.
* Add the `WARMUP` build argument, `warmup()` of a stack: a file of the
  embedded directory, that runs in PHP when it is built, and whose output in
  the directory is embedded too. For a cache made with the paths of the WASM
  filesystem: `bin/console cache:warmup`.
* Add the `OPCACHE` build argument, `opcache()` of a stack, PHP 8.5 and
  later: opcache keeps what it compiles in files of the WASM filesystem, that
  the next runs read. It compiles the files as they run (`runtime`), or when
  PHP is built (`precompiled`). What is embedded is dated 1 s after the epoch
  then.
* opcache is disabled, unless it has its files: in WASM, it can not start
  without them.
* The Symfony example makes the cache of Symfony when it is built, and
  opcache compiles its files as they run: it starts in 0.4 s instead of
  0.6 s, a request takes 35 ms instead of 115 ms, in node.
* BC break: `icuData()` of a stack takes an `IcuData`,
  `->icuData(IcuData::None)`, instead of a string.
* The stacks are renamed after what they are. `stacks.php` has the builds:
  `php-8.5` instead of `default` (in `build/php-8.5/`, as what `docker buildx
  bake` builds), `php-8.5-intl` instead of `intl`, and
  `php-8.5-opcache-runtime` and `php-8.5-opcache-precompiled`.
  `intl-without-data` and `full-without-intl-data` are gone: the playground
  has every extension, intl without ICU's data.
* Each example is a directory, laid out as a project would be: its stack in
  `stack.php` (`example-playground`, `example-symfony`), what the browser
  loads in `public/`, the PHP code it embeds in `app/`, and a README that says
  how it is wired. Their pages are redone: each says what it shows, what to
  try, and how it works.
* The notes example is gone: the Symfony one keeps its SQLite database in
  IndexedDB too. `examples/embed/` is gone, and nothing is embedded by
  default: `EMBED_AT` is empty, and `docker-bake.hcl` gives no `embed`
  context.
* `castor wasm:serve` takes `--php`, `--with` and `--opcache`, as `castor
  wasm:build`, instead of `--stack`: the page keeps what its stack needs.
  `castor wasm:serve playground --php 8.3.35`.
* `castor wasm:stacks` lists, for each stack, what it embeds, its warmup and
  its opcache too.
* BC break: `targets()` of a stack takes `Target`s, `->targets(Target::Web)`,
  instead of strings, and `artifact()` a `Target`. `Stack::TARGETS` is gone.
* Add the website, https://lyrixx.github.io/php-wasm-builder/, that
  `.github/workflows/pages.yml` deploys on GitHub Pages: the examples, the
  pages built with the builder, and the documentation, in Markdown in
  `docs/`, that zensical renders. `castor site:build` builds it, `castor
  site:serve` serves it under the path where GitHub Pages does. The service
  worker of the Symfony example only hands requests to its own page: on
  github.io, the pages of other repositories are of the same origin.
* The documentation shows how to use the builder from a project with castor,
  as well as with Composer and Docker only.
* The Symfony example has a few pages, and runs on its own page too,
  `standalone/`, with its URLs in the address bar: its service worker runs PHP
  itself, and answers every request. Both pages share the database.
* `castor wasm:sizes` gives the gzipped size too, and `--json` prints the
  sizes as JSON. The website shows them: `castor site:build` builds every
  stack, and measures them.
* A link to the website shows an image, `docs/assets/social-image.png`, that
  `castor site:social-image` renders.
* The README is short, and in Markdown: what this is, how to try it, and
  where things are. What it said is in the documentation, on the website.

## 0.9.0 (2026-11-02)

* Add the `fileinfo` extension, with the libmagic and the database that come
  with PHP.
* Add the `iconv` extension, with GNU libiconv 1.19 (`LIBICONV_VERSION`), that
  knows `//TRANSLIT` and `//IGNORE`.
* Add the `openssl` extension, with OpenSSL 3.5.9 (`OPENSSL_VERSION`) and its
  configuration, embedded at `/etc/ssl/openssl.cnf`.
* Add the `session` extension. `headers_sent()` is false: the headers are still
  never sent, but sessions start.
* Add the `full-without-intl-data` stack: every extension, intl without ICU's
  data. `PhpWasm\check_stack()` checks that iconv transliterates, that OpenSSL
  has its configuration, and that sessions start.
* `proc_open()` fails with a warning (`posix_spawn() failed: Function not
  implemented`), as `exec()` and `popen()` do. With an array, as Symfony
  Process gives, it aborted the module: the C library of emscripten has no
  `posix_spawnp()`.
* `runFile()` and `runCode()` run as the php command does: the `#!` line of a
  script (`artisan`, `bin/console`) is not printed anymore, nor the one of what
  it includes, and `$_SERVER` has `PHP_SELF`, `SCRIPT_NAME`,
  `SCRIPT_FILENAME`, `PATH_TRANSLATED` and `DOCUMENT_ROOT`.
* The README says that a Fiber aborts the module, and that integers are 32
  bits: PHP 8.5 warns when a float out of their range is cast to an int.

## 0.8.0 (2026-10-22)

* BC break: the JavaScript API is `createPhp()`, and the `runFile()` and
  `runCode()` of what it returns, documented in the README ("JavaScript API"):
  `createPhpModule()` and `ccall('phpw', …)` are gone. A run resolves with the
  exit status of PHP, and with what it wrote on stdout and stderr, as it wrote
  it: there is no `print()` to give, nor line break to remove. It gives PHP
  arguments (`$argv`) and stdin (`php://stdin`), and the code is not copied on
  the stack of the module anymore: a big one does not crash it.
* BC break: `phpw.c` is `docker/run.c`, with `run_file()` and `run_code()`. The
  module only exports what the API needs: `phpw()`, `phpw_run()`,
  `phpw_exec()`, `phpw_flush()`, `ccall()`, `UTF8ToString()`… are gone.
* BC break: the build for node is `php-node.mjs` and `php-node.wasm`, instead
  of `php-cli.mjs` and `php-cli.wasm`: it is not the CLI of PHP.
* BC break: `->embed('build/embed', 'app')` is `->embed('build/embed', at:
  '/app')`, `Stack::$embedPath` is `$embedAt`, and the `EMBED_PATH` build
  argument is `EMBED_AT`, with the `/`.
* BC break: `PhpWasm\run_wasm()` is `run_code()`, as `runCode()`: it returns
  what PHP prints, without removing the line breaks at the end, and takes what
  PHP reads on stdin.
* BC break: `castor wasm:test` is `castor wasm:check`, as `check_stack()`, and
  it checks the JavaScript API too.
* BC break: what Docker builds is in `docker/`, the build context:
  `Dockerfile` is `docker/Dockerfile`. `run.mjs` and `page.mjs` are
  `node/run.mjs` and `node/fetch-files.mjs`.
* `node/run.mjs` gives PHP the arguments after the file, or after the code, and
  what is piped to it on stdin.
* Add the `pdo`, `pdo_sqlite` and `sqlite3` extensions, with SQLite 3.54.1
  (`SQLITE_VERSION` and `SQLITE_YEAR`), its full-text search (FTS5) and its
  math functions. `PhpWasm\check_stack()` checks that SQLite has them.
* `createPhp({ persist: '/my-page' })` keeps a directory of the WASM filesystem
  in IndexedDB, across the reloads of the page, an SQLite database too. One run
  at a time, across the tabs of the page: no tab writes over what another one
  wrote.
* Add `examples/notes/`, a page that keeps notes in SQLite, its `notes` stack,
  and `castor wasm:serve`, to serve it with the built-in server of PHP: it
  lists the examples that have a page when none is given.
* Add `examples/playground/`, a page that runs the scripts of
  `examples/embed/`: the `playground` stack is built in it, for the web only.
* The castor tasks say what they do, and what to do next. `castor wasm:run`
  offers to build the stack when it is not built yet, and `castor wasm:serve`
  builds the page every time (in a second when nothing changed), with the PHP
  version and the extensions of another stack with `--stack`.
* The scripts of `examples/embed/` say which stack they need when they do not
  run in it.
* The CI does not comment the sizes of the `.wasm` files on the pull requests
  anymore.
* In `examples/`, what an `embed/` directory has is embedded, what a `public/`
  directory has is served: the scripts are in `examples/embed/`, still at
  `/examples` in the WASM filesystem.
* The README embeds `build/embed/` in place of `build/app/`, still at `/app`.

## 0.7.1 (2026-10-22)

* Build PHP 8.5.12 by default.

## 0.7.0 (2026-10-21)

* Add `PhpWasm\test_page()` and `page.mjs`, to test the JavaScript of a page
  in node: preloaded with `node --import`, `page.mjs` makes `fetch()` read the
  files from the disk, and record their resource timing, as a browser does. The
  modules of the page, and the `php-web.mjs` they load, run as they are.
* `run.mjs` loads the build for the web with `page.mjs`.

## 0.6.0 (2026-10-21)

* Add `PhpWasm\check_stack()` and `PhpWasm\run_wasm()`, to check in the CI
  of a project that what it built boots and answers: they run the build for
  the web in node, no browser is needed, and throw a `ProblemException` when
  something is wrong, as castor's `check()` does.
* `run.mjs` runs the build for the web too. `castor wasm:run` runs the build of
  the first target of the stack, and `castor wasm:test` checks every build of
  the stacks, without building the node target for them anymore.

## 0.5.0 (2026-10-21)

* BC break: `PhpWasm\Build` is gone: `build()` returns the stacks it is given,
  with the same `artifact()` and `artifacts()`.
* BC break: the getters of `Stack` are gone, its fields are public and
  read-only: `$stack->name` instead of `$stack->getName()`. `embed` and
  `outputDir` are absolute paths, and `targets` is never null.
* BC break: `renamed()` builds the new stack in `build/<name>/`, even when the
  stack it comes from has another `outputDir()`: two stacks can not share
  their output directory.
* `extensions()` rejects an unknown extension as soon as it is given, instead
  of the build failing.
* `castor wasm:build --all` takes the overrides (`--php`, `--target`…), for
  every stack.
* `EXTENSIONS` and `TARGETS` are separated by spaces only, as documented: they
  do not accept commas anymore.
* The `./configure` flags are sorted, so that the same extensions always give
  the same flags: PHP is compiled once more.
* `phpw_exec()` returns a copy of the value: it pointed to a string that PHP
  freed when it stopped.
* `phpw()` does not print "Failed to execute PHP script." anymore: PHP already
  says why.

## 0.4.0 (2026-10-21)

* BC break: `build()` takes the list of the stacks: `build($stack)` is now
  `build([$stack])`. Its second argument is given to `docker buildx bake
  --set`, to keep the layers in a cache (`*.cache-from=type=gha`, for example).
* Add `ICU_DATA` (`->icuData()`, `--icu-data`): `none` links intl without
  ICU's data, for code that only needs intl to be loaded. The `.wasm` file is
  then 2 MB bigger than without intl, instead of 33 MB, and needs no more
  memory. Add the `intl-without-data` stack.
* `phpw()` and `phpw_run()` return the exit status of PHP: the one given to
  `exit()`, 255 on a fatal error or an uncaught exception, 0 otherwise.
  `run.mjs` and `castor wasm:run` exit with it.
* `embed()` takes the name of the directory in the WASM filesystem:
  `->embed('build/dist', 'app')` embeds `build/dist` at `/app`.
* Add `->outputDir()`, to build a stack somewhere else than `build/<stack>/`.
  The output directory gets the default permissions back: buildx gave it 0700.
* The bake file is written in `build/bake.json`, not in the directory of the
  stack anymore.
* Drop the `--llvm-lto` and `MAXIMUM_MEMORY` options of emcc: they did nothing,
  what is built is the same.

## 0.3.0 (2026-10-20)

* BC break: `build()` takes the stacks, `build(Stack ...$stacks)`, declared
  wherever the project wants, instead of the names of the stacks of a
  `stacks.php` next to `castor.php`.
* BC break: a stack never changes, and is derived from another one with
  `renamed()`: `from()` is gone. `embed()` is relative to the root of the
  project, not to `stacks.php` anymore.
* BC break: the `wasm:*` tasks only build the stacks of this repository, and of
  `stacks.override.php` (ignored by git): they are not meant to be imported
  with `composer://` anymore.

## 0.2.0 (2026-10-20)

* Add `PhpWasm\build(string ...$stacks)`, autoloaded by composer, to build
  stacks from the tasks of a project that requires the package. The `wasm:*`
  tasks are only added by `import('composer://lyrixx/php-wasm-builder')`.
* Build on the `emscripten/emsdk` image instead of installing the SDK, whose
  download had no timeout and hung some cold builds. `EMSDK_VERSION` is a tag
  of the image.
* Allow buildx to read the builder and the stacks, and to write the builds:
  outside of the current directory, for example when the package comes from a
  path repository, buildx asked for a confirmation and waited forever.

## 0.1.0 (2026-10-20)

First release of this fork of
[derickr/php-wasm-builder](https://github.com/derickr/php-wasm-builder).

* Build PHP as WebAssembly with `docker buildx bake`: PHP 8.5.11 by default,
  for the browser (`php-web.mjs`) and for node (`php-cli.mjs`), the targets
  chosen with `TARGETS`.
* Choose the extensions with `EXTENSIONS`: only the libraries they need are
  built. Add bcmath, filter, tokenizer and intl, linked statically with ICU
  and all of its data.
* Choose the memory with `MEMORY`, and the directory to embed in the WASM
  filesystem.
* Pin the emscripten SDK, so that the same arguments always give the same
  build.
* Declare stacks (a PHP version, extensions, what to embed, the targets) in
  `stacks.php`, and build, list, run, test and compare them with the castor
  tasks `wasm:build`, `wasm:stacks`, `wasm:run`, `wasm:test` and `wasm:sizes`.
  A project gets them with `import('composer://lyrixx/php-wasm-builder')`.
* Run PHP code, or a PHP file, in what is built with `node run.mjs`.
* Build and test every stack in CI, with a cache.
