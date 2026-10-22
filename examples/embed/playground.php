<?php

// Needs the playground stack, which adds bcmath, filter and tokenizer:
//
//     castor wasm:run examples/embed/playground.php --stack playground

if (!extension_loaded('bcmath') || !extension_loaded('filter') || !extension_loaded('tokenizer')) {
    echo "This script needs bcmath, filter and tokenizer: run it in the playground stack, with --stack playground.\n";
    exit(1);
}

echo '0.1 + 0.2 = ', bcadd('0.1', '0.2', 1), "\n";
echo 'Valid e-mail: ', var_export(false !== filter_var('hello@example.com', FILTER_VALIDATE_EMAIL), true), "\n";
echo 'Tokens in "<?php echo 1 + 2;": ', count(token_get_all('<?php echo 1 + 2;')), "\n";
