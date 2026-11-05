<?php

namespace PhpWasm;

use Symfony\Component\Filesystem\Path;

/**
 * A named, declarative combination: a PHP version, a set of extensions, what to
 * embed, which targets to build and where.
 *
 * A stack never changes: each method returns a new one, so a stack is derived
 * from another one by renaming it. The extensions it is given are added to the
 * ones it already has, anything else replaces what it has. The directories are
 * relative to the root of the project: the directory of its castor.php.
 *
 * What is not set (null) is the default of the Dockerfile.
 */
final readonly class Stack
{
    /**
     * Keep in sync with the "resolve" stage of the Dockerfile.
     */
    public const EXTENSIONS = ['bcmath', 'calendar', 'ctype', 'dom', 'exif', 'fileinfo', 'filter', 'gd', 'iconv', 'intl', 'libxml', 'mbstring', 'openssl', 'pdo', 'pdo_sqlite', 'phar', 'session', 'simplexml', 'sodium', 'sqlite3', 'tokenizer', 'xml', 'xmlreader', 'xmlwriter', 'zip', 'zlib'];

    /**
     * @param list<string> $extensions
     * @param string|null  $embed      absolute path of the directory to embed
     * @param string|null  $embedAt    where the embedded directory is in the WASM filesystem, as /app
     * @param list<string> $warmup     a file of the embedded directory, and its arguments
     * @param list<Target> $targets
     * @param string       $outputDir  absolute path of the directory the files are written to
     */
    private function __construct(
        public string $name,
        public ?string $php,
        public array $extensions,
        public ?string $embed,
        public ?string $embedAt,
        public array $warmup,
        public ?Opcache $opcache,
        public array $targets,
        public ?string $memory,
        public ?IcuData $icuData,
        public string $outputDir,
    ) {
    }

    public static function named(string $name): self
    {
        return new self(
            name: self::validName($name),
            php: null,
            extensions: [],
            embed: null,
            embedAt: null,
            warmup: [],
            opcache: null,
            targets: Target::cases(),
            memory: null,
            icuData: null,
            outputDir: build_dir() . '/' . $name,
        );
    }

    /**
     * The same stack, under another name, built in build/<name>/: how a stack
     * is derived from this one.
     */
    public function renamed(string $name): self
    {
        return $this->with(name: self::validName($name), outputDir: build_dir() . '/' . $name);
    }

    public function php(string $version): self
    {
        return $this->with(php: $version);
    }

    /**
     * Extensions to build, in addition to the ones the stack already has.
     */
    public function extensions(string ...$extensions): self
    {
        self::validate('extension', $extensions, self::EXTENSIONS);

        return $this->with(extensions: array_values(array_unique([...$this->extensions, ...$extensions])));
    }

    /**
     * The directory to embed in the WASM filesystem, at /<its name> unless it
     * is given where: ->embed('build/embed', at: '/app').
     */
    public function embed(string $directory, ?string $at = null): self
    {
        $at ??= '/' . basename($directory);
        // What emcc takes: an "@" would separate it from the directory
        if (!preg_match('{^(/[a-zA-Z0-9][a-zA-Z0-9._-]*)+$}', $at)) {
            throw new \InvalidArgumentException(\sprintf('"%s" is not a valid path to embed the directory at, use an absolute path made of letters, digits, ".", "-" and "_", as "/app".', $at));
        }

        return $this->with(embed: Path::makeAbsolute($directory, project_root()), embedAt: $at);
    }

    /**
     * A file of the embedded directory to run when it is built, in PHP as
     * WebAssembly: what it writes in the directory is embedded too. For a
     * cache that a framework makes with the paths of the WASM filesystem:
     * ->warmup('bin/console', 'cache:warmup').
     */
    public function warmup(string $file, string ...$arguments): self
    {
        // The build argument separates them with spaces
        foreach ([$file, ...$arguments] as $word) {
            if ('' === $word || preg_match('/\s/', $word)) {
                throw new \InvalidArgumentException(\sprintf('"%s" can not be given to warmup(), use a word without spaces.', $word));
            }
        }

        return $this->with(warmup: [$file, ...$arguments]);
    }

    /**
     * What opcache compiles, with PHP 8.5 and later.
     */
    public function opcache(Opcache $opcache): self
    {
        return $this->with(opcache: $opcache);
    }

    public function targets(Target ...$targets): self
    {
        return $this->with(targets: array_map(Target::from(...), array_values(array_unique(array_column($targets, 'value')))));
    }

    public function memory(string $memory): self
    {
        return $this->with(memory: $memory);
    }

    /**
     * The data of ICU that intl links.
     */
    public function icuData(IcuData $icuData): self
    {
        return $this->with(icuData: $icuData);
    }

    /**
     * The directory the files are written to: build/<name>/ by default.
     */
    public function outputDir(string $directory): self
    {
        return $this->with(outputDir: Path::makeAbsolute($directory, project_root()));
    }

    /**
     * @return string the absolute path of a file this stack produces, for example artifact(Target::Web, 'wasm')
     */
    public function artifact(Target $target, string $extension): string
    {
        return $this->outputDir . '/' . $target->fileName() . '.' . $extension;
    }

    /**
     * @return list<string> the absolute paths of the files this stack produces
     */
    public function artifacts(): array
    {
        $files = [];
        foreach ($this->targets as $target) {
            $files[] = $this->artifact($target, 'mjs');
            $files[] = $this->artifact($target, 'wasm');
        }

        return $files;
    }

    private function with(mixed ...$changes): self
    {
        return new self(...[...get_object_vars($this), ...$changes]);
    }

    private static function validName(string $name): string
    {
        // The name is used as a directory name, and (once cleaned up) as a bake target name
        if (!preg_match('/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/', $name)) {
            throw new \InvalidArgumentException(\sprintf('"%s" is not a valid stack name, use letters, digits, ".", "-" and "_".', $name));
        }

        return $name;
    }

    /**
     * @param list<string> $values
     * @param list<string> $known
     */
    private static function validate(string $what, array $values, array $known): void
    {
        foreach ($values as $value) {
            if (!\in_array($value, $known, true)) {
                throw new \InvalidArgumentException(\sprintf('Unknown %s "%s", use one of: %s.', $what, $value, implode(', ', $known)));
            }
        }
    }
}
