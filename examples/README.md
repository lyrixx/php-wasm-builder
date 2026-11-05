# Examples

Each example is a page that runs PHP in the browser, laid out as a project of
your own would be:

| File | What it is |
| --- | --- |
| `stack.php` | The stack of the page: the PHP version, the extensions, what to embed. castor builds it in `public/build/`. |
| `public/` | What the browser loads: the page, and `build/php-web.mjs`, `build/php-web.wasm` and `build/php-sw.js` once built (not in git). |
| `app/` | When there is one, the PHP code that the stack embeds, that PHP sees at `/app`. |

- [`playground/`](playground/): write PHP, and run it. Every extension.
- [`symfony/`](symfony/): a Symfony application, with Doctrine and SQLite,
  in a frame.

Serve one on http://127.0.0.1:8000/, once its stack is built:

    castor wasm:serve playground
