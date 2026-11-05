# Backward compatibility

From 1.0.0, the versions follow [Semantic Versioning](https://semver.org): a minor or a patch
version does not break what this page covers. Until then, a minor version can, and the changelog
says it, with `BC break:`.

## What is covered

- The [build arguments](build-arguments.md): their names, and the values they take.
- The extensions that are [built by default](extensions.md): one can be added, not removed.
- The files that a build gives: `php-web.mjs`, `php-web.wasm`, `php-node.mjs` and `php-node.wasm`.
- The [JavaScript API](../javascript-api/index.md): `createPhp()`, `createPhpInWorker()`, what they
  give, and their options.
- `Stack`, `Target`, `Opcache` and `IcuData`, and the functions of `src/functions.php`: what a
  project uses, see [Use it in your project](../your-project/index.md).
- `node/run.mjs` and `node/fetch-files.mjs`: their arguments, and what they do.

## What is not

- The versions that the Dockerfile pins: PHP, emscripten and the libraries move in any version. A
  project that needs one of them gives it as a [build argument](build-arguments.md).
- What PHP itself does, from a version to the next, and the size of what is built.
- The [limitations](limitations.md): one can go away in any version.
- What only this repository uses: the tasks of `castor.php`, the stacks of `stacks.php`, the
  examples, the `@internal` functions of `src/functions-internal.php`, and everything else in
  `docker/`: its stages, `run.c`, and what the `.wasm` file exports.
