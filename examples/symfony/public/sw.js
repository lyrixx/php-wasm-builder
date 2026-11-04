// The service worker of index.html: it takes what its frame asks for, under
// app/, to index.html, whose worker runs the Symfony application in PHP, and
// answers with what PHP answers. It runs no PHP: a browser stops a service
// worker that has nothing to do, and PHP would forget its files.

const app = new URL('app/', self.location).pathname;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    // What the frame asks for out of app/ is not for PHP
    if (new URL(event.request.url).pathname.startsWith(app)) {
        event.respondWith(forward(event.request));
    }
});

async function forward(request) {
    // index.html is not in the scope of the service worker
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const page = pages.find((client) => !new URL(client.url).pathname.startsWith(app));
    if (undefined === page) {
        return new Response('PHP runs in the page of the example: open it, not its frame.', { status: 503 });
    }

    const headers = [...request.headers];
    // What a browser sends, that a service worker does not see as a header:
    // the stateless CSRF protection of Symfony checks it
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

    // The browser drops Set-Cookie from it: index.html keeps the cookies
    return new Response([204, 304].includes(status) ? null : body, { status, headers: responseHeaders });
}
