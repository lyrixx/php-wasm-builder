PHP WASM Builder
================

Builds PHP as WebAssembly, for the browser and for node, with the PHP version
and the extensions you ask for. Only Docker is needed to build it, and node to
run what is built.

This repository started as a fork of `derickr/php-wasm-builder
<https://github.com/derickr/php-wasm-builder>`_, the builder of the PHP WASM
files of the php.net documentation, and it is where it is developed now (see
`Credits`_).

What is in here:

- ``Dockerfile``: how PHP is compiled, everything else only drives it;
- ``phpw.c``: the functions that JavaScript calls to run PHP (``phpw_run()``…);
- ``examples/``: what an ``embed/`` directory has is embedded in what is
  built, what a ``public/`` directory has is served. ``examples/embed/`` has a
  few PHP scripts, embedded in every stack as ``/examples``, and
  ``examples/notes/`` a page that runs PHP (see `Playing with it`_);
- ``run.mjs``: runs some PHP code, or a PHP file, in what is built, with node
  (the build for the web too);
- ``page.mjs``: lets node run the modules of a page as a browser does, to test
  them (see `Check it, without a browser`_);
- ``stacks.php``, ``src/`` and ``castor.php``: named builds, a ``build()``
  function, and castor tasks to build, run and test them (see `Stacks, and
  castor`_).

Quick start
-----------

With Docker only (`castor <https://castor.jolicode.com>`_ makes it simpler, see
`Stacks, and castor`_), build PHP::

    docker buildx bake

The files end up in ``build/default/``: ``php-web.mjs`` and ``php-web.wasm``
for the browser, ``php-cli.mjs`` and ``php-cli.wasm`` for node. Run PHP in
them::

    node run.mjs -r 'echo PHP_VERSION;'
    node run.mjs examples/embed/hello.php
    node run.mjs -r 'require "/examples/hello.php";'

``node run.mjs examples/embed/hello.php`` reads the file from your disk, so
you can edit it and run it again without building anything.
``/examples/hello.php`` is the copy embedded in the ``.wasm`` file: it only
changes with a new build.
``--build build/default/php-web.mjs`` runs the build for the web instead, the
one a browser loads.

Everything else is a build argument (see `Options`_). By default, this builds
PHP 8.5.12, with the extensions listed in `Supported Extensions`_::

    docker buildx bake --set default.args.PHP_VERSION=8.4.26                    # another PHP version
    docker buildx bake --set default.args.EXTENSIONS="ctype tokenizer bcmath"   # other extensions
    docker buildx bake --set default.args.TARGETS=node                          # only php-cli.mjs and php-cli.wasm

In a browser, ``php-web.mjs`` is the same module, built for the web. Serve it
next to its ``php-web.wasm``, from any static server:

.. code-block:: html

    <pre id="output"></pre>
    <script type="module">
        import createPhpModule from './php-web.mjs';

        const output = document.getElementById('output');
        const php = await createPhpModule({
            print: (line) => output.textContent += line + '\n',
        });

        php.ccall('phpw_run', null, ['string'], ['echo "Hello from PHP ", PHP_VERSION;']);
    </script>

``phpw_run()`` runs some code, ``phpw()`` a file of the WASM filesystem. Both
return the exit status of PHP: the one given to ``exit()``, 255 on a fatal
error or an uncaught exception, 0 otherwise. Ask ``ccall()`` for it with
``'number'`` instead of ``null``.

Options
-------

The following options are available for the baker:

PHP_VERSION
    Configures the PHP version to build.

EXTENSIONS
    The extensions to build, separated by spaces. Defaults to
    ``calendar ctype dom mbstring simplexml xml xmlreader xmlwriter``.

    The libraries that the extensions need (oniguruma for ``mbstring``, libxml2
    for the xml ones) are only built when an extension asks for them.

TARGETS
    The files to build: ``web`` for ``php-web.mjs`` and ``php-web.wasm``, and
    ``node`` for ``php-cli.mjs`` and ``php-cli.wasm``. Defaults to ``web node``.

