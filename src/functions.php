<?php

namespace PhpWasm;

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
