// The API of the module: runFile() and runCode() run PHP as the php command
// does, and return what it writes, request() runs it as a web server does,
// and returns its response. See docs/javascript-api/index.md.
//
// Given to emcc with --pre-js: this runs as the module is created, before it
// starts. Module is what createPhp() is given, and what it returns once the
// module has started. The code of emscripten is all around: its optimizer
// mixes up the names that it uses too (run()…), even in a block.

{
    const utf8Encoder = new TextEncoder();
    const utf8Decoder = new TextDecoder();

    // What a web server says a static file is, by its extension
    const MIME_TYPES = {
        css: 'text/css',
        gif: 'image/gif',
        html: 'text/html',
        ico: 'image/vnd.microsoft.icon',
        jpeg: 'image/jpeg',
        jpg: 'image/jpeg',
        js: 'text/javascript',
        json: 'application/json',
        map: 'application/json',
        mjs: 'text/javascript',
        png: 'image/png',
        svg: 'image/svg+xml',
        txt: 'text/plain',
        wasm: 'application/wasm',
        webp: 'image/webp',
        woff: 'font/woff',
        woff2: 'font/woff2',
        xml: 'application/xml',
    };

    // The run in progress: what PHP reads on stdin, what it writes on stdout
    // and stderr, byte by byte, and the status and headers of a response
    let stdio;

    Module['stdin'] = () => stdio.stdin[stdio.read++] ?? null;
    Module['stdout'] = (byte) => stdio.stdout.push(byte);
    Module['stderr'] = (byte) => stdio.stderr.push(byte);

    // run.c calls it once PHP sends the headers, "Name: value" lines
    Module['sendResponseHead'] = (status, lines) => {
        stdio.status = status;
        stdio.headers = utf8Decoder.decode(lines).split('\n').filter(Boolean).map((line) => {
            const colon = line.indexOf(':');

            return [line.slice(0, colon), line.slice(colon + 1).trim()];
        });
    };

    // php <file> <args>...
    Module['runFile'] = (file, { args = [], stdin = '' } = {}) => withPersistedFiles(() => commandOutput(runPhp([file, ...args], stdin, (argc, argv) => _run_file(argc, argv))));

    // php -r <code> <args>...
    Module['runCode'] = (code, { args = [], stdin = '' } = {}) => withPersistedFiles(() => commandOutput(runPhp(['Standard input code', ...args], stdin, (argc, argv) => {
        const pointer = copyString(code);
        try {
            return _run_code(pointer, argc, argv);
        } finally {
            _free(pointer);
        }
    })));

    // An HTTP request, as a web server runs PHP for it: the file of
    // documentRoot that its URL asks for, at basePath
    Module['request'] = ({ method = 'GET', url, headers = {}, body = '' }, { documentRoot, basePath = '' } = {}) => {
        if (undefined === documentRoot) {
            throw new TypeError('request() needs the documentRoot option, the directory that the URLs are the files of.');
        }

        url = new URL(url);
        const path = findFile(url.pathname, documentRoot, basePath);
        if (null === path) {
            return Promise.resolve({ status: 404, headers: [['Content-Type', 'text/plain']], body: utf8Encoder.encode('Not Found'), stderr: '' });
        }
        // Not PHP: the file, as it is
        if (!path.endsWith('.php')) {
            const type = MIME_TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';

            return Promise.resolve({ status: 200, headers: [['Content-Type', type]], body: FS.readFile(documentRoot + path), stderr: '' });
        }

        // What PHP reads on stdin, and its length
        if ('string' === typeof body) {
            body = utf8Encoder.encode(body);
        } else {
            body = ArrayBuffer.isView(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : new Uint8Array(body);
        }
        const variables = requestVariables(method, url, new Headers(headers), body.length, documentRoot, basePath, path);

        return withPersistedFiles(() => {
            const { status, headers, stdout, stderr } = runPhp(Object.entries(variables).flat(), body, (count, pointers) => _run_request(count, pointers));

            return { status, headers, body: stdout, stderr: utf8Decoder.decode(stderr) };
        });
    };

    // With the file cache of opcache (OPCACHE, in the Dockerfile: run.c makes
    // its directory), what is embedded is older than what the page or PHP
    // writes: opcache caches it from the first run, compiles a file written
    // over it again, and a file written less than 2 s before (its mtime is in
    // seconds). 1 s after the epoch: it does not cache a file whose mtime is
    // 0. The build compiles the files with this mtime too. Keep the directory
    // in sync with OPCACHE_FILE_CACHE, in the Dockerfile.
    Module['postRun'] = [].concat(Module['postRun'] ?? [], () => {
        if (FS.analyzePath('/opcache').exists) {
            ageEmbeddedFiles(FS.root);
        }
    });

    // By nodes, not paths: 10 times faster, 5 ms for 8,000 files
    function ageEmbeddedFiles(directory) {
        for (const name of directory.node_ops.readdir(directory)) {
            if ('.' === name || '..' === name || (FS.root === directory && ('dev' === name || 'proc' === name))) {
                continue;
            }

            const node = FS.lookupNode(directory, name);
            if (FS.isMountpoint(node)) {
                continue;
            }
            if (FS.isDir(node.mode)) {
                ageEmbeddedFiles(node);
            } else if (FS.isFile(node.mode)) {
                node.node_ops.setattr(node, { atime: 1000, mtime: 1000 });
            }
        }
    }

    // A directory kept in IndexedDB, across the reloads of the page
    const persist = Module['persist'];
    if (persist) {
        Module['preRun'] = [].concat(Module['preRun'] ?? [], () => {
            FS.mkdirTree(persist);
            FS.mount(IDBFS, {}, persist);
        });
    }

    /**
     * With persist, one run at a time, across the tabs of the page: each one
     * reads what the others wrote in IndexedDB, and writes in it before the
     * next one reads. Without the lock, a tab writes over what another one
     * wrote.
     */
    async function withPersistedFiles(callback) {
        if (!persist) {
            return callback();
        }

        return navigator.locks.request(`php ${persist}`, async () => {
            await syncPersistedFiles(true);
            const result = callback();
            await syncPersistedFiles(false);

            return result;
        });
    }

    /**
     * Runs PHP with strings, as char *argv[] in the memory of the module, and
     * what it reads on stdin.
     */
    function runPhp(strings, stdin, callback) {
        stdio = {
            stdin: 'string' === typeof stdin ? utf8Encoder.encode(stdin) : stdin,
            read: 0,
            stdout: [],
            stderr: [],
            // Unless PHP sends headers
            status: 200,
            headers: [],
        };

        const pointers = strings.map(copyString);
        const array = _malloc(pointers.length * 4);
        HEAPU32.set(pointers, array / 4);

        try {
            return {
                exitCode: callback(strings.length, array),
                stdout: new Uint8Array(stdio.stdout),
                stderr: new Uint8Array(stdio.stderr),
                status: stdio.status,
                headers: stdio.headers,
            };
        } finally {
            for (const pointer of [...pointers, array]) {
                _free(pointer);
            }
            stdio = undefined;
        }
    }

    // What the php command gives: what PHP wrote, as strings
    function commandOutput({ exitCode, stdout, stderr }) {
        return { exitCode, stdout: utf8Decoder.decode(stdout), stderr: utf8Decoder.decode(stderr) };
    }

    /**
     * The path of the file of documentRoot that a URL path asks for, as a web
     * server finds it: the file of the path when there is one, index.php (the
     * front controller) otherwise. Null when there is neither.
     */
    function findFile(pathname, documentRoot, basePath) {
        if (!pathname.startsWith(basePath + '/')) {
            return null;
        }

        let path;
        try {
            path = decodeURIComponent(pathname.slice(basePath.length));
        } catch {
            // A malformed URL: it is for the front controller to say
            path = '/';
        }
        // Never out of documentRoot
        if (!path.split('/').includes('..') && isFile(documentRoot + path)) {
            return path;
        }

        return isFile(documentRoot + '/index.php') ? '/index.php' : null;
    }

    function isFile(path) {
        try {
            return FS.isFile(FS.stat(path).mode);
        } catch {
            return false;
        }
    }

    /**
     * $_SERVER, as a web server gives it to PHP with CGI: what PHP fills
     * $_GET, $_POST, $_COOKIE and $_FILES from too.
     */
    function requestVariables(method, url, headers, contentLength, documentRoot, basePath, path) {
        const scriptName = basePath + path;
        const https = 'https:' === url.protocol;
        // A service worker does not see the Host header: the one of the URL
        const variables = { HTTP_HOST: url.host };
        for (const [name, value] of headers) {
            // They have their own variables
            if ('content-type' !== name && 'content-length' !== name) {
                variables[`HTTP_${name.toUpperCase().replaceAll('-', '_')}`] = value;
            }
        }

        return Object.assign(variables, {
            CONTENT_LENGTH: String(contentLength),
            CONTENT_TYPE: headers.get('content-type') ?? '',
            DOCUMENT_ROOT: documentRoot,
            GATEWAY_INTERFACE: 'CGI/1.1',
            ...(https ? { HTTPS: 'on' } : {}),
            PHP_SELF: scriptName,
            QUERY_STRING: url.search.slice(1),
            REMOTE_ADDR: '127.0.0.1',
            REQUEST_METHOD: method.toUpperCase(),
            REQUEST_SCHEME: url.protocol.slice(0, -1),
            REQUEST_URI: url.pathname + url.search,
            SCRIPT_FILENAME: documentRoot + path,
            SCRIPT_NAME: scriptName,
            SERVER_NAME: url.hostname,
            SERVER_PORT: url.port || (https ? '443' : '80'),
            SERVER_PROTOCOL: 'HTTP/1.1',
        });
    }

    /**
     * A copy of a string in the memory of the module, as C has it, to free.
     */
    function copyString(string) {
        const bytes = utf8Encoder.encode(string + '\0');
        const pointer = _malloc(bytes.length);
        HEAPU8.set(bytes, pointer);

        return pointer;
    }

    // From IndexedDB, or to it
    function syncPersistedFiles(populate) {
        return new Promise((resolve, reject) => FS.syncfs(populate, (error) => error ? reject(error) : resolve()));
    }
}
