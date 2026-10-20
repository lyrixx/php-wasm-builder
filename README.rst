PHP WASM Builder
================

The Dockerfile in this repository builds PHP as WebAssembly, for the browser
and for node, with the extensions you ask for.

This repository is a fork of `derickr/php-wasm-builder
<https://github.com/derickr/php-wasm-builder>`_, which builds the PHP WASM
files of the php.net documentation and of the PHP Tour, and it is where the
builder is developed now (see `Credits`_). Its default build, the ``php.net``
stack, is still what php.net ships: the same extensions, built with the same
flags.

Only Docker is needed to build it, and node to run what is built. `castor
<https://castor.jolicode.com>`_ makes it simpler: named stacks, and tasks to
build, run and test them, see `Stacks, and castor`_.

Build it with::

    docker buildx bake

The files then end up in the ``build/php.net/`` directory. For php.net, the
``.wasm`` and ``.mjs`` files for the web are the ones to copy to
https://github.com/php/web-php.git/js (as ``php-web.wasm`` and
``php-web.mjs``).

Everything else is a build argument (see `Options`_). By default, this builds
PHP 8.5.11, with the extensions of php.net (see `Supported Extensions`_)::

    docker buildx bake --set default.args.PHP_VERSION=8.4.26                    # another PHP version
    docker buildx bake --set default.args.EXTENSIONS="ctype tokenizer bcmath"   # other extensions
    docker buildx bake --set default.args.TARGETS=node                          # only php-cli.mjs and php-cli.wasm

Then run PHP in what is built, with node::

    node demo/run-cli.mjs -r 'echo PHP_VERSION;'
    node demo/run-cli.mjs -r 'var_dump(get_loaded_extensions());'
    node demo/run-cli.mjs demo/phpinfo.php

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

The follow options are available for the baker:

PHP_VERSION
    Configures the PHP version to build.

EXTENSIONS
    The extensions to build, separated by spaces. It defaults to the ones that
    php.net ships: ``calendar ctype dom mbstring simplexml xml xmlreader xmlwriter``.

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
    The version of the Emscripten SDK that compiles everything. It is pinned,
    so that the same arguments always give the same build.

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
web and on node. It does not come cheap, which is why php.net does not ship
it: the ``.wasm`` file is about 33 MB bigger (14 MB gzipped), and the data
takes 32 MB of the memory of the module. Add it to the extensions, with 32 MB
more memory::

    docker buildx bake --set default.args.EXTENSIONS="calendar ctype dom mbstring simplexml xml xmlreader xmlwriter intl" --set default.args.MEMORY=160mb
    node demo/run-cli.mjs -r 'echo (new NumberFormatter("fr_FR", NumberFormatter::CURRENCY))->formatCurrency(1234.5, "EUR");'

The ``intl`` stack (see `Stacks, and castor`_) is the same build.

Limitations
-----------

- Fibers
    WebAssembly cannot pause and resume code the way Fibers require, so the
    build uses ``--disable-fiber-asm``.

Stacks, and castor
------------------

A *stack* is a PHP version, a set of extensions, what to embed and which
targets to build, with a name. The stacks are declared in ``stacks.php``, and
`castor <https://castor.jolicode.com>`_ builds them with one command; castor
only runs ``docker buildx bake`` for you, the Dockerfile is what knows how to
compile PHP. Nobody needs castor to use this repository, and no PHP is needed
on the host: castor is a single binary, installed with
``curl "https://castor.jolicode.com/install" | bash``.

.. code-block:: php

    <?php

    use PhpWasm\Stack;

    return [
        Stack::named('php.net')
            ->php('8.5.11')
            ->extensions('calendar', 'ctype', 'dom', 'mbstring', 'simplexml', 'xml', 'xmlreader', 'xmlwriter')
            ->embed('examples')
            ->targets('web', 'node'),

        // Inherits everything from php.net, and adds two extensions
        Stack::named('php.net-bcmath')->from('php.net')->extensions('bcmath', 'tokenizer'),
    ];

A stack that inherits from another one with ``from()`` gets whatever it does
not declare from it. The extensions it declares are added to the ones of its
parent, the rest replaces what the parent says. ``embed()`` is relative to the
directory of the ``stacks.php`` file.

