/**
 * @object-ui/i18n - React integration
 *
 * Provides I18nProvider and useObjectTranslation hook for React components.
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { I18nextProvider, useTranslation, type UseTranslationOptions } from 'react-i18next';
import type { i18n as I18nInstance, ReactOptions } from 'i18next';
import { createI18n, getDirection, pickInitialLanguage, type I18nConfig } from './i18n.js';
import { interpolateFallback, optionsOf } from './fallbackInterpolation.js';
import {
  BUILT_IN_LANGUAGE_CODES as BUILT_IN_CODES,
  isBuiltInLanguage,
  loadBuiltInLocale,
  matchLanguageTag,
} from './locales/registry.js';

/**
 * `localStorage` key holding the user's explicit language choice.
 *
 * Follows the console's existing preference-key convention
 * (`objectui-favorites`, `objectui-recent-items`), and sits beside the theme
 * preference the same avatar menu writes — a language switch is a preference,
 * not ephemeral UI state, so it belongs in storage (AGENTS.md §5 #8).
 *
 * Exported so an app that builds its own i18next instance (and therefore owns
 * its bootstrap language — see {@link I18nProviderProps.instance}) can honour
 * the same preference, and so a sign-out flow can clear it.
 *
 * ⚠️ **What this slot means changed for a SIGNED-IN user (objectui#10059).**
 * A signed-in user's language has one source of truth and it is not on the
 * device: it is the server column `sys_user.locale`, read back through
 * `GET /auth/me/localization` and written by both the profile page's language
 * card and the console's globe menu. For that user this slot is a CACHE of the
 * column — it still decides the first paint, because the column cannot be read
 * synchronously, and it is then overwritten by whatever the column says. It
 * decides on its own only BEFORE sign-in, which is the case this provider can
 * see and the only one it adjudicates.
 *
 * This provider deliberately does not implement that rule: reading a `sys_user`
 * row needs an authenticated data adapter, which is a host concern and not a
 * dependency a renderer package takes. The host applies the column through
 * {@link I18nContextValue.changeLanguage} like any other switch — in this
 * repository, `@object-ui/app-shell`'s `useUserLocale`.
 */
export const LOCALE_STORAGE_KEY = 'objectui-locale';

/**
 * Read the persisted language choice, or `null` when nothing is stored.
 *
 * Defensive by design: `localStorage` does not exist under SSR and *throws* on
 * access in Safari private mode / partitioned iframes. A language preference is
 * never worth taking the app down for, so every failure degrades to "nothing
 * stored".
 */
export function readStoredLanguage(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredLanguage(lang: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, lang);
  } catch {
    // Storage blocked or full — the switch still applies for this session.
  }
}

function clearStoredLanguage(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
  } catch {
    // Nothing readable means nothing to purge.
  }
}

/**
 * `localStorage` key caching the server's resolved locale for the signed-in
 * caller — a *seed*, not a choice (objectui#4035).
 *
 * ⚠️ **The value is per-USER; the slot is per-DEVICE (objectui#10193).**
 * `GET /auth/me/localization` answers `locale` as the caller's own
 * `sys_user.locale` when set, else the request's `Accept-Language`, else the
 * deployment default — and answers no locale at all before sign-in. It is not
 * a tenant setting, whatever earlier prose here said. The slot is deliberately
 * NOT keyed by user: the boot reads it before anyone is signed in, when no
 * user id exists to key by. What bounds it to one owner is
 * `@object-ui/auth`'s change-of-owner purge (objectui#5664), which deletes it
 * when a different user adopts the browser, and which the host answers by
 * re-resolving the live language (`@object-ui/app-shell`'s
 * `useSignedInUserLocale`).
 *
 * **What a visitor who is not signed in reads**, declared as device behaviour:
 * the language the LAST signed-in owner of this browser was served, until
 * someone else signs in. That is the only server answer this device has ever
 * received — the endpoint gives none before sign-in — and the sign-in page is
 * the one surface it paints.
 *
 * Deliberately a separate slot from {@link LOCALE_STORAGE_KEY}, and that
 * separation is the whole point rather than a tidiness preference. The two
 * values have different provenance and therefore different rights:
 *
 * - {@link LOCALE_STORAGE_KEY} is what the *user* picked on this device. It
 *   outranks everything this provider can see and must survive a change in
 *   what the server answers for the seed below. ⚠️ It does NOT outrank the signed-in user's own
 *   `sys_user.locale`, which no tier here represents — see that key's own
 *   docblock (objectui#10059).
 * - This slot is what the server resolved for the signed-in caller, cached so
 *   the next boot can apply it synchronously. It outranks only the environment
 *   (browser language).
 *
 * Writing the server seed into the explicit-choice slot would erase that
 * difference permanently: the seed would then be indistinguishable from a
 * deliberate user choice, so it would (a) outrank a later server-side change
 * and pin the device to a stale locale forever, and (b) suppress browser
 * detection for
 * a user who never expressed a preference. Only a real switch promotes a
 * language to the explicit slot — see the `languageChanged` choke point.
 */
export const LOCALE_SEED_STORAGE_KEY = 'objectui-locale-seed';

/**
 * Read the cached locale seed — the server's last resolved locale for this
 * browser's last signed-in caller (see {@link LOCALE_SEED_STORAGE_KEY}) — or
 * `null` when nothing is cached.
 *
 * Same defensive posture as {@link readStoredLanguage}: `localStorage` is
 * absent under SSR and *throws* in Safari private mode / partitioned iframes,
 * and a language seed is never worth taking the app down for.
 */
