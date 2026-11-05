# PHP WASM Builder

Builds PHP as WebAssembly, for the browser and for node, with the PHP version and the extensions you
ask for, and the code you embed.

- **The documentation**: https://lyrixx.github.io/php-wasm-builder/, from `docs/`.
- **The examples**, that run in your browser: https://lyrixx.github.io/php-wasm-builder/#examples.

## Try it

Docker builds PHP in `build/php-8.5/`, node runs it:

```
docker buildx bake
node node/run.mjs -r 'echo "Hello from PHP ", PHP_VERSION, "\n";'
```

A page imports `php-web.mjs`, and runs PHP:

```html
<script type="module">
    import createPhp from './build/php-8.5/php-web.mjs';

    const php = await createPhp();
    const { stdout } = await php.runCode('echo PHP_VERSION;');
</script>
```

To build PHP for a page of your own, with your code, from your project: see
[Use it in your project](https://lyrixx.github.io/php-wasm-builder/your-project/).

## Where things are

- `docker/`: the Dockerfile that compiles PHP, and the JavaScript API of what it builds;
- `stacks.php`: the builds that this repository checks, in CI too;
- `examples/`: the examples of the website, a directory each, laid out as a project of your own
  would be: `stack.php`, `public/`, and `app/`;
- `docs/` and `zensical.toml`: the documentation, and the website;
- `castor.php` and `src/`: the tasks that build, check and serve all of it, `castor list` lists
  them;
- `node/` and `tests/`: what runs PHP in node, and tests it.

## Credits

This builder was created by [Derick Rethans](https://github.com/derickr), for
[The PHP Foundation](https://github.com/ThePHPF), in
[derickr/php-wasm-builder](https://github.com/derickr/php-wasm-builder), the builder of the PHP WASM
files of the php.net documentation. What runs PHP, `docker/run.c`, comes from the work of
[Antoine Bluchet](https://github.com/soyuka). Both are under the MIT license, see `LICENSE`. The
documentation thanks everyone else, see
[Credits](https://lyrixx.github.io/php-wasm-builder/repository/credits/).
