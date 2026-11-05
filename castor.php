<?php

namespace PhpWasm;

use Castor\Attribute\AsArgument;
use Castor\Attribute\AsOption;
use Castor\Attribute\AsTask;
use Castor\Exception\ProblemException;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Filesystem\Path;
use Symfony\Component\Finder\SplFileInfo;

use function Castor\context;
use function Castor\finder;
use function Castor\fs;
use function Castor\import;
use function Castor\io;
use function Castor\notify;
use function Castor\run;

// The wasm:* tasks, that build the stacks of stacks.php, the one of each
// example, in examples/*/stack.php, and the ones of stacks.override.php when
// there is one (it is not versioned: the stacks of whoever uses this
// repository as it is), and the site:* tasks, that build the website. A
// project that requires this package only gets build(), see
// src/functions.php.

defined('CASTOR_USE_CHDIR') || define('CASTOR_USE_CHDIR', false);

// Where GitHub Pages serves the website: the name of the repository
const SITE_PATH = '/php-wasm-builder/';

// It renders the documentation, docs/, as zensical.toml says. Pinned, as
// emsdk is.
const ZENSICAL_IMAGE = 'zensical/zensical:0.0.74';

// Composer autoloads them when the package is required by another project
import(__DIR__ . '/src');

#[AsTask(name: 'build', namespace: 'wasm', description: 'Builds a stack: ' . DEFAULT_STACK . ' when none is given')]
function build_task(
    #[AsArgument(description: 'The stack to build', autocomplete: 'PhpWasm\complete_stacks')]
    ?string $stack = null,
    #[AsOption(description: 'Build every stack, in one buildx invocation')]
    bool $all = false,
    #[AsOption(description: 'Override the PHP version, for example 8.5.12')]
    ?string $php = null,
    #[AsOption(description: 'Add an extension, can be repeated', mode: InputOption::VALUE_REQUIRED | InputOption::VALUE_IS_ARRAY, autocomplete: Stack::EXTENSIONS)]
    array $with = [],
    #[AsOption(description: 'Only build this target (web or node), can be repeated', mode: InputOption::VALUE_REQUIRED | InputOption::VALUE_IS_ARRAY, autocomplete: 'PhpWasm\complete_targets')]
    array $target = [],
    #[AsOption(description: 'Override the memory of the WASM module, for example 256mb')]
    ?string $memory = null,
    #[AsOption(description: 'Override the directory to embed')]
    ?string $embed = null,
    #[AsOption(description: 'Override the ICU data of intl: all or none', autocomplete: 'PhpWasm\complete_icu_data')]
    ?string $icuData = null,
    #[AsOption(description: 'Override what opcache compiles: none, runtime or precompiled', autocomplete: 'PhpWasm\complete_opcache')]
    ?string $opcache = null,
    #[AsOption(description: 'Print the bake file instead of building')]
    bool $print = false,
): void {
    if ($all && null !== $stack) {
        throw new \InvalidArgumentException('--all builds every stack, it can not be combined with a stack.');
    }

    $stacks = $all ? array_values(stacks()) : [stack($stack ?? DEFAULT_STACK)];
    foreach ($stacks as $i => $selected) {
        $selected = $selected->extensions(...$with);
        if (null !== $php) {
            $selected = $selected->php($php);
        }
        if ([] !== $target) {
            $selected = $selected->targets(...array_map(Target::from(...), $target));
        }
        if (null !== $memory) {
            $selected = $selected->memory($memory);
        }
        if (null !== $embed) {
            // It comes from the command line: relative to where the command is run
            $selected = $selected->embed(Path::makeAbsolute($embed, getcwd() ?: project_root()));
        }
        if (null !== $icuData) {
            $selected = $selected->icuData(IcuData::from($icuData));
        }
        if (null !== $opcache) {
            $selected = $selected->opcache(Opcache::from($opcache));
        }
        $stacks[$i] = $selected;
    }

    if ($print) {
        io()->writeln(bake_definition($stacks), OutputInterface::OUTPUT_RAW);

        return;
    }

    io()->title(1 === \count($stacks) ? \sprintf('Building the stack "%s"', $stacks[0]->name) : \sprintf('Building %d stacks', \count($stacks)));

    foreach ($stacks as $selected) {
        io()->writeln(\sprintf(' // Stack "%s": %s', $selected->name, describe($selected)));
    }

    build_with_dependencies($stacks);

    foreach ($stacks as $selected) {
        io()->success(array_map(relative(...), $selected->artifacts()));
    }

    if (1 === \count($stacks)) {
        io()->text(next_step($stacks[0]));
    }

    notify(1 === \count($stacks) ? \sprintf('Stack "%s" is built', $stacks[0]->name) : \sprintf('%d stacks are built', \count($stacks)));
}

