/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * useUserLocale — one source of truth for a signed-in user's language
 * (objectui#10059, executing ruling batch #193 item 5 letter C on
 * objectui#10051).
 *
 * ## What was wrong
 *
 * One word 「语言」 named two settings. The profile page's language card writes
 * the server column `sys_user.locale` (the column objectstack#14787 made
 * writable, first written by objectui#7501); the globe menu switched a
 * device-local UI language held in `@object-ui/i18n`'s `localStorage` slot.
 * Neither writer could see the other, so a user who set 日本語 on their profile
 * kept reading an English console and nothing said why.
 *
 * ## What decides now, and why the divergence cannot come back
 *
 * For a signed-in user `sys_user.locale` is the ONLY decider, and that is a
 * property of the wiring rather than of anyone's discipline:
 *
 *   - **One writer path.** Both controls write the same column through the same
 *     adapter — the profile card already did, and {@link useLanguageSelection}
 *     now makes the globe do it too. There is no second place to write.
 *   - **One reader, on the invalidation bus.** {@link useSignedInUserLocale} is
 *     mounted once in the console shell. It reads the column on mount and again
 *     on every `sys_user` mutation the data-invalidation bus reports — which
 *     includes the profile card's own save, because every adapter write reaches
 *     that bus through `useMutationInvalidationBridge`. So changing the
 *     language in either place changes it in both, in the same session, with no
 *     reload.
 *   - **The device slot is demoted to a cache, not removed and not ignored.**
 *     `@object-ui/i18n` still persists the active language per device, and that
 *     value still decides before sign-in and for the first paint of a boot. It
 *     can no longer outlive a signed-in read: the reader above overwrites it
 *     with the column on every mount. A stale device value therefore has a
 *     bounded life (one row read), never a session and never a device.
 *
 * ⚠️ The residue this does NOT close, stated rather than left to be discovered:
 * the first paint of a boot renders from the device cache, because the column
 * can only be read after the adapter exists. A value changed on another device
 * shows for the length of one round trip and is then replaced. That is the same
 * stale-while-revalidate posture the locale seed already ships with, and it is
 * the reason the cache is kept rather than cleared.
 *
 * ## Change of owner (objectui#10193)
 *
 * The device cache above belongs to whoever last signed in on this browser.
 * When the session resolves to someone ELSE, `@object-ui/auth` purges it and
 * {@link useSignedInUserLocale} re-resolves the live language before the new
 * owner's column applies — see `useLanguageResetOnOwnerChange` below. Without
 * that, a new owner with no column of their own kept the previous owner's
 * language for the whole session.
 *
 * ## Signed out
 *
 * With no `sys_user` row there is nothing to read and nothing to write.
 * {@link useLanguageSelection} performs the local switch, and it remembers the
 * pick for this page-load only, so that the purge above does not take it from
 * the person who signs in next (objectstack#30338, see
 * {@link keepSignedOutPickThroughOwnerChange}). The sign-in page then saves it
 * as that person's own language when they have none, before it navigates
 * away (objectstack#30399, see {@link saveSignInLanguagePick}).
 *
 * @module
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import {
  useAuth,
  createAuthenticatedFetch,
  getSessionOwnerChangeCount,
  subscribeSessionOwnerChange,
} from '@object-ui/auth';
import {
  LOCALE_STORAGE_KEY,
  readStoredLanguage,
  resolveBootstrapLanguage,
  resolveBuiltInLanguage,
  useObjectTranslation,
} from '@object-ui/i18n';
import { useAdapter, useDataInvalidation, extractWriteErrorMessage } from '@object-ui/react';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { useAfterFirstPaint } from './sharedUserFeeds.js';

/**
 * Owner changes whose language residue this page-load has already re-resolved
 * (objectui#10193). Module scope, because the question is per page-load, not
 * per mount: the shell can remount, and a remount must not undo a language the
 * user has switched to since by resetting it a second time.
 */
let ownerChangesHandled = 0;

/**
 * The language picked while signed out in THIS page-load and not yet handed to
 * whoever signs in next, or `null` (objectstack#30338).
 */
let signedOutPick: string | null = null;
let signedOutPickKeeperInstalled = false;

/**
 * The same pick, held for {@link saveSignInLanguagePick} rather than for the
 * owner-change keeper (objectstack#30399). Kept apart because the keeper spends
 * its copy on the owner-change event, which fires before the sign-in page's
 * post-login step reads this one, and fires not at all when the browser's last
 * owner signs in again.
 */
let signInPickToSave: string | null = null;

/**
 * Keep a language picked on the sign-in page through the purge that follows a
 * sign-in by someone other than the browser's last owner (objectstack#30338).
 *
 * ## The drop this closes
 *
 * The sign-in page's language menu writes the pick to the device slot
 * ({@link LOCALE_STORAGE_KEY}) like every switch. When the person who then
 * signs in is not the one the browser last held, `SessionUserScope.adopt`
 * sweeps that slot with the rest of the previous owner's state
 * (objectui#5664), and the sign-in page then leaves by a full navigation. The
 * next page-load boots with no choice stored, so the person lands in the
 * browser's language, not the one they just picked. The reset in
 * {@link useLanguageResetOnOwnerChange} is not on that path: the shell is not
 * mounted on the sign-in page.
 *
 * ## Why this keeps objectui#10193 ruling B
 *
 * The purge removes what the PREVIOUS owner left, and still does. A language
 * picked after they signed out is not that, and the two can be told apart
 * without a stored marker: the pick and the purge happen in the same
 * page-load, so the pick is known here, in memory. The owner-change event
 * fires after the sweep, and this puts the pick back into the same slot,
 * where the next boot reads it as it reads any choice.
 *
 * ⚠️ The bound, stated: memory lasts one page-load. A pick followed by a reload
 * of the sign-in page, or a sign-in that leaves the page first (an identity
 * provider's redirect), is still swept.
 *
 * Installed once, on the first signed-out pick, at module scope: the sign-in
 * page's menu unmounts in the same commit that sets the user, before
 * `AuthProvider`'s effect calls `adopt`, so a listener owned by a component
 * would be gone when the event fires.
 */
function keepSignedOutPickThroughOwnerChange(code: string): void {
  signedOutPick = code;
  signInPickToSave = code;
  if (signedOutPickKeeperInstalled) return;
  signedOutPickKeeperInstalled = true;
  subscribeSessionOwnerChange(() => {
    const pick = signedOutPick;
    signedOutPick = null;
    if (!pick) return;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, pick);
    } catch {
      // Storage blocked — the live language still holds the pick for this
      // page-load; nothing more can be kept.
    }
  });
}

/**
 * The pick has reached a signed-in person, or a signed-in choice replaced it:
 * either way it must not reach the NEXT owner change, which belongs to
 * someone else.
 */
function forgetSignedOutPick(): void {
  signedOutPick = null;
  signInPickToSave = null;
}

/** Test seam: forget this page-load's signed-out pick. Not public. */
export function __resetSignedOutPickForTests(): void {
  signedOutPick = null;
  signInPickToSave = null;
}

/**
 * Whether a language was picked while signed out in this page-load and has not
 * been saved for anyone yet (objectstack#30399) — the question the sign-in page
 * asks before it navigates away, so a sign-in with no pick leaves at once.
 */
export function hasSignInLanguagePick(): boolean {
  return signInPickToSave !== null;
}

/** The two calls {@link saveSignInLanguagePick} makes on the `sys_user` row. */
export interface SignInLanguagePickWriter {
  findOne: (resource: string, id: string) => Promise<unknown>;
  update: (resource: string, id: string, data: Record<string, unknown>) => Promise<unknown>;
}

/**
 * The data door the console's own adapter uses (`AdapterProvider`), built for
 * one save: the sign-in page renders outside `ConnectedShell`, so no adapter is
 * in context there.
 */
function createSignInPickWriter(): SignInLanguagePickWriter {
  return new ObjectStackAdapter({
    baseUrl: import.meta.env.VITE_SERVER_URL || '',
    fetch: createAuthenticatedFetch(),
  });
}

/**
 * Save the language picked on the sign-in page as the signed-in person's own
 * language, when they have none (objectstack#30399, the saved half of
 * objectstack#30338).
 *
 * ## Why the sign-in page calls this, and awaits it
 *
 * The knowledge that the pick was made on the sign-in page is memory, and it
 * dies at the full navigation the page leaves by. On the next page-load an
 * unset `sys_user.locale` beside a set device slot says nothing: the profile
 * card's "use deployment default" writes exactly that. So the save happens in
 * the sign-in page-load, and the page awaits it before navigating — a write
 * sent beside the navigation races the unload.
 *
 * ## What it writes
 *
 * Only the pick, only through the column's one write door
 * (`update('sys_user', id, { locale })`, the same call
 * {@link useLanguageSelection} makes), and only when the row's column is unset:
 * a language the person already chose is theirs and is not replaced. No pick in
 * this page-load ⇒ no request at all. The pick is spent by the first call, so
 * it reaches one person.
 *
 * Never rejects. A read or write that fails leaves the pick on this device
 * only (the slot still holds it, so the next page-load renders it), says so
 * once at `error`, and lets the sign-in proceed.
 */
export async function saveSignInLanguagePick(
  userId: string,
  writer: SignInLanguagePickWriter = createSignInPickWriter(),
): Promise<void> {
  const pick = signInPickToSave;
  signInPickToSave = null;
  if (!pick || !userId) return;
  try {
    const row = await writer.findOne(USER_OBJECT, userId);
    const raw = (row as { locale?: unknown } | null)?.locale;
    if (typeof raw === 'string' && raw.length > 0) return;
    await writer.update(USER_OBJECT, userId, { [LOCALE_FIELD]: pick });
  } catch (err) {
    console.error(
      '[app-shell] The language picked on the sign-in page was not saved to `sys_user.locale`: ' +
        'it applies on this device only. Pick it again from the language menu once signed in to save it.',
      err,
    );
  }
}

/**
 * Serialises every language switch this module makes, so they land in the
 * order they were decided. The owner-change reset and the column apply are
 * both asynchronous (a switch awaits its catalogue), and without an order a
 * reset decided FIRST could land LAST and put the browser language back over
 * the new owner's own column.
 */
interface SwitchQueue {
  /** Run `task` after every switch queued before it has settled. */
  enqueue: (task: () => Promise<void>) => void;
  /**
   * `true` while an owner-change reset is queued or running. A switch decided
   * in that window cannot compare against the current language, because the
   * current language is still the previous owner's and is about to move.
   */
  resetPending: { current: boolean };
}

function useSwitchQueue(): SwitchQueue {
  const tail = useRef<Promise<void>>(Promise.resolve());
  const resetPending = useRef(false);
  const enqueue = useCallback((task: () => Promise<void>) => {
    tail.current = tail.current.then(task).catch((err) => {
      console.warn('[app-shell] A language switch failed:', err);
    });
  }, []);
  return { enqueue, resetPending };
}

/**
 * Re-resolve the UI language when this browser changes hands (objectui#10193,
 * ruling B).
 *
 * ## The leak this closes
 *
 * A boot resolves its language BEFORE anyone is signed in, out of two device
 * slots: the explicit choice (`LOCALE_STORAGE_KEY`, since objectui#10059 a
 * cache of the signed-in user's `sys_user.locale`) and the seed
 * (`LOCALE_SEED_STORAGE_KEY`, the server's resolved locale for the last
 * caller). Both hold the PREVIOUS owner's language on a browser that changed
 * hands. When the session then resolves to someone else,
 * `@object-ui/auth`'s `SessionUserScope.adopt` purges those slots
 * (objectui#5664) — but the live i18next language was already derived from
 * them and is memory, not storage. Nothing re-derived it, and for a new owner
 * with no column of their own {@link useSignedInUserLocale} applies nothing,
 * so they read the previous owner's language for the whole session. A boot
 * whose cookie session already belongs to the new owner (an SSO redirect, a
 * sign-in in another window) is exactly that boot.
 *
 * ## What this does
 *
 * On each owner change it re-resolves the language exactly as a boot of the
 * swept storage would ({@link resolveBootstrapLanguage}: now no explicit
 * choice and no seed, so the browser language, then `en`) and switches to it.
 * The switch persists itself through the provider's `languageChanged` choke
 * point like every switch does, so the explicit slot is cleared again right
 * after — the reset is not a choice anyone made, and leaving it stored would
 * outrank the new owner's own seed on every boot from then on. The column, if
 * the new owner has one, then applies as it always has: the read below is
 * re-run for the owner change, and its apply is queued behind this reset.
 *
 * ⚠️ The resolution cannot see the host's `I18nProvider` `config`; it resolves
 * as a host passing none does, which is what the console passes.
 *
 * Returns the owner-change count, so the column read can key on it.
 */
function useLanguageResetOnOwnerChange({ enqueue, resetPending }: SwitchQueue): number {
  const ownerChanges = useSyncExternalStore(
    subscribeSessionOwnerChange,
    getSessionOwnerChangeCount,
    getSessionOwnerChangeCount,
  );
  const { i18n, changeLanguage } = useObjectTranslation();
  // Refs, not dependencies — both are rebuilt by a language change
  // (AGENTS.md #5 #10), and this must run on an owner change only.
  const changeLanguageRef = useRef(changeLanguage);
  changeLanguageRef.current = changeLanguage;
  const i18nRef = useRef(i18n);
  i18nRef.current = i18n;

  useEffect(() => {
    if (ownerChanges <= ownerChangesHandled) return;
    ownerChangesHandled = ownerChanges;
    resetPending.current = true;
    enqueue(async () => {
      try {
        const target = resolveBootstrapLanguage();
        if ((i18nRef.current.language || '') === target) return;
        await changeLanguageRef.current(target);
        if ((i18nRef.current.language || '') !== target) return;
        if (readStoredLanguage() !== target) return;
        try {
          window.localStorage.removeItem(LOCALE_STORAGE_KEY);
        } catch {
          // Storage blocked — nothing was persisted either.
        }
      } finally {
        resetPending.current = false;
      }
    });
  }, [ownerChanges, enqueue, resetPending]);

  return ownerChanges;
}

/** The object and column the ruling names as the single source of truth. */
const USER_OBJECT = 'sys_user';
const LOCALE_FIELD = 'locale';

/**
 * The language to actually render for a stored tag, or `null` for "not now".
 *
 * `offerable` is the i18n provider's own answer (the deployment's published
 * locales ∩ what this renderer can resolve) — the same list the globe menu and
 * the profile card render, deliberately not a second opinion about what ships.
 *
 * The match order is the server's `resolveLocale` (`packages/core`
 * `fallbacks/memory-i18n.ts`), the one the platform's i18n routes already
 * resolve a requested locale with, so the console and the server agree on
 * which language a stored tag means:
 *
 *   1. exact tag (`pt-BR` → `pt-BR`; a real `pt-BR` still beats `pt`);
 *   2. the same tag in any case (`zh-cn` → `zh-CN`) — a row written before the
 *      server door folded case is served as stored, never migrated;
 *   3. the first offered code the platform locale table reads as the same
 *      language (`zh-TW` → `zh-Hant`, `zh-HK` → `zh-TW`, `zh` → `zh-CN`,
 *      `pt` → `pt-BR`; objectstack#30511). The table's read aliases are how a
 *      row stored before the table keeps its meaning, and the one step the
 *      server's order lacks: without it a base-language match hands a
 *      Traditional row (`zh-TW`) the first `zh` variant offered, which is the
 *      Simplified pack;
 *   4. the base language (`zh-CN` → `zh`, `en-GB` → `en`), case-insensitively;
 *   5. the first offered variant of that base language (`es` → `es-MX`,
 *      `zh-Hans-CN` → `zh-CN`), in the order the list offers them.
 *
 * A match answers the OFFERED spelling, never the stored one: the list is what
 * the provider can switch to.
 *
 * `null` while the list is still in flight (`offerable === null`), and `null`
 * for a tag nothing can render: switching to a locale this renderer cannot
 * produce would paint the `en` fallback and call it the user's language.
 */
export function pickRenderableLocale(
  tag: string,
  offerable: readonly string[] | null,
): string | null {
  if (!offerable || offerable.length === 0) return null;
  // 1. Exact.
  if (offerable.includes(tag)) return tag;
  // 2. Case-insensitive.
  const lower = tag.toLowerCase();
  const caseMatch = offerable.find((code) => code.toLowerCase() === lower);
  if (caseMatch) return caseMatch;
  // 3. The same language, as the platform locale table reads both tags.
  const pack = resolveBuiltInLanguage(tag);
  if (pack !== null) {
    const sameLanguage = offerable.find((code) => resolveBuiltInLanguage(code) === pack);
    if (sameLanguage) return sameLanguage;
  }
  // 4. Base language.
  const base = lower.split('-')[0];
  if (!base) return null;
  const baseMatch = offerable.find((code) => code.toLowerCase() === base);
  if (baseMatch) return baseMatch;
  // 5. Variant of the base language — first offered wins.
  const variantMatch = offerable.find((code) => code.split('-')[0].toLowerCase() === base);
  return variantMatch ?? null;
}

/**
 * Apply the signed-in user's `sys_user.locale` to the UI language, and keep
 * applying it for as long as the session lasts.
 *
 * Mount ONCE, in the shell (the console does it in `AppContent`, beside the
 * mutation-invalidation bridge it depends on). Mounting it twice would only
 * duplicate a read, never contradict one — but there is no reason to.
 *
 * A column that is unset says nothing about this user, so nothing is applied
 * and the device value keeps deciding; the first switch through
 * {@link useLanguageSelection} sets the column and ends that state for good. A
 * failed read leaves the cache standing, which is what a cache is for.
 *
 * ## Read after the first paint (objectui#12980)
 *
 * The first paint renders from the device cache whatever this read does (see
 * the module header), so the read waits for that paint rather than going out
 * beside the page's own reads. It is still a read of its own, beside
 * `GET /auth/me/localization`, and that is deliberate: that endpoint answers
 * `locale` as the column when set, else the request's `Accept-Language`, else
 * the deployment default, and says not which. This hook must tell "the column
 * is unset" (apply nothing, the device keeps deciding) from "the column says
 * X", and only the row says that.
 */
export function useSignedInUserLocale(): void {
  const { user } = useAuth();
  const adapter = useAdapter();
  const { i18n, changeLanguage, offerableLanguages } = useObjectTranslation();
  const queue = useSwitchQueue();
  const { enqueue, resetPending } = queue;
  // Runs first: an owner change resets the previous owner's language, and the
  // read below re-runs for it so the new owner's column lands after the reset.
  const ownerChanges = useLanguageResetOnOwnerChange(queue);

  const userId = user?.id ? String(user.id) : null;
  // Every adapter write reaches this bus, so the profile card's save re-runs
  // the read below without the profile card knowing this hook exists.
  const invalidationNonce = useDataInvalidation(USER_OBJECT, userId ?? undefined);

  // Every SUCCESSFUL read, not every distinct value: the apply below must run
  // again even when the column answers what it answered last time, because
  // "the local switch stands until the next successful read" is the ruling's
  // wording for a write that failed. A fresh object per read is what carries
  // that (a bare string would be deduplicated by React and the column would
  // never re-assert itself).
  const [read, setRead] = useState<{ seq: number; column: string | null }>({
    seq: 0,
    column: null,
  });

  const painted = useAfterFirstPaint();

  useEffect(() => {
    if (!painted || !adapter || !userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const row = await adapter.findOne(USER_OBJECT, userId);
        if (cancelled) return;
        const raw = (row as { locale?: unknown } | null)?.locale;
        const column = typeof raw === 'string' && raw.length > 0 ? raw : null;
        // This person's session is established and read: a sign-in-page pick
        // still held has reached them, and must not reach whoever is next.
        forgetSignedOutPick();
        setRead((prev) => ({ seq: prev.seq + 1, column }));
      } catch (err) {
        // Cosmetic and never fail-closed, the same posture the rest of the
        // localization path takes: a deployment that does not expose `sys_user`
        // to this caller, and one that refuses the read, both land here, and
        // both leave the cached device language rendering. The warning is the
        // diagnosable half.
        console.warn('[app-shell] Could not read your language from `sys_user.locale`:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [painted, adapter, userId, invalidationNonce, ownerChanges]);

  // ⛔ Keyed on the READ and on a primitive, never on the identity of the
  // context's memoised `changeLanguage` nor on the active `language`
  // (AGENTS.md #5 #10). Both are rebuilt by a language change, so either in the
  // dependency list would make this effect fire on every switch and put the
  // last-read column straight back — turning a user's switch into a flicker
  // for as long as the write took, and undoing it entirely when the write
  // failed.
  const changeLanguageRef = useRef(changeLanguage);
  changeLanguageRef.current = changeLanguage;
  // The instance, read at the moment the queued switch runs: a reset queued
  // ahead of this apply may have moved the language since it was decided.
  const i18nRef = useRef(i18n);
  i18nRef.current = i18n;
  // A primitive stand-in for the list: a comma cannot occur in a BCP-47 tag,
  // so this changes exactly when the list's contents change.
  const offerableKey = offerableLanguages ? offerableLanguages.join(',') : null;

  useEffect(() => {
    if (!read.column) return;
    const offerable = offerableKey === null ? null : offerableKey.split(',');
    const resolved = pickRenderableLocale(read.column, offerable);
    if (!resolved) return;
    // Decided NOW, against the language as it stands now — a switch the user
    // makes after this read must not be undone by it ("the local switch stands
    // until the next successful read"). The one exception is a pending
    // owner-change reset: the language standing now is the previous owner's
    // and is about to be replaced, so the column must be applied after it even
    // when the two happen to agree.
    if (!resetPending.current && (i18nRef.current.language || '') === resolved) return;
    enqueue(async () => {
      if ((i18nRef.current.language || '') === resolved) return;
      await changeLanguageRef.current(resolved);
    });
  }, [read, offerableKey, enqueue, resetPending]);
}

/**
 * Switch the UI language the way the ruling says a signed-in switch works: the
 * server column first-class, the device value as its cache.
 *
 * Returns the handler the globe menu calls instead of the i18n context's bare
 * `changeLanguage`.
 *
 * Order matters and is deliberate. The local switch happens FIRST, so the menu
 * answers the click at once and so the switch survives a write that fails —
 * "the local switch stands until the next successful read", which the ruling
 * requires and which {@link useSignedInUserLocale} then enforces. A failed
 * write is reported LOUDLY, because a language that silently fails to persist
 * is the divergence this card exists to end, one layer down.
 *
 * Signed out (or with no adapter): the local switch is the whole operation, no
 * request is attempted and nothing is reported. Signed out, the pick is also
 * remembered for this page-load, so that a sign-in by someone other than the
 * browser's last owner keeps it ({@link keepSignedOutPickThroughOwnerChange}).
 */
export function useLanguageSelection(): (code: string) => Promise<void> {
  const { user } = useAuth();
  const adapter = useAdapter();
  const { t, changeLanguage } = useObjectTranslation();

  const userId = user?.id ? String(user.id) : null;

  // Same reason as above: both of these are rebuilt on a language change, and
  // the callback must not be either (AGENTS.md #5 #10).
  const changeLanguageRef = useRef(changeLanguage);
  changeLanguageRef.current = changeLanguage;
  const tRef = useRef(t);
  tRef.current = t;

  return useCallback(
    async (code: string) => {
      await changeLanguageRef.current(code);
      if (!userId) {
        keepSignedOutPickThroughOwnerChange(code);
        return;
      }
      forgetSignedOutPick();
      if (!adapter) return;
      try {
        await adapter.update(USER_OBJECT, userId, { [LOCALE_FIELD]: code });
      } catch (err) {
        const reason =
          extractWriteErrorMessage(err) ?? (err instanceof Error ? err.message : String(err));
        toast.error(tRef.current('form.saveError', { defaultValue: 'Failed to save' }), {
          description: reason,
        });
        console.warn('[app-shell] Could not save your language to `sys_user.locale`:', err);
      }
    },
    [adapter, userId],
  );
}
