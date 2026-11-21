import assert from 'node:assert/strict';
import { test } from 'node:test';

import { servedExample } from './browser.mjs';

// The playground in Chrome: PHP in the main thread of the page, with every
// extension. Once the example is built:
//
//     castor wasm:test-browser playground

const example = servedExample('playground');

test('the playground runs the code of its editor', async () => {
    const context = await example.newContext();
    const page = await context.newPage();
    await page.goto(example.url());
    await page.getByText('PHP exits with 0.').waitFor();

    await page.locator('#run textarea').fill('<?php echo PHP_SAPI, " ", extension_loaded("intl") ? "intl" : "no intl"; exit(3);');
    await page.getByRole('button', { name: 'Run' }).click();

    await page.getByText('PHP exits with 3.').waitFor();
    assert.equal(await page.locator('#output').textContent(), 'embed intl');

    await context.close();
});
