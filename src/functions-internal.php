<?php

namespace PhpWasm;

use Castor\Helper\PathHelper;
use Symfony\Component\Filesystem\Path;
use Symfony\Component\Process\Process;

use function Castor\capture;
use function Castor\context;
use function Castor\fs;
use function Castor\io;
use function Castor\run;

// What build() and the tasks of castor.php are made of. Castor never knows how
// to compile PHP: the Dockerfile does. These functions only know how to name a
// combination (a stack, see Stack.php) and ask the Dockerfile for it, through
// `docker buildx bake`.

/**
 * The stacks of this repository, that the tasks of castor.php build.
 *
 * @internal
 */
function stacks(): Stacks
{
    static $stacks;

    return $stacks ??= Stacks::load(builder_root());
}

/**
 * Turns a stack into what the Dockerfile builds, in the build/<stack>/
 * directory of the project.
 *
 * @internal
 */
function resolve(Stack $stack): Build
{
    $embed = $stack->getEmbed();
    if (null !== $embed) {
        $embed = Path::makeAbsolute($embed, project_root());
        if (!is_dir($embed)) {
            throw new \InvalidArgumentException(\sprintf('Cannot embed "%s" in the stack "%s": it is not a directory.', $embed, $stack->getName()));
        }
    }

    return new Build(
        $stack->getName(),
        $stack->getPhp() ?? dockerfile_default('PHP_VERSION'),
        $stack->getExtensions(),
        $embed,
        $stack->getTargets() ?? array_keys(Build::TARGETS),
        $stack->getMemory(),
        build_dir() . '/' . $stack->getName(),
    );
}

/**
 * Builds what is resolved, in a single buildx invocation.
 *
 * @param list<Build>  $builds
 * @param list<string> $set    overrides, given to "docker buildx bake --set"
 *
 * @internal
 */
function bake(array $builds, array $set = []): void
{
    $bakeFile = 1 === \count($builds) ? $builds[0]->outputDir . '/bake.json' : build_dir() . '/bake.json';
    fs()->dumpFile($bakeFile, bake_definition($builds) . "\n");

    $command = ['docker', 'buildx', 'bake', '-f', $bakeFile];
    $printed = ' // docker buildx bake -f ' . relative($bakeFile);
    foreach ($set as $override) {
        array_push($command, '--set', $override);
        $printed .= ' --set ' . escapeshellarg($override);
    }

    // buildx asks before it reads or writes outside of the current directory,
    // which the builder (when the project requires it) and the stacks may be
    foreach ([builder_root(), ...array_filter(array_map(static fn (Build $build): ?string => $build->embed, $builds))] as $read) {
        $command[] = '--allow=fs.read=' . $read;
    }
    foreach ($builds as $build) {
        $command[] = '--allow=fs.write=' . $build->outputDir;
    }

    io()->writeln($printed);
    run($command);

    foreach ($builds as $build) {
        // The output directory is only ever added to: forget about the targets that are not built anymore
        foreach (Build::TARGETS as $name => $file) {
            if (!\in_array($name, $build->targets, true)) {
                fs()->remove([$build->artifact($name, 'mjs'), $build->artifact($name, 'wasm')]);
            }
        }
    }
}

/**
 * @param list<Build> $builds
 *
 * @internal
 */
function bake_definition(array $builds): string
{
    $targets = [];
    foreach ($builds as $build) {
        if (isset($targets[$build->bakeName()])) {
            throw new \LogicException(\sprintf('The stack "%s" has the same name as another one, once cleaned up for buildx ("%s").', $build->name, $build->bakeName()));
        }

        $targets[$build->bakeName()] = $build->bakeTarget(builder_root());
    }

    return json_encode([
        'group' => ['default' => ['targets' => array_keys($targets)]],
        'target' => $targets,
    ], \JSON_PRETTY_PRINT | \JSON_UNESCAPED_SLASHES | \JSON_THROW_ON_ERROR);
}

/**
 * Runs the node runner on a built stack.
 *
 * @param list<string> $arguments the PHP file, or -r and some code
 *
 * @internal
 */
function node(Build $build, array $arguments): Process
{
    if (!is_file($runner = $build->artifact('node', 'mjs'))) {
        throw new \RuntimeException(\sprintf('"%s" does not exist: build the stack with the node target first ("castor wasm:build %s").', relative($runner), $build->name));
    }

    // No pty: the output of PHP must not be altered, it may go through a pipe
    return run(
        ['node', builder_root() . '/run.mjs', '--build', $runner, ...$arguments],
        context: context()->withPty(false)->withAllowFailure(),
    );
}

/**
 * What has to be true for an extension to work, when extension_loaded() is not
 * enough: intl loads without ICU's data, then it only knows locale codes.
 *
 * @internal
 */
const CHECKS = [
    'intl' => 'Locale::getDisplayLanguage("fr", "en") === "French"',
];

/**
 * Checks from node that a built stack has the PHP version and the extensions
 * it was asked for.
 *
 * @return list<string> what is wrong with the stack, nothing when it works
 *
 * @internal
 */
function check(Build $build): array
{
    if (!is_file($runner = $build->artifact('node', 'mjs'))) {
        return [\sprintf('"%s" does not exist', relative($runner))];
    }

    $checks = array_intersect_key(CHECKS, array_flip($build->extensions));
    $works = array_map(
        static fn (string $extension, string $check): string => \sprintf('%1$s => extension_loaded(%1$s) && %2$s', var_export($extension, true), $check),
        array_keys($checks),
        $checks,
    );

    $code = '$e = ' . var_export($build->extensions, true) . '; echo json_encode(["version" => PHP_VERSION, "loaded" => array_map("extension_loaded", $e), "works" => [' . implode(', ', $works) . ']]);';

    try {
        $output = capture(
            ['node', builder_root() . '/run.mjs', '--build', $runner, '-r', $code],
            context: context()->withPty(false),
        );
    } catch (\Throwable $e) {
        return ['node failed: ' . $e->getMessage()];
    }

    $result = json_decode($output, true);
    if (!\is_array($result) || !isset($result['version'], $result['loaded'])) {
        return ['unexpected output: ' . $output];
    }

    $problems = [];
    if (null !== $build->php && $build->php !== $result['version']) {
        $problems[] = \sprintf('PHP_VERSION is %s, expected %s', $result['version'], $build->php);
    }
    foreach ($build->extensions as $i => $extension) {
        if (true !== ($result['loaded'][$i] ?? null)) {
            $problems[] = \sprintf('extension_loaded("%s") is false', $extension);
        }
    }
    foreach ($checks as $extension => $check) {
        if (true !== ($result['works'][$extension] ?? null)) {
            $problems[] = \sprintf('%s does not work: %s is false', $extension, $check);
        }
    }

    return $problems;
}

/**
 * The default of a build argument, as declared by the Dockerfile.
 *
 * @internal
 */
function dockerfile_default(string $argument): ?string
{
    $dockerfile = (string) file_get_contents(builder_root() . '/Dockerfile');

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
