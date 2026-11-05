# Inside this repository

Everything that compiles PHP is in `docker/`, everything else drives it:

- `docker/Dockerfile` compiles PHP to WebAssembly, with emscripten. The PHP version, the extensions
  and the directory to embed are its [build arguments](../reference/build-arguments.md). It builds
  two files for each target, `php-web.mjs` and `php-web.wasm` for the browser, `php-node.mjs` and
  `php-node.wasm` for node, and `php-sw.js` for the service worker of a page. `run.c` runs PHP, and
  `warm.mjs` runs `WARMUP` when it is built.
- The `.mjs` file is the [JavaScript API](../javascript-api/index.md), from `docker/api.js`:
  `createPhp()` starts PHP, `runFile()`, `runCode()` and `request()` run it. `docker/worker.js`
  runs it [in a worker](../javascript-api/worker.md), and `docker/frame.js`, with
  `docker/php-sw.js`, shows an application [in a frame](../javascript-api/frame.md).
- A *stack* names a set of build arguments, in PHP (see [Stacks](stacks.md)). `stacks.php` has the
  builds that this repository checks, in CI too, and castor builds them with the tasks of
  `castor.php`, from the functions of `src/`. A project that requires the package declares its own
  stack, the same way (see [Use it in your project](../your-project/index.md)).
- `examples/` has the pages of the examples, each laid out as a project of your own would be: its
  stack in `stack.php`, what the browser loads in `public/`, and the PHP code it embeds in `app/`
  (see [The examples](examples.md)).
- `node/run.mjs` runs a PHP file, or some PHP code, with node, and `node/fetch-files.mjs` lets node
  run the modules of a page as a browser does, to test them (see
  [Check it](../your-project/check.md)). `tests/` has the tests of the JavaScript API.
- `docs/` is this documentation, in Markdown, and `zensical.toml` makes it a website, with the
  template of the home page in `docs/.overrides/` (see [The examples](examples.md#this-website)).
