/**
 * objectstack#36809 — the console loader brings the server's declared
 * fallback chain along with the active language's bundle.
 *
 * `GET /api/v1/i18n/locales` names the chain (`fallbackChain`) and the
 * authored language (`sourceLocale`). The real loader reads both, fetches
 * each fallback locale's bundle unless the requested language is the authored
 * one, and lays the fallback `flows` groups beside the app namespace. Handed
 * to i18next the way `I18nProvider` does, the flow-label readers then answer
 * the fallback locale's text for a label the active language lacks, and the
 * resolvers' answer equals the server's for the same declaration. A server
 * that declares no chain gets exactly the old answer and no extra bundle read.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { translateFlow, type TranslationBundle } from '@objectstack/spec/system';
import {
  activeFlowsBundle,
  createI18n,
  DECLARED_FLOWS_FALLBACK_KEY,
  flowLabelTranslations,
  flowsResolveOptions,
} from '@object-ui/i18n';
import { TokenStorage } from '@object-ui/auth';
import { loadLanguage } from './loadLanguage';
import { publishAuthState } from './i18nSession';

const FLOW = 'deal_review';
const ZH = { flows: { [FLOW]: { nodes: { score_deal: { label: '评分' } } } } };
const EN = { flows: { [FLOW]: { label: 'Deal review', nodes: { score_deal: { label: 'Score' } } } } };

/** Serve the `/i18n` reads by URL, as the server would, and record each URL asked. */
function serve(locales: Record<string, unknown>, bundles: Record<string, unknown>) {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      asked.push(url);
      if (url.endsWith('/api/v1/i18n/locales')) {
        return new Response(JSON.stringify({ success: true, data: locales }), { status: 200 });
      }
      const match = /\/api\/v1\/i18n\/translations\/([^/?]+)$/.exec(url);
      if (match && bundles[match[1]]) {
        return new Response(JSON.stringify({ success: true, data: { locale: match[1], translations: bundles[match[1]] } }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }),
  );
  return asked;
}

const LOCALES = [{ code: 'zh-CN', label: 'zh-CN', isDefault: true }, { code: 'en', label: 'en', isDefault: false }, { code: 'ja-JP', label: 'ja-JP', isDefault: false }];

async function loaded(lang: string) {
  const resources = await loadLanguage(lang);
  const instance = createI18n({ defaultLanguage: lang, detectBrowserLanguage: false });
  instance.addResourceBundle(lang, 'translation', resources, true, true);
  return { resources, instance };
}

beforeEach(() => {
  publishAuthState({ isAuthenticated: true, isLoading: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  TokenStorage.clear();
});

describe('loadLanguage brings the declared fallback chain (objectstack#36809)', () => {
  it('a flow label the active language lacks reads the fallback locale text, matching the server', async () => {
    const asked = serve({ locales: LOCALES, sourceLocale: 'zh-CN', fallbackChain: ['en'] }, { 'ja-JP': ZH, en: EN });
    const { instance } = await loaded('ja-JP');
    expect(asked.some((url) => url.endsWith('/translations/en'))).toBe(true);

    const options = flowsResolveOptions(instance, 'ja-JP');
    expect(options).toEqual({ locale: 'ja-JP', fallbackChain: ['en'], defaultLocale: 'zh-CN' });
    const t = flowLabelTranslations(activeFlowsBundle(instance, 'ja-JP', FLOW), FLOW, 'ja-JP', options);

    const serverBundle = { 'ja-JP': ZH, en: EN } as unknown as TranslationBundle;
    const server = translateFlow<{ name: string; label?: string }>({ name: FLOW }, serverBundle, options).label;
    expect(server).toBe('Deal review');
    expect(t?.flowLabel).toBe(server);
    // The requested locale still wins where it translates.
    expect(t?.stepLabel({ id: 'score_deal', type: 'script' })).toBe('评分');
  });

  it('no declared chain: the old answer, and no fallback bundle is read', async () => {
    const asked = serve({ locales: LOCALES, sourceLocale: 'zh-CN' }, { 'ja-JP': ZH, en: EN });
    const { resources, instance } = await loaded('ja-JP');
    expect(resources).not.toHaveProperty(DECLARED_FLOWS_FALLBACK_KEY);
    expect(asked.some((url) => url.endsWith('/translations/en'))).toBe(false);
    expect(flowsResolveOptions(instance, 'ja-JP')).toEqual({ locale: 'ja-JP' });
    const t = flowLabelTranslations(activeFlowsBundle(instance, 'ja-JP', FLOW), FLOW, 'ja-JP', flowsResolveOptions(instance, 'ja-JP'));
    expect(t?.flowLabel).toBeUndefined();
  });

  it('the authored language walks no chain, so its fallback bundle is not read', async () => {
    const asked = serve({ locales: LOCALES, sourceLocale: 'zh-CN', fallbackChain: ['en'] }, { 'zh-CN': ZH, en: EN });
    const { resources } = await loaded('zh-CN');
    expect(resources).not.toHaveProperty(DECLARED_FLOWS_FALLBACK_KEY);
    expect(asked.some((url) => url.endsWith('/translations/en'))).toBe(false);
  });

  it('a failing locale-list read degrades to the old answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith('/api/v1/i18n/locales')) return new Response('nope', { status: 500 });
        return new Response(JSON.stringify({ data: { locale: 'ja-JP', translations: ZH } }), { status: 200 });
      }),
    );
    const resources = await loadLanguage('ja-JP');
    expect(resources).not.toHaveProperty(DECLARED_FLOWS_FALLBACK_KEY);
    expect(resources).toHaveProperty('app.flows');
  });
});

