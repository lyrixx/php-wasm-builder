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
- ``run.mjs``: runs some PHP code, or a PHP file, in what is built, with node;
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

To add an extension, add a line to the ``ext`` list at the top of the
``Dockerfile`` (and a stage for the library that it needs, if it needs one).

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

Limitations
-----------

- Fibers
    WebAssembly cannot pause and resume code the way Fibers require, so the
    build uses ``--disable-fiber-asm``.

Stacks, and castor
------------------

A *stack* is a PHP version, a set of extensions, what to embed and which
targets to build, with a name. The stacks of this repository are declared in
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
relative to the root of the project, the directory of ``castor.php``.

To build your own stacks with this repository as it is, declare them in a
``stacks.override.php`` file next to ``stacks.php``, with the same format (git
ignores it). Its stacks are added to the ones of ``stacks.php``, or replace the
ones that have the same name.

Everything is built in ``build/<stack>/``::

    castor wasm:stacks                         # lists the stacks
    castor wasm:build                          # builds the default stack
    castor wasm:build intl                     # builds another one
    castor wasm:build --all                    # builds all of them, in one buildx invocation
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
    castor wasm:build --print                           # only shows the bake file

What is built with overrides goes to the directory of the stack
(``build/default/``, ``build/playground/``), in place of what was there.

``castor wasm:test`` is what tells that a stack works: once built, it runs each
stack in node, and checks that ``PHP_VERSION`` is the one that was asked for,
and that ``extension_loaded()`` is true for every extension that was asked for.
It does not run what the stack embeds.

Playing with it
---------------

These are the stacks of ``stacks.php``:

- ``default``: PHP 8.5, with the default extensions, what ``docker buildx
  bake`` builds too;
- ``php-8.4`` and ``php-8.3``: the same thing, on older PHP versions;
- ``playground``: adds bcmath, filter and tokenizer;
- ``intl``: adds intl (see `intl`_).

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
them wherever suits your project, they are built in the ``build/<stack>/``
directory of your project:

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
        build(
            Stack::named('my-app')
                ->php('8.5.11')
                ->extensions('ctype', 'mbstring', 'tokenizer')
                ->embed('dist'),    // relative to your project
        );
    }

Several stacks given at once are built in a single buildx invocation: in
parallel, and sharing the layers they have in common. Requiring the package
does not add any task to your project: the tasks of this repository build its
own stacks.

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
