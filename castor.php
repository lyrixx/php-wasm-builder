<?php

namespace PhpWasm;

use Castor\Attribute\AsArgument;
use Castor\Attribute\AsOption;
use Castor\Attribute\AsTask;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

use function Castor\import;
use function Castor\io;
use function Castor\notify;

// The wasm:* tasks. A project that requires this package only gets build(),
// see src/functions.php, it gets the tasks too with:
//
//     import('composer://lyrixx/php-wasm-builder');
//
// The tasks then build the stacks of both stacks.php files, in the build/
// directory of the project.

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
    #[AsOption(description: 'Add an extension, can be repeated', mode: InputOption::VALUE_REQUIRED | InputOption::VALUE_IS_ARRAY, autocomplete: 'PhpWasm\complete_extensions')]
    array $with = [],
    #[AsOption(description: 'Only build this target (web or node), can be repeated', mode: InputOption::VALUE_REQUIRED | InputOption::VALUE_IS_ARRAY, autocomplete: ['web', 'node'])]
    array $target = [],
    #[AsOption(description: 'Override the memory of the WASM module, for example 256mb')]
    ?string $memory = null,
    #[AsOption(description: 'Override the directory to embed')]
    ?string $embed = null,
    #[AsOption(description: 'Print the bake file instead of building')]
    bool $print = false,
): int {
    if ($all) {
        if (null !== $stack || null !== $php || [] !== $with || [] !== $target || null !== $memory || null !== $embed) {
            throw new \InvalidArgumentException('--all builds every stack as declared, it can not be combined with a stack or with overrides.');
        }

        $builds = array_map(resolve(...), stacks()->names());
    } else {
        $builds = [stacks()->resolve($stack ?? Stacks::DEFAULT, build_dir(), php: $php, with: $with, targets: $target, memory: $memory, embed: $embed)];
    }

    if ($print) {
        io()->writeln(bake_definition($builds), OutputInterface::OUTPUT_RAW);

        return 0;
    }

    foreach ($builds as $build) {
        io()->writeln(\sprintf(' // Stack "%s": PHP %s · %s', $build->name, $build->php ?? 'default', [] === $build->extensions ? 'no extension' : implode(' ', $build->extensions)));
    }

    bake($builds);

    foreach ($builds as $build) {
        io()->success(array_map(relative(...), $build->artifacts()));
    }

    notify(1 === \count($builds) ? \sprintf('Stack "%s" is built', $builds[0]->name) : \sprintf('%d stacks are built', \count($builds)));

    return 0;
}

#[AsTask(name: 'stacks', namespace: 'wasm', description: 'Lists the stacks')]
function stacks_task(
    #[AsOption(description: 'Only print their names, as JSON (the CI builds one stack per job)')]
    bool $json = false,
): void {
    if ($json) {
        io()->writeln(json_encode(stacks()->names(), \JSON_UNESCAPED_SLASHES | \JSON_THROW_ON_ERROR), OutputInterface::OUTPUT_RAW);

        return;
    }

    $rows = [];
    foreach (stacks()->names() as $name) {
        $stack = stacks()->describe($name);
        $rows[] = [$name, $stack['php'], $stack['extensions'], $stack['targets']];
    }

    io()->table(['Stack', 'PHP', 'Extensions', 'Targets'], $rows);
}

#[AsTask(name: 'sizes', namespace: 'wasm', description: 'Compares the size of what is built with the default stack')]
function sizes_task(): void
{
    $size = static fn (string $stack, string $file): ?int => is_file($path = build_dir() . '/' . $stack . '/' . $file) ? (int) filesize($path) : null;

    $rows = [];
    foreach (stacks()->names() as $name) {
        // The web build is the one that matters, and the one everybody has
        foreach (['php-web.wasm', 'php-cli.wasm'] as $file) {
            if (null === $bytes = $size($name, $file)) {
                continue;
            }

            $reference = $size(Stacks::DEFAULT, $file);
            $rows[] = [
                $name,
                $file,
                \sprintf('%.1f MB', $bytes / 1024 / 1024),
                Stacks::DEFAULT === $name ? '-' : (null === $reference ? 'n/a' : \sprintf('%+.1f %%', ($bytes / $reference - 1) * 100)),
            ];

            break;
        }
    }

    if ([] === $rows) {
        io()->warning('Nothing is built yet, run "castor wasm:build".');

        return;
    }

    io()->table(['Stack', 'File', 'Size', 'vs ' . Stacks::DEFAULT], $rows);
}

#[AsTask(name: 'run', namespace: 'wasm', description: 'Runs a PHP file, or some code with -r, in a built stack (node target)')]
function run_task(
    #[AsArgument(description: 'The PHP file to run')]
    ?string $file = null,
    #[AsOption(shortcut: 'r', description: 'The PHP code to run, without <?php ?>')]
    ?string $code = null,
    #[AsOption(description: 'The stack to run', autocomplete: 'PhpWasm\complete_stacks')]
    string $stack = Stacks::DEFAULT,
): int {
    if ((null === $file) === (null === $code)) {
        throw new \InvalidArgumentException('Give the PHP file to run, or the code to run with -r.');
    }

    $arguments = null !== $code ? ['-r', $code] : [is_file($file) ? realpath($file) : throw new \InvalidArgumentException(\sprintf('The file "%s" does not exist.', $file))];

    return node(resolve($stack), $arguments)->getExitCode() ?? 1;
}

#[AsTask(name: 'test', namespace: 'wasm', description: 'Builds the stacks, then checks from node that each has the right PHP version and its extensions')]
function test_task(
    #[AsArgument(description: 'The stacks to test, all by default', autocomplete: 'PhpWasm\complete_stacks')]
    array $stacks = [],
    #[AsOption(description: 'Check what is already built')]
    bool $noBuild = false,
    #[AsOption(description: 'Override a value of the bake file, as "docker buildx bake --set" does (the CI gives the cache this way), can be repeated', mode: InputOption::VALUE_REQUIRED | InputOption::VALUE_IS_ARRAY)]
    array $set = [],
): int {
    $names = [] !== $stacks ? $stacks : stacks()->names();

    if (!$noBuild) {
        // The checks run on node, so every stack needs that target
        bake(array_map(static fn (string $name): Build => resolve($name)->withTarget('node'), $names), $set);
    }

    $failed = 0;
    foreach ($names as $name) {
        $build = resolve($name);
        $problems = check($build);

        if ([] === $problems) {
            io()->writeln(\sprintf(' <info>✔</info> %s: PHP %s, %s', $build->name, $build->php ?? 'default', [] === $build->extensions ? 'no extension' : implode(' ', $build->extensions)));
            continue;
        }

        ++$failed;
        io()->writeln(\sprintf(' <error>✘</error> %s', $build->name));
        io()->listing($problems);
    }

    if ($failed > 0) {
        io()->error(\sprintf('%d of %d stacks are broken.', $failed, \count($names)));

        return 1;
    }

    io()->success(\sprintf('%d stacks work.', \count($names)));

    return 0;
}

/**
 * @return list<string>
 */
function complete_stacks(): array
{
    return stacks()->names();
}

/**
 * @return list<string>
 */
function complete_extensions(): array
{
    // What the Dockerfile knows: ext <name> ...
    preg_match_all('/^ext (\w+)\s/m', (string) file_get_contents(builder_root() . '/Dockerfile'), $matches);

    return $matches[1];
}
