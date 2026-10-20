<?php

namespace PhpWasm;

/**
 * A named, declarative combination: a PHP version, a set of extensions, what to
 * embed and which targets to build.
 *
 * A stack never changes: each method returns a new one, so a stack is derived
 * from another one by renaming it. The extensions it is given are added to the
 * ones it already has, anything else replaces what it has.
 */
final readonly class Stack
{
    /**
     * @param list<string>      $extensions
     * @param list<string>|null $targets
     */
    private function __construct(
        private string $name,
        private ?string $php = null,
        private array $extensions = [],
        private ?string $embed = null,
        private ?array $targets = null,
        private ?string $memory = null,
    ) {
    }

    public static function named(string $name): self
    {
        return new self(self::validName($name));
    }

    /**
     * The same stack, under another name: how a stack is derived from this one.
     */
    public function renamed(string $name): self
    {
        return $this->with(name: self::validName($name));
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
        return $this->with(extensions: array_values(array_unique([...$this->extensions, ...$extensions])));
    }

    /**
     * The directory to embed in the WASM filesystem (at /<its name>), relative
     * to the root of the project: the directory of its castor.php.
     */
    public function embed(string $directory): self
    {
        return $this->with(embed: $directory);
    }

    public function targets(string ...$targets): self
    {
        foreach ($targets as $target) {
            if (!isset(Build::TARGETS[$target])) {
                throw new \InvalidArgumentException(\sprintf('Unknown target "%s", the targets are: %s.', $target, implode(', ', array_keys(Build::TARGETS))));
            }
        }

        return $this->with(targets: array_values(array_unique($targets)));
    }

    public function memory(string $memory): self
    {
        return $this->with(memory: $memory);
    }

    public function getName(): string
    {
        return $this->name;
    }

    public function getPhp(): ?string
    {
        return $this->php;
    }

    /**
     * @return list<string>
     */
    public function getExtensions(): array
    {
        return $this->extensions;
    }

    public function getEmbed(): ?string
    {
        return $this->embed;
    }

    /**
     * @return list<string>|null
     */
    public function getTargets(): ?array
    {
        return $this->targets;
    }

    public function getMemory(): ?string
    {
        return $this->memory;
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
}
