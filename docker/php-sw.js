// forwardToPhp(): the service worker of serveInFrame(), in docker/frame.js. It
// takes what the frame asks for to the page, that runs PHP, and answers with
// what PHP answers. It runs no PHP: a browser stops a service worker that has
// nothing to do, and PHP would forget its files. See
// docs/javascript-api/frame.md.
//
// The build for the web copies it next to php-web.mjs. A script of the project
// imports it, and is what the browser registers: a service worker only controls
// the URLs under its own directory, and GitHub Pages does not send the
// Service-Worker-Allowed header that lifts this.

/**
 * Takes what is asked for under a directory to the page. Both are relative to
 * the service worker, as the page is: `index.html`, next to it.
 *
 * To call as the script is first evaluated: the browser ignores a listener
 * added later.
 *
 * @param {string}   under  the directory of the application, as serveInFrame() has it
 * @param {string[]} except what is in it, and needs no PHP: files of the website
 */
function forwardToPhp({ under = 'app/', except = [] } = {}) {
    const app = new URL(under, self.location).href;
    const files = except.map((path) => new URL(path, self.location).href);
    const index = new URL('./', self.location).pathname;

    if (app !== self.registration.scope) {
        throw new Error(`forwardToPhp() takes what is under ${app}, and serveInFrame() registers it for ${self.registration.scope}: give both the same under option.`);
    }

    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener('fetch', (event) => {
        // With the origin: what the frame asks for elsewhere is not for PHP
        const { url } = event.request;
        if (url.startsWith(app) && !files.some((file) => url.startsWith(file))) {
            // A header that a Response refuses, for example
            event.respondWith(forward(event.request).catch((error) => new Response(`The browser refuses what PHP answers: ${error.message}`, { status: 500 })));
        }
    });

    async function forward(request) {
        // The page is not in the scope of the service worker. The other pages
        // of the origin are clients too: on github.io, the ones of every
        // repository
        const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const page = pages.find((client) => [index, `${index}index.html`].includes(new URL(client.url).pathname));
        if (undefined === page) {
            return new Response('PHP runs in the page of the application: open it, not its frame.', { status: 503 });
        }

        const headers = [...request.headers];
        // What a browser sends, that a service worker does not see as a
        // header: the stateless CSRF protection of Symfony checks it
        if (!request.headers.has('Referer') && request.referrer.startsWith(self.location.origin)) {
            headers.push(['Referer', request.referrer]);
        }

        const { port1, port2 } = new MessageChannel();
        const answer = new Promise((resolve) => {
            port1.onmessage = (event) => resolve(event.data);
        });
        page.postMessage({
            method: request.method,
            url: request.url,
            headers,
            body: ['GET', 'HEAD'].includes(request.method) ? '' : await request.arrayBuffer(),
        }, [port2]);
        const { status, headers: responseHeaders, body } = await answer;

        // A redirection, that the browser follows in the frame
        const location = responseHeaders.find(([name]) => 'location' === name.toLowerCase())?.[1];
        if (undefined !== location && [301, 302, 303, 307, 308].includes(status)) {
            return Response.redirect(new URL(location, request.url), status);
        }

        // The browser drops Set-Cookie from it: the page keeps the cookies
        return new Response([204, 205, 304].includes(status) ? null : body, { status, headers: responseHeaders });
    }
}
