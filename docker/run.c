/**
 * Copyright (c) 2025 The PHP Foundation
 * Copyright (c) 2023-2024 Antoine Bluchet
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */
#include "sapi/embed/php_embed.h"
#include <stdlib.h>

#include "zend_exceptions.h"

/*
 * What api.js calls to run PHP, as the php command does. Each call is a
 * request of its own: the engine is started, and shut down at the end. Both
 * return the exit status of PHP: the one given to exit(), 255 on a fatal error
 * or an uncaught exception, 0 otherwise.
 */

static bool running = false;

/* argv is $argv */
static void start(int argc, char **argv)
{
    /* A previous call did not get to the end, a JavaScript exception went through it */
    if (running) {
        php_embed_shutdown();
    }

    setenv("USE_ZEND_ALLOC", "0", 1);
    php_embed_init(argc, argv);
    running = true;
    /* Not reset by php_embed_init(), it would keep the status of a previous call */
    EG(exit_status) = 0;
    PG(during_request_startup) = 0;
}

static int stop(void)
{
    int exit_status = EG(exit_status);

    php_embed_shutdown();
    running = false;

    return exit_status;
}

/* php <argv[0]> <argv[1]>... */
int run_file(int argc, char **argv)
{
    start(argc, argv);
    zend_first_try {
        zend_file_handle file_handle;
        zend_stream_init_filename(&file_handle, argv[0]);
        php_execute_script(&file_handle);
        zend_destroy_file_handle(&file_handle);
    } zend_end_try();

    return stop();
}

/* php -r <code> <argv[1]>... */
int run_code(char *code, int argc, char **argv)
{
    start(argc, argv);
    zend_first_try {
        zend_eval_string(code, NULL, "Command line code");
        if (EG(exception)) {
            zend_exception_error(EG(exception), E_ERROR);
        }
    } zend_end_try();

    return stop();
}
