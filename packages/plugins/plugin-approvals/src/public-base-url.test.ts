// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { resolvePublicBaseUrl } from './public-base-url.js';

/**
 * [#30509] The origin approval links are built under: the option, else
 * `OS_AUTH_URL` (legacy `BETTER_AUTH_URL`), else `OS_BASE_URL` — never a
 * guessed `localhost`; nothing usable ⇒ relative links and a reason.
 */
describe('resolvePublicBaseUrl', () => {
  it('the option wins over every variable, without its trailing slash', () => {
    expect(resolvePublicBaseUrl('https://opt.example.test/', { OS_AUTH_URL: 'https://auth.example.test', OS_BASE_URL: 'https://base.example.test' }))
      .toEqual({ url: 'https://opt.example.test', source: 'option' });
  });

  it('reads OS_AUTH_URL, then BETTER_AUTH_URL, then OS_BASE_URL', () => {
    const all = { OS_AUTH_URL: 'https://auth.example.test', BETTER_AUTH_URL: 'https://legacy.example.test', OS_BASE_URL: 'https://base.example.test' };
    expect(resolvePublicBaseUrl(undefined, all)).toEqual({ url: 'https://auth.example.test', source: 'OS_AUTH_URL' });
    expect(resolvePublicBaseUrl('', { ...all, OS_AUTH_URL: undefined })).toEqual({ url: 'https://legacy.example.test', source: 'BETTER_AUTH_URL' });
    expect(resolvePublicBaseUrl('  ', { OS_BASE_URL: 'http://intranet.example.test:8080//' }))
      .toEqual({ url: 'http://intranet.example.test:8080', source: 'OS_BASE_URL' });
  });

  it('a variable set to the empty string is a value, as in the chain it mirrors, and an unusable one', () => {
    const got = resolvePublicBaseUrl(undefined, { OS_AUTH_URL: '', OS_BASE_URL: 'https://base.example.test' });
    expect(got.url).toBe('');
    expect(got.problem).toMatch(/OS_AUTH_URL/);
  });

  it('with nothing set, the links stay relative — never a guessed localhost — and the reason names the remedy', () => {
    const got = resolvePublicBaseUrl(undefined, { OS_PORT: '3000' });
    expect(got).toMatchObject({ url: '', source: 'none' });
    expect(got.problem).toMatch(/OS_AUTH_URL \/ OS_BASE_URL/);
  });

  it('a value that is not an absolute http(s) URL is refused, not used', () => {
    for (const bad of ['app.example.test', '/relative', 'ftp://files.example.test', 'javascript:alert(1)']) {
      const got = resolvePublicBaseUrl(undefined, { OS_BASE_URL: bad });
      expect(got).toMatchObject({ url: '', source: 'none' });
      expect(got.problem).toMatch(/OS_BASE_URL .* not an absolute http\(s\) URL/);
    }
  });
});
