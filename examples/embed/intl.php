<?php

// Needs the intl stack, with ICU and all of its data:
//
//     castor wasm:run examples/embed/intl.php --stack intl

echo (new NumberFormatter('fr_FR', NumberFormatter::CURRENCY))->formatCurrency(1234.5, 'EUR'), "\n";
echo (new NumberFormatter('en', NumberFormatter::SPELLOUT))->format(42), "\n";
echo (new IntlDateFormatter('ja_JP', IntlDateFormatter::FULL, IntlDateFormatter::NONE, 'UTC'))->format(0), "\n";

$words = ['été', 'eau', 'Ébène', 'zèbre'];
(new Collator('fr_FR'))->sort($words);
echo implode(' ', $words), "\n";

echo Transliterator::create('Any-Latin; Latin-ASCII')->transliterate('Привет, 東京'), "\n";
