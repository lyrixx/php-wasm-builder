import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, styleText } from 'node:util';

// Runs some PHP code, or a PHP file, in a build for node (php-cli.mjs):
//
//     node run.mjs [--build <php-cli.mjs>] (<file.php> | -r <code>)
//
// --build  the php-cli.mjs of the stack to run, the default one by default
// -r       PHP code to run, without <?php ?>
//
// It exits with the exit status of PHP.

const USAGE = 'Usage: node run.mjs [--build <php-cli.mjs>] (<file.php> | -r <code>)';
const DEFAULT_BUILD = fileURLToPath(new URL('build/default/php-cli.mjs', import.meta.url));

const { build, code, file } = parseArguments();

if (!fs.existsSync(build)) {
    fail(...howToBuild(build));
}
if (file !== null && !fs.existsSync(file)) {
    fail(error(`${file} does not exist.`));
}

const { default: createPhpModule } = await import(pathToFileURL(build));

const stdout = lineWriter(process.stdout);
const stderr = lineWriter(process.stderr);
const { ccall } = await createPhpModule({
    print: stdout.write,
    printErr: stderr.write,
});

// The code of a file starts in HTML mode, the one of -r in PHP mode
const status = ccall('phpw_run', 'number', ['string'], [code ?? '?>' + fs.readFileSync(file, 'utf8')]);

stdout.end();
stderr.end();
process.exitCode = status;

/**
 * @returns {{build: string, code: string|null, file: string|null}}
 */
function parseArguments() {
    let parsed;
    try {
        parsed = parseArgs({
            options: {
                build: { type: 'string' },
                code: { type: 'string', short: 'r' },
            },
            allowPositionals: true,
        });
    } catch (exception) {
        fail(error(exception.message), '', USAGE);
    }

    const { values, positionals } = parsed;
    const code = values.code ?? null;
    const file = positionals[0] ?? null;
    if (positionals.length > 1 || (file === null) === (code === null)) {
        fail(USAGE);
    }

    return {
        build: values.build === undefined ? DEFAULT_BUILD : path.resolve(values.build),
        code,
        file,
    };
}

/**
 * What to do when the build to run does not exist.
 *
 * @returns {string[]}
 */
function howToBuild(build) {
    const lines = [error(`${path.relative(process.cwd(), build)} does not exist.`), ''];

    if (build !== DEFAULT_BUILD) {
        // castor builds each stack in build/<stack>/
        return [
            ...lines,
            'Build PHP for node (the "node" target) first, with castor:',
            '',
            `    castor wasm:build ${path.basename(path.dirname(build))}`,
            '',
        ];
    }

    // docker buildx bake needs docker-bake.hcl, which is next to this file
    const root = path.relative(process.cwd(), path.dirname(fileURLToPath(import.meta.url)));

    return [
        ...lines,
        'Build PHP for node (the "node" target) first, with Docker:',
        '',
        `    ${root ? `cd ${root} && ` : ''}docker buildx bake`,
        '',
        'or with castor:',
        '',
        '    castor wasm:build',
        '',
    ];
}

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

function error(message) {
    return styleText(['bold', 'red'], message);
}

function fail(...lines) {
    console.error(lines.join('\n'));
    process.exit(1);
}
