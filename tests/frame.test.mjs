import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

// The tests of what shows an application in a frame, serveInFrame() and
// php-sw.js, on the build for the web of the default stack unless BUILD says
// which. A build for node has none of it:
//
//     BUILD=build/php-8.5/php-web.mjs node --import ./node/fetch-files.mjs --test tests/frame.test.mjs
//
// node has no service worker: they run against a fake browser, that only says
// what its code asks. What a browser does with a service worker is not tested
// here.

const build = process.env.BUILD ? pathToFileURL(path.resolve(process.env.BUILD)) : new URL('../build/php-8.5/php-web.mjs', import.meta.url);
const isWeb = build.pathname.endsWith('/php-web.mjs');
const webTest = (name, callback) => test(name, { skip: !isWeb && 'only the build for the web has it' }, callback);

const origin = 'https://lyrixx.github.io';
const directory = `${origin}/repository/`;
const app = `${directory}app/`;

let createPhp;
let keepCookies;
let serveInFrame;
let withCookies;
before(async () => {
    ({ default: createPhp, keepCookies, serveInFrame, withCookies } = await import(build));
});

webTest('keepCookies() keeps the names and the values of what PHP sets, and forgets what it deletes', () => {
    const cookies = new Map([['old', '1'], ['theme', 'light']]);

    keepCookies(cookies, [
        ['Content-Type', 'text/html'],
        ['Set-Cookie', 'PHPSESSID=a=b; path=/; HttpOnly'],
        ['set-cookie', 'theme=dark'],
        ['Set-Cookie', 'old=deleted; expires=Thu, 01 Jan 1970 00:00:01 GMT; Max-Age=0'],
    ]);

    assert.deepEqual([...cookies], [['theme', 'dark'], ['PHPSESSID', 'a=b']]);
});

webTest('withCookies() replaces the cookies that the browser sends', () => {
    const headers = [['Accept', '*/*'], ['Cookie', 'browser=1']];

    assert.deepEqual(withCookies(headers, new Map([['a', '1'], ['b', '2']])), [['Accept', '*/*'], ['Cookie', 'a=1; b=2']]);
    assert.deepEqual(withCookies(headers, new Map()), [['Accept', '*/*']]);
});

/**
 * Evaluates php-sw.js as a service worker of the directory, for the application
 * in app/, with these clients.
 */
async function serviceWorker({ pages = [], options = {}, scope = app } = {}) {
    const listeners = {};
    const self = {
        addEventListener: (type, listener) => {
            listeners[type] = listener;
        },
        clients: { matchAll: async () => pages },
        location: new URL(`${directory}sw.js`),
        registration: { scope },
    };
    // What the service worker needs of it, synchronous
    class MessageChannel {
        port1 = {};
        port2 = { postMessage: (data) => this.port1.onmessage({ data }) };
    }
    const context = vm.createContext({ MessageChannel, Response, URL, self });
    vm.runInContext(await readFile(new URL('php-sw.js', build), 'utf8'), context);
    context.forwardToPhp(options);

    return {
        listeners,
        // What it responds with, undefined when it leaves it to the network
        fetch(request) {
            let response;
            listeners.fetch({ request, respondWith: (answer) => response = answer });

            return response;
        },
    };
}

function page(url, answer = () => ({ status: 200, headers: [], body: 'From PHP' })) {
    return {
        url,
        requests: [],
        postMessage(request, [port]) {
            this.requests.push(structuredClone(request));
            port.postMessage(answer(request));
        },
    };
}

webTest('forwardToPhp() adds its listeners as it is called', async () => {
    const { listeners } = await serviceWorker();

    assert.deepEqual(Object.keys(listeners).sort(), ['activate', 'fetch', 'install']);
});

