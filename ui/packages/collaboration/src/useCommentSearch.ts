/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useCallback, useMemo } from 'react';
import type { CommentEntry, CommentSearchResult } from '@object-ui/types';

export interface CommentSearchConfig {
  /** All comments across records, each must have objectName and recordId set */
  comments: CommentEntry[];
}

export interface CommentSearchReturn {
  /** Current search query */
  query: string;
  /** Update the search query */
  setQuery: (query: string) => void;
  /** Filtered/matched results */
  results: CommentSearchResult[];
  /** Whether a search is active */
  isSearching: boolean;
  /** Clear the search */
  clearSearch: () => void;
}

/**
 * Build a highlighted snippet around the first match of `query` in `text`.
 * Returns the match wrapped in <mark> tags for display.
 */
function buildHighlight(text: string, query: string): string {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + query.length + 30);
  const before = start > 0 ? '…' : '';
  const after = end < text.length ? '…' : '';
  return `${before}${text.slice(start, end)}${after}`;
}

/**
 * Hook for searching comments across all records.
 *
 * Accepts a flat list of CommentEntry items (each should have objectName
 * and recordId set) and provides a search interface that returns matching
 * results with highlighted snippets.
 */
export function useCommentSearch({ comments }: CommentSearchConfig): CommentSearchReturn {
  const [query, setQuery] = useState('');

  const isSearching = query.trim().length > 0;

  const results = useMemo<CommentSearchResult[]>(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];

    return comments
      .filter(c => {
        const textMatch = c.text.toLowerCase().includes(trimmed);
        const authorMatch = c.author.toLowerCase().includes(trimmed);
        return textMatch || authorMatch;
      })
      .map(c => ({
        comment: c,
        objectName: c.objectName ?? '',
        recordId: c.recordId ?? '',
        highlight: buildHighlight(c.text, trimmed),
      }));
  }, [query, comments]);

  const clearSearch = useCallback(() => {
    setQuery('');
  }, []);

  return {
    query,
    setQuery,
    results,
    isSearching,
    clearSearch,
  };
}