#[AsTask(name: 'stacks', namespace: 'wasm', description: 'Lists the stacks')]
function stacks_task(
    #[AsOption(description: 'Only print their names, as JSON (the CI builds one stack per job)')]
    bool $json = false,
): void {
    if ($json) {
        io()->writeln(json_encode(array_keys(stacks()), \JSON_THROW_ON_ERROR), OutputInterface::OUTPUT_RAW);

        return;
    }

    io()->title('Stacks');

    // A stack has too many things for the columns of a table: each one is
    // listed, with only what it has.
    $indent = str_repeat(' ', 15);
    foreach (stacks() as $stack) {
        $extensions = $stack->extensions;
        sort($extensions);

        io()->writeln(\sprintf(' <info>%s</info>, PHP %s, for %s', $stack->name, $stack->php ?? dockerfile_default('PHP_VERSION'), implode(' and ', array_column($stack->targets, 'value'))));
        $details = [
            'Extensions' => wordwrap(implode(' ', $extensions), 64, "\n" . $indent) ?: 'none',
            'ICU data' => \in_array('intl', $extensions, true) ? $stack->icuData?->value ?? dockerfile_default('ICU_DATA') : null,
            'Embeds' => null !== $stack->embed ? \sprintf('%s, as %s', relative($stack->embed), $stack->embedAt) : null,
            'Warmup' => implode(' ', $stack->warmup) ?: null,
            'Opcache' => Opcache::None !== $stack->opcache ? $stack->opcache?->value : null,
            'Memory' => $stack->memory ?? dockerfile_default('MEMORY'),
        ];
        foreach (array_filter($details) as $label => $value) {
            io()->writeln(\sprintf('   <comment>%-12s</comment>%s', $label, $value));
        }
        io()->newLine();
    }

    io()->text('Build one with "castor wasm:build <stack>", or all of them with "castor wasm:build --all".');
}

#[AsTask(name: 'sizes', namespace: 'wasm', description: 'Compares the size of what is built with ' . DEFAULT_STACK)]
function sizes_task(
    #[AsOption(description: 'Print them as JSON')]
    bool $json = false,
): void {
    $sizes = stack_sizes();

    if ($json) {
        io()->writeln(json_encode($sizes, \JSON_PRETTY_PRINT | \JSON_UNESCAPED_SLASHES | \JSON_THROW_ON_ERROR), OutputInterface::OUTPUT_RAW);

        return;
    }

    io()->title('Size of the .wasm files');

    if ([] === $sizes) {
        io()->warning('Nothing is built yet, run "castor wasm:build".');

        return;
    }

    $rows = [];
    foreach ($sizes as $size) {
        $rows[] = [
            $size['stack'],
            \sprintf('%.1f MB', $size['wasm_bytes'] / 1024 / 1024),
            \sprintf('%.1f MB', $size['gzipped_bytes'] / 1024 / 1024),
            compared_to_default_stack($size, $sizes) ?? '-',
        ];
    }

    io()->table(['Stack', 'Size', 'Gzipped', 'vs ' . DEFAULT_STACK], $rows);
}

#[AsTask(name: 'run', namespace: 'wasm', description: 'Runs a PHP file, or some code with -r, in a built stack')]
function run_task(
    #[AsArgument(description: 'The PHP file to run')]
    ?string $file = null,
    #[AsOption(shortcut: 'r', description: 'The PHP code to run, without <?php ?>')]
    ?string $code = null,
    #[AsOption(description: 'The stack to run', autocomplete: 'PhpWasm\complete_stacks')]
    string $stack = DEFAULT_STACK,
): int {
    if ((null === $file) === (null === $code)) {
        throw new \InvalidArgumentException('Give the PHP file to run, or the code to run with -r.');
    }

    // castor does not run it from where the command is run
    $arguments = null === $code ? [Path::makeAbsolute($file, getcwd() ?: project_root())] : ['-r', $code];
    $selected = stack($stack);

    // On stderr: what PHP prints may go through a pipe
    $stderr = io()->getErrorStyle();
    $stderr->title(\sprintf('Running %s in the stack "%s"', null === $code ? relative($arguments[0]) : 'some code', $selected->name));
    build_if_missing($selected);

    $process = node($selected->artifact($selected->targets[0], 'mjs'), $arguments, context());

    // For the prompt of the shell
    if ('' !== $process->getOutput() && !str_ends_with($process->getOutput(), "\n")) {
        $stderr->newLine();
    }
    if (!$process->isSuccessful()) {
        $stderr->newLine();
        $stderr->error(\sprintf('PHP exits with %d.', $process->getExitCode()));
    }

    return $process->getExitCode();
}

