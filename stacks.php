<?php

use PhpWasm\Opcache;
use PhpWasm\Stack;
use PhpWasm\Target;

// The builds of PHP that this repository checks, in CI too. The pages of
// examples/ have their own stack, in their stack.php.

// PHP 8.5, with the default extensions: what `castor wasm:build` builds when
// no stack is given, and what `docker buildx bake` builds. Its PHP version and
// its extensions are the defaults of the Dockerfile, keep them in sync.
$php85 = Stack::named('php-8.5')
    ->php('8.5.12')
    ->extensions('calendar', 'ctype', 'dom', 'mbstring', 'simplexml', 'xml', 'xmlreader', 'xmlwriter')
    ->targets(Target::Web, Target::Node);

return [
    $php85,

    // The previous branches of PHP. Older ones work the same way.
    $php85->renamed('php-8.4')->php('8.4.26'),
    $php85->renamed('php-8.3')->php('8.3.35'),

    // intl, with all of ICU's data linked in the .wasm file: the data takes
    // 32 MB of the memory, this leaves PHP as much of it as without intl.
    $php85->renamed('php-8.5-intl')
        ->extensions('intl')
        ->memory('160mb'),

    // opcache, that keeps what it compiles in files: as the files run, or
    // every PHP file that is embedded, when it is built. There has to be one.
    $php85->renamed('php-8.5-opcache-runtime')->opcache(Opcache::Runtime),
    $php85->renamed('php-8.5-opcache-precompiled')
        ->embed('tests/embed', at: '/tests')
        ->opcache(Opcache::Precompiled),
];
