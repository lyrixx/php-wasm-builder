PHP WASM Builder
================

Builds PHP as WebAssembly, for the browser and for node, with the PHP version
and the extensions you ask for, and the code you embed.

This repository started as a fork of `derickr/php-wasm-builder
<https://github.com/derickr/php-wasm-builder>`_, the builder of the PHP WASM
files of the php.net documentation, and it is where it is developed now (see
`Credits`_).

See it live
-----------

These pages run PHP in the browser, built by this repository. Between
parentheses, the module of each page that runs PHP:

- `composer-diff <https://lyrixx.github.io/composer-diff/>`__ compares two
  ``composer.lock`` (`public/page.mjs
  <https://github.com/lyrixx/composer-diff/blob/main/public/page.mjs>`__);
- `emoji-converter <https://jolicode.github.io/emoji-converter/>`__ turns 🐘
  into ``:elephant:`` and back (`website/public/js/php.js
  <https://github.com/jolicode/emoji-converter/blob/main/website/public/js/php.js>`__);
- `JoliTypo <https://jolitypo.jolicode.com/>`__ fixes the microtypography of
  an HTML text (`website/public/js/php.js
  <https://github.com/jolicode/JoliTypo/blob/main/website/public/js/php.js>`__).

Quick start
-----------

Only Docker is needed to build PHP, node to run it, and a static server to
serve it to a browser. `castor <https://castor.jolicode.com>`_ makes it
simpler, once you know how it works (see `Stacks, and castor`_).

Build PHP
~~~~~~~~~

::

    docker buildx bake

This builds PHP 8.5.12, with the extensions listed in `Supported
Extensions`_: another version, or other extensions, are build arguments (see
`Options`_). The first build compiles everything, and takes a while: the
next ones only compile again what changed. The files end up in
``build/default/``:

- ``php-web.mjs`` and ``php-web.wasm``, for the browser;
- ``php-node.mjs`` and ``php-node.wasm``, for node.

Run it, in node
~~~~~~~~~~~~~~~

``node/run.mjs`` runs PHP in what is built, as the php command does::

    node node/run.mjs -r 'echo PHP_VERSION;'
    node node/run.mjs -r 'var_dump($argv);' one two
    echo '{"a": 1}' | node node/run.mjs -r 'var_dump(json_decode(file_get_contents("php://stdin")));'
    node node/run.mjs my-script.php     # a file of your disk

It writes what PHP writes, and exits with its exit status. ``--build
build/default/php-web.mjs`` runs the build for the web instead, the one a
browser loads.

Run it, in a browser
~~~~~~~~~~~~~~~~~~~~

``php-web.mjs`` is a module, that a page imports. Save this page as
``build/default/index.html``, next to it:

.. code-block:: html

    <pre id="output"></pre>
    <script type="module">
        import createPhp from './php-web.mjs';

        const php = await createPhp();
        const { stdout } = await php.runCode('echo "Hello from PHP ", PHP_VERSION;');

        document.getElementById('output').textContent = stdout;
    </script>

A browser does not load a module from a ``file:`` URL, so the directory must
be served. Any static server does it, the one of PHP for example::

    php -S 127.0.0.1:8000 -t build/default

Then open http://127.0.0.1:8000/.

What else the page can do is in `JavaScript API`_. The examples of this
repository are pages too, try ``castor wasm:serve playground`` (see `Playing
with it`_).

Embed your code
~~~~~~~~~~~~~~~

PHP has a filesystem of its own, in memory: it does not see your disk. It
runs what the page writes in it (``php.FS.writeFile()``), and what is embedded
in the ``.wasm`` file when it is built. ``docker-bake.hcl`` embeds
``examples/embed/``, a few scripts, at ``/examples``::

    node node/run.mjs -r 'require "/examples/hello.php";'

``node node/run.mjs my-script.php`` ran a file of your disk: ``run.mjs``
copies it in the filesystem of PHP first. ``/examples/hello.php`` is the copy
that was embedded: it only changes with a new build. To embed your code
instead, at ``/app``::

    docker buildx bake --set default.contexts.embed=./my-app --set default.args.EMBED_AT=/app
    node node/run.mjs -r 'require "/app/index.php";'

A page runs it with ``php.runFile('/app/index.php')``.

JavaScript API
--------------

``php-web.mjs`` and ``php-node.mjs`` export a function, ``createPhp()``, that
loads PHP from the ``.wasm`` file next to them:

.. code-block:: js

    import createPhp from './php-web.mjs';

    const php = await createPhp();

    const { exitCode, stdout, stderr } = await php.runFile('/app/page.php', {
        args: ['--format=html'],
        stdin: JSON.stringify(request),
    });

``php.runFile(file, { args, stdin })``
    Runs a file of the WASM filesystem, as ``php <file> <args>...`` does.

``php.runCode(code, { args, stdin })``
    Runs some PHP code, without ``<?php``, as ``php -r <code> <args>...``
    does: ``$argv[0]`` is ``Standard input code``.

``args`` (strings) are in ``$argv``, after the file. ``stdin`` (a string, or a
``Uint8Array``) is what PHP reads on ``php://stdin``. Both are optional.
``STDIN``, ``STDOUT`` and ``STDERR`` are not defined: they are constants of
the php command only.

Both resolve once PHP is done, with what it gave:

- ``exitCode``: the one given to ``exit()``, 255 on a fatal error or an
  uncaught exception, 0 otherwise;
- ``stdout`` and ``stderr``: what PHP wrote, as it wrote it, as strings
  (UTF-8): something binary, as an image, is rather written in a file, and
  read with ``php.FS``. As with the php command, the errors are on
  ``stdout``: ``display_errors`` is on.

Each run is a request of its own: PHP starts, runs, and stops, nothing is left
of its variables. The files stay, until the page goes away.

``php.FS``
    The filesystem of emscripten (see `its API
    <https://emscripten.org/docs/api_reference/Filesystem-API.html>`__), to
    give files to PHP, or read the ones it writes:
    ``php.FS.writeFile('/tmp/input.json', data)``,
    ``php.FS.readFile('/tmp/output.png')``. What is embedded is there too, read
    only.

``createPhp({ persist })``
    ``persist`` is a directory of the WASM filesystem to keep in IndexedDB,
    across the reloads of the page, with the build for the web only (see `Keep
    files across reloads`_).

``createPhp()`` takes the options of the ``Module`` of emscripten too, for
example ``locateFile`` to load the ``.wasm`` file from somewhere else.

A run that takes all the memory of the module (``MEMORY``) aborts it, and the
promise is rejected: what is in its memory can not be trusted anymore, create
another one.

Options
-------

Everything is a build argument, given to ``docker buildx bake`` with
``--set``::

    docker buildx bake --set default.args.PHP_VERSION=8.4.26                    # another PHP version
    docker buildx bake --set default.args.EXTENSIONS="ctype tokenizer bcmath"   # other extensions
    docker buildx bake --set default.args.TARGETS=node                          # only php-node.mjs and php-node.wasm

These are the build arguments:

PHP_VERSION
    Configures the PHP version to build.

EXTENSIONS
    The extensions to build, separated by spaces. Defaults to
    ``calendar ctype dom mbstring simplexml xml xmlreader xmlwriter``.

    The libraries that the extensions need (oniguruma for ``mbstring``, libxml2
    for the xml ones) are only built when an extension asks for them.

TARGETS
    The files to build: ``web`` for ``php-web.mjs`` and ``php-web.wasm``, and
    ``node`` for ``php-node.mjs`` and ``php-node.wasm``. Defaults to ``web
    node``.

MEMORY
    The (initial and maximum) memory of the WASM module. Defaults to ``128mb``.

ICU_DATA
    The data of ICU that intl links (see `intl`_): ``all`` (the default) or
    ``none``.

EMBED_AT
    Where the embedded directory is in the WASM filesystem. Defaults to
    ``/examples``.

LIBXML_VERSION
    The LibXML version to download and build.

ONIGURUMA_VERSION
    The Oniguruma library (used for regular expressions with mbstring) version
    to download and build.

ICU_VERSION
    The ICU library (used by intl) version to download and build, for example
    ``78.3``.

LIBICONV_VERSION
    The GNU libiconv library (used by iconv) version to download and build,
    for example ``1.19``.

OPENSSL_VERSION
    The OpenSSL library (used by openssl) version to download and build, for
    example ``3.5.9``.

SQLITE_VERSION
    The SQLite library (used by pdo_sqlite and sqlite3) version to download and
    build, for example ``3.54.1``.

SQLITE_YEAR
    The year of the release of ``SQLITE_VERSION``, that is in its URL: for
    example ``2026``.