#[AsTask(name: 'serve', namespace: 'wasm', description: 'Builds the page of an example, then serves its public/ directory on 127.0.0.1: lists them when none is given')]
function serve_task(
    #[AsArgument(description: 'The example to serve, a directory of examples/', autocomplete: 'PhpWasm\examples')]
    ?string $example = null,
    #[AsOption(description: 'Override the PHP version of the page, for example 8.3.35')]
    ?string $php = null,
    #[AsOption(description: 'Add an extension to the page, can be repeated', mode: InputOption::VALUE_REQUIRED | InputOption::VALUE_IS_ARRAY, autocomplete: Stack::EXTENSIONS)]
    array $with = [],
    #[AsOption(description: 'Override what opcache compiles: none, runtime or precompiled', autocomplete: 'PhpWasm\complete_opcache')]
    ?string $opcache = null,
    #[AsOption(description: 'The port to listen to')]
    int $port = 8000,
): int {
    if (null === $example) {
        $rows = [];
        foreach (examples() as $name) {
            $rows[] = [$name, example_title($name), example_stack($name)->name];
        }

        io()->title('Examples');
        io()->table(['Example', 'Page', 'Stack'], $rows);
        io()->text([
            'Serve one with "castor wasm:serve <example>": its stack is built first, in a second when nothing changed.',
            'As with "castor wasm:build", "--php 8.3.35", "--with intl" or "--opcache precompiled" change what its stack has.',
        ]);

        return 0;
    }

    if (!\in_array($example, examples(), true)) {
        throw new \InvalidArgumentException(\sprintf('Unknown example "%s", the examples are: %s.', $example, implode(', ', examples())));
    }

    io()->title(\sprintf('Serving the example "%s"', $example));
    check_port_is_free($port);

    // Built every time: what the page embeds may have changed, or it may have
    // been built with other options
    $page = example_stack($example)->extensions(...$with);
    if (null !== $php) {
        $page = $page->php($php);
    }
    if (null !== $opcache) {
        $page = $page->opcache(Opcache::from($opcache));
    }

    io()->writeln(\sprintf(' // Stack "%s": %s', $page->name, describe($page)));
    build_with_dependencies([$page]);

    // After what buildx prints: it must stand out
    io()->success([
        "The page is on http://127.0.0.1:{$port}/",
        'It changes with a reload, its PHP when the server starts again. Ctrl+C stops the server.',
    ]);

    // The built-in server of the PHP of the host
    return run(['php', '-S', "127.0.0.1:{$port}", '-t', builder_root() . "/examples/{$example}/public"], context: context()->withAllowFailure())->getExitCode();
}

#[AsTask(name: 'check', namespace: 'wasm', description: 'Builds the stacks, then checks from node that what each built boots, with its PHP version, its extensions and its JavaScript API')]
function check_task(
    #[AsArgument(description: 'The stacks to check, all by default', autocomplete: 'PhpWasm\complete_stacks')]
    array $stacks = [],
    #[AsOption(description: 'Check what is already built')]
    bool $noBuild = false,
    #[AsOption(description: 'Override a value of the bake file, as "docker buildx bake --set" does (the CI gives the cache this way), can be repeated', mode: InputOption::VALUE_REQUIRED | InputOption::VALUE_IS_ARRAY)]
    array $set = [],
): int {
    $stacks = [] === $stacks ? array_values(stacks()) : array_map(stack(...), $stacks);

    io()->title(1 === \count($stacks) ? \sprintf('Checking the stack "%s"', $stacks[0]->name) : \sprintf('Checking %d stacks', \count($stacks)));

    if (!$noBuild) {
        build_with_dependencies($stacks, $set);
    }

    $failed = 0;
    foreach ($stacks as $stack) {
        try {
            check_stack($stack);
            check_api($stack);
        } catch (ProblemException $exception) {
            ++$failed;
            io()->listing(explode("\n", $exception->getMessage()));
        }
    }

    if ($failed > 0) {
        io()->error(\sprintf('%d of %d stacks are broken.', $failed, \count($stacks)));

        return 1;
    }

    io()->success(1 === \count($stacks) ? \sprintf('The stack "%s" works.', $stacks[0]->name) : \sprintf('The %d stacks work.', \count($stacks)));

    return 0;
}

