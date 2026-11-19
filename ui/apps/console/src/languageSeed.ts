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
 *
 * ## A supported browser language, else the app's declared default (objectstack#33985)
 *
 * The endpoint's rungs are the caller's own `sys_user.locale`, else the
 * request's `Accept-Language`, else the deployment default. A bare `fetch`
 * sends the BROWSER's header whatever the app ships, so an `en-US` browser on
 * an app that declares `i18n.defaultLocale: 'zh-CN'` and ships no English was
 * answered `en-US` and booted an English console (objectstack#33231). Stating
 * the app's declared default instead, always, overcorrected: discovery always
 * serves a default, so a `zh-CN` browser on an app that ships `zh-CN` beside
 * an `en` default booted English too, and browser detection was dead.
 *
 * The maintainer's ruling (letter B, record 6915665005 on objectstack#33985):
 * for a signed-in user with no personal language, the console's language is
 * the user's own `sys_user.locale`, else the browser's language when the app
 * lists it in discovery `locale.supported`, else the app's declared default
 * (discovery `locale.default`), else `en`. That is the order the server's own
 * rungs already keep, applied to a request that only ever states a language
 * the app ships.
 *
 * So, when the device holds no explicit choice, the read states
 * {@link pickPreferredLocale}'s answer as its `Accept-Language`: the browser's
 * language when `locale.supported` lists it. A stored `sys_user.locale` still
 * answers first, and the stated language only decides the rung below it.
 * {@link loadPreferredLocale} reads discovery through the console's one shared
 * request, and `LocalizationFetchProvider`'s every-boot read states the same
 * value, so the two reads still share one request and the revalidation keeps
 * the cached seed on the same answer.
 *
 * ## A browser language the app does not ship states nothing (objectstack#34392)
 *
 * The same ruling puts the organization's `localization.locale` (Setup →
 * Localization, or the first-run checklist's "Default language and country")
 * between the browser's language and the app's declared default. Only the
 * server holds that setting, and its deployment-default rung answers only a
 * request that names no language the app lists. Stating `locale.default` here
 * named one on every read, so the organization's language never decided a
 * user who had chosen none.
 *
 * So the read states nothing when the browser's language is not in
 * `locale.supported`, or when discovery fails. The browser's own header then
 * goes out, and the server answers it only when the app lists that language;
 * otherwise the organization's setting decides, then the app's declared
 * default, then the server's floor.
 */
import { cacheLanguageSeed, readCachedLanguageSeed, readStoredLanguage } from '@object-ui/i18n';
import { getSessionOwnerChangeCount } from '@object-ui/auth';
import { inflightGetKey, sharedGetJson } from '@object-ui/types';
import { resolveLocaleAmong } from '@objectstack/spec/system';
import { readConsoleDiscovery } from './lib/early-discovery';

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

/** This page-load's read of the language a choice-less read states, once started. */
let preferredLocale: Promise<string | undefined> | null = null;

/**
 * The seed's settled answer, held for `LocalizationFetchProvider`'s boot read
 * (objectstack#35455): the request it answered, as `inflightGetKey` spells it,
 * and the session owner it was asked for. See {@link takeSettledSeedAnswer}.
 */
let settledSeed: { key: string; owner: number; body: unknown } | null = null;
/** Whether the boot read has already been offered the seed's answer. */
let settledSeedSpent = false;

/**
 * Hand the seed's settled answer to the boot read that asks the SAME request,
 * once per page load (objectstack#35455), or `null`.
 *
 * On a true first visit the seed's request usually settles inside its race,
 * before React mounts; the provider mounts later and, since the in-flight
 * registry holds only pending requests, used to ask the endpoint a second
 * time. This is the request it would make, answered moments ago in this page
 * load, so it takes that answer instead.
 *
 * Only an answer about the caller who still owns the browser is handed over:
 * an unauthenticated one is never held, and a change of owner since the seed
 * asked (objectui#10193) answers `null`. The first call spends the hand-off
 * whatever it finds, so a later read — a remount, or the re-read after a write
 * to the user's own row — asks the server, and an answer that settles after
 * the boot read started (which joined it in flight instead) is never held.
 */
export function takeSettledSeedAnswer(url: string, init: RequestInit): unknown | null {
  const held = settledSeed;
  settledSeed = null;
  settledSeedSpent = true;
  if (!held || held.key !== inflightGetKey(url, init)) return null;
  if (held.owner !== getSessionOwnerChangeCount()) return null;
  return structuredClone(held.body);
}

/**
 * The language a read with no explicit choice states (objectstack#33985,
 * ruling 6915665005): the browser's language when the app lists it in
 * `supported`, else `undefined` — the read then states nothing, and the
 * server's deployment default (the organization's language, then the app's
 * declared default) decides (objectstack#34392).
 *
 * The browser's language is its top tag (`navigator.language`), the one tag
 * the server's own `Accept-Language` rung reads off a header. "Lists it" is
 * answered by the platform's one locale ladder, `resolveLocaleAmong`, the
 * matcher that same server rung resolves a requested tag through: exact, then
 * case-insensitive, then the platform table language through its read aliases
 * (`ja` → `ja-JP`, `zh-TW` → `zh-Hant`), then base language (`en-US` → `en`),
 * then variant (`es-MX` → `es-ES`, `zh` → `zh-CN`). The answer is the app's
 * own spelling of the entry, so the server is asked for exactly a language the
 * app ships, and the console agrees with what the server answered the raw
 * browser header before the app default was stated.
 */
export function pickPreferredLocale(
  browserTag: string | null | undefined,
  supported: readonly string[],
): string | undefined {
  const tag = typeof browserTag === 'string' ? browserTag.trim() : '';
  return tag ? resolveLocaleAmong(tag, supported) : undefined;
}

/** Discovery `locale.supported`, read as a list of non-empty tags. */
function readSupportedLocales(discovery: unknown): string[] {
  const locale = (discovery as { locale?: { supported?: unknown } } | null)?.locale;
  return Array.isArray(locale?.supported)
    ? locale.supported.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
}

/**
 * The language a read with no explicit choice states as its `Accept-Language`
 * ({@link pickPreferredLocale} over discovery `locale.supported`), or
 * `undefined` when the app does not list the browser's language or discovery
 * fails.
 *
 * Started once per page-load and never rejects: the first call starts the
 * read, every later call shares it. On `undefined` the reads that state it
 * send the browser's own header, which the server answers only when the app
 * lists that language (objectstack#34392).
 */
export function loadPreferredLocale(serverBase: string): Promise<string | undefined> {
  if (!preferredLocale) {
    preferredLocale = readConsoleDiscovery(serverBase).then(
      (discovery) => {
        const browser = typeof navigator === 'undefined' ? undefined : navigator.language;
        return pickPreferredLocale(browser, readSupportedLocales(discovery));
      },
      () => undefined,
    );
  }
  return preferredLocale;
}

/**
 * This page-load's read of the language a choice-less read states, or `null`
 * when nothing has started one. `seedTenantLanguage` starts it on every boot,
 * before the app mounts, so the console's in-app reads find it here.
 */
export function startedPreferredLocale(): Promise<string | undefined> | null {
  return preferredLocale;
}

/**
 * Test seam: forget this page-load's read of the stated language, and the
 * seed's held answer. Not public.
 */
export function __resetPreferredLocaleForTests(): void {
  preferredLocale = null;
  settledSeed = null;
  settledSeedSpent = false;
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
  // The owner is read after this wait, when the request leaves: it carries the
  // session that holds the browser then, not the one before the wait.
  const preferred = await loadPreferredLocale(serverBase);
  const ownerAtRequest = getSessionOwnerChangeCount();
  try {
    // Shared in flight with `LocalizationFetchProvider` (objectui#5544), which
    // asks the same endpoint on every boot. The prose above already treats the
    // two as one request — "without a second request here" — but on a true first
    // visit both fired, and the card measured them as `me/localization ×2`. They
    // overlap by construction: this one keeps running past the 500 ms race, and
    // the provider mounts as soon as the race resolves. Sharing is in-flight
    // only, so on the boots where they do NOT overlap each still fetches.
    const url = `${serverBase}/api/v1/auth/me/localization`;
    const init: RequestInit = {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        // A supported browser language decides the rung below the user's
        // own locale (objectstack#33985); otherwise the browser's own header
        // goes, and the server's deployment default decides
        // (objectstack#34392).
        ...(preferred ? { 'Accept-Language': preferred } : {}),
      },
    };
    const json = await sharedGetJson<MeLocalizationResponse>(url, init);
    if (json?.authenticated === false) return;
    if (getSessionOwnerChangeCount() !== ownerAtRequest) return;
    cacheLanguageSeed(json?.locale);
    // Held for the provider's boot read (objectstack#35455), unless that read
    // has already started: it then joined this request in flight.
    if (!settledSeedSpent) settledSeed = { key: inflightGetKey(url, init), owner: ownerAtRequest, body: json };
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

  // Started on every choice-less boot, not only the first visit, and not
  // awaited here: `LocalizationFetchProvider`'s every-boot read states the same
  // language (objectstack#33985), and the request is the one the data adapter's
  // `connect()` makes anyway, so it costs no request of its own.
  void loadPreferredLocale(serverBase);

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
