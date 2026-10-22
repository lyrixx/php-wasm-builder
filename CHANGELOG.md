# Changelog

## 0.8.0 (unreleased)

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
