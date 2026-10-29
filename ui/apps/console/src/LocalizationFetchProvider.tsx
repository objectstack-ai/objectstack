/**
 * LocalizationFetchProvider — loads the caller's resolved regional defaults
 * (currency / locale / timezone) from `GET /api/v1/auth/me/localization`
 * (ADR-0053) and feeds the pure `LocalizationProvider` so every field /
 * measure renderer can resolve a currency code down to the org default, and
 * every date face renders an instant in the served zone (objectui#11693).
 *
 * Cosmetic, NOT fail-closed: while loading or on error it renders children with
 * an empty value (no tenant default → renderers show a plain number), so a slow
 * or missing endpoint never blocks the app.
 *
 * That posture is why it retries QUIETLY. On a multi-tenant host this endpoint
 * is served by the environment kernel that owns the session, and a cold one
 * answers `503` + `Retry-After` while it warms (objectstack#4159) — so a
 * transient failure is a normal part of a cold start, not an exception. A single
 * attempt meant one 503 during warm-up degraded currency and locale for the
 * WHOLE session, silently and permanently, long after the kernel was ready.
 *
 * It also refreshes the UI-language seed cache from the same answer
 * (objectui#4035) — see the write inside the success branch. That is a cache
 * write only: it never changes this boot's language, and it leaves the fetch's
 * cosmetic / never-fail-closed / retried-in-the-background contract untouched.
 *
 * It shares the "is this transient / how long to wait" primitives with
 * `MePermissionsProvider` but not its policy: that one is fail-closed and holds
 * its loading state across the waits, this one keeps rendering throughout and
 * simply fills the value in if and when an attempt succeeds.
 *
 * ## Read again after the signed-in user's own row changes (objectstack#27498)
 *
 * The answer's `locale` is the caller's language: their own `sys_user.locale`
 * when set, else the request's `Accept-Language`, else the deployment default.
 * `useDisplayLocale` ranks it above the active UI language, so every date and
 * number renderer formats with whatever this provider last read. The language
 * switch changes the UI language first and writes the column second
 * (`useLanguageSelection`), and the switch remounts this provider through the
 * console shell's `key={language}`. The remount's read can reach the server
 * before the column write commits; it then answers the OLD language (on a user
 * with no column yet, the browser's `Accept-Language`), and nothing read again,
 * so under 中文 the grid's date cells said `Oct 11` until a full page load.
 *
 * So the read re-runs on every mutation of the signed-in user's `sys_user` row
 * that reaches the data-invalidation bus, which every adapter write does
 * (`useMutationInvalidationBridge`): the language switch's own write, and the
 * profile page's. That re-read starts after the write has settled, and it does
 * not join a request still in flight from before it (the shared in-flight
 * registry would hand back the stale answer), so it is the one that lands.
 *
 * ## State the device's chosen language (objectstack#27625)
 *
 * Every other console API call carries the active UI language as its
 * `Accept-Language` (`createAuthenticatedFetch` stamps `<html lang>`), but this
 * read goes through `sharedGetJson`'s bare `fetch`, so it carried the BROWSER's
 * header instead. A user with no `sys_user.locale` who picked 中文 on the
 * sign-in page therefore got the `Accept-Language` rung answered in the
 * browser's language, and every date cell said `Nov 18` under Chinese headers,
 * on every load.
 *
 * So when the device holds an explicit language choice, this read states that
 * language. The server's rungs are unchanged: a stored `sys_user.locale` still
 * answers first, and the header only decides the rung below it. Without a
 * choice the browser's header stays: that is exactly the boot on which
 * `seedTenantLanguage()` asks this endpoint too, and the two share one request
 * only while their headers match (objectui#5544). The stated language is part
 * of the request, so a change of it reads again, and the new read cannot join
 * one still in flight under the old language: the in-flight key includes the
 * headers.
 */
import { useEffect, useState } from 'react';
import {
  LocalizationProvider,
  cacheLanguageSeed,
  readStoredLanguage,
  useObjectTranslation,
  type LocalizationValue,
} from '@object-ui/i18n';
import { getSessionOwnerChangeCount, useAuth } from '@object-ui/auth';
import { useDataInvalidation } from '@object-ui/react';
import {
  HttpFetchError,
  backoffMs,
  isTransientFailure,
  sharedGetJson,
  sleep,
} from '@object-ui/types';

interface MeLocalizationResponse {
  authenticated?: boolean;
  currency?: string | null;
  locale?: string | null;
  timezone?: string | null;
}

