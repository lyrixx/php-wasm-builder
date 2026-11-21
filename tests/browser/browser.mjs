import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

// What the tests of an example in Chrome share: the public/ directory of the
// example, served as GitHub Pages serves it, under the path of a repository,
// and the Chrome that is installed. Each test has its own browser context:
// nothing of another one, no service worker, no IndexedDB, no cookie.

// Where GitHub Pages serves the website: the scopes of the service workers,
// and the base path of the application, are under it
export const BASE_PATH = '/repository/';

// What GitHub Pages sends: a service worker only loads as JavaScript, and
// WebAssembly.instantiateStreaming() only takes a .wasm file served as such
const MIME_TYPES = {
    '.css': 'text/css',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.wasm': 'application/wasm',
};

/**
 * Serves the example during the tests of the file, and starts Chrome. Its
 * origin, on 127.0.0.1, is a secure context: it has service workers, and the
 * Web Locks.
 *
 * @return {{ url: (relative?: string) => string, newContext: () => Promise<import('playwright-core').BrowserContext> }}
 */
export function servedExample(example) {
    const root = fileURLToPath(new URL(`../../examples/${example}/public/`, import.meta.url));
    let server;
    let browser;
    let origin;

    before(async () => {
        server = createServer(async (request, response) => {
            const { pathname } = new URL(request.url, 'http://127.0.0.1');
            const file = path.join(root, decodeURIComponent(pathname.slice(BASE_PATH.length)), pathname.endsWith('/') ? 'index.html' : '');
            if (!pathname.startsWith(BASE_PATH) || !file.startsWith(root)) {
                response.writeHead(404).end();

                return;
            }

            let body;
            try {
                body = await readFile(file);
            } catch {
                response.writeHead(404).end();

                return;
            }
            response.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(body);
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        origin = `http://127.0.0.1:${server.address().port}`;
        browser = await chromium.launch({ channel: 'chrome' });
    });

    after(async () => {
        await browser?.close();
        server?.close();
    });

    return {
        url: (relative = '') => `${origin}${BASE_PATH}${relative}`,
        newContext: () => browser.newContext(),
    };
}
