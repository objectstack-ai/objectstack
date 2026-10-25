// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Unsaved edits — the one place that answers "does the page on screen hold
 * edits that leaving would drop?", and the guard every departure goes through
 * (objectui#13231).
 *
 * A page that keeps edits in component state registers them here while it
 * holds them ({@link useRegisterUnsavedEdits}), with the question it wants
 * asked. While anything is registered the seam guards every departure it can
 * see:
 *
 * - **Tab close / reload / a document load** — one `beforeunload` listener,
 *   the browser's own "Leave site?" prompt.
 * - **An in-app link** — one capture-phase `click` listener on the document,
 *   which runs before the router's own handler on the root. `useBlocker` is
 *   not available: it needs a data router, and the console mounts
 *   `BrowserRouter`.
 * - **A departure the shell or the page starts from a button** — the header's
 *   help, avatar and app menus, the workspace switcher, a sidebar entry's
 *   Design, the go-home shortcut, a page's own crumb. Those call `navigate()`
 *   (or reload the document) from a menu item, which no link listener sees, so
 *   each one goes through {@link confirmUnsavedLeave}.
 *
 * The listeners are installed while at least one page is registered, and
 * removed the moment the last one goes clean (a save, a discard) or unmounts.
 *
 * ## Why a module store, not a React context
 *
 * The same reason as `advertisedShortcuts` and `assistantBus`: the pages that
 * register and the shell chrome that asks sit on different branches of the
 * tree, and the answer must reach the header without a provider threaded
 * through every layout and every host.
 *
 * ## Why the native `confirm`, not an in-app dialog
 *
 * An in-app dialog is asynchronous, so the link guard would have to cancel
 * every click and later re-navigate on the user's behalf. Each way of doing
 * that is fragile here: re-dispatching the click on the stored anchor is the
 * synthetic-trigger shape ADR-0054 C1 bans; `navigate(anchor.href)` has to
 * strip the router basename a host's injected `<base href>` sets (or it
 * doubles the prefix), drops the link's own `onClick`, `replace` and `state`,
 * and turns a plain same-origin anchor's document load into an SPA push. A
 * synchronous `confirm` needs none of it: on OK the click simply continues.
 *
 * ## What it does not see
 *
 * Browser Back / Forward (`popstate`): `BrowserRouter` offers no hook to veto
 * it, and the history workarounds are not worth their cost. Nor a departure a
 * component starts with `navigate()` without going through
 * {@link confirmUnsavedLeave}.
 *
 * @module
 */

import { useEffect } from 'react';

interface Registration {
  /** The question asked before this page's edits are dropped, already translated. */
  readonly message: string;
}

/** In registration order: the last one is the page shown most recently. */
const registrations = new Set<Registration>();

/**
 * A departure the user has already agreed to is under way, so the
 * `beforeunload` prompt must not ask a second time — an organization switch
 * asks first, then reloads the document (objectui#13231). Set only for the
 * span of that departure's own `go`.
 */
let leaveConfirmed = false;

function latestMessage(): string | undefined {
  let message: string | undefined;
  for (const registration of registrations) message = registration.message;
  return message;
}

/**
 * Whether a click on the document would take the user to another page of this
 * app. Mirrors what the router itself skips: a modified or non-primary click
 * (new tab / window), a link that opens elsewhere or downloads, a link to
 * another origin (the `beforeunload` prompt covers that one), and a link to the
 * page already shown — the view stays mounted and keeps its edits.
 */
function leavesThisPage(e: MouseEvent): boolean {
  if (e.defaultPrevented) return false;
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const target = e.target instanceof Element ? e.target : null;
  const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
  if (!anchor) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;
  try {
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return false;
    if (url.pathname === window.location.pathname) return false;
  } catch {
    return false;
  }
  return true;
}

function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (registrations.size === 0 || leaveConfirmed) return;
  e.preventDefault();
  // Chrome shows the prompt only when `returnValue` is set as well.
  e.returnValue = '';
}

function onDocumentClick(e: MouseEvent): void {
  const message = latestMessage();
  if (message === undefined || !leavesThisPage(e)) return;
  if (window.confirm(message)) return;
  // Kept: the router never sees the click, so the URL and the edits stay.
  e.preventDefault();
  e.stopPropagation();
}

function install(): void {
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('click', onDocumentClick, true);
}

function uninstall(): void {
  window.removeEventListener('beforeunload', onBeforeUnload);
  document.removeEventListener('click', onDocumentClick, true);
}

/**
 * Register unsaved edits until the returned release function is called. While
 * any registration is held, every departure the seam sees asks `message`
 * first. Prefer {@link useRegisterUnsavedEdits} in a component.
 */
export function registerUnsavedEdits(message: string): () => void {
  const registration: Registration = { message };
  if (registrations.size === 0) install();
  registrations.add(registration);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    registrations.delete(registration);
    if (registrations.size === 0) uninstall();
  };
}

/**
 * Register the calling page's unsaved edits for as long as it is mounted and
 * `dirty`. Call it beside the state that holds the edits, with the question
 * the page asks before they are dropped, already translated.
 */
export function useRegisterUnsavedEdits(dirty: boolean, message: string): void {
  useEffect(() => (dirty ? registerUnsavedEdits(message) : undefined), [dirty, message]);
}

/**
 * Leave the page through `go` — a `navigate()`, a sign-out, an organization
 * switch — once nothing would be lost: at once when no page holds unsaved
 * edits, and otherwise only after the user confirms the registered question.
 * On Cancel `go` never runs, so the URL, the organization and the edits stay.
 *
 * A `go` that returns a promise (one that ends in a document load, such as an
 * organization switch) keeps the `beforeunload` prompt quiet until it settles:
 * the user has answered once already.
 */
export function confirmUnsavedLeave(go: () => unknown): void {
  const message = latestMessage();
  if (message === undefined) {
    go();
    return;
  }
  if (!window.confirm(message)) return;
  leaveConfirmed = true;
  let result: unknown;
  try {
    result = go();
  } catch (err) {
    leaveConfirmed = false;
    throw err;
  }
  if (result instanceof Promise) {
    const settle = () => {
      leaveConfirmed = false;
    };
    result.then(settle, settle);
  } else {
    leaveConfirmed = false;
  }
}
