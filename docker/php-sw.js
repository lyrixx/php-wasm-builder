// forwardToPhp(): the service worker of serveInFrame(), in docker/frame.js. It
// takes what the frame asks for to the page, that runs PHP, and answers with
// what PHP answers. It runs no PHP: a browser stops a service worker that has
// nothing to do, and PHP would forget its files. See
// docs/javascript-api/frame.md.
//
// The build for the web puts it next to php-web.mjs, after sw-common.js. A
// script of the project imports it, and is what the browser registers: a
// service worker only controls the URLs under its own directory, and GitHub
// Pages does not send the Service-Worker-Allowed header that lifts this.

/**
 * Takes what is asked for in its scope, where serveInFrame() registers it, to
 * the page: `index.html`, next to it.
 *
 * To call as the script is first evaluated: the browser ignores a listener
 * added later.
 *
 * @param {string[]} except what is in the scope and needs no PHP, relative to the
 *                          service worker: files of the website
 */
function forwardToPhp({ except = [] } = {}) {
    const index = new URL('./', self.location).pathname;

    answerInScope(except, async (request) => {
        // The page is not in the scope of the service worker. The other pages
        // of the origin are clients too: on github.io, the ones of every
        // repository
        const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const page = pages.find((client) => [index, `${index}index.html`].includes(new URL(client.url).pathname));
        if (undefined === page) {
            return new Response('PHP runs in the page of the application: open it, not its frame.', { status: 503 });
        }

        const { port1, port2 } = new MessageChannel();
        const answer = new Promise((resolve) => {
            port1.onmessage = (event) => resolve(event.data);
        });
        page.postMessage(await requestForPhp(request), [port2]);

        // The browser drops Set-Cookie from it: the page keeps the cookies
        return responseFromPhp(request, await answer);
    });
}
