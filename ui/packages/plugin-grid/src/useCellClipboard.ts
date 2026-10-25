/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useCallback, useEffect } from 'react';

/** A cell range described by start/end row and column indices. */
export interface CellRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface UseCellClipboardOptions {
  /** Full data rows currently displayed in the grid. */
  data: Record<string, any>[];
  /** Ordered column keys matching the grid's visible columns. */
  columns: string[];
  /** Callback invoked when pasted values should be applied. */
  onPaste?: (changes: { rowIndex: number; field: string; value: string }[]) => void;
  /** Whether clipboard interaction is enabled. */
  enabled?: boolean;
}

export interface UseCellClipboardResult {
  /** Currently selected cell range (null when nothing is selected). */
  selectedRange: CellRange | null;
  /** Programmatically update the selected range. */
  setSelectedRange: (range: CellRange | null) => void;
  /** Copy handler – reads selected range and writes tab-separated text to clipboard. */
  onCopy: () => void;
  /** Paste handler – reads tab-separated text from clipboard and emits changes. */
  onPaste: () => void;
  /** Keyboard handler to attach to the grid container element. */
  onKeyDown: (e: React.KeyboardEvent) => void;
}

/**
 * Normalise a CellRange so that start ≤ end for both axes.
 */
function normaliseRange(range: CellRange): CellRange {
  return {
    startRow: Math.min(range.startRow, range.endRow),
    startCol: Math.min(range.startCol, range.endCol),
    endRow: Math.max(range.startRow, range.endRow),
    endCol: Math.max(range.startCol, range.endCol),
  };
}

/**
 * Hook for single-cell and multi-cell copy/paste with Excel-compatible
 * tab-separated format.
 *
 * Attach `onKeyDown` to the grid container to handle Ctrl+C / Ctrl+V.
 */
export function useCellClipboard({
  data,
  columns,
  onPaste: onPasteCallback,
  enabled = true,
}: UseCellClipboardOptions): UseCellClipboardResult {
  const [selectedRange, setSelectedRange] = useState<CellRange | null>(null);

  const onCopy = useCallback(() => {
    if (!enabled || !selectedRange) return;
    const { startRow, startCol, endRow, endCol } = normaliseRange(selectedRange);
    const lines: string[] = [];

    for (let r = startRow; r <= endRow; r++) {
      const row = data[r];
      if (!row) continue;
      const cells: string[] = [];
      for (let c = startCol; c <= endCol; c++) {
        const field = columns[c];
        cells.push(field ? String(row[field] ?? '') : '');
      }
      lines.push(cells.join('\t'));
    }

    const text = lines.join('\n');
    void navigator.clipboard.writeText(text);
  }, [enabled, selectedRange, data, columns]);

  const onPaste = useCallback(() => {
    if (!enabled || !selectedRange || !onPasteCallback) return;
    const { startRow, startCol } = normaliseRange(selectedRange);

    void navigator.clipboard.readText().then((text) => {
      const changes: { rowIndex: number; field: string; value: string }[] = [];
      const lines = text.split('\n');

      for (let r = 0; r < lines.length; r++) {
        const cells = lines[r].split('\t');
        for (let c = 0; c < cells.length; c++) {
          const rowIndex = startRow + r;
          const colIndex = startCol + c;
          const field = columns[colIndex];
          if (field && rowIndex < data.length) {
            changes.push({ rowIndex, field, value: cells[c] });
          }
        }
      }

      if (changes.length > 0) {
        onPasteCallback(changes);
      }
    });
  }, [enabled, selectedRange, columns, data.length, onPasteCallback]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!enabled) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'c') {
        e.preventDefault();
        onCopy();
      } else if (mod && e.key === 'v') {
        e.preventDefault();
        onPaste();
      }
    },
    [enabled, onCopy, onPaste],
  );

  // Clear selection when clipboard features are disabled.
  useEffect(() => {
    if (!enabled) setSelectedRange(null);
  }, [enabled]);

  return { selectedRange, setSelectedRange, onCopy, onPaste, onKeyDown };
}
