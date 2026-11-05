# Playground

Write PHP, and run it, in the browser.

| File | What it is |
| --- | --- |
| `stack.php` | The PHP of the page: every extension that the builder supports, intl without ICU's data, for the web. |
| `public/index.html` | The page: an editor, and the script that runs PHP. |
| `public/build/` | What castor builds: `php-web.mjs`, `php-web.wasm` and `php-sw.js`, that the page does not use (not in git). |

The page imports `build/php-web.mjs`, writes the code of the editor in the
filesystem of PHP, at `/tmp/playground.php`, runs it with `php.runFile()`, and
shows what it prints. Nothing is embedded.

    castor wasm:serve playground
