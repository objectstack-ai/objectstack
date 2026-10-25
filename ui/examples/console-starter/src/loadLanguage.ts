/**
 * Load the app's translations for a language from
 * `${VITE_SERVER_URL}/api/v1/i18n/translations/:lang`, in the shape
 * `I18nProvider` merges into i18next.
 *
 * The server answers with a `@objectstack/spec` `TranslationData` document
 * inside the REST envelope (`{ data: { locale, translations } }`). That
 * document is NOT an i18next resource tree: `useObjectLabel` and the
 * screen-flow runner read an app NAMESPACE (`app.objects.*`, `app.fields.*`,
 * …), so the spec payload goes through `transformSpecTranslations` first. A
 * payload that is already a namespaced tree (a mock or hand-rolled server)
 * is returned as-is.
 *
 * Both halves of that branch come from `@object-ui/i18n` — the same two calls
 * the reference console makes — so this template never carries its own copy of
 * the transform and picks up new spec scopes with the package. Returning the
 * spec payload untransformed put every authored label at the root of the
 * resource tree, where nothing reads it (objectui#10349).
 */
import { isSpecTranslationData, transformSpecTranslations } from '@object-ui/i18n';

export async function loadLanguage(lang: string): Promise<Record<string, unknown>> {
  try {
    const serverUrl = import.meta.env.VITE_SERVER_URL || '';
    const res = await fetch(`${serverUrl}/api/v1/i18n/translations/${lang}`);
    if (!res.ok) return {};
    const json = await res.json();
    const translations: Record<string, unknown> = json?.data?.translations ?? json ?? {};
    return isSpecTranslationData(translations)
      ? transformSpecTranslations(translations)
      : translations;
  } catch {
    return {};
  }
}
