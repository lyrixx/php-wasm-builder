import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';

// The tests of fetch-files.mjs, that node preloads:
//
//     node --import ./node/fetch-files.mjs --test tests/fetch-files.test.mjs

test('fetch() reads a file from the disk', async () => {
    const response = await fetch(import.meta.url);

    assert.equal(response.status, 200);
    assert.equal(await response.text(), await readFile(new URL(import.meta.url), 'utf8'));
});

test('fetch() answers 404 for a file that does not exist', async () => {
    const response = await fetch(new URL('missing.txt', import.meta.url));

    assert.equal(response.ok, false);
    assert.equal(response.status, 404);
});

test('fetch() serves a .wasm file as such', async () => {
    const { instance } = await WebAssembly.instantiateStreaming(fetch(new URL('empty.wasm', import.meta.url)));

    assert.ok(instance instanceof WebAssembly.Instance);
});

test('fetch() records the resource timing of a file', async () => {
    const url = new URL('empty.wasm', import.meta.url).href;
    await fetch(url);

    const [entry] = performance.getEntriesByName(url);
    assert.equal(entry.initiatorType, 'fetch');
    assert.equal(entry.decodedBodySize, 8);
});

test('fetch() still fetches from the network', async (t) => {
    const server = createServer((request, response) => response.end('From the network'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => server.close());

    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);

    assert.equal(await response.text(), 'From the network');
});
