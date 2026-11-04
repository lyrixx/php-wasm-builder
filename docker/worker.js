// createPhpInWorker(): PHP in a Web Worker, off the main thread of the page.
// It starts this same module in a worker, that runs createPhp() there and
// answers what the page asks. See "PHP in a worker" in README.rst.
//
// Given to emcc with --extern-post-js, for the build for the web only: this is
// after the code of emscripten, at the top level of php-web.mjs.

// What tells the worker apart from a worker of the page that imports
// php-web.mjs to call createPhp() itself
const PHP_WORKER_NAME = 'php-wasm-builder';

/**
 * Creates PHP in a worker: runFile(), runCode() and request() are the same,
 * the methods of FS return a promise, and terminate() stops the worker.
 */
export async function createPhpInWorker(options = {}) {
    const worker = new Worker(import.meta.url, { type: 'module', name: PHP_WORKER_NAME });
    // What terminate() rejects, and rejects from then on: the worker will
    // never answer
    const pending = new Set();
    let terminated = false;

    // Each call has its own channel, that the worker answers on
    const call = (method, args) => new Promise((resolve, reject) => {
        if (terminated) {
            throw new Error('PHP is terminated.');
        }
        const { port1, port2 } = new MessageChannel();
        pending.add(reject);
        port1.onmessage = ({ data }) => {
            pending.delete(reject);
            port1.close();
            'error' in data ? reject(data.error) : resolve(data.result);
        };
        worker.postMessage({ method, args }, [port2]);
    });

    const started = new Promise((resolve, reject) => {
        // A worker whose module does not load never answers
        worker.addEventListener('error', (event) => reject(new Error(`The worker of PHP does not start: ${event.message ?? 'its module does not load'}.`)), { once: true });
        call('createPhp', [options]).then(resolve, reject);
    });
    await started.catch((error) => {
        worker.terminate();
        throw error;
    });

    return {
        runFile: (file, runOptions) => call('runFile', [file, runOptions]),
        runCode: (code, runOptions) => call('runCode', [code, runOptions]),
        request: (request, requestOptions) => call('request', [request, requestOptions]),
        FS: new Proxy({}, { get: (target, name) => (...args) => call('FS', [name, args]) }),
        terminate() {
            terminated = true;
            worker.terminate();
            for (const reject of pending) {
                reject(new Error('PHP is terminated.'));
            }
            pending.clear();
        },
    };
}

if ('undefined' !== typeof WorkerGlobalScope && PHP_WORKER_NAME === self.name) {
    let php;

    self.onmessage = async ({ data: { method, args }, ports: [port] }) => {
        let result;
        // The page gets the error, as it would without the worker: an
        // uncaught exception, an abort of the module, a result that can not
        // be copied to it...
        try {
            if ('createPhp' === method) {
                php = await createPhp(...args);
            } else if ('FS' === method) {
                const [name, fsArgs] = args;
                result = php.FS[name](...fsArgs);
            } else {
                result = await php[method](...args);
            }
            // The body of a response is not copied
            port.postMessage({ result }, 'request' === method ? [result.body.buffer] : []);
        } catch (error) {
            port.postMessage({ error });
        }
    };
}
