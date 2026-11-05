# Run it in the page

The page runs a file of `/app`, gives PHP its input on stdin, and gets what PHP prints (see
[JavaScript API](../javascript-api/index.md)):

```html
<!-- public/index.html -->
<pre id="output"></pre>
<script type="module">
    import createPhp from './build/php-web.mjs';

    const php = await createPhp();
    const { exitCode, stdout } = await php.runFile('/app/src/page.php', { stdin: 'Hello...' });
    if (0 !== exitCode) {
        throw new Error(`PHP exits with ${exitCode}: ${stdout}`);
    }

    document.getElementById('output').textContent = stdout;
</script>
```

`public/` is the website: any static server serves it, `php -S 127.0.0.1:8000 -t public` for
example.

An application with its own pages, a Symfony one for example, shows in a frame instead (see
[An application in a frame](../javascript-api/frame.md)).
