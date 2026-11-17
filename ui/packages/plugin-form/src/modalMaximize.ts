/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The form dialog's maximize / restore switch (objectstack-ai/objectstack#34604).
 *
 * Package-internal: `ModalForm` is its only reader, and neither `index.tsx`
 * nor `core.ts` re-exports it.
 *
 * Maximized, the dialog takes the `full` size and fills the window's height
 * instead of growing up to its `90vh` cap. Only the content element's classes
 * change, so the form below stays mounted: typed values, the dirty state and
 * master-detail lines all survive the switch.
 *
 * The choice is a per-object PREFERENCE (ui AGENTS.md #8): one object's form
 * dialog reopens the way the user last left it, and another object's is
 * untouched. It lives in `localStorage` under {@link modalFormMaximizedStorageKey};
 * every storage access is guarded, so a server render, a private window or a
 * blocked store reads as "not maximized" and a failed write keeps the switch
 * working for the dialog's lifetime.
 */

import { useState } from 'react';

/** The `localStorage` key that remembers whether `objectName`'s form dialog opens maximized. */
export function modalFormMaximizedStorageKey(objectName: string): string {
  return `modal-form-maximized:${objectName}`;
}

/** Whether `objectName`'s form dialog was last left maximized; `false` when nothing is stored or storage is out of reach. */
export function readModalFormMaximized(objectName: string): boolean {
  if (!objectName || typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(modalFormMaximizedStorageKey(objectName)) === '1';
  } catch {
    return false;
  }
}

/** Remember the choice for `objectName`. Restoring removes the entry, so the stored default stays "not maximized". */
export function writeModalFormMaximized(objectName: string, maximized: boolean): void {
  if (!objectName || typeof window === 'undefined') return;
  try {
    const key = modalFormMaximizedStorageKey(objectName);
    if (maximized) window.localStorage.setItem(key, '1');
    else window.localStorage.removeItem(key);
  } catch {
    // A blocked store only loses the memory of the choice, never the switch.
  }
}

/**
 * The dialog's maximized state for `objectName`: seeded from the remembered
 * choice, re-read when the dialog is handed another object, and written back
 * on every toggle.
 */
export function useModalFormMaximized(objectName: string): {
  maximized: boolean;
  toggleMaximized: () => void;
} {
  const [state, setState] = useState(() => ({
    objectName,
    maximized: readModalFormMaximized(objectName),
  }));
  let current = state;
  if (state.objectName !== objectName) {
    // A render-phase update keyed on the object name: React discards this
    // render's output and re-renders with the other object's choice before
    // anything is committed.
    current = { objectName, maximized: readModalFormMaximized(objectName) };
    setState(current);
  }
  const toggleMaximized = () => {
    const next = !current.maximized;
    writeModalFormMaximized(objectName, next);
    setState({ objectName, maximized: next });
  };
  return { maximized: current.maximized, toggleMaximized };
}
