# Run it in a page

`php-web.mjs` is a module, that a page imports. Save this page as `build/php-8.5/index.html`, next
to it:

```html
<pre id="output"></pre>
<script type="module">
    import createPhp from './php-web.mjs';

    const php = await createPhp();
    const { stdout } = await php.runCode('echo "Hello from PHP ", PHP_VERSION;');

    document.getElementById('output').textContent = stdout;
</script>
```

A browser does not load a module from a `file:` URL, so the directory must be served. Any static
server does it, the one of PHP for example:

```
php -S 127.0.0.1:8000 -t build/php-8.5
```

Then open <http://127.0.0.1:8000/>.

What else the page can do is in [JavaScript API](../javascript-api/index.md).
