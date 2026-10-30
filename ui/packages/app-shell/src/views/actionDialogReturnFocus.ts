/**
 * Where focus goes when an action dialog closes: back to the control that
 * opened it.
 *
 * The console opens its action dialogs (param, confirm, result) from a
 * runner, not from a Radix `DialogTrigger`, so Radix's own return target is
 * whatever held focus when the content mounted. Three openers defeat that:
 *
 * - A row menu item. The menu closes as the action starts, so the item is
 *   gone by the time the dialog closes. The opener is the menu's trigger,
 *   which the menu names in `aria-labelledby`.
 * - An action button. It is disabled while its action runs, so a browser
 *   blurs it before the dialog opens (focus is on `body` then), and it still
 *   refuses focus when the dialog closes, before the run settles. The opener
 *   is then the control the user last activated, and focus waits for it to
 *   come back, as long as the user has not put focus somewhere else meanwhile.
 * - A dialog that hands over to the next one (a param dialog whose run ends
 *   in a result dialog). The next dialog returns to the first one's opener.
 *
 * The hook is the `onCloseAutoFocus` half only; when it has no opener, or the
 * opener is gone, Radix's default stays.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]';

/** How long a closed dialog waits for a disabled opener to come back. */
const RETURN_FOCUS_WAIT_MS = 10_000;

/** How recent an activation must be to count as the opener of a dialog opening on `body`. */
const ACTIVATION_WINDOW_MS = 10_000;

const CONTROL_SELECTOR = 'button, a[href], input, select, textarea, [role="button"], [role="menuitem"], [tabindex]';

/** The opener each open action dialog returns to, by its content element. */
const openers = new WeakMap<Element, HTMLElement>();

/**
 * The last closed dialog's wait for its disabled opener. A dialog that opens
 * while it is pending takes that opener over: focus is on `body` then, and
 * the opener is the control the user started from.
 */
let pendingReturn: { opener: HTMLElement; stop: () => void } | null = null;

/**
 * The control the user last pressed or clicked, already resolved to its
 * opener (a menu item to the menu's trigger), and when. Read only when a
 * dialog opens with focus on `body`.
 */
let lastActivation: { opener: HTMLElement; at: number } | null = null;
let activationListening = false;

function recordActivation(event: Event): void {
  const target = event.target as Element | null;
  const control = target && typeof target.closest === 'function' ? target.closest(CONTROL_SELECTOR) : null;
  const opener = control ? resolveFocusOpener(control) : null;
  lastActivation = opener ? { opener, at: Date.now() } : null;
}

/** Listens once per document, in the capture phase, so no handler can hide an activation. */
function listenForActivations(doc: Document): void {
  if (activationListening) return;
  activationListening = true;
  doc.addEventListener('pointerdown', recordActivation, true);
  doc.addEventListener('keydown', recordActivation, true);
}

function isHtmlElement(node: unknown): node is HTMLElement {
  return !!node && (node as Node).nodeType === 1 && typeof (node as HTMLElement).focus === 'function';
}

function focusIsNowhere(doc: Document): boolean {
  const active = doc.activeElement;
  return !active || active === doc.body || active === doc.documentElement;
}

/**
 * The control to return to for a dialog opening while `active` holds focus.
 * Exported for the pins; `null` means "no opener", and Radix's default stays.
 */
export function resolveFocusOpener(active: Element | null): HTMLElement | null {
  if (!isHtmlElement(active)) return null;
  const doc = active.ownerDocument;
  if (active === doc.body || active === doc.documentElement) {
    const pending = pendingReturn;
    if (pending) {
      pending.stop();
      return pending.opener.isConnected ? pending.opener : null;
    }
    const activation = lastActivation;
    if (!activation || Date.now() - activation.at > ACTIVATION_WINDOW_MS) return null;
    return activation.opener.isConnected ? activation.opener : null;
  }
  // Nested menus are walked out one trigger at a time; the bound only guards
  // a menu that names itself.
  let current: HTMLElement = active;
  for (let depth = 0; depth < 8; depth += 1) {
    const dialog = current.closest(DIALOG_SELECTOR);
    const inherited = dialog ? openers.get(dialog) : undefined;
    if (inherited) return inherited;
    const menu = current.closest('[role="menu"]');
    if (!menu) return current;
    const triggerId = menu.getAttribute('aria-labelledby');
    const trigger = triggerId ? doc.getElementById(triggerId) : null;
    if (!isHtmlElement(trigger)) return null;
    current = trigger;
  }
  return null;
}

/** Focus `opener`, or wait for it to accept focus (see the header). */
function returnFocusTo(opener: HTMLElement): void {
  pendingReturn?.stop();
  const doc = opener.ownerDocument;
  const tryFocus = (): boolean => {
    opener.focus({ preventScroll: true });
    return doc.activeElement === opener;
  };
  if (tryFocus()) return;
  const view = doc.defaultView;
  if (!view || typeof view.MutationObserver !== 'function') return;
  const stop = () => {
    observer.disconnect();
    view.clearTimeout(timer);
    if (pendingReturn?.stop === stop) pendingReturn = null;
  };
  const observer = new view.MutationObserver(() => {
    if (!opener.isConnected || !focusIsNowhere(doc)) {
      stop();
      return;
    }
    if (tryFocus()) stop();
  });
  observer.observe(opener, {
    attributes: true,
    attributeFilter: ['disabled', 'aria-disabled', 'tabindex', 'hidden', 'inert'],
  });
  const timer = view.setTimeout(stop, RETURN_FOCUS_WAIT_MS);
  pendingReturn = { opener, stop };
}

/**
 * Returns the content ref and the `onCloseAutoFocus` handler for one action
 * dialog. `open` is the dialog's own open state: the opener is read when it
 * turns true, before the dialog moves focus inside.
 */
export function useActionDialogReturnFocus(open: boolean): {
  contentRef: (node: HTMLElement | null) => void;
  onCloseAutoFocus: (event: Event) => void;
} {
  const openerRef = useRef<HTMLElement | null>(null);
  const contentNodeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document !== 'undefined') listenForActivations(document);
  }, []);

  // A layout effect runs before Radix's focus scope mounts (the portal draws
  // the content one commit later), so focus is still on the opener here.
  useLayoutEffect(() => {
    if (!open) return;
    const active = typeof document === 'undefined' ? null : document.activeElement;
    const own = contentNodeRef.current;
    openerRef.current = own && active && own.contains(active) ? null : resolveFocusOpener(active);
    if (own && openerRef.current) openers.set(own, openerRef.current);
  }, [open]);

  const contentRef = useCallback((node: HTMLElement | null) => {
    contentNodeRef.current = node;
    if (node && openerRef.current) openers.set(node, openerRef.current);
  }, []);

  const onCloseAutoFocus = useCallback((event: Event) => {
    const opener = openerRef.current;
    openerRef.current = null;
    if (!opener || !opener.isConnected) return;
    event.preventDefault();
    // A dialog that opened after this one holds focus now; it returns to the
    // same opener when it closes.
    const active = opener.ownerDocument.activeElement;
    if (active && !focusIsNowhere(opener.ownerDocument) && active.closest(DIALOG_SELECTOR)) return;
    returnFocusTo(opener);
  }, []);

  return { contentRef, onCloseAutoFocus };
}