EMSDK_VERSION
    The version of the Emscripten SDK that compiles everything, a tag of the
    `emscripten/emsdk <https://hub.docker.com/r/emscripten/emsdk>`_ image. It
    is pinned, so that the same arguments always give the same build.

The directory to embed in the WASM filesystem is the ``embed`` named build
context. ``docker-bake.hcl`` sets it to ``examples/embed/``; anything can be
used instead::

    docker buildx bake --set default.contexts.embed=./my-app --set default.args.EMBED_AT=/app

Supported Extensions
--------------------

These are the extensions that can be listed in ``EXTENSIONS``:

- bcmath
- calendar
- ctype
- dom
- fileinfo (see `fileinfo`_)
- filter
- iconv (see `iconv`_)
- intl (see `intl`_)
- libxml
- mbstring
- openssl (see `OpenSSL`_)
- PDO
- pdo_sqlite (see `SQLite`_)
- session (see `session`_)
- SimpleXML
- sqlite3 (see `SQLite`_)
- tokenizer
- xml
- xmlreader
- xmlwriter

They are always there, whatever ``EXTENSIONS`` says:

- Core
- date
- hash
- json
- lexbor (PHP 8.5 and later)
- pcre
- random
- Reflection
- SPL
- standard
- uri (PHP 8.5 and later)
- Zend OPcache (PHP 8.5 and later)

To add an extension, add it to the ``case`` of the ``resolve`` stage of the
``docker/Dockerfile`` (and a stage for the library that it needs, if it needs
one), and to ``Stack::EXTENSIONS``.

fileinfo
~~~~~~~~

fileinfo needs no library: PHP comes with libmagic and its database, compiled
in the ``.wasm`` file, there is no magic file to fetch. ``finfo`` and
``mime_content_type()`` work on strings and on the files of the WASM
filesystem. The ``.wasm`` file is about 1.6 MB bigger (600 KB gzipped)::

    docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter fileinfo"

iconv
~~~~~

iconv links GNU libiconv: the iconv of the C library of emscripten (musl, as
on Alpine) does not know ``//TRANSLIT`` nor ``//IGNORE``. ``//TRANSLIT``
transliterates as GNU libiconv does, not as glibc does on Linux: ``Crème
brûlée`` gives ``Cr`eme br^ul'ee``, and a character it can not transliterate,
Greek or Japanese for example, fails the conversion, unless ``//IGNORE`` is
given too. The ``.wasm`` file is about 900 KB bigger (650 KB gzipped)::

    docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter iconv"

intl
~~~~

intl is linked statically, with ICU and all of its data (every locale): there
is no ``intl.so`` to load, nor data file to fetch, and it works the same on the
web and on node. It does not come cheap, which is why it is not in the default
extensions: the ``.wasm`` file is about 33 MB bigger (14 MB gzipped), and the
data takes 32 MB of the memory of the module. Add it to the extensions, with
32 MB more memory::

    docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter intl" --set default.args.MEMORY=160mb
    node node/run.mjs examples/embed/intl.php

The ``intl`` stack (see `Stacks, and castor`_) is the same build.

When the code only needs intl to be loaded, ``ICU_DATA=none`` leaves the
data out: the ``.wasm`` file is then about 2 MB bigger than without intl (less
than 1 MB gzipped), and it needs no more memory. ICU only has what is in its
code: NFC normalization, and the character properties of ``IntlChar``.
Everything else fails: ``Locale::getDisplayLanguage('fr', 'en')`` gives
``fr``, and the formatters, collators, transliterators and ``grapheme_*()``
functions do not work. The ``intl-without-data`` stack is this build::

    docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter intl" --set default.args.ICU_DATA=none

OpenSSL
~~~~~~~

openssl links OpenSSL 3.5, its long-term support release, without threads.
Its configuration, the one the distributions install, is embedded at
``/etc/ssl/openssl.cnf``: ``openssl_pkey_new()`` and ``openssl_csr_new()``
take their defaults from it. Ciphers, digests, keys, signatures and
certificates work, but there is no network: ``https://`` URLs and ``ssl://``
streams do not connect. The ``.wasm`` file is about 2.6 MB bigger (1 MB
gzipped)::

    docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter openssl"

session
~~~~~~~

session needs no library: the ``.wasm`` file is about 70 KB bigger. There is
no HTTP response, so the headers are never sent: the cookie of the session,
as what ``header()`` and ``setcookie()`` give, is only in ``headers_list()``,
and ``headers_sent()`` is false. The sessions are files of ``/tmp``, in the
memory of the module::

    docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter session"

SQLite
~~~~~~

pdo_sqlite and sqlite3 link SQLite, compiled from its amalgamation, with FTS5
(its full-text search) and the math functions (``sqrt()``, ``pow()``,
``log()``…), as the SQLite of the distributions has them. It can not load
extensions: there is no ``dlopen()`` in a static build. pdo_sqlite comes with
PDO, and the ``.wasm`` file is about 1.3 MB bigger with both (500 KB
gzipped). The ``notes`` stack has both, for its page (see `Playing with
it`_)::

    docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter pdo_sqlite sqlite3"

A database is a file of the WASM filesystem, in memory: it is gone with the
page, unless the page keeps it in IndexedDB (see `Keep files across
reloads`_).

Limitations
-----------

- Fibers
    WebAssembly cannot pause and resume code the way Fibers require, so the
    build uses ``--disable-fiber-asm``.

Stacks, and castor
------------------

A *stack* is a PHP version, a set of extensions, what to embed, which targets
to build and where, with a name. The stacks of this repository are declared in
``stacks.php``, and `castor <https://castor.jolicode.com>`_ builds them with
one command; castor only runs ``docker buildx bake`` for you, the Dockerfile is
what knows how to compile PHP. Nobody needs castor to use this repository, and
no PHP is needed on the host but to serve a page (``castor wasm:serve``):
castor is a single binary, installed with ``curl
"https://castor.jolicode.com/install" | bash``.

