# Sizes

What each stack of this repository weighs: the `.wasm` file of its build for the web, and what a
browser downloads, once gzipped, as GitHub Pages sends it. The extensions are what makes a build
bigger, intl above all (see [Supported extensions](extensions.md)), and what is embedded, as the
`vendor/` of the Symfony example.

<!-- site:build lists the sizes here -->

## What weighs

With PHP 8.5, at the same extensions:

- Each branch of PHP is bigger than the one before: the default stack is 270 KB bigger, gzipped,
  with PHP 8.5 than with PHP 8.4, and 780 KB bigger than with PHP 8.3. PHP 8.5 always builds lexbor,
  uri and opcache (see [Supported extensions](extensions.md)).
- mbstring is 750 KB of it, gzipped (see [mbstring](extensions.md#mbstring)).
- Half of what is gzipped is data, not code, and a compiler does not make data smaller. This is why
  there is no build argument to optimize for size: compiled with `-Oz` instead of `-O2`, PHP and
  libxml2 make a `.wasm` file 10% smaller, and only 4% once gzipped.

`castor site:build` measures them when it builds this website. `castor wasm:sizes` gives them for
what you built, and `castor wasm:sizes --json` as JSON.
