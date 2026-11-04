// What the "warm" stage of the Dockerfile runs, in node:
//
//     node warm.mjs <php.mjs> <embed at> <opcache> [<file> <arguments>...]
//
// It runs the file (WARMUP), a file of the directory to embed, then opcache
// compiles every PHP file of the directory, with OPCACHE=precompiled. PHP sees
// the directory to embed, /embed, and the cache of opcache, /opcache, out of
// the WASM filesystem (NODEFS): what it writes in them is embedded.

import fs from 'node:fs';
import path from 'node:path';

const [build, embedAt, opcache, file, ...args] = process.argv.slice(2);
const { default: createPhp } = await import(build);

// Keep in sync with OPCACHE_FILE_CACHE, in the "resolve" stage of the Dockerfile
const php = await createPhp({
    preRun: [(module) => {
        for (const [directory, at] of [['/embed', embedAt], ['/opcache', '/opcache']]) {
            module.FS.mkdirTree(at);
            module.FS.mount(module.NODEFS, { root: directory }, at);
        }
        // What it does not write, it only says at this level
        module.FS.mkdirTree('/usr/local/lib');
        module.FS.writeFile('/usr/local/lib/php.ini', 'opcache.log_verbosity_level=2\n');
    }],
});

// opcache is enabled in the first run, as in the page: it changes the
// system_id, that every run then takes (see run.c)
if (file) {
    const { exitCode, stdout, stderr } = await php.runFile(`${embedAt}/${file}`, { args });
    process.stdout.write(stdout + stderr);
    if (0 !== exitCode) {
        throw new Error(`${file} exits with ${exitCode}.`);
    }
}

// What the file cached, with the mtimes of the files: it is not embedded.
// Through the WASM filesystem, that keeps the directories it knows.
const remove = (directory) => {
    for (const name of php.FS.readdir(directory)) {
        const entry = `${directory}/${name}`;
        if ('.' === name || '..' === name) {
            continue;
        }
        if (php.FS.isDir(php.FS.stat(entry).mode)) {
            remove(entry);
            php.FS.rmdir(entry);
        } else {
            php.FS.unlink(entry);
        }
    }
};
remove('/opcache');
if ('precompiled' !== opcache) {
    process.exit(0);
}

// The mtime that api.js gives to what is embedded: opcache checks it
const sources = [];
for (const entry of fs.readdirSync('/embed', { recursive: true, withFileTypes: true })) {
    const file = path.join(entry.parentPath, entry.name);
    if (entry.isFile()) {
        fs.utimesSync(file, 1, 1);
        if (file.endsWith('.php')) {
            sources.push(embedAt + file.slice('/embed'.length));
        }
    }
}

// It warns about a file it does not compile, or does not write
const { exitCode, stdout, stderr } = await php.runCode('foreach (json_decode(file_get_contents("php://stdin")) as $file) { opcache_compile_file($file); }', { stdin: JSON.stringify(sources) });
process.stdout.write(stdout + stderr);
if (0 !== exitCode) {
    throw new Error(`opcache does not compile the files, PHP exits with ${exitCode}.`);
}
const written = fs.readdirSync('/opcache', { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).length;
if (0 === written) {
    throw new Error('opcache does not write what it compiles.');
}
console.log(`opcache compiled ${written} of the ${sources.length} PHP files of ${embedAt}`);
