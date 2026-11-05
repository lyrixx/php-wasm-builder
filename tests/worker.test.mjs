import assert from 'node:assert/strict';
import path from 'node:path';
import { before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

// What the worker of createPhpInWorker() answers, on the build for the web of
// the default stack unless BUILD says which. A build for node has none of it:
//
//     BUILD=build/php-8.5/php-web.mjs node --import ./node/fetch-files.mjs --test tests/worker.test.mjs
//
// node has no Web Worker: php-web.mjs believes it runs in one here, and is asked
// what the page asks, on a real MessageChannel, that copies what a browser does.

const build = process.env.BUILD ? pathToFileURL(path.resolve(process.env.BUILD)) : new URL('../build/php-8.5/php-web.mjs', import.meta.url);
const isWeb = build.pathname.endsWith('/php-web.mjs');
const webTest = (name, callback) => test(name, { skip: !isWeb && 'only the build for the web has it' }, callback);

const ask = (method, args) => new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = ({ data }) => {
        port1.close();
        resolve(data);
    };
    self.onmessage({ data: { method, args }, ports: [port2] });
});

before(async () => {
    if (!isWeb) {
        return;
    }

    globalThis.WorkerGlobalScope = class {};
    globalThis.self = { name: 'php-wasm-builder', location: build };
    await import(build);
    await ask('createPhp', [{}]);
});

webTest('what creates a file gives nothing: its node can not be copied, and it worked', async () => {
    assert.deepEqual(await ask('FS', ['mkdir', ['/tmp/directory']]), { result: undefined });
    assert.deepEqual(await ask('FS', ['symlink', ['/tmp/directory', '/tmp/link']]), { result: undefined });

    assert.deepEqual(await ask('FS', ['readlink', ['/tmp/link']]), { result: '/tmp/directory' });
    assert.ok((await ask('FS', ['readdir', ['/tmp']])).result.includes('directory'));
});

webTest('what can be copied is', async () => {
    await ask('FS', ['writeFile', ['/tmp/file', 'php']]);

    assert.equal(new TextDecoder().decode((await ask('FS', ['readFile', ['/tmp/file']])).result), 'php');
});

webTest('an answer that can not be copied rejects the promise, and says why: PHP goes on', async () => {
    const { error } = await ask('FS', ['lookupPath', ['/tmp']]);

    assert.equal(error.message, 'FS.lookupPath() returns what can not be copied to the page.');
    assert.equal((await ask('runCode', ['echo "Still running";'])).result.stdout, 'Still running');
});

webTest('an error of the filesystem gets to the page', async () => {
    assert.ok('error' in await ask('FS', ['mkdir', ['/tmp/missing/directory']]));
});
