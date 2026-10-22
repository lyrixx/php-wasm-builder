import { readFile } from 'node:fs/promises';

// Runs the modules of a page in node, as a browser runs them, once preloaded:
//
//     node --import ./node/fetch-files.mjs --test tests/fetch-files.test.mjs
//
// A module of the page loads php-web.mjs, which fetches its .wasm, and fetches
// the files it needs next to it: with URLs relative to import.meta.url, that
// are file: URLs in node. fetch() reads them from the disk, where a server
// would serve them from, and records their resource timing, as a browser does.

const fetchFromNetwork = globalThis.fetch;

globalThis.fetch = async (resource, options) => {
    const url = new URL(resource instanceof Request ? resource.url : resource);
    if (url.protocol !== 'file:') {
        return fetchFromNetwork(resource, options);
    }

    const startTime = performance.now();
    let body;
    try {
        body = await readFile(url);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }

        // What a server answers: the page checks response.ok
        return new Response(null, { status: 404, statusText: 'Not Found' });
    }

    performance.markResourceTiming(fetchTimingInfo(startTime, performance.now(), body.length), url.href, 'fetch', globalThis, '', {}, 200);

    // WebAssembly.instantiateStreaming() only takes a .wasm file served as such
    const headers = url.pathname.endsWith('.wasm') ? { 'Content-Type': 'application/wasm' } : {};

    return new Response(body, { headers });
};

/**
 * The "fetch timing info" of the Fetch standard, as node takes it: there is no
 * connection, and the file is read at once.
 */
function fetchTimingInfo(startTime, endTime, size) {
    return {
        startTime,
        redirectStartTime: 0,
        redirectEndTime: 0,
        postRedirectStartTime: startTime,
        finalServiceWorkerStartTime: 0,
        finalNetworkRequestStartTime: startTime,
        finalNetworkResponseStartTime: endTime,
        endTime,
        finalConnectionTimingInfo: null,
        encodedBodySize: size,
        decodedBodySize: size,
    };
}
