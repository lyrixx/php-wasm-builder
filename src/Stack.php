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
    public const EXTENSIONS = ['bcmath', 'calendar', 'ctype', 'dom', 'filter', 'intl', 'libxml', 'mbstring', 'pdo', 'pdo_sqlite', 'simplexml', 'sqlite3', 'tokenizer', 'xml', 'xmlreader', 'xmlwriter'];

    /**
     * The targets, and the name of the files they produce. Keep in sync with
     * the "resolve" stage of the Dockerfile.
     */
    public const TARGETS = ['web' => 'php-web', 'node' => 'php-cli'];

    /**
     * Keep in sync with the "resolve" stage of the Dockerfile.
     */
    public const ICU_DATA = ['all', 'none'];

    /**
     * @param list<string> $extensions
     * @param string|null  $embed      absolute path of the directory to embed
     * @param string|null  $embedPath  the name of the embedded directory in the WASM filesystem
     * @param list<string> $targets
     * @param string       $outputDir  absolute path of the directory the files are written to
     */
    private function __construct(
        public string $name,
        public ?string $php,
        public array $extensions,
        public ?string $embed,
        public ?string $embedPath,
        public array $targets,
        public ?string $memory,
        public ?string $icuData,
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
            embedPath: null,
            targets: array_keys(self::TARGETS),
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
     * The directory to embed in the WASM filesystem, at /<path>: /<its name>
     * by default.
     */
    public function embed(string $directory, ?string $path = null): self
    {
        // A single name: it is a directory of the build, next to the sources of PHP
        if (null !== $path && !preg_match('/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/', $path)) {
            throw new \InvalidArgumentException(\sprintf('"%s" is not a valid path to embed the directory at, use a name made of letters, digits, ".", "-" and "_", as "app" for /app.', $path));
        }

        return $this->with(embed: Path::makeAbsolute($directory, project_root()), embedPath: $path ?? basename($directory));
    }

    public function targets(string ...$targets): self
    {
        self::validate('target', $targets, array_keys(self::TARGETS));

        return $this->with(targets: array_values(array_unique($targets)));
    }

    public function memory(string $memory): self
    {
        return $this->with(memory: $memory);
    }

    /**
     * The data of ICU that intl links: "all" of it (the default, every locale),
     * or "none" (intl is loaded, but it only knows locale codes).
     */
    public function icuData(string $icuData): self
    {
        self::validate('ICU data', [$icuData], self::ICU_DATA);

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
     * @return string the absolute path of a file this stack produces, for example artifact('web', 'wasm')
     */
    public function artifact(string $target, string $extension): string
    {
        return $this->outputDir . '/' . self::TARGETS[$target] . '.' . $extension;
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
