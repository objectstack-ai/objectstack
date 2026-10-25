/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useMemo } from 'react';
import {
  useKeyboardShortcuts,
  type KeyboardShortcutDefinition,
} from './useKeyboardShortcuts.js';

export interface CrudShortcutCallbacks {
  onCreate?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onSave?: () => void;
  onDuplicate?: () => void;
  onCancel?: () => void;
  onSearch?: () => void;
}

/**
 * Registers standard CRUD keyboard shortcuts using the useKeyboardShortcuts hook.
 *
 * Shortcuts:
 * - Ctrl/Cmd+N: Create new record
 * - Ctrl/Cmd+E: Edit selected record
 * - Delete / Backspace: Delete selected record(s)
 * - Ctrl/Cmd+S: Save current record
 * - Ctrl/Cmd+D: Duplicate selected record
 * - Escape: Cancel/close current operation
 * - Ctrl/Cmd+F: Focus search
 *
 * @example
 * ```tsx
 * useCrudShortcuts({
 *   onCreate: () => openCreateDialog(),
 *   onSave: () => saveRecord(),
 *   onDelete: () => deleteSelected(),
 *   onCancel: () => closeDialog(),
 * });
 * ```
 */
export function useCrudShortcuts(
  callbacks: CrudShortcutCallbacks,
  enabled = true
): void {
  const shortcuts = useMemo<KeyboardShortcutDefinition[]>(() => {
    const defs: KeyboardShortcutDefinition[] = [];

    if (callbacks.onCreate) {
      defs.push({
        key: 'n',
        ctrlOrMeta: true,
        handler: () => callbacks.onCreate!(),
        description: 'New record',
      });
    }

    if (callbacks.onEdit) {
      defs.push({
        key: 'e',
        ctrlOrMeta: true,
        handler: () => callbacks.onEdit!(),
        description: 'Edit selected record',
      });
    }

    if (callbacks.onDelete) {
      defs.push(
        {
          key: 'Delete',
          handler: () => callbacks.onDelete!(),
          description: 'Delete selected record(s)',
        },
        {
          key: 'Backspace',
          handler: () => callbacks.onDelete!(),
          description: 'Delete selected record(s)',
        }
      );
    }

    if (callbacks.onSave) {
      defs.push({
        key: 's',
        ctrlOrMeta: true,
        handler: () => callbacks.onSave!(),
        description: 'Save current record',
      });
    }

    if (callbacks.onDuplicate) {
      defs.push({
        key: 'd',
        ctrlOrMeta: true,
        handler: () => callbacks.onDuplicate!(),
        description: 'Duplicate selected record',
      });
    }

    if (callbacks.onCancel) {
      defs.push({
        key: 'Escape',
        handler: () => callbacks.onCancel!(),
        description: 'Cancel/close current operation',
      });
    }

    if (callbacks.onSearch) {
      defs.push({
        key: 'f',
        ctrlOrMeta: true,
        handler: () => callbacks.onSearch!(),
        description: 'Focus search',
      });
    }

    return defs;
  }, [callbacks]);

  useKeyboardShortcuts(shortcuts, { enabled });
}
