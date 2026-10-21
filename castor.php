<?php

namespace PhpWasm;

use Castor\Attribute\AsArgument;
use Castor\Attribute\AsOption;
use Castor\Attribute\AsTask;
use Castor\Exception\ProblemException;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Filesystem\Path;

use function Castor\context;
use function Castor\import;
use function Castor\io;
use function Castor\notify;

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
    #[AsOption(description: 'Override the PHP version, for example 8.5.11')]
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

    foreach ($stacks as $selected) {
        io()->writeln(\sprintf(' // Stack "%s": %s', $selected->name, describe($selected)));
    }

    build($stacks);

    foreach ($stacks as $selected) {
        io()->success(array_map(relative(...), $selected->artifacts()));
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

    io()->table(['Stack', 'PHP', 'Extensions', 'Memory', 'ICU data', 'Targets'], $rows);
}

#[AsTask(name: 'sizes', namespace: 'wasm', description: 'Compares the size of what is built with the default stack')]
function sizes_task(): void
{
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
            basename($stack->artifact($target, 'wasm')),
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

    io()->table(['Stack', 'File', 'Size', 'vs ' . DEFAULT_STACK], $rows);
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

    return node($selected->artifact($selected->targets[0], 'mjs'), $arguments, context())->getExitCode();
}

#[AsTask(name: 'test', namespace: 'wasm', description: 'Builds the stacks, then checks from node that what each built boots, with its PHP version and its extensions')]
function test_task(
    #[AsArgument(description: 'The stacks to test, all by default', autocomplete: 'PhpWasm\complete_stacks')]
    array $stacks = [],
    #[AsOption(description: 'Check what is already built')]
    bool $noBuild = false,
    #[AsOption(description: 'Override a value of the bake file, as "docker buildx bake --set" does (the CI gives the cache this way), can be repeated', mode: InputOption::VALUE_REQUIRED | InputOption::VALUE_IS_ARRAY)]
    array $set = [],
): int {
    $stacks = [] === $stacks ? array_values(stacks()) : array_map(stack(...), $stacks);

    if (!$noBuild) {
        build($stacks, $set);
    }

    $failed = 0;
    foreach ($stacks as $stack) {
        try {
            check_stack($stack);
        } catch (ProblemException $exception) {
            ++$failed;
            io()->listing(explode("\n", $exception->getMessage()));
        }
    }

    if ($failed > 0) {
        io()->error(\sprintf('%d of %d stacks are broken.', $failed, \count($stacks)));

        return 1;
    }

    io()->success(\sprintf('%d stacks work.', \count($stacks)));

    return 0;
}

/**
 * @return list<string>
 */
function complete_stacks(): array
{
    return array_keys(stacks());
}
