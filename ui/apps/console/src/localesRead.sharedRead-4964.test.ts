/**
 * cloud#4964 — a signed-in open asks `GET /api/v1/i18n/locales` once.
 *
 * Two console readers want that answer: `loadLocales` (the globe menu's
 * locale codes) and `loadLanguage` (the declared fallback chain beside the
 * active language's bundle, objectstack#36809). Each sent its own request, so
 * every warm open of a console page asked the server the same question twice,
 * which the cloud control-plane call budget measured as a duplicate URL. Both
 * now read one shared answer per page load (`./localesRead.ts`).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { TokenStorage } from '@object-ui/auth';
import { loadLanguage } from './loadLanguage';
import { loadLocales, __resetBootPainted } from './loadLocales';
import { publishAuthState } from './i18nSession';
import { __resetLocalesRead } from './localesRead';

const LOCALES = {
  locales: [
    { code: 'zh-CN', label: 'zh-CN', isDefault: true },
    { code: 'en', label: 'en', isDefault: false },
  ],
  sourceLocale: 'en',
  fallbackChain: ['en'],
};

/** Serve the `/i18n` reads by URL and record each URL asked. */
function serve(localesStatus = 200) {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      asked.push(url);
      if (url.endsWith('/api/v1/i18n/locales')) {
        if (localesStatus !== 200) return new Response('{}', { status: localesStatus });
        return new Response(JSON.stringify({ success: true, data: LOCALES }), { status: 200 });
      }
      const match = /\/api\/v1\/i18n\/translations\/([^/?]+)$/.exec(url);
      if (match) {
        return new Response(JSON.stringify({ success: true, data: { locale: match[1], translations: { app: {} } } }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }),
  );
  return asked;
}

const localesReads = (asked: string[]) => asked.filter((url) => url.endsWith('/api/v1/i18n/locales')).length;

beforeEach(() => {
  __resetLocalesRead();
  __resetBootPainted();
  publishAuthState({ isAuthenticated: true, isLoading: false });
});

afterEach(() => {
  __resetLocalesRead();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  TokenStorage.clear();
});

describe('one /i18n/locales read per page load (cloud#4964)', () => {
  it('the boot: the language load and the locale list together ask once, and each gets its answer', async () => {
    const asked = serve();

    const [, codes] = await Promise.all([loadLanguage('zh-CN'), loadLocales()]);

    expect(codes).toEqual(['zh-CN', 'en']);
    expect(localesReads(asked)).toBe(1);
  });

  it('a later reader, and a language switch, reuse the answer', async () => {
    const asked = serve();

    await loadLanguage('zh-CN');
    await loadLocales();
    await loadLanguage('en');

    expect(localesReads(asked)).toBe(1);
  });

  it('a failed read is not kept: the next reader asks again', async () => {
    const asked = serve(503);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(loadLocales()).resolves.toEqual([]);
    expect(localesReads(asked)).toBe(1);

    await loadLanguage('zh-CN');
    expect(localesReads(asked)).toBe(2);
  });
});
