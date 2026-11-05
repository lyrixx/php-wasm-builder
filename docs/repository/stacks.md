# Stacks

A *stack* is a PHP version, a set of extensions, what to embed, which targets to build and where,
with a name. The builds of this repository are declared in `stacks.php`, the page of each example in
its `stack.php`, and [castor](https://castor.jolicode.com) builds them with one command. castor only
runs `docker buildx bake` for you, the Dockerfile is what knows how to compile PHP: nobody needs
castor to use this repository. castor is a single binary, installed with
`curl "https://castor.jolicode.com/install" | bash`.

```php
<?php

use PhpWasm\Stack;
use PhpWasm\Target;

$php85 = Stack::named('php-8.5')
    ->php('8.5.12')
    ->extensions('calendar', 'ctype', 'dom', 'mbstring', 'simplexml', 'xml', 'xmlreader', 'xmlwriter')
    ->targets(Target::Web, Target::Node);

return [
    $php85,

    // Everything from php-8.5, and two more extensions
    $php85->renamed('php-8.5-bcmath')->extensions('bcmath', 'tokenizer'),
];
```

A stack never changes: each method returns a new one, so a stack is derived from another one with
`renamed()`. `extensions()` adds to the extensions the stack already has, the other methods replace
what it has. Each method sets a [build argument](../reference/build-arguments.md):

| Method                                    | Build argument            |
|-------------------------------------------|---------------------------|
| `php('8.5.12')`                           | `PHP_VERSION`             |
| `extensions('intl')`                      | `EXTENSIONS`              |
| `targets(Target::Web)`                    | `TARGETS`                 |
| `memory('256mb')`                         | `MEMORY`                  |
| `icuData(IcuData::None)`                  | `ICU_DATA`                |
| `opcache(Opcache::Precompiled)`           | `OPCACHE`                 |
| `embed('build/dist', at: '/app')`         | `EMBED_AT`, and the `embed` context |
| `warmup('bin/console', 'cache:warmup')`   | `WARMUP`                  |

`embed()` is relative to the root of the project, the directory of `castor.php`, and the directory
shows up at `/<its name>` in the WASM filesystem, unless `embed()` is told where. `outputDir()`
writes the files somewhere else than `build/<stack>/`, also relative to the root of the project.

To build your own stacks with this repository as it is, declare them in a `stacks.override.php` file
next to `stacks.php`, with the same format (git ignores it). Its stacks are added to the ones of
`stacks.php`, or replace the ones that have the same name.

## The tasks

Unless a stack says otherwise, everything is built in `build/<stack>/`:

```
castor wasm:stacks                               # lists the stacks
castor wasm:build                                # builds php-8.5
castor wasm:build php-8.5-intl                   # builds another one
castor wasm:build --all                          # builds all of them, in one buildx invocation (with the overrides below)
castor wasm:check                                # builds them all, and checks them
castor wasm:sizes                                # compares the size of the .wasm files with php-8.5
castor wasm:run my-script.php                    # runs a file, in php-8.5
castor wasm:run -r 'echo PHP_VERSION;' --stack php-8.3
castor wasm:serve                                # lists the examples
castor wasm:serve playground                     # builds the page of examples/playground/, and serves it
castor wasm:serve playground --php 8.3.35        # the same page, on PHP 8.3
```

Anything in a stack can be overridden from the command line, so there is no need to declare a stack
to try something:

```
castor wasm:build --php 8.3.35                      # php-8.5, on PHP 8.3
castor wasm:build php-8.3 --target node             # only the node target
castor wasm:build --with tokenizer --with bcmath    # php-8.5, and two more extensions
castor wasm:build --memory 256mb --embed my-app     # more memory, another directory to embed
castor wasm:build php-8.5-intl --icu-data none      # intl, without ICU's data
castor wasm:build --embed my-app --opcache precompiled  # opcache compiles what is embedded when it is built
castor wasm:build --print                           # only shows the bake file
```

What is built with overrides goes to the directory of the stack (`build/php-8.5/`,
`build/php-8.3/`), in place of what was there.

`castor wasm:run` runs a file, or some code, in a stack, and offers to build it when it is not built
yet.

## The checks

`castor wasm:check` is what tells that a stack works: once built, it runs every build of each stack
in node, the one for the web too, and checks that `PHP_VERSION` is the one that was asked for, that
`extension_loaded()` is true for every extension that was asked for, and that the JavaScript API
works (`tests/api.test.mjs`). It does not run what the stack embeds.

`stacks.php` has the builds of this repository, that `castor wasm:check` checks with the stacks of
the examples, in CI too:

| Stack                                                   | What it is                                                                          |
|---------------------------------------------------------|-------------------------------------------------------------------------------------|
| `php-8.5`                                               | PHP 8.5, with the default extensions: what `docker buildx bake` builds too.          |
| `php-8.4`, `php-8.3`                                    | The same thing, on older PHP versions.                                              |
| `php-8.5-intl`                                          | Adds intl, with ICU's data (see [intl](../reference/extensions.md#intl)).           |
| `php-8.5-opcache-runtime`, `php-8.5-opcache-precompiled` | opcache keeps what it compiles in files (see [opcache](../reference/opcache.md)).  |
