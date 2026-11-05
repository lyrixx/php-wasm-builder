# Supported extensions

These are the extensions that can be listed in `EXTENSIONS` (see
[Build arguments](build-arguments.md)):

| Extension    | Notes                     |
|--------------|---------------------------|
| bcmath       |                           |
| calendar     | Built by default.         |
| ctype        | Built by default.         |
| dom          | Built by default.         |
| fileinfo     | See [fileinfo](#fileinfo). |
| filter       |                           |
| iconv        | See [iconv](#iconv).      |
| intl         | See [intl](#intl).        |
| libxml       |                           |
| mbstring     | Built by default.         |
| openssl      | See [OpenSSL](#openssl).  |
| PDO          |                           |
| pdo_sqlite   | See [SQLite](#sqlite).    |
| session      | See [session](#session).  |
| SimpleXML    | Built by default.         |
| sqlite3      | See [SQLite](#sqlite).    |
| tokenizer    |                           |
| xml          | Built by default.         |
| xmlreader    | Built by default.         |
| xmlwriter    | Built by default.         |

They are always there, whatever `EXTENSIONS` says: Core, date, hash, json, lexbor (PHP 8.5 and
later), pcre, random, Reflection, SPL, standard, uri (PHP 8.5 and later), and Zend OPcache (PHP 8.5
and later).

To add an extension, add it to the `case` of the `resolve` stage of the `docker/Dockerfile` (and a
stage for the library that it needs, if it needs one), and to `Stack::EXTENSIONS`.

## fileinfo

fileinfo needs no library: PHP comes with libmagic and its database, compiled in the `.wasm` file,
there is no magic file to fetch. `finfo` and `mime_content_type()` work on strings and on the files
of the WASM filesystem. The `.wasm` file is about 1.6 MB bigger (600 KB gzipped):

```
docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter fileinfo"
```

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

## session

session needs no library: the `.wasm` file is about 70 KB bigger. There is no HTTP response, so the
headers are never sent: the cookie of the session, as what `header()` and `setcookie()` give, is
only in `headers_list()`, and `headers_sent()` is false. The sessions are files of `/tmp`, in the
memory of the module:

```
docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter session"
```

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
