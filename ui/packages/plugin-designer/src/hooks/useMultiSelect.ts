/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useCallback } from 'react';

export interface MultiSelectState {
  /** Currently selected IDs */
  selectedIds: Set<string>;
  /** Toggle selection of an item (with shift for multi-select) */
  toggle: (id: string, shiftKey?: boolean) => void;
  /** Select a single item (clear others) */
  selectOne: (id: string) => void;
  /** Select multiple items */
  selectMany: (ids: string[]) => void;
  /** Clear all selections */
  clearSelection: () => void;
  /** Whether an item is selected */
  isSelected: (id: string) => boolean;
  /** Number of selected items */
  count: number;
}

/**
 * Hook for multi-select support in designers.
 */
export function useMultiSelect(): MultiSelectState {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string, shiftKey = false) => {
    setSelectedIds((prev) => {
      const next = new Set(shiftKey ? prev : []);
      if (prev.has(id) && shiftKey) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectOne = useCallback((id: string) => {
    setSelectedIds(new Set([id]));
  }, []);

  const selectMany = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  return {
    selectedIds,
    toggle,
    selectOne,
    selectMany,
    clearSelection,
    isSelected,
    count: selectedIds.size,
  };
}
