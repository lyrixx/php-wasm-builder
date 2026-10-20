<?php

// Every stack embeds this directory, as /examples. Run this file from your
// disk, or the copy that is in the .wasm file:
//
//     node run.mjs examples/hello.php
//     node run.mjs -r 'require "/examples/hello.php";'

echo 'Hello from PHP ', PHP_VERSION, ", in WebAssembly!\n";
echo 'Extensions: ', implode(', ', get_loaded_extensions()), "\n";
