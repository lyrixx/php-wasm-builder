# Keep files across reloads

The WASM filesystem is in memory: what PHP writes is gone with the page. The build for the web keeps
a directory in IndexedDB, with IDBFS, a filesystem of emscripten, when it is given as `persist`:

```js
// What PHP writes in /my-page is still there after a reload
const php = await createPhp({ persist: '/my-page' });
```

Each tab has its own copy of the files. A run reads IndexedDB before PHP runs, what the other tabs
wrote, and writes in it after, one run at a time across the tabs of the page (with a Web Lock): no
tab writes over what another one wrote. `php.FS` sees the files as the last run of the tab left
them: what another tab wrote since is only there once a run has read it. The Symfony example keeps
its SQLite database and its sessions this way (see [A Symfony application](../guides/symfony.md)).

The directory names the IndexedDB database: two pages of the same origin that keep the same
directory share its files. Name it after the page: `/composer-diff` rather than `/data`, when the
pages of an organization are all on `<organization>.github.io`.

IDBFS keeps whole files, in memory:

- a file that changes is written again in full: a row inserted in a 20 MB database writes the 20 MB
  again;
- the files take the memory of the page, not the one of PHP (`MEMORY`);
- the browser may clear IndexedDB when the disk is full, unless the page asks for
  `navigator.storage.persist()`.

Emscripten reaches the Origin Private File System (OPFS) of the browser too, but only with WasmFS,
in place of the filesystem the build has, and with threads (the page must then be served with the
headers of cross-origin isolation, COOP and COEP, that GitHub Pages does not send) or with JSPI or
Asyncify (that let PHP wait for the browser in the middle of a run). The build does not do it.
