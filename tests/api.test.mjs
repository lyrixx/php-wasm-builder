import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

// The tests of the JavaScript API of a build (docker/api.js), the build of the
// default stack for node unless BUILD says which:
//
//     BUILD=build/php-8.5/php-web.mjs node --import ./node/fetch-files.mjs --test tests/api.test.mjs
//
// persist needs a browser: IndexedDB, and the Web Locks, as
// createPhpInWorker(): a Web Worker.

const build = process.env.BUILD ? pathToFileURL(path.resolve(process.env.BUILD)) : new URL('../build/php-8.5/php-node.mjs', import.meta.url);

// What tests/embed/constants.php prints
const CONSTANTS_ATTRIBUTES = '[["first"],["second"]]';

const isCached = (php, file) => {
    const [systemId] = php.FS.readdir('/opcache').filter((name) => '.' !== name && '..' !== name);

    return php.FS.analyzePath(`/opcache/${systemId}${file}.bin`).exists;
};

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

test('what FS throws says what is wrong', () => {
    assert.throws(() => php.FS.mkdir('/tmp/missing/directory'), { name: 'ErrnoError', message: 'No such file or directory' });
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

// A small site: index.php, its front controller, prints what PHP got
const site = { documentRoot: '/site/public', basePath: '/site' };
const utf8Decoder = new TextDecoder();

function writeSite() {
    php.FS.mkdirTree('/site/public/assets');
    php.FS.writeFile('/site/public/index.php', '<?php echo json_encode(["sapi" => PHP_SAPI, "server" => array_intersect_key($_SERVER, array_flip(["REQUEST_METHOD", "REQUEST_URI", "QUERY_STRING", "SCRIPT_NAME", "SCRIPT_FILENAME", "PHP_SELF", "DOCUMENT_ROOT", "HTTP_HOST", "HTTP_X_CUSTOM", "HTTPS", "SERVER_PORT"])), "get" => $_GET, "post" => $_POST, "cookie" => $_COOKIE, "input" => file_get_contents("php://input")]);');
    php.FS.writeFile('/site/public/assets/style.css', 'body {}');
    php.FS.writeFile('/site/public/other.php', '<?php echo $_SERVER["SCRIPT_NAME"];');
    php.FS.writeFile('/site/secret.txt', 'secret');
}

async function requestJson(request) {
    writeSite();
    const response = await php.request(request, site);

    return JSON.parse(utf8Decoder.decode(response.body));
}

test('request() runs the front controller with the request, as a web server does', async () => {
    const got = await requestJson({
        method: 'POST',
        url: 'https://example.com/site/blog/été?page=2&tags[]=php',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Custom': 'yes', Cookie: 'theme=dark; lang=fr' },
        body: 'title=Hello&tags[]=wasm',
    });

    assert.deepEqual(got, {
        sapi: 'wasm',
        server: {
            REQUEST_METHOD: 'POST',
            REQUEST_URI: '/site/blog/%C3%A9t%C3%A9?page=2&tags[]=php',
            QUERY_STRING: 'page=2&tags[]=php',
            SCRIPT_NAME: '/site/index.php',
            SCRIPT_FILENAME: '/site/public/index.php',
            PHP_SELF: '/site/index.php',
            DOCUMENT_ROOT: '/site/public',
            HTTP_HOST: 'example.com',
            HTTP_X_CUSTOM: 'yes',
            HTTPS: 'on',
            SERVER_PORT: '443',
        },
        get: { page: '2', tags: ['php'] },
        post: { title: 'Hello', tags: ['wasm'] },
        cookie: { theme: 'dark', lang: 'fr' },
        input: 'title=Hello&tags[]=wasm',
    });
});

test('request() gives PHP the body of any method on php://input, a string or bytes', async () => {
    const json = await requestJson({ method: 'PUT', url: 'http://localhost/site/', headers: { 'Content-Type': 'application/json' }, body: '{"a":"é"}' });
    assert.equal(json.input, '{"a":"é"}');
    assert.deepEqual(json.post, []);

    const bytes = await requestJson({ method: 'PATCH', url: 'http://localhost/site/', body: new Uint8Array([0x61, 0x62]).buffer });
    assert.equal(bytes.input, 'ab');
});

test('request() returns the status, the headers and the body that PHP sends', async () => {
    php.FS.mkdirTree('/site/public');
    php.FS.writeFile('/site/public/index.php', '<?php http_response_code(201); header("X-Answer: 42"); setcookie("visited", "yes"); echo "\\0created";');
    const response = await php.request({ url: 'http://localhost/site/' }, site);

    assert.equal(response.status, 201);
    assert.deepEqual(response.headers.filter(([name]) => 'X-Powered-By' !== name), [
        ['X-Answer', '42'],
        ['Set-Cookie', 'visited=yes'],
        ['Content-type', 'text/html; charset=UTF-8'],
    ]);
    // Bytes, as they are
    assert.deepEqual(response.body, new Uint8Array([0, ...new TextEncoder().encode('created')]));

    // Even when PHP writes nothing
    php.FS.writeFile('/site/public/index.php', '<?php header("Location: /site/elsewhere", true, 302);');
    const redirection = await php.request({ url: 'http://localhost/site/' }, site);
    assert.equal(redirection.status, 302);
    assert.ok(redirection.headers.some(([name, value]) => 'Location' === name && '/site/elsewhere' === value));
    assert.equal(redirection.body.length, 0);
});

test('request() runs an uploaded file through PHP, as $_FILES', async () => {
    php.FS.mkdirTree('/site/public');
    php.FS.writeFile('/site/public/index.php', '<?php $file = $_FILES["document"]; echo json_encode([$file["name"], $file["size"], is_uploaded_file($file["tmp_name"]), file_get_contents($file["tmp_name"]), $_POST]);');
    const body = new FormData();
    body.append('title', 'Report');
    body.append('document', new Blob(['%PDF…'], { type: 'application/pdf' }), 'report.pdf');
    // What a browser sends for the form
    const request = new Request('http://localhost/site/', { method: 'POST', body });

    const response = await php.request({ method: 'POST', url: request.url, headers: request.headers, body: await request.arrayBuffer() }, site);

    assert.deepEqual(JSON.parse(utf8Decoder.decode(response.body)), ['report.pdf', 7, true, '%PDF…', { title: 'Report' }]);
});

test('request() serves the files of documentRoot, PHP or not, and nothing out of it', async () => {
    writeSite();
    const get = async (path) => php.request({ url: `http://localhost${path}` }, site);

    const style = await get('/site/assets/style.css');
    assert.equal(style.status, 200);
    assert.deepEqual(style.headers, [['Content-Type', 'text/css']]);
    assert.equal(utf8Decoder.decode(style.body), 'body {}');

    assert.equal(utf8Decoder.decode((await get('/site/other.php')).body), '/site/other.php');

    // The front controller, not the file out of documentRoot
    assert.equal(JSON.parse(utf8Decoder.decode((await get('/site/assets/..%2F..%2Fsecret.txt')).body)).server.SCRIPT_NAME, '/site/index.php');

    // Not under basePath
    assert.equal((await get('/elsewhere/')).status, 404);
});

test('a run of the php command after a request is not a request', async () => {
    writeSite();
    await php.request({ url: 'http://localhost/site/?a=1' }, site);

    const { stdout } = await php.runCode('echo json_encode([PHP_SAPI, $_GET, isset($_SERVER["REQUEST_METHOD"]), headers_sent()]); header("X-Not: sent"); var_dump(headers_list());');
    assert.match(stdout, /^\["embed",\[\],false,false\]/);
    assert.match(stdout, /X-Not: sent/);
});

test('going over memory_limit is a fatal error of PHP: the module goes on', async () => {
    const { exitCode, stdout } = await php.runCode('register_shutdown_function(function () { echo "shut down"; }); $strings = []; while (true) { $strings[] = str_repeat("x", 1000); }');

    assert.equal(exitCode, 255);
    assert.match(stdout, /Fatal error: Allowed memory size of \d+ bytes exhausted/);
    assert.match(stdout, /shut down$/);
    assert.equal((await php.runCode('echo "Still running";')).stdout, 'Still running');
});

test('filling the memory of the module is a fatal error of PHP too, whatever memory_limit says', async () => {
    const { default: createPhp } = await import(build);
    const fresh = await createPhp();
    fresh.FS.mkdirTree('/usr/local/lib');
    fresh.FS.writeFile('/usr/local/lib/php.ini', 'memory_limit=-1\n');

    // Small allocations, and one that does not fit
    for (const code of ['$strings = []; while (true) { $strings[] = str_repeat("x", 1000); }', '$string = pack("x1000000000");']) {
        const { exitCode, stdout } = await fresh.runCode(code);

        assert.equal(exitCode, 255);
        assert.match(stdout, /Fatal error: Out of memory/);
        assert.equal((await fresh.runCode('echo "Still running";')).stdout, 'Still running');
    }
});

test('memory_limit leaves some of the memory of the module to the C library, a php.ini changes it', async () => {
    const usage = 'echo json_encode([ini_get("memory_limit"), memory_get_usage() > 0]);';
    const [limit, counted] = JSON.parse((await php.runCode(usage)).stdout);

    assert.match(limit, /^\d+M$/);
    assert.equal(counted, true);

    const { default: createPhp } = await import(build);
    const fresh = await createPhp();
    fresh.FS.mkdirTree('/usr/local/lib');
    fresh.FS.writeFile('/usr/local/lib/php.ini', 'memory_limit=16M\n');

    assert.deepEqual(JSON.parse((await fresh.runCode(usage)).stdout), ['16M', true]);
    assert.equal((await fresh.runCode('$string = str_repeat("x", 32 * 1024 * 1024);')).exitCode, 255);
});

test('code that does not fit in the memory of the module rejects the promise: the module goes on', async () => {
    // More than the memory of the module, whatever the stack
    await assert.rejects(php.runCode(`/*${'x'.repeat(400 * 1024 * 1024)}*/`), /has no room for/);

    assert.equal((await php.runCode('echo "Still running";')).stdout, 'Still running');
});

test('a run gives back the memory it takes, however it ends', async () => {
    // More than the memory of the module, whatever the stack
    for (let run = 0; run < 100; run++) {
        assert.equal((await php.runCode('echo strlen(str_repeat("x", 32 * 1024 * 1024));')).stdout, String(32 * 1024 * 1024));
        assert.equal((await php.runCode('$string = str_repeat("x", 32 * 1024 * 1024); exit(3);')).exitCode, 3);
        assert.equal((await php.runCode('$string = str_repeat("x", 32 * 1024 * 1024); throw new Exception();')).exitCode, 255);
    }
});

test('the build for the web exports createPhpInWorker(), serveInFrame() and the cookies, not the one for node', async () => {
    const { createPhpInWorker, keepCookies, serveInFrame, withCookies } = await import(build);
    const expected = build.pathname.endsWith('/php-web.mjs') ? 'function' : 'undefined';

    assert.deepEqual([createPhpInWorker, keepCookies, serveInFrame, withCookies].map((exported) => typeof exported), Array(4).fill(expected));
});

test('opcache is disabled, unless it has its file cache', async () => {
    const { stdout } = await php.runCode('echo json_encode([ini_get("opcache.enable"), ini_get("opcache.file_cache")]);');
    const [enable, fileCache] = JSON.parse(stdout);

    if (php.FS.analyzePath('/opcache').exists) {
        assert.deepEqual([enable, fileCache], ['1', '/opcache']);
    } else {
        // false before PHP 8.5, without opcache
        assert.notEqual(enable, '1');
    }
});

test('a file written over runs as it is now, opcache or not', async () => {
    const outputs = [];
    // In the same second: opcache dates the files in seconds
    for (const version of [1, 2, 3, 4]) {
        php.FS.writeFile('/tmp/written-over.php', `<?php echo ${version};`);
        outputs.push((await php.runFile('/tmp/written-over.php')).stdout);
    }

    assert.deepEqual(outputs, ['1', '2', '3', '4']);
});

test('opcache compiles a file once, for the next runs, with its file cache', async (t) => {
    if (!php.FS.analyzePath('/opcache').exists) {
        t.skip('opcache has no file cache in this build');

        return;
    }

    // The first start of PHP in a module: the system_id that the cache is
    // keyed by is another one from the second start (see run.c)
    const { default: createPhp } = await import(build);
    const fresh = await createPhp();
    fresh.FS.writeFile('/tmp/compiled.php', '<?php echo "compiled";');
    // opcache does not cache a file written less than 2 s before
    fresh.FS.utime('/tmp/compiled.php', 1000, 1000);
    const count = (directory) => fresh.FS.readdir(directory).filter((name) => '.' !== name && '..' !== name).reduce((files, name) => {
        const entry = `${directory}/${name}`;

        return files + (fresh.FS.isDir(fresh.FS.stat(entry).mode) ? count(entry) : 1);
    }, 0);
    const before = count('/opcache');

    assert.equal((await fresh.runFile('/tmp/compiled.php')).stdout, 'compiled');
    const written = count('/opcache');
    assert.equal(written, before + 1);
    assert.equal((await fresh.runFile('/tmp/compiled.php')).stdout, 'compiled');
    assert.equal(count('/opcache'), written);
    // One system_id, the one of the build when it compiled what is embedded
    assert.equal(fresh.FS.readdir('/opcache').length, 3);
});

test('a constant keeps its attributes in the file cache of opcache', async (t) => {
    if (!php.FS.analyzePath('/opcache').exists) {
        t.skip('opcache has no file cache in this build');

        return;
    }

    // A module of its own: a crash would take the next tests with it
    const { default: createPhp } = await import(build);
    const fresh = await createPhp();
    fresh.FS.writeFile('/tmp/constants.php', readFileSync(new URL('embed/constants.php', import.meta.url)));
    // A file written less than 2 s before is not cached: nothing would fail
    fresh.FS.utime('/tmp/constants.php', 1000, 1000);

    assert.equal((await fresh.runFile('/tmp/constants.php')).stdout, CONSTANTS_ATTRIBUTES);
    assert.ok(isCached(fresh, '/tmp/constants.php'));
    assert.equal((await fresh.runFile('/tmp/constants.php')).stdout, CONSTANTS_ATTRIBUTES);
});

test('a constant keeps its attributes in what the build compiled', async (t) => {
    if (!php.FS.analyzePath('/tests/constants.php').exists) {
        t.skip('nothing is compiled with this file in this build');

        return;
    }

    const { default: createPhp } = await import(build);
    const fresh = await createPhp();

    assert.ok(isCached(fresh, '/tests/constants.php'));
    assert.equal((await fresh.runFile('/tests/constants.php')).stdout, CONSTANTS_ATTRIBUTES);
});