.. code-block:: php

    <?php

    use PhpWasm\Stack;

    $default = Stack::named('default')
        ->php('8.5.12')
        ->extensions('calendar', 'ctype', 'dom', 'mbstring', 'simplexml', 'xml', 'xmlreader', 'xmlwriter')
        ->embed('examples/embed', at: '/examples')
        ->targets('web', 'node');

    return [
        $default,

        // Everything from default, and two more extensions
        $default->renamed('default-bcmath')->extensions('bcmath', 'tokenizer'),
    ];

A stack never changes: each method returns a new one, so a stack is derived
from another one with ``renamed()``. ``extensions()`` adds to the extensions
the stack already has, the other methods replace what it has. ``embed()`` is
relative to the root of the project, the directory of ``castor.php``, and the
directory shows up at ``/<its name>`` in the WASM filesystem, unless
``embed()`` is told where (``->embed('build/dist', at: '/app')``).
``outputDir()`` writes the files somewhere else than
``build/<stack>/``, also relative to the root of the project. ``memory()`` and
``icuData()`` set the ``MEMORY`` and ``ICU_DATA`` build arguments (see
`Options`_).

To build your own stacks with this repository as it is, declare them in a
``stacks.override.php`` file next to ``stacks.php``, with the same format (git
ignores it). Its stacks are added to the ones of ``stacks.php``, or replace the
ones that have the same name.

Unless a stack says otherwise, everything is built in ``build/<stack>/``::

    castor wasm:stacks                         # lists the stacks
    castor wasm:build                          # builds the default stack
    castor wasm:build intl                     # builds another one
    castor wasm:build --all                    # builds all of them, in one buildx invocation (with the overrides below)
    castor wasm:check                          # builds them all, and checks them
    castor wasm:sizes                          # compares the size of the .wasm files with the default stack
    castor wasm:run examples/embed/hello.php   # runs a file, in the default stack
    castor wasm:run -r 'echo PHP_VERSION;' --stack php-8.3
    castor wasm:serve                          # lists the examples that have a page
    castor wasm:serve notes                    # builds the page of examples/notes/, and serves it
    castor wasm:serve playground --stack intl  # another page, with the PHP version and the extensions of the intl stack

Anything in a stack can be overridden from the command line, so there is no
need to declare a stack to try something::

    castor wasm:build --php 8.3.35                      # the default stack, on PHP 8.3
    castor wasm:build php-8.3 --target node             # only the node target
    castor wasm:build --with tokenizer --with bcmath    # the default stack, and two more extensions
    castor wasm:build --memory 256mb --embed my-app     # more memory, another directory to embed
    castor wasm:build intl --icu-data none              # intl, without ICU's data
    castor wasm:build --print                           # only shows the bake file

