# HTTP requests

`php.request()` runs PHP as a web server does: the code gets `$_GET`, `$_POST`, `$_COOKIE`,
`$_FILES` and `php://input`, and what it sends with `header()`, `setcookie()` or
`http_response_code()` makes the response. A framework runs as it is, from its front controller
(see [A Symfony application](../guides/symfony.md)):

```js
const response = await php.request({
    method: 'POST',
    url: 'https://example.com/blog/comments?page=2',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: 'PHPSESSID=…' },
    body: 'comment=Hello',
}, { documentRoot: '/app/public' });

// { status: 302, headers: [['Location', '/blog'], ['Set-Cookie', '…'], …], body: Uint8Array, stderr: '' }
```

## The request

The request is data, not a `Request` of `fetch()`: a browser drops the `Cookie` header of a
`Request`, and the `Set-Cookie` headers of a `Response`. It is what `postMessage()` takes, too.
`headers` is an object, a list of names and values, or `Headers`, and `body` a string or bytes
(`ArrayBuffer`, `Uint8Array`…), for any method. Both are optional, as `method` (`GET`).

The URL asks for a file of `documentRoot`, as with a web server: a `.php` file runs, any other file
is the response, as it is (a stylesheet, an image…), and a URL that is not a file runs `index.php`,
the front controller. `..` never goes out of `documentRoot`. `basePath` is where `documentRoot` is
in the URLs, nowhere by default: with `/app`, `/app/blog` runs `index.php` with
`$_SERVER['SCRIPT_NAME']` at `/app/index.php`, that Symfony builds its URLs from, and a URL out of
`/app` is a 404.

`$_SERVER` has what a web server gives with CGI: `REQUEST_METHOD`, `REQUEST_URI`, `QUERY_STRING`,
`SCRIPT_NAME`, `SCRIPT_FILENAME`, `HTTP_HOST`, an `HTTP_*` for each header… `PHP_SAPI` is `wasm`,
not `embed` as with `runFile()`: Symfony takes `embed` for the command line (its errors in plain
text, `display_errors` on, no flush…).

## The response

| Property  | What it is                                                                      |
|-----------|---------------------------------------------------------------------------------|
| `status`  | The HTTP status, 200 unless PHP says otherwise.                                 |
| `headers` | The names and values that PHP sends, in a list: there may be several `Set-Cookie`. |
| `body`    | What PHP wrote, as bytes (a `Uint8Array`).                                      |
| `stderr`  | What PHP wrote on stderr, the logs of Symfony for example.                      |

`request()` is the web server, not the browser: it keeps no cookie, and follows no redirection.
[An application in a frame](frame.md) does both.
