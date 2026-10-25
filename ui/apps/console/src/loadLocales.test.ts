/**
 * `loadLocales` — reading the app's locale list off `GET /api/v1/i18n/locales`
 * (objectui#4039).
 *
 * The endpoint answers with locale *descriptors*, not bare codes, and the
 * descriptor's `label` is the code echoed back (`toLocaleDescriptors` in
 * @objectstack/spec sets `label: code`). Both facts are pinned here: the parse
 * reads `code`, and nothing downstream is tempted to treat `label` as a display
 * name.
 *
 * Every failure path returns `[]` — the provider reads that as "I don't know"
 * and falls back to the built-in packs, so a language menu can never take the
 * console down.
 *
 * The loader reads only for a signed-in page load (objectui#12034), so every
 * test here runs signed in unless it says otherwise; the session rule itself
 * is the last describe block.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { TokenStorage } from '@object-ui/auth';
import { loadLocales } from './loadLocales';
import { publishAuthState } from './i18nSession';

/**
 * A real `Response`: the loader reads through the console's authenticated
 * fetch, which reads the answer's headers (objectui#12034).
 */
function respond(json: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(json), { status })));
}

beforeEach(() => {
  publishAuthState({ isAuthenticated: true, isLoading: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  TokenStorage.clear();
});

describe('loadLocales', () => {
  it('reads codes out of the spec REST envelope', async () => {
    respond({
      data: {
        locales: [
          { code: 'en', label: 'en', isDefault: true },
          { code: 'zh', label: 'zh', isDefault: false },
          { code: 'th', label: 'th', isDefault: false },
        ],
      },
    });

    await expect(loadLocales()).resolves.toEqual(['en', 'zh', 'th']);
  });

  it('accepts the un-enveloped body a mock server may return', async () => {
    respond({ locales: [{ code: 'en' }, { code: 'pt-BR' }] });

    await expect(loadLocales()).resolves.toEqual(['en', 'pt-BR']);
  });

  it('tolerates a bare string array from an older mock', async () => {
    respond(['en', 'ja']);

    await expect(loadLocales()).resolves.toEqual(['en', 'ja']);
  });

  it('drops entries with no usable code, and de-duplicates', async () => {
    respond({ data: { locales: [{ code: 'en' }, { label: 'no code' }, { code: '' }, { code: 'en' }] } });

    await expect(loadLocales()).resolves.toEqual(['en']);
  });

  it('returns [] on a non-OK response', async () => {
    respond({}, 503);

    await expect(loadLocales()).resolves.toEqual([]);
  });

  it('returns [] when there is no backend at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    await expect(loadLocales()).resolves.toEqual([]);
  });

  it('returns [] on a payload that is not a list', async () => {
    respond({ data: { locales: 'en,zh' } });

    await expect(loadLocales()).resolves.toEqual([]);
  });
});

describe('loadLocales — reads only for a signed-in page load, with its credentials (objectui#12034)', () => {
  it('signed out: requests nothing and answers no list', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    publishAuthState({ isAuthenticated: false, isLoading: false });

    await expect(loadLocales()).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('unanswered: waits for the session, then reads with the bearer the data adapter sends', async () => {
    respond({ data: { locales: [{ code: 'en' }, { code: 'th' }] } });
    const fetchSpy = vi.mocked(fetch);
    TokenStorage.set('tok-12034');
    publishAuthState({ isAuthenticated: false, isLoading: true });

    const pending = loadLocales();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchSpy).not.toHaveBeenCalled();

    publishAuthState({ isAuthenticated: true, isLoading: false });
    await expect(pending).resolves.toEqual(['en', 'th']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/i18n/locales');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok-12034');
  });
});
