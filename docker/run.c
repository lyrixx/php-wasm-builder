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
#include <emscripten/heap.h>
#include <malloc.h>
#include <stdlib.h>
#include <sys/stat.h>

#include "zend_exceptions.h"
#include "zend_smart_str.h"
#include "zend_system_id.h"
#include "zend_virtual_cwd.h"
#if PHP_VERSION_ID >= 80500
#include "ext/opcache/zend_shared_alloc.h"
#endif

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

/*
 * The cache of opcache is keyed by zend_system_id, that PHP computes each
 * time the engine starts. Only the first start hashes the frameless functions
 * in it (zend_system_id.c never resets "finalized"): the next ones get another
 * one. Every run takes the one of the first, so that they all read what the
 * build compiled, and what the previous runs did. It hashes whether opcache
 * started too: the build runs PHP with opcache from its first run, as a page
 * does. PHP fixes it after 8.5.12 (https://github.com/php/php-src/pull/24184):
 * this can go once every stack has the fix.
 */
static char system_id[32];

/* Where malloc() starts, after the data of the module */
extern char __heap_base;

#define INI_DEFAULT(name, value) \
    ZVAL_NEW_STR(&tmp, zend_string_init(value, sizeof(value) - 1, 1)); \
    zend_hash_str_update(configuration_hash, name, sizeof(name) - 1, &tmp);

/*
 * Defaults, that a php.ini changes. WASM has no shared memory: opcache does
 * not start, unless it keeps what it compiles in files (OPCACHE, in the
 * Dockerfile). It is disabled without them, rather than failing to start in
 * each run.
 */
static void ini_defaults(HashTable *configuration_hash)
{
    zval tmp;
    char memory_limit[16];
    /*
     * 7/8 of what the module has after its data, what it embeds included:
     * malloc() gets the rest, and PHP says it went over its limit before the
     * memory is full.
     */
    size_t size = snprintf(memory_limit, sizeof(memory_limit), "%zuM", (emscripten_get_heap_size() - (uintptr_t) &__heap_base) / 8 * 7 / (1024 * 1024));
    ZVAL_NEW_STR(&tmp, zend_string_init(memory_limit, size, 1));
    zend_hash_str_update(configuration_hash, "memory_limit", sizeof("memory_limit") - 1, &tmp);
    /* PHP 8.5 exits over it, 200% of memory_limit: the memory of the module comes first */
    INI_DEFAULT("memory_hard_limit_percent", "2147483647");
#ifdef OPCACHE_FILE_CACHE
    INI_DEFAULT("opcache.file_cache", OPCACHE_FILE_CACHE);
    INI_DEFAULT("opcache.file_cache_only", "1");
#else
    INI_DEFAULT("opcache.enable", "0");
#endif
}

#ifdef OPCACHE_FILE_CACHE
/*
 * opcache does not start without the directory, embedded when the build
 * compiled the files. Once the module has started, api.js ages what is
 * embedded when it is there.
 */
__attribute__((constructor)) static void make_file_cache(void)
{
    mkdir(OPCACHE_FILE_CACHE, 0777);
}
#endif

/*
 * Zend MM takes its memory in blocks aligned on 2 MB, from mmap(), and trims
 * what it gets to align it. The mmap() of emscripten only gives back a whole
 * mapping: what is trimmed never is, and 4 MB are lost each time the engine
 * starts. malloc() does not do either: its header comes before each block, the
 * next one can only start 2 MB further, and half of the memory is lost. Zend MM
 * takes them from the end of the memory instead, going down, as malloc() goes
 * up: they share all of it, and meet in the middle. malloc() never gives back
 * what it took: once the end of the memory is full, Zend MM takes what is free
 * in malloc() too, or a run that took a lot of it would leave the next ones
 * without memory.
 */
#define BLOCK_SIZE ZEND_MM_CHUNK_SIZE
#define BLOCKS(size) (((size) + BLOCK_SIZE - 1) / BLOCK_SIZE)
#define MEMORY_BLOCKS (emscripten_get_heap_size() / BLOCK_SIZE)
/* Or it comes from malloc() */
#define IS_BLOCK(chunk) blocks[(uintptr_t) (chunk) / BLOCK_SIZE]
/* What malloc() rounds its limit up to */
#define MALLOC_GRANULARITY 65536

/* Of dlmalloc, that malloc.h does not declare */
size_t malloc_footprint(void);
size_t malloc_set_footprint_limit(size_t bytes);
void *realloc_in_place(void *pointer, size_t size);

/* The blocks taken, of the 4 GB that WASM can address */
static bool blocks[(1ULL << 32) / BLOCK_SIZE];
static bool reporting_out_of_memory = false;

/* malloc() stays under the lowest block, and fails there: it does not abort */
static void limit_malloc(void)
{
    size_t lowest = 0;

    while (lowest < MEMORY_BLOCKS && !blocks[lowest]) {
        lowest++;
    }
    malloc_set_footprint_limit(lowest * BLOCK_SIZE - ((uintptr_t) sbrk(0) - malloc_footprint()) - MALLOC_GRANULARITY);
}

#ifdef ZEND_HAS_OOM
/*
 * PHP 8.5 exits when the memory is full, that would throw through the run: this
 * is the fatal error that PHP 8.4 gives there. The memory it needs to say so
 * comes from the block that chunk_alloc() keeps.
 */
