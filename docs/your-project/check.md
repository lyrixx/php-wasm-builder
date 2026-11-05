# Check it

What is built for the web runs in node too: the checks need no browser.

## PHP

=== "castor"

    `PhpWasm\check_stack()` checks that what is built boots, with its PHP version and its
    extensions, as `castor wasm:check` does, and `PhpWasm\run_code()` runs some code in it, as
    `runCode()` does in the page. Both throw a `ProblemException` when something is wrong, as
    castor's `check()` does:

    ```php-inline
    use function Castor\check;
    use function PhpWasm\check_stack;
    use function PhpWasm\run_code;

    #[AsTask('smoke', namespace: 'wasm', description: 'Checks that what is built boots, and answers')]
    function wasm_smoke(): void
    {
        check_stack(wasm_stack());

        check('The page answers', 'The page does not answer.', fn (): bool => 'Hello…' === run_code(wasm_stack(), 'require "/app/src/page.php";', stdin: 'Hello...'));
    }
    ```

    `run_code()` returns what PHP prints, and throws when PHP does not exit with 0: an uncaught
    exception, a fatal error or an `exit(1)`. Its `stdin` is what PHP reads on `php://stdin`.

=== "Composer and Docker"

    `run.mjs`, from the package, runs a file or some code in what is built, as the php command
    does, and exits with the exit status of PHP: an uncaught exception, a fatal error or an
    `exit(1)` fail the script.

    ```json
    {
        "scripts": {
            "wasm:check": [
                "echo 'Hello...' | node vendor/lyrixx/php-wasm-builder/node/run.mjs --build public/build/php-web.mjs -r 'require \"/app/src/page.php\";'"
            ]
        }
    }
    ```

## The JavaScript of the page

The checks above run PHP, not the JavaScript of the page. When the page keeps it in a module, the
test runner of node runs its tests, preloaded with `node/fetch-files.mjs`: `fetch()` reads the files
from the disk, where a server would serve them from, and records their resource timing, as a browser
does. The module, and the `php-web.mjs` it loads, run as they are:

```js
// tests/page.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

// It loads ./build/php-web.mjs, and exports what the page calls
import { answer } from '../public/page.mjs';

test('the page answers', async () => {
    assert.equal(await answer('Hello...'), 'Hello…');
});
```

=== "castor"

    ```php-inline
    use function PhpWasm\test_page;

    // In wasm_smoke(), relative to the root of the project
    test_page('tests/page.test.mjs');
    ```

    `test_page()` throws a `ProblemException` when a test fails, and node says which one.

=== "Composer and Docker"

    In `wasm:check`, after `run.mjs`:

    ```json
    {
        "scripts": {
            "wasm:check": [
                "echo 'Hello...' | node vendor/lyrixx/php-wasm-builder/node/run.mjs --build public/build/php-web.mjs -r 'require \"/app/src/page.php\";'",
                "node --import ./vendor/lyrixx/php-wasm-builder/node/fetch-files.mjs --test tests/page.test.mjs"
            ]
        }
    }
    ```

    node exits with 1 when a test fails, and says which one.

The URLs that the page fetches are relative to `import.meta.url`: in node, they are `file:` URLs.
