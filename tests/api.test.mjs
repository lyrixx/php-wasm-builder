import assert from 'node:assert/strict';
import path from 'node:path';
import { before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

// The tests of the JavaScript API of a build (docker/api.js), the build of the
// default stack for node unless BUILD says which:
//
//     BUILD=build/default/php-web.mjs node --import ./node/fetch-files.mjs --test tests/api.test.mjs
//
// persist needs a browser: IndexedDB, and the Web Locks.

const build = process.env.BUILD ?? new URL('../build/default/php-node.mjs', import.meta.url);

let php;
before(async () => {
    const { default: createPhp } = await import(build instanceof URL ? build : pathToFileURL(path.resolve(build)));
    php = await createPhp();
});

test('runCode() returns what PHP writes, as it is written', async () => {
    assert.deepEqual(await php.runCode('echo "été\\n\\n🐘"; fwrite(fopen("php://stderr", "w"), "on stderr");'), {
        exitCode: 0,
        stdout: 'été\n\n🐘',
        stderr: 'on stderr',
    });
});

test('runCode() returns the exit status of PHP', async () => {
    assert.equal((await php.runCode('exit(3);')).exitCode, 3);
    assert.equal((await php.runCode('throw new Exception();')).exitCode, 255);
    assert.equal((await php.runCode('echo "Still running";')).exitCode, 0);
});

test('runFile() runs a file of the WASM filesystem, with its arguments', async () => {
    php.FS.writeFile('/tmp/argv.php', '<?php echo json_encode([$argc, $argv, __FILE__]);');

    assert.deepEqual(JSON.parse((await php.runFile('/tmp/argv.php', { args: ['one', 'two words'] })).stdout), [
        3,
        ['/tmp/argv.php', 'one', 'two words'],
        '/tmp/argv.php',
    ]);
});

test('runCode() gets its arguments after "Standard input code", as with php -r', async () => {
    assert.equal((await php.runCode('echo json_encode($argv);', { args: ['one'] })).stdout, '["Standard input code","one"]');
});

test('PHP reads stdin on php://stdin, a string or bytes', async () => {
    assert.equal((await php.runCode('echo strlen($stdin = file_get_contents("php://stdin")), " ", $stdin;', { stdin: 'été' })).stdout, '5 été');
    assert.equal((await php.runCode('echo bin2hex(file_get_contents("php://stdin"));', { stdin: new Uint8Array([0, 128, 255]) })).stdout, '0080ff');
    assert.equal((await php.runCode('echo strlen(file_get_contents("php://stdin"));')).stdout, '0');
});

test('runCode() takes more code than the stack of the module', async () => {
    const string = 'x'.repeat(1024 * 1024);

    assert.equal((await php.runCode(`echo strlen('${string}');`)).stdout, String(string.length));
});

test('each run is a request of its own, the files stay', async () => {
    await php.runCode('$GLOBALS["previous"] = true; file_put_contents("/tmp/previous.txt", "kept");');

    assert.equal((await php.runCode('echo isset($GLOBALS["previous"]) ? "kept" : "gone", " ", file_get_contents("/tmp/previous.txt");')).stdout, 'gone kept');
});
