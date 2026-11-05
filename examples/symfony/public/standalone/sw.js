// The service worker of standalone/: the web server of the application. It
// runs PHP itself, and answers every request under standalone/ with what
// Symfony answers: the browser shows the application as any website, with its
// URLs, its history and its reloads.
//
// The browser stops a service worker that has nothing to do, and PHP with it:
// the next request starts PHP again, that finds its files in IndexedDB. The
// framed page, ../index.html, runs PHP in a worker of the page instead.

import createPhp from '../build/php-web.mjs';
import { keepCookies, withCookies } from '../cookies.mjs';

// Where the application is in the URLs: the scope of this service worker
const base = new URL('./', self.location).pathname;
// Where the cookies are kept, see ../cookies.mjs
const cookieJar = new URL('cookies', self.location).href;

let started;
let cookies;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.origin === self.location.origin && url.pathname.startsWith(base)) {
        event.respondWith(serve(event.request));
    }
});

function start() {
    started ??= (async () => {
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
    })();
    // The next request tries again
    started.catch(() => {
        started = undefined;
    });

    return started;
}

async function serve(request) {
    let php;
    try {
        php = await start();
    } catch (error) {
        return new Response(`PHP does not start: ${error.message}`, { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }

    cookies ??= await caches.match(cookieJar).then((response) => response?.json()).then((pairs) => new Map(pairs ?? []));

    // What the About page of the application shows. Keep in sync with
    // ../../app/src/Controller/AboutController.php
    const headers = [...withCookies([...request.headers], cookies), ['X-PHP-Runs-In', 'the service worker of the page, that answers every request']];
    // What a browser sends, that a service worker does not see as a header:
    // the stateless CSRF protection of Symfony checks it
    if (!request.headers.has('Referer') && request.referrer.startsWith(self.location.origin)) {
        headers.push(['Referer', request.referrer]);
    }

    const response = await php.request({
        method: request.method,
        url: request.url,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? '' : await request.arrayBuffer(),
    }, { documentRoot: '/app/public', basePath: base.slice(0, -1) });

    keepCookies(cookies, response.headers);
    await (await caches.open('symfony')).put(cookieJar, Response.json([...cookies]));
    // What Symfony logs
    if ('' !== response.stderr) {
        console.warn(response.stderr);
    }

    // A redirection, that the browser follows
    const location = response.headers.find(([name]) => 'location' === name.toLowerCase())?.[1];
    if (undefined !== location && [301, 302, 303, 307, 308].includes(response.status)) {
        return Response.redirect(new URL(location, request.url), response.status);
    }

    return new Response([204, 304].includes(response.status) ? null : response.body, { status: response.status, headers: response.headers });
}