#[AsTask(name: 'build', namespace: 'site', description: 'Builds the website in build/site/: the documentation, and the pages of the examples, once checked')]
function site_build_task(
    #[AsOption(description: 'Override a value of the bake file, as "docker buildx bake --set" does (the CI gives the cache this way), can be repeated', mode: InputOption::VALUE_REQUIRED | InputOption::VALUE_IS_ARRAY)]
    array $set = [],
): void {
    io()->title('Building the website');

    // Every stack: docs/reference/sizes.md shows what each one weighs
    build_with_dependencies(array_values(stacks()), $set);

    // Nothing is deployed if a page does not answer
    foreach (array_map(example_stack(...), examples()) as $stack) {
        check_stack($stack);
        check_api($stack);
    }

    // Keep in sync with site_dir in zensical.toml
    $site = build_dir() . '/site';
    fs()->remove($site);

    // --strict: a broken link fails the build
    run(
        ['docker', 'run', '--rm', '--user', posix_getuid() . ':' . posix_getgid(), '--volume', builder_root() . ':/docs', ZENSICAL_IMAGE, 'build', '--strict'],
        context: context()->withQuiet(),
    );

    // The home page lists them, with what they download: zensical does not
    // know it
    $cards = '';
    foreach (examples() as $example) {
        fs()->mirror(builder_root() . "/examples/{$example}/public", "{$site}/examples/{$example}");
        $cards .= example_card($example);
    }
    $home = str_replace('<!-- site:build lists the examples here -->', $cards, file_get_contents("{$site}/index.html"), $replaced);
    if (1 !== $replaced) {
        throw new \LogicException('docs/index.md must say once where the examples go.');
    }
    fs()->dumpFile("{$site}/index.html", $home);

    // What is built: zensical does not know it either
    $page = str_replace('<!-- site:build lists the sizes here -->', sizes_table(stack_sizes()), file_get_contents("{$site}/reference/sizes/index.html"), $replaced);
    if (1 !== $replaced) {
        throw new \LogicException('docs/reference/sizes.md must say once where the sizes go.');
    }
    fs()->dumpFile("{$site}/reference/sizes/index.html", $page);

    io()->success(\sprintf('The website is in %s, %.1f MB.', relative($site), array_sum(array_map(
        static fn (SplFileInfo $file): int => $file->getSize(),
        iterator_to_array(finder()->files()->in($site), false),
    )) / 1024 / 1024));
}

#[AsTask(name: 'serve', namespace: 'site', description: 'Builds the website, then serves it on 127.0.0.1, under the path where GitHub Pages serves it')]
function site_serve_task(
    #[AsOption(description: 'The port to listen to')]
    int $port = 8000,
    #[AsOption(description: 'Serve what is built, without building it again')]
    bool $noBuild = false,
): int {
    io()->title('Serving the website');
    check_port_is_free($port);

    if (!$noBuild || !is_dir(build_dir() . '/site')) {
        site_build_task();
    }

    // GitHub Pages serves it under the name of the repository: the relative
    // URLs, and the scope of the service worker of the Symfony example, must
    // work there
    $root = build_dir() . '/pages';
    fs()->remove($root);
    fs()->symlink(build_dir() . '/site', $root . rtrim(SITE_PATH, '/'));

    io()->success([
        \sprintf('The website is on http://127.0.0.1:%d%s', $port, SITE_PATH),
        'It changes with "castor site:build". Ctrl+C stops the server.',
    ]);

    return run(['php', '-S', "127.0.0.1:{$port}", '-t', $root], context: context()->withAllowFailure())->getExitCode();
}

#[AsTask(name: 'social-image', namespace: 'site', description: 'Renders docs/assets/social-image.png, what a link to the website shows, with Chrome')]
function site_social_image_task(): void
{
    $image = builder_root() . '/docs/assets/social-image.png';

    run(
        [
            'google-chrome', '--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1280,640',
            // A profile of its own: Chrome may already run with the usual one
            '--user-data-dir=' . build_dir() . '/chrome',
            // Or the fonts, in another directory, do not load
            '--allow-file-access-from-files',
            '--screenshot=' . $image,
            'file://' . builder_root() . '/docs/.overrides/social-image.html',
        ],
        context: context()->withQuiet(),
    );

    io()->success(relative($image));
}

