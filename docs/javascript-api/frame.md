# An application in a frame

`php.request()` is all PHP needs to run a framework: a page gives it a request, and gets the
response. A browser needs more to show the application: what answers the requests it makes for its
pages, its links, its forms, its redirections and its stylesheets. The build for the web does it,
in an `<iframe>`, with a service worker: the page only says what is its own.

```html
<!-- index.html -->
<iframe id="frame" title="The application"></iframe>
<script type="module">
    import { createPhpInWorker, serveInFrame } from './build/php-web.mjs';

    const php = await createPhpInWorker({ persist: '/my-application' });
    await php.runFile('/app/bin/console', { args: ['doctrine:schema:update', '--force', '--no-interaction'] });

    await serveInFrame(php, { frame: document.getElementById('frame'), documentRoot: '/app/public' });
</script>
```

```js
// sw.js
importScripts('./build/php-sw.js');

forwardToPhp({ under: 'app/' });
```

The frame shows `app/`, next to the page, where links, forms, redirections and the history work as
anywhere. The service worker takes what the frame asks for to the page, and the page runs it with
`php.request()`. PHP does not run in the service worker: a browser stops one that has nothing to do,
and PHP would forget its files. In a worker of the page (see [PHP in a worker](worker.md)), the page
does not freeze while it runs.

`sw.js` is the only file to add, next to `index.html`: a service worker only controls the URLs under
its own directory, so it can not be `build/php-sw.js`. The `Service-Worker-Allowed` header lifts
this, and GitHub Pages does not send it. `build/php-sw.js` is what the build gives, as
`build/php-web.mjs`.

## `serveInFrame(php, options)`

It takes what `createPhpInWorker()` or `createPhp()` return, starts the service worker, and opens
the frame. The promise resolves once the frame is asked to open: the loading message of the page is
its own.

| Option         | Default | What it is                                                                                                    |
|----------------|---------|---------------------------------------------------------------------------------------------------------------|
| `frame`        |         | The `<iframe>`.                                                                                               |
| `documentRoot` |         | The directory that the URLs are the files of (see [HTTP requests](http.md)).                                  |
| `under`        | `app/`  | Where the application is in the URLs, relative to the page, with its slash. The same as for `forwardToPhp()`. |
| `start`        | empty   | Where the frame opens, relative to `under`: `admin` opens `app/admin`.                                        |
| `headers`      | `{}`    | Headers to add to each request, as an object, for what the application asks of the page.                      |

What PHP writes on stderr, the logs of Symfony for example, goes to `console.warn()`. When PHP
fails, the frame shows why, in a 500, and the error goes to the console.

## `forwardToPhp(options)`

It must be called as the script is first evaluated: the browser ignores a listener added later. Its
paths are relative to the service worker.

| Option   | Default | What it is                                                                                                           |
|----------|---------|----------------------------------------------------------------------------------------------------------------------|
| `under`  | `app/`  | Where the application is in the URLs. The same as for `serveInFrame()`: the service worker does not start otherwise. |
| `except` | `[]`    | What is in it, and needs no PHP: files of the website, that the browser asks the server for, as `['app/bundles/']`.  |

The page must be `index.html`, next to `sw.js`: the service worker looks for it among the pages of
the origin, that are all its clients. On GitHub Pages, the ones of every repository are.

With several tabs of the page, each one runs its own PHP, and the service worker hands a request to
one of them. A tab that is still starting PHP does not answer: what the frame of another tab asks
for meanwhile gets no response.

## What it takes care of

The cookies
:   The browser drops the `Set-Cookie` of a response that a service worker makes: the page keeps the
    cookies, and gives them back to each request. They are in its `localStorage`, under a key made
    of the path of the application: the pages of an origin share it. A page that moves starts with
    no cookie: a new session.

The `Referer`
:   A service worker does not see it as a header: it gives it to PHP. The stateless CSRF protection
    of Symfony, that its recipes enable, checks it when there is no `Origin`.

Redirections, and responses without a body
:   A redirection is one for the browser, that follows it in the frame. A 204, a 205 and a 304 have
    no body, even when PHP writes one.

An update
:   A project that moves to a new version changes `build/php-sw.js`, not its `sw.js`. Each load of
    the page looks for a new version, without the HTTP cache, and the frame opens once it is
    activated. A new version that does not load leaves the current one, with a warning in the
    console.

A service worker that does not start
:   The frame says why, instead of staying white, and the promise is rejected: a `sw.js` that is not
    there, a browser that has no service worker for this page, as on `http://` out of `localhost`.

## The cookies, without the frame

A service worker that runs PHP itself needs them too. `php-web.mjs` exports what `serveInFrame()`
uses, for a `Map` of cookies by name, kept where the service worker can:

```js
import createPhp, { keepCookies, withCookies } from './build/php-web.mjs';

const response = await php.request({ ...request, headers: withCookies(request.headers, cookies) }, options);
keepCookies(cookies, response.headers);
```

`withCookies()` takes a list of names and values, and replaces the cookies that the browser sends.
`examples/symfony/public/standalone/sw.js` keeps them in the Cache API.
