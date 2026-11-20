/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Undo of a list cell's save (objectstack#35685).
 *
 * A select-first grid saves each committed cell at once, so the save itself is
 * what Undo takes back: the save toast's Undo button, or Ctrl+Z (Cmd+Z) on the
 * grid. Undo is a new guarded update that writes the values the record held
 * before the save, never a local rollback, so the server's rules, hooks and
 * audit see it as the write it is.
 */

/** One landed cell save that Undo can still take back. */
export interface CellSaveUndo {
  /** The object the save wrote, so a grid pointed elsewhere never aims it at another. */
  objectName: string;
  /** The record the save wrote. */
  id: string;
  /** The version the save's write answered: what Undo's `If-Match` falls back to. */
  version: string | undefined;
  /** What Undo sends: each written field's value before the save, as stored. */
  restore: Record<string, unknown>;
  /** What Undo draws: each written field as the row showed it before the save. */
  shown: Record<string, unknown>;
}

/** The most saves one grid keeps for Undo; the oldest goes first. */
export const CELL_UNDO_LIMIT = 50;

/** The grid's saves Undo can take back, newest last. */
export interface CellUndoStack {
  push(entry: CellSaveUndo): void;
  /** Take `entry` off the stack: `false` when it is no longer on it. */
  take(entry: CellSaveUndo): boolean;
  /** The newest save, or `undefined` when there is none. */
  peek(): CellSaveUndo | undefined;
}

export function createCellUndoStack(limit = CELL_UNDO_LIMIT): CellUndoStack {
  const entries: CellSaveUndo[] = [];
  return {
    push(entry) {
      entries.push(entry);
      if (entries.length > limit) entries.splice(0, entries.length - limit);
    },
    take(entry) {
      const at = entries.lastIndexOf(entry);
      if (at < 0) return false;
      entries.splice(at, 1);
      return true;
    },
    peek() {
      return entries[entries.length - 1];
    },
  };
}

/** The undo key: Ctrl+Z, or Cmd+Z, with no Shift (redo) and no Alt. */
export function isCellUndoKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z';
}

/**
 * The grid cell a key pressed on `target` is meant for, when it is one of
 * `root`'s own cells and no editor holds the key: the selected cell's typing
 * catcher, or the cell itself. An open editor keeps Ctrl+Z as the field's own
 * text undo, and a cell of a grid nested inside this one (a related list in
 * the record drawer) belongs to that grid.
 */
export function undoKeyCellOf(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function' || !root.contains(el)) return null;
  const onCatcher = el.matches('[data-slot="cell-type-catcher"]');
  const tag = el.tagName.toUpperCase();
  if (!onCatcher && (el.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) return null;
  const cell = el.closest<HTMLElement>('[data-grid-cell]');
  if (!cell || cell.closest('[data-object-grid-root]') !== root) return null;
  return cell.hasAttribute('data-editing-cell') ? null : cell;
}
