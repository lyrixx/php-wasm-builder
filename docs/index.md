---
template: home.html
title: PHP in the browser
hide:
  - footer
---

<section class="home-hero" markdown>
<div class="home__inner home-hero__inner" markdown>

<div markdown>

<p class="home-kicker">No server. Just a page.</p>

# <span class="riso" data-text="PHP">PHP</span><br>in the browser

<p class="home-lead">
PHP WASM Builder compiles PHP to WebAssembly, with the PHP version and the extensions you ask for,
and your code in it. A page runs it with a few lines of JavaScript, and node runs it too.
</p>

[Get started](get-started/index.md){ .home-button .home-button--primary }
[Use it in your project](your-project/index.md){ .home-button }

</div>

<div class="home-window" markdown>

<p class="home-sticker">Zero servers</p>

```html
<script type="module">
    import createPhp from './php-web.mjs';

    const php = await createPhp();
    const { stdout } = await php.runCode(
        'echo "Hello from PHP ", PHP_VERSION;'
    );
</script>
```

<p class="home-window__output">Hello from PHP 8.5.12</p>

</div>

</div>
</section>

<div class="home-marquee" aria-hidden="true">
<div class="home-marquee__track">
<span>PHP 8.5</span><span>PHP 8.4</span><span>PHP 8.3</span><span>Symfony</span><span>SQLite</span><span>intl</span><span>OpenSSL</span><span>opcache</span><span>Web Workers</span><span>node</span>
<span>PHP 8.5</span><span>PHP 8.4</span><span>PHP 8.3</span><span>Symfony</span><span>SQLite</span><span>intl</span><span>OpenSSL</span><span>opcache</span><span>Web Workers</span><span>node</span>
</div>
</div>

<section class="home-section" markdown>
<div class="home__inner" markdown>

## Three steps, no server

<div class="home-steps" markdown>

<div class="home-step" markdown>

### [Build PHP](get-started/index.md)

Docker compiles PHP to WebAssembly: the version, and the extensions you ask for.

`docker buildx bake`

</div>

<div class="home-step" markdown>

### [Embed your code](get-started/embed.md)

Your code, and its `vendor/`, go in the `.wasm` file, where PHP finds them.

`EMBED_AT=/app`

</div>

<div class="home-step" markdown>

### [Run it](get-started/page.md)

In a page, in a Web Worker, or in node. Files can stay across reloads.

`php.runFile('/app/index.php')`

</div>

</div>

</div>
</section>

<section class="home-section home-section--dotted" markdown>
<div class="home__inner" markdown>

## Examples

They run in your browser, right now. Their code is in
[`examples/`](https://github.com/lyrixx/php-wasm-builder/tree/main/examples), a directory each.

<div class="home-cards">
<!-- site:build lists the examples here -->
</div>

</div>
</section>

<section class="home-section" markdown>
<div class="home__inner" markdown>

## Built with it

These pages run PHP in the browser, built with PHP WASM Builder.

<div class="home-cards">
<div class="home-card">
<h3><a href="https://lyrixx.github.io/composer-diff/">composer-diff</a></h3>
<p>Compares two <code>composer.lock</code>.</p>
<p class="home-card__meta"><a href="https://github.com/lyrixx/composer-diff/blob/main/public/page.mjs">public/page.mjs</a> runs PHP</p>
</div>
<div class="home-card">
<h3><a href="https://jolicode.github.io/emoji-converter/">emoji-converter</a></h3>
<p>Turns 🐘 into <code>:elephant:</code>, and back.</p>
<p class="home-card__meta"><a href="https://github.com/jolicode/emoji-converter/blob/main/website/public/js/php.js">website/public/js/php.js</a> runs PHP</p>
</div>
<div class="home-card">
<h3><a href="https://jolitypo.jolicode.com/">JoliTypo</a></h3>
<p>Fixes the microtypography of an HTML text.</p>
<p class="home-card__meta"><a href="https://github.com/jolicode/JoliTypo/blob/main/website/public/js/php.js">website/public/js/php.js</a> runs PHP</p>
</div>
</div>

</div>
</section>

<section class="home-cta" markdown>
<div class="home__inner" markdown>

## Your turn

<p class="home-cta__command">docker buildx bake</p>

[Get started](get-started/index.md){ .home-button .home-button--primary }
[Read the JavaScript API](javascript-api/index.md){ .home-button }

</div>
</section>
