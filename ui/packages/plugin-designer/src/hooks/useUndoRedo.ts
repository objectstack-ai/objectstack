/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export interface UndoRedoOptions {
  /** Maximum history size */
  maxHistory?: number;
  /**
   * When set, the history stack (past + current + future) is persisted to
   * `sessionStorage` under this key and rehydrated on the next mount. Use a
   * key that is unique per draft (e.g. `designer:draft:${draftId}`) so two
   * tabs editing different drafts never overwrite each other.
   */
  persistKey?: string;
  /**
   * Storage backend. Defaults to `sessionStorage` (per-tab). Pass
   * `localStorage` for cross-tab persistence, or your own implementation for
   * tests / electron / mobile bridges.
   */
  storage?: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
}

export interface UndoRedoState<T> {
  /** Current state */
  current: T;
  /** Whether undo is available */
  canUndo: boolean;
  /** Whether redo is available */
  canRedo: boolean;
  /** Number of undo steps available */
  undoCount: number;
  /** Number of redo steps available */
  redoCount: number;
  /**
   * Snapshot of the full timeline as `[...past, current, ...future]`. The
   * UI <HistoryPanel/> renders this as a vertical list so users can see
   * (and jump to) any previous checkpoint.
   */
  timeline: T[];
  /** Index of `current` within `timeline`. */
  currentIndex: number;
  /** Push a new state (clears redo stack) */
  push: (state: T) => void;
  /** Undo to previous state */
  undo: () => void;
  /** Redo to next state */
  redo: () => void;
  /** Reset to initial state, clearing all history */
  reset: (state: T) => void;
  /**
   * Jump directly to a specific timeline index. Equivalent to N undo() or
   * redo() calls, but performed atomically so re-renders only fire once.
   */
  jumpTo: (index: number) => void;
  /**
   * Drop persisted history from the configured storage backend. Useful when
   * the underlying draft is deleted or after a successful save.
   */
  clearPersisted: () => void;
}

interface PersistedShape<T> {
  v: 1;
  past: T[];
  current: T;
  future: T[];
}

function safeStorage(opt?: UndoRedoOptions['storage']) {
  if (opt) return opt;
  if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage;
  return null;
}

/**
 * Hook for undo/redo functionality using command pattern with state history.
 * Maintains a stack of past states and future states for undo/redo operations.
 *
 * Pass `persistKey` to keep the stack alive across page reloads — the designer
 * history survives a refresh, so users don't lose their unsaved progress.
 */
export function useUndoRedo<T>(initialState: T, options: UndoRedoOptions = {}): UndoRedoState<T> {
  const { maxHistory = 50, persistKey, storage } = options;
  const storageBackend = safeStorage(storage);

  // Rehydrate synchronously on first render so the very first paint reflects
  // any saved history. Without this, the user would see the initial state
  // briefly flash before a useEffect-driven hydration replaced it.
  const initialPersisted = (() => {
    if (!persistKey || !storageBackend) return null;
    try {
      const raw = storageBackend.getItem(persistKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersistedShape<T>;
      if (parsed && parsed.v === 1 && Array.isArray(parsed.past) && Array.isArray(parsed.future)) {
        return parsed;
      }
    } catch { /* ignore corrupt data */ }
    return null;
  })();

  const [current, setCurrent] = useState<T>(initialPersisted?.current ?? initialState);
  const pastRef = useRef<T[]>(initialPersisted?.past ?? []);
  const futureRef = useRef<T[]>(initialPersisted?.future ?? []);

  // Force re-render counter so callers see updated canUndo/canRedo immediately.
  const [, forceTick] = useState(0);
  const tick = useCallback(() => forceTick((n) => n + 1), []);

  // Persist after every change. Throttling could be added if hot loops become
  // a problem — for designer-style interactions (one mutation per click)
  // synchronous writes are simpler and reliable.
  useEffect(() => {
    if (!persistKey || !storageBackend) return;
    try {
      const payload: PersistedShape<T> = {
        v: 1,
        past: pastRef.current,
        current,
        future: futureRef.current,
      };
      storageBackend.setItem(persistKey, JSON.stringify(payload));
    } catch {
      /* QuotaExceeded — silently degrade to in-memory only. */
    }
  }, [current, persistKey, storageBackend]);

  const push = useCallback((state: T) => {
    setCurrent((prev) => {
      pastRef.current = [...pastRef.current.slice(-(maxHistory - 1)), prev];
      futureRef.current = [];
      return state;
    });
    tick();
  }, [maxHistory, tick]);

  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return;
    setCurrent((prev) => {
      const past = [...pastRef.current];
      const previous = past.pop()!;
      pastRef.current = past;
      futureRef.current = [prev, ...futureRef.current];
      return previous;
    });
    tick();
  }, [tick]);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    setCurrent((prev) => {
      const future = [...futureRef.current];
      const next = future.shift()!;
      futureRef.current = future;
      pastRef.current = [...pastRef.current, prev];
      return next;
    });
    tick();
  }, [tick]);

  const reset = useCallback((state: T) => {
    pastRef.current = [];
    futureRef.current = [];
    setCurrent(state);
    tick();
  }, [tick]);

  const clearPersisted = useCallback(() => {
    if (!persistKey || !storageBackend) return;
    try {
      storageBackend.removeItem(persistKey);
    } catch { /* ignore */ }
  }, [persistKey, storageBackend]);

  const jumpTo = useCallback((index: number) => {
    const totalLen = pastRef.current.length + 1 + futureRef.current.length;
    if (index < 0 || index >= totalLen) return;
    const currentIdx = pastRef.current.length;
    if (index === currentIdx) return;
    setCurrent((prev) => {
      // Build a single combined timeline, then split at the new index.
      const combined = [...pastRef.current, prev, ...futureRef.current];
      const next = combined[index]!;
      pastRef.current = combined.slice(0, index);
      futureRef.current = combined.slice(index + 1);
      return next;
    });
    tick();
  }, [tick]);

  return {
    current,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    undoCount: pastRef.current.length,
    redoCount: futureRef.current.length,
    timeline: [...pastRef.current, current, ...futureRef.current],
    currentIndex: pastRef.current.length,
    push,
    undo,
    redo,
    reset,
    jumpTo,
    clearPersisted,
  };
}
