/**
 * Seed the console's UI language from the server's resolved locale for the
 * signed-in caller (objectui#4035).
 *
 * What the server answers is per-USER, not a tenant setting (objectui#10193):
 * `GET /api/v1/auth/me/localization` resolves `locale` as the caller's own
 * `sys_user.locale` when set, else the request's `Accept-Language`, else the
 * deployment default, and answers no locale before sign-in. The slot it is
 * cached in is one per device; `@object-ui/auth`'s change-of-owner purge is
 * what keeps one user's answer from seeding the next user's boot — see
 * `LOCALE_SEED_STORAGE_KEY` in `@object-ui/i18n`.
 *
 * That `locale` has always been fetched — `LocalizationFetchProvider` asks the
 * same endpoint (ADR-0053) on every boot — but only ever fed currency/date
 * *formatting*. The UI language was decided entirely client-side, so a
 * deployment defaulting to `zh-CN` still handed every new device an English
 * console until each user switched by hand.
 *
 * This module owns the TRANSPORT only; `@object-ui/i18n` owns the policy (which
 * slot the seed is cached in, how it is validated, and where it sits in the
 * precedence chain). Same split as {@link ./loadLanguage.ts} and
 * {@link ./loadLocales.ts}.
 *
 * ## Why this runs before React mounts
 *
 * The seed has to be readable *synchronously* when the i18next instance is
 * created, because the first render must already be in the right locale:
 * `<html lang>` seeds the `Accept-Language` header on every API call, so a late
 * switch would refetch the first wave of server-resolved labels in the wrong
 * language. A cached seed satisfies that on its own — it is in `localStorage`
 * before the boot even starts. The one case it cannot cover is a device that
 * holds no seed yet, which is what the bounded race below is for.
 *
 * ## The bounded race (objectstack#5419, ruling point 3)
 *
 * On a true first visit — no explicit choice AND no cached seed — the fetch is
 * raced against a short timeout and the boot proceeds with whichever wins:
 *
 * - fetch wins  → the seed is cached and the app mounts in the resolved locale,
 *                 with no flash at all.
 * - timeout wins → the app mounts in browser/`en` (fail-open), and the still
 *                 in-flight fetch caches its answer for the NEXT boot.
 *
 * The wait is bounded, never fails closed, and is joined to the two awaits the
 * console already performs before `createRoot().render()` — so it overlaps with
 * them rather than adding a serial delay, and it costs nothing on any boot
 * after the first. Deliberately NOT an unbounded block on first paint: that is
 * what the issue originally proposed and what the ruling replaced with this.
 *
 * A timeout must not turn into a late live language switch. Once the boot has
 * committed to browser/`en`, swapping the whole UI's language out from under
 * someone who has started reading is a worse outcome than the one English
 * session the ruling explicitly accepts on a brand-new device — and the switch
 * would land at an unbounded time, which is the opposite of a bounded race.
 * The seed lands in the cache instead, and the next boot is correct forever.
 */
import { cacheLanguageSeed, readCachedLanguageSeed, readStoredLanguage } from '@object-ui/i18n';
import { getSessionOwnerChangeCount } from '@object-ui/auth';
import { sharedGetJson } from '@object-ui/types';

/**
 * How long a true first visit will wait for the resolved locale before booting
 * in the browser language. Long enough for a same-origin request against a warm
 * server, short enough to be invisible next to the runtime-config and auth
 * preflight round-trips it runs alongside.
 */
export const SEED_RACE_TIMEOUT_MS = 500;

interface MeLocalizationResponse {
  authenticated?: boolean;
  locale?: string | null;
}

/**
 * Fetch the resolved locale and cache it. Never rejects: a language seed is
 * cosmetic and must never take the boot down.
 *
 * Only an *authenticated* answer carries a locale. The endpoint is
 * allow-listed for gated users and replies `{ authenticated: false }` with no
 * locale before sign-in, which says nothing about anyone's language — writing
 * that through would clear a good cached seed.
 *
 * Nor is an answer written once the browser has changed owner since it was
 * requested (objectui#10193): this request keeps running past the race, and
 * if `SessionUserScope.adopt` hands the browser to someone else meanwhile, the
 * answer belongs to the previous session.
 */
async function fetchAndCacheSeed(serverBase: string): Promise<void> {
  const ownerAtRequest = getSessionOwnerChangeCount();
  try {
    // Shared in flight with `LocalizationFetchProvider` (objectui#5544), which
    // asks the same endpoint on every boot. The prose above already treats the
    // two as one request — "without a second request here" — but on a true first
    // visit both fired, and the card measured them as `me/localization ×2`. They
    // overlap by construction: this one keeps running past the 500 ms race, and
    // the provider mounts as soon as the race resolves. Sharing is in-flight
    // only, so on the boots where they do NOT overlap each still fetches.
    const json = await sharedGetJson<MeLocalizationResponse>(
      `${serverBase}/api/v1/auth/me/localization`,
      { credentials: 'include', headers: { Accept: 'application/json' } },
    );
    if (json?.authenticated === false) return;
    if (getSessionOwnerChangeCount() !== ownerAtRequest) return;
    cacheLanguageSeed(json?.locale);
  } catch {
    // Offline, blocked, malformed — the boot simply goes unseeded.
  }
}

/**
 * Resolve the language seed far enough for this boot to use it.
 *
 * Resolves (never rejects) as soon as the boot may proceed. Any fetch it starts
 * keeps running past that point to populate the cache for the next boot.
 */
export async function seedTenantLanguage(
  serverBase: string,
  timeoutMs: number = SEED_RACE_TIMEOUT_MS,
): Promise<void> {
  // The user's own choice outranks the seed (ruling point 1), so there is
  // nothing for a seed to decide — and no reason to spend a request asking.
  if (readStoredLanguage()) return;

  // Stale-while-revalidate (ruling point 2): a cached seed applies at boot
  // immediately, with no waiting. Revalidation is not this module's job — the
  // in-app `LocalizationFetchProvider` fetch already runs on every boot and
  // refreshes the cache from its answer, so a changed server-side locale
  // reaches choice-less devices on their next boot without a second request
  // here and without being pinned by the old seed.
  if (readCachedLanguageSeed()) return;

  // True first visit: race, fail-open.
  const inFlight = fetchAndCacheSeed(serverBase);
  await Promise.race([
    inFlight,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
