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
- ``examples/``: a few PHP scripts, embedded in what is built as ``/examples``;
- ``run.mjs``: runs some PHP code, or a PHP file, in what is built, with node
  (the build for the web too);
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
    node run.mjs examples/hello.php
    node run.mjs -r 'require "/examples/hello.php";'

``node run.mjs examples/hello.php`` reads the file from your disk, so you can
edit it and run it again without building anything. ``/examples/hello.php`` is
the copy embedded in the ``.wasm`` file: it only changes with a new build.
``--build build/default/php-web.mjs`` runs the build for the web instead, the
one a browser loads.

Everything else is a build argument (see `Options`_). By default, this builds
PHP 8.5.11, with the extensions listed in `Supported Extensions`_::

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

EMSDK_VERSION
    The version of the Emscripten SDK that compiles everything, a tag of the
    `emscripten/emsdk <https://hub.docker.com/r/emscripten/emsdk>`_ image. It
    is pinned, so that the same arguments always give the same build.

The directory to embed in the WASM filesystem is the ``embed`` named build
context. ``docker-bake.hcl`` sets it to ``examples/``; anything can be used
instead::

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
- SimpleXML
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
    node run.mjs examples/intl.php

The ``intl`` stack (see `Stacks, and castor`_) is the same build.

When the code only needs intl to be loaded, ``ICU_DATA=none`` leaves the
data out: the ``.wasm`` file is then about 2 MB bigger than without intl (less
than 1 MB gzipped), and it needs no more memory. ICU only has what is in its
code: NFC normalization, and the character properties of ``IntlChar``.
Everything else fails: ``Locale::getDisplayLanguage('fr', 'en')`` gives
``fr``, and the formatters, collators, transliterators and ``grapheme_*()``
functions do not work. The ``intl-without-data`` stack is this build::

    docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter intl" --set default.args.ICU_DATA=none

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
no PHP is needed on the host: castor is a single binary, installed with
``curl "https://castor.jolicode.com/install" | bash``.

.. code-block:: php

    <?php

    use PhpWasm\Stack;

    $default = Stack::named('default')
        ->php('8.5.11')
        ->extensions('calendar', 'ctype', 'dom', 'mbstring', 'simplexml', 'xml', 'xmlreader', 'xmlwriter')
        ->embed('examples')
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
    castor wasm:run examples/hello.php         # runs a file, in the default stack
    castor wasm:run -r 'echo PHP_VERSION;' --stack php-8.3

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
- ``intl``: adds intl (see `intl`_);
- ``intl-without-data``: adds intl, without ICU's data.

Each script of ``examples/`` says which stack it needs::

    castor wasm:run examples/hello.php
    castor wasm:run examples/xml.php --stack php-8.3
    castor wasm:build playground
    castor wasm:run examples/playground.php --stack playground
    castor wasm:build intl
    castor wasm:run examples/intl.php --stack intl

Using it from your own project
------------------------------

The Dockerfile knows which emsdk works, how to cross-compile oniguruma and
libxml2, which ``./configure`` flags PHP needs to link and which ``emcc``
flags make it load. Any PHP project can reuse that, instead of copying the
Dockerfile, by requiring this repository as a castor package::

    castor composer require lyrixx/php-wasm-builder

Then build your stacks from your own tasks, with ``PhpWasm\build()``. Declare
them wherever suits your project:

.. code-block:: php

    <?php
    // castor.php

    use Castor\Attribute\AsTask;
    use PhpWasm\Stack;

    use function PhpWasm\build;

    defined('CASTOR_USE_CHDIR') || define('CASTOR_USE_CHDIR', false);

    #[AsTask]
    function wasm(): void
    {
        build([
            Stack::named('my-app')
                ->php('8.5.11')
                ->extensions('ctype', 'mbstring', 'tokenizer')
                // Relative to your project, like outputDir(): at /app in the WASM filesystem
                ->embed('build/dist', 'app')
                // build/my-app/ by default
                ->outputDir('public/build'),
        ]);
    }

Several stacks given at once are built in a single buildx invocation: in
parallel, and sharing the layers they have in common. Requiring the package
does not add any task to your project: the tasks of this repository build its
own stacks.

The second argument of ``build()`` is given to ``docker buildx bake --set``.
On GitHub Actions, this keeps the layers in the cache of the repository, as
the CI of this repository does (the cache needs
`crazy-max/ghaction-github-runtime
<https://github.com/crazy-max/ghaction-github-runtime>`_)::

    build([$stack], [
        '*.cache-from=type=gha',
        '*.cache-to=type=gha,mode=max,ignore-error=true',
    ]);

What is built for the web runs in node too: a project can check that it boots
and answers, in its CI, without a browser. ``PhpWasm\check_stack()`` does what
``castor wasm:test`` does, and ``PhpWasm\run_wasm()`` runs some code in the
build of the first target of a stack, the web one by default. Both throw a
``ProblemException`` when something is wrong, as castor's ``check()`` does:

.. code-block:: php

    <?php
    // castor.php

    use Castor\Attribute\AsTask;

    use function Castor\check;
    use function PhpWasm\check_stack;
    use function PhpWasm\run_wasm;

    #[AsTask]
    function smoke(): void
    {
        // The PHP version, and the extensions
        check_stack(my_stack());

        // The code of the project, as the page runs it
        check('The page says hello', 'The page does not say hello.', fn (): bool => 'Hello!' === run_wasm(my_stack(), 'require "/app/hello.php";'));
    }

``run_wasm()`` returns what PHP prints, and throws when PHP does not exit with
0: an uncaught exception, a fatal error or an ``exit(1)``.

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