MEMORY
    The (initial and maximum) memory of the WASM module. Defaults to ``128mb``.

ICU_DATA
    The data of ICU that intl links (see `intl`_): ``all`` (the default) or
    ``none``.

EMBED_PATH
    The name that the embedded directory has in the WASM filesystem. Defaults
    to ``examples``.

LIBXML_VERSION
    The LibXML version to download and build.

ONIGURUMA_VERSION
    The Oniguruma library (used for regular expressions with mbstring) version
    to download and build.

ICU_VERSION
    The ICU library (used by intl) version to download and build, for example
    ``78.3``.

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

    docker buildx bake --set default.contexts.embed=./my-app --set default.args.EMBED_PATH=my-app

Supported Extensions
--------------------

These are the extensions that can be listed in ``EXTENSIONS``:

- bcmath
- calendar
- ctype
- dom
- filter
- intl (see `intl`_)
- libxml
- mbstring
- PDO
- pdo_sqlite (see `SQLite`_)
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
``Dockerfile`` (and a stage for the library that it needs, if it needs one),
and to ``Stack::EXTENSIONS``.

intl
~~~~

intl is linked statically, with ICU and all of its data (every locale): there
is no ``intl.so`` to load, nor data file to fetch, and it works the same on the
web and on node. It does not come cheap, which is why it is not in the default
extensions: the ``.wasm`` file is about 33 MB bigger (14 MB gzipped), and the
data takes 32 MB of the memory of the module. Add it to the extensions, with
32 MB more memory::

    docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter intl" --set default.args.MEMORY=160mb
    node run.mjs examples/embed/intl.php

The ``intl`` stack (see `Stacks, and castor`_) is the same build.

When the code only needs intl to be loaded, ``ICU_DATA=none`` leaves the
data out: the ``.wasm`` file is then about 2 MB bigger than without intl (less
than 1 MB gzipped), and it needs no more memory. ICU only has what is in its
code: NFC normalization, and the character properties of ``IntlChar``.
Everything else fails: ``Locale::getDisplayLanguage('fr', 'en')`` gives
``fr``, and the formatters, collators, transliterators and ``grapheme_*()``
functions do not work. The ``intl-without-data`` stack is this build::

    docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter intl" --set default.args.ICU_DATA=none

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
        ->embed('examples/embed', 'examples')
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
``embed()`` is given another name (``->embed('build/dist', 'app')`` for
``/app``). ``outputDir()`` writes the files somewhere else than
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
    castor wasm:test                           # builds them all, and checks them
    castor wasm:sizes                          # compares the size of the .wasm files with the default stack
    castor wasm:run examples/embed/hello.php   # runs a file, in the default stack
    castor wasm:run -r 'echo PHP_VERSION;' --stack php-8.3
    castor wasm:serve notes                    # serves the page of examples/notes/

Anything in a stack can be overridden from the command line, so there is no
need to declare a stack to try something::

    castor wasm:build --php 8.3.35                      # the default stack, on PHP 8.3
    castor wasm:build playground --target node          # only the node target
    castor wasm:build --with tokenizer --with bcmath    # the default stack, and two more extensions
    castor wasm:build --memory 256mb --embed my-app     # more memory, another directory to embed
    castor wasm:build intl --icu-data none              # intl, without ICU's data
    castor wasm:build --print                           # only shows the bake file

What is built with overrides goes to the directory of the stack
(``build/default/``, ``build/playground/``), in place of what was there.

``castor wasm:test`` is what tells that a stack works: once built, it runs
every build of each stack in node, the one for the web too, and checks that
``PHP_VERSION`` is the one that was asked for, and that ``extension_loaded()``
is true for every extension that was asked for. It does not run what the stack
embeds.

Playing with it
---------------

These are the stacks of ``stacks.php``:

- ``default``: PHP 8.5, with the default extensions, what ``docker buildx
  bake`` builds too;
