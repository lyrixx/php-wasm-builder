# Embed your code

PHP has a filesystem of its own, in memory: it does not see your disk. It runs what the page writes
in it (`php.FS.writeFile()`), and what is embedded in the `.wasm` file when it is built.
`node node/run.mjs my-script.php` runs a file of your disk: `run.mjs` copies it in the filesystem of
PHP first.

To embed a directory, `my-app/` here, at `/app`:

```
docker buildx bake --set default.contexts.embed=./my-app --set default.args.EMBED_AT=/app
node node/run.mjs -r 'require "/app/index.php";'
```

`/app/index.php` is the copy that was embedded: it only changes with a new build. A page runs it
with `php.runFile('/app/index.php')`.

To do the same from a project of yours, with its dependencies: see
[Use it in your project](../your-project/index.md).
