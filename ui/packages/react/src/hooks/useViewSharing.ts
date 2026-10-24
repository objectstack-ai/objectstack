/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useCallback, useMemo } from 'react';

/** View sharing visibility aligned with ViewSharingSchema */
export type ViewVisibility = 'private' | 'team' | 'organization' | 'public';

/** A saved view configuration */
export interface SavedView {
  id: string;
  name: string;
  /** The view configuration (filters, sort, columns, etc.) */
  config: Record<string, unknown>;
  /** Who can see this view */
  visibility: ViewVisibility;
  /** Who created this view */
  createdBy?: string;
  /** Whether this is the default view */
  isDefault?: boolean;
  /** When the view was last modified */
  updatedAt: Date;
}

export interface ViewSharingResult {
  /** All available views */
  views: SavedView[];
  /** Currently active view */
  activeView: SavedView | null;
  /** Save a new view or update existing */
  saveView: (view: Omit<SavedView, 'id' | 'updatedAt'>) => string;
  /** Set the active view */
  setActiveView: (viewId: string) => void;
  /** Delete a view */
  deleteView: (viewId: string) => void;
  /** Duplicate a view */
  duplicateView: (viewId: string, newName: string) => string;
  /** Update view visibility */
  setVisibility: (viewId: string, visibility: ViewVisibility) => void;
}

let viewCounter = 0;

/**
 * Hook for managing shared/personal view configurations.
 * Implements ViewSharingSchema from @objectstack/spec v2.0.7.
 *
 * @example
 * ```tsx
 * const viewSharing = useViewSharing(initialViews);
 *
 * // Save current filters/sort as a named view
 * viewSharing.saveView({
 *   name: 'My Open Tasks',
 *   config: { filters: currentFilters, sort: currentSort },
 *   visibility: 'private',
 * });
 * ```
 */
export function useViewSharing(initialViews: SavedView[] = []): ViewSharingResult {
  const [views, setViews] = useState<SavedView[]>(initialViews);
  const [activeViewId, setActiveViewId] = useState<string | null>(
    initialViews.find((v) => v.isDefault)?.id ?? initialViews[0]?.id ?? null
  );

  const activeView = useMemo(
    () => views.find((v) => v.id === activeViewId) ?? null,
    [views, activeViewId]
  );

  const saveView = useCallback(
    (input: Omit<SavedView, 'id' | 'updatedAt'>): string => {
      const id = `view-${++viewCounter}`;
      const view: SavedView = {
        ...input,
        id,
        updatedAt: new Date(),
      };
      setViews((prev) => [...prev, view]);
      return id;
    },
    []
  );

  const setActiveView = useCallback((viewId: string) => {
    setActiveViewId(viewId);
  }, []);

  const deleteView = useCallback((viewId: string) => {
    setViews((prev) => prev.filter((v) => v.id !== viewId));
    setActiveViewId((current) => (current === viewId ? null : current));
  }, []);

  const duplicateView = useCallback(
    (viewId: string, newName: string): string => {
      const original = views.find((v) => v.id === viewId);
      if (!original) return '';
      const id = `view-${++viewCounter}`;
      const duplicate: SavedView = {
        ...original,
        id,
        name: newName,
        isDefault: false,
        updatedAt: new Date(),
      };
      setViews((prev) => [...prev, duplicate]);
      return id;
    },
    [views]
  );

  const setVisibility = useCallback(
    (viewId: string, visibility: ViewVisibility) => {
      setViews((prev) =>
        prev.map((v) =>
          v.id === viewId ? { ...v, visibility, updatedAt: new Date() } : v
        )
      );
    },
    []
  );

  return useMemo(
    () => ({
      views,
      activeView,
      saveView,
      setActiveView,
      deleteView,
      duplicateView,
      setVisibility,
    }),
    [views, activeView, saveView, setActiveView, deleteView, duplicateView, setVisibility]
  );
}