Everything is built in ``build/<stack>/``::

    castor wasm:stacks                         # lists the stacks
    castor wasm:build                          # builds the php.net stack
    castor wasm:build playground               # builds another one
    castor wasm:build --all                    # builds all of them, in one buildx invocation
    castor wasm:test                           # builds them all, and checks them
    castor wasm:sizes                          # compares the size of the .wasm files with php.net's
    castor wasm:run demo/phpinfo.php           # runs a file, with the php.net stack
    castor wasm:run -r 'echo PHP_VERSION;' --stack playground

Anything in a stack can be overridden from the command line, so there is no
need to declare a stack to try something::

    castor wasm:build --php 8.3.35                      # the php.net stack, on PHP 8.3
    castor wasm:build playground --target node          # only the node target
    castor wasm:build --with tokenizer --with bcmath    # php.net, and two more extensions
    castor wasm:build --memory 256mb --embed my-app     # more memory, another directory to embed
    castor wasm:build --print                           # only shows the bake file

What is built with overrides goes to the directory of the stack
(``build/php.net/``, ``build/playground/``), in place of what was there.

``castor wasm:test`` is what tells that a stack works: once built, it runs each
stack in node, and checks that ``PHP_VERSION`` is the one that was asked for,
and that ``extension_loaded()`` is true for every extension that was asked for.
It does not run what the stack embeds.

Playing with it
---------------

Once a stack is built, ``castor wasm:run`` runs PHP in it, with
``demo/run-cli.mjs``::

    castor wasm:build
    castor wasm:run -r 'echo PHP_VERSION;'
    castor wasm:run -r 'var_dump(get_loaded_extensions());'

A stack also embeds a directory, that PHP sees in the WASM filesystem. The
php.net stack embeds ``examples/`` as ``/examples``: these are the files that
the examples of the PHP manual open (XML documents, the DocBook DTD…), so that
they run on php.net too::

    castor wasm:run -r 'echo simplexml_load_file("/examples/book-simple.xml")->book[0]->title;'

The ``playground`` stack adds tokenizer, bcmath and filter, and embeds
``playground/app/`` as ``/app``. A file given to ``castor wasm:run`` is read
from your disk, so you can edit it and run it again without building anything;
the embedded copy only changes with a new build::

    castor wasm:build playground
    castor wasm:run -r 'require "/app/index.php";' --stack playground    # the embedded copy
    castor wasm:run playground/app/index.php --stack playground          # the one on your disk

The ``intl`` stack is the place to try what ICU can do::

    castor wasm:build intl
    castor wasm:run -r 'echo (new IntlDateFormatter("fr_FR", IntlDateFormatter::FULL, IntlDateFormatter::NONE))->format(time());' --stack intl
    castor wasm:run -r '$c = new Collator("fr_FR"); $words = ["été", "eau", "Ébène", "zèbre"]; $c->sort($words); echo implode(" ", $words);' --stack intl

Using it from your own project
------------------------------

The Dockerfile knows which emsdk works, how to cross-compile oniguruma and
libxml2, which ``./configure`` flags PHP needs to link and which ``emcc``
flags make it load. Any PHP project can reuse that, instead of copying the
Dockerfile, by importing this repository as a castor package::

    castor composer require lyrixx/php-wasm-builder

.. code-block:: php

    <?php
    // castor.php

    use function Castor\import;

    defined('CASTOR_USE_CHDIR') || define('CASTOR_USE_CHDIR', false);

    import('composer://lyrixx/php-wasm-builder');

Then declare your stacks, with the same format, in a ``stacks.php`` file next
to ``castor.php``. The stacks of this repository are there to inherit from:

.. code-block:: php

    <?php
    // stacks.php

    use PhpWasm\Stack;

    return [
        Stack::named('my-app')
            ->from('php.net')
            ->php('8.5.11')
            ->extensions('tokenizer', 'bcmath')
            ->embed('dist'),    // relative to your project
    ];

``castor wasm:build my-app`` then builds it in the ``build/my-app/`` directory of
your project. The tasks are under a ``wasm:`` prefix, so they do not collide
with the ones of your project.

Credits
-------

This builder was created by Derick Rethans, for The PHP Foundation, in
`derickr/php-wasm-builder <https://github.com/derickr/php-wasm-builder>`_. Its
shim, ``phpw.c``, comes from the work of Antoine Bluchet on PHP in WebAssembly.
Both are under the MIT license, see ``LICENSE``.

Thanks to the people whose work on the original repository is part of this
one: Lewis Cowles, Arnaud Le Blanc, Jordi Kroon, and Marc (henderkes), for the
work on the intl extension in derickr/php-wasm-builder#7 and #8.
