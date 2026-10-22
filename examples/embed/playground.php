<?php

// Needs the playground stack, which adds bcmath, filter and tokenizer:
//
//     castor wasm:run examples/embed/playground.php --stack playground

echo '0.1 + 0.2 = ', bcadd('0.1', '0.2', 1), "\n";
echo 'Valid e-mail: ', var_export(false !== filter_var('hello@example.com', FILTER_VALIDATE_EMAIL), true), "\n";
echo 'Tokens in "<?php echo 1 + 2;": ', count(token_get_all('<?php echo 1 + 2;')), "\n";
