/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useEffect, useRef, useCallback } from 'react';

export interface KeyboardShortcutDefinition {
  /** The key to listen for (e.g., 'k', 'Enter', 'Escape') */
  key: string;
  /** Whether Ctrl/Cmd is required */
  ctrlOrMeta?: boolean;
  /** Whether Shift is required */
  shift?: boolean;
  /** Whether Alt is required */
  alt?: boolean;
  /** Handler to call when the shortcut is triggered */
  handler: (event: KeyboardEvent) => void;
  /** Human-readable description for the help dialog */
  description?: string;
  /** Whether to prevent default browser behavior */
  preventDefault?: boolean;
  /** Whether the shortcut is currently enabled */
  enabled?: boolean;
}

/**
 * Hook for registering keyboard shortcuts.
 * Implements KeyboardShortcutSchema from @objectstack/spec v2.0.7.
 *
 * @example
 * ```tsx
 * useKeyboardShortcuts([
 *   { key: 'k', ctrlOrMeta: true, handler: () => openSearch(), description: 'Open search' },
 *   { key: 'n', ctrlOrMeta: true, handler: () => createNew(), description: 'Create new record' },
 *   { key: 'Escape', handler: () => closeModal(), description: 'Close dialog' },
 * ]);
 * ```
 */
export function useKeyboardShortcuts(
  shortcuts: KeyboardShortcutDefinition[],
  options: { enabled?: boolean } = {}
): void {
  const { enabled = true } = options;
  const shortcutsRef = useRef(shortcuts);
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in form elements
      const target = event.target as HTMLElement;
      const isFormElement =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;

      for (const shortcut of shortcutsRef.current) {
        if (shortcut.enabled === false) continue;

        const keyMatch =
          event.key.toLowerCase() === shortcut.key.toLowerCase();
        const ctrlMatch = shortcut.ctrlOrMeta
          ? event.ctrlKey || event.metaKey
          : !event.ctrlKey && !event.metaKey;
        const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey;
        const altMatch = shortcut.alt ? event.altKey : !event.altKey;

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          // Allow shortcuts with modifiers even in form elements
          if (isFormElement && !shortcut.ctrlOrMeta && !shortcut.alt) continue;

          if (shortcut.preventDefault !== false) {
            event.preventDefault();
          }
          shortcut.handler(event);
          return;
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleKeyDown]);
}

/**
 * Returns a list of all registered shortcut descriptions.
 * Useful for building a help dialog (? key).
 */
export function getShortcutDescriptions(
  shortcuts: KeyboardShortcutDefinition[]
): Array<{ keys: string; description: string }> {
  return shortcuts
    .filter((s) => s.description && s.enabled !== false)
    .map((s) => {
      const parts: string[] = [];
      if (s.ctrlOrMeta) parts.push('⌘/Ctrl');
      if (s.shift) parts.push('Shift');
      if (s.alt) parts.push('Alt');
      parts.push(s.key.length === 1 ? s.key.toUpperCase() : s.key);
      return {
        keys: parts.join(' + '),
        description: s.description!,
      };
    });
}
