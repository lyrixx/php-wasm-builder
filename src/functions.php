<?php

namespace PhpWasm;

// What a project that requires this package can use.

/**
 * Builds stacks in the build/<stack>/ directories of the project. They are
 * built in a single buildx invocation: in parallel, and sharing the layers they
 * have in common.
 *
 * @param list<Stack>  $stacks
 * @param list<string> $set    overrides, given to "docker buildx bake --set",
 *                             for example "*.cache-from=type=gha" for a cache
 *
 * @return list<Build>
 */
function build(array $stacks, array $set = []): array
{
    $builds = array_map(resolve(...), array_values($stacks));
    bake($builds, $set);

    return $builds;
}