export function readCachedLanguageSeed(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Cache the locale the server just resolved for the signed-in caller — the
 * "revalidate" half of the stale-while-revalidate contract (objectstack#5419,
 * ruling point 2).
 *
 * Call this with whatever `/auth/me/localization` actually returned for an
 * authenticated caller. A `null`/`undefined` locale CLEARS the cache rather
 * than leaving the old value: a server answer that drops the locale must reach
 * choice-less devices on their next boot, and "keep the last good seed forever"
 * is precisely the being-pinned-by-a-stale-seed failure the ruling forbids.
 *
 * A *failed* fetch must simply not call this — the cache is then left intact,
 * which is the correct stale-while-revalidate behaviour when revalidation
 * cannot complete.
 */
export function cacheLanguageSeed(locale: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  try {
    if (typeof locale === 'string' && locale.length > 0) {
      window.localStorage.setItem(LOCALE_SEED_STORAGE_KEY, locale);
    } else {
      window.localStorage.removeItem(LOCALE_SEED_STORAGE_KEY);
    }
  } catch {
    // Storage blocked or full — this boot simply goes unseeded.
  }
}

/**
 * Languages this renderer ships or was handed: a built-in catalogue, or an
 * entry in `config.resources`.
 *
 * ⚠️ Since objectui#7479 a built-in catalogue is FETCHED, not statically
 * resident, so "known" here no longer means "renderable on the very next
 * frame" — it means this provider can produce it without asking the app, which
 * is the question every caller of this predicate is actually asking (may this
 * stored value be restored; may this seed be honoured). The one caller that
 * needs the stricter reading is the bootstrap itself, and it gets it by
 * AWAITING {@link preloadBootstrapLocale} before render rather than by asking a
 * different predicate.
 *
 * `hasOwnProperty` rather than `in`: a junk stored value like `constructor`
 * would pass an `in` check against a plain object's prototype.
 */
function isStaticallyKnownLanguage(lang: string, config?: I18nConfig): boolean {
  const own = Object.prototype.hasOwnProperty;
  return isBuiltInLanguage(lang) || Boolean(config?.resources && own.call(config.resources, lang));
}

/** The built-in packs' codes, as a stable identity for consumers' dep arrays. */
const BUILT_IN_LANGUAGE_CODES: readonly string[] = BUILT_IN_CODES;

/**
 * Every language this renderer can produce *without asking the app*: the
 * built-in packs plus `config.resources`.
 *
 * This is the offline/no-backend answer — the set the switcher offers when
 * there is no `loadLocales` wiring, or when the app's locale endpoint cannot
 * be reached (objectui#4039).
 */
function resolvableLanguages(config?: I18nConfig): string[] {
  const extra = Object.keys(config?.resources ?? {}).filter(
    (code) => !BUILT_IN_LANGUAGE_CODES.includes(code),
  );
  return [...BUILT_IN_LANGUAGE_CODES, ...extra];
}

/**
 * Whether `tag` is a well-formed BCP-47 language tag.
 *
 * `Intl.getCanonicalLocales` is the standard's own parser, so this rejects
 * exactly what a locale code cannot be — `constructor`, `__proto__`, `en_US`,
 * `''` all throw `RangeError` — while accepting codes no pack exists for yet
 * (`th`, `pt-BR`). Guarded for runtimes that ship no `Intl`: a language
 * preference is never worth taking the app down for.
 */
function isWellFormedLanguageTag(tag: string): boolean {
  if (typeof Intl === 'undefined' || typeof Intl.getCanonicalLocales !== 'function') {
    return /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(tag);
  }
  try {
    return Intl.getCanonicalLocales(tag).length === 1;
  } catch {
    return false;
  }
}

/**
 * Whether this provider can end up rendering `lang` at all.
 *
 * Wider than {@link isStaticallyKnownLanguage} by exactly one case: when a
 * dynamic {@link I18nProviderProps.loadLanguage} loader is wired, that loader
 * *is* the mechanism that produces app-shipped locales, and nothing can
 * enumerate what it will answer for synchronously — the app's pack for `th`
 * lives behind `GET /api/v1/i18n/translations/th`, not in `config.resources`.
 *
 * This is the lockstep half of objectui#4039. The switcher now offers the
 * app's own locales, so the restore validation had to grow with it or a
 * user-picked app locale would be purged on the next reload — the exact bug
 * objectstack#5418 predicted this fix would otherwise mint. The bound stays
 * honest rather than absent: only well-formed tags qualify, and the app's own
 * locale list adjudicates the choice for real once it lands (see the
 * `provisional` self-heal in {@link I18nProvider}).
 */
function canResolveLanguage(lang: string, config?: I18nConfig, hasLoader = false): boolean {
  if (isStaticallyKnownLanguage(lang, config)) return true;
  return hasLoader && isWellFormedLanguageTag(lang);
}

/**
 * Adjudicate the locale seed — the last signed-in owner's cached server
 * answer (their `sys_user.locale`, else `Accept-Language`, else the deployment
 * default), bounded to that one owner by the objectui#5664 purge; see
 * {@link LOCALE_SEED_STORAGE_KEY} — into a language this renderer can actually
 * boot in, or `null` to fall through to the next tier (objectui#4035).
 *
 * {@link canResolveLanguage} is the verdict — the same predicate the language
 * menu uses, deliberately not a second "do we have this locale" check
 * (objectstack#5418 / objectui#4039). Two things are layered on top of it, both
 * of which are about *which question to ask it*, not about second-guessing the
 * answer:
 *
 * **1. Exact tag first, then its base language** — the registry's
 * `matchLanguageTag`, the one implementation of that order in this package
 * (objectui#11326). A seed is a full BCP-47 tag — the platform answers
 * `zh-CN`, not `zh` (see `LocalizationFetchProvider`'s fixtures). Since
 * objectui#11326 the built-in packs answer a region-tagged code themselves
 * (`zh-CN` is served by the `zh` catalogue), so for them the exact step
 * already succeeds and the seed boots in the tag the server stated; the base
 * step is what still reaches an app-supplied `config.resources` pack keyed by
 * base language. Exact first, so a genuine `pt-BR` pack still wins over `pt`.
 *
 * **2. The seed does NOT get the dynamic loader's credit** (`hasLoader` is left
 * at its default `false`). That credit exists for a *user-picked* value: the
 * user chose it from a menu built out of the app's real locale list, and a
 * stored choice that turns out unshippable is adjudicated afterwards by the
 * `provisional` self-heal. A seed has neither property — it is whatever the
 * server resolved (a stored column, a request header, a deployment default),
 * it passed through no menu, and there is no self-heal behind it. Extending the credit would mean booting into a locale we
 * cannot confirm we ship and then retracting it, i.e. manufacturing exactly the
 * flash that ruling point 3 bounds, on the very first-visit path it bounds it
 * on. Falling through instead is what ruling point 4 asks for, and it is
 * self-correcting in one step: the user switches once, and that switch is a
 * real explicit choice which outranks the seed from then on.
 */
function resolveSeedLanguage(seed: string, config?: I18nConfig): string | null {
  return matchLanguageTag(seed, (code) => canResolveLanguage(code, config));
}

/**
 * Resolve the bootstrap config for a provider-owned i18next instance, applying
 * a stored language choice when there is a usable one.
 *
 * Applied at instance creation rather than through a post-mount
 * `changeLanguage`, because the very first render must already be in the right
 * locale: `<html lang>` seeds the `Accept-Language` header on every API call
 * (`createAuthenticatedFetch`, issue objectstack-ai/objectstack#1319), so a late switch would fetch the
 * first wave of server-resolved metadata labels in the wrong language and then
 * have to remount to fix it.
 *
 * A stored choice outranks browser detection (which itself outranks
 * `defaultLanguage` in `createI18n`) — otherwise a user who picked 中文 on a
 * `ja` browser would be handed `ja` back on every reload, and the preference
 * would be unusable for exactly the users who need it.
 *
 * A stored value the app no longer offers is dropped *and purged*, so one stale
 * entry can never lock the UI to a locale that has no translations.
 *
 * The full precedence chain, in order (objectstack#5419 ruling point 1):
 *
 * 1. the user's explicit choice ({@link LOCALE_STORAGE_KEY})
 * 2. the server's last resolved locale for the signed-in caller, cached at
 *    {@link LOCALE_SEED_STORAGE_KEY} (per-USER in origin, one device slot in
 *    storage — see that key's docblock)
 * 3. the browser language (`createI18n`'s `detectBrowserLanguage`)
 * 4. `en`
 *
 * ⚠️ That chain is the whole answer only for a visitor who is not signed in.
 * A signed-in user's language is decided by `sys_user.locale` and reaches this
 * provider as an ordinary `changeLanguage` from the host once the row has been
 * read; tier 1 is that value's cache from then on (objectui#10059 — the reasons
 * are on {@link LOCALE_STORAGE_KEY}, not repeated here).
 *
 * Tiers 2 and 3 are both "nobody on this device chose this here", but they are
 * not equally informed: the seed is what the server resolved for the signed-in
 * caller — their own `sys_user.locale`, else the request's `Accept-Language`,
 * else the deployment default — while the browser language is an artefact of
 * whoever set up the machine. The server's resolution wins.
 */
interface BootstrapResolution {
  /** The config to build the i18next instance from. */
  config: I18nConfig | undefined;
  /**
   * The stored language accepted on the dynamic loader's credit alone — not a
   * built-in pack, not in `config.resources`. Nothing synchronous can confirm
   * the app still ships it, so the app's own locale list adjudicates it once
   * it lands. `null` when the bootstrap language needed no such credit, which
   * is every case that existed before objectui#4039.
   */
  provisional: string | null;
}

/**
 * The seed tier: the last signed-in owner's cached server answer (see
 * {@link LOCALE_SEED_STORAGE_KEY}), applied only when nobody has expressed a
 * choice on this device (objectui#4035).
 *
 * Returns the bootstrap resolution for the seed, or `null` when there is no
 * usable seed and the caller should fall through to browser detection.
 *
 * `provisional` is deliberately always `null` here: that flag marks a value
 * accepted on the loader's optimistic credit so the app's locale list can
 * adjudicate it later, and {@link resolveSeedLanguage} never extends that
 * credit — a seed is either resolvable right now or it falls through.
 */
function resolveSeedBootstrap(config: I18nConfig | undefined): BootstrapResolution | null {
  const seed = readCachedLanguageSeed();
  if (!seed) return null;
  const resolved = resolveSeedLanguage(seed, config);
  if (!resolved) return null;
  return {
    // `detectBrowserLanguage: false` is what makes the seed tier outrank the
    // environment tier. What the server resolved for this device's signed-in
    // owner beats the browser's incidental setting — ruling point 1.
    config: { ...config, defaultLanguage: resolved, detectBrowserLanguage: false },
    provisional: null,
  };
}

function resolveBootstrapConfig(
  config: I18nConfig | undefined,
  persist: boolean,
  hasLoader: boolean,
): BootstrapResolution {
  // `persistLanguage: false` surfaces (previews, demos, screenshot harnesses)
  // must stay on a fixed language regardless of what is on this origin — that
  // covers the seed too, not just the user's choice.
  if (!persist) return { config, provisional: null };
  const stored = readStoredLanguage();
  // No explicit choice at all → the seed gets its turn.
  if (!stored) return resolveSeedBootstrap(config) ?? { config, provisional: null };
  if (!canResolveLanguage(stored, config, hasLoader)) {
    clearStoredLanguage();
    // A purged choice is no choice, so this falls to the same seed tier —
    // otherwise dropping one unshippable stored value would skip the seed and
    // land straight on the browser language.
    return resolveSeedBootstrap(config) ?? { config, provisional: null };
  }
  return {
    config: { ...config, defaultLanguage: stored, detectBrowserLanguage: false },
    provisional: isStaticallyKnownLanguage(stored, config) ? null : stored,
  };
}

/**
 * Options shared by {@link resolveBootstrapLanguage} and
 * {@link preloadBootstrapLocale}. Each field mirrors the {@link I18nProvider}
 * prop of the same name, because the two must answer identically — a host that
 * preloads one catalogue while the provider boots into another has bought a
 * flash of `en` instead of avoiding one.
 */
export interface BootstrapLocaleOptions {
  /** The `config` you will pass to {@link I18nProvider}. */
  config?: I18nConfig;
  /** The `persistLanguage` you will pass to {@link I18nProvider}. Default `true`. */
  persistLanguage?: boolean;
  /** Whether you will pass a `loadLanguage` loader. Default `false`. */
  hasLoader?: boolean;
}

/**
 * The language {@link I18nProvider} will boot in, computed WITHOUT creating an
 * i18next instance (objectui#7479).
 *
 * The full precedence chain, unchanged: explicit choice → seed →
 * browser language → `defaultLanguage` → `en`.
 */
export function resolveBootstrapLanguage(options: BootstrapLocaleOptions = {}): string {
  const { config, persistLanguage = true, hasLoader = false } = options;
  const resolved = resolveBootstrapConfig(config, persistLanguage, hasLoader);
  return pickInitialLanguage(resolved.config);
}

/**
 * Fetch the catalogue {@link I18nProvider} will boot in, BEFORE you render it.
 *
 * ## Why a host would await this
 *
 * Built-in catalogues are lazy since objectui#7479, so the provider can be in
 * one of two states on its first render, and the difference is visible:
 *
 *   - **catalogue already resident** — the first paint is in the user's
 *     language, exactly as it was when all ten packs shipped eagerly;
 *   - **catalogue still in flight** — the first paint renders through
 *     `fallbackLng: 'en'` and re-renders in the user's language when the fetch
 *     lands. Correct, never blank, and a flash of English for a `zh-CN` viewer.
 *
 * ⇒ any host that owns an await before `createRoot().render()` should spend it
 * here; `apps/console/src/main.tsx` does, alongside the runtime-config and auth
 * preflight round-trips it already waits on. A host that has no such seam gets
 * the documented `en`-while-loading behaviour instead, which is why this is a
 * function a host CALLS rather than a requirement the provider imposes.
 *
 * Never rejects: a catalogue that will not download must not take the boot
 * down, and the provider retries on mount.
 */
export async function preloadBootstrapLocale(
  options: BootstrapLocaleOptions = {},
): Promise<void> {
  try {
    await loadBuiltInLocale(resolveBootstrapLanguage(options));
  } catch (err) {
    console.warn('[i18n] Failed to preload the bootstrap locale catalogue:', err);
  }
}

interface I18nContextValue {
  /** Current language code */
  language: string;
  /** Change the active language */
  changeLanguage: (lang: string) => Promise<void>;
  /** Current text direction ('ltr' or 'rtl') */
  direction: 'ltr' | 'rtl';
  /** The underlying i18next instance */
  i18n: I18nInstance;
  /**
   * The languages a switcher may offer (objectui#4039): the app's own locale
   * list ∩ what this renderer can resolve. Computed here because only the
   * provider knows both sides — the built-in packs, `config.resources` and
   * whether a dynamic loader is wired.
   *
   * `null` means "still asking the app". Consumers render nothing (or a
   * skeleton) rather than a list they will have to retract a tick later.
   * Without {@link I18nProviderProps.loadLocales} wiring, or when the app's
   * endpoint cannot be reached, this is the offline fallback: the built-in
   * packs plus `config.resources`.
   */
  offerableLanguages: readonly string[] | null;
}

const ObjectI18nContext = createContext<I18nContextValue | null>(null);

/**
 * Re-render a reader when the store GAINS translations, not only when the
 * language changes (objectui#10382).
 *
 * react-i18next re-renders a `useTranslation` reader on the events its
 * `bindI18n` / `bindI18nStore` options name, and `bindI18nStore` defaults to
 * none. So a bundle added after mount — the `loadLanguage` answer, a built-in
 * catalogue that lands late — reached nobody who had already rendered: they
 * kept drawing the fallback until something unrelated re-rendered them. The
 * provider's old remedy, setting its `language` state to the value it already
 * held, was a same-value update React bails out of.
 *
 * With `added` bound, every store write bumps react-i18next's own revision and
 * hands each reader a NEW `t`. That is more than a re-render: a reader that
 * memoises on `t`, or on a resolver built from it (`useObjectLabel`'s return
 * value, the column memo in `ObjectDataTable`), recomputes too — a re-render
 * alone would leave it on the fallback.
 *
 * Passed per call rather than set on the instance, so it holds for an instance
 * the host built itself (the `instance` prop) and does not leak into
 * react-i18next's process-wide defaults. `useTranslation` spreads this argument
 * over the instance's `react` options before its `subscribe` reads
 * `bindI18nStore` (measured in `react-i18next@17.0.11`, `useTranslation.js`).
 * The hook's typings do not list the key, so the type borrows it from i18next's
 * `ReactOptions`, where it is declared. Module-level so its identity is stable:
 * `useTranslation` keys its options memo, and with it the subscription, on it.
 *
 * ⚠️ The price: every store write re-renders every reader and re-runs whatever
 * keys on `t`. So the provider writes a built-in catalogue only when the merge
 * adds something ({@link mergeAddsKeys}), and writes silently where
 * `languageChanged` follows and re-renders once anyway.
 */
const STORE_WRITES_RERENDER: UseTranslationOptions<undefined> & Pick<ReactOptions, 'bindI18nStore'> =
  Object.freeze({ bindI18nStore: 'added' });

/** For the switch path's writes: `changeLanguage` announces them, once, in the new language. */
const SILENT_WRITE = Object.freeze({ silent: true });

function isNested(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Whether `addResourceBundle(…, deep: true, overwrite: false)` of `source` into
 * `target` would write anything — a key `target` lacks, at any depth where
 * both sides hold objects. Mirrors i18next's `deepExtend` with `overwrite` off,
 * which leaves a key present on both sides alone when either value is not an
 * object, so such a key adds nothing.
 */
function mergeAddsKeys(target: Record<string, unknown>, source: Record<string, unknown>): boolean {
  for (const key of Object.keys(source)) {
    if (!(key in target)) return true;
    const into = target[key];
    const from = source[key];
    if (isNested(into) && isNested(from) && mergeAddsKeys(into, from)) return true;
  }
  return false;
}

export interface I18nProviderProps {
  /** i18n configuration options */
  config?: I18nConfig;
  /** Pre-created i18next instance (overrides config) */
  instance?: I18nInstance;
  /**
   * Dynamic language pack loader (v2.0.7).
   * When set, language packs are loaded lazily instead of being bundled.
   * Should return a translation resource object for the given language code.
   *
   * @example
   * ```tsx
   * <I18nProvider
   *   loadLanguage={async (lang) => {
   *     const mod = await import(`./locales/${lang}.json`);
   *     return mod.default;
   *   }}
   * >
   *   <App />
   * </I18nProvider>
   * ```
   */
  loadLanguage?: (lang: string) => Promise<Record<string, unknown>>;
  /**
   * The app's own locale list — the codes it actually ships translations for
   * (objectui#4039). Wired the same way as {@link I18nProviderProps.loadLanguage}:
   * the app owns the transport, the provider owns what is done with the answer.
   *
   * The console reads `GET /api/v1/i18n/locales`; see
   * `apps/console/src/loadLocales.ts`. Without this prop the switcher keeps
   * offering the built-in packs (plus `config.resources`) exactly as before, so
   * an app that never wires it is unaffected.
   *
   * @example
   * ```tsx
   * <I18nProvider loadLanguage={loadLanguage} loadLocales={loadLocales}>
   *   <App />
   * </I18nProvider>
   * ```
   */
  loadLocales?: () => Promise<string[]>;
  /**
   * Remember the active language in `localStorage` ({@link LOCALE_STORAGE_KEY})
   * and restore it on the next mount. Default: `true`.
   *
   * Every language change on the instance is persisted — whether it came from
   * this provider's `changeLanguage`, a switcher calling
   * `i18n.changeLanguage()` directly, or app code — because the promise the UI
   * makes ("this is my language now") must not depend on which API the caller
   * reached for.
   *
   * The *restore* half only applies to an instance this provider creates: when
   * you pass your own {@link I18nProviderProps.instance}, its bootstrap
   * language is yours to choose (call {@link readStoredLanguage} if you want
   * the same preference honoured).
   *
   * Set `false` for surfaces that must stay on a fixed language regardless of
   * what the user picked elsewhere on the origin — previews, demos, screenshot
   * harnesses.
   */
  persistLanguage?: boolean;
  /** Children to render */
  children: React.ReactNode;
}

/**
 * I18nProvider - Wraps your app with i18n support
 *
 * @example
 * ```tsx
 * <I18nProvider config={{ defaultLanguage: 'zh' }}>
 *   <App />
 * </I18nProvider>
 * ```
 */
export function I18nProvider({
  config,
  instance: externalInstance,
  loadLanguage,
  loadLocales,
  persistLanguage = true,
  children,
}: I18nProviderProps) {
  // A boolean, not `loadLanguage` itself: an inline arrow would change identity
  // every render and rebuild the i18next instance (and with it the language)
  // on each one. What the bootstrap needs to know is only whether a loader
  // exists at all.
  const hasLoader = Boolean(loadLanguage);
  const bootstrap = useMemo(() => {
    if (externalInstance) return { instance: externalInstance, provisional: null as string | null };
    const resolved = resolveBootstrapConfig(config, persistLanguage, hasLoader);
    return { instance: createI18n(resolved.config), provisional: resolved.provisional };
  }, [externalInstance, config, persistLanguage, hasLoader]);
  const i18nInstance = bootstrap.instance;

  const [language, setLanguage] = useState(i18nInstance.language || 'en');
  const direction = getDirection(language);

  // Track which languages have had app-specific translations loaded
  // (separate from built-in locales that ship with the library)
  const loadedAppLangs = useRef<Set<string>>(new Set());

  useEffect(() => {
    const handleLanguageChanged = (lng: string) => {
      setLanguage(lng);
      // Remember the choice. This is the single choke point every switch runs
      // through — i18next fires `languageChanged` for the context's
      // `changeLanguage` and for a direct `i18n.changeLanguage()` alike — so no
      // switcher can be wired in a way that silently forgets the preference.
      // Bootstrap does NOT fire this event, so restoring a stored language
      // never re-writes it.
      if (persistLanguage) writeStoredLanguage(lng);
      // Update document direction for RTL support
      if (typeof document !== 'undefined') {
        document.documentElement.dir = getDirection(lng);
        document.documentElement.lang = lng;
      }
    };

    // Apply the initial language to <html> immediately. i18next does NOT
    // fire `languageChanged` for the bootstrap language, so without this
    // call `document.documentElement.lang` would stay at its server-rendered
    // default ('en') even though the app is rendering in another locale.
    // Downstream renderers (e.g. `@object-ui/components` containers.tsx)
    // rely on the <html lang=…> attribute to pick the right translation
    // dictionary.
    const initialLang = i18nInstance.language || language;
    if (typeof document !== 'undefined' && initialLang) {
      document.documentElement.dir = getDirection(initialLang);
      document.documentElement.lang = initialLang;
    }

    i18nInstance.on('languageChanged', handleLanguageChanged);
    return () => {
      i18nInstance.off('languageChanged', handleLanguageChanged);
    };
  }, [i18nInstance, persistLanguage]);

  // Fetch the BUILT-IN catalogue for whatever language this instance booted
  // into (objectui#7479). A host that awaited `preloadBootstrapLocale` finds it
  // already resident and this resolves without a network round-trip; a host
  // that did not gets the documented `en`-while-loading render and this is what
  // ends it.
  //
  // ⛔ `overwrite: false` on the merge, unlike the app-specific bundle below.
  // `createI18n` has already deep-merged `config.resources` over an EMPTY
  // built-in bundle, so overwriting here would let a catalogue that arrives
  // late silently undo the caller's own overrides — a precedence inversion
  // whose only symptom is that it depends on network timing.
  //
  // The write is what re-renders anything already on screen in the `en`
  // fallback ({@link STORE_WRITES_RERENDER}); ⛔ never a `setLanguage` here,
  // which would set the state this effect was keyed on and bail out
  // (objectui#10382). And ⛔ never an unconditional write: this effect re-runs
  // on every language change, and after a switch through `changeLanguage`
  // (which already merged the catalogue), or for a catalogue that was resident
  // when the instance was created, the write would add nothing and still
  // re-render every reader.
  useEffect(() => {
    const currentLang = i18nInstance.language || 'en';
    if (!isBuiltInLanguage(currentLang)) return;
    let cancelled = false;
    void loadBuiltInLocale(currentLang)
      .then((catalogue) => {
        if (cancelled || !catalogue) return;
        const bundle: unknown = i18nInstance.getResourceBundle(currentLang, 'translation');
        if (isNested(bundle)) {
          if (!mergeAddsKeys(bundle, catalogue)) return;
          i18nInstance.addResourceBundle(currentLang, 'translation', catalogue, true, false);
        } else {
          i18nInstance.addResourceBundle(currentLang, 'translation', catalogue);
        }
      })
      .catch((err) => {
        console.warn(`[i18n] Failed to load the built-in catalogue for '${currentLang}':`, err);
      });
    return () => {
      cancelled = true;
    };
  }, [i18nInstance, language]);

  // Load app-specific translations for the initial language on mount
  useEffect(() => {
    if (!loadLanguage) return;
    const currentLang = i18nInstance.language || 'en';
    if (loadedAppLangs.current.has(currentLang)) return;
    loadedAppLangs.current.add(currentLang);
    loadLanguage(currentLang).then((resources) => {
      if (resources && Object.keys(resources).length > 0) {
        // The write itself re-renders every reader already on screen
        // ({@link STORE_WRITES_RERENDER}). ⛔ No `setLanguage(currentLang)`
        // after it (objectui#10382): on the first load that sets the state to
        // the value it already holds, which React bails out of; and when the
        // user switched while this was in flight, it set the context back to
        // the boot language while i18next stayed on the new one.
        i18nInstance.addResourceBundle(currentLang, 'translation', resources, true, true);
      }
    }).catch((err) => {
      // Allow retry on failure by removing from loaded set
      loadedAppLangs.current.delete(currentLang);
      console.warn(`[i18n] Failed to load app translations for '${currentLang}':`, err);
    });
  }, [i18nInstance, loadLanguage]);

  // The app's own locale list (objectui#4039). `null` = not answered yet; `[]`
  // = asked and got nothing usable, which is "I don't know", not "I ship no
  // locales" — both degrade to the offline fallback below.
  const [appLocales, setAppLocales] = useState<string[] | null>(null);

  // Asked exactly once per provider, guarded by a ref — the same shape as the
  // `loadedAppLangs` guard on `loadLanguage` above, and for two reasons at
  // once. An inline `loadLocales={() => …}` changes identity every render, so
  // without the guard the answer would set state, the re-render would mint a
  // new arrow, and the new arrow would re-run the effect: a fetch loop. And
  // StrictMode's double-invoked effect must not fire a second request.
  //
  // Deliberately no `cancelled` flag: under StrictMode the cleanup would
  // cancel the only in-flight request while the re-run declines to start
  // another, leaving the list permanently unanswered and the switcher
  // permanently blank. Settling state after unmount is a no-op in React 18 —
  // which is exactly why the `loadLanguage` effect above does the same.
  const hasLocaleLoader = Boolean(loadLocales);
  const askedForLocales = useRef(false);

  useEffect(() => {
    if (!loadLocales || askedForLocales.current) return;
    askedForLocales.current = true;
    loadLocales()
      .then((codes) => setAppLocales(Array.isArray(codes) ? codes : []))
      .catch((err) => {
        // A language menu is not worth an unhandled rejection: fall back to the
        // locales this renderer can produce on its own.
        setAppLocales([]);
        console.warn('[i18n] Failed to load the app locale list:', err);
      });
  }, [loadLocales]);

  const offerableLanguages = useMemo<readonly string[] | null>(() => {
    const fallback = resolvableLanguages(config);
    // No wiring at all: the built-in packs are the whole truth, as before.
    if (!hasLocaleLoader) return fallback;
    if (appLocales === null) return null;
    const offerable = appLocales.filter((code) => canResolveLanguage(code, config, hasLoader));
    // An app that answers with nothing this renderer can produce leaves the
    // user with no way to switch at all — strictly worse than the offline
    // fallback, so the fallback wins.
    return offerable.length > 0 ? offerable : fallback;
  }, [config, hasLocaleLoader, appLocales, hasLoader]);

  // Self-heal: a stored language accepted on the loader's credit alone is
  // adjudicated by the app's real list once it lands. Without this, widening
  // the restore validation would reintroduce exactly what it was written to
  // stop — one stale entry locking the UI to a locale with no translations.
  // Scoped to our own optimism: only the bootstrap language, only while the
  // user has not moved on, and never on an empty/failed answer.
  useEffect(() => {
    const provisional = bootstrap.provisional;
    if (!provisional || !appLocales || appLocales.length === 0) return;
    if (appLocales.includes(provisional)) return;
    if ((i18nInstance.language || '') !== provisional) return;
    const revertTo = config?.defaultLanguage || config?.fallbackLanguage || 'en';
    void (async () => {
      await i18nInstance.changeLanguage(revertTo);
      // Purge AFTER the switch, not before: every language change persists
      // itself (that is the point of the single choke point in the
      // `languageChanged` handler), so clearing first would just be overwritten
      // with `revertTo` — recording a preference the user never expressed and
      // suppressing browser detection from then on. Ending with nothing stored
      // is what the bootstrap purge has always left behind.
      // Guarded: if the user picked something in the meantime, that choice is
      // theirs to keep.
      if ((i18nInstance.language || '') === revertTo) clearStoredLanguage();
    })();
  }, [bootstrap, appLocales, i18nInstance, config]);

  const contextValue = useMemo<I18nContextValue>(
    () => ({
      language,
      changeLanguage: async (lang: string) => {
        // The built-in catalogue first (objectui#7479): a switch to a language
        // whose pack has never been fetched must RESOLVE it, not render the
        // `en` fallback and hope the mount effect catches up. Awaited before
        // `changeLanguage` so the switch and the strings land on the same
        // frame — the whole point of doing it here rather than reactively.
        //
        // Both writes below are SILENT. The `changeLanguage` that follows emits
        // `languageChanged` — i18next emits it for every language it resolves,
        // the current one included (measured in `i18next@26.4.0`,
        // `changeLanguage`) — and that re-renders every reader once, in the
        // new language. An `added` event here would re-render each of them in
        // the OLD language first ({@link STORE_WRITES_RERENDER}).
        const builtIn = await loadBuiltInLocale(lang).catch((err) => {
          console.warn(`[i18n] Failed to load the built-in catalogue for '${lang}':`, err);
          return null;
        });
        if (builtIn) {
          if (i18nInstance.hasResourceBundle(lang, 'translation')) {
            i18nInstance.addResourceBundle(lang, 'translation', builtIn, true, false, SILENT_WRITE);
          } else {
            i18nInstance.addResourceBundle(lang, 'translation', builtIn, false, false, SILENT_WRITE);
          }
        }
        // Dynamic language pack loading (v2.0.7)
        if (loadLanguage && !loadedAppLangs.current.has(lang)) {
          loadedAppLangs.current.add(lang);
          try {
            const resources = await loadLanguage(lang);
            i18nInstance.addResourceBundle(lang, 'translation', resources, true, true, SILENT_WRITE);
          } catch (err) {
            loadedAppLangs.current.delete(lang);
            console.warn(`[i18n] Failed to load app translations for '${lang}':`, err);
          }
        }
        await i18nInstance.changeLanguage(lang);
      },
      direction,
      i18n: i18nInstance,
      offerableLanguages,
    }),
    [language, direction, i18nInstance, loadLanguage, offerableLanguages],
  );

  return React.createElement(
    ObjectI18nContext.Provider,
    { value: contextValue },
    React.createElement(I18nextProvider, { i18n: i18nInstance }, children),
  );
}

/**
 * Hook to access Object UI i18n context
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { t, language, changeLanguage, direction } = useObjectTranslation();
 *   return <div dir={direction}>{t('common.save')}</div>;
 * }
 * ```
 */
export function useObjectTranslation(ns?: string) {
  const context = useContext(ObjectI18nContext);
  // Subscribed to store writes as well as language changes, so translations
  // added after this reader rendered reach it (objectui#10382).
  const { t: boundT, i18n } = useTranslation(ns, STORE_WRITES_RERENDER);

  // Whether react-i18next found an i18next instance at all — from props,
  // from an `I18nextProvider` above, or from the module-level global that
  // `createI18n` installs via `initReactI18next`.
  //
  // Read off the returned instance rather than the `ready` flag, and that is
  // the load-bearing part. `useTranslation` returns `i18n || {}`, so a plain
  // object with no `t` is exactly and only the no-instance case; `ready` is
  // ALSO false for a real instance whose namespace is still loading, and there
  // `t` is i18next's own `getFixedT` result, which interpolates already.
  // Keying on `ready` would run a second interpolation pass over a string
  // i18next had already filled — measured in
  // `react-i18next@17.0.11/dist/es/useTranslation.js`, where `getSnapshot`
  // returns `notReadySnapshot` under `if (!i18n)` and nothing else.
  const hasInstance = typeof (i18n as { t?: unknown } | undefined)?.t === 'function';

  // objectui#6219. With no instance, react-i18next hands back `notReadyT`,
  // which returns `options.defaultValue` **verbatim**: an inline default
  // written `'Deleted {{count}} rows'` reached the user with the braces intact
  // on every host that embeds an ObjectUI component without `I18nProvider` —
  // the configuration `createSafeTranslation` exists for (objectui#3865), so a
  // supported one rather than a hypothetical.
  //
  // This is the ONE seam: 68 inline defaults across 24 files were rendering
  // through it, and every one of them is fixed here instead of at the call
  // sites. It is deliberately NOT a rewrite of those call sites — at a bare
  // `useObjectTranslation()` the pre-interpolated template literal
  // (`` `Deleted ${n} rows` ``) is the CORRECT spelling and stays correct
  // (there is no hole left to fill), so both shapes now render right and
  // neither is residue. objectui#4905 specified the opposite rewrite and it
  // would have introduced this defect at 29 more sites.
  //
  // Scope, stated as narrowly as it is implemented: this widens WHICH BINDINGS
  // interpolate on the provider-less path. It does not widen WHICH SPELLINGS
  // resolve — that fork is objectui#3512's, which ruled deliberately against
  // teaching the fallback i18next's other three dialects, and this change
  // keeps that ruling by routing through the same one interpolator
  // (`fallbackInterpolation.ts`) that `createSafeTranslation`'s `fallbackT`
  // uses. With an instance present, `boundT` is returned untouched: i18next
  // does its own interpolation and must never be double-processed.
  const t = useMemo(() => {
    if (hasInstance) return boundT;
    const interpolating = (...args: unknown[]) => {
      const rendered = (boundT as unknown as (...a: unknown[]) => unknown)(...args);
      // `notReadyT` can also answer with a key array's last member or `''` for
      // a function key. Only a string can carry a hole; anything else is
      // handed back exactly as react-i18next produced it.
      if (typeof rendered !== 'string') return rendered;
      return interpolateFallback(rendered, optionsOf(args));
    };
    // The cast restores react-i18next's `TFunction` overloads for the ~700
    // call sites that destructure `t` — the wrapper is argument-transparent by
    // construction (it forwards `...args` untouched), so the declared type
    // still describes it.
    return interpolating as unknown as typeof boundT;
    // `notReadyT` is a module constant in react-i18next, so on this path
    // `boundT` is referentially stable and so is the wrapper — which matters,
    // because call sites put `t` in `useMemo`/`useCallback` dependency arrays.
  }, [boundT, hasInstance]);

  return {
    /** Translation function */
    t,
    /** Current language code */
    language: context?.language || i18n.language || 'en',
    /** Change the active language */
    changeLanguage: context?.changeLanguage || (async (lang: string) => { await i18n.changeLanguage(lang); }),
    /** Current text direction */
    direction: context?.direction || 'ltr',
    /** The underlying i18next instance */
    i18n,
    /**
     * Languages a switcher may offer (objectui#4039). `null` while the app's
     * locale list is in flight. Outside a provider there is nobody to ask, so
     * the built-in packs are the answer — not `null`, which would leave a
     * standalone switcher permanently blank.
     */
    offerableLanguages: context ? context.offerableLanguages : BUILT_IN_LANGUAGE_CODES,
  };
}

/**
 * Hook to access the i18n context directly
 */
export function useI18nContext(): I18nContextValue {
  const context = useContext(ObjectI18nContext);
  if (!context) {
    throw new Error('useI18nContext must be used within an I18nProvider');
  }
  return context;
}
