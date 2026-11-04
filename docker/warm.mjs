// What the "warm" stage of the Dockerfile runs, in node:
//
//     node warm.mjs <php.mjs> <embed at> <file> [<arguments>...]
//
// It runs the file (WARMUP), a file of the directory to embed. PHP sees the
// directory to embed, /embed, out of the WASM filesystem (NODEFS): what it
// writes in it is embedded.

const [build, embedAt, file, ...args] = process.argv.slice(2);
const { default: createPhp } = await import(build);

const php = await createPhp({
    preRun: [(module) => {
        module.FS.mkdirTree(embedAt);
        module.FS.mount(module.NODEFS, { root: '/embed' }, embedAt);
    }],
});

const { exitCode, stdout, stderr } = await php.runFile(`${embedAt}/${file}`, { args });
process.stdout.write(stdout + stderr);
if (0 !== exitCode) {
    throw new Error(`${file} exits with ${exitCode}.`);
}
