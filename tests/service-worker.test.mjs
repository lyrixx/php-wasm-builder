import assert from 'node:assert/strict';
import path from 'node:path';
import { before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { browser, container, directory, registered, worker } from './browser.mjs';

// The tests of what runs PHP in a service worker, serveInServiceWorker(), and
// of startServiceWorker(), for its page, on the build for the web of the
// default stack unless BUILD says which. A build for node has none of it:
//
//     BUILD=build/php-8.6/php-web.mjs node --import ./node/fetch-files.mjs --test tests/service-worker.test.mjs
//
// node has no service worker: they run PHP in a fake one, that only does what
// their code asks. What a browser does with a service worker is not tested
// here.

const build = process.env.BUILD ? pathToFileURL(path.resolve(process.env.BUILD)) : new URL('../build/php-8.6/php-web.mjs', import.meta.url);
const isWeb = build.pathname.endsWith('/php-web.mjs');
const webTest = (name, callback) => test(name, { skip: !isWeb && 'only the build for the web has it' }, callback);

const scope = `${directory}standalone/`;

let php;
let serveInServiceWorker;
let startServiceWorker;
before(async () => {
    let createPhp;
    ({ default: createPhp, serveInServiceWorker, startServiceWorker } = await import(build));
    if (!isWeb) {
        return;
    }

    php = await createPhp();
    php.FS.mkdirTree('/site');
    php.FS.writeFile('/site/index.php', `<?php
        if (isset($_GET['status'])) {
            http_response_code((int) $_GET['status']);
            if (isset($_GET['location'])) {
                header('Location: ' . $_GET['location']);
            }
            echo 'A body';

            return;
        }
        if (isset($_GET['emoji'])) {
            header('X-Emoji: 🐘');
        }
        setcookie('visits', ($_COOKIE['visits'] ?? 0) + 1);
        error_log('A log.');
        echo json_encode([
            'added' => $_SERVER['HTTP_X_ADDED'] ?? null,
            'body' => file_get_contents('php://input'),
            'cookies' => $_COOKIE,
            'method' => $_SERVER['REQUEST_METHOD'],
            'referer' => $_SERVER['HTTP_REFERER'] ?? null,
            'script' => $_SERVER['SCRIPT_NAME'],
        ]);
    `);
});

/**
 * The global scope of a service worker of standalone/, with the Cache API:
 * the caches are kept in storage, from a service worker to the next one, as
 * the browser does once it stopped one.
 */
function serviceWorkerScope(storage = new Map()) {
    const listeners = {};
    const calls = [];
    const self = {
        addEventListener: (type, listener) => {
            listeners[type] = listener;
        },
        clients: { claim: async () => calls.push('claim') },
        location: new URL(`${scope}sw.js`),
        registration: { scope, unregister: async () => calls.push('unregister') },
        skipWaiting: async () => calls.push('skipWaiting'),
    };
    const caches = {
        open: async (name) => ({
            put: async (key, response) => {
                calls.push('put');
                storage.set(name, new Map([...storage.get(name) ?? [], [String(key), await response.text()]]));
            },
        }),
        match: async (key, { cacheName }) => {
            const stored = storage.get(cacheName)?.get(String(key));

            return undefined === stored ? undefined : new Response(stored);
        },
    };
    for (const [name, value] of Object.entries({ caches, self })) {
        Object.defineProperty(globalThis, name, { value, configurable: true });
    }

    return {
        calls,
        listeners,
        // What it responds with, undefined when it leaves it to the network
        fetch(request) {
            let response;
            listeners.fetch({ request, respondWith: (answer) => response = answer });

            return response;
        },
    };
}

/**
 * A service worker of standalone/, that serves /site, as the browser starts
 * it.
 */
function served({ storage, createApplication = async () => php, options = {} } = {}) {
    const sw = serviceWorkerScope(storage);
    serveInServiceWorker(createApplication, { documentRoot: '/site', ...options });

    return sw;
}

const json = async (response) => (await response).json();

// What the browser asks for when a page loads, that a Request can not be made
// as
const navigation = (url) => Object.defineProperty(new Request(url), 'mode', { value: 'navigate' });

/**
 * What the server answers for the script of the service worker, that it asks
 * for with fetch().
 */
const serving = (t, script) => t.mock.method(globalThis, 'fetch', async () => script());
const javascript = (type = 'text/javascript') => () => new Response('', { headers: { 'Content-Type': type } });

webTest('serveInServiceWorker() adds its listeners as it is called, and takes the pages as soon as it is activated', async () => {
    const sw = served();

    assert.deepEqual(Object.keys(sw.listeners).sort(), ['activate', 'fetch', 'install']);

    sw.listeners.install({});
    let activated;
    sw.listeners.activate({ waitUntil: (promise) => activated = promise });
    await activated;
    assert.deepEqual(sw.calls, ['skipWaiting', 'claim']);
});

webTest('serveInServiceWorker() refuses to start without documentRoot', () => {
    serviceWorkerScope();

    assert.throws(() => serveInServiceWorker(async () => php, {}), /needs the documentRoot option/);
});

webTest('serveInServiceWorker() answers what is in its scope with PHP, at its path, except the files of the website', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const sw = served({ options: { except: ['bundles/'] } });

    assert.equal((await json(sw.fetch(new Request(`${scope}guestbook?page=2`)))).script, '/repository/standalone/index.php');
    assert.equal(sw.fetch(new Request(`${scope}bundles/style.css`)), undefined);
    assert.equal(sw.fetch(new Request(`${directory}index.html`)), undefined);
    // The same path, on another origin
    assert.equal(sw.fetch(new Request(`https://cdn.example.com/repository/standalone/`)), undefined);
});

