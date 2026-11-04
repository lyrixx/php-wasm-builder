<?php

namespace PhpWasm;

/**
 * The data of ICU that intl links, the ICU_DATA build argument. Keep in sync
 * with the "resolve" stage of the Dockerfile.
 */
enum IcuData: string
{
    /**
     * Every locale: the default.
     */
    case All = 'all';

    /**
     * None: intl is loaded, but it only knows locale codes.
     */
    case None = 'none';
}
