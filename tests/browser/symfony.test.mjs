import assert from 'node:assert/strict';
import { test } from 'node:test';

import { servedExample } from './browser.mjs';

// The Symfony example in Chrome, as a visitor sees it: what the tests of the
// JavaScript API can not run in node, the service workers, IndexedDB, the Web
// Locks and the Web Worker. Once the example is built:
//
//     castor wasm:test-browser symfony

const example = servedExample('symfony');

/**
 * Signs the guestbook, in the page or in its frame, and waits for the message.
 */
async function sign(application, author, text) {
    await application.getByLabel('Your name').fill(author);
    await application.getByLabel('Your message').fill(text);
    await application.getByRole('button', { name: 'Sign' }).click();
    await application.getByText('Thanks for signing!').waitFor();
}

test('the framed page signs the guestbook, and keeps the message, the session and its cookie across a reload', async () => {
    const context = await example.newContext();
    const page = await context.newPage();
    await page.goto(example.url());
    const frame = page.frameLocator('#frame');

    await sign(frame, 'Ada', 'Hello from the frame');
    await page.reload();

    await frame.getByText('Hello from the frame').waitFor();
    // In the session, that the cookie of the page finds again
    assert.equal(await frame.getByLabel('Your name').inputValue(), 'Ada');

    await frame.getByRole('link', { name: 'About' }).click();
    await frame.getByText('a Web Worker of the page').waitFor();

    await context.close();
});

test('the page of its own runs PHP in the service worker, and keeps the message, the session and its cookie across a reload', async () => {
    const context = await example.newContext();
    const page = await context.newPage();
    // It reloads once the service worker is activated: Symfony answers then
    await page.goto(example.url('standalone/'));

    await sign(page, 'Grace', 'Hello from the service worker');
    await page.goto(example.url('standalone/'));

    await page.getByText('Hello from the service worker').waitFor();
    assert.equal(await page.getByLabel('Your name').inputValue(), 'Grace');
    assert.match(new URL(page.url()).pathname, /\/standalone\/$/);

    await page.getByRole('link', { name: 'About' }).click();
    await page.getByText('the service worker of the page').waitFor();

    await context.close();
});

test('the framed page shares its files with the page of its own: the same IndexedDB', async () => {
    const context = await example.newContext();
    const framed = await context.newPage();
    await framed.goto(example.url());
    await sign(framed.frameLocator('#frame'), 'Ada', 'Written in the frame');

    const standalone = await context.newPage();
    await standalone.goto(example.url('standalone/'));

    await standalone.getByText('Written in the frame').waitFor();

    await context.close();
});

test('the service worker leaves a tab that is still starting PHP: a 503 without another one, the frame of another one answers', async () => {
    const context = await example.newContext();
    // What registers the service worker
    const visit = await context.newPage();
    await visit.goto(example.url());
    await visit.frameLocator('#frame').getByRole('heading', { name: 'Guestbook' }).waitFor();
    await visit.close();

    const starting = await context.newPage();
    // Its PHP starts once start.mjs loads: never, during the test
    await starting.route('**/start.mjs', () => {});
    await starting.goto(example.url(), { waitUntil: 'commit' });

    // The application out of its frame: only the tab that is starting could
    // answer, the service worker waits 10 s for it
    const alone = await context.newPage();
    const response = await alone.goto(example.url('app/'));
    assert.equal(response.status(), 503);
    assert.match(await alone.textContent('body'), /still starting PHP/);

    const page = await context.newPage();
    await page.goto(example.url());
    await page.frameLocator('#frame').getByRole('heading', { name: 'Guestbook' }).waitFor({ timeout: 60000 });

    await context.close();
});
