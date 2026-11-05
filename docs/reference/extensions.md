# Supported extensions

These are the extensions that can be listed in `EXTENSIONS` (see
[Build arguments](build-arguments.md)):

| Extension    | Notes                     |
|--------------|---------------------------|
| bcmath       |                           |
| calendar     | Built by default.         |
| ctype        | Built by default.         |
| dom          | Built by default.         |
| exif         | See [exif](#exif).        |
| fileinfo     | See [fileinfo](#fileinfo). |
| filter       |                           |
| gd           | See [gd](#gd).            |
| iconv        | See [iconv](#iconv).      |
| intl         | See [intl](#intl).        |
| libxml       |                           |
| mbstring     | Built by default.         |
| openssl      | See [OpenSSL](#openssl).  |
| PDO          |                           |
| pdo_sqlite   | See [SQLite](#sqlite).    |
| phar         | See [phar](#phar).        |
| session      | See [session](#session).  |
| SimpleXML    | Built by default.         |
| sodium       | See [sodium](#sodium).    |
| sqlite3      | See [SQLite](#sqlite).    |
| tokenizer    |                           |
| xml          | Built by default.         |
| xmlreader    | Built by default.         |
| xmlwriter    | Built by default.         |
| zip          | See [zip](#zip).          |
| zlib         | See [zlib](#zlib).        |

They are always there, whatever `EXTENSIONS` says: Core, date, hash, json, lexbor (PHP 8.5 and
later), pcre, random, Reflection, SPL, standard, uri (PHP 8.5 and later), and Zend OPcache (PHP 8.5
and later).

To add an extension, add it to the `case` of the `resolve` stage of the `docker/Dockerfile` (and a
stage for the library that it needs, if it needs one), and to `Stack::EXTENSIONS`.

## exif

exif needs no library: the `.wasm` file is about 50 KB bigger. `exif_read_data()` reads the files of
the WASM filesystem, streams and `data://` URLs:

```
docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter exif"
```

## fileinfo

fileinfo needs no library: PHP comes with libmagic and its database, compiled in the `.wasm` file,
there is no magic file to fetch. `finfo` and `mime_content_type()` work on strings and on the files
of the WASM filesystem. The `.wasm` file is about 1.6 MB bigger (600 KB gzipped):

```
docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter fileinfo"
```

## gd

gd links libpng, with zlib, libjpeg-turbo and libwebp, without their SIMD code: it reads and writes
PNG, JPEG and WebP. PHP comes with libgd, that does GIF, BMP, WBMP and XBM by itself. There is no
FreeType, so no `imagettftext()`, and no AVIF. The `.wasm` file is about 1.2 MB bigger (360 KB
gzipped):

```
docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter gd"
```

An image takes 4 bytes per pixel, whatever its format, and the memory of the module does not grow:
in the 128 MB by default, an image of 24 megapixels fits, one of 35 does not: PHP stops with a fatal
error (see [Memory](limitations.md#memory)). Give the module the memory of the images it opens, with
`MEMORY`.

## iconv

iconv links GNU libiconv: the iconv of the C library of emscripten (musl, as on Alpine) does not
know `//TRANSLIT` nor `//IGNORE`. `//TRANSLIT` transliterates as GNU libiconv does, not as glibc
does on Linux: `Crème brûlée` gives ``Cr`eme br^ul'ee``, and a character it can not transliterate,
Greek or Japanese for example, fails the conversion, unless `//IGNORE` is given too. The `.wasm`
file is about 900 KB bigger (650 KB gzipped):

```
docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter iconv"
```

## intl

intl is linked statically, with ICU and all of its data (every locale): there is no `intl.so` to
load, nor data file to fetch, and it works the same on the web and on node. It does not come cheap,
which is why it is not in the default extensions: the `.wasm` file is about 33 MB bigger (14 MB
gzipped), and the data takes 32 MB of the memory of the module. Add it to the extensions, with 32 MB
more memory:

```
docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter intl" --set default.args.MEMORY=160mb
node node/run.mjs -r 'echo (new NumberFormatter("fr_FR", NumberFormatter::CURRENCY))->formatCurrency(1234.5, "EUR");'
```

The `php-8.5-intl` stack (see [Stacks](../repository/stacks.md)) is the same build.

When the code only needs intl to be loaded, `ICU_DATA=none` leaves the data out: the `.wasm` file is
then about 2 MB bigger than without intl (less than 1 MB gzipped), and it needs no more memory. ICU
only has what is in its code: NFC normalization, and the character properties of `IntlChar`.
Everything else fails: `Locale::getDisplayLanguage('fr', 'en')` gives `fr`, and the formatters,
collators, transliterators and `grapheme_*()` functions do not work. The intl of the
[playground](../repository/examples.md) is this one:

```
docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter intl" --set default.args.ICU_DATA=none
```

## OpenSSL

openssl links OpenSSL 3.5, its long-term support release, without threads. Its configuration, the
one the distributions install, is embedded at `/etc/ssl/openssl.cnf`: `openssl_pkey_new()` and
`openssl_csr_new()` take their defaults from it. Ciphers, digests, keys, signatures and certificates
work, but there is no network: `https://` URLs and `ssl://` streams do not connect. The `.wasm` file
is about 2.6 MB bigger (1 MB gzipped):

```
docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter openssl"
```

## phar

phar needs no library: the `.wasm` file is about 200 KB bigger (70 KB gzipped). `runFile()` runs a
`.phar` file, and `phar://` reads what is in it, `include` too. The phars that gzip compresses need
[zlib](#zlib), and there is no bzip2:

```
docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter phar zlib"
```

`phar.readonly` is on, as in PHP, and `ini_set()` can not turn it off: `new Phar()` throws an
`UnexpectedValueException` when it would write. A `php.ini` turns it off, written before PHP runs:

```js
const php = await createPhp();
php.FS.mkdirTree('/usr/local/lib');
php.FS.writeFile('/usr/local/lib/php.ini', 'phar.readonly=0\n');
```

`PharData`, for tar and zip archives, writes without it.

Tools run, with the extensions they ask for: `composer.phar about`, that warns that the `php` command
does not run it, and `phpunit.phar --help`, with ctype, dom, filter, libxml, mbstring, tokenizer and
xmlwriter.

## session

session needs no library: the `.wasm` file is about 70 KB bigger. There is no HTTP response, so the
headers are never sent: the cookie of the session, as what `header()` and `setcookie()` give, is
only in `headers_list()`, and `headers_sent()` is false. The sessions are files of `/tmp`, in the
memory of the module:

```
docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter session"
```

## sodium

sodium links libsodium, without assembly nor threads. It takes its random numbers from
`crypto.getRandomValues()`, in a page, in a worker and in node. There is no AES-GCM:
`sodium_crypto_aead_aes256gcm_is_available()` is false, it needs a CPU instruction. The `.wasm` file
is about 250 KB bigger (100 KB gzipped):

```
docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter sodium"
```

It gives Argon2 to `password_hash()` too: `PASSWORD_ARGON2ID` and `PASSWORD_ARGON2I`, that take
64 MiB by default.

Argon2 takes all of its memory at once, and the memory of the module does not grow. In the 128 MB by
default, 116 MiB fits, so only `SODIUM_CRYPTO_PWHASH_MEMLIMIT_INTERACTIVE` does:

<div class="numbers" markdown>

| `SODIUM_CRYPTO_PWHASH_MEMLIMIT_*` | Takes   | `MEMORY` it needs | In node |
|-----------------------------------|--------:|------------------:|--------:|
| `INTERACTIVE`                     | 64 MiB  | `128mb`           | 0.1 s   |
| `MODERATE`                        | 256 MiB | `272mb`           | 0.7 s   |
| `SENSITIVE`                       | 1 GiB   | `1040mb`          | 5 s     |

</div>

The times are with the `SODIUM_CRYPTO_PWHASH_OPSLIMIT_*` of the same name, and what is embedded takes
memory too, and so does what a run took before: the C library keeps it. Above what fits, it throws a
`SodiumException` (`internal error`), and the module goes on: `memory_limit` does not count what
Argon2 takes. It is the same for `sodium_crypto_pwhash_scryptsalsa208sha256()`.

## SQLite

pdo_sqlite and sqlite3 link SQLite, compiled from its amalgamation, with FTS5 (its full-text search)
and the math functions (`sqrt()`, `pow()`, `log()`…), as the SQLite of the distributions has them.
It can not load extensions: there is no `dlopen()` in a static build. pdo_sqlite comes with PDO, and
the `.wasm` file is about 1.3 MB bigger with both (500 KB gzipped):

```
docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter pdo_sqlite sqlite3"
```

A database is a file of the WASM filesystem, in memory: it is gone with the page, unless the page
keeps it in IndexedDB (see [Keep files across reloads](../javascript-api/persist.md)).

## zip

zip links libzip, with zlib, and only deflate, the method of most archives: `ZipArchive` reads and
writes them in the WASM filesystem, and `zip://` reads them. The `.wasm` file is about 170 KB bigger
(65 KB gzipped):

```
docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter zip"
```

bzip2, xz and zstd are left out: an archive that uses them opens, and `getFromName()` is false for
those entries. So is AES encryption, there is no crypto library. The entries of an archive encrypted
with AES do not read, and `setEncryptionName()` returns false. Check it: `close()` then writes the
entry **in clear**, and returns true. Only the traditional PKWARE encryption works, and it is weak.

A corrupt archive does not open, and a corrupt entry gives a warning and false. PHP 8.3 does not check
what it reads, whatever it runs on: `getFromName()` gives what it could read, and `extractTo()`
returns true.

## zlib

zlib links zlib. `gzencode()`, `gzcompress()`, `gzdeflate()` and their opposites, `gzopen()`,
`compress.zlib://` and the `zlib.*` stream filters work on strings, and on the files of the WASM
filesystem. The `.wasm` file is about 85 KB bigger (35 KB gzipped):

```
docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter zlib"
```
