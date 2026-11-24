// What the two service workers have in common: the one of serveInFrame(), in
// php-sw.js, that hands the requests to the page, and the one of
// serveInServiceWorker(), in php-web.mjs, that runs PHP itself. Both answer
// what is asked for in their scope, as a web server would.
//
// The build for the web puts it in both: before docker/php-sw.js, a classic
// script that a service worker imports, and in php-web.mjs, at its top level,
// with --extern-post-js. No export, and names that the sw.js of a project does
// not have: in a classic script, its functions are globals.

// What a browser takes as the script of a service worker, the JavaScript MIME
// types of the MIME Sniffing standard: it refuses any other
const SERVICE_WORKER_SCRIPT_TYPES = [
    'application/ecmascript',
    'application/javascript',
    'application/x-ecmascript',
    'application/x-javascript',
    'text/ecmascript',
    'text/javascript',
    'text/javascript1.0',
    'text/javascript1.1',
    'text/javascript1.2',
    'text/javascript1.3',
    'text/javascript1.4',
    'text/javascript1.5',
    'text/jscript',
    'text/livescript',
    'text/x-ecmascript',
    'text/x-javascript',
];
// The navigation waits for the check: a server that hangs keeps the service
// worker, as one that fails
const SERVICE_WORKER_SCRIPT_CHECK_TIMEOUT_IN_MS = 3000;

/**
 * Answers what is asked for in the scope of the service worker, but its files,
 * with what answer() resolves with. The service worker takes the pages of its
 * scope as soon as it is activated, a new version too, and leaves them once
 * its script is gone.
 *
 * @param {string[]} except what is in the scope and needs no PHP, relative to
 *                          the service worker: files of the website
 * @param {(request: Request) => Promise<Response>} answer
 */
function answerInScope(except, answer) {
    // serveInFrame() gives the application without its slash: its URL without
    // it is in the scope, as the url('/') of Laravel gives it, and so is what
    // only starts like it, as app.css, that is not for PHP. Keep in sync with
    // serveInFrame(), in frame.js
    const root = self.registration.scope.replace(/\/?$/, '/');
    const inScope = (url) => url.startsWith(root) || url.split('?')[0] === root.slice(0, -1);
    const files = except.map((path) => new URL(path, self.location).href);

    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener('fetch', (event) => {
        // With the origin: what is asked for elsewhere is not for PHP
        const { url } = event.request;
        if (inScope(url) && !files.some((file) => url.startsWith(file))) {
            // A header that a Response refuses, PHP that aborts…
            event.respondWith(answerUnlessScriptIsGone(event.request, answer).catch((error) => {
                console.error(error);

                return errorResponse(`The request fails: ${error.message}`);
            }));
        }
    });
}

/**
 * Unregisters the service worker at a navigation once its script is gone: a
 * project that removed it, or another project served on the origin since, as
 * 127.0.0.1:8000 on a development machine. The browser keeps a service worker
 * whose script does not update, and it would answer the page that could
 * unregister it. Before PHP starts: it would start with the files of the other
 * project.
 */
async function answerUnlessScriptIsGone(request, answer) {
    if ('navigate' !== request.mode || !await isScriptGone()) {
        return answer(request);
    }

    await self.registration.unregister();
    console.warn(`The service worker is unregistered: its script, ${self.location.href}, is gone.`);

    // Not fetch(request): the page would be controlled, and what it loads
    // would come here. The browser follows the redirection to the server,
    // without a service worker. A 302: a form is not sent again, to what may
    // be another project
    return Response.redirect(request.url, 302);
}

/**
 * Whether the browser would refuse the script of the service worker now: not
 * there, not JavaScript, as the index.html that `php -S` answers for a file it
 * does not have, or redirected. Not when the network or the server fails: the
 * script may still be there.
 */
async function isScriptGone() {
    const signal = AbortSignal.timeout(SERVICE_WORKER_SCRIPT_CHECK_TIMEOUT_IN_MS);
    let response;
    try {
        response = await fetch(self.location.href, { cache: 'no-store', redirect: 'manual', signal });
    } catch (error) {
        console.warn(`The service worker can not check that its script is still there: ${error.message}`);

        return false;
    }

    if ('opaqueredirect' === response.type || [404, 410].includes(response.status)) {
        return true;
    }
    const type = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();

    return response.ok && !SERVICE_WORKER_SCRIPT_TYPES.includes(type);
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