/**
 * Runs the tests of the JavaScript API, tests/api.test.mjs, on every build of
 * a stack.
 *
 * @throws ProblemException with the tests that fail
 */
function check_api(Stack $stack): void
{
    io()->write(\sprintf('Stack "%s": the JavaScript API', $stack->name));

    foreach ($stack->targets as $target) {
        $build = $stack->artifact($target, 'mjs');
        $process = run(
            ['node', '--import', builder_root() . '/node/fetch-files.mjs', '--test', builder_root() . '/tests/api.test.mjs'],
            context: context()->withEnvironment(['BUILD' => $build])->withQuiet()->withAllowFailure(),
        );
        if (!$process->isSuccessful()) {
            io()->writeln(' ❌');

            throw new ProblemException(\sprintf('%s: %s', basename($build), trim($process->getOutput())));
        }
    }

    io()->writeln(' ✅');
}

/**
 * Builds stacks, once the dependencies of what they embed are installed: the
 * application of examples/symfony/ is a Composer project, without its vendor/
 * in git.
 *
 * @param list<Stack>  $stacks
 * @param list<string> $set    given to build()
 */
function build_with_dependencies(array $stacks, array $set = []): void
{
    foreach ($stacks as $stack) {
        if (null === $stack->embed || !is_file($stack->embed . '/composer.json')) {
            continue;
        }

        // The composer of Docker: Docker is all the builder needs. Nothing to
        // do when vendor/ is what composer.lock says.
        run(
            ['docker', 'run', '--rm', '--user', posix_getuid() . ':' . posix_getgid(), '--volume', $stack->embed . ':/app', '--workdir', '/app', 'composer:2', 'install', '--no-dev', '--classmap-authoritative', '--no-interaction', '--no-progress'],
            context: context()->withQuiet(),
        );
    }

    build($stacks, $set);
}

/**
 * Builds a stack if it is not built yet, once asked: what a run needs first.
 *
 * @throws ProblemException when it is not built, and should not be
 */
function build_if_missing(Stack $stack): void
{
    if ([] === array_filter($stack->artifacts(), static fn (string $file): bool => !is_file($file))) {
        return;
    }

    // On stderr, as what run_task() says
    if (!io()->getErrorStyle()->confirm(\sprintf('The stack "%s" is not built yet. Build it now? It takes a few minutes the first time.', $stack->name))) {
        throw new ProblemException(\sprintf('Build it first, with "castor wasm:build %s".', $stack->name));
    }

    build_with_dependencies([$stack]);
}

/**
 * What to do with a stack once it is built.
 */
function next_step(Stack $stack): string
{
    foreach (examples() as $example) {
        if ($stack->name === example_stack($example)->name) {
            return \sprintf('Serve the page it is built for with "castor wasm:serve %s".', $example);
        }
    }

    return \sprintf('Run PHP in it with "castor wasm:run -r \'echo PHP_VERSION;\' --stack %s".', $stack->name);
}

/**
 * @return list<string>
 */
function complete_stacks(): array
{
    return array_keys(stacks());
}

/**
 * @return list<string>
 */
function complete_icu_data(): array
{
    return array_column(IcuData::cases(), 'value');
}

/**
 * @return list<string>
 */
function complete_opcache(): array
{
    return array_column(Opcache::cases(), 'value');
}

/**
 * @return list<string>
 */
function complete_targets(): array
{
    return array_column(Target::cases(), 'value');
}

/**
 * What the page of an example says it is.
 */
function example_title(string $example): string
{
    $page = file_get_contents(builder_root() . "/examples/{$example}/public/index.html");

    return preg_match('{<title>(.*?)</title>}s', $page, $matches) ? trim($matches[1]) : '';
}

/**
 * The size of the .wasm file of each built stack: the one of its web target,
 * that a browser downloads, or of its node one when it only has this one.
 *
 * @return list<array{stack: string, php: string, target: string, wasm_bytes: int, gzipped_bytes: int}>
 */
