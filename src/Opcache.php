<?php

namespace PhpWasm;

/**
 * What opcache compiles, the OPCACHE build argument, with PHP 8.5 and later.
 * Keep in sync with the "resolve" stage of the Dockerfile.
 */
enum Opcache: string
{
    /**
     * Every run compiles what it runs: the default.
     */
    case None = 'none';

    /**
     * The first run that needs a file compiles it, in the WASM filesystem.
     */
    case Runtime = 'runtime';

    /**
     * Every PHP file of the embedded directory, when it is built.
     */
    case Precompiled = 'precompiled';
}
