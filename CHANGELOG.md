# Changelog

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
