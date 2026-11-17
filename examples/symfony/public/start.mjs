// What starts the application, in the framed page, index.html, and in the
// service worker of standalone/. They share /symfony, where the database and
// the sessions are, kept in IndexedDB: keep in sync with ../app/.env and
// ../app/config/packages/framework.yaml

// What BuildIdWarmer writes, in the cache of Symfony, when the stack is built,
// and the one of the last run of the console. Keep in sync with
// ../app/src/BuildIdWarmer.php
const BUILD_ID = '/app/var/cache/prod/build-id';
const STARTED_BUILD_ID = '/symfony/build-id';

/**
 * Creates the database, once per build of the application: the console takes
 * most of the time PHP takes to start, and the stack already compiled the
 * container. With createPhp() or createPhpInWorker().
 */
export async function start(php) {
    // In PHP, not with php.FS: it does not see what IndexedDB has before the
    // first run
    const { stdout: started } = await php.runCode(`echo (int) (file_get_contents('${BUILD_ID}') === @file_get_contents('${STARTED_BUILD_ID}'));`);
    if ('1' === started) {
        return;
    }

    const { exitCode, stdout } = await php.runFile('/app/bin/console', { args: ['doctrine:schema:update', '--force', '--no-interaction'] });
    if (0 !== exitCode) {
        throw new Error(`The console exits with ${exitCode}: ${stdout}`);
    }
    await php.runCode(`copy('${BUILD_ID}', '${STARTED_BUILD_ID}');`);
}
