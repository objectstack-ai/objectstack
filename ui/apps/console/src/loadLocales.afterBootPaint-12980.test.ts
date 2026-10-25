/**
 * objectui#12980, part 3 — the locale list (`GET /api/v1/i18n/locales`) is read
 * after the console's first paint (`whenBootPainted`), not beside the page's
 * own reads: nothing on that paint reads it.
 *
 *   (a) signed in, the boot splash up: no request, however long it is up;
 *   (b) the splash gone and a frame painted: the read goes out and its codes
 *       are returned;
 *   CONTROL: a sign-out while the paint was pending sends nothing — the
 *   session is asked at the moment the read would go out.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { TokenStorage } from '@object-ui/auth';
import { loadLocales, __resetBootPainted } from './loadLocales';
import { publishAuthState } from './i18nSession';

let splash: HTMLElement | null = null;
const someFrames = () => new Promise<void>((r) => setTimeout(r, 80));
const fetchMock = vi.fn(
  async () => new Response(JSON.stringify({ data: { locales: [{ code: 'en' }, { code: 'zh' }] } }), { status: 200 }),
);

beforeEach(() => {
  __resetBootPainted();
  publishAuthState({ isAuthenticated: true, isLoading: false });
  splash = document.createElement('div');
  splash.setAttribute('data-boot-splash', '');
  document.body.appendChild(splash);
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  splash?.remove();
  splash = null;
  vi.unstubAllGlobals();
  TokenStorage.clear();
});

describe('loadLocales waits for the console\'s first paint (objectui#12980)', () => {
  it('(a) sends nothing while the boot splash is up, (b) reads once it is gone', async () => {
    const answer = loadLocales();
    await someFrames();
    expect(fetchMock).not.toHaveBeenCalled();

    splash?.remove();
    splash = null;
    await expect(answer).resolves.toEqual(['en', 'zh']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/\/api\/v1\/i18n\/locales$/);
  });

  it('CONTROL: a sign-out while the paint is pending sends nothing', async () => {
    const answer = loadLocales();
    await someFrames();
    publishAuthState({ isAuthenticated: false, isLoading: false });

    splash?.remove();
    splash = null;
    await expect(answer).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
