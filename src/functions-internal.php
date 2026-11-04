<?php

namespace PhpWasm;

use Castor\Context;
use Castor\Helper\PathHelper;
use Symfony\Component\Filesystem\Path;
use Symfony\Component\Process\Process;

use function Castor\run;

// What build() and the tasks of castor.php are made of. Castor never knows how
// to compile PHP: the Dockerfile does. These functions only ask the Dockerfile
// for stacks (see Stack.php), through `docker buildx bake`.

/**
 * The stack that is built when none is given, as docker buildx bake does.
 *
 * @internal
 */
const DEFAULT_STACK = 'php-8.5';

/**
 * The stacks of this repository, that the tasks of castor.php build: the ones
 * of stacks.php, the one of each example, in its stack.php, and the ones of
 * stacks.override.php when there is one, that replace the ones that have the
 * same name.
 *
 * @return array<string, Stack> by name
 *
 * @internal
 */
function stacks(): array
{
    static $stacks;
    if (null !== $stacks) {
        return $stacks;
    }

    $stacks = [];
    $files = [builder_root() . '/stacks.php'];
    foreach (examples() as $example) {
        $files[] = example_stack_file($example);
    }
    foreach ($files as $file) {
        foreach (declared_stacks($file) as $stack) {
            if (isset($stacks[$stack->name])) {
                throw new \UnexpectedValueException(\sprintf('"%s" declares the stack "%s", that another file declares already.', $file, $stack->name));
            }

            $stacks[$stack->name] = $stack;
        }
    }

    if (is_file($override = builder_root() . '/stacks.override.php')) {
        foreach (declared_stacks($override) as $stack) {
            $stacks[$stack->name] = $stack;
        }
    }

    return $stacks;
}

/**
 * The examples: the directories of examples/ that have a stack.php, the stack
 * of their page.
 *
 * @return list<string>
 *
 * @internal
 */
function examples(): array
{
    return array_map(static fn (string $file): string => basename(\dirname($file)), glob(builder_root() . '/examples/*/stack.php') ?: []);
}

/**
 * @internal
 */
function example_stack_file(string $example): string
{
    return builder_root() . "/examples/{$example}/stack.php";
}

/**
 * The stacks that a file declares: a list of them, as stacks.php does, or
 * one, as the stack.php of an example does.
 *
 * @return list<Stack>
 *
 * @internal
 */
function declared_stacks(string $file): array
{
    // In a closure, so that the file only sees its own variables
    $declared = (static fn (): mixed => require $file)();
    $declared = $declared instanceof Stack ? [$declared] : $declared;
    if (!\is_array($declared) || !array_is_list($declared) || [] !== array_filter($declared, static fn (mixed $stack): bool => !$stack instanceof Stack)) {
        throw new \UnexpectedValueException(\sprintf('"%s" must return a "%s", or a list of them.', $file, Stack::class));
    }

    $names = array_map(static fn (Stack $stack): string => $stack->name, $declared);
    // A stack derived from another one, and not renamed
    if ([] !== $twice = array_diff_assoc($names, array_unique($names))) {
        throw new \UnexpectedValueException(\sprintf('"%s" declares the stack "%s" twice.', $file, reset($twice)));
    }

    return $declared;
}

/**
 * @internal
 */
function stack(string $name): Stack
{
    return stacks()[$name] ?? throw new \InvalidArgumentException(\sprintf('Unknown stack "%s", the stacks are: %s.', $name, implode(', ', array_keys(stacks()))));
}

/**
 * @param list<Stack> $stacks
 *
 * @internal
 */
function bake_definition(array $stacks): string
{
    $targets = [];
    $outputDirs = [];
    foreach ($stacks as $stack) {
        // What a bake target name accepts
        $target = preg_replace('/[^a-zA-Z0-9_-]/', '-', $stack->name);
        if (isset($targets[$target])) {
            throw new \InvalidArgumentException(\sprintf('The stack "%s" has the same name as another one, once cleaned up for buildx ("%s").', $stack->name, $target));
        }
        // They would write the same files
        if (isset($outputDirs[$stack->outputDir])) {
            throw new \InvalidArgumentException(\sprintf('The stacks "%s" and "%s" are built in the same directory, "%s".', $outputDirs[$stack->outputDir], $stack->name, relative($stack->outputDir)));
        }
        if (null !== $stack->embed && !is_dir($stack->embed)) {
            throw new \InvalidArgumentException(\sprintf('Cannot embed "%s" in the stack "%s": it is not a directory.', relative($stack->embed), $stack->name));
        }

        $outputDirs[$stack->outputDir] = $stack->name;
        $targets[$target] = [
            'dockerfile' => builder_root() . '/docker/Dockerfile',
            'context' => builder_root() . '/docker',
            // What is not set is the default of the Dockerfile
            'args' => array_filter([
                'PHP_VERSION' => $stack->php,
                'EXTENSIONS' => implode(' ', $stack->extensions),
                'TARGETS' => implode(' ', $stack->targets),
                'MEMORY' => $stack->memory,
                'ICU_DATA' => $stack->icuData?->value,
                // None if nothing is embedded
                'EMBED_AT' => $stack->embedAt ?? '',
                'WARMUP' => [] === $stack->warmup ? null : implode(' ', $stack->warmup),
                'OPCACHE' => $stack->opcache?->value,
            ], static fn (?string $value): bool => null !== $value),
            'output' => ['type=local,dest=' . $stack->outputDir],
        ];
        if (null !== $stack->embed) {
            $targets[$target]['contexts'] = ['embed' => $stack->embed];
        }
    }

    return json_encode([
        'group' => ['default' => ['targets' => array_keys($targets)]],
        'target' => $targets,
    ], \JSON_PRETTY_PRINT | \JSON_UNESCAPED_SLASHES | \JSON_THROW_ON_ERROR);
}

/**
 * Runs a PHP file, or some PHP code, in a build of a stack with node/run.mjs.
 *
 * @param string       $build     the .mjs file of the build
 * @param list<string> $arguments the PHP file, or -r and some code
 *
 * @internal
 */
function node(string $build, array $arguments, Context $context): Process
{
    // No pty: the output of PHP must not be altered, it may go through a pipe
    return run(['node', builder_root() . '/node/run.mjs', '--build', $build, ...$arguments], context: $context->withPty(false)->withAllowFailure());
}

/**
 * The default of a build argument, as declared by the Dockerfile.
 *
 * @internal
 */
function dockerfile_default(string $argument): ?string
{
    $dockerfile = file_get_contents(builder_root() . '/docker/Dockerfile');

    return preg_match('/^ARG ' . preg_quote($argument, '/') . '=(\S+)/m', $dockerfile, $matches) ? trim($matches[1], '"') : null;
}

/**
 * Where docker/ and node/ are.
 *
 * @internal
 */
function builder_root(): string
{
    return \dirname(__DIR__);
}

/**
 * The project that runs castor, which is not always this package.
 *
 * @internal
 */
function project_root(): string
{
    return PathHelper::getRoot();
}

/**
 * @internal
 */
function build_dir(): string
{
    return project_root() . '/build';
}

/**
 * @internal
 */
function relative(string $path): string
{
    return Path::makeRelative($path, getcwd() ?: project_root());
}

/**
 * The PHP version and the extensions of a stack.
 *
 * @internal
 */
function describe(Stack $stack): string
{
    return \sprintf('PHP %s, %s', $stack->php ?? dockerfile_default('PHP_VERSION'), [] === $stack->extensions ? 'no extension' : implode(' ', $stack->extensions));
}