- ``php-8.4`` and ``php-8.3``: the same thing, on older PHP versions;
- ``playground``: adds bcmath, filter and tokenizer;
- ``notes``: adds pdo_sqlite and sqlite3 (see `SQLite`_), for the page of
  ``examples/notes/`` (see below);
- ``intl``: adds intl (see `intl`_);
- ``intl-without-data``: adds intl, without ICU's data.

Each script of ``examples/embed/`` says which stack it needs::

    castor wasm:run examples/embed/hello.php
    castor wasm:run examples/embed/xml.php --stack php-8.3
    castor wasm:build playground
    castor wasm:run examples/embed/playground.php --stack playground
    castor wasm:build intl
    castor wasm:run examples/embed/intl.php --stack intl

``examples/notes/`` is a page that runs PHP: it keeps notes in SQLite, that
are still there after a reload, and searches them with FTS5. It is made as a
project makes its page (see `Using it from your own project`_): the ``notes``
stack embeds its ``embed/`` directory as ``/app``, and is built in its
``public/`` directory, that ``castor wasm:serve`` serves on
http://127.0.0.1:8000/, with the built-in server of PHP::

    castor wasm:build notes
    castor wasm:serve notes

The page changes with a reload, its PHP with a new build.

Using it from your own project
------------------------------

The Dockerfile knows which emsdk works, how to cross-compile oniguruma and
libxml2, which ``./configure`` flags PHP needs to link and which ``emcc``
flags make it load. Any PHP project can reuse that with castor, instead of
copying the Dockerfile. This is how a project runs its PHP code in a page,
checks it, and deploys it. It needs Docker, castor, and node for the checks.

These projects do it, their pages run PHP in the browser:

- `composer-diff <https://lyrixx.github.io/composer-diff/>`__ (`sources
  <https://github.com/lyrixx/composer-diff>`__): compares two
  ``composer.lock``;
- `emoji-converter <https://jolicode.github.io/emoji-converter/>`__ (`sources
  <https://github.com/jolicode/emoji-converter>`__): turns 🐘 into
  ``:elephant:`` and back;
- `JoliTypo <https://jolitypo.jolicode.com/>`__ (`sources
  <https://github.com/jolicode/JoliTypo>`__): fixes the microtypography of an
  HTML text.

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
            ->embed('build/embed', 'app')
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

The page gives PHP its input in the WASM filesystem, runs a file of ``/app``,
and gets what PHP prints. Each call is a request of its own, the files of the
WASM filesystem stay:

.. code-block:: html

    <!-- public/index.html -->
    <pre id="output"></pre>
    <script type="module">
        import createPhpModule from './build/php-web.mjs';

        let output = '';
        const php = await createPhpModule({
            print: (line) => output += line + '\n',
        });

        php.FS.writeFile('/tmp/input.txt', 'Hello...');
        const status = php.ccall('phpw', 'number', ['string'], ['/app/src/page.php']);

        document.getElementById('output').textContent = 0 === status ? output : 'PHP failed, see the console.';
    </script>

``phpw()`` returns the exit status of PHP (see `Quick start`_), and what PHP
writes on stderr goes to the console.

Keep files across reloads
~~~~~~~~~~~~~~~~~~~~~~~~~

The WASM filesystem is in memory: what PHP writes is gone with the page. The
build for the web comes with IDBFS, a filesystem of emscripten that keeps a
directory in IndexedDB. The page mounts it, reads it before PHP runs, and
writes it after:

.. code-block:: js

    php.FS.mkdir('/data');
    php.FS.mount(php.IDBFS, {}, '/data');

    const syncfs = (populate) => new Promise((resolve, reject) => {
        php.FS.syncfs(populate, (error) => error ? reject(error) : resolve());
    });

    // One call at a time, across the tabs of the page
    const run = (file) => navigator.locks.request('php', async () => {
        await syncfs(true);  // IndexedDB to /data: what the other tabs wrote
        const status = php.ccall('phpw', 'number', ['string'], [file]);
        await syncfs(false); // /data to IndexedDB

        return status;
    });

