// What the two service workers have in common: the one of serveInFrame(), in
// php-sw.js, that hands the requests to the page, and the one of
// serveInServiceWorker(), in php-web.mjs, that runs PHP itself. Both answer
// what is asked for in their scope, as a web server would.
//
// The build for the web puts it in both: before docker/php-sw.js, a classic
// script that a service worker imports, and in php-web.mjs, at its top level,
// with --extern-post-js. No export, and names that the sw.js of a project does
// not have: in a classic script, its functions are globals.

/**
 * Answers what is asked for in the scope of the service worker, but its files,
 * with what answer() resolves with. The service worker takes the pages of its
 * scope as soon as it is activated, a new version too.
 *
 * @param {string[]} except what is in the scope and needs no PHP, relative to
 *                          the service worker: files of the website
 * @param {(request: Request) => Promise<Response>} answer
 */
function answerInScope(except, answer) {
    const scope = self.registration.scope;
    const files = except.map((path) => new URL(path, self.location).href);

    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener('fetch', (event) => {
        // With the origin: what is asked for elsewhere is not for PHP
        const { url } = event.request;
        if (url.startsWith(scope) && !files.some((file) => url.startsWith(file))) {
            // A header that a Response refuses, PHP that aborts…
            event.respondWith(answer(event.request).catch((error) => {
                console.error(error);

                return errorResponse(`The request fails: ${error.message}`);
            }));
        }
    });
}

/**
 * What php.request() takes, from what the browser asks for.
 */
async function requestForPhp(request) {
    const headers = [...request.headers];
    // What a browser sends, that a service worker does not see as a header:
    // the stateless CSRF protection of Symfony checks it
    if (!request.headers.has('Referer') && request.referrer.startsWith(self.location.origin)) {
        headers.push(['Referer', request.referrer]);
    }

    return {
        method: request.method,
        url: request.url,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? '' : await request.arrayBuffer(),
    };
}

/**
 * The response for the browser, from what php.request() resolves with.
 */
function responseFromPhp(request, { status, headers, body }) {
    // A redirection, that the browser follows
    const location = headers.find(([name]) => 'location' === name.toLowerCase())?.[1];
    if (undefined !== location && [301, 302, 303, 307, 308].includes(status)) {
        return Response.redirect(new URL(location, request.url), status);
    }

    // They have no body, even when PHP writes one
    return new Response([204, 205, 304].includes(status) ? null : body, { status, headers });
}

function errorResponse(message) {
    return new Response(message, { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