webTest('forwardToPhp() takes what is under the application to the page, except the files of the website', async () => {
    const sw = await serviceWorker({ pages: [page(directory)], options: { except: ['app/bundles/'] } });

    assert.equal(await (await sw.fetch(new Request(`${app}admin`))).text(), 'From PHP');
    assert.equal(sw.fetch(new Request(`${app}bundles/style.css`)), undefined);
    assert.equal(sw.fetch(new Request(`${directory}index.html`)), undefined);
    // The same path, on another origin
    assert.equal(sw.fetch(new Request(`https://cdn.example.com/repository/app/admin`)), undefined);
});

webTest('forwardToPhp() takes what is in the scope that serveInFrame() gives it', async () => {
    const sw = await serviceWorker({ pages: [page(directory)], scope: `${directory}site/` });

    assert.equal(await (await sw.fetch(new Request(`${directory}site/admin`))).text(), 'From PHP');
    assert.equal(sw.fetch(new Request(`${app}admin`)), undefined);
});

webTest('forwardToPhp() only hands over to the page next to it: others are clients too', async () => {
    const elsewhere = [page(`${origin}/other-repository/`), page(`${directory}standalone/`), page(`${app}admin`)];
    const nextToIt = page(`${directory}index.html`);

    const alone = await (await serviceWorker({ pages: elsewhere })).fetch(new Request(app));
    assert.equal(alone.status, 503);
    assert.match(await alone.text(), /open it, not its frame/);

    await (await serviceWorker({ pages: [...elsewhere, nextToIt] })).fetch(new Request(app));
    assert.equal(nextToIt.requests.length, 1);
    assert.deepEqual(elsewhere.flatMap(({ requests }) => requests), []);
});

webTest('forwardToPhp() hands over the method, the URL, the headers and the body', async () => {
    const receiver = page(directory);
    const sw = await serviceWorker({ pages: [receiver] });

    await sw.fetch(new Request(`${app}sign?page=2`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'Hello' }));

    const [request] = receiver.requests;
    assert.equal(request.method, 'POST');
    assert.equal(request.url, `${app}sign?page=2`);
    assert.deepEqual(request.headers, [['content-type', 'text/plain']]);
    assert.equal(new TextDecoder().decode(request.body), 'Hello');
});

webTest('forwardToPhp() hands over the Referer that a service worker only sees as a property, of the origin only', async () => {
    const receiver = page(directory);
    const sw = await serviceWorker({ pages: [receiver] });
    const withReferrer = (referrer) => Object.defineProperty(new Request(app), 'referrer', { value: referrer });

    await sw.fetch(withReferrer(`${app}form`));
    await sw.fetch(withReferrer('https://example.com/form'));

    assert.deepEqual(receiver.requests[0].headers, [['Referer', `${app}form`]]);
    assert.deepEqual(receiver.requests[1].headers, []);
});

webTest('forwardToPhp() answers a redirection as a redirection, relative to the request', async () => {
    const sw = await serviceWorker({ pages: [page(directory, () => ({ status: 303, headers: [['Location', '/repository/app/thanks']], body: new Uint8Array() }))] });

    const response = await sw.fetch(new Request(`${app}sign`));

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('Location'), `${app}thanks`);
});

webTest('forwardToPhp() answers without a body when the status has none', async () => {
    for (const status of [204, 205, 304]) {
        const sw = await serviceWorker({ pages: [page(directory, () => ({ status, headers: [], body: new Uint8Array() }))] });
        const response = await sw.fetch(new Request(app));

        assert.equal(response.status, status);
        assert.equal(response.body, null);
    }
});

webTest('forwardToPhp() says so when a Response can not have what PHP answers', async () => {
    const sw = await serviceWorker({ pages: [page(directory, () => ({ status: 200, headers: [['X-Emoji', '🐘']], body: new Uint8Array() }))] });

    const response = await sw.fetch(new Request(app));

    assert.equal(response.status, 500);
    assert.match(await response.text(), /refuses what PHP answers/);
});

/**
 * A browser with this service worker container, for a page of the directory.
 * The storage is what localStorage has.
 */
