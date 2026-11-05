# Use it in your project

The Dockerfile knows which emsdk works, how to cross-compile oniguruma and libxml2, which
`./configure` flags PHP needs to link, and which `emcc` flags make it load. A PHP project reuses it
by requiring the package, instead of copying it. These pages show how a project builds PHP with its
code in it, runs it in a page, checks it, and deploys it:

1. [Build it](build.md), with the code of the project;
2. [run it in the page](page.md);
3. [check it](check.md), without a browser;
4. [deploy it](deploy.md), to GitHub Pages.

Each step is shown with [castor](https://castor.jolicode.com), that declares the build in PHP, and
checks it, and with Composer and Docker only. Pick one: the other pages remember it. The pages
[built with it](../index.md#built-with-it) use castor.

## Require the package

=== "castor"

    ```
    castor composer require lyrixx/php-wasm-builder
    ```

    It writes `castor.composer.json` and `castor.composer.lock`, to commit, and installs the package
    in `.castor/vendor/`. The project gets `PhpWasm\build()` and `PhpWasm\Stack`, but no task: the
    tasks of this repository build its own stacks.

    Git ignores what is installed, and what is built:

    ```text
    # .gitignore
    /.castor/vendor/
    /build/
    /public/build/
    ```

    It needs Docker, castor, and node for the checks.

=== "Composer and Docker"

    ```
    composer require --dev lyrixx/php-wasm-builder
    ```

    It brings the Dockerfile, in `vendor/lyrixx/php-wasm-builder/docker/`, and
    `vendor/lyrixx/php-wasm-builder/node/run.mjs`, that runs PHP in node. It is a dev dependency:
    it builds the page, the code of the project does not need it.

    Git ignores what is built:

    ```text
    # .gitignore
    /build/
    /public/build/
    ```

    It needs Docker, and node for the checks.