static ZEND_COLD ZEND_NORETURN void out_of_memory(size_t size)
{
    reporting_out_of_memory = true;
    /* The stack trace of a deep recursion takes more than a block */
    EG(fatal_error_backtrace_on) = false;
    zend_try {
        zend_error_noreturn(E_ERROR, "Out of memory (allocated %zu bytes) (tried to allocate %zu bytes)", zend_memory_usage(true), size);
    } zend_end_try();
    reporting_out_of_memory = false;
    zend_bailout();
}
#endif

/* Zend MM expects the header of a chunk to be 0, as with mmap() */
static void *clear_chunk_header(void *chunk)
{
    return memset(chunk, 0, ZEND_MM_FIRST_PAGE * ZEND_MM_PAGE_SIZE);
}

static void *chunk_alloc(zend_mm_storage *storage, size_t size, size_t alignment)
{
    /* The last block is for what malloc() needs in a run, and for out_of_memory() */
    size_t lowest = BLOCKS((uintptr_t) sbrk(0) + MALLOC_GRANULARITY) + (reporting_out_of_memory ? 0 : 1);
    size_t free_blocks = 0;

    for (size_t block = MEMORY_BLOCKS; block-- > lowest;) {
        free_blocks = blocks[block] ? 0 : free_blocks + 1;
        if (free_blocks == BLOCKS(size)) {
            memset(&blocks[block], true, free_blocks);
            limit_malloc();

            return clear_chunk_header((void *) (block * BLOCK_SIZE));
        }
    }

    void *chunk = memalign(alignment, size);
    if (chunk) {
        return clear_chunk_header(chunk);
    }

#ifdef ZEND_HAS_OOM
    if (!reporting_out_of_memory) {
        out_of_memory(size);
    }
#endif

    return NULL;
}

static void chunk_free(zend_mm_storage *storage, void *chunk, size_t size)
{
    if (!IS_BLOCK(chunk)) {
        free(chunk);

        return;
    }

    memset(&blocks[(uintptr_t) chunk / BLOCK_SIZE], false, BLOCKS(size));
    limit_malloc();
}

static bool chunk_truncate(zend_mm_storage *storage, void *chunk, size_t old_size, size_t new_size)
{
    if (!IS_BLOCK(chunk)) {
        return NULL != realloc_in_place(chunk, new_size);
    }

    memset(&blocks[(uintptr_t) chunk / BLOCK_SIZE + BLOCKS(new_size)], false, BLOCKS(old_size) - BLOCKS(new_size));
    limit_malloc();

    return true;
}

static bool chunk_extend(zend_mm_storage *storage, void *chunk, size_t old_size, size_t new_size)
{
    if (!IS_BLOCK(chunk)) {
        return NULL != realloc_in_place(chunk, new_size);
    }

    size_t first = (uintptr_t) chunk / BLOCK_SIZE + BLOCKS(old_size);
    size_t end = (uintptr_t) chunk / BLOCK_SIZE + BLOCKS(new_size);

    if (end > MEMORY_BLOCKS) {
        return false;
    }
    for (size_t block = first; block < end; block++) {
        if (blocks[block]) {
            return false;
        }
    }
    memset(&blocks[first], true, end - first);

    return true;
}

static const zend_mm_handlers chunks = {chunk_alloc, chunk_free, chunk_truncate, chunk_extend};

/*
 * The engine starts on malloc() (USE_ZEND_ALLOC=0), as its memory manager takes
 * no storage, then runs on Zend MM: php_module_startup() forgets about what it
 * allocated with emalloc(), but for the current directory, allocated right
 * after. Zend MM takes nothing from the heap it replaces.
 */
static int start_engine(sapi_module_struct *module)
{
    if (FAILURE == embed_startup(module)) {
        return FAILURE;
    }

    /* An exit() may have gone through out_of_memory() in a previous run */
    reporting_out_of_memory = false;
    virtual_cwd_deactivate();
    free(zend_mm_set_heap(zend_mm_startup_ex(&chunks, NULL, 0)));
    virtual_cwd_activate();
#ifdef ZEND_HAS_OOM
    /* What the heap it replaces got from php.ini: zend_mm_startup_ex() leaves it unset */
    zend_set_memory_hard_limit_percent(zend_ini_long(ZEND_STRL("memory_hard_limit_percent"), false));
#endif
    zend_set_memory_limit(PG(memory_limit));

    return SUCCESS;
}

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
    if (FAILURE == start_engine(module)) {
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
    php_embed_module.startup = request.variables ? start_request : start_engine;
    php_embed_module.register_server_variables = register_variables;
    php_embed_module.read_post = read_post;
    php_embed_module.read_cookies = read_cookies;
    php_embed_module.send_headers = send_headers;
    php_embed_module.ini_defaults = ini_defaults;
#if PHP_VERSION_ID >= 80500
    /*
     * Without shared memory, opcache leaves it pointing to a variable of a
     * function that returned, that a later run with the file cache reads: the
     * memory is corrupted (https://github.com/php/php-src/issues/25195).
     */
    smm_shared_globals = NULL;
#endif
    php_embed_init(argc, argv);
    if (!system_id[0]) {
        memcpy(system_id, zend_system_id, sizeof(system_id));
    } else {
        memcpy(zend_system_id, system_id, sizeof(system_id));
    }
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
