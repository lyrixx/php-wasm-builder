# Limitations

## Fibers

WebAssembly cannot pause and resume code the way Fibers require, so the build uses
`--disable-fiber-asm`: starting a Fiber aborts the module (`missing function: getcontext`).

## Integers

The module is 32 bits: `PHP_INT_SIZE` is 4, and `PHP_INT_MAX` is 2147483647. A float out of this
range, cast to an int, gives a wrong int, and PHP 8.5 warns (`The float … is not representable as
an int`): a timestamp in milliseconds, for example, as `getTimestampMs()` of Carbon gives, and as
the `schedule:interrupt` command of Laravel 13 stores.

## Processes

There is no other program to run: `proc_open()` (and Symfony Process), `exec()`, `system()`,
`shell_exec()` and `popen()` fail, with a warning.

## Stack

PHP calls itself back in C through the callbacks of its functions (`array_map()`, `usort()`…). The C
stack of the module is 1 MB, and the one of the JavaScript engine about as big: a recursion goes
about 2,000 callbacks deep, in node and in the main thread of Chrome, about 1,000 in a worker of
Chrome. Deeper, one of them overflows, and the promise is rejected. PHP does not know where the
stack ends, there is no `zend.max_allowed_stack_size`.
