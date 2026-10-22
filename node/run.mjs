import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import './fetch-files.mjs';

// Runs a PHP file, or some PHP code, in a build, as the php command does:
//
//     node node/run.mjs [--build <.mjs>] (<file.php> | -r <code>) [--] [<args>...]
//
// --build  the php-node.mjs or the php-web.mjs to run, the php-node.mjs of
//          the default stack by default
// -r       PHP code to run, without <?php ?>
//
// PHP gets the arguments in $argv, and what is piped or redirected to the
// command on php://stdin. The command writes what PHP writes, and exits with
// its exit status. The build for the web runs in node too, with
// fetch-files.mjs: what a browser would run can be tested without a browser.

const USAGE = 'Usage: node node/run.mjs [--build <.mjs>] (<file.php> | -r <code>) [--] [<args>...]';

let args;
try {
    args = parseArgs({
        options: {
            build: { type: 'string', default: fileURLToPath(new URL('../build/default/php-node.mjs', import.meta.url)) },
            code: { type: 'string', short: 'r' },
        },
        allowPositionals: true,
    });
} catch (exception) {
    fail(exception.message, USAGE);
}

const build = path.resolve(args.values.build);
const code = args.values.code;
const [file, ...rest] = undefined === code ? args.positionals : [undefined, ...args.positionals];
if ((undefined === file) === (undefined === code)) {
    fail(USAGE);
}
if (!fs.existsSync(build)) {
    fail(`${build} does not exist: build PHP first, with "castor wasm:build [<stack>]" or "docker buildx bake".`);
}
if (undefined !== file && !fs.existsSync(file)) {
    fail(`${file} does not exist.`);
}

const { default: createPhp } = await import(pathToFileURL(build));
const php = await createPhp();

// Read before PHP runs: not from a terminal, nor from a socket, that may never
// end
const stdin = fs.fstatSync(0);
const options = {
    args: rest,
    stdin: stdin.isFIFO() || stdin.isFile() ? fs.readFileSync(0) : '',
};

let result;
if (undefined === code) {
    // The file is read from the disk, at the same path in the WASM filesystem
    const script = path.resolve(file);
    php.FS.mkdirTree(path.dirname(script));
    php.FS.writeFile(script, fs.readFileSync(script));
    result = await php.runFile(script, options);
} else {
    result = await php.runCode(code, options);
}

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.exitCode;

function fail(...lines) {
    console.error(lines.join('\n'));
    process.exit(1);
}