What is built with overrides goes to the directory of the stack
(``build/default/``, ``build/php-8.3/``), in place of what was there.

``castor wasm:check`` is what tells that a stack works: once built, it runs
every build of each stack in node, the one for the web too, and checks that
``PHP_VERSION`` is the one that was asked for, that ``extension_loaded()`` is
true for every extension that was asked for, and that the JavaScript API
works (``tests/api.test.mjs``). It does not run what the stack embeds.

Playing with it
---------------

These are the stacks of ``stacks.php``:

- ``default``: PHP 8.5, with the default extensions, what ``docker buildx
  bake`` builds too;
- ``php-8.4`` and ``php-8.3``: the same thing, on older PHP versions;
- ``playground``: adds bcmath, filter and tokenizer, for the page of
  ``examples/playground/`` (see below);
- ``notes``: adds pdo_sqlite and sqlite3 (see `SQLite`_), for the page of
  ``examples/notes/`` (see below);
- ``intl``: adds intl (see `intl`_);
- ``intl-without-data``: adds intl, without ICU's data;
- ``full-without-intl-data``: every extension of `Supported Extensions`_, intl
  without ICU's data.

Each script of ``examples/embed/`` says which stack it needs, and says so
when it runs in another one. ``castor wasm:run`` offers to build the stack
when it is not built yet::

    castor wasm:run examples/embed/hello.php
    castor wasm:run examples/embed/xml.php --stack php-8.3
    castor wasm:run examples/embed/playground.php --stack playground
    castor wasm:run examples/embed/intl.php --stack intl

The examples that have a page are built by the stack of the same name, in
their ``public/`` directory. ``castor wasm:serve`` builds it, in a second when
nothing changed, and serves it on http://127.0.0.1:8000/, with the built-in
server of PHP. It lists them:

- ``examples/playground/`` runs the scripts of ``examples/embed/``, embedded at
  ``/examples``: pick one, change it, and run it;
- ``examples/notes/`` keeps notes in SQLite, that are still there after a
  reload, and searches them with FTS5. It is made as a project makes its page
  (see `Using it from your own project`_): the ``notes`` stack embeds its
  ``embed/`` directory at ``/app``.

``--stack`` builds the page with the PHP version and the extensions of another
stack: the one of ``intl.php``, for example::

    castor wasm:serve playground
    castor wasm:serve playground --stack intl

The page changes with a reload, its PHP when the server starts again.

Using it from your own project
------------------------------

The Dockerfile knows which emsdk works, how to cross-compile oniguruma and
libxml2, which ``./configure`` flags PHP needs to link and which ``emcc``
flags make it load. Any PHP project can reuse that with castor, instead of
copying the Dockerfile. This is how a project runs its PHP code in a page,
checks it, and deploys it. It needs Docker, castor, and node for the checks.
The pages of `See it live`_ are made this way.

Require the package
~~~~~~~~~~~~~~~~~~~

::

    castor composer require lyrixx/php-wasm-builder

It writes ``castor.composer.json`` and ``castor.composer.lock``, to commit,
and installs the package in ``.castor/vendor/``. The project gets
``PhpWasm\build()`` and ``PhpWasm\Stack``, but no task: the tasks of this
repository build its own stacks. Git ignores what is installed and what is
built:

.. code-block:: text

    # .gitignore
    /.castor/vendor/
    /build/
    /public/build/

Declare the stack, and build it
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The stack is declared once, in a function: the build and the checks need the
same one. What PHP runs in the page is a copy of the code of the project,
without its dev dependencies, embedded at ``/app``:

