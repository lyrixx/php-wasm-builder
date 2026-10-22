<?php

namespace PhpWasm;

use Castor\Exception\ProblemException;

use function Castor\context;
use function Castor\fs;
use function Castor\io;
use function Castor\run;

// What a project that requires this package can use.

/**
 * Builds stacks in a single buildx invocation: in parallel, and sharing the
 * layers they have in common.
 *
 * @param list<Stack>  $stacks
 * @param list<string> $set    overrides, given to "docker buildx bake --set",
 *                             for example "*.cache-from=type=gha" for a cache
 *
 * @return list<Stack> the stacks, whose artifact() and artifacts() are built
 */
function build(array $stacks, array $set = []): array
{
    // Not next to what is built: that may be a public directory
    $bakeFile = build_dir() . '/bake.json';
    fs()->dumpFile($bakeFile, bake_definition($stacks) . "\n");

    $command = ['docker', 'buildx', 'bake', '-f', $bakeFile];
    $printed = ' // docker buildx bake -f ' . relative($bakeFile);
    foreach ($set as $override) {
        array_push($command, '--set', $override);
        $printed .= ' --set ' . escapeshellarg($override);
    }
    io()->writeln($printed);

    // buildx asks before it reads or writes outside of the current directory,
    // and waits for an answer that never comes: the builder, what is embedded
    // and where it is built may be outside of it
    $command[] = '--allow=fs.read=' . builder_root();
    foreach ($stacks as $stack) {
        if (null !== $stack->embed) {
            $command[] = '--allow=fs.read=' . $stack->embed;
        }
        // Or buildx asks to write to its parent
        fs()->mkdir($stack->outputDir);
        $command[] = '--allow=fs.write=' . $stack->outputDir;
    }

    run($command);

    foreach ($stacks as $stack) {
        // buildx gives it 0700, a web server or GitHub Pages could not read it
        fs()->chmod($stack->outputDir, 0o777, umask());

        // The output directory is only ever added to: forget about the targets that are not built anymore
        foreach (array_diff(array_keys(Stack::TARGETS), $stack->targets) as $target) {
            fs()->remove([$stack->artifact($target, 'mjs'), $stack->artifact($target, 'wasm')]);
        }
    }

    return $stacks;
}

/**
 * Checks that what a stack built boots, with its PHP version and its
 * extensions, as castor's check() does. It runs every build from node, the one
 * for the web too: no browser is needed.
 *
 * @throws ProblemException with what is wrong
 */
function check_stack(Stack $stack): void
{
    io()->write(\sprintf('Stack "%s": %s', $stack->name, describe($stack)));

    // What is wrong when a PHP expression is false
    $php = $stack->php ?? dockerfile_default('PHP_VERSION');
    $problems = ["PHP_VERSION is not {$php}" => 'PHP_VERSION === ' . var_export($php, true)];
    foreach ($stack->extensions as $extension) {
        $problems["{$extension} is not loaded"] = 'extension_loaded(' . var_export($extension, true) . ')';
    }
    // intl loads without ICU's data, then it only knows locale codes
    if (\in_array('intl', $stack->extensions, true)) {
        $problems += 'none' === $stack->icuData
            ? ['intl does not normalize, or has ICU\'s data' => 'extension_loaded("intl") && Normalizer::normalize("e\u{301}") === "\u{e9}" && Locale::getDisplayLanguage("fr", "en") === "fr"']
            : ['intl does not have ICU\'s data' => 'extension_loaded("intl") && Locale::getDisplayLanguage("fr", "en") === "French"'];
    }
    // SQLite is compiled by the Dockerfile, with options
    $sqlite = "SELECT sqlite_compileoption_used('ENABLE_FTS5') AND sqlite_compileoption_used('ENABLE_MATH_FUNCTIONS')";
    if (\in_array('pdo_sqlite', $stack->extensions, true)) {
        $problems['SQLite does not have FTS5, or the math functions (pdo_sqlite)'] = \sprintf('extension_loaded("pdo_sqlite") && (new PDO("sqlite::memory:"))->query(%s)->fetchColumn() === 1', var_export($sqlite, true));
    }
    if (\in_array('sqlite3', $stack->extensions, true)) {
        $problems['SQLite does not have FTS5, or the math functions (sqlite3)'] = \sprintf('extension_loaded("sqlite3") && (new SQLite3(":memory:"))->querySingle(%s) === 1', var_export($sqlite, true));
    }

    // Prints the problems whose expression is false
    $code = \sprintf('echo json_encode(array_keys(array_filter([%s])));', implode(', ', array_map(
        static fn (string $problem, string $expression): string => var_export($problem, true) . " => !({$expression})",
        array_keys($problems),
        $problems,
    )));

    $found = [];
    foreach ($stack->targets as $target) {
        $build = $stack->artifact($target, 'mjs');
        if (!is_file($build)) {
            $found[] = \sprintf('%s does not exist', relative($build));
            continue;
        }

        $process = node($build, ['-r', $code], context()->withQuiet());
        $wrong = json_decode($process->getOutput(), true);
        foreach ($process->isSuccessful() && \is_array($wrong) ? $wrong : ['it does not run: ' . trim($process->getOutput() . $process->getErrorOutput())] as $problem) {
            $found[] = basename($build) . ': ' . $problem;
        }
    }

    if ([] !== $found) {
        io()->writeln(' ❌');

        throw new ProblemException(implode("\n", $found));
    }

    io()->writeln(' ✅');
}

/**
 * Runs some PHP code in what a stack built, from node: in the build of its
 * first target, the web one by default, as a browser would run it.
 *
 * @return string what PHP prints, without the line breaks at the end
 *
 * @throws ProblemException when PHP does not exit with 0
 */
function run_wasm(Stack $stack, string $code): string
{
    $process = node($stack->artifact($stack->targets[0], 'mjs'), ['-r', $code], context()->withQuiet());
    if (!$process->isSuccessful()) {
        throw new ProblemException(\sprintf('PHP exits with %d in the stack "%s": %s', $process->getExitCode(), $stack->name, trim($process->getOutput() . $process->getErrorOutput())));
    }

    return rtrim($process->getOutput(), "\n");
}

/**
 * Runs the tests of the JavaScript of a page with the test runner of node,
 * preloaded with page.mjs: the modules of the page, and the php-web.mjs they
 * load, run as they are, as in a browser.
 *
 * @param string $file     a test file, relative to the root of the project
 * @param string ...$files more of them
 *
 * @throws ProblemException when a test fails
 */
function test_page(string $file, string ...$files): void
{
    // At least one file: without, node runs every test it finds, the ones of
    // vendor/ too
    $process = run(
        ['node', '--import', builder_root() . '/page.mjs', '--test', $file, ...$files],
        context: context()->withWorkingDirectory(project_root())->withAllowFailure(),
    );
    if (!$process->isSuccessful()) {
        throw new ProblemException(\sprintf('The tests of the page fail, node exits with %d.', $process->getExitCode()));
    }
}
