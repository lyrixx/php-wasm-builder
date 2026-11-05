# PHP in a worker

`createPhp()` runs PHP in the main thread of the page: the page freezes while PHP runs, for 80 ms
when Symfony answers a request, for example. The build for the web runs it in a Web Worker too, with
`createPhpInWorker()`:

```js
import { createPhpInWorker } from './php-web.mjs';

const php = await createPhpInWorker({ persist: '/my-page' });
const { stdout } = await php.runFile('/app/page.php');

await php.FS.writeFile('/tmp/input.json', data);
```

It starts `php-web.mjs` in a worker, that runs `createPhp()`. `runFile()`, `runCode()` and
`request()` are the same, `persist` too: a worker has IndexedDB and the Web Locks. The differences:

- the methods of `php.FS` return a promise, of what the method returns, and what they are given, or
  return, is copied. The node of `FS.mkdir()` or `FS.symlink()` can not be, the promise gives
  nothing. An `FS.lookupPath()` or an `FS.analyzePath()` can not be either, the promise is rejected;
- the options are copied to the worker: no function, as `locateFile`. The `.wasm` file is the one
  next to `php-web.mjs`, that must be on the origin of the page, as any worker;
- the stack of the JavaScript engine is smaller in a worker of Chrome: a recursion goes about 1,000
  callbacks deep, instead of 2,000 (see [Limitations](../reference/limitations.md));
- `php.terminate()` stops the worker, and frees its memory: once PHP aborted, before creating
  another one.
