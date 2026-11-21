<?php

namespace PhpWasm;

use Symfony\Component\Filesystem\Path;

/**
 * A named, declarative combination: a PHP version, a set of extensions, what to
 * embed, which targets to build and where.
 *
 * A stack never changes: each method returns a new one, so a stack is derived
 * from another one by renaming it. The extensions and the settings of php.ini
 * it is given are added to the ones it already has, anything else replaces
 * what it has. The directories are relative to the root of the project: the
 * directory of its castor.php.
 *
 * What is not set (null) is the default of the Dockerfile, but the extensions:
 * a stack has the ones it is given, none by default.
 */
final readonly class Stack
{
    /**
     * Keep in sync with the "resolve" stage of the Dockerfile.
     */
    public const EXTENSIONS = ['bcmath', 'calendar', 'ctype', 'dom', 'exif', 'fileinfo', 'filter', 'gd', 'iconv', 'intl', 'libxml', 'mbstring', 'openssl', 'pdo', 'pdo_sqlite', 'phar', 'session', 'simplexml', 'sodium', 'sqlite3', 'tokenizer', 'xml', 'xmlreader', 'xmlwriter', 'zip', 'zlib'];

    /**
     * @param list<string>          $extensions
     * @param string|null           $embed      absolute path of the directory to embed
     * @param string|null           $embedAt    where the embedded directory is in the WASM filesystem, as /app
     * @param list<string>          $warmup     a file of the embedded directory, and its arguments
     * @param list<Target>          $targets
     * @param array<string, string> $ini        settings of php.ini, by name
     * @param string                $outputDir  absolute path of the directory the files are written to
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
        public array $ini,
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
            ini: [],
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
        // A tag of php-src is php-<version>
        if (!preg_match('/^\d+\.\d+\.\d+((alpha|beta|RC)\d+)?$/', $version)) {
            throw new \InvalidArgumentException(\sprintf('"%s" is not a version of PHP, use one as "8.6.0" or "8.6.0RC1".', $version));
        }

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
     * What opcache compiles, with PHP 8.5.13 and later.
     */
    public function opcache(Opcache $opcache): self
    {
        return $this->with(opcache: $opcache);
    }

    public function targets(Target ...$targets): self
    {
        if ([] === $targets) {
            throw new \InvalidArgumentException('A stack builds at least one target: give Target::Web, Target::Node, or both.');
        }

        return $this->with(targets: array_map(Target::from(...), array_values(array_unique(array_column($targets, 'value')))));
    }

    /**
     * The memory of the WASM module, as emcc takes it: "256mb".
     */
    public function memory(string $memory): self
    {
        $units = ['' => 1, 'kb' => 1024, 'mb' => 1024 ** 2, 'gb' => 1024 ** 3];
        $bytes = preg_match('/^(\d+)(kb|mb|gb)?$/i', $memory, $matches) ? (int) $matches[1] * $units[strtolower($matches[2] ?? '')] : 0;
        // WebAssembly counts it in pages of 64 KB, up to 4 GB
        if (0 === $bytes || 0 !== $bytes % 65536 || $bytes > 4 * 1024 ** 3) {
            throw new \InvalidArgumentException(\sprintf('"%s" is not a memory that WebAssembly takes, use a multiple of 64kb up to 4gb, as "256mb".', $memory));
        }

        return $this->with(memory: $memory);
    }

    /**
     * Settings of php.ini, in addition to the ones the stack already has: PHP
     * reads them at each run, WARMUP too. ->ini(['memory_limit' => '256M']).
     *
     * @param array<string, string|int> $settings by name, as php.ini has them: E_ALL and On work
     */
    public function ini(array $settings): self
    {
        foreach ($settings as $name => $value) {
            if (!\is_string($name) || !preg_match('/^[a-zA-Z0-9_.]+$/', $name)) {
                throw new \InvalidArgumentException(\sprintf('"%s" is not a valid name for a setting of php.ini, use letters, digits, "." and "_".', $name));
            }
            if (preg_match('/[\r\n]/', (string) $value)) {
                throw new \InvalidArgumentException(\sprintf('The setting "%s" of php.ini can not be on several lines.', $name));
            }
        }

        return $this->with(ini: [...$this->ini, ...array_map(strval(...), $settings)]);
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
        return array_merge(...array_map($this->targetArtifacts(...), $this->targets));
    }

    /**
     * @return list<string> the absolute paths of the files that a target produces, whether this stack builds it or not
     */
    public function targetArtifacts(Target $target): array
    {
        return array_map(fn (string $file): string => $this->outputDir . '/' . $file, $target->files());
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
