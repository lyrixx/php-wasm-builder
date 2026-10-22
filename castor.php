<?php

namespace PhpWasm;

use Castor\Attribute\AsArgument;
use Castor\Attribute\AsOption;
use Castor\Attribute\AsTask;
use Castor\Exception\ProblemException;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Filesystem\Path;
use Symfony\Component\Finder\SplFileInfo;

use function Castor\context;
use function Castor\finder;
use function Castor\import;
use function Castor\io;
use function Castor\notify;
use function Castor\run;

// The wasm:* tasks, that build the stacks of stacks.php, and of
// stacks.override.php when there is one (it is not versioned: the stacks of
// whoever uses this repository as it is). A project that requires this package
// only gets build(), see src/functions.php.

defined('CASTOR_USE_CHDIR') || define('CASTOR_USE_CHDIR', false);

// Composer autoloads them when the package is required by another project
import(__DIR__ . '/src');

#[AsTask(name: 'build', namespace: 'wasm', description: 'Builds a stack: the default one when none is given')]
function build_task(
    #[AsArgument(description: 'The stack to build', autocomplete: 'PhpWasm\complete_stacks')]
    ?string $stack = null,
    #[AsOption(description: 'Build every stack, in one buildx invocation')]
    bool $all = false,
    #[AsOption(description: 'Override the PHP version, for example 8.5.12')]
    ?string $php = null,
    #[AsOption(description: 'Add an extension, can be repeated', mode: InputOption::VALUE_REQUIRED | InputOption::VALUE_IS_ARRAY, autocomplete: Stack::EXTENSIONS)]
    array $with = [],
    #[AsOption(description: 'Only build this target (web or node), can be repeated', mode: InputOption::VALUE_REQUIRED | InputOption::VALUE_IS_ARRAY, autocomplete: ['web', 'node'])]
    array $target = [],
    #[AsOption(description: 'Override the memory of the WASM module, for example 256mb')]
    ?string $memory = null,
    #[AsOption(description: 'Override the directory to embed')]
    ?string $embed = null,
    #[AsOption(description: 'Override the ICU data of intl: all or none', autocomplete: Stack::ICU_DATA)]
    ?string $icuData = null,
    #[AsOption(description: 'Print the bake file instead of building')]
    bool $print = false,
): void {
    if ($all && null !== $stack) {
        throw new \InvalidArgumentException('--all builds every stack, it can not be combined with a stack.');
    }

    $stacks = $all ? array_values(stacks()) : [stack($stack ?? DEFAULT_STACK)];
    foreach ($stacks as $i => $selected) {
        $selected = $selected->extensions(...$with);
        if (null !== $php) {
            $selected = $selected->php($php);
        }
        if ([] !== $target) {
            $selected = $selected->targets(...$target);
        }
        if (null !== $memory) {
            $selected = $selected->memory($memory);
        }
        if (null !== $embed) {
            // It comes from the command line: relative to where the command is run
            $selected = $selected->embed(Path::makeAbsolute($embed, getcwd() ?: project_root()));
        }
        if (null !== $icuData) {
            $selected = $selected->icuData($icuData);
        }
        $stacks[$i] = $selected;
    }

    if ($print) {
        io()->writeln(bake_definition($stacks), OutputInterface::OUTPUT_RAW);

        return;
    }

    io()->title(1 === \count($stacks) ? \sprintf('Building the stack "%s"', $stacks[0]->name) : \sprintf('Building %d stacks', \count($stacks)));

    foreach ($stacks as $selected) {
        io()->writeln(\sprintf(' // Stack "%s": %s', $selected->name, describe($selected)));
    }

    build($stacks);

    foreach ($stacks as $selected) {
        io()->success(array_map(relative(...), $selected->artifacts()));
    }

    if (1 === \count($stacks)) {
        io()->text(next_step($stacks[0]));
    }

    notify(1 === \count($stacks) ? \sprintf('Stack "%s" is built', $stacks[0]->name) : \sprintf('%d stacks are built', \count($stacks)));
}

#[AsTask(name: 'stacks', namespace: 'wasm', description: 'Lists the stacks')]
function stacks_task(
    #[AsOption(description: 'Only print their names, as JSON (the CI builds one stack per job)')]
    bool $json = false,
): void {
    if ($json) {
        io()->writeln(json_encode(array_keys(stacks()), \JSON_THROW_ON_ERROR), OutputInterface::OUTPUT_RAW);

        return;
    }

    $rows = [];
    foreach (stacks() as $stack) {
        $rows[] = [
            $stack->name,
            $stack->php ?? dockerfile_default('PHP_VERSION'),
            wordwrap(implode(' ', $stack->extensions), 44) ?: '-',
            $stack->memory ?? dockerfile_default('MEMORY'),
            \in_array('intl', $stack->extensions, true) ? $stack->icuData ?? dockerfile_default('ICU_DATA') : '-',
            implode(' ', $stack->targets),
        ];
    }

    io()->title('Stacks');
    io()->table(['Stack', 'PHP', 'Extensions', 'Memory', 'ICU data', 'Targets'], $rows);
    io()->text('Build one with "castor wasm:build <stack>", or all of them with "castor wasm:build --all".');
}

