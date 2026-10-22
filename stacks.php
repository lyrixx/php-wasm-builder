<?php

use PhpWasm\Stack;

// What `castor wasm:build` builds when no stack is given, and what `docker
// buildx bake` builds: its PHP version and its extensions are the defaults of
// the Dockerfile, keep them in sync.
$default = Stack::named('default')
    ->php('8.5.12')
    ->extensions('calendar', 'ctype', 'dom', 'mbstring', 'simplexml', 'xml', 'xmlreader', 'xmlwriter')
    ->embed('examples/embed', at: '/examples')
    ->targets('web', 'node');

return [
    $default,

    // The same thing on the previous branches. Older ones work the same way.
    $default->renamed('php-8.4')->php('8.4.26'),
    $default->renamed('php-8.3')->php('8.3.35'),

    // A playground: tools built on PHP-Parser need tokenizer, and there is
    // no reason 0.1 + 0.2 should not be 0.3 in a browser. Built in the page of
    // examples/playground/, that runs the scripts it embeds.
    $default->renamed('playground')
        ->extensions('tokenizer', 'bcmath', 'filter')
        ->memory('256mb')
        ->targets('web')
        ->outputDir('examples/playground/public/build'),

    // SQLite, with PDO and with the SQLite3 class, for the page of
    // examples/notes/: what it embeds, and where it is served from.
    $default->renamed('notes')
        ->extensions('pdo_sqlite', 'sqlite3')
        ->embed('examples/notes/embed', at: '/app')
        ->targets('web')
        ->outputDir('examples/notes/public/build'),

    // intl, with all of ICU's data linked in the .wasm file. The data takes
    // 32 MB of the memory: this leaves PHP as much of it as the default stack.
    $default->renamed('intl')
        ->extensions('intl')
        ->memory('160mb'),

    // intl, without ICU's data: it is loaded, but only NFC normalization and
    // the character properties of IntlChar work. It needs no more memory.
    $default->renamed('intl-without-data')
        ->extensions('intl')
        ->icuData('none'),
];
