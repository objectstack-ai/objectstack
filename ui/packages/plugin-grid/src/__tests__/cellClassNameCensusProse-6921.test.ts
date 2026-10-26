/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6921 — the schema-slot census in `ObjectGrid.tsx` names the cell
 * population the SCHEMA-level `cellClassName` actually reaches, and no longer
 * records the key as HELD.
 *
 * ## Why a prose pin at all
 *
 * The census entry for `cellClassName` was wrong on two axes for three days:
 * it said the key was "folded into every body cell's `className`" (false the
 * day it was written — the key reaches three UTILITY cells and never a data
 * cell), and it recorded the key as HELD pending a `packages/types` ruling
 * that landed on 2026-08-30 (objectui#6882). The second is the sharper
 * failure: a stale prohibition stops the next reader from checking at all.
 * objectui#7196 re-derived and corrected both halves; nothing pinned the
 * corrected wording, so the next drift would again be caught by a reader or
 * not at all.
 *
 * ## The discriminating question this suite is built around
 *
 * Would a comment STRICTLY WORSE than today's pass? A pin that only says "the
 * entry does not contain 'every body cell'" is satisfied by deleting the entry
 * — and a missing seam-census note is worse than a wrong one, because the next
 * reader then has nothing to check against. So the assertions below are
 * positive first: the entry is PRESENT, it names the measured cell set, it
 * names the per-column twin the data cell folds instead, and it says the hold
 * is over. Only then is the stale form refused.
 *
 * ## What "the measured cell set" means here
 *
 * The three names asserted below are not this file's opinion; they are what
 * `packages/components/src/renderers/complex/__tests__/data-table-cellClassName-population-6921.test.tsx`
 * measures in the rendered DOM — which cells carry a schema-level probe class
 * and which carry a column-level one. That suite is the fence (the data cell
 * must NOT fold the schema-level key) and the non-regression (the three utility
 * cells must); this one keeps the prose agreeing with it.
 *
 * ## Extraction, and its own controls
 *
 * The entry is located structurally — the list item that begins with the
 * key's name inside the census docblock, up to the next item or blank comment
 * line — and normalised (comment prefixes stripped, whitespace collapsed) so
 * a re-wrap does not move the verdict. The extractor is shown able to FIND
 * (the sibling `renderCellEditor` entry) and able to say ABSENT (a key the
 * census never listed), so a "present" verdict is not an extractor that
 * matches anything.
 *
 * Measured red before green, on the committed tree: the entry deleted → red
 * on presence; the pre-#7196 wording re-inserted ("HELD. Live: … folds it into
 * every body cell's `className` … same pending ruling") → red on the stale-form
 * refusals and on the missing cell names.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GRID_SOURCE = path.resolve(HERE, '../ObjectGrid.tsx');
const gridSource = readFileSync(GRID_SOURCE, 'utf8');

/**
 * The cell set the DOM suite in `@object-ui/components` measures — spelled the
 * way the census prose spells it. Kept as one list so the two files cannot
 * drift apart silently: change the measurement, and this list (and the prose)
 * must move with it.
 */
const MEASURED_UTILITY_CELLS = ['selection', 'row-number', 'row-actions'] as const;

/** A line of block-comment prose with its ` * ` prefix removed. */
const stripPrefix = (line: string) => line.replace(/^\s*\*\s?/, '');

/** Prose normalised for matching: prefixes off, whitespace collapsed. */
const normalise = (lines: string[]) => lines.map(stripPrefix).join(' ').replace(/\s+/g, ' ').trim();

/**
 * The census list entry for `key` under the heading
 * "### What the two entries used to say, and what is true instead".
 *
 * Returns `null` when the heading or the entry is absent — the "absent" answer
 * the presence pin needs in order to mean anything.
 */
function censusEntry(key: string): string | null {
  const lines = gridSource.split('\n');
  const heading = lines.findIndex((l) => /^\s*\*\s+### What the two entries used to say/.test(l));
  if (heading < 0) return null;
  const itemRe = new RegExp(`^\\s*\\*\\s+- \`${key}\` —`);
  let start = -1;
  for (let i = heading + 1; i < lines.length; i++) {
    if (/^\s*\*\/\s*$/.test(lines[i])) break; // end of the docblock
    if (itemRe.test(lines[i])) { start = i; break; }
  }
  if (start < 0) return null;
  const collected = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*\*\s*$/.test(l)) break; // blank comment line ends the item
    if (/^\s*\*\s+- `/.test(l)) break; // next list item
    if (/^\s*\*\/\s*$/.test(l)) break; // end of the docblock
    collected.push(l);
  }
  return normalise(collected);
}

/**
 * The docblock immediately above the `key?: …;` member inside
 * `export type ObjectGridDataTableSchemaHolds = { … }`, or `null`.
 */
function holdsMemberDoc(key: string): string | null {
  const lines = gridSource.split('\n');
  const open = lines.findIndex((l) => /^export type ObjectGridDataTableSchemaHolds = \{/.test(l));
  if (open < 0) return null;
  const memberRe = new RegExp(`^\\s+${key}\\?:`);
  for (let i = open + 1; i < lines.length; i++) {
    if (/^\};/.test(lines[i])) return null; // type closed without the member
    if (!memberRe.test(lines[i])) continue;
    // Walk back over the docblock that ends on the line above the member.
    let end = i - 1;
    while (end > open && /^\s*$/.test(lines[end])) end--;
    if (!/\*\/\s*$/.test(lines[end])) return null; // no docblock
    let begin = end;
    while (begin > open && !/^\s*\/\*\*/.test(lines[begin])) begin--;
    const body = lines.slice(begin, end + 1).map((l) => l.replace(/^\s*\/\*\*\s?/, '').replace(/\*\/\s*$/, ''));
    return normalise(body);
  }
  return null;
}

describe('objectui#6921 — the ObjectGrid schema-slot census names the cells cellClassName reaches, and the hold is over', () => {
  /**
   * Extractor controls first: it can FIND a sibling entry and it can say
   * ABSENT for a key the census never carried. Without these, every "present"
   * below could be an extractor that returns a match for anything.
   */
  it('the extractor finds the sibling renderCellEditor entry and reports a never-listed key absent', () => {
    expect(censusEntry('renderCellEditor')).not.toBeNull();
    expect(censusEntry('zzNeverACensusEntry6921')).toBeNull();
    expect(holdsMemberDoc('renderCellEditor')).not.toBeNull();
    expect(holdsMemberDoc('zzNeverAHoldsMember6921')).toBeNull();
  });

  /**
   * PRESENCE — the half a delete-the-comment "fix" would fail. A census entry
   * for `cellClassName` exists under the correction heading.
   */
  it('the cellClassName census entry is PRESENT under the correction heading', () => {
    expect(censusEntry('cellClassName')).not.toBeNull();
  });

  /**
   * THE CORRECTED MECHANISM. The entry names each utility cell the DOM suite
   * measured, and names the per-column twin the data cell folds instead.
   */
  it('the entry names the three measured utility cells and the per-column twin the data cell folds', () => {
    const entry = censusEntry('cellClassName')!;
    for (const cell of MEASURED_UTILITY_CELLS) {
      expect(entry, `census entry should name the ${cell} cell`).toMatch(new RegExp(cell, 'i'));
    }
    expect(entry).toMatch(/never reaches a data cell/i);
    expect(entry).toMatch(/col\.cellClassName/);
  });

  /**
   * THE HOLD IS OVER. The entry says so in words, and the stale form —
   * "HELD. Live: … same pending ruling" — is gone. The one place the false
   * sentence may still appear is as a QUOTATION inside its own correction
   * ("described the key as folded …"); the live form ("folds it into every
   * body cell") is refused.
   */
  it('the entry records the hold as OVER and no longer carries the stale HELD-pending wording', () => {
    const entry = censusEntry('cellClassName')!;
    expect(entry).toMatch(/hold is over/i);
    expect(entry).toMatch(/bf97b98c8/);
    expect(entry).not.toMatch(/HELD\. Live/);
    expect(entry).not.toMatch(/pending ruling/i);
    expect(entry).not.toMatch(/folds (it|them|the key) into every body cell/i);
  });

  /**
   * THE SAME TWO AXES ON THE HOLDS TYPE. The member docblock above
   * `cellClassName?: string;` records the hold as REDUNDANT (declared upstream),
   * names the utility cells, and no longer says "every body cell".
   */
  it('the ObjectGridDataTableSchemaHolds member docblock agrees: redundant since #6882, three utility cells, never a data cell', () => {
    const doc = holdsMemberDoc('cellClassName')!;
    expect(doc).not.toBeNull();
    expect(doc).toMatch(/REDUNDANT since `bf97b98c8`/);
    for (const cell of MEASURED_UTILITY_CELLS) {
      expect(doc, `member docblock should name the ${cell} cell`).toMatch(new RegExp(cell, 'i'));
    }
    expect(doc).toMatch(/never into a data cell/i);
    expect(doc).not.toMatch(/^HELD \(objectui#6459\)/);
    expect(doc).not.toMatch(/every body cell/i);
  });
});
