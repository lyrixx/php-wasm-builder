<?php

namespace PhpWasm;

/**
 * What a stack builds, the TARGETS build argument. Keep in sync with the
 * "resolve" stage of the Dockerfile.
 */
enum Target: string
{
    /**
     * php-web.mjs and php-web.wasm, for a page, or a worker, and php-sw.js,
     * for a service worker.
     */
    case Web = 'web';

    /**
     * php-node.mjs and php-node.wasm, for node.
     */
    case Node = 'node';

    /**
     * The name of its files, without their extension.
     */
    public function fileName(): string
    {
        return 'php-' . $this->value;
    }

    /**
     * The names of the files it builds. Keep in sync with the "link" stage of
     * the Dockerfile.
     *
     * @return list<string>
     */
    public function files(): array
    {
        $files = [$this->fileName() . '.mjs', $this->fileName() . '.wasm'];

        return self::Web === $this ? [...$files, 'php-sw.js'] : $files;
    }
}
