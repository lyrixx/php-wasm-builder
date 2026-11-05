// The cookies of the application: the browser drops the Set-Cookie of a
// response that a service worker makes, so what runs PHP keeps them, and gives
// them back to each request. Only their names and values: they are all for
// the application. index.html keeps them in localStorage, standalone/sw.js in
// the Cache API, that a service worker has.

/**
 * @param {Map<string, string>} cookies     the cookies, by name
 * @param {Array<[string, string]>} headers what PHP answers
 */
export function keepCookies(cookies, headers) {
    for (const [name, value] of headers) {
        if ('set-cookie' !== name.toLowerCase()) {
            continue;
        }

        const [pair, ...attributes] = value.split(';');
        const equals = pair.indexOf('=');
        // PHP and Symfony delete a cookie with Max-Age=0
        if (attributes.some((attribute) => /^\s*max-age\s*=\s*0\s*$/i.test(attribute))) {
            cookies.delete(pair.slice(0, equals).trim());
        } else {
            cookies.set(pair.slice(0, equals).trim(), pair.slice(equals + 1).trim());
        }
    }
}

/**
 * The headers of a request, with the cookies instead of the ones the browser
 * sends.
 *
 * @param {Array<[string, string]>} headers
 * @param {Map<string, string>} cookies
 */
export function withCookies(headers, cookies) {
    const withoutCookies = headers.filter(([name]) => 'cookie' !== name.toLowerCase());

    return 0 === cookies.size
        ? withoutCookies
        : [...withoutCookies, ['Cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')]];
}
