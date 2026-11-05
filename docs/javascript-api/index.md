# JavaScript API

`php-web.mjs` and `php-node.mjs` export a function, `createPhp()`, that loads PHP from the `.wasm`
file next to them:

```js
import createPhp from './php-web.mjs';

const php = await createPhp();

const { exitCode, stdout, stderr } = await php.runFile('/app/page.php', {
    args: ['--format=html'],
    stdin: JSON.stringify(request),
});
```

## Run PHP

| Method                                      | What it does                                                                                                                                       |
|---------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|
| `php.runFile(file, { args, stdin })`        | Runs a file of the WASM filesystem, as `php <file> <args>...` does.                                                                                |
| `php.runCode(code, { args, stdin })`        | Runs some PHP code, without `<?php`, as `php -r <code> <args>...` does: `$argv[0]` is `Standard input code`.                                       |
| `php.request(request, { documentRoot, basePath })` | Runs PHP as a web server does, for an HTTP request, and resolves with the response (see [HTTP requests](http.md)).                          |

`args` (strings) are in `$argv`, after the file. `stdin` (a string, or a `Uint8Array`) is what PHP
reads on `php://stdin`. Both are optional. `STDIN`, `STDOUT` and `STDERR` are not defined: they are
constants of the php command only.

`runFile()` and `runCode()` resolve once PHP is done, with what it gave:

- `exitCode`: the one given to `exit()`, 255 on a fatal error or an uncaught exception, 0 otherwise;
- `stdout` and `stderr`: what PHP wrote, as it wrote it, as strings (UTF-8). Something binary, as an
  image, is rather written in a file, and read with `php.FS`. As with the php command, the errors
  are on `stdout`: `display_errors` is on.

Each run is a request of its own: PHP starts, runs, and stops, nothing is left of its variables. The
files stay, until the page goes away.

## The filesystem

`php.FS` is the filesystem of emscripten (see
[its API](https://emscripten.org/docs/api_reference/Filesystem-API.html)), to give files to PHP, or
read the ones it writes: `php.FS.writeFile('/tmp/input.json', data)`,
`php.FS.readFile('/tmp/output.png')`. What is embedded is there too: PHP can write over it, in
memory, as over the other files.

## Options

`createPhp({ persist })`: `persist` is a directory of the WASM filesystem to keep in IndexedDB,
across the reloads of the page, with the build for the web only (see
[Keep files across reloads](persist.md)).

`createPhp()` takes the options of the `Module` of emscripten too, for example `locateFile` to load
the `.wasm` file from somewhere else.

## In a frame

The build for the web shows an application in an `<iframe>`, as on a web server, with a service
worker (see [An application in a frame](frame.md)):

| What                                                                | What it does                                                                                    |
|---------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| `serveInFrame(php, { frame, documentRoot, under, start, headers })` | From `php-web.mjs`: starts the service worker, answers what it hands over, and opens the frame. |
| `forwardToPhp({ under, except })`                                   | From `php-sw.js`, that a service worker imports: hands what the frame asks for to the page.     |
| `keepCookies(cookies, headers)`, `withCookies(headers, cookies)`    | From `php-web.mjs`: the cookies of the application, for a service worker that runs PHP itself.  |

## When it aborts

A run that takes all of the stack of the module (see [Limitations](../reference/limitations.md))
aborts it, and the promise is rejected: what is in its memory can not be trusted anymore, create
another one. A run that takes all of its memory does not: it is a fatal error of PHP, and the module
goes on (see [Memory](../reference/limitations.md#memory)).
