/**
 * Load application-specific translations for a given language from the API.
 *
 * The @objectstack/spec REST API (`/api/v1/i18n/translations/:locale`) wraps
 * its response in the standard envelope: `{ data: { locale, translations } }`.
 * We extract `data.translations` when present, and fall back to the raw JSON
 * for mock / local-dev environments that may return flat translation objects.
 *
 * The actual TranslationData → flat namespace transform lives in
 * `@object-ui/i18n` (`transformSpecTranslations`) so that downstream forks
 * stay in lock-step with new spec scopes (e.g. `_views`, `_actions`, …)
 * without having to maintain their own copy of the transform.
 *
 * The read waits for this page load's session answer and is made only when
 * signed in, with the session's credentials (objectui#12034, see
 * `./i18nSession.ts`). Signed out, it requests nothing and answers `{}`, so the
 * sign-in page renders from the built-in packs.
 *
 * ## The server's declared fallback chain rides along (objectstack#36809)
 *
 * The server resolves translated metadata through the deployment's declared
 * fallback chain: the requested locale, then each fallback, then the authored
 * text. `GET /api/v1/i18n/locales` names that chain (`fallbackChain`) and the
 * authored language (`sourceLocale`). The loader reads both beside the bundle
 * and, unless `lang` is the authored language (the server walks no chain
 * then), fetches each fallback locale's bundle too, keeping its `flows`
 * group. It lays them beside the app namespace
 * (`withDeclaredFlowsFallback`, `@object-ui/i18n`), where the flow-label
 * readers find them, so a flow label `lang` does not carry reads the fallback
 * locale's text, as the server's own reads do. A server that declares no chain
 * costs nothing more than the locale-list read: the answer is exactly what it
 * was. Either extra read failing degrades to that same answer.
 */
import {
  isSpecTranslationData,
  transformSpecTranslations,
  withDeclaredFlowsFallback,
  type DeclaredFlowsFallback,
  type FlowsTranslation,
} from '@object-ui/i18n';
import { i18nFetch, whenSessionAnswered } from './i18nSession';

const serverUrl = () => import.meta.env.VITE_SERVER_URL || '';

/** `data.translations` out of the spec envelope, else the raw JSON (a mock or local-dev server). */
async function fetchTranslations(lang: string): Promise<Record<string, unknown> | null> {
  const res = await i18nFetch(`${serverUrl()}/api/v1/i18n/translations/${lang}`);
  if (!res.ok) {
    console.warn(`[i18n] Failed to load translations for '${lang}': HTTP ${res.status}`);
    return null;
  }
  const json = await res.json();
  if (json?.data?.translations && typeof json.data.translations === 'object') {
    return json.data.translations as Record<string, unknown>;
  }
  return json;
}

/**
 * The declared chain and authored language off `GET /api/v1/i18n/locales`,
 * or `null` when the server declares no chain or the read fails.
 */
async function fetchDeclaredChain(): Promise<{ fallbackChain: string[]; sourceLocale?: string } | null> {
  try {
    const res = await i18nFetch(`${serverUrl()}/api/v1/i18n/locales`);
    if (!res.ok) return null;
    const json = await res.json();
    const body = json?.data && typeof json.data === 'object' ? json.data : json;
    const chain: unknown[] = Array.isArray(body?.fallbackChain) ? body.fallbackChain : [];
    const fallbackChain = chain.filter((code): code is string => typeof code === 'string' && code.length > 0);
    if (fallbackChain.length === 0) return null;
    const sourceLocale = typeof body?.sourceLocale === 'string' && body.sourceLocale ? body.sourceLocale : undefined;
    return { fallbackChain, sourceLocale };
  } catch {
    return null;
  }
}

const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * The fallback locales' `flows` groups for `lang`, or `undefined` when there
 * is nothing to lay beside its bundle: no declared chain, or `lang` is the
 * authored language (the resolvers walk no chain for it).
 */
async function declaredFlowsFallback(
  lang: string,
  declared: { fallbackChain: string[]; sourceLocale?: string } | null,
): Promise<DeclaredFlowsFallback | undefined> {
  if (!declared) return undefined;
  if (declared.sourceLocale && sameTag(lang, declared.sourceLocale)) return undefined;
  const bundles: DeclaredFlowsFallback['bundles'] = {};
  await Promise.all(
    declared.fallbackChain
      .filter((code) => !sameTag(code, lang))
      .map(async (code) => {
        try {
          const translations = await fetchTranslations(code);
          const flows = translations?.flows;
          if (flows && typeof flows === 'object') bundles[code] = { flows: flows as FlowsTranslation };
        } catch (err) {
          console.warn(`[i18n] Failed to load fallback translations for '${code}':`, err);
        }
      }),
  );
  return {
    fallbackChain: declared.fallbackChain,
    ...(declared.sourceLocale ? { defaultLocale: declared.sourceLocale } : {}),
    bundles,
  };
}

export async function loadLanguage(lang: string): Promise<Record<string, unknown>> {
  if (!(await whenSessionAnswered())) return {};
  try {
    const [translations, declared] = await Promise.all([fetchTranslations(lang), fetchDeclaredChain()]);
    if (!translations) return {};
    if (!isSpecTranslationData(translations)) return translations;
    return withDeclaredFlowsFallback(
      transformSpecTranslations(translations),
      await declaredFlowsFallback(lang, declared),
    );
  } catch (err) {
    console.warn(`[i18n] Failed to load translations for '${lang}':`, err);
    return {};
  }
}
