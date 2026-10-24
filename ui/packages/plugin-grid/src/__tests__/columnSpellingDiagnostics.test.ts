/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The diagnostic that gives a dropped column an ADDRESS (objectui#5349).
 *
 * objectui#5068 made `ListColumnSchema`'s `field` / `label` the only column
 * spelling `ObjectGrid` reads. Right call — but a column authored the other way
 * then contributed nothing and NOTHING SAID SO. This file pins the two halves
 * of the answer as pure functions, so the message's wording is testable without
 * a DOM: `resolvesToDataColumn` (the renderer's own drop decision, shared so it
 * cannot drift from the reporter) and `describeUnresolvedColumns` (what the
 * author is told).
 *
 * Every "no diagnostic" case below is COUNTER-PROBED: the same input, mutated
 * by one key, must produce one — otherwise a silent predicate would read as a
 * clean bill of health, which is the exact failure mode this card exists to
 * remove.
 */
import { describe, it, expect } from 'vitest';
import {
  resolvesToDataColumn,
  partitionAuthoredColumns,
  describeUnresolvedColumns,
} from '../columnSpellingDiagnostics';

const ADDRESS = { blockType: 'object-grid', objectName: 'opportunities' };

describe('resolvesToDataColumn — the renderer drop decision, extracted (#5349)', () => {
  /**
   * Parity with the inline filter it replaced, case for case:
   * `col?.field && typeof col.field === 'string' && !col.hidden`.
   */
  const CASES: Array<[string, unknown, boolean]> = [
    ['declared column', { field: 'name', label: 'Name' }, true],
    ['declared column, bare', { field: 'name' }, true],
    ['hidden declared column', { field: 'name', hidden: true }, false],
    ['undeclared spelling', { accessorKey: 'name', header: 'Name' }, false],
    ['no field key', { label: 'Name' }, false],
    ['empty field', { field: '' }, false],
    ['non-string field', { field: 42 }, false],
    ['null field', { field: null }, false],
    ['null entry', null, false],
    ['undefined entry', undefined, false],
    ['string entry', 'name', false],
  ];

  it.each(CASES)('%s', (_label, col, expected) => {
    expect(resolvesToDataColumn(col)).toBe(expected);
  });

  it('matches the predicate ObjectGrid used inline before the extraction', () => {
    // The ratchet on "semantics unchanged": if someone widens one side, this
    // table disagrees with the other.
    const legacy = (col: any) => !!(col?.field && typeof col.field === 'string' && !col.hidden);
    for (const [, col] of CASES) {
      expect(resolvesToDataColumn(col)).toBe(legacy(col));
    }
  });
});

describe('partitionAuthoredColumns — hidden is intent, not a defect (#5349)', () => {
  it('counts resolved, hidden and unresolved apart', () => {
    const partition = partitionAuthoredColumns([
      { field: 'name', label: 'Name' },
      { field: 'secret', hidden: true },
      { accessorKey: 'amount', header: 'Amount' },
    ]);
    expect(partition).toEqual({
      resolved: 1,
      hidden: 1,
      unresolved: [{ index: 2, detail: expect.stringContaining('accessorKey') }],
    });
  });

  it('counts a hidden column as hidden even when it also mis-spells its identity', () => {
    // It contributes nothing either way, and the author asked for nothing.
    // Reporting it would be noise on top of a deliberate choice.
    const partition = partitionAuthoredColumns([{ accessorKey: 'amount', hidden: true }]);
    expect(partition).toEqual({ resolved: 0, hidden: 1, unresolved: [] });
  });

  it('abstains on the inputs it does not judge', () => {
    expect(partitionAuthoredColumns(undefined)).toBeNull();
    expect(partitionAuthoredColumns([])).toBeNull();
    expect(partitionAuthoredColumns(['name', 'amount'])).toBeNull(); // the string[] arm
    expect(partitionAuthoredColumns('name')).toBeNull();
  });
});

describe('describeUnresolvedColumns — silence, and the fallbacks that earn it (#5349)', () => {
  /**
   * The abstentions, each COUNTER-PROBED one key later. A predicate that
   * returned `null` for everything would pass the left column alone.
   */
  it('says nothing when there is no authored `columns` array', () => {
    expect(describeUnresolvedColumns(undefined, ADDRESS)).toBeNull();
    // counter-probe
    expect(describeUnresolvedColumns([{ accessorKey: 'a' }], ADDRESS)).not.toBeNull();
  });

  it('says nothing for an empty `columns` array — the grid auto-derives', () => {
    expect(describeUnresolvedColumns([], ADDRESS)).toBeNull();
    // counter-probe
    expect(describeUnresolvedColumns([{}], ADDRESS)).not.toBeNull();
  });

  it('says nothing for the `string[]` spelling — the other declared one', () => {
    expect(describeUnresolvedColumns(['name', 'amount'], ADDRESS)).toBeNull();
    // counter-probe: the same names as objects with no `field`
    expect(describeUnresolvedColumns([{ name: 'name' }], ADDRESS)).not.toBeNull();
  });

  it('says nothing when every column resolves', () => {
    expect(describeUnresolvedColumns([{ field: 'name' }, { field: 'amount' }], ADDRESS)).toBeNull();
    // counter-probe: one key renamed to the retired spelling
    expect(
      describeUnresolvedColumns([{ field: 'name' }, { accessorKey: 'amount' }], ADDRESS),
    ).not.toBeNull();
  });

  it('says nothing when the only non-resolving columns are `hidden`', () => {
    expect(
      describeUnresolvedColumns([{ field: 'name' }, { field: 'amount', hidden: true }], ADDRESS),
    ).toBeNull();
    // counter-probe: drop `hidden` and mis-spell the same entry
    expect(
      describeUnresolvedColumns([{ field: 'name' }, { accessorKey: 'amount' }], ADDRESS),
    ).not.toBeNull();
  });
});

describe('describeUnresolvedColumns — the message names the address (#5349)', () => {
  it('names block, object, index, the keys seen, and the rewrite that works', () => {
    const message = describeUnresolvedColumns(
      [{ accessorKey: 'name', header: 'Full Name' }, { accessorKey: 'amount', header: 'Amount' }],
      { blockType: 'object-grid', objectName: 'opportunities', label: 'Open Deals' },
    );
    expect(message).toContain('[ObjectUI] ObjectGrid columns:');
    expect(message).toContain("object-grid (objectName: 'opportunities', label: 'Open Deals')");
    expect(message).toContain('2 of 2 authored columns resolve to nothing');
    expect(message).toContain('row-number column and NO data columns');
    expect(message).toContain('columns[0]');
    expect(message).toContain('columns[1]');
    expect(message).toContain('`accessorKey`, `header`');
    // The rewrite, per column, built from what was actually authored.
    expect(message).toContain("Write `{ field: 'name', label: 'Full Name' }` instead.");
    expect(message).toContain("Write `{ field: 'amount', label: 'Amount' }` instead.");
    expect(message).toContain('`ListColumnSchema` (@objectstack/spec/ui)');
    expect(message).toContain('(objectui#5349)');
  });

  it('reports the partial case as partial — it does not claim the grid is empty', () => {
    const message = describeUnresolvedColumns(
      [{ field: 'name', label: 'Name' }, { accessorKey: 'amount', header: 'Amount' }],
      ADDRESS,
    )!;
    expect(message).toContain('1 of 2 authored columns resolve to nothing');
    expect(message).toContain('(1 still render)');
    expect(message).not.toContain('NO data columns');
    // Addressed by index — the surviving column is not named as a suspect.
    expect(message).toContain('columns[1]');
    expect(message).not.toContain('columns[0]');
  });

  it('names the block alias when the node was authored as `view:grid`', () => {
    const message = describeUnresolvedColumns([{ accessorKey: 'a' }], {
      blockType: 'view:grid',
      objectName: 'deals',
    })!;
    expect(message).toContain("view:grid (objectName: 'deals')");
  });

  it('says so when the grid names no object, instead of printing `undefined`', () => {
    const message = describeUnresolvedColumns([{ accessorKey: 'a' }], {})!;
    expect(message).toContain('object-grid (no objectName)');
    expect(message).not.toContain('undefined');
  });

  it('distinguishes the ways a column can fail to name a field', () => {
    const message = describeUnresolvedColumns(
      [{ label: 'Name' }, { field: '' }, { field: 42 }, {}, 'name', null],
      ADDRESS,
    )!;
    expect(message).toContain('columns[0]: keys seen: `label` — no `field` key');
    expect(message).toContain('columns[1]: keys seen: `field` — `field` is an empty string');
    expect(message).toContain('columns[2]: keys seen: `field` — `field` is a number (42)');
    expect(message).toContain('columns[3]: the entry is empty `{}`');
    expect(message).toContain("columns[4]: the entry is a string ('name'), not a column object");
    expect(message).toContain('columns[5]: the entry is null, not a column object');
  });

  it('omits the rewrite hint when the retired key carries nothing to rewrite', () => {
    const message = describeUnresolvedColumns([{ accessorKey: 42, header: 'Amount' }], ADDRESS)!;
    expect(message).toContain('`accessorKey` / `header`');
    expect(message).not.toContain('Write `{ field:');
  });
});
