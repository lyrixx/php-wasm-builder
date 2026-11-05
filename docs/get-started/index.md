# Build PHP

Docker builds PHP, node runs it, and any static server serves it to a browser. Clone the
repository, then:

```
docker buildx bake
```

This builds PHP 8.5.12, with the extensions listed in
[Supported extensions](../reference/extensions.md). Another version, or other extensions, are
[build arguments](../reference/build-arguments.md). The first build compiles everything, and takes
a while: the next ones only compile again what changed.

The files end up in `build/php-8.5/`:

- `php-web.mjs` and `php-web.wasm`, for the browser;
- `php-node.mjs` and `php-node.wasm`, for node.

Next: [run it in node](node.md), or [in a page](page.md).
