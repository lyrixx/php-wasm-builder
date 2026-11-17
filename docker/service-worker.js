// serveInServiceWorker(): PHP in a service worker, the web server of the
// application, and startServiceWorker(), for the page that registers it. The
// application is on its own page, with its URLs, its history and its reloads,
// as any website. See docs/javascript-api/service-worker.md.
//
// Given to emcc with --extern-post-js, for the build for the web only, after
// frame.js, whose cookies it keeps too, and sw-common.js.

// Where the service worker keeps the cookies: it has no localStorage. The pages
// of an origin share its caches, on github.io the ones of every repository:
// the key is the scope of the service worker
const COOKIES_CACHE = 'php cookies';

/**
 * Answers what is asked for in the scope of the service worker, but its files,
 * with what PHP answers.
 *
 * To call as the script is first evaluated: the browser ignores a listener
 * added later. PHP starts with the first request: a service worker can not
 * wait at the top level of its module. The browser stops a service worker that
 * has nothing to do, and PHP with it: the next request starts PHP again.
 *
 * @param {() => Promise<object>} createApplication creates PHP, with createPhp(), and starts the application: the
 *                                                  first request waits for it, the next one calls it again when it fails
 * @param {string[]} except                         what is in the scope and needs no PHP, relative to the service
 *                                                  worker: files of the website
 * @param {object} headers                          headers to add to each request
 */
export function serveInServiceWorker(createApplication, { documentRoot, except = [], headers = {} } = {}) {
    if (undefined === documentRoot) {
        throw new TypeError('serveInServiceWorker() needs the documentRoot option, the directory that the URLs are the files of.');
    }

    const scope = self.registration.scope;
    const basePath = new URL(scope).pathname.slice(0, -1);
    const start = madeOnce(createApplication);
    const storedCookies = madeOnce(async () => {
        const stored = await caches.match(scope, { cacheName: COOKIES_CACHE });

        return new Map(undefined === stored ? [] : await stored.json());
    });

    answerInScope(except, async (request) => {
        let php;
        try {
            php = await start();
        } catch (error) {
            console.error(error);

            return errorResponse(`PHP does not start: ${error.message}`);
        }

        const cookies = await storedCookies();
        const phpRequest = await requestForPhp(request);
        const response = await php.request(
            { ...phpRequest, headers: [...withCookies(phpRequest.headers, cookies), ...new Headers(headers)] },
            { documentRoot, basePath },
        );
        // The browser drops the Set-Cookie of a response that a service worker
        // makes. Only when there is one: a page asks for many images
        if (response.headers.some(([name]) => 'set-cookie' === name.toLowerCase())) {
            keepCookies(cookies, response.headers);
            await (await caches.open(COOKIES_CACHE)).put(scope, Response.json([...cookies]));
        }
        // What Symfony logs
        if ('' !== response.stderr) {
            console.warn(response.stderr);
        }

        return responseFromPhp(request, response);
    });
}

/**
 * Registers the service worker of serveInServiceWorker(), a module, for its
 * directory, and resolves once it is activated: from then on, what the page
 * loads in its scope, its next reload too, is answered by PHP. The promise is
 * rejected when the service worker does not start.
 *
 * @param {string} script the service worker, relative to the page
 */
export async function startServiceWorker(script = 'sw.js') {
    // A module: it imports php-web.mjs. Without updateViaCache, the browser
    // takes it from its HTTP cache once a project updates
    const registration = await serviceWorkers().register(script, { type: 'module', updateViaCache: 'none' });

    await serviceWorkerActivated(registration);
}

function serviceWorkers() {
    if (!('serviceWorker' in navigator)) {
        throw new Error('This browser has no service worker here: it takes HTTPS, or localhost, and some browsers have none in a private window.');
    }

    return navigator.serviceWorker;
}

// Not navigator.serviceWorker.ready: it never resolves when the service worker
// does not install, nor for a page out of its scope
async function serviceWorkerActivated(registration) {
    const worker = registration.installing ?? registration.waiting ?? registration.active;
    if (null === worker) {
        throw new Error('The service worker does not install.');
    }
    if ('activated' === worker.state) {
        return;
    }

    await new Promise((resolve) => {
        worker.addEventListener('statechange', () => ['activated', 'redundant'].includes(worker.state) && resolve());
    });

    // Redundant: it failed, or a newer one from another tab replaced it
    await serviceWorkerActivated(registration);
}

/**
 * What the requests wait for, made by the first one, and again by the next one
 * when it fails.
 */
function madeOnce(make) {
    let made;

    return () => {
        if (undefined === made) {
            made = Promise.resolve().then(make);
            made.catch(() => {
                made = undefined;
            });
        }

        return made;
    };
}
