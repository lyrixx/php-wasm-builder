# The examples

Each directory of `examples/` is a page, laid out as a project of your own would be: its stack in
`stack.php`, what the browser loads in `public/`, and the PHP code that the stack embeds in `app/`,
when there is one. Its `README.md` says how it is wired.

| Example                    | What it is                                                                                                                                                                                       |
|----------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [`playground`](../examples/playground/) | An editor, with a script that shows what PHP has there: change it, and run it. Its stack has every [supported extension](../reference/extensions.md), intl without ICU's data.          |
| [`symfony`](../examples/symfony/)       | A Symfony application, a guestbook with Doctrine and SQLite, in a frame, and [on its own page](../examples/symfony/standalone/) (see [A Symfony application](../guides/symfony.md)). Its stack embeds `app/` at `/app`, once castor installed its `vendor/`, with the composer of Docker. |

`castor wasm:serve` builds the page of an example, in a second when nothing changed, and serves it
on <http://127.0.0.1:8000/>, with the built-in server of PHP. As with `castor wasm:build`, `--php`,
`--with` and `--opcache` change what the stack of the page has:

```
castor wasm:serve playground --php 8.3.35
castor wasm:serve symfony --opcache precompiled
```

The page changes with a reload, its PHP when the server starts again.

## This website

`castor site:build` builds it in `build/site/`: zensical renders `docs/`, in Docker, and the page of
each example is copied in `examples/<name>/`, once its stack is checked. It builds every stack, for
[their sizes](../reference/sizes.md). `castor site:serve` serves
it where GitHub Pages does, on <http://127.0.0.1:8000/php-wasm-builder/>: the examples must work
under a path. `.github/workflows/pages.yml` deploys it, on each push to `main`.
