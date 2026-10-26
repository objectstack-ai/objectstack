/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The CONSOLE server-action handler — `@object-ui/core`'s
 * `createServerActionHandler` (objectui#2904) wrapped with the browser-only
 * conventions the console layers on top of the dispatch:
 *
 * - the **popup-blocker pre-open dance** for `opensInNewTab` actions: open
 *   `about:blank` synchronously on click (preserving the user-gesture context
 *   across the awaited POST) and paint a spinner so the tab isn't blank during
 *   a slow SSO-handoff mint;
 * - the **zero-roundtrip `newTabUrl` fast path**: a GET endpoint that performs
 *   all auth/authz itself (e.g. cloud's `/sso-open`) is navigated to directly,
 *   skipping the POST;
 * - the **`redirectUrl` convention**: a handler returning `{ redirectUrl }`
 *   asks the UI to open it — into the pre-opened tab when there is one, else a
 *   lazily opened one with a popup-blocked toast fallback. A handler may add
 *   `openIn: 'self'` to ask for the same-tab jump instead (`053fdc8f9`);
 *   WITHOUT it the shipped new-tab behavior stands, so nothing flips silently.
 * - **deferring to a declared `ActionSchema.onSuccess` block**: when the action
 *   itself declares the post-success hop, the runner performs it and this
 *   wrapper only tidies the pre-opened tab — one navigation, not two.
 *
 * This file exists because `useConsoleActionRuntime` and `RecordDetailView`
 * each carried a near-verbatim copy of all of the above around their
 * hand-rolled POSTs, and the copies drifted (objectstack#3913 — envelope;
 * framework#3935 — action identity). The dispatch itself (name-only identity,
 * record-id resolution, re-entrancy guard, envelope rule) lives in core; only
 * the DOM/toast choreography belongs here.
 *
 * One deliberate delta from the old copies: the re-entrancy guard now lives
 * INSIDE the core dispatch, after the pre-open. A double-click on an
 * `opensInNewTab` action therefore pre-opens a second tab for one microtask
 * before the blocked dispatch closes it — the double POST it guards against is
 * still impossible.
 */

import { toast } from 'sonner';
import {
  createServerActionHandler,
  readActionPayload,
  readOnSuccessNavigation,
  resolveServerActionRecordId,
  type ActionContext,
  type ActionDef,
  type ServerActionFetch,
  type ServerActionHandler,
  type ServerActionRecordIdResolver,
} from '@object-ui/core';

/**
 * i18next-style translate function: `t(key, englishDefault)` returns the
 * translation for `key` in the active locale, or `englishDefault` when the
 * key is missing. Injected from a hook context (`useObjectTranslation().t`)
 * because this wrapper is a plain function and cannot call hooks itself.
 */
export type ConsoleServerActionTranslate = (key: string, englishDefault: string) => string;

/** No-`t` fallback (tests / standalone): every string is its English default. */
const defaultTranslate: ConsoleServerActionTranslate = (_key, englishDefault) => englishDefault;

export interface ConsoleServerActionOptions {
  /** Authenticated fetch wrapper (Bearer + tenant + cookies). */
  fetch: ServerActionFetch;
  /** Backend origin, read per dispatch (`''` = same-origin). */
  baseUrl: () => string;
  /** Fallback object scope when the action declares no `objectName`. */
  resolveObject: (action: ActionDef, context: ActionContext | undefined) => string | undefined;
  /**
   * Replace the standard record-id dance — RecordDetailView resolves against
   * ITS record (`action.recordId ?? pageRecordId`) instead of a grid
   * selection. Omit for the standard list/page behavior.
   */
  resolveRecordId?: ServerActionRecordIdResolver;
  /** Data invalidation, invoked per the action's `refreshAfter` semantics. */
  onRefresh: () => void;
  /**
   * Localizes the user-facing copy this wrapper owns (the SSO spinner tab,
   * the popup-blocked toast, the `newTabUrl` fast path's "no record id"
   * refusal) via the `console.serverAction.*` keys in
   * `@object-ui/i18n`. Optional: when omitted the English defaults apply —
   * per AGENTS.md Commandment #-1, no non-English copy lives in code
   * (objectui#3321).
   */
  t?: ConsoleServerActionTranslate;
  /**
   * SPA route hop, for a handler that returned `openIn: 'self'` alongside its
   * `redirectUrl`. The console passes react-router's `navigate` — the router
   * this app already uses; nothing new is introduced here.
   *
   * Optional: without it an explicit `'self'` still lands, via the full-page
   * navigation this file already falls back to. That is a slower same-tab
   * arrival, never a new tab, so the handler's stated intent is never inverted.
   */
  navigate?: (url: string) => void;
}

/** Minimal HTML escape for locale strings interpolated into the spinner document. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Pre-open `about:blank` synchronously (user-gesture context) and paint
 * progress immediately so the tab isn't blank/frozen during the (slow)
 * server round trip.
 *
 * NOTE: do NOT pass 'noopener' — per spec it forces `window.open` to return
 * null even when the tab opens, so the handle would be lost, the popup
 * fallback would fire, and the CURRENT tab would navigate to the now-consumed
 * SSO URL (the double-navigation bug).
 */
function preOpenSpinnerTab(t: ConsoleServerActionTranslate): Window | null {
  try {
    const tab = window.open('about:blank', '_blank');
    if (tab) {
      const title = escapeHtml(t('console.serverAction.openingTitle', 'Opening…'));
      const body = escapeHtml(t('console.serverAction.openingBody', 'Opening… this may take a moment.'));
      tab.document.write(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="margin:0;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:16px;color:#4b5563"><div style="width:28px;height:28px;border:3px solid #e5e7eb;border-top-color:#6366f1;border-radius:50%;animation:s .8s linear infinite"></div><div>${body}</div><style>@keyframes s{to{transform:rotate(360deg)}}</style></body>`);
      tab.document.close();
    }
    return tab;
  } catch {
    return null;
  }
}

function closeTab(tab: Window | null): void {
  if (!tab) return;
  try { tab.close(); } catch { /* ignore */ }
}

/**
 * Open `url`: drive the pre-opened tab there when one exists (falling back to
 * a current-tab navigation if the handle went stale); otherwise open lazily
 * and, when the popup blocker eats it, offer a one-click toast instead of
 * silently hijacking the current tab.
 */
function openInTab(preOpenedTab: Window | null, url: string, t: ConsoleServerActionTranslate): void {
  if (preOpenedTab) {
    try {
      preOpenedTab.location.href = url;
    } catch {
      closeTab(preOpenedTab);
      window.location.href = url;
    }
    return;
  }
  let popup: Window | null;
  // No 'noopener' so a successful open returns a truthy handle; with it, the
  // null return would always trip the toast fallback.
  try { popup = window.open(url, '_blank'); } catch { popup = null; }
  if (!popup) {
    toast(t('console.serverAction.popupBlockedTitle', 'Popup blocked'), {
      description: t('console.serverAction.popupBlockedDescription', 'Your browser blocked the new tab from opening.'),
      action: { label: t('console.serverAction.popupBlockedAction', 'Open in new tab'), onClick: () => { try { window.open(url, '_blank'); } catch { window.location.href = url; } } },
      duration: 10000,
    });
  }
}

export function createConsoleServerActionHandler(opts: ConsoleServerActionOptions): ServerActionHandler {
  const dispatch = createServerActionHandler({
    fetch: opts.fetch,
    baseUrl: opts.baseUrl,
    resolveObject: opts.resolveObject,
    resolveRecordId: opts.resolveRecordId,
    onRefresh: opts.onRefresh,
  });
  const resolveRecordId = opts.resolveRecordId ?? resolveServerActionRecordId;
  const t = opts.t ?? defaultTranslate;

  const handler: ServerActionHandler = async (action: ActionDef, context?: ActionContext) => {
    // ── Zero-roundtrip fast path ────────────────────────────────────────
    // `newTabUrl` names a GET endpoint that performs ALL auth/authz itself
    // (e.g. /sso-open re-runs every check the POST half would have done),
    // so the POST round trip would add nothing but click latency. Drive the
    // pre-opened tab there immediately — the spinner page stays painted
    // until the (possibly slow) endpoint commits its redirect. Record-id
    // resolution runs BEFORE the pre-open so a blocked resolution
    // (multi-select, empty selection) never flashes a tab.
    const newTabUrl = typeof action.newTabUrl === 'string' ? action.newTabUrl : '';
    if (action.opensInNewTab && newTabUrl) {
      // Both refusals below are shown in the session's language
      // (objectui#13397): the resolver's through the pack key it names
      // (objectui#13384), this wrapper's own through `console.serverAction.*`.
      const resolution = resolveRecordId(action, context);
      if (resolution.error) {
        const error = resolution.errorKey ? t(resolution.errorKey, resolution.error) : resolution.error;
        return { success: false, error: error || resolution.error };
      }
      const recordId = resolution.recordId;
      if (recordId == null) {
        return {
          success: false,
          error: t('console.serverAction.noRecordId', 'This action runs on a single record — no record id available.'),
        };
      }
      const preOpenedTab = preOpenSpinnerTab(t);
      // Absolute URL required: the pre-opened tab is an about:blank document,
      // so a bare-relative href has no reliable resolution base.
      const directUrl = `${opts.baseUrl() || window.location.origin}${newTabUrl.replace('{recordId}', encodeURIComponent(String(recordId)))}`;
      openInTab(preOpenedTab, directUrl, t);
      if (action.refreshAfter === true) opts.onRefresh();
      return { success: true };
    }

    // Popup-blocker workaround: pre-open about:blank synchronously before the
    // await so the user-gesture context is preserved.
    const preOpenedTab = action.opensInNewTab ? preOpenSpinnerTab(t) : null;
    try {
      const result = await dispatch(action, context);
      if (!result.success) {
        closeTab(preOpenedTab);
        // Don't toast here — the ActionRunner's post-execution hook surfaces
        // `error` as a toast; toasting here too double-fires it.
        return result;
      }
      // ── redirectUrl convention ────────────────────────────────────────
      // Read off the HANDLER's return value, not the action envelope wrapping
      // it (`result.data`). This used to read one level too shallow, where
      // only `success`/`data` ever live — so an action returning
      // `{ redirectUrl }` was silently ignored and an `opensInNewTab` action
      // left its pre-opened tab parked on the spinner page forever.
      const payload = readActionPayload(result.data);
      const redirectUrl = (payload && typeof payload === 'object' && typeof (payload as { redirectUrl?: unknown }).redirectUrl === 'string')
        ? (payload as { redirectUrl: string }).redirectUrl
        : null;
      // ── Precedence: a DECLARED `onSuccess` block beats the handler-return
      //    convention ─────────────────────────────────────────────────────
      // Both can be present on one `type: 'script'` action, and they mean the
      // same thing — "go here afterwards". Performing both would fire two
      // navigations, the second racing a page that is already unloading. The
      // author's declaration is the surface `@objectstack/spec` validates and
      // the only one visible in metadata, so it wins; the runner performs that
      // hop after this handler returns (`ActionRunner.navigateOnSuccess`), and
      // all this branch owes is the pre-opened tab.
      //
      // ⚠️ The spec rules each surface's own default but does NOT rule this
      // precedence — the card behind `053fdc8f9` escalates it. If the maintainer rules the
      // other way, this is the line that changes.
      if (readOnSuccessNavigation(action.onSuccess)) {
        closeTab(preOpenedTab);
        return result;
      }
      if (redirectUrl) {
        // `{ redirectUrl }` WITHOUT `openIn` keeps its shipped new-tab
        // behavior — no silent flip. A handler may opt into the same-tab jump
        // by returning `openIn: 'self'` explicitly, spelled as the ruled enum
        // member (never the `type:'url'` key's `'new-tab'` kebab).
        const opensInSelf = payload && typeof payload === 'object'
          && (payload as { openIn?: unknown }).openIn === 'self';
        if (opensInSelf) {
          // The tab we optimistically pre-opened is now unwanted: the handler
          // asked to stay put.
          closeTab(preOpenedTab);
          if (opts.navigate && redirectUrl.startsWith('/')) {
            opts.navigate(redirectUrl);
          } else {
            // Absolute/external destination — no SPA route can express it.
            window.location.href = redirectUrl;
          }
        } else {
          openInTab(preOpenedTab, redirectUrl, t);
        }
      } else {
        // Handler didn't return a redirectUrl — close the empty tab we
        // optimistically pre-opened so the user isn't left with about:blank.
        closeTab(preOpenedTab);
      }
      return result;
    } catch (error) {
      closeTab(preOpenedTab);
      return { success: false, error: (error as Error).message };
    }
  };
  // Core's early record-id refusal (objectui#13384), forwarded: the runner
  // asks the handler it dispatches to — this wrapper, not core's handler
  // inside it — before it shows a confirmation or a param dialog. Without the
  // forward a single-record action launched with 0 or several rows selected
  // ran its whole dialog and was refused only after Confirm.
  handler.refuseBeforeInput = dispatch.refuseBeforeInput;
  return handler;
}
