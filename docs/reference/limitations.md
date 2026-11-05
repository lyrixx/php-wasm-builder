# Limitations

## Fibers

WebAssembly cannot pause and resume code the way Fibers require, so the build uses
`--disable-fiber-asm`: starting a Fiber aborts the module (`missing function: getcontext`).

## Integers

The module is 32 bits: `PHP_INT_SIZE` is 4, and `PHP_INT_MAX` is 2147483647. A float out of this
range, cast to an int, gives a wrong int, and PHP 8.5 warns (`The float … is not representable as
an int`): a timestamp in milliseconds, for example, as `getTimestampMs()` of Carbon gives, and as
the `schedule:interrupt` command of Laravel 13 stores.

## Memory

The memory of the module does not grow (`MEMORY`, see [Build arguments](build-arguments.md)), and PHP
shares it with the C library: SQLite, libxml, ICU… `memory_limit` leaves it some: it defaults to 7/8
of what the module has after its data and what it embeds, `107M` with the 128 MB by default. A
`php.ini` changes it, at `/usr/local/lib/php.ini`.

Going over it is the usual fatal error (`Allowed memory size of … exhausted`). With a `memory_limit`
that the memory of the module can not give, or an allocation bigger than what is left, it is
`Out of memory`. Either way the shutdown functions run, PHP exits with 255, and the next run starts
with all of the memory.

PHP takes what is over 2 MB in blocks of 2 MB: a string of 2.1 MB takes 4 MB of the memory, and 28
of them fit in the 128 MB by default. An array that grows takes its old and its new memory at the
same time: one that doubles stops at 32 MB. The C library does not give back what it took, PHP gets
about half of it: a run that fills a big `DOMDocument` leaves less memory to the next ones of the
module.

## Processes

There is no other program to run: `proc_open()` (and Symfony Process), `exec()`, `system()`,
`shell_exec()` and `popen()` fail, with a warning.

## Stack

PHP calls itself back in C through the callbacks of its functions (`array_map()`, `usort()`…). The C
stack of the module is 1 MB, and the one of the JavaScript engine about as big: a recursion goes
about 2,000 callbacks deep, in node and in the main thread of Chrome, about 1,000 in a worker of
Chrome. Deeper, one of them overflows, and the promise is rejected. PHP does not know where the
stack ends, there is no `zend.max_allowed_stack_size`.