Each tab has its own copy of the files: without the lock, and without reading
IndexedDB before PHP runs, a tab writes over what another one wrote. An SQLite
database in ``/data`` is kept this way, the page of ``examples/notes/`` does
it (see `Playing with it`_). IDBFS keeps whole files, in memory:

- a file that changes is written again in full: a row inserted in a 20 MB
  database writes the 20 MB again;
- the files take the memory of the page, not the one of PHP (``MEMORY``);
- the browser may clear IndexedDB when the disk is full, unless the page asks
  for ``navigator.storage.persist()``.

Emscripten reaches the Origin Private File System (OPFS) of the browser too,
but only with WasmFS, in place of the filesystem the build has, and with
threads (the page must then be served with the headers of cross-origin
isolation, COOP and COEP, that GitHub Pages does not send) or with JSPI or
Asyncify (each call to PHP is then asynchronous). The build does not do it.

Check it, without a browser
~~~~~~~~~~~~~~~~~~~~~~~~~~~

What is built for the web runs in node too. ``PhpWasm\check_stack()`` checks
that it boots, with its PHP version and its extensions, as ``castor
wasm:test`` does, and ``PhpWasm\run_wasm()`` runs some code in it, as the page
does. Both throw a ``ProblemException`` when something is wrong, as castor's
``check()`` does:

.. code-block:: php

    use function Castor\check;
    use function PhpWasm\check_stack;
    use function PhpWasm\run_wasm;

    #[AsTask('smoke', namespace: 'wasm', description: 'Checks that what is built boots, and answers')]
    function wasm_smoke(): void
    {
        check_stack(wasm_stack());

        check('The page answers', 'The page does not answer.', fn (): bool => 'Hello…' === run_wasm(wasm_stack(), <<<'PHP'
            file_put_contents('/tmp/input.txt', 'Hello...');
            require '/app/src/page.php';
            PHP));
    }

``run_wasm()`` returns what PHP prints, and throws when PHP does not exit with
0: an uncaught exception, a fatal error or an ``exit(1)``.

``run_wasm()`` runs PHP, not the JavaScript of the page. When the page keeps
it in a module, ``PhpWasm\test_page()`` runs its tests with the test runner of
node, preloaded with ``page.mjs``: ``fetch()`` reads the files from the disk,
where a server would serve them from, and records their resource timing, as a
browser does. The module, and the ``php-web.mjs`` it loads, run as they are:

.. code-block:: js

    // tests/page.test.mjs
    import assert from 'node:assert/strict';
    import { test } from 'node:test';

    // It loads ./build/php-web.mjs, and exports what the page calls
    import { answer } from '../public/page.mjs';

    test('the page answers', () => {
        assert.equal(answer('Hello...'), 'Hello…');
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

Credits
-------

This builder was created by `Derick Rethans <https://github.com/derickr>`__,
for `The PHP Foundation <https://github.com/ThePHPF>`__, in
`derickr/php-wasm-builder <https://github.com/derickr/php-wasm-builder>`__. Its
shim, ``phpw.c``, comes from the work of `Antoine Bluchet
<https://github.com/soyuka>`__ on PHP in WebAssembly. Both are under the MIT
license, see ``LICENSE``.

Thanks to the people whose work on the original repository is part of this
one: `Lewis Cowles <https://github.com/Lewiscowles1986>`__, `Arnaud Le Blanc
<https://github.com/arnaud-lb>`__, `Jordi Kroon
<https://github.com/jordikroon>`__, and `Marc (henderkes)
<https://github.com/henderkes>`__, for the work on the intl extension in
`derickr/php-wasm-builder#7 <https://github.com/derickr/php-wasm-builder/pull/7>`__
and `#8 <https://github.com/derickr/php-wasm-builder/pull/8>`__.
