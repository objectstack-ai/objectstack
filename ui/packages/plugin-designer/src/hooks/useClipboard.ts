/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useCallback } from 'react';

export interface ClipboardState<T> {
  /** Current clipboard content */
  clipboard: T | null;
  /** Copy items to clipboard */
  copy: (item: T) => void;
  /** Paste from clipboard (returns the item) */
  paste: () => T | null;
  /** Whether clipboard has content */
  hasContent: boolean;
}

/**
 * Hook for copy/paste support in designers.
 * Manages an internal clipboard for designer items.
 */
export function useClipboard<T>(): ClipboardState<T> {
  const [clipboard, setClipboard] = useState<T | null>(null);

  const copy = useCallback((item: T) => {
    setClipboard(structuredClone(item));
  }, []);

  const paste = useCallback((): T | null => {
    if (!clipboard) return null;
    return structuredClone(clipboard);
  }, [clipboard]);

  return {
    clipboard,
    copy,
    paste,
    hasContent: clipboard !== null,
  };
}
