# Symfony

The [Symfony example](../repository/examples.md) runs a Symfony 8 application in the browser: a
guestbook, with Doctrine and SQLite, Twig, forms, CSRF and a session, on a few pages. The
application, in `examples/symfony/app/`, is a usual one: what is not Symfony is in
`examples/symfony/public/`.

## Why a service worker

`php.request()` is all PHP needs to run Symfony: a page, or node, gives it a request, and gets the
response. A browser needs more to show the application: what answers the requests it makes for its
pages, its links, its forms, its redirections and its stylesheets. GitHub Pages has none of these
files: a service worker answers them, with what PHP answers.

The example runs the same application twice, with two ways to do it.

## In a frame, PHP in the page

`examples/symfony/` shows the application in an `<iframe>`, where links, forms, redirections and the
history work as anywhere, with `serveInFrame()` (see [An application in a frame](frame.md)). PHP
runs in a worker of the page (see [PHP in a worker](worker.md)): the page does not freeze while it
runs. A service worker, `public/sw.js`, hands what the frame asks for to the page, and the page
hands back what PHP answers. PHP does not run in the service worker: the page keeps it running as
long as it is open.

A project of your own needs the same two files, with its own paths:

```js
// index.html
import { createPhpInWorker, serveInFrame } from './build/php-web.mjs';

const php = await createPhpInWorker({ persist: '/symfony' });
await php.runFile('/app/bin/console', { args: ['doctrine:schema:update', '--force', '--no-interaction'] });

await serveInFrame(php, { frame: document.getElementById('frame'), documentRoot: '/app/public' });
```

```js
// sw.js
importScripts('./build/php-sw.js');

forwardToPhp({ under: 'app/' });
```

## On its own page, PHP in the service worker

`examples/symfony/standalone/` is the application on its own page, with its URLs in the address bar,
the history and the reloads of any website. Its service worker, `public/standalone/sw.js`, is the
web server of the application: it runs PHP itself, and answers every request under `standalone/`.
`standalone/index.html` only shows until it does: it registers the service worker, then reloads.

The browser stops a service worker that has nothing to do, after 30 s in Chrome, and PHP with it:
the next request starts PHP again, a few hundred milliseconds, and PHP finds its files in IndexedDB.
The service worker is a module, that imports `php-web.mjs`: the browsers that do not run a module in
a service worker have the framed page.

## What both do

The extensions
:   `ctype`, `iconv`, `mbstring` and `xml`, that Symfony, Doctrine and their polyfills require,
    `filter`, that Symfony calls everywhere (`filter_var()`), `tokenizer`, without which the routes
    of the controllers are not found, `session` and `pdo_sqlite`. The stack of the example,
    `examples/symfony/stack.php`, has them.

The memory
:   The application is embedded, with its `vendor/` (19 MB), and takes as much of the memory of the
    module. It runs with 80 MB, the 128 MB by default leave room.

The cache
:   The stack of the example makes it when it is built (`WARMUP`, see
    [Build arguments](../reference/build-arguments.md)), in `/app/var/`, with the paths of the WASM
    filesystem, and opcache keeps what it compiles as the files run (`OPCACHE=runtime`, see
    [opcache](../reference/opcache.md)). PHP runs `bin/console doctrine:schema:update` first, with
    `runFile()`: it creates the database. `castor wasm:serve symfony --opcache precompiled`
    compiles every file when it is built instead.

What stays
:   The database and the sessions are in `/symfony`, that PHP keeps in IndexedDB (see
    [Keep files across reloads](persist.md)): both pages share them.

The cookies
:   The browser drops the cookies of a response that a service worker makes: what runs PHP keeps
    them, and gives them back to each request, with `keepCookies()` and `withCookies()` (see
    [An application in a frame](frame.md#the-cookies-without-the-frame)). The framed page keeps them
    in its `localStorage`, the service worker in the Cache API.

The `Referer`
:   A service worker does not see it as a header: it gives it to PHP, the stateless CSRF protection,
    that the recipes of Symfony enable, checks it when there is no `Origin`.

What there is not: the network, for an HTTP client or a database server, nor another process (see
[Limitations](../reference/limitations.md)).
