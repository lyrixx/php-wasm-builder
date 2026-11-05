# Run it in node

`node/run.mjs` runs PHP in what is built, as the php command does:

```
node node/run.mjs -r 'echo PHP_VERSION;'
node node/run.mjs -r 'var_dump($argv);' one two
echo '{"a": 1}' | node node/run.mjs -r 'var_dump(json_decode(file_get_contents("php://stdin")));'
node node/run.mjs my-script.php     # a file of your disk
```

It writes what PHP writes, and exits with its exit status. `--build build/php-8.5/php-web.mjs` runs
the build for the web instead, the one a browser loads.
