#include <errno.h>
#include <spawn.h>

/*
 * There is no other process to run in WASM: proc_open() fails, with ENOSYS, as
 * exec(), system() and popen() do (fork() and popen() of emscripten). The C
 * library of emscripten has no posix_spawnp(), its call would abort the module
 * (proc_open() with an array, as Symfony Process does), and its posix_spawn()
 * returns -1 instead of an error number (proc_open() with a string says
 * "Unknown error").
 */

int posix_spawn(pid_t *restrict pid, const char *restrict path,
    const posix_spawn_file_actions_t *file_actions, const posix_spawnattr_t *restrict attrp,
    char *const *restrict argv, char *const *restrict envp)
{
    return ENOSYS;
}

int posix_spawnp(pid_t *restrict pid, const char *restrict file,
    const posix_spawn_file_actions_t *file_actions, const posix_spawnattr_t *restrict attrp,
    char *const *restrict argv, char *const *restrict envp)
{
    return ENOSYS;
}