/**
 * Attempts for a transient failure, and the base for the exponential backoff.
 * Deliberately more patient than the permission layer's: nothing is waiting on
 * this, so it can afford to still be trying when a slow environment finishes
 * warming, and a user who never sees a currency symbol is better served by a
 * late answer than by no answer.
 */
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 1_000;

export function LocalizationFetchProvider({
  endpoint,
  children,
}: {
  endpoint: string;
  children: React.ReactNode;
}) {
  const [value, setValue] = useState<LocalizationValue>({});
  const { user } = useAuth();
  const userId = user?.id ? String(user.id) : undefined;
  // Bumps on every write to the signed-in user's own row (objectstack#27498).
  const userRowWrites = useDataInvalidation(userId ? 'sys_user' : undefined, userId);
  // The device's chosen UI language, stated as this read's `Accept-Language`;
  // none chosen, the browser's own header goes out (objectstack#27625).
  const { language } = useObjectTranslation();
  const statedLanguage = readStoredLanguage() ? language : undefined;

  useEffect(() => {
    let cancelled = false;
    // A re-read must not join a request that left before the write it answers
    // to: `sharedGetJson` opts a request with a signal out of sharing. The
    // boot read keeps sharing with `seedTenantLanguage()` (objectui#5544).
    const reread = userRowWrites > 0 ? new AbortController() : undefined;

    void (async () => {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        // Whose answer this attempt will be (objectui#10193). The request
        // carries whatever session this browser holds right now; if
        // `SessionUserScope.adopt` hands the browser to a different user while
        // it is in flight, the answer describes the PREVIOUS owner and must
        // not be written into the slot the new owner's boot will read.
        const ownerAtRequest = getSessionOwnerChangeCount();
        try {
          // Shared in flight with `seedTenantLanguage()` (objectui#5544): on a
          // device's first visit that seed asks this same endpoint, and its
          // request is still running when this one starts. `sharedGetJson`
          // rejects with the same `HttpFetchError` a non-2xx produced here
          // before — including `Retry-After` — so the retry policy below is
          // untouched, and a shared 503 reaches BOTH callers rather than
          // resolving one of them empty.
          const json = await sharedGetJson<MeLocalizationResponse>(endpoint, {
            credentials: 'include',
            headers: {
              Accept: 'application/json',
              ...(statedLanguage ? { 'Accept-Language': statedLanguage } : {}),
            },
            signal: reread?.signal,
          });
          // Refresh the UI-language seed cache (objectui#4035) — the
          // "revalidate" half of stale-while-revalidate. This boot has already
          // committed to a language; what this write buys is the NEXT one, so a
          // change to the caller's resolved locale (their own
          // `sys_user.locale`, else `Accept-Language`, else the deployment
          // default) reaches this device without either an extra request or an
          // old seed pinning it there.
          //
          // Outside the `cancelled` guard on purpose: the answer is about the
          // signed-in caller, not about this component instance, so it is
          // worth keeping even if we unmounted while it was in flight — but
          // only while that caller still owns this browser. A change of owner
          // since the request left (objectui#10193) means the answer is the
          // previous owner's language; the slot stays as the purge left it and
          // the new owner's own answer fills it. An unauthenticated reply is
          // not authoritative and must not clear a good seed.
          if (json.authenticated !== false && getSessionOwnerChangeCount() === ownerAtRequest) {
            cacheLanguageSeed(json.locale);
          }
          if (cancelled) return;
          // All three keys of the answer. `timezone` used to be dropped here
          // (objectui#11693), so no face could render in the zone the server
          // resolved; `LocalizationProvider` hands it to the date faces.
          setValue({
            currency: json.currency ?? undefined,
            locale: json.locale ?? undefined,
            timezone: json.timezone ?? undefined,
          });
          return;
        } catch (err) {
          // Superseded by a later read (or unmounted): its abort is no failure.
          if (cancelled) return;
          // A real answer about this caller (401/403/404/500) will not change on
          // a retry, and neither will the last attempt — either way, stop and
          // leave the empty value. Cosmetic: renderers show plain numbers.
          if (!isTransientFailure(err) || attempt === MAX_RETRIES) return;

          const stated = err instanceof HttpFetchError ? err.retryAfterMs : undefined;
          await sleep(backoffMs(attempt, BASE_DELAY_MS, stated));
          if (cancelled) return;
        }
      }
    })();

    return () => {
      cancelled = true;
      reread?.abort();
    };
  }, [endpoint, userRowWrites, statedLanguage]);

  return <LocalizationProvider value={value}>{children}</LocalizationProvider>;
}