webTest('serveInServiceWorker() starts the application with the first request, once, and again when it failed', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const error = t.mock.method(console, 'error', () => {});
    let starts = 0;
    const sw = served({
        createApplication: async () => {
            if (1 === ++starts) {
                throw new Error('The database is locked.');
            }

            return php;
        },
    });
    assert.equal(starts, 0);

    const failed = await sw.fetch(new Request(scope));
    assert.equal(failed.status, 500);
    assert.equal(await failed.text(), 'PHP does not start: The database is locked.');
    assert.equal(error.mock.callCount(), 1);

    const responses = await Promise.all([sw.fetch(new Request(scope)), sw.fetch(new Request(scope))]);
    assert.deepEqual(responses.map(({ status }) => status), [200, 200]);
    assert.equal(starts, 2);
});

webTest('serveInServiceWorker() hands PHP the method, the headers, the body, and the headers of its options', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const sw = served({ options: { headers: { 'X-Added': 'by the service worker' } } });

    const answer = await json(sw.fetch(new Request(`${scope}sign`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'Hello' })));

    assert.equal(answer.method, 'POST');
    assert.equal(answer.body, 'Hello');
    assert.equal(answer.added, 'by the service worker');
});

webTest('serveInServiceWorker() hands PHP the Referer that a service worker only sees as a property, of the origin only', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const sw = served();
    const withReferrer = (referrer) => Object.defineProperty(new Request(scope), 'referrer', { value: referrer });

    assert.equal((await json(sw.fetch(withReferrer(`${scope}form`)))).referer, `${scope}form`);
    assert.equal((await json(sw.fetch(withReferrer('https://example.com/form')))).referer, null);
});

webTest('serveInServiceWorker() keeps the cookies in the Cache API, for its scope, only when PHP sets one, and finds them once the browser started it again', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const storage = new Map();
    const sw = served({ storage });

    // The browser does not send them: they are the ones the service worker keeps
    assert.deepEqual((await json(sw.fetch(new Request(scope, { headers: { Cookie: 'browser=1' } })))).cookies, []);
    assert.deepEqual((await json(sw.fetch(new Request(scope)))).cookies, { visits: '1' });
    await sw.fetch(new Request(`${scope}?status=204`));

    assert.equal(sw.calls.filter((call) => 'put' === call).length, 2);
    assert.deepEqual([...storage.get('php cookies')], [[scope, '[["visits","2"]]']]);

    const restarted = served({ storage });
    assert.deepEqual((await json(restarted.fetch(new Request(scope)))).cookies, { visits: '2' });
});

webTest('serveInServiceWorker() answers a redirection as a redirection, relative to the request', async () => {
    const sw = served();

    const response = await sw.fetch(new Request(`${scope}?status=303&location=/repository/standalone/thanks`));

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('Location'), `${scope}thanks`);
});

webTest('serveInServiceWorker() answers without a body when the status has none', async () => {
    const sw = served();

    for (const status of [204, 205, 304]) {
        const response = await sw.fetch(new Request(`${scope}?status=${status}`));

        assert.equal(response.status, status);
        assert.equal(response.body, null);
    }
});

webTest('serveInServiceWorker() gives what PHP logs to the console', async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const sw = served();

    await sw.fetch(new Request(scope));

    assert.match(warn.mock.calls[0].arguments[0], /A log\./);
});

webTest('serveInServiceWorker() says so when a Response can not have what PHP answers, in the console too', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const error = t.mock.method(console, 'error', () => {});
    const sw = served();

    const response = await sw.fetch(new Request(`${scope}?emoji`));

    assert.equal(response.status, 500);
    assert.match(await response.text(), /^The request fails: ./);
    assert.equal(error.mock.callCount(), 1);
});