#[AsTask(name: 'sizes', namespace: 'wasm', description: 'Compares the size of what is built with the default stack')]
function sizes_task(): void
{
    io()->title('Size of the .wasm files');

    $size = static fn (Stack $stack, string $target): ?int => is_file($path = $stack->artifact($target, 'wasm')) ? filesize($path) : null;

    $rows = [];
    foreach (stacks() as $stack) {
        // The web build is the one that matters, and the one everybody has
        $target = null !== $size($stack, 'web') ? 'web' : 'node';
        if (null === $bytes = $size($stack, $target)) {
            continue;
        }

        $reference = $size(stack(DEFAULT_STACK), $target);
        $rows[] = [
            $stack->name,
            \sprintf('%.1f MB', $bytes / 1024 / 1024),
            match (true) {
                DEFAULT_STACK === $stack->name => '-',
                null === $reference => 'n/a',
                default => \sprintf('%+.1f %%', ($bytes / $reference - 1) * 100),
            },
        ];
    }

    if ([] === $rows) {
        io()->warning('Nothing is built yet, run "castor wasm:build".');

        return;
    }

    io()->table(['Stack', 'Size', 'vs ' . DEFAULT_STACK], $rows);
}

#[AsTask(name: 'run', namespace: 'wasm', description: 'Runs a PHP file, or some code with -r, in a built stack')]
function run_task(
    #[AsArgument(description: 'The PHP file to run')]
    ?string $file = null,
    #[AsOption(shortcut: 'r', description: 'The PHP code to run, without <?php ?>')]
    ?string $code = null,
    #[AsOption(description: 'The stack to run', autocomplete: 'PhpWasm\complete_stacks')]
    string $stack = DEFAULT_STACK,
): int {
    if ((null === $file) === (null === $code)) {
        throw new \InvalidArgumentException('Give the PHP file to run, or the code to run with -r.');
    }

    // castor does not run it from where the command is run
    $arguments = null === $code ? [Path::makeAbsolute($file, getcwd() ?: project_root())] : ['-r', $code];
    $selected = stack($stack);

    // On stderr: what PHP prints may go through a pipe
    $stderr = io()->getErrorStyle();
    $stderr->title(\sprintf('Running %s in the stack "%s"', null === $code ? relative($arguments[0]) : 'some code', $selected->name));
    build_if_missing($selected);

    $process = node($selected->artifact($selected->targets[0], 'mjs'), $arguments, context());

    // For the prompt of the shell
    if ('' !== $process->getOutput() && !str_ends_with($process->getOutput(), "\n")) {
        $stderr->newLine();
    }
    if (!$process->isSuccessful()) {
        $stderr->newLine();
        $stderr->error(\sprintf('PHP exits with %d.', $process->getExitCode()));
    }

    return $process->getExitCode();
}

#[AsTask(name: 'serve', namespace: 'wasm', description: 'Builds the page of an example, then serves its public/ directory on 127.0.0.1: lists them when none is given')]
function serve_task(
    #[AsArgument(description: 'The example to serve, a directory of examples/', autocomplete: 'PhpWasm\examples')]
    ?string $example = null,
    #[AsOption(description: 'Build the page with the PHP version and the extensions of another stack, intl for example', autocomplete: 'PhpWasm\complete_stacks')]
    ?string $stack = null,
    #[AsOption(description: 'The port to listen to')]
    int $port = 8000,
): int {
    if (null === $example) {
        $rows = [];
        foreach (examples() as $name) {
            // What the page says it is
            $page = file_get_contents(builder_root() . "/examples/{$name}/public/index.html");
            $rows[] = [$name, preg_match('{<title>(.*?)</title>}s', $page, $matches) ? trim($matches[1]) : ''];
        }

        io()->title('Examples that have a page');
        io()->table(['Example', 'Page'], $rows);
        io()->text([
            'Serve one with "castor wasm:serve <example>": its stack is built first, in a second when nothing changed.',
            'With "--stack <stack>", the page gets the PHP version and the extensions of another stack.',
        ]);

        return 0;
    }

    if (!\in_array($example, examples(), true)) {
        throw new \InvalidArgumentException(\sprintf('Unknown example "%s", the examples with a page are: %s.', $example, implode(', ', examples())));
    }

    io()->title(\sprintf('Serving the example "%s"', $example) . (null !== $stack ? \sprintf(', with the stack "%s"', $stack) : ''));

    // The built-in server only says it once started
    if (false !== $socket = @fsockopen('127.0.0.1', $port, timeout: 1)) {
        fclose($socket);

        throw new ProblemException(\sprintf('Something already listens to the port %d: give another one, with --port %d for example.', $port, $port + 1));
    }

    // Built every time: what the page embeds may have changed, or it may have
    // been built with another stack
    $page = example_stack($example);
    if (null !== $page) {
        if (null !== $stack) {
            // What the page needs, but the PHP version and the extensions
            $other = stack($stack)->targets(...$page->targets)->outputDir($page->outputDir);
            $page = null === $page->embed ? $other : $other->embed($page->embed, at: $page->embedAt);
        }

        build([$page]);
    }

    // After what buildx prints: it must stand out
    io()->success([
        "The page is on http://127.0.0.1:{$port}/",
        'It changes with a reload, its PHP when the server starts again. Ctrl+C stops the server.',
    ]);

    // The built-in server of the PHP of the host
    return run(['php', '-S', "127.0.0.1:{$port}", '-t', builder_root() . "/examples/{$example}/public"], context: context()->withAllowFailure())->getExitCode();
}