describe('the language is negotiated against the server locales first (objectstack#36809)', () => {
  // The server negotiates a request's tag against the locales it holds before
  // it resolves (`negotiatedTranslationLocale`, `@objectstack/rest`), so an
  // alias of the authored locale is the authored request and walks no chain.
  const ALIAS_LOCALES = [{ code: 'zh-CN', label: 'zh-CN', isDefault: true }, { code: 'en', label: 'en', isDefault: false }];

  it.each(['zh-Hans', 'zh'])('a %s console on a zh-CN-authored stack with fallback en shows the authored Chinese, as the server does', async (lang) => {
    const asked = serve({ locales: ALIAS_LOCALES, sourceLocale: 'zh-CN', fallbackChain: ['en'] }, { [lang]: ZH, en: EN });
    const { resources, instance } = await loaded(lang);
    expect(asked.some((url) => url.endsWith('/translations/en'))).toBe(false);
    expect(resources).not.toHaveProperty(DECLARED_FLOWS_FALLBACK_KEY);

    // The server: the request negotiated to zh-CN, the source locale, so its
    // own bundle and then the authored label answer.
    const serverBundle = { 'zh-CN': ZH, en: EN } as unknown as TranslationBundle;
    const server = translateFlow<{ name: string; label?: string }>(
      { name: FLOW, label: '交易审核 (authored)' },
      serverBundle,
      { locale: 'zh-CN', fallbackChain: ['en'], defaultLocale: 'zh-CN' },
    ).label;
    expect(server).toBe('交易审核 (authored)');

    const options = flowsResolveOptions(instance, lang);
    const consoleLabel = translateFlow<{ name: string; label?: string }>(
      { name: FLOW, label: '交易审核 (authored)' },
      activeFlowsBundle(instance, lang, FLOW),
      options,
    ).label;
    expect(consoleLabel).toBe(server);
  });

  it('a ja console on a stack holding ja-JP resolves as ja-JP and still reads the fallback', async () => {
    const asked = serve(
      { locales: [...LOCALES.filter((l) => l.code !== 'ja-JP'), { code: 'ja-JP', label: 'ja-JP', isDefault: false }], sourceLocale: 'zh-CN', fallbackChain: ['en'] },
      { ja: ZH, en: EN },
    );
    const { instance } = await loaded('ja');
    expect(asked.some((url) => url.endsWith('/translations/en'))).toBe(true);
    const options = flowsResolveOptions(instance, 'ja');
    expect(options).toEqual({ locale: 'ja-JP', fallbackChain: ['en'], defaultLocale: 'zh-CN' });
    const t = flowLabelTranslations(activeFlowsBundle(instance, 'ja', FLOW), FLOW, 'ja', options);
    expect(t?.flowLabel).toBe('Deal review');
    expect(t?.stepLabel({ id: 'score_deal', type: 'script' })).toBe('评分');
  });
});
