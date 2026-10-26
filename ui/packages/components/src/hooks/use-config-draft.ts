/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface UseConfigDraftOptions {
  /** Panel mode: 'create' starts dirty; 'edit' starts clean */
  mode?: 'create' | 'edit';
  /** Optional callback invoked on every field change */
  onUpdate?: (field: string, value: any) => void;
  /** Maximum undo history size (default: 50) */
  maxHistory?: number;
}

export interface UseConfigDraftReturn<T extends Record<string, any>> {
  /** The mutable draft copy */
  draft: T;
  /** Whether the draft differs from the source */
  isDirty: boolean;
  /** Update a single field in the draft */
  updateField: (field: string, value: any) => void;
  /** Revert draft back to source */
  discard: () => void;
  /** Low-level setter (use updateField for individual changes) */
  setDraft: React.Dispatch<React.SetStateAction<T>>;
  /** Undo the last change */
  undo: () => void;
  /** Redo a previously undone change */
  redo: () => void;
  /** Whether undo is available */
  canUndo: boolean;
  /** Whether redo is available */
  canRedo: boolean;
}

/**
 * Generic draft-state management for configuration panels.
 *
 * Mirrors the proven draft → save / discard pattern from ViewConfigPanel
 * while being reusable across Dashboard, Form, Page, Report, and any
 * future config panel. Includes undo/redo history support.
 *
 * @param source - The "committed" configuration object.
 * @param options - Optional mode and change callback.
 */
export function useConfigDraft<T extends Record<string, any>>(
  source: T,
  options?: UseConfigDraftOptions,
): UseConfigDraftReturn<T> {
  const maxHistory = options?.maxHistory ?? 50;
  const [draft, setDraft] = useState<T>({ ...source });
  const [isDirty, setIsDirty] = useState(options?.mode === 'create');
  const pastRef = useRef<T[]>([]);
  const futureRef = useRef<T[]>([]);
  const [, forceRender] = useState(0);

  // Reset draft when source identity changes
  useEffect(() => {
    setDraft({ ...source });
    setIsDirty(options?.mode === 'create');
    pastRef.current = [];
    futureRef.current = [];
  }, [source]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateField = useCallback(
    (field: string, value: any) => {
      setDraft((prev) => {
        pastRef.current = [...pastRef.current.slice(-(maxHistory - 1)), prev];
        futureRef.current = [];
        return { ...prev, [field]: value };
      });
      setIsDirty(true);
      forceRender((n) => n + 1);
      options?.onUpdate?.(field, value);
    },
    [options?.onUpdate, maxHistory], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return;
    setDraft((prev) => {
      const past = [...pastRef.current];
      const previous = past.pop()!;
      pastRef.current = past;
      futureRef.current = [prev, ...futureRef.current];
      return previous;
    });
    forceRender((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    setDraft((prev) => {
      const future = [...futureRef.current];
      const next = future.shift()!;
      futureRef.current = future;
      pastRef.current = [...pastRef.current, prev];
      return next;
    });
    forceRender((n) => n + 1);
  }, []);

  const discard = useCallback(() => {
    setDraft({ ...source });
    setIsDirty(false);
    pastRef.current = [];
    futureRef.current = [];
    forceRender((n) => n + 1);
  }, [source]);

  return {
    draft,
    isDirty,
    updateField,
    discard,
    setDraft,
    undo,
    redo,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
  };
}
