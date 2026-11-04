# Symfony

A Symfony application, a guestbook with Doctrine and SQLite, Twig, forms and a
session, in the browser.

| File | What it is |
| --- | --- |
| `stack.php` | The PHP of the page: what Symfony needs, and the application, embedded at `/app`. |
| `app/` | The Symfony application, as any other one. castor installs its `vendor/` before the build. |
| `public/index.html` | The page: it starts PHP, and shows the application in a frame. |
| `public/sw.js` | The service worker, that hands what the frame asks for to the page. |
| `public/build/` | What castor builds: `php-web.mjs` and `php-web.wasm` (not in git). |

How a request goes through:

1. The page starts PHP in a Web Worker, with `createPhpInWorker()`: the page
   does not freeze while PHP runs. `/symfony`, where the SQLite database and
   the sessions are, is kept in IndexedDB.
2. It creates the database with `bin/console doctrine:schema:update`, then
   registers `sw.js` for `app/`, and loads `app/` in the frame.
3. The service worker hands each request of the frame to the page, that runs
   it with `php.request()`, through `app/public/index.php`, and hands the
   response back.

The stack makes the cache of Symfony when it is built (`warmup()`), and opcache
compiles the files as they run (`Opcache::Runtime`).

    castor wasm:serve symfony
    castor wasm:serve symfony --opcache precompiled
