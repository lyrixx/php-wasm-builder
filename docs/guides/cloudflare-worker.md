# In a Cloudflare Worker

A page runs PHP in the browser of who reads it: nothing answers `curl`. A
[Cloudflare Worker](https://developers.cloudflare.com/workers/) runs WebAssembly on the servers of
Cloudflare: with the build for the web, as it is, PHP answers HTTP requests there, an API for
example.

## Build PHP

The build is the one of a page (see [Build it](../your-project/build.md)), with the code embedded,
and less memory: the 128 MB that Cloudflare gives a Worker are for the memory of the module and for
JavaScript, together.

```php
Stack::named('worker')
    ->php('8.5.12')
    ->extensions('ctype', 'mbstring')
    ->embed('build/embed', at: '/app')
    // The module and JavaScript share 128 MB
    ->memory('64mb')
    // The files are compiled once, by the first request that needs them
    ->opcache(Opcache::Runtime)
    ->targets(Target::Web)
    ->outputDir('worker/build');
```

## The Worker

`worker/worker.mjs` gives each request to `php.request()` (see
[HTTP requests](../javascript-api/http.md)), that runs the front controller of `/app/public`:

```js
import createPhp from './build/php-web.mjs';
import phpWasm from './build/php-web.wasm';

// One PHP for all the requests that Cloudflare gives to this instance of the Worker
let php;

export default {
    async fetch(request) {
        php ??= createPhp({
            instantiateWasm(imports, receiveInstance) {
                WebAssembly.instantiate(phpWasm, imports).then(receiveInstance);

                return {};
            },
        });

        const { status, headers, body, stderr } = await (await php).request({
            method: request.method,
            url: request.url,
            headers: Object.fromEntries(request.headers),
            body: await request.arrayBuffer(),
        }, { documentRoot: '/app/public' });
        if ('' !== stderr) {
            console.warn(stderr);
        }

        // A response with one of these statuses can not have a body
        return new Response([101, 204, 205, 304].includes(status) ? null : body, { status, headers });
    },
};
```

- A Worker does not fetch the `.wasm` file, as a page does: wrangler compiles the one that is
  imported, and `instantiateWasm` gives it to emscripten.
- PHP is created by the first request, not when the Worker starts: Cloudflare gives a Worker one
  second to start.
- What PHP writes on `stderr` goes to the logs of the Worker, that `npx wrangler tail` shows.

`worker/wrangler.jsonc` says where the Worker is:

```json
{
    "name": "my-api",
    "main": "worker.mjs",
    "compatibility_date": "2026-11-01"
}
```

`npx wrangler dev` runs it on your machine, and `npx wrangler deploy` deploys it. wrangler warns
about a `module` variable in `php-web.mjs`: it is code of emscripten that does not run there.

## What changes

- **The files are not kept, nor shared.** The filesystem is in the memory of an instance of the
  Worker. Cloudflare runs several of them, and stops them when it wants: what PHP writes is only
  there for the next requests of the same instance, for a while. What has to stay goes through
  JavaScript, to a storage of Cloudflare (KV, D1, R2), before or after the run.
- **The network is still out of reach of PHP** (see [Network](../reference/limitations.md#network)).
  The Worker can `fetch()` before the run, and give PHP what it got.
- **`persist`, `createPhpInWorker()` and `serveInFrame()` do not work**: they need IndexedDB, Web
  Workers and a page.

## The limits of Cloudflare

They are in [its documentation](https://developers.cloudflare.com/workers/platform/limits/). In
November 2026, three of them matter:

| Limit                | Free plan | Paid plan       | What it means for PHP                                    |
|----------------------|-----------|-----------------|----------------------------------------------------------|
| CPU time per request | 10 ms     | 30 s by default | PHP takes more than 10 ms, see below.                    |
| Memory               | 128 MB    | 128 MB          | `MEMORY` is less than that.                              |
| Size of the Worker   | 64 MiB    | 64 MiB          | Not gzipped: the `.wasm` file of the default stack is 9 MB. |

What an API that audits a document with a library of 3,000 classes takes, once deployed, with PHP
8.5.12 and `OPCACHE=runtime`: 37 ms of CPU for half of the requests, 16 ms at least, and from 200 to
600 ms for the first request of an instance, that starts PHP. Cloudflare tolerates a Worker that
goes over the limit from time to time: the 500 requests of this test all got their answer, on the
Free plan. It stops one that does it all the time: an API that is used needs the Paid plan.
