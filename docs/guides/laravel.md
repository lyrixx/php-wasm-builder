# A Laravel application

A Laravel application runs in the browser as it is: Eloquent and SQLite, Blade, validation, policies,
a session and CSRF. It runs as a Symfony application does (see [A Symfony application](symfony.md)):
`php.request()` runs it, and a service worker answers what the browser asks for with what PHP
answers. This guide is what Laravel needs on top of it.

[Pop Quiz](https://lyrixx.github.io/php-wasm-demo/pop-quiz/), a quiz made with Laravel 13, in
[another repository](https://github.com/lyrixx/php-wasm-demo), is what it is written with: the
numbers are its own, with the build for the web, in node.

## Build PHP

The build is the one of a page (see [Build it](../your-project/build.md)), with the application
embedded, once composer installed its `vendor/`:

```php
Stack::named('laravel')
    ->extensions('ctype', 'dom', 'fileinfo', 'filter', 'mbstring', 'openssl', 'pdo_sqlite', 'session', 'tokenizer')
    ->embed('app', at: '/app')
    // Laravel caches its configuration, its events, its routes and its views when the stack is
    // built, with the paths of the WASM filesystem
    ->warmup('artisan', 'optimize')
    // The files are compiled once, as they run
    ->opcache(Opcache::Runtime)
    ->targets(Target::Web)
    ->outputDir('public/build');
```

The extensions
:   `ctype`, `filter`, `mbstring`, `openssl`, `session` and `tokenizer`, that `laravel/framework`
    requires: openssl encrypts the cookies. `fileinfo`, that Flysystem requires, `dom`, that
    Termwind writes the output of artisan with, and `pdo_sqlite`.

intl
:   Laravel does without it: the polyfills of `symfony/string` and `symfony/mime` take its place,
    as long as the `replace` of `composer.json` leaves them to Composer. The helpers of `Number`, as
    `Number::format()`, need it: add it, with its data (see [intl](../reference/extensions.md#intl)).
    Without it, the `.wasm` file of Pop Quiz is 39 MB, 9.5 MB gzipped.

The memory
:   The embedded application, with its `vendor/`, takes as much of the memory of the module: 24 MB
    for Pop Quiz, 5,094 files. The 128 MB by default are enough.

The cache
:   `WARMUP` runs `artisan optimize` when PHP is built (see
    [Build arguments](../reference/build-arguments.md)): what it caches has the paths of the WASM
    filesystem. A cache made on a development machine has the paths of the machine: the
    `.dockerignore` of the application leaves it out, with what Laravel wrote there.

```gitignore
# .dockerignore
/bootstrap/cache/config.php
/bootstrap/cache/events.php
/bootstrap/cache/routes-v7.php
/storage/framework/cache/data/*
/storage/framework/sessions/*
/storage/framework/views/*.php
/storage/logs/*
```

## The configuration

The embedded files are the same at each load of the page: what the application writes, its
database and its sessions, goes in a directory that PHP keeps in IndexedDB (see
[Keep files across reloads](../javascript-api/persist.md)), `/pop-quiz` here.

```dotenv
# .env
APP_ENV=production
APP_KEY=base64:…
APP_DEBUG=false

# What Laravel logs goes to the console of the page
LOG_CHANNEL=stderr
LOG_LEVEL=warning

DB_CONNECTION=sqlite
DB_DATABASE=/pop-quiz/database.sqlite

SESSION_DRIVER=database
CACHE_STORE=array
QUEUE_CONNECTION=sync
MAIL_MAILER=log
```

The key
:   It is in the `.wasm` file, as the rest of the application: whoever loads the page can read it.
    It encrypts the cookies of the tab, that the page keeps: `.env` can be in git.

The logs
:   What PHP writes on stderr goes to `console.warn()` (see
    [An application in a frame](../javascript-api/frame.md)). A file in `storage/logs/` would be
    gone with the page.

The sessions, and the cache
:   The `database` driver keeps the sessions in the database, with the rest. The `array` cache lasts
    as long as PHP runs: `database` keeps it too.

The queue, and the mails
:   There is no other process, nor network (see [Limitations](../reference/limitations.md)): the
    jobs run as they are dispatched, and the mails go to the logs.

## The database

Artisan creates the tables before the first request, with `runFile()`. `--force`: in production,
`migrate` asks for a confirmation, and `--no-interaction` cancels it.

```js
const php = await createPhpInWorker({ persist: '/pop-quiz' });
await php.runFile('/app/artisan', { args: ['migrate', '--force', '--no-interaction'] });
```

PHP starts again at each load of the page. In node, `migrate` takes 870 ms on an empty database, and
600 ms when there is nothing to migrate: the first request takes 225 ms after it, 605 ms without it,
as it compiles what artisan compiled. That is about 220 ms less, and the migrations only have to run
when the build has new ones: the page keeps their list next to the database, that takes 10 ms to
compare.

```js
// The migrations of the build, by their names, as artisan knows them
const migrations = "md5(implode(',', scandir('/app/database/migrations')))";
const { stdout: migrated } = await php.runCode(`echo (int) (${migrations} === @file_get_contents('/pop-quiz/migrations'));`);
if ('1' !== migrated) {
    const { exitCode, stdout } = await php.runFile('/app/artisan', { args: ['migrate', '--force', '--no-interaction'] });
    if (0 !== exitCode) {
        throw new Error(`artisan migrate exits with ${exitCode}: ${stdout}`);
    }
    await php.runCode(`file_put_contents('/pop-quiz/migrations', ${migrations});`);
}
```

`runFile()` resolves with the exit code of artisan, it does not reject: the list is only written
once the migrations ran. `migrate --seed` runs the seeders too: Pop Quiz has bots play its quizzes,
for the leaderboards, in a second more.

## Under a path

The application is under a path, `app/` next to the page (see
[An application in a frame](../javascript-api/frame.md)). Laravel takes it from
`$_SERVER['SCRIPT_NAME']`, as Symfony does: `url()`, `route()`, `asset()` and `to_route()` have
it.

- `url('/')` is the path without its slash, `…/app`: `php.request()` answers it with a 301 to
  `…/app/` (see [HTTP requests](../javascript-api/http.md)).
- `Route::redirect()` forgets it: its `Location` starts at the root of the origin, a 404. A
  closure redirects to the route instead.

```php
// routes/web.php: not Route::redirect('/blog', '/posts')
Route::get('/blog', static fn () => to_route('posts.index'));
```

## CSRF

Laravel 13 accepts a form whose `Sec-Fetch-Site` header is `same-origin`, without its token: a
service worker does not see this header, PHP does not get it. A form without the token is a 419:
`@csrf` gives it. `PreventRequestForgery::useOriginOnly()` would refuse every form.

The `XSRF-TOKEN` cookie is not in `document.cookie`: the browser drops what a service worker sets,
and the page keeps the cookies (see [An application in a frame](../javascript-api/frame.md)).
JavaScript that sends a request, as axios does with this cookie, gives the token in the
`X-CSRF-TOKEN` header, from a `<meta>`.

```blade
<meta name="csrf-token" content="{{ csrf_token() }}">
```

```js
fetch(url, { method: 'POST', headers: { 'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content } });
```

## Dates

A timestamp in milliseconds does not fit in an integer of the module (see
[Integers](../reference/limitations.md#integers)): `getTimestampMs()` of Carbon gives a wrong one.
Pop Quiz times the answers with `microtime(true)`, a float, in a `double` column.

## Show it

The application shows in a frame, PHP in the page, as a Symfony application does (see
[In a frame, PHP in the page](symfony.md#in-a-frame-php-in-the-page)): `public/index.php` is the
front controller.

```js
// index.html
import { createPhpInWorker, serveInFrame } from './build/php-web.mjs';

const php = await createPhpInWorker({ persist: '/pop-quiz' });
// The migrations, see above

await serveInFrame(php, { frame: document.getElementById('frame'), documentRoot: '/app/public' });
```

```js
// sw.js
importScripts('./build/php-sw.js');

forwardToPhp();
```

Pop Quiz only shows it in a frame: on its own page, with PHP in the service worker, see
[A Symfony application](symfony.md#on-its-own-page-php-in-the-service-worker).

## What there is not

The network, for the HTTP client, a mail server, Redis or broadcasting, nor another process (see
[Limitations](../reference/limitations.md)).
