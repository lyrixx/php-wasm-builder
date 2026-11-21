# PHP in a service worker

The application is on its own page, with its URLs in the address bar, the history and the reloads
of any website: a service worker is its web server. It runs PHP itself, and answers every request
under its directory with what PHP answers. It takes two files, next to each other:

```js
// sw.js
import createPhp, { serveInServiceWorker } from './build/php-web.mjs';

serveInServiceWorker(async () => {
    const php = await createPhp({ persist: '/my-application' });
    await php.runFile('/app/bin/console', { args: ['doctrine:schema:update', '--force', '--no-interaction'] });

    return php;
}, { documentRoot: '/app/public' });
```

```html
<!-- index.html -->
<p id="message">Starting PHP…</p>
<script type="module">
    import { startServiceWorker } from './build/php-web.mjs';

    try {
        await startServiceWorker();
        // The service worker answers now: with the application
        location.reload();
    } catch (error) {
        document.getElementById('message').textContent = `The application does not start: ${error.message}`;
    }
</script>
```

`index.html` only shows until the service worker answers: once it is activated, it answers the
reload, `./` too, with the front controller of the application. `sw.js` is a module, that imports
`php-web.mjs`, and it is next to `index.html`: a service worker only controls the URLs under its own
directory, its scope.

The browser stops a service worker that has nothing to do, after 30 s in Chrome, and PHP with it:
the next request starts PHP again, as the first one did, with the `.wasm` file, `createPhp()` and
what starts the application. What PHP wrote is gone with it, except what `persist` keeps in
IndexedDB (see [Keep files across reloads](persist.md)). The tabs of the application share the
service worker, and its PHP.

## `serveInServiceWorker(createApplication, options)`

It must be called as the script is first evaluated: the browser ignores a listener added later.
`createApplication()` creates PHP, with `createPhp()`, starts the application, and resolves with
PHP. The first request calls it, not the evaluation of the script: a service worker can not wait at
the top level of its module, Chrome refuses an `await` there. The requests wait for it. When it
fails, they get a 500 that says why, and the next one calls it again.

| Option         | Default | What it is                                                                                                                                           |
|----------------|---------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| `documentRoot` |         | The directory that the URLs are the files of (see [HTTP requests](http.md)).                                                                          |
| `except`       | `[]`    | What is in the scope and needs no PHP, relative to the service worker: files of the website, that the browser asks the server for, as `['bundles/']`. |
| `headers`      | `{}`    | Headers to add to each request, as an object.                                                                                                         |

The scope of the service worker is where the application is in the URLs, its base path: on GitHub
Pages, `$_SERVER['SCRIPT_NAME']` is `/my-repository/index.php`.

## `startServiceWorker(script)`

For the page: it registers `script`, `sw.js` by default, relative to the page, as a module, for its
directory, and resolves once it is activated. Without the HTTP cache: the browser looks for a new
version of `sw.js`, and of `php-web.mjs` that it imports, at each navigation in its scope, and the
new version takes the pages as soon as it is activated.

The promise is rejected when the service worker does not start, where
`navigator.serviceWorker.ready` would never resolve: a browser that has no service worker for this
page, as on `http://` out of `localhost`, a `sw.js` that does not load, or does not install. A
browser that does not run a module in a service worker does not install it: the framed page runs
PHP in the page instead (see [An application in a frame](frame.md)).

## What it takes care of

The cookies
:   The browser drops the `Set-Cookie` of a response that a service worker makes: the service worker
    keeps the cookies, and gives them back to each request. It has no `localStorage`: they are in
    the Cache API, in the `php cookies` cache, under the URL of the scope. The pages of an origin
    share it: on github.io, the ones of every repository.

The `Referer`
:   A service worker does not see it as a header: it gives it to PHP. The stateless CSRF protection
    of Symfony, that its recipes enable, checks it when there is no `Origin`.

Redirections, and responses without a body
:   A redirection is one for the browser, that follows it. A 204, a 205 and a 304 have no body, even
    when PHP writes one.

Errors
:   PHP that does not start, or a response that the browser refuses, as a header that is not ASCII,
    is a 500 that says why, and the error is in the console of the service worker. What PHP writes
    on stderr, the logs of Symfony for example, goes to `console.warn()`. A request that PHP does
    not get to the end of, an abort or a stack that overflows, is a 500 too, and the next request
    starts PHP again, with `createApplication()`: what is in the memory of the one that failed can
    not be trusted anymore.

A `sw.js` that is gone
:   The browser keeps a service worker whose script it can not update, and the service worker
    answers the pages of its scope, the one that would unregister it too. At each navigation, before
    PHP starts, it asks for its script, without the HTTP cache: on a 404, a 410, a redirection, or
    what is not JavaScript, as the `index.html` that `php -S` answers for a file it does not have,
    it unregisters itself and sends the navigation to the server. A project that removes its `sw.js`
    leaves its visitors this way, and so does another project served on the origin since, as
    `127.0.0.1:8000`. A network or a server that fails, or that does not answer within 3 s, keeps
    it. It costs a request at each navigation.
