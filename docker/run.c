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
#include <emscripten.h>
#include <stdlib.h>

#include "zend_exceptions.h"
#include "zend_smart_str.h"

/*
 * What api.js calls to run PHP. run_file() and run_code() run it as the php
 * command does, run_request() as a web server does, for an HTTP request. Each
 * call is a request of its own: the engine is started, and shut down at the
 * end. They return the exit status of PHP: the one given to exit(), 255 on a
 * fatal error or an uncaught exception, 0 otherwise.
 */

static bool running = false;

/* The file that runs, empty for some code: $_SERVER["SCRIPT_FILENAME"] */
static const char *script_filename = "";

/*
 * The HTTP request that runs, with run_request(): its variables, as names and
 * values one after the other. None with run_file() and run_code().
 */
static struct request {
    int count;
    char **variables;
} request;

/* PHP_SAPI, for an HTTP request: frameworks take "embed" for a command line */
#define REQUEST_SAPI_NAME "wasm"

static int (*embed_startup)(sapi_module_struct *module);

/* What api.js gets of the response once PHP sends its headers: its status, and "Name: value" lines */
EM_JS(void, send_response_head, (int status, const char *headers, size_t length), {
    Module['sendResponseHead'](status, HEAPU8.slice(headers, headers + length));
});

static const char *request_variable(const char *name)
{
    for (int i = 0; i + 1 < request.count; i += 2) {
        if (0 == strcmp(request.variables[i], name)) {
            return request.variables[i + 1];
        }
    }

    return NULL;
}

/* What the php command adds to the environment in $_SERVER, or the variables of the request */
static void register_variables(zval *track_vars_array)
{
    php_import_environment_variables(track_vars_array);

    if (request.variables) {
        for (int i = 0; i + 1 < request.count; i += 2) {
            php_register_variable(request.variables[i], request.variables[i + 1], track_vars_array);
        }

        return;
    }

    const char *self = SG(request_info).argv[0];
    php_register_variable("PHP_SELF", self, track_vars_array);
    php_register_variable("SCRIPT_NAME", self, track_vars_array);
    php_register_variable("SCRIPT_FILENAME", script_filename, track_vars_array);
    php_register_variable("PATH_TRANSLATED", script_filename, track_vars_array);
    php_register_variable("DOCUMENT_ROOT", "", track_vars_array);
}

/*
 * Once the module has started, before the request starts: PHP fills $_GET,
 * $_POST, $_COOKIE and $_FILES from what the request is. php_module_startup()
 * forgets about a request given before.
 */
static int start_request(sapi_module_struct *module)
{
    if (FAILURE == embed_startup(module)) {
        return FAILURE;
    }

    const char *content_length = request_variable("CONTENT_LENGTH");
    SG(request_info).request_method = request_variable("REQUEST_METHOD");
    SG(request_info).request_uri = (char *) request_variable("REQUEST_URI");
    SG(request_info).query_string = (char *) request_variable("QUERY_STRING");
    SG(request_info).path_translated = (char *) script_filename;
    SG(request_info).content_type = request_variable("CONTENT_TYPE");
    SG(request_info).content_length = content_length ? atol(content_length) : 0;
    /* PHP only reads the body and the cookies of a request that has a server context */
    SG(server_context) = &request;

    return SUCCESS;
}

/* The body of the request is on stdin, as with CGI */
static size_t read_post(char *buffer, size_t count)
{
    ssize_t bytes = read(STDIN_FILENO, buffer, count);

    return bytes > 0 ? bytes : 0;
}

static char *read_cookies(void)
{
    return (char *) request_variable("HTTP_COOKIE");
}

static int send_headers(sapi_headers_struct *headers)
{
    smart_str lines = {0};
    zend_llist_position position;

    for (sapi_header_struct *header = zend_llist_get_first_ex(&headers->headers, &position); header; header = zend_llist_get_next_ex(&headers->headers, &position)) {
        smart_str_appendl(&lines, header->header, header->header_len);
        smart_str_appendc(&lines, '\n');
    }
    smart_str_0(&lines);
    /* 0 when nothing set it */
    send_response_head(headers->http_response_code ? headers->http_response_code : 200, lines.s ? ZSTR_VAL(lines.s) : "", lines.s ? ZSTR_LEN(lines.s) : 0);
    smart_str_free(&lines);

    return SAPI_HEADER_SENT_SUCCESSFULLY;
}

/* argv is $argv */
static void start(int argc, char **argv, const char *filename, struct request with)
{
    /* A previous call did not get to the end, a JavaScript exception went through it */
    if (running) {
        php_embed_shutdown();
    }

    setenv("USE_ZEND_ALLOC", "0", 1);
    request = with;
    /* The one of a request is one of its variables */
    script_filename = request.variables ? request_variable("SCRIPT_FILENAME") : filename;
    if (!embed_startup) {
        embed_startup = php_embed_module.startup;
    }
    php_embed_module.name = request.variables ? REQUEST_SAPI_NAME : "embed";
    php_embed_module.startup = request.variables ? start_request : embed_startup;
    php_embed_module.register_server_variables = register_variables;
    php_embed_module.read_post = read_post;
    php_embed_module.read_cookies = read_cookies;
    php_embed_module.send_headers = send_headers;
    php_embed_init(argc, argv);
    running = true;
    /* Not reset by php_embed_init(), it would keep the status of a previous call */
    EG(exit_status) = 0;
    PG(during_request_startup) = 0;
    /*
     * php_embed_init() says the headers are already sent, and sessions do not
     * start then. A response sends them, to api.js. The php command never
     * does: header() and setcookie() only add to headers_list().
     */
    SG(headers_sent) = 0;
    SG(request_info).no_headers = !request.variables;
    /* The "#!" line of a script (artisan, bin/console) is not printed, nor of what it includes */
    CG(skip_shebang) = 1;
}

static int stop(void)
{
    int exit_status = EG(exit_status);

    php_embed_shutdown();
    running = false;
    request = (struct request) {0};

    return exit_status;
}

static void execute(const char *filename)
{
    zend_first_try {
        zend_file_handle file_handle;
        zend_stream_init_filename(&file_handle, filename);
        php_execute_script(&file_handle);
        zend_destroy_file_handle(&file_handle);
    } zend_end_try();
}

/* php <argv[0]> <argv[1]>... */
int run_file(int argc, char **argv)
{
    start(argc, argv, argv[0], (struct request) {0});
    execute(argv[0]);

    return stop();
}

/* php -r <code> <argv[1]>... */
int run_code(char *code, int argc, char **argv)
{
    start(argc, argv, "", (struct request) {0});
    zend_first_try {
        zend_eval_string(code, NULL, "Command line code");
        if (EG(exception)) {
            zend_exception_error(EG(exception), E_ERROR);
        }
    } zend_end_try();

    return stop();
}

/*
 * An HTTP request, as a web server runs PHP for it with CGI: its variables
 * are $_SERVER (REQUEST_METHOD, REQUEST_URI, QUERY_STRING, CONTENT_TYPE,
 * HTTP_COOKIE…), SCRIPT_FILENAME is the file that runs, and its body is on
 * stdin. The response is what PHP writes, once send_response_head() gave its
 * status and headers.
 */
int run_request(int count, char **variables)
{
    start(0, NULL, NULL, (struct request) {count, variables});
    execute(script_filename);

    return stop();
}
