<?php

use PhpWasm\Stack;

return [
    // What php.net ships (docs + PHP Tour). `castor build` builds this one.
    // Its PHP version and its extensions are the defaults of the Dockerfile:
    // keep them in sync.
    Stack::named('php.net')
        ->php('8.5.11')
        ->extensions('calendar', 'ctype', 'dom', 'mbstring', 'simplexml', 'xml', 'xmlreader', 'xmlwriter')
        ->embed('examples')
        ->targets('web', 'node'),

    // The same thing on the previous branches. Older ones work the same way.
    Stack::named('php.net-8.4')->from('php.net')->php('8.4.26'),
    Stack::named('php.net-8.3')->from('php.net')->php('8.3.35'),

    // A playground: tools built on PHP-Parser need tokenizer, and there is
    // no reason 0.1 + 0.2 should not be 0.3 in a browser.
    Stack::named('playground')
        ->from('php.net')
        ->extensions('tokenizer', 'bcmath', 'filter')
        ->memory('256mb')
        ->embed('playground/app'),

    // intl, with all of ICU's data linked in the .wasm file. The data takes
    // 32 MB of the memory: this leaves PHP as much of it as php.net has.
    Stack::named('intl')
        ->from('php.net')
        ->extensions('intl')
        ->memory('160mb'),
];