.. code-block:: php

    <?php
    // castor.php

    use Castor\Attribute\AsOption;
    use Castor\Attribute\AsTask;
    use PhpWasm\Stack;
    use Symfony\Component\Console\Input\InputOption;

    use function Castor\context;
    use function Castor\fs;
    use function Castor\run;
    use function PhpWasm\build;

    defined('CASTOR_USE_CHDIR') || define('CASTOR_USE_CHDIR', true);

    function wasm_stack(): Stack
    {
        return Stack::named('app')
            // Keep in sync with config.platform.php in composer.json
            ->php('8.5.12')
            // What the code needs, see "Supported Extensions"
            ->extensions('ctype', 'mbstring')
            // Relative to the project, at /app in the WASM filesystem
            ->embed('build/embed', at: '/app')
            // Only php-web.mjs and php-web.wasm
            ->targets('web')
            // Next to the page that loads them
            ->outputDir('public/build');
    }

    #[AsTask('build', namespace: 'wasm', description: 'Builds PHP as WebAssembly, with the code of the project')]
    function wasm_build(
        #[AsOption(description: 'Given to "docker buildx bake --set", for a cache', mode: InputOption::VALUE_REQUIRED | InputOption::VALUE_IS_ARRAY)]
        array $set = [],
    ): void {
        $embed = __DIR__ . '/build/embed';
        fs()->remove($embed);
        fs()->mirror(__DIR__ . '/src', "{$embed}/src");
        fs()->copy(__DIR__ . '/composer.json', "{$embed}/composer.json");
        fs()->copy(__DIR__ . '/composer.lock', "{$embed}/composer.lock");
        // What is embedded takes some of the memory of PHP: no dev dependencies
        run(['composer', 'install', '--no-dev', '--classmap-authoritative'], context: context()->withWorkingDirectory($embed));

        build([wasm_stack()], $set);
    }

``castor wasm:build`` writes ``public/build/php-web.mjs`` and
``php-web.wasm``. ``build()`` takes several stacks too: they are built in a
single buildx invocation, in parallel, and sharing the layers they have in
common.

Run it in the page
~~~~~~~~~~~~~~~~~~

The page runs a file of ``/app``, gives PHP its input on stdin, and gets what
PHP prints (see `JavaScript API`_):

.. code-block:: html

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

Keep files across reloads
~~~~~~~~~~~~~~~~~~~~~~~~~

The WASM filesystem is in memory: what PHP writes is gone with the page. The
build for the web keeps a directory in IndexedDB, with IDBFS, a filesystem of
emscripten, when it is given as ``persist``:

.. code-block:: js

    // What PHP writes in /my-page is still there after a reload
    const php = await createPhp({ persist: '/my-page' });

Each tab has its own copy of the files. A run reads IndexedDB before PHP runs,
what the other tabs wrote, and writes in it after, one run at a time across
the tabs of the page (with a Web Lock): no tab writes over what another one
wrote. ``php.FS`` sees the files as the last run of the tab left them: what
another tab wrote since is only there once a run has read it. The page of
``examples/notes/`` keeps an SQLite database this way (see `Playing with
it`_).

The directory names the IndexedDB database: two pages of the same origin that
keep the same directory share its files. Name it after the page:
``/composer-diff`` rather than ``/data``, when the pages of an organization
are all on ``<organization>.github.io``. IDBFS keeps whole files, in memory:

- a file that changes is written again in full: a row inserted in a 20 MB
  database writes the 20 MB again;
- the files take the memory of the page, not the one of PHP (``MEMORY``);
- the browser may clear IndexedDB when the disk is full, unless the page asks
  for ``navigator.storage.persist()``.

Emscripten reaches the Origin Private File System (OPFS) of the browser too,
but only with WasmFS, in place of the filesystem the build has, and with
threads (the page must then be served with the headers of cross-origin
isolation, COOP and COEP, that GitHub Pages does not send) or with JSPI or
Asyncify (that let PHP wait for the browser in the middle of a run). The build
does not do it.

Check it, without a browser
~~~~~~~~~~~~~~~~~~~~~~~~~~~

What is built for the web runs in node too. ``PhpWasm\check_stack()`` checks
that it boots, with its PHP version and its extensions, as ``castor
wasm:check`` does, and ``PhpWasm\run_code()`` runs some code in it, as
``runCode()`` does in the page. Both throw a ``ProblemException`` when
something is wrong, as castor's ``check()`` does:

.. code-block:: php

    use function Castor\check;
    use function PhpWasm\check_stack;
    use function PhpWasm\run_code;

    #[AsTask('smoke', namespace: 'wasm', description: 'Checks that what is built boots, and answers')]
    function wasm_smoke(): void
    {
        check_stack(wasm_stack());

        check('The page answers', 'The page does not answer.', fn (): bool => 'Hello…' === run_code(wasm_stack(), 'require "/app/src/page.php";', stdin: 'Hello...'));
    }

``run_code()`` returns what PHP prints, and throws when PHP does not exit with
0: an uncaught exception, a fatal error or an ``exit(1)``. Its ``stdin`` is
what PHP reads on ``php://stdin``.

