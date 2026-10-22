// The API of the module: runFile() and runCode() run PHP as the php command
// does, and return what it writes. See "JavaScript API" in README.rst.
//
// Given to emcc with --pre-js: this runs as the module is created, before it
// starts. Module is what createPhp() is given, and what it returns once the
// module has started. The code of emscripten is all around: its optimizer
// mixes up the names that it uses too (run()…), even in a block.

{
    const utf8Encoder = new TextEncoder();
    const utf8Decoder = new TextDecoder();

    // The run in progress: what PHP reads on php://stdin, and what it writes
    // on stdout and stderr, byte by byte
    let stdio;

    Module['stdin'] = () => stdio.stdin[stdio.read++] ?? null;
    Module['stdout'] = (byte) => stdio.stdout.push(byte);
    Module['stderr'] = (byte) => stdio.stderr.push(byte);

    // php <file> <args>...
    Module['runFile'] = (file, { args = [], stdin = '' } = {}) => withPersistedFiles(() => captureOutput([file, ...args], stdin, (argc, argv) => _run_file(argc, argv)));

    // php -r <code> <args>...
    Module['runCode'] = (code, { args = [], stdin = '' } = {}) => withPersistedFiles(() => captureOutput(['Standard input code', ...args], stdin, (argc, argv) => {
        const pointer = copyString(code);
        try {
            return _run_code(pointer, argc, argv);
        } finally {
            _free(pointer);
        }
    }));

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

    function captureOutput(argv, stdin, callback) {
        stdio = {
            stdin: 'string' === typeof stdin ? utf8Encoder.encode(stdin) : stdin,
            read: 0,
            stdout: [],
            stderr: [],
        };

        // char *argv[], in the memory of the module
        const pointers = argv.map(copyString);
        const array = _malloc(pointers.length * 4);
        HEAPU32.set(pointers, array / 4);

        try {
            return {
                exitCode: callback(argv.length, array),
                stdout: utf8Decoder.decode(new Uint8Array(stdio.stdout)),
                stderr: utf8Decoder.decode(new Uint8Array(stdio.stderr)),
            };
        } finally {
            for (const pointer of [...pointers, array]) {
                _free(pointer);
            }
            stdio = undefined;
        }
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