function stack_sizes(): array
{
    $sizes = [];
    foreach (stacks() as $stack) {
        foreach ([Target::Web, Target::Node] as $target) {
            if (!is_file($file = $stack->artifact($target, 'wasm'))) {
                continue;
            }

            $wasm = file_get_contents($file);
            $sizes[] = [
                'stack' => $stack->name,
                'php' => $stack->php ?? dockerfile_default('PHP_VERSION'),
                'target' => $target->value,
                'wasm_bytes' => \strlen($wasm),
                // What GitHub Pages sends: it gzips .wasm files
                'gzipped_bytes' => \strlen(gzencode($wasm)),
            ];

            break;
        }
    }

    return $sizes;
}

/**
 * How much bigger a stack is than the default one, built for the same target.
 *
 * @param array{stack: string, target: string, wasm_bytes: int}       $size
 * @param list<array{stack: string, target: string, wasm_bytes: int}> $sizes every one of them
 *
 * @return string|null null for the default stack, or when it is not built for this target
 */
function compared_to_default_stack(array $size, array $sizes): ?string
{
    foreach ($sizes as $reference) {
        if (DEFAULT_STACK === $reference['stack'] && $reference['target'] === $size['target'] && DEFAULT_STACK !== $size['stack']) {
            return \sprintf('%+.1f %%', ($size['wasm_bytes'] / $reference['wasm_bytes'] - 1) * 100);
        }
    }

    return null;
}

/**
 * The table of docs/reference/sizes.md: a bar shows what each stack downloads.
 *
 * @param list<array{stack: string, php: string, target: string, wasm_bytes: int, gzipped_bytes: int}> $sizes
 */
function sizes_table(array $sizes): string
{
    $largest = max(array_column($sizes, 'gzipped_bytes'));
    $defaultStack = DEFAULT_STACK;

    $rows = '';
    foreach ($sizes as $size) {
        $rows .= \sprintf(
            '<tr><td><code>%s</code></td><td>%s</td><td>%.1f MB</td><td><span class="size-bar" style="--ratio: %.3f"></span>%.1f MB</td><td>%s</td></tr>' . "\n",
            htmlspecialchars($size['stack']),
            htmlspecialchars($size['php']),
            $size['wasm_bytes'] / 1024 / 1024,
            $size['gzipped_bytes'] / $largest,
            $size['gzipped_bytes'] / 1024 / 1024,
            compared_to_default_stack($size, $sizes) ?? '',
        );
    }

    return <<<HTML
        <div class="md-typeset__scrollwrap sizes numbers"><div class="md-typeset__table"><table>
        <thead><tr><th>Stack</th><th>PHP</th><th><code>.wasm</code></th><th>Gzipped</th><th>vs {$defaultStack}</th></tr></thead>
        <tbody>
        {$rows}</tbody>
        </table></div></div>
        HTML;
}

/**
 * The card of an example, on the home page of the website: what its page says
 * it is, and what it downloads. Keep in sync with the cards of docs/index.md.
 */
function example_card(string $example): string
{
    $page = file_get_contents(builder_root() . "/examples/{$example}/public/index.html");
    if (!preg_match('{<meta name="description" content="([^"]+)">}', $page, $matches)) {
        throw new ProblemException(\sprintf('The page of the example "%s" has no description, a <meta name="description">: the home page of the website shows it.', $example));
    }

    $title = example_title($example);
    $stack = example_stack($example);
    // What GitHub Pages sends: it gzips .wasm files
    $wasm = file_get_contents($stack->artifact(Target::Web, 'wasm'));
    $meta = \sprintf('PHP %s, %.1f MB to download', $stack->php ?? dockerfile_default('PHP_VERSION'), \strlen(gzencode($wasm)) / 1024 / 1024);

    return <<<HTML
        <div class="home-card">
        <h3><a href="examples/{$example}/">{$title}</a></h3>
        <p>{$matches[1]}</p>
        <p class="home-card__meta">{$meta}</p>
        </div>

        HTML;
}

/**
 * @throws ProblemException when something listens to the port: the built-in
 *                          server only says it once started
 */
function check_port_is_free(int $port): void
{
    if (false !== $socket = @fsockopen('127.0.0.1', $port, timeout: 1)) {
        fclose($socket);

        throw new ProblemException(\sprintf('Something already listens to the port %d: give another one, with --port %d for example.', $port, $port + 1));
    }
}

/**
 * The stack of the page of an example: the one of its stack.php, unless
 * stacks.override.php replaces it.
 */
function example_stack(string $example): Stack
{
    return stack(declared_stacks(example_stack_file($example))[0]->name);
}
