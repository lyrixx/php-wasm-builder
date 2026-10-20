<?php

// The xml extensions and mbstring are in every stack.
//
//     node run.mjs examples/xml.php

$books = simplexml_load_string(<<<'XML'
    <books>
        <book year="2024"><title>PHP 8.4: property hooks</title></book>
        <book year="2025"><title>PHP 8.5: the pipe operator</title></book>
    </books>
    XML);

foreach ($books->book as $book) {
    echo $book['year'], ' ', mb_strtoupper($book->title), "\n";
}

$document = new DOMDocument();
$document->loadXML($books->asXML());
echo (new DOMXPath($document))->evaluate('count(//book)'), " books\n";
