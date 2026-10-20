import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// Runs some PHP code, or a PHP file, in a build for node (php-cli.mjs), and
// exits with the exit status of PHP:
//
//     node run.mjs [--build <php-cli.mjs>] (<file.php> | -r <code>)
//
// --build  the php-cli.mjs of the stack to run, the default one by default
// -r       PHP code to run, without <?php ?>

const USAGE = 'Usage: node run.mjs [--build <php-cli.mjs>] (<file.php> | -r <code>)';

let args;
try {
    args = parseArgs({
        options: {
            build: { type: 'string', default: fileURLToPath(new URL('build/default/php-cli.mjs', import.meta.url)) },
            code: { type: 'string', short: 'r' },
        },
        allowPositionals: true,
    });
} catch (exception) {
    fail(exception.message, USAGE);
}

const build = path.resolve(args.values.build);
const code = args.values.code;
const [file, ...more] = args.positionals;
if (more.length > 0 || (file === undefined) === (code === undefined)) {
    fail(USAGE);
}
if (!fs.existsSync(build)) {
    fail(`${build} does not exist: build PHP for node first, with "castor wasm:build [<stack>]" or "docker buildx bake".`);
}
if (file !== undefined && !fs.existsSync(file)) {
    fail(`${file} does not exist.`);
}

const { default: createPhpModule } = await import(pathToFileURL(build));

const stdout = lineWriter(process.stdout);
const stderr = lineWriter(process.stderr);
const { ccall } = await createPhpModule({
    print: stdout.write,
    printErr: stderr.write,
});

// The code of a file starts in HTML mode, the one of -r in PHP mode
process.exitCode = ccall('phpw_run', 'number', ['string'], [code ?? '?>' + fs.readFileSync(file, 'utf8')]);

stdout.end();
stderr.end();

/**
 * print() and printErr() get what PHP writes line by line, without the line
 * breaks. phpw_run() then writes one more line break on both, to flush what is
 * left: when the output of PHP ends with a line break, the last line is an
 * empty one that PHP did not write.
 */
function lineWriter(stream) {
    let previous = null;

    return {
        write(line) {
            if (previous !== null) {
                stream.write(previous + '\n');
            }
            previous = line;
        },
        end() {
            // A line break after the output, if PHP did not write one, for the
            // shell prompt
            if (previous) {
                stream.write(previous + '\n');
            }
        },
    };
}

function fail(...lines) {
    console.error(lines.join('\n'));
    process.exit(1);
}
