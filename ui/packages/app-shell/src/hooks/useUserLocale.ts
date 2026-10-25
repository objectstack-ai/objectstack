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
 * Nothing here applies: with no `sys_user` row there is nothing to read and
 * nothing to write. {@link useLanguageSelection} performs the local switch and
 * returns, so language selection for a visitor is exactly what it was.
 *
 * @module
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { useAuth, getSessionOwnerChangeCount, subscribeSessionOwnerChange } from '@object-ui/auth';
import {
  LOCALE_STORAGE_KEY,
  readStoredLanguage,
  resolveBootstrapLanguage,
  useObjectTranslation,
} from '@object-ui/i18n';
import { useAdapter, useDataInvalidation, extractWriteErrorMessage } from '@object-ui/react';
import { useAfterFirstPaint } from './sharedUserFeeds.js';

/**
 * Owner changes whose language residue this page-load has already re-resolved
 * (objectui#10193). Module scope, because the question is per page-load, not
 * per mount: the shell can remount, and a remount must not undo a language the
 * user has switched to since by resetting it a second time.
 */
let ownerChangesHandled = 0;

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
 * Exact tag first, then the base language: a column holding `zh-CN` must reach
 * the `zh` pack, while a real `pt-BR` pack still beats `pt`. That order is the
 * one `@object-ui/i18n` already documents for a seed and for `pickLocalized`,
 * so this is the existing convention rather than a new rule.
 *
 * `null` while the list is still in flight (`offerable === null`), and `null`
 * for a tag nothing can render: switching to a locale this renderer cannot
 * produce would paint the `en` fallback and call it the user's language.
 */
export function pickRenderableLocale(
  tag: string,
  offerable: readonly string[] | null,
): string | null {
  if (!offerable) return null;
  if (offerable.includes(tag)) return tag;
  const base = tag.split('-')[0];
  if (base && base !== tag && offerable.includes(base)) return base;
  return null;
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
 * request is attempted and nothing is reported.
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
      if (!adapter || !userId) return;
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
