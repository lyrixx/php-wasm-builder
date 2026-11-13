# opcache

Each run starts PHP, and stops it: what opcache compiled is gone with it. With PHP 8.5 and later,
opcache can keep it in files of the WASM filesystem, in `/opcache`, that the next runs read instead
of compiling the PHP files again. `OPCACHE` says when it compiles them:

- `none`, the default: every run compiles what it runs;
- `runtime`: as they run, the first run that needs a file compiles it, and writes it;
- `precompiled`: when PHP is built, after `WARMUP`. Every `.php` file of the embedded directory is
  compiled, and what opcache writes is embedded.

## What it changes

With the [Symfony example](../guides/symfony.md), in node:

<div class="numbers" markdown>

| What is built              | `createPhp()` | Boot   | First request | Next requests | `.wasm` | Gzipped |
|----------------------------|--------------:|-------:|--------------:|--------------:|--------:|--------:|
| `none`                     | 190 ms        | 600 ms | 250 ms        | 115 ms        | 31 MB   | 7.4 MB  |
| `WARMUP`                   | 195 ms        | 220 ms | 160 ms        | 110 ms        | 32 MB   | 7.5 MB  |
| `runtime` and `WARMUP`     | 195 ms        | 410 ms | 245 ms        | 35 ms         | 32 MB   | 7.5 MB  |
| `precompiled` and `WARMUP` | 420 ms        | 135 ms | 75 ms         | 35 ms         | 77 MB   | 19 MB   |

</div>

The boot is `bin/console doctrine:schema:update`, the first run of the page. `WARMUP` alone,
`bin/console cache:warmup`, saves the compilation of the container. Writing the cache makes the
first runs slower, with `runtime`. `precompiled` costs what is embedded: opcodes are bigger than the
PHP files, 46 MB for the 16 MB of the 3,932 PHP files of the example, in the `.wasm` file (13 MB
with brotli, 5.2 MB without), and in the memory of the module (`MEMORY`, see
[Build arguments](build-arguments.md)): 73 MB of its 128 MB before it runs, 26 MB without.

## How it works

opcache checks the mtime of a file: one written over is compiled again, an embedded one too. Its
mtimes are in seconds: it does not cache a file written less than 2 s before, it could be written
again in the same second. What is embedded dates from 1970-01-01 00:00:01 (`filemtime()` gives 1):
opcache caches it from the first run, and the build compiles it with this date.

`opcache_invalidate()` does nothing, and `opcache_get_status()` is false: opcache only has the
files, no shared memory. A `php.ini` changes its settings, at `/usr/local/lib/php.ini`, written
before the first run.

On 32 bits, what the module is, the file cache of PHP 8.5.12 and before breaks the attributes of
constants, as the `#[Deprecated]` of `symfony/polyfill-uuid`: PHP crashes on such a file, or loses
them ([GH-24745](https://github.com/php/php-src/issues/24745)). The build applies the fix of PHP
8.5.13 to these versions.
