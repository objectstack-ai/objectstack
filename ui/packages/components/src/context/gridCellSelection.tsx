/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * GridCellSelection — the select-first cell model of a data-table, opted into
 * by a HOST, never by metadata (objectstack#35684, objectstack#35687).
 *
 * Inside a provider whose value is not `null`, a data cell is SELECTED by a
 * single click, never edited by it and never opening the record. An editor
 * opens on double-click, Enter, F2 or typing (Space included; a two-state
 * cell flips instead); the title link or a touch tap opens the record; Esc
 * cancels; Enter and Tab commit and move (in a multi-line editor Enter is a
 * newline and Ctrl/Cmd+Enter commits). A cell that opens no editor says why
 * in place. Outside a provider (`null`, the default) the table keeps its
 * click-to-edit / click-to-open behaviour byte for byte, so every host that
 * does not mount this keeps what it had.
 *
 * `ObjectGrid` mounts it around the table it draws, when its host asks for the
 * model (`ListView`, the list page, does).
 */

import React from 'react';

/** What a host knows about one cell that the table cannot read off a column. */
export interface GridCellFacts {
  /**
   * Why this cell opens no editor, as a sentence in the reader's language.
   * Present ⇒ the cell selects but never edits, and an attempt to edit it
   * (double-click, Enter, F2, typing) shows this sentence on the cell.
   */
  readOnlyReason?: string | null;
  /**
   * What a printable key typed on the selected cell does: `replace` opens the
   * editor with the typed text in place of the value (text, numbers); `open`
   * opens the editor over the value and the key is not written (a picker, a
   * date). Absent ⇒ the table decides from the column's type.
   */
  typing?: 'replace' | 'open';
  /** A two-state value: a click on the selected cell, or Space, flips it and commits. */
  toggles?: boolean;
  /**
   * The value pasted text stands for in this cell, or `undefined` when the
   * text is not one (Ctrl/Cmd+V on the selected cell then writes nothing).
   */
  fromText?: (text: string) => unknown;
  /**
   * Where this cell's editor draws: `below` opens it as a panel under the
   * cell, which keeps showing its value (a picker: a list, a calendar); absent
   * or `cover`, the editor is a layer over the cell itself (typed input).
   */
  editor?: 'cover' | 'below';
  /**
   * Why Backspace or Delete on the selected cell leaves it as it is (a
   * required field), as a sentence in the reader's language. Absent ⇒ those
   * keys clear the cell and save at once.
   */
  clearRefusal?: string | null;
  /**
   * Why a value committed into this cell is refused before it is saved, or
   * `null` when it is accepted. A refused commit keeps the editor open with
   * what was typed, and says the reason under it; Escape discards.
   */
  validate?: (value: unknown) => string | null | undefined;
}

export interface GridCellSelection {
  /** The host's facts for one cell; asked when the reader acts on it, never per render. */
  describeCell?: (row: any, columnKey: string) => GridCellFacts | null | undefined;
  /** Called when a cell becomes the selected one (a host may prefetch what an edit will need). */
  onCellSelect?: (row: any, columnKey: string) => void;
  /**
   * Asked when a value is committed into a cell (an editor's commit, a toggle
   * or a paste) that changes what the cell shows, before anything is staged
   * or saved. A promise holds the write until it settles: `true` writes the
   * value as any commit is written, `false` (or a rejection) writes nothing
   * and the cell keeps what it showed. `null` / `undefined` ⇒ no question;
   * the value is written at once. Only a table that saves each cell as it is
   * committed (one wired with `onRowSave`) asks; a table on `onBatchSave`
   * alone never does. A host asks, for example, before a move of a
   * state-machine field (objectstack#35685).
   */
  confirmCommit?: (row: any, columnKey: string, value: unknown) => Promise<boolean> | null | undefined;
}

const GridCellSelectionContext = React.createContext<GridCellSelection | null>(null);

export function GridCellSelectionProvider({
  value,
  children,
}: {
  value: GridCellSelection | null;
  children: React.ReactNode;
}): React.ReactElement {
  return <GridCellSelectionContext.Provider value={value}>{children}</GridCellSelectionContext.Provider>;
}

/** The select-first cell model in force here, or `null` when no host asked for it. */
export function useGridCellSelection(): GridCellSelection | null {
  return React.useContext(GridCellSelectionContext);
}
