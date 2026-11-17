// The service worker of standalone/: the web server of the application. It
// runs PHP itself, and answers every request under standalone/ with what
// Symfony answers: the browser shows the application as any website, with its
// URLs, its history and its reloads.
//
// The browser stops a service worker that has nothing to do, and PHP with it:
// the next request starts PHP again, that finds its files in IndexedDB. The
// framed page, ../index.html, runs PHP in a worker of the page instead.

import createPhp, { serveInServiceWorker } from '../build/php-web.mjs';

serveInServiceWorker(async () => {
    // /symfony, where the database and the sessions are, is kept in
    // IndexedDB, and shared with the framed page. Keep in sync with
    // ../index.html, ../../app/.env and
    // ../../app/config/packages/framework.yaml
    const php = await createPhp({ persist: '/symfony' });
    // It compiles the container of Symfony too, that the requests use
    const { exitCode, stdout } = await php.runFile('/app/bin/console', { args: ['doctrine:schema:update', '--force', '--no-interaction'] });
    if (0 !== exitCode) {
        throw new Error(`The console exits with ${exitCode}: ${stdout}`);
    }

    return php;
}, {
    documentRoot: '/app/public',
    // What the About page of the application shows. Keep in sync with
    // ../../app/src/Controller/AboutController.php
    headers: { 'X-PHP-Runs-In': 'the service worker of the page, that answers every request' },
});
