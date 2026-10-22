<?php

// The PHP of the page of public/: notes in SQLite, searched with FTS5. The
// notes stack embeds this directory, as /app. The page keeps /data in
// IndexedDB, gives the request in /tmp/request.json, and shows the notes this
// prints:
//
//     castor wasm:build notes
//     castor wasm:serve notes

$request = json_decode(file_get_contents('/tmp/request.json'), true, flags: \JSON_THROW_ON_ERROR);

$pdo = new PDO('sqlite:/data/notes.sqlite');
// A full-text index: searched with MATCH, sorted by relevance with "rank"
$pdo->exec('CREATE VIRTUAL TABLE IF NOT EXISTS notes USING fts5(text)');

match ($request['action']) {
    'add' => $pdo->prepare('INSERT INTO notes (text) VALUES (?)')->execute([$request['text']]),
    'delete' => $pdo->prepare('DELETE FROM notes WHERE rowid = ?')->execute([$request['id']]),
    'list' => null,
};

// Each word is the start of a word to find: "sql pho" finds "SQLite in PHP"
$words = preg_split('/\s+/', $request['search'], flags: \PREG_SPLIT_NO_EMPTY);
if ([] === $words) {
    $notes = $pdo->query('SELECT rowid, text FROM notes ORDER BY rowid DESC');
} else {
    // The words found are between the characters 1 and 2
    $notes = $pdo->prepare('SELECT rowid, highlight(notes, 0, char(1), char(2)) AS text FROM notes WHERE notes MATCH ? ORDER BY rank');
    // Quoted, a word is never an operator of FTS5 (AND, OR, NOT…)
    $notes->execute([implode(' ', array_map(static fn (string $word): string => '"' . str_replace('"', '""', $word) . '"*', $words))]);
}

$found = false;
foreach ($notes as $note) {
    $found = true;
    $text = strtr(htmlspecialchars($note['text']), ["\x01" => '<mark>', "\x02" => '</mark>']);
    echo "<li><span>{$text}</span><button data-id=\"{$note['rowid']}\" title=\"Delete\">×</button></li>\n";
}

if (!$found) {
    echo [] === $words ? "<li>No notes yet.</li>\n" : "<li>Nothing found.</li>\n";
}
