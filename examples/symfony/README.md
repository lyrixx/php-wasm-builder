# Symfony

A Symfony application, a guestbook with Doctrine and SQLite, Twig, forms and a
session, on a few pages, in the browser. Two pages run it: in a frame, with
PHP in the page, and on its own page, with PHP in a service worker.

| File | What it is |
| --- | --- |
| `stack.php` | The PHP of the pages: what Symfony needs, and the application, embedded at `/app`. |
| `app/` | The Symfony application, as any other one. castor installs its `vendor/` before the build. |
| `public/index.html` | The framed page: it starts PHP, and shows the application in a frame. |
| `public/sw.js` | The service worker of the framed page, that hands what the frame asks for to the page. |
| `public/standalone/index.html` | What shows until the service worker of `standalone/` answers. |
| `public/standalone/sw.js` | The service worker that runs PHP, and answers every request under `standalone/`. |
| `public/cookies.mjs` | The cookies of the application, that both keep: a browser drops the ones a service worker answers with. |
| `public/build/` | What castor builds: `php-web.mjs` and `php-web.wasm` (not in git). |

How a request of the framed page goes through:

1. The page starts PHP in a Web Worker, with `createPhpInWorker()`: the page
   does not freeze while PHP runs. `/symfony`, where the SQLite database and
   the sessions are, is kept in IndexedDB.
2. It creates the database with `bin/console doctrine:schema:update`, then
   registers `sw.js` for `app/`, and loads `app/` in the frame.
3. The service worker hands each request of the frame to the page, that runs
   it with `php.request()`, through `app/public/index.php`, and hands the
   response back.

How a request of `standalone/` goes through:

1. `standalone/index.html` registers `standalone/sw.js`, then reloads.
2. The service worker starts PHP, with the same `/symfony`, creates the
   database, and answers the request with `php.request()`. It answers every
   other request under `standalone/` the same way: the URLs are the ones of
   the application.
3. The browser stops the service worker when it has nothing to do: the next
   request starts PHP again.

The stack makes the cache of Symfony when it is built (`warmup()`), and opcache
compiles the files as they run (`Opcache::Runtime`).

    castor wasm:serve symfony
    castor wasm:serve symfony --opcache precompiled
