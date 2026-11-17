# A Symfony application

A Symfony application runs in the browser as it is: Doctrine and SQLite, Twig, forms, CSRF and a
session. `php.request()` is all PHP needs to run it (see [HTTP requests](../javascript-api/http.md)):
it gets a request, and gives the response. A browser needs more to show the application: what
answers the requests it makes for its pages, its links, its forms, its redirections and its
stylesheets. A static host has none of these files: a service worker answers them, with what PHP
answers.

The [Symfony example](../repository/examples.md) is what this guide builds: a guestbook, in
`examples/symfony/`.

## Build PHP

The build is the one of a page (see [Build it](../your-project/build.md)), with the application
embedded, once composer installed its `vendor/`:

```php
Stack::named('symfony')
    ->extensions('ctype', 'filter', 'iconv', 'mbstring', 'pdo_sqlite', 'session', 'tokenizer', 'xml')
    ->embed('app', at: '/app')
    // Symfony makes its cache when the stack is built, with the paths of the WASM filesystem
    ->warmup('bin/console', 'cache:warmup')
    // The files are compiled once, as they run
    ->opcache(Opcache::Runtime)
    ->targets(Target::Web)
    ->outputDir('public/build');
```

The extensions
:   `ctype`, `iconv`, `mbstring` and `xml`, that Symfony, Doctrine and their polyfills require,
    `filter`, that Symfony calls everywhere (`filter_var()`), `tokenizer`, without which the routes
    of the controllers are not found, `session` and `pdo_sqlite`.

The memory
:   The embedded application, with its `vendor/`, takes as much of the memory of the module: 19 MB
    for the example, that runs with 80 MB. The 128 MB by default leave room.

The cache
:   `WARMUP` makes it in `/app/var/`, when PHP is built (see
    [Build arguments](../reference/build-arguments.md)). With `OPCACHE=runtime`, opcache keeps what
    it compiles as the files run, and `OPCACHE=precompiled` compiles every file when PHP is built
    instead (see [opcache](../reference/opcache.md)).

## What the application writes

The embedded files are the same at each load of the page: what the application writes, its
database and its sessions, goes in a directory that PHP keeps in IndexedDB (see
[Keep files across reloads](../javascript-api/persist.md)), `/symfony` here:

```dotenv
# .env
DATABASE_URL="sqlite:////symfony/guestbook.sqlite"
```

```yaml
# config/packages/framework.yaml
framework:
    session:
        save_path: /symfony/sessions
```

The console creates the database before the first request, with `runFile()`:

```js
const php = await createPhp({ persist: '/symfony' });
await php.runFile('/app/bin/console', { args: ['doctrine:schema:update', '--force', '--no-interaction'] });
```

PHP starts again at each load of the page, or of the service worker. In node, the example then runs
the console in 435 ms, and its first request in 205 ms. The console only has to run once per build
of the application: the example names the build in the cache of Symfony, with a cache warmer that
`warmup()` runs, and keeps the name of the build it last ran the console for next to the database.
Without the console, the first request takes 310 ms, as it compiles some of what the console
compiled: about 300 ms less.

```php
// src/BuildIdWarmer.php
final readonly class BuildIdWarmer implements CacheWarmerInterface
{
    public function isOptional(): bool
    {
        return false;
    }

    public function warmUp(string $cacheDir, ?string $buildDir = null): array
    {
        file_put_contents(($buildDir ?? $cacheDir) . '/build-id', bin2hex(random_bytes(8)));

        return [];
    }
}
```

```js
// In PHP: php.FS does not see what IndexedDB has before the first run
const { stdout: started } = await php.runCode("echo (int) (file_get_contents('/app/var/cache/prod/build-id') === @file_get_contents('/symfony/build-id'));");
if ('1' !== started) {
    await php.runFile('/app/bin/console', { args: ['doctrine:schema:update', '--force', '--no-interaction'] });
    await php.runCode("copy('/app/var/cache/prod/build-id', '/symfony/build-id');");
}
```

The build runs `warmup()` again each time what is embedded changes: the name changes with the
application. `warmup()` compiles the container of Symfony too, that the console would compile
otherwise. A project that prepares what it embeds, in a task of castor, can write the name there
instead. Both pages of the example run it, from `examples/symfony/public/start.mjs`.

There are two ways to show the application then: the example has both, and they share `/symfony`.

## In a frame, PHP in the page

The page shows the application in an `<iframe>`, where links, forms, redirections and the history
work as anywhere, with `serveInFrame()` (see [An application in a frame](../javascript-api/frame.md)).
PHP runs in a worker of the page (see [PHP in a worker](../javascript-api/worker.md)): the page does
not freeze while it runs. A service worker hands what the frame asks for to the page, and the page
hands back what PHP answers. PHP does not run in the service worker: the page keeps it running as
long as it is open.

It takes two files:

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

forwardToPhp();
```

`serveInFrame()` keeps the cookies of the application, in the `localStorage` of the page.

## On its own page, PHP in the service worker

The application is on its own page, with its URLs in the address bar, the history and the reloads
of any website. The service worker is the web server of the application: it runs PHP itself, and
answers every request under its directory, with `serveInServiceWorker()` (see
[PHP in a service worker](../javascript-api/service-worker.md)). It is a module, that imports
`php-web.mjs`:

```js
// sw.js
import createPhp, { serveInServiceWorker } from './build/php-web.mjs';

serveInServiceWorker(async () => {
    const php = await createPhp({ persist: '/symfony' });
    await php.runFile('/app/bin/console', { args: ['doctrine:schema:update', '--force', '--no-interaction'] });

    return php;
}, { documentRoot: '/app/public' });
```

PHP starts with the first request. The browser stops a service worker that has nothing to do, after
30 s in Chrome, and PHP with it: the next request starts PHP again, and PHP finds its files in
IndexedDB. `serveInServiceWorker()` keeps the cookies of the application, in the
Cache API, and gives PHP the `Referer`: the stateless CSRF protection, that the recipes of Symfony
enable, checks it when there is no `Origin`.

`index.html` only shows until the service worker answers: it registers it, then reloads.

```js
// index.html
import { startServiceWorker } from './build/php-web.mjs';

await startServiceWorker();

// The service worker answers now: with Symfony
location.reload();
```

`startServiceWorker()` fails in the browsers that do not run a module in a service worker: they have
the framed page. `examples/symfony/public/standalone/` is the whole of it, with what the page says
when it fails.

## Bigger applications

Two demos run the framed page with applications that are not written for it, in
[another repository](https://github.com/lyrixx/php-wasm-demo):

- [The Symfony Demo](https://lyrixx.github.io/php-wasm-demo/symfony-demo/),
  [symfony/demo](https://github.com/symfony/demo) as it is: the blog, its admin, the login, the
  search, AssetMapper, Stimulus, a Live Component and 30 languages.
- [EasyAdmin](https://lyrixx.github.io/php-wasm-demo/easyadmin/), the back office of a record shop
  that never existed, with [EasyAdmin](https://github.com/EasyCorp/EasyAdminBundle): a sales
  dashboard, filters, batch actions and fixtures.

Their stacks have intl with its data, for the dates and the prices in the language of the page:
the 32 MB it takes, and what is embedded, need 256 MB of memory.

## What there is not

The network, for an HTTP client or a database server, nor another process (see
[Limitations](../reference/limitations.md)).
