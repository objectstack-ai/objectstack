/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The pure halves of `data-table`'s select-first cell model
 * (objectstack#35684, objectstack#35687; the model itself is
 * `GridCellSelection` in `../../context/gridCellSelection`).
 */
import type { TableColumn } from '@object-ui/types';

/**
 * A key the input method owns: pressed while a composition is open
 * (`isComposing`), or the 229 a browser reports for the key that ends one
 * (Safari raises the candidate-picking Enter after `compositionend`, as 229).
 * Enter, Esc, Tab and the arrows pressed then pick or move a candidate; the
 * table must not commit, cancel or move on them.
 */
export function isImeKey(e: { nativeEvent: KeyboardEvent; keyCode?: number }): boolean {
  return e.nativeEvent.isComposing === true || e.nativeEvent.keyCode === 229 || e.keyCode === 229;
}

/**
 * The attribute a link wears when a single click on it still follows it in a
 * select-first grid: the row's title link (the name column). Every other link
 * a cell draws is one of the cell's {@link cellOpenerAt openers}.
 */
export const OPENS_ON_CLICK_ATTRIBUTE = 'data-opens-on-click';

/**
 * The attribute a cell renderer puts on a non-link control that opens what the
 * value points at (an image thumbnail's lightbox), so the select-first grid
 * treats it as it treats a link.
 */
export const CELL_OPENER_ATTRIBUTE = 'data-cell-opener';

const CELL_OPENER_SELECTOR = `a[href]:not([${OPENS_ON_CLICK_ATTRIBUTE}]), [${CELL_OPENER_ATTRIBUTE}]`;

/**
 * What a cell draws that opens something — a mail, phone or web link, a
 * referenced record's chip, a file, an image — at or around `target`, or
 * `null`. In a select-first grid a plain click on one only selects the cell;
 * it is opened by a Ctrl/Cmd-click, the selected cell's open button or
 * Ctrl/Cmd+Enter.
 */
export function cellOpenerAt(target: EventTarget | null, cell: Element): HTMLElement | null {
  if (!(target instanceof Element) || !cell.contains(target)) return null;
  const opener = target.closest<HTMLElement>(CELL_OPENER_SELECTOR);
  return opener !== null && opener !== cell && cell.contains(opener) ? opener : null;
}

/** The first opener a cell draws (a cell of several chips opens the first), or `null`. */
export function firstCellOpener(cell: Element): HTMLElement | null {
  return cell.querySelector<HTMLElement>(CELL_OPENER_SELECTOR);
}

/**
 * A press on a control a cell draws (the title link, a button, a checkbox)
 * keeps its own click: it is not a press on the cell. A disabled control (a
 * read face's checkbox) has no click of its own, and an opener
 * ({@link cellOpenerAt}) is part of the value: a press on it is a press on
 * the cell.
 */
export function isCellWidgetTarget(target: EventTarget | null, cell: Element): boolean {
  if (!(target instanceof Element) || !cell.contains(target)) return false;
  if (cellOpenerAt(target, cell) !== null) return false;
  const widget = target.closest(
    'a[href], button, input, select, textarea, label, [role="link"], [role="button"], [role="checkbox"], [role="switch"], [contenteditable]:not([contenteditable="false"])',
  );
  return widget !== null && widget !== cell && cell.contains(widget)
    && !widget.matches('[data-slot="cell-type-catcher"], :disabled, [aria-disabled="true"]');
}

/**
 * Ctrl/Cmd plus a letter, whatever its case: CapsLock or Shift reports the
 * letter as upper case (`'C'`), and the shortcut is the same one.
 */
export function isCommandLetter(e: { key: string; ctrlKey: boolean; metaKey: boolean }, letter: string): boolean {
  return (e.ctrlKey || e.metaKey) && e.key.length === 1 && e.key.toLowerCase() === letter;
}

/** A printable key with no command modifier — what typing on a selected cell is. */
export function isPrintableKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
}

const TEXT_TYPED_COLUMN_TYPES: ReadonlySet<string> = new Set(['text', 'number', 'currency', 'percent']);
const NUMBER_COLUMN_TYPES: ReadonlySet<string> = new Set(['number', 'currency', 'percent']);

/** What typing does on a column the host says nothing about: text and figures take the typed text. */
export function defaultTyping(col: TableColumn): 'replace' | 'open' {
  if (col.foreignKey) return 'open';
  return col.type === undefined || TEXT_TYPED_COLUMN_TYPES.has(col.type) ? 'replace' : 'open';
}

/**
 * The value pasted text stands for in a column the host says nothing about,
 * or `undefined` when it stands for none (nothing is written then).
 */
export function defaultValueFromText(col: TableColumn, raw: string): unknown {
  const text = raw.replace(/\r?\n$/, '');
  if (col.foreignKey || col.type === 'action') return undefined;
  if (col.type && NUMBER_COLUMN_TYPES.has(col.type)) {
    const trimmed = text.trim();
    const n = trimmed === '' ? Number.NaN : Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }
  if (col.type === 'boolean') {
    const word = text.trim().toLowerCase();
    if (word === 'true' || word === '1' || word === 'yes') return true;
    if (word === 'false' || word === '0' || word === 'no') return false;
    return undefined;
  }
  if (col.type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(text.trim()) ? text.trim() : undefined;
  if (col.type === 'datetime') {
    const at = Date.parse(text.trim());
    return Number.isNaN(at) ? undefined : new Date(at).toISOString();
  }
  return text;
}

/** Put the caret after the last character of a text control (no-op where the control has no caret). */
export function caretToEnd(el: Element): void {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  try {
    const end = el.value.length;
    el.setSelectionRange(end, end);
  } catch {
    // `number`, `date` and friends have no selection API; focus is enough there.
  }
}

/** The control an injected editor hands the caret to, or `null` while it has not mounted one. */
export function firstEditorControl(host: Element): HTMLElement | null {
  return host.querySelector<HTMLElement>(
    'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
}