``run_code()`` runs PHP, not the JavaScript of the page. When the page keeps
it in a module, ``PhpWasm\test_page()`` runs its tests with the test runner of
node, preloaded with ``node/fetch-files.mjs``: ``fetch()`` reads the files from
the disk, where a server would serve them from, and records their resource
timing, as a browser does. The module, and the ``php-web.mjs`` it loads, run
as they are:

.. code-block:: js

    // tests/page.test.mjs
    import assert from 'node:assert/strict';
    import { test } from 'node:test';

    // It loads ./build/php-web.mjs, and exports what the page calls
    import { answer } from '../public/page.mjs';

    test('the page answers', async () => {
        assert.equal(await answer('Hello...'), 'Hello…');
    });

.. code-block:: php

    use function PhpWasm\test_page;

    // In wasm_smoke(), relative to the root of the project
    test_page('tests/page.test.mjs');

``test_page()`` throws a ``ProblemException`` when a test fails, and node says
which one. The URLs that the page fetches are relative to ``import.meta.url``:
in node, they are ``file:`` URLs.

Deploy it, from GitHub Actions
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The layers of the build are kept in the cache of GitHub Actions, given to
``docker buildx bake --set``: a push only compiles what changed. And nothing
is deployed if it does not answer:

.. code-block:: yaml

    # .github/workflows/pages.yaml
    name: Pages

    on:
        push:
            branches: [main]

    permissions:
        contents: read
        pages: write
        id-token: write

    jobs:
        deploy:
            runs-on: ubuntu-latest
            environment:
                name: github-pages
                url: ${{ steps.deployment.outputs.page_url }}
            steps:
                - uses: actions/checkout@v7

                - uses: shivammathur/setup-php@v2
                  with:
                      php-version: '8.5'
                      tools: castor

                # The cache needs the docker-container driver of buildx…
                - uses: docker/setup-buildx-action@v4

                # …and the runtime token and URLs of GitHub Actions, that only
                # actions get
                - uses: crazy-max/ghaction-github-runtime@v4

                - run: castor wasm:build --set '*.cache-from=type=gha' --set '*.cache-to=type=gha,mode=max,ignore-error=true'

                - run: castor wasm:smoke

                - uses: actions/upload-pages-artifact@v5
                  with:
                      path: public

                - id: deployment
                  uses: actions/deploy-pages@v5

What is in this repository
--------------------------

- ``docker/``: how PHP is compiled, everything else only drives it. The
  ``Dockerfile`` compiles PHP, ``run.c`` runs it, and ``api.js`` is the
  JavaScript API of what is built (see `JavaScript API`_);
- ``node/``: ``run.mjs`` runs a PHP file, or some PHP code, in what is built,
  with node (the build for the web too), and ``fetch-files.mjs`` lets node run
  the modules of a page as a browser does, to test them (see `Check it,
  without a browser`_);
- ``examples/``: what an ``embed/`` directory has is embedded in what is
  built, what a ``public/`` directory has is served. ``examples/embed/`` has a
  few PHP scripts, embedded in every stack at ``/examples``,
  ``examples/playground/`` a page that runs them, and ``examples/notes/`` a
  page that keeps notes in SQLite (see `Playing with it`_);
- ``stacks.php``, ``src/`` and ``castor.php``: named builds, a ``build()``
  function, and castor tasks to build, run and check them (see `Stacks, and
  castor`_);
- ``tests/``: the tests of the JavaScript API, and of ``fetch-files.mjs``.

Credits
-------

This builder was created by `Derick Rethans <https://github.com/derickr>`__,
for `The PHP Foundation <https://github.com/ThePHPF>`__, in
`derickr/php-wasm-builder
<https://github.com/derickr/php-wasm-builder>`__. What runs PHP,
``docker/run.c`` (``phpw.c`` there), comes from the work of `Antoine Bluchet
<https://github.com/soyuka>`__ on PHP in WebAssembly. Both are under the MIT
license, see ``LICENSE``.

Thanks to the people whose work on the original repository is part of this
one: `Lewis Cowles <https://github.com/Lewiscowles1986>`__, `Arnaud Le Blanc
<https://github.com/arnaud-lb>`__, `Jordi Kroon
<https://github.com/jordikroon>`__, and `Marc (henderkes)
<https://github.com/henderkes>`__, for the work on the intl extension in
`derickr/php-wasm-builder#7 <https://github.com/derickr/php-wasm-builder/pull/7>`__
and `#8 <https://github.com/derickr/php-wasm-builder/pull/8>`__.
