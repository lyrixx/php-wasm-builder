// forwardToPhp(): the service worker of serveInFrame(), in docker/frame.js. It
// takes what the frame asks for to the page, that runs PHP, and answers with
// what PHP answers. It runs no PHP: PHP runs as long as the page is open, where
// a browser stops a service worker that has nothing to do. See
// docs/javascript-api/frame.md, and serveInServiceWorker() for PHP in the
// service worker.
//
// The build for the web puts it next to php-web.mjs, after sw-common.js, in a
// function: only forwardToPhp() is a global of the script of the project,
// that imports it, and is what the browser registers. A service worker only
// controls the URLs under its own directory, and GitHub Pages does not send the
// Service-Worker-Allowed header that lifts this.

// How long a page has to take a request: one that is still starting PHP never
// does, nor one whose PHP runs in the main thread for longer
const PAGE_TAKES_REQUEST_TIMEOUT_IN_MS = 10000;

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
        const pages = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
            .filter((client) => [index, `${index}index.html`].includes(new URL(client.url).pathname));
        if (0 === pages.length) {
            return new Response('PHP runs in the page of the application: open it, not its frame.', { status: 503 });
        }

        const phpRequest = await requestForPhp(request);
        for (const page of pages) {
            const response = await askPage(page, phpRequest);
            if (undefined !== response) {
                // The browser drops Set-Cookie from it: the page keeps the cookies
                return responseFromPhp(request, response);
            }
        }

        return new Response('No page of the application takes the request: they are still starting PHP.', { status: 503 });
    });
}

/**
 * What a page answers, once it has taken the request, or undefined when it
 * does not take it in time.
 */
function askPage(page, phpRequest) {
    const answer = new MessageChannel();
    const taken = new MessageChannel();

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.warn(`A page of the application does not take ${phpRequest.url} within ${PAGE_TAKES_REQUEST_TIMEOUT_IN_MS / 1000} s: it is still starting PHP.`);
            resolve();
        }, PAGE_TAKES_REQUEST_TIMEOUT_IN_MS);
        taken.port1.onmessage = () => clearTimeout(timeout);
        // The page of a version before 1.0.0 answers without taking it first
        answer.port1.onmessage = ({ data }) => {
            clearTimeout(timeout);
            resolve(data);
        };
        page.postMessage(phpRequest, [answer.port2, taken.port2]);
    });
}

self.forwardToPhp = forwardToPhp;