function browser(serviceWorkerContainer) {
    const storage = new Map();
    const globals = {
        document: {
            baseURI: directory,
            createElement: () => ({
                set textContent(text) {
                    this.outerHTML = `<p>${text}</p>`;
                },
            }),
        },
        localStorage: {
            getItem: (key) => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value),
        },
        navigator: { ...(undefined === serviceWorkerContainer ? {} : { serviceWorker: serviceWorkerContainer }) },
    };
    for (const [name, value] of Object.entries(globals)) {
        Object.defineProperty(globalThis, name, { value, configurable: true });
    }

    return storage;
}

function worker(state) {
    return Object.assign(new EventTarget(), {
        state,
        become(newState) {
            this.state = newState;
            this.dispatchEvent(new Event('statechange'));
        },
    });
}

function container(registration) {
    return {
        calls: [],
        listeners: [],
        addEventListener(type, listener) {
            this.listeners.push(listener);
        },
        async register(...args) {
            this.calls.push(args);

            return registration;
        },
    };
}

const registered = (changes = {}) => ({ installing: null, waiting: null, active: worker('activated'), update: async () => {}, ...changes });

webTest('serveInFrame() registers sw.js for the application, without the HTTP cache, then opens the frame', async () => {
    const serviceWorkerContainer = container(registered());
    browser(serviceWorkerContainer);
    const frame = {};

    await serveInFrame({}, { frame, documentRoot: '/app/public' });

    assert.deepEqual(serviceWorkerContainer.calls, [['sw.js', { scope: 'app/', updateViaCache: 'none' }]]);
    assert.equal(String(frame.src), app);
});

webTest('serveInFrame() opens the frame at start, under another directory', async () => {
    browser(container(registered()));
    const frame = {};

    await serveInFrame({}, { frame, documentRoot: '/app/public', under: 'site/', start: 'admin?page=2' });

    assert.equal(String(frame.src), `${directory}site/admin?page=2`);
});

webTest('serveInFrame() refuses an under option without its slash: the URLs would be wrong', async () => {
    browser(container(registered()));

    await assert.rejects(serveInFrame({}, { frame: {}, documentRoot: '/app/public', under: 'app' }), /must end with a slash/);
});

webTest('serveInFrame() waits for the first service worker to activate', async () => {
    const installing = worker('installing');
    const update = () => assert.fail('There is nothing to update yet.');
    browser(container(registered({ installing, active: null, update })));
    const frame = {};

    const served = serveInFrame({}, { frame, documentRoot: '/app/public' });
    await new Promise(setImmediate);
    assert.equal(frame.src, undefined);

    installing.become('activated');
    await served;
    assert.equal(String(frame.src), app);
});

webTest('serveInFrame() opens the frame with the new service worker when there is one', async () => {
    const registration = registered();
    const newWorker = worker('installing');
    registration.update = async () => {
        registration.installing = newWorker;
    };
    browser(container(registration));
    const frame = {};

    const served = serveInFrame({}, { frame, documentRoot: '/app/public' });
    await new Promise(setImmediate);
    assert.equal(frame.src, undefined);

    registration.installing = null;
    registration.active = newWorker;
    newWorker.become('activated');
    await served;
    assert.equal(String(frame.src), app);
});

webTest('serveInFrame() goes on with the service worker it has when it can not update it', async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    browser(container(registered({ update: async () => {
        throw new TypeError('Failed to update a ServiceWorker.');
    } })));
    const frame = {};

    await serveInFrame({}, { frame, documentRoot: '/app/public' });

    assert.equal(String(frame.src), app);
    assert.match(warn.mock.calls[0].arguments[0], /Failed to update/);
});

