<?php

namespace App;

use Symfony\Component\HttpKernel\CacheWarmer\CacheWarmerInterface;

/**
 * Names this build of the application, in its cache: the pages run the
 * console once per build, not each time PHP starts. warmup() runs it when the
 * stack is built, and again each time the application changes. Keep in sync
 * with ../../public/start.mjs
 */
final readonly class BuildIdWarmer implements CacheWarmerInterface
{
    public function isOptional(): bool
    {
        return false;
    }

    public function warmUp(string $cacheDir, ?string $buildDir = null): array
    {
        file_put_contents(($buildDir ?? $cacheDir) . '/build-id', bin2hex(random_bytes(8)));

        return [];
    }
}
