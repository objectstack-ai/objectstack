/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record dialog's initial focus (objectui#13130).
 *
 * Radix's focus scope focuses the first tabbable element of a dialog the
 * moment its content mounts. `ModalForm` opens before its body exists: the
 * object schema (and, on edit, the record) are read after the dialog opens,
 * the field widgets are `React.lazy`, and the footer is drawn only once the
 * load ends. At mount the one tabbable element was the Close button, so a
 * Create/Edit dialog opened on Close and stayed there once the fields came.
 *
 * So the dialog's `onOpenAutoFocus` takes the decision itself: the first
 * editable field if one is already drawn, else the dialog element (Radix
 * gives it `tabIndex={-1}`, and screen readers announce it by its title).
 * In the second case a `MutationObserver` waits for the body, and moves focus
 * to the first editable field when it lands — only while focus is still on
 * the dialog element, so a control the user reached in the meantime keeps it.
 *
 * Lives here, with the host of `MobileDialogContent`, and not in the
 * Shadcn-synced `ui/` primitives (objectui AGENTS.md §5 #7): it is this
 * host's body that loads late, so it is this host that knows to wait.
 */

import { useEffect, useMemo, useRef } from 'react';

/**
 * A control inside a field row. The same selector the form renderer's
 * `revealField` uses to put focus inside a `[data-field]` row (the row
 * `FormItem` draws for every field).
 */
const FIELD_CONTROL_SELECTOR =
  'input:not([type="hidden"]), select, textarea, button, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/**
 * Ancestors that take a control out of reach. The form renderer keeps every
 * tab panel mounted (`forceMount`) and hides an inactive one by class, not by
 * attribute, so the inactive panel is named here.
 */
const UNREACHABLE_ANCESTOR_SELECTOR =
  '[hidden], [inert], [aria-hidden="true"], fieldset[disabled], [role="tabpanel"][data-state="inactive"]';

function isEditableControl(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled === true) return false;
  if ((el as HTMLInputElement).readOnly === true) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  if (el.getAttribute('aria-readonly') === 'true') return false;
  if (el.tabIndex < 0) return false;
  return el.closest(UNREACHABLE_ANCESTOR_SELECTOR) === null;
}

/**
 * The first control, in document order, that a user can edit in the first
 * field row that has one. `null` while no field row is drawn (the body is
 * loading) or when every field is read-only (a view-mode form).
 */
export function findFirstEditableField(root: ParentNode): HTMLElement | null {
  for (const row of Array.from(root.querySelectorAll<HTMLElement>('[data-field]'))) {
    for (const control of Array.from(row.querySelectorAll<HTMLElement>(FIELD_CONTROL_SELECTOR))) {
      if (isEditableControl(control)) return control;
    }
  }
  return null;
}

/**
 * Focus the first editable field under `root`. True only when focus really
 * moved there: an element hidden by layout (a suspended subtree React keeps
 * with `display: none`) refuses focus in a browser, and the caller keeps
 * waiting instead of reading that as done.
 */
function focusFirstEditableField(root: HTMLElement): boolean {
  const control = findFirstEditableField(root);
  if (!control) return false;
  control.focus({ preventScroll: true });
  return control.ownerDocument.activeElement === control;
}

/**
 * The `onOpenAutoFocus` / `onCloseAutoFocus` pair for a dialog content whose
 * body loads after it opens. Pass both to the dialog content; the observer the
 * open handler may start is stopped on close, on the next open and on unmount.
 */
export function useInitialFieldFocus(): {
  onOpenAutoFocus: (event: Event) => void;
  onCloseAutoFocus: (event: Event) => void;
} {
  // The live watch's disconnect. Everything below reaches it through this
  // ref, so no correctness rests on the identity of a memoised callback
  // (objectui AGENTS.md §5 #10): Radix reads both handlers through its own
  // callback ref, and the unmount cleanup keys on nothing.
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      stopRef.current?.();
      stopRef.current = null;
    },
    [],
  );

  return useMemo(() => {
    const stop = () => {
      stopRef.current?.();
      stopRef.current = null;
    };

    const onOpenAutoFocus = (event: Event) => {
      stop();
      const content = event.currentTarget as HTMLElement | null;
      if (!content || typeof content.focus !== 'function') return; // Radix's default stays
      // Radix would focus the first tabbable element now; while the body
      // loads, that is the Close button.
      event.preventDefault();
      if (focusFirstEditableField(content)) return;
      content.focus({ preventScroll: true });

      const doc = content.ownerDocument;
      const view = doc.defaultView;
      if (!view || typeof view.MutationObserver !== 'function') return;
      const observer = new view.MutationObserver(() => {
        // The user has moved focus (Tab to Close, a click): theirs to keep.
        if (doc.activeElement !== content) {
          stop();
          return;
        }
        if (focusFirstEditableField(content)) stop();
      });
      observer.observe(content, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'disabled',
          'readonly',
          'hidden',
          'inert',
          'style',
          'tabindex',
          'data-state',
          'aria-disabled',
          'aria-readonly',
          'aria-hidden',
        ],
      });
      stopRef.current = () => observer.disconnect();
    };

    // Only stops the watch; Radix still returns focus to the dialog's trigger.
    const onCloseAutoFocus = () => stop();

    return { onOpenAutoFocus, onCloseAutoFocus };
  }, []);
}
