<?php

namespace PhpWasm;

/**
 * The stacks of this repository, that the tasks of castor.php build: the ones
 * of stacks.php, and of stacks.override.php when there is one.
 */
final readonly class Stacks
{
    /**
     * The stack that is built when none is given, as docker buildx bake does.
     */
    public const DEFAULT = 'default';

    /**
     * @param array<string, Stack> $stacks
     */
    private function __construct(
        private array $stacks,
    ) {
    }

    /**
     * Loads stacks.php, then stacks.override.php: its stacks are added to the
     * others, or replace the ones that have the same name.
     */
    public static function load(string $directory): self
    {
        $stacks = [];
        foreach (['stacks.php', 'stacks.override.php'] as $file) {
            if (!is_file($path = $directory . '/' . $file)) {
                continue;
            }

            $declared = [];
            foreach (self::require($path) as $stack) {
                if (!$stack instanceof Stack) {
                    throw new \UnexpectedValueException(\sprintf('"%s" must return a list of "%s".', $path, Stack::class));
                }
                // A stack derived from another one, and not renamed
                if (isset($declared[$stack->getName()])) {
                    throw new \UnexpectedValueException(\sprintf('"%s" declares the stack "%s" twice.', $path, $stack->getName()));
                }

                $declared[$stack->getName()] = true;
                $stacks[$stack->getName()] = $stack;
            }
        }

        return new self($stacks);
    }

    /**
     * @return list<string>
     */
    public function names(): array
    {
        return array_keys($this->stacks);
    }

    /**
     * @return list<Stack>
     */
    public function all(): array
    {
        return array_values($this->stacks);
    }

    public function get(string $name): Stack
    {
        return $this->stacks[$name] ?? throw new \InvalidArgumentException(\sprintf('Unknown stack "%s", the stacks are: %s.', $name, implode(', ', $this->names())));
    }

    /**
     * Isolates the stacks file: it only sees its own variables.
     *
     * @return iterable<mixed>
     */
    private static function require(string $file): iterable
    {
        return require $file;
    }
}
