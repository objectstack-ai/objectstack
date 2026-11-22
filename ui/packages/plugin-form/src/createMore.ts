/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The create dialog's 「Create more」 switch and its save shortcut
 * (objectstack-ai/objectstack#35980).
 *
 * Package-internal: `ModalForm` is its only reader, and neither `index.tsx`
 * nor `core.ts` re-exports it.
 *
 * With the switch on, a successful create keeps the dialog open: the form is
 * drawn again from its opening values, focus returns to the first field, and
 * the host learns the dialog stays (`onSuccess`'s `{ createMore: true }`), so
 * it refreshes the list behind instead of leaving for the new record.
 *
 * The switch is a per-object PREFERENCE (ui AGENTS.md #8), the way the
 * maximize switch is (`modalMaximize.ts`): one object's create dialog reopens
 * with the switch as the user last left it, in this browser. It lives in
 * `localStorage` under {@link modalFormCreateMoreStorageKey}; every access is
 * guarded, so a private window or a blocked store reads as "off" and a failed
 * write keeps the switch working for the dialog's lifetime.
 */

import { useState } from 'react';

/** The `localStorage` key that remembers whether `objectName`'s create dialog has 「Create more」 on. */
export function modalFormCreateMoreStorageKey(objectName: string): string {
  return `modal-form-create-more:${objectName}`;
}

/** Whether `objectName`'s create dialog was last left with 「Create more」 on; `false` when nothing is stored or storage is out of reach. */
export function readModalFormCreateMore(objectName: string): boolean {
  if (!objectName || typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(modalFormCreateMoreStorageKey(objectName)) === '1';
  } catch {
    return false;
  }
}

/** Remember the choice for `objectName`. Turning it off removes the entry, so the stored default stays "off". */
export function writeModalFormCreateMore(objectName: string, on: boolean): void {
  if (!objectName || typeof window === 'undefined') return;
  try {
    const key = modalFormCreateMoreStorageKey(objectName);
    if (on) window.localStorage.setItem(key, '1');
    else window.localStorage.removeItem(key);
  } catch {
    // A blocked store only loses the memory of the choice, never the switch.
  }
}

/**
 * The switch's state for `objectName`: seeded from the remembered choice,
 * re-read when the dialog is handed another object, written back on change.
 */
export function useModalFormCreateMore(objectName: string): {
  createMore: boolean;
  setCreateMore: (on: boolean) => void;
} {
  const [state, setState] = useState(() => ({
    objectName,
    createMore: readModalFormCreateMore(objectName),
  }));
  let current = state;
  if (state.objectName !== objectName) {
    current = { objectName, createMore: readModalFormCreateMore(objectName) };
    setState(current);
  }
  const setCreateMore = (on: boolean) => {
    writeModalFormCreateMore(objectName, on);
    setState({ objectName, createMore: on });
  };
  return { createMore: current.createMore, setCreateMore };
}

/**
 * Whether a keydown is the dialog's save shortcut: ⌘↵ on Apple platforms,
 * Ctrl+Enter elsewhere — either modifier is accepted on every platform, as
 * neither means anything else in a form. Shift and Alt keep their own
 * meanings, and a keydown that ends an IME composition is the composition's.
 */
export function isSubmitShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}): boolean {
  if (event.key !== 'Enter' || event.isComposing) return false;
  if (event.shiftKey || event.altKey) return false;
  return event.metaKey || event.ctrlKey;
}

/** Whether this browser runs on an Apple platform, where the save shortcut reads ⌘↵. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** The keycap text the save button shows: `⌘↵` on Apple platforms, `Ctrl ↵` elsewhere. */
export function submitShortcutLabel(): string {
  return isApplePlatform() ? '⌘↵' : 'Ctrl ↵';
}
