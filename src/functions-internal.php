<?php

namespace PhpWasm;

use Castor\Helper\PathHelper;
use Symfony\Component\Filesystem\Path;

use function Castor\context;
use function Castor\run;

// What build() and the tasks of castor.php are made of. Castor never knows how
// to compile PHP: the Dockerfile does. These functions only ask the Dockerfile
// for stacks (see Stack.php), through `docker buildx bake`.

/**
 * The stack that is built when none is given, as docker buildx bake does.
 *
 * @internal
 */
const DEFAULT_STACK = 'default';

/**
 * The stacks of this repository, that the tasks of castor.php build: the ones
 * of stacks.php, and of stacks.override.php when there is one, that replace
 * the ones that have the same name.
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
    foreach (['stacks.php', 'stacks.override.php'] as $file) {
        if (!is_file($path = builder_root() . '/' . $file)) {
            continue;
        }

        $declared = [];
        // In a closure, so that the file only sees its own variables
        foreach ((static fn (): array => require $path)() as $stack) {
            if (!$stack instanceof Stack) {
                throw new \UnexpectedValueException(\sprintf('"%s" must return a list of "%s".', $path, Stack::class));
            }
            // A stack derived from another one, and not renamed
            if (isset($declared[$stack->name])) {
                throw new \UnexpectedValueException(\sprintf('"%s" declares the stack "%s" twice.', $path, $stack->name));
            }

            $declared[$stack->name] = true;
            $stacks[$stack->name] = $stack;
        }
    }

    return $stacks;
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
            'dockerfile' => builder_root() . '/Dockerfile',
            'context' => builder_root(),
            // What is not set is the default of the Dockerfile
            'args' => array_filter([
                'PHP_VERSION' => $stack->php,
                'EXTENSIONS' => implode(' ', $stack->extensions),
                'TARGETS' => implode(' ', $stack->targets),
                'MEMORY' => $stack->memory,
                'ICU_DATA' => $stack->icuData,
                // None if nothing is embedded
                'EMBED_PATH' => $stack->embedPath ?? '',
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
 * Checks from node that a built stack has its PHP version and its extensions.
 *
 * @return list<string> what is wrong with the stack, nothing when it works
 *
 * @internal
 */
function check(Stack $stack): array
{
    $runner = $stack->artifact('node', 'mjs');
    if (!is_file($runner)) {
        return [\sprintf('"%s" does not exist', relative($runner))];
    }

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

    // Prints the problems whose expression is false
    $code = \sprintf('echo json_encode(array_keys(array_filter([%s])));', implode(', ', array_map(
        static fn (string $problem, string $expression): string => var_export($problem, true) . " => !({$expression})",
        array_keys($problems),
        $problems,
    )));

    $process = run(
        ['node', builder_root() . '/run.mjs', '--build', $runner, '-r', $code],
        context: context()->withPty(false)->withQuiet()->withAllowFailure(),
    );
    $found = json_decode($process->getOutput(), true);

    return $process->isSuccessful() && \is_array($found) ? $found : ['it does not run: ' . trim($process->getOutput() . $process->getErrorOutput())];
}

/**
 * The default of a build argument, as declared by the Dockerfile.
 *
 * @internal
 */
function dockerfile_default(string $argument): ?string
{
    $dockerfile = file_get_contents(builder_root() . '/Dockerfile');

    return preg_match('/^ARG ' . preg_quote($argument, '/') . '=(\S+)/m', $dockerfile, $matches) ? trim($matches[1], '"') : null;
}

/**
 * Where the Dockerfile, the shim and the runner are.
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
