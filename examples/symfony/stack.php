<?php

use PhpWasm\Opcache;
use PhpWasm\Stack;

// The PHP of the page: the one of the Dockerfile (keep in sync with
// config.platform.php in app/composer.json), with what the application needs:
// ctype, iconv, mbstring and xml, that Symfony, Doctrine and their polyfills
// require, filter, that Symfony calls everywhere, tokenizer, without which the
// routes of the controllers are not found, pdo_sqlite, and session.
return Stack::named('example-symfony')
    ->extensions('ctype', 'filter', 'iconv', 'mbstring', 'pdo_sqlite', 'session', 'tokenizer', 'xml')
    // The application, and its vendor/ that castor installs before the build:
    // 19 MB of the memory, it runs with 80 MB
    ->embed(__DIR__ . '/app', at: '/app')
    // Symfony makes its cache when the stack is built, with the paths of the
    // WASM filesystem, and opcache compiles the files as they run
    ->warmup('bin/console', 'cache:warmup')
    ->opcache(Opcache::Runtime)
    ->targets('web')
    ->outputDir(__DIR__ . '/public/build');
