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

const build = process.env.BUILD ? pathToFileURL(path.resolve(process.env.BUILD)) : new URL('../build/default/php-node.mjs', import.meta.url);

let php;
before(async () => {
    const { default: createPhp } = await import(build);
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

test('$_SERVER has what the php command gives', async () => {
    const code = 'echo json_encode(array_map(fn ($name) => $_SERVER[$name], ["PHP_SELF", "SCRIPT_NAME", "SCRIPT_FILENAME", "PATH_TRANSLATED", "DOCUMENT_ROOT"]));';
    php.FS.writeFile('/tmp/server.php', `<?php ${code}`);

    assert.deepEqual(JSON.parse((await php.runFile('/tmp/server.php')).stdout), ['/tmp/server.php', '/tmp/server.php', '/tmp/server.php', '/tmp/server.php', '']);
    assert.deepEqual(JSON.parse((await php.runCode(code)).stdout), ['Standard input code', 'Standard input code', '', '', '']);
});

test('the "#!" line of a script is not printed, nor of what it includes', async () => {
    php.FS.writeFile('/tmp/shebang.php', '#!/usr/bin/env php\n<?php echo "included ";');
    php.FS.writeFile('/tmp/script.php', '#!/usr/bin/env php\n<?php require "/tmp/shebang.php"; echo "script";');

    assert.equal((await php.runFile('/tmp/script.php')).stdout, 'included script');
    assert.equal((await php.runCode('require "/tmp/shebang.php";')).stdout, 'included ');
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

test('proc_open() fails, there is no other process to run: the module goes on', async () => {
    // An array of arguments, as Symfony Process gives, then a shell command
    const code = 'echo json_encode(array_map(fn ($command) => [@proc_open($command, [], $pipes), error_get_last()["message"]], [["ls"], "ls"]));';

    assert.deepEqual(JSON.parse((await php.runCode(code)).stdout), [
        [false, 'proc_open(): posix_spawn() failed: Function not implemented'],
        [false, 'proc_open(): posix_spawn() failed: Function not implemented'],
    ]);
});

test('PHP goes deep through the callbacks of its functions: the C stack is not the default one of emscripten', async () => {
    // 64 KB overflow before 400, and nothing says so
    const code = 'function deeper($n) { return $n ? array_map(fn () => deeper($n - 1), [1])[0] : "deep enough"; } echo deeper(1000);';

    assert.equal((await php.runCode(code)).stdout, 'deep enough');
});

test('each run is a request of its own, the files stay', async () => {
    await php.runCode('$GLOBALS["previous"] = true; file_put_contents("/tmp/previous.txt", "kept");');

    assert.equal((await php.runCode('echo isset($GLOBALS["previous"]) ? "kept" : "gone", " ", file_get_contents("/tmp/previous.txt");')).stdout, 'gone kept');
});
