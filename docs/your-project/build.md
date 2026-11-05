# Build it

PHP runs a copy of the code of the project, without its dev dependencies, embedded at `/app`. The
build says which PHP version, which extensions (see
[Supported extensions](../reference/extensions.md)), and where the files go: next to the page that
loads them.

=== "castor"

    The build is a stack, declared once in a function: the build and the
    [checks](check.md) need the same one. Its methods are the
    [build arguments](../reference/build-arguments.md), see [Stacks](../repository/stacks.md):

    ```php
    <?php
    // castor.php

    use Castor\Attribute\AsOption;
    use Castor\Attribute\AsTask;
    use PhpWasm\Stack;
    use PhpWasm\Target;
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
            ->extensions('ctype', 'mbstring')
            // Relative to the project, at /app in the WASM filesystem
            ->embed('build/embed', at: '/app')
            // Only php-web.mjs and php-web.wasm
            ->targets(Target::Web)
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
    ```

    `castor wasm:build` writes `public/build/php-web.mjs` and `php-web.wasm`. `build()` takes
    several stacks too: they are built in a single buildx invocation, in parallel, and sharing the
    layers they have in common.

=== "Composer and Docker"

    The build is a bake file, at the root of the project. Its arguments are the ones of
    [Build arguments](../reference/build-arguments.md):

    ```hcl
    # docker-bake.hcl
    target "default" {
      context = "vendor/lyrixx/php-wasm-builder/docker"
      # What is embedded, at EMBED_AT
      contexts = {
        embed = "build/embed"
      }
      args = {
        # Keep in sync with config.platform.php in composer.json
        PHP_VERSION = "8.5.12"
        EXTENSIONS = "ctype mbstring"
        EMBED_AT = "/app"
        # Only php-web.mjs and php-web.wasm
        TARGETS = "web"
      }
      output = ["type=local,dest=public/build"]
    }
    ```

    Composer scripts copy the code, install its dependencies, and build:

    ```json
    {
        "scripts": {
            "wasm:build": [
                "@wasm:embed",
                "docker buildx bake",
                "chmod 755 public/build"
            ],
            "wasm:embed": [
                "rm -rf build/embed && mkdir -p build/embed && cp -R src composer.json composer.lock build/embed/",
                "@composer install --working-dir=build/embed --no-dev --classmap-authoritative"
            ]
        }
    }
    ```

    `composer wasm:build` writes `public/build/php-web.mjs` and `php-web.wasm`. buildx creates
    `public/build/` readable by its owner only: `chmod` lets a web server read it.
