// A fake browser, for the tests of what runs in a page: node has no service
// worker, nor localStorage. It only does what their code asks of it.

export const origin = 'https://lyrixx.github.io';
// Where the page is, on GitHub Pages
export const directory = `${origin}/repository/`;

/**
 * A browser with this service worker container, for a page of the directory.
 * The storage is what localStorage has.
 */
export function browser(serviceWorkerContainer) {
    const storage = new Map();
    const globals = {
        document: {
            baseURI: directory,
            createElement: () => ({
                set textContent(text) {
                    this.outerHTML = `<p>${text}</p>`;
                },
            }),
        },
        localStorage: {
            getItem: (key) => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value),
        },
        navigator: { ...(undefined === serviceWorkerContainer ? {} : { serviceWorker: serviceWorkerContainer }) },
    };
    for (const [name, value] of Object.entries(globals)) {
        Object.defineProperty(globalThis, name, { value, configurable: true });
    }

    return storage;
}

export function worker(state) {
    return Object.assign(new EventTarget(), {
        state,
        become(newState) {
            this.state = newState;
            this.dispatchEvent(new Event('statechange'));
        },
    });
}

export function container(registration) {
    return {
        calls: [],
        listeners: [],
        addEventListener(type, listener) {
            this.listeners.push(listener);
        },
        async register(...args) {
            this.calls.push(args);

            return registration;
        },
    };
}

export const registered = (changes = {}) => ({ installing: null, waiting: null, active: worker('activated'), update: async () => {}, ...changes });
