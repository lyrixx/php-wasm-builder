// serveInFrame(): a PHP application in an <iframe>. A service worker, whose
// script loads php-sw.js, hands what the frame asks for to the page, that runs
// it with php.request(). See docs/javascript-api/frame.md.
//
// Given to emcc with --extern-post-js, for the build for the web only, as
// worker.js. It also has the cookies of the application, that a service worker
// that runs PHP itself needs too.

/**
 * Starts the service worker, runs what it hands over, then opens the frame. The
 * promise is rejected when the service worker does not start: the frame says
 * why, the browser would leave it white.
 */
export async function serveInFrame(php, { frame, documentRoot, under = 'app/', start = '', headers = {} }) {
    if (!under.endsWith('/')) {
        throw new TypeError(`The under option of serveInFrame() must end with a slash, "${under}" does not.`);
    }

    const app = new URL(under, document.baseURI);
    // Where the application is: the pages of an origin share their
    // localStorage, on github.io the ones of every repository
    const cookiesKey = `php cookies ${app.pathname}`;
    // Read at each use: another tab of the page may have changed them, and
    // this one may run several requests at a time
    const storedCookies = () => new Map(JSON.parse(localStorage.getItem(cookiesKey) ?? '[]'));

    const answer = async ({ data: request, ports: [port] }) => {
        // A message of the page, or of another application of the page
        if (!request?.url?.startsWith(app.href)) {
            return;
        }

        try {
            const response = await php.request(
                { ...request, headers: [...withCookies(request.headers, storedCookies()), ...new Headers(headers)] },
                { documentRoot, basePath: app.pathname.slice(0, -1) },
            );
            const cookies = storedCookies();
            keepCookies(cookies, response.headers);
            localStorage.setItem(cookiesKey, JSON.stringify([...cookies]));
            // What Symfony logs
            if ('' !== response.stderr) {
                console.warn(response.stderr);
            }

            port.postMessage(response, [response.body.buffer]);
        } catch (error) {
            port.postMessage({ status: 500, headers: [['Content-Type', 'text/plain']], body: `PHP failed: ${error.message}` });
            throw error;
        }
    };

    try {
        await startServiceWorker(under, answer);
    } catch (error) {
        const paragraph = document.createElement('p');
        paragraph.textContent = `The application does not start: ${error.message}`;
        frame.srcdoc = paragraph.outerHTML;
        throw error;
    }

    frame.src = new URL(start, app);
}

async function startServiceWorker(under, answer) {
    if (!('serviceWorker' in navigator)) {
        throw new Error('This browser has no service worker here: it takes HTTPS, or localhost, and some browsers have none in a private window.');
    }

    navigator.serviceWorker.addEventListener('message', answer);

    // Without updateViaCache, the browser takes an imported script, php-sw.js
    // once a project updates, from its HTTP cache
    const registration = await navigator.serviceWorker.register('sw.js', { scope: under, updateViaCache: 'none' });
    // register() does not look for a new version: the browser does it after a
    // navigation in the scope, the frame would load with the old one
    if (null !== registration.active) {
        await registration.update().catch((error) => console.warn(`The service worker stays as it is: ${error.message}`));
    }

    await serviceWorkerActivated(registration);
}

// Not navigator.serviceWorker.ready: the page is out of the scope, it never
// resolves
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

// The cookies of the application: the browser drops the Set-Cookie of a
// response that a service worker makes, so what runs PHP keeps them, and gives
// them back to each request. Only their names and values: they are all for
// the application.

/**
 * @param {Map<string, string>} cookies     the cookies, by name
 * @param {Array<[string, string]>} headers what PHP answers
 */
export function keepCookies(cookies, headers) {
    for (const [name, value] of headers) {
        if ('set-cookie' !== name.toLowerCase()) {
            continue;
        }

        const [pair, ...attributes] = value.split(';');
        const equals = pair.indexOf('=');
        // PHP and Symfony delete a cookie with Max-Age=0
        if (attributes.some((attribute) => /^\s*max-age\s*=\s*0\s*$/i.test(attribute))) {
            cookies.delete(pair.slice(0, equals).trim());
        } else {
            cookies.set(pair.slice(0, equals).trim(), pair.slice(equals + 1).trim());
        }
    }
}

/**
 * The headers of a request, with the cookies instead of the ones the browser
 * sends.
 *
 * @param {Array<[string, string]>} headers
 * @param {Map<string, string>} cookies
 */
export function withCookies(headers, cookies) {
    const withoutCookies = headers.filter(([name]) => 'cookie' !== name.toLowerCase());

    return 0 === cookies.size
        ? withoutCookies
        : [...withoutCookies, ['Cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')]];
}
