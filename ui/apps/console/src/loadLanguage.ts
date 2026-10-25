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
 */
import { isSpecTranslationData, transformSpecTranslations } from '@object-ui/i18n';
import { i18nFetch, whenSessionAnswered } from './i18nSession';

export async function loadLanguage(lang: string): Promise<Record<string, unknown>> {
  if (!(await whenSessionAnswered())) return {};
  try {
    const serverUrl = import.meta.env.VITE_SERVER_URL || '';
    const res = await i18nFetch(`${serverUrl}/api/v1/i18n/translations/${lang}`);
    if (!res.ok) {
      console.warn(`[i18n] Failed to load translations for '${lang}': HTTP ${res.status}`);
      return {};
    }
    const json = await res.json();
    // Unwrap the spec REST API envelope when present
    let translations: Record<string, unknown>;
    if (json?.data?.translations && typeof json.data.translations === 'object') {
      translations = json.data.translations as Record<string, unknown>;
    } else {
      // Fallback: mock server / local dev returns flat translation objects
      translations = json;
    }
    if (isSpecTranslationData(translations)) {
      return transformSpecTranslations(translations);
    }
    return translations;
  } catch (err) {
    console.warn(`[i18n] Failed to load translations for '${lang}':`, err);
    return {};
  }
}