webTest('serveInServiceWorker() checks at each navigation that its script is still there, without the HTTP cache, then answers with PHP', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const checks = serving(t, javascript());
    const sw = served();

    assert.equal((await json(sw.fetch(navigation(`${scope}guestbook`)))).script, '/repository/standalone/index.php');
    // What the page loads: its navigation checked it
    await json(sw.fetch(new Request(`${scope}guestbook?page=2`)));

    assert.equal(checks.mock.callCount(), 1);
    const [url, { signal, ...options }] = checks.mock.calls[0].arguments;
    assert.equal(url, `${scope}sw.js`);
    assert.deepEqual(options, { cache: 'no-store', redirect: 'manual' });
    // The navigation waits for it
    assert.ok(signal instanceof AbortSignal);
    assert.equal(sw.calls.includes('unregister'), false);
});

webTest('serveInServiceWorker() unregisters itself at a navigation once its script is gone, before PHP starts, and sends the navigation to the server', async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const gone = {
        'a 404': () => new Response('Not Found', { status: 404 }),
        'a 410': () => new Response('Gone', { status: 410 }),
        // What php -S answers for a file it does not have: the index.html of
        // its directory
        'a page': () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html; charset=UTF-8' } }),
        'no type': () => new Response(null),
        // What fetch() resolves with, with redirect: 'manual'
        'a redirection': () => ({ type: 'opaqueredirect', status: 0, ok: false, headers: new Headers() }),
    };

    const server = serving(t, javascript());
    for (const [name, script] of Object.entries(gone)) {
        server.mock.mockImplementation(async () => script());
        let starts = 0;
        const sw = served({
            createApplication: async () => {
                ++starts;

                return php;
            },
        });

        const response = await sw.fetch(navigation(`${scope}guestbook?page=2`));

        assert.equal(response.status, 302, name);
        assert.equal(response.headers.get('Location'), `${scope}guestbook?page=2`, name);
        assert.deepEqual(sw.calls, ['unregister'], name);
        assert.equal(starts, 0, name);
    }
    assert.match(warn.mock.calls[0].arguments[0], /is unregistered: its script, .*\/standalone\/sw\.js, is gone\./);
});

webTest('serveInServiceWorker() goes on answering with any JavaScript type, offline, and when the server fails', async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const there = {
        'a JavaScript type': javascript('application/javascript; charset=utf-8'),
        'an older JavaScript type': javascript('text/ecmascript'),
        'offline': () => {
            throw new TypeError('Failed to fetch');
        },
        'a server that fails': () => new Response('Service Unavailable', { status: 503 }),
    };

    const server = serving(t, javascript());
    for (const [name, script] of Object.entries(there)) {
        server.mock.mockImplementation(async () => script());
        const sw = served();

        assert.equal((await json(sw.fetch(navigation(scope)))).script, '/repository/standalone/index.php', name);
        assert.equal(sw.calls.includes('unregister'), false, name);
    }
    assert.ok(warn.mock.calls.some((call) => /can not check that its script is still there: Failed to fetch/.test(call.arguments[0])));
});

webTest('startServiceWorker() registers the service worker as a module, without the HTTP cache, and resolves once it is activated', async () => {
    const installing = worker('installing');
    const serviceWorkerContainer = container(registered({ installing, active: null }));
    browser(serviceWorkerContainer);

    let resolved = false;
    const started = startServiceWorker().then(() => resolved = true);
    await new Promise(setImmediate);
    assert.equal(resolved, false);

    installing.become('activated');
    await started;
    assert.deepEqual(serviceWorkerContainer.calls, [['sw.js', { type: 'module', updateViaCache: 'none' }]]);
});

webTest('startServiceWorker() registers another script', async () => {
    const serviceWorkerContainer = container(registered());
    browser(serviceWorkerContainer);

    await startServiceWorker('demo/sw.js');

    assert.deepEqual(serviceWorkerContainer.calls, [['demo/sw.js', { type: 'module', updateViaCache: 'none' }]]);
});

webTest('startServiceWorker() rejects when the service worker does not install', async () => {
    const registration = registered({ installing: worker('installing'), active: null });
    browser(container(registration));

    const started = startServiceWorker();
    await new Promise(setImmediate);
    const failed = registration.installing;
    registration.installing = null;
    failed.become('redundant');

    await assert.rejects(started, /does not install/);
});

webTest('startServiceWorker() rejects when the browser has no service worker there', async () => {
    browser(undefined);

    await assert.rejects(startServiceWorker(), /HTTPS/);
});
