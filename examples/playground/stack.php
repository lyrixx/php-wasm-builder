<?php

use PhpWasm\IcuData;
use PhpWasm\Stack;

// The PHP of the page: the one of the Dockerfile, with every extension that
// the builder supports, to try them all. intl comes without ICU's data, that
// would add 30 MB to download. Nothing is embedded: the page writes the code
// of the editor in a file, and runs it.
return Stack::named('example-playground')
    ->extensions(...Stack::EXTENSIONS)
    ->icuData(IcuData::None)
    ->targets('web')
    ->outputDir(__DIR__ . '/public/build');
