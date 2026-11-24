/**
 * One `GET /api/v1/i18n/locales` per page load, shared by the console's two
 * readers of it (cloud#4964).
 *
 * `loadLocales` reads the held locales (`locales[].code`) for the globe menu;
 * `loadLanguage` reads the declared fallback chain, the authored language and
 * the same codes beside the active language's bundle (objectstack#36809). Each
 * used to send its own request, so every signed-in open asked the server the
 * same question twice. The answer is the deployment's locale declaration, not
 * the reader's, so one answer serves both for the life of the page load,
 * including `loadLanguage`'s later calls on a language switch.
 *
 * The parsed JSON body is shared and each reader keeps its own parse and its
 * own degrade-quietly rule. A failed read (a non-2xx answer, a network error,
 * an unparsable body) answers `null` and is not kept: the next reader asks
 * again, as it did before the reads were shared. Callers are already signed in
 * (`whenSessionAnswered`); this module adds no session rule of its own.
 */
import { i18nFetch } from './i18nSession';

/** What a failed read answers: the HTTP status when there was one. */
export interface LocalesReadFailure {
  ok: false;
  status?: number;
  error?: unknown;
}

export type LocalesReadAnswer = { ok: true; body: unknown } | LocalesReadFailure;

let pending: Promise<LocalesReadAnswer> | null = null;

/**
 * The `/i18n/locales` answer for this page load: one request however many
 * readers ask, concurrently or later. A failure is handed to every reader that
 * shared it, then forgotten, so a later reader asks again.
 */
export function readLocales(): Promise<LocalesReadAnswer> {
  if (pending) return pending;
  const serverUrl = import.meta.env.VITE_SERVER_URL || '';
  const read: Promise<LocalesReadAnswer> = (async () => {
    try {
      const res = await i18nFetch(`${serverUrl}/api/v1/i18n/locales`);
      if (!res.ok) return { ok: false, status: res.status };
      return { ok: true, body: await res.json() };
    } catch (error) {
      return { ok: false, error };
    }
  })();
  pending = read;
  void read.then((answer) => {
    if (!answer.ok && pending === read) pending = null;
  });
  return read;
}

/** Test seam: forget the shared answer, so a case reads afresh. Not public. */
export function __resetLocalesRead(): void {
  pending = null;
}
