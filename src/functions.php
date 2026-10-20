<?php

namespace PhpWasm;

// What a project that requires this package can use, without the tasks of
// castor.php (import('composer://lyrixx/php-wasm-builder') gets them too).

/**
 * Builds stacks, declared in the stacks.php files of this package and of the
 * project, in the build/<stack>/ directories of the project. They are built in
 * a single buildx invocation: in parallel, and sharing the layers they have in
 * common.
 *
 * @return list<Build>
 */
function build(string ...$stacks): array
{
    $builds = array_map(resolve(...), array_values($stacks));
    bake($builds);

    return $builds;
}