#[AsTask(name: 'check', namespace: 'wasm', description: 'Builds the stacks, then checks from node that what each built boots, with its PHP version, its extensions and its JavaScript API')]
function check_task(
    #[AsArgument(description: 'The stacks to check, all by default', autocomplete: 'PhpWasm\complete_stacks')]
    array $stacks = [],
    #[AsOption(description: 'Check what is already built')]
    bool $noBuild = false,
    #[AsOption(description: 'Override a value of the bake file, as "docker buildx bake --set" does (the CI gives the cache this way), can be repeated', mode: InputOption::VALUE_REQUIRED | InputOption::VALUE_IS_ARRAY)]
    array $set = [],
): int {
    $stacks = [] === $stacks ? array_values(stacks()) : array_map(stack(...), $stacks);

    io()->title(1 === \count($stacks) ? \sprintf('Checking the stack "%s"', $stacks[0]->name) : \sprintf('Checking %d stacks', \count($stacks)));

    if (!$noBuild) {
        build($stacks, $set);
    }

    $failed = 0;
    foreach ($stacks as $stack) {
        try {
            check_stack($stack);
            check_api($stack);
        } catch (ProblemException $exception) {
            ++$failed;
            io()->listing(explode("\n", $exception->getMessage()));
        }
    }

    if ($failed > 0) {
        io()->error(\sprintf('%d of %d stacks are broken.', $failed, \count($stacks)));

        return 1;
    }

    io()->success(1 === \count($stacks) ? \sprintf('The stack "%s" works.', $stacks[0]->name) : \sprintf('The %d stacks work.', \count($stacks)));

    return 0;
}

/**
 * Runs the tests of the JavaScript API, tests/api.test.mjs, on every build of
 * a stack.
 *
 * @throws ProblemException with the tests that fail
 */
function check_api(Stack $stack): void
{
    io()->write(\sprintf('Stack "%s": the JavaScript API', $stack->name));

    foreach ($stack->targets as $target) {
        $build = $stack->artifact($target, 'mjs');
        $process = run(
            ['node', '--import', builder_root() . '/node/fetch-files.mjs', '--test', builder_root() . '/tests/api.test.mjs'],
            context: context()->withEnvironment(['BUILD' => $build])->withQuiet()->withAllowFailure(),
        );
        if (!$process->isSuccessful()) {
            io()->writeln(' ❌');

            throw new ProblemException(\sprintf('%s: %s', basename($build), trim($process->getOutput())));
        }
    }

    io()->writeln(' ✅');
}

/**
 * Builds a stack if it is not built yet, once asked: what a run needs first.
 *
 * @throws ProblemException when it is not built, and should not be
 */
function build_if_missing(Stack $stack): void
{
    if ([] === array_filter($stack->artifacts(), static fn (string $file): bool => !is_file($file))) {
        return;
    }

    // On stderr, as what run_task() says
    if (!io()->getErrorStyle()->confirm(\sprintf('The stack "%s" is not built yet. Build it now? It takes a few minutes the first time.', $stack->name))) {
        throw new ProblemException(\sprintf('Build it first, with "castor wasm:build %s".', $stack->name));
    }

    build([$stack]);
}

/**
 * What to do with a stack once it is built.
 */
function next_step(Stack $stack): string
{
    foreach (examples() as $example) {
        if ($stack->name === example_stack($example)?->name) {
            return \sprintf('Serve the page it is built for with "castor wasm:serve %s".', $example);
        }
    }

    return \sprintf('Run PHP in it with "castor wasm:run -r \'echo PHP_VERSION;\' --stack %s".', $stack->name);
}

/**
 * @return list<string>
 */
function complete_stacks(): array
{
    return array_keys(stacks());
}

/**
 * The examples that have a page: the directories of examples/ that have a
 * public/ directory.
 *
 * @return list<string>
 */
function examples(): array
{
    $publics = finder()->directories()->in(builder_root() . '/examples')->depth(1)->name('public')->sortByName();

    return array_map(static fn (SplFileInfo $public): string => $public->getRelativePath(), iterator_to_array($publics, false));
}

/**
 * The stack that is built in the public/ directory of an example, if one is.
 */
function example_stack(string $example): ?Stack
{
    $public = builder_root() . "/examples/{$example}/public/";
    foreach (stacks() as $stack) {
        if (str_starts_with($stack->outputDir . '/', $public)) {
            return $stack;
        }
    }

    return null;
}