webTest('serveInFrame() says why in the frame when the service worker does not load', async () => {
    const serviceWorkerContainer = container(registered());
    serviceWorkerContainer.register = async () => {
        throw new TypeError('A bad HTTP response code (404) was received.');
    };
    browser(serviceWorkerContainer);
    const frame = {};

    await assert.rejects(serveInFrame({}, { frame, documentRoot: '/app/public' }), /404/);

    assert.match(frame.srcdoc, /does not start: A bad HTTP response code \(404\)/);
    assert.equal(frame.src, undefined);
});

webTest('serveInFrame() says why in the frame when the service worker fails to install', async () => {
    const registration = registered({ installing: worker('installing'), active: null });
    browser(container(registration));
    const frame = {};

    const served = serveInFrame({}, { frame, documentRoot: '/app/public' });
    await new Promise(setImmediate);
    const failed = registration.installing;
    registration.installing = null;
    failed.become('redundant');

    await assert.rejects(served, /does not install/);
    assert.match(frame.srcdoc, /does not install/);
});

webTest('serveInFrame() says why in the frame when the browser has no service worker there', async () => {
    browser(undefined);
    const frame = {};

    await assert.rejects(serveInFrame({}, { frame, documentRoot: '/app/public' }), /HTTPS/);

    assert.match(frame.srcdoc, /HTTPS/);
});

/**
 * Starts serveInFrame() with a small application. hand() gives it a request as
 * the service worker does, and resolves with the answer.
 */
async function servedApplication(options = {}) {
    const php = await createPhp();
    php.FS.mkdirTree('/site');
    php.FS.writeFile('/site/index.php', '<?php setcookie("visits", ($_COOKIE["visits"] ?? 0) + 1); error_log("A log."); echo json_encode(["cookies" => $_COOKIE, "script" => $_SERVER["SCRIPT_NAME"], "added" => $_SERVER["HTTP_X_ADDED"] ?? null]);');
    const serviceWorkerContainer = container(registered());
    const storage = browser(serviceWorkerContainer);
    await serveInFrame(php, { frame: {}, documentRoot: '/site', ...options });

    const [listener] = serviceWorkerContainer.listeners;

    return {
        hand: (data) => new Promise((resolve) => listener({ data, ports: [{ postMessage: resolve }] })),
        listener,
        php,
        storage,
    };
}

const get = (url) => ({ method: 'GET', url, headers: [['Cookie', 'browser=1']], body: '' });
const json = (response) => JSON.parse(new TextDecoder().decode(response.body));

webTest('serveInFrame() runs what the service worker hands over at the path of the application, and keeps its cookies per application', async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const { hand, storage } = await servedApplication();

    assert.deepEqual(json(await hand(get(app))), { cookies: [], script: '/repository/app/index.php', added: null });
    assert.deepEqual(json(await hand(get(app))), { cookies: { visits: '1' }, script: '/repository/app/index.php', added: null });

    assert.deepEqual([...storage], [['php cookies /repository/app/', '[["visits","2"]]']]);
    assert.match(warn.mock.calls[0].arguments[0], /A log\./);
});

webTest('serveInFrame() adds the headers of the page to each request', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const { hand } = await servedApplication({ headers: { 'X-Added': 'by the page' } });

    assert.equal(json(await hand(get(app))).added, 'by the page');
});

webTest('serveInFrame() leaves the messages that are not for it', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const { hand } = await servedApplication();

    const answered = await Promise.race([hand(get(`${origin}/repository/other/`)), hand('Another message'), new Promise((resolve) => setImmediate(resolve, 'nothing'))]);

    assert.equal(answered, 'nothing');
});

webTest('serveInFrame() answers with why PHP fails, and rejects: the console shows it', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const { listener, php } = await servedApplication();
    php.request = async () => {
        throw new Error('It aborts.');
    };

    const answers = [];
    await assert.rejects(listener({ data: get(app), ports: [{ postMessage: (answer) => answers.push(answer) }] }), /It aborts/);

    assert.equal(answers[0].status, 500);
    assert.equal(answers[0].body, 'PHP failed: It aborts.');
});
