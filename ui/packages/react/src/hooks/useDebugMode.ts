/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { parseDebugFlags, type DebugFlags } from '@object-ui/core';

/**
 * Result returned by {@link useDebugMode}.
 */
export interface UseDebugModeResult {
  /** Whether debug mode is currently enabled */
  enabled: boolean;
  /** Fine-grained debug flags parsed from the URL */
  flags: DebugFlags;
  /** Toggle debug mode on/off */
  toggle: () => void;
  /** Explicitly set debug mode */
  setEnabled: (value: boolean) => void;
}

/**
 * Hook for managing debug mode.
 *
 * Automatically detects `?__debug` (and sub-flags like `?__debug_schema`)
 * from the URL. Supports manual toggle and Ctrl+Shift+D keyboard shortcut.
 *
 * SSR-safe — returns disabled state when `window` is unavailable.
 *
 * @example
 * ```tsx
 * function App() {
 *   const debug = useDebugMode();
 *   return (
 *     <>
 *       {debug.enabled && <DebugPanel flags={debug.flags} />}
 *       <button onClick={debug.toggle}>Toggle Debug</button>
 *     </>
 *   );
 * }
 * ```
 */
export function useDebugMode(): UseDebugModeResult {
  const urlFlags = useMemo(() => {
    try {
      return typeof window !== 'undefined'
        ? parseDebugFlags(window.location.search)
        : { enabled: false } as DebugFlags;
    } catch {
      return { enabled: false } as DebugFlags;
    }
  }, []);

  const [manualEnabled, setManualEnabled] = useState<boolean | null>(null);

  // Effective enabled: manual override wins, then URL flags
  const enabled = manualEnabled !== null ? manualEnabled : urlFlags.enabled;

  // Flags reflect URL-parsed flags plus effective enabled state
  const flags: DebugFlags = useMemo(
    () => ({ ...urlFlags, enabled }),
    [urlFlags, enabled],
  );

  const toggle = useCallback(() => {
    setManualEnabled((prev) => {
      if (prev === null) return !urlFlags.enabled;
      return !prev;
    });
  }, [urlFlags.enabled]);

  const setEnabled = useCallback((value: boolean) => {
    setManualEnabled(value);
  }, []);

  // Ctrl+Shift+D keyboard shortcut
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [toggle]);

  return { enabled, flags, toggle, setEnabled };
}
