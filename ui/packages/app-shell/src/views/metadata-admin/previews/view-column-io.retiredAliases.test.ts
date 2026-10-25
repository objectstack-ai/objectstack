// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `view-column-io` reads a column's identity in the CANONICAL spelling only
 * (objectui#5725) — the editor-side half of the retirement `ViewColumnInspector`
 * landed one file over in objectui#5344.
 *
 * `ListColumn` refuses `accessorKey` / `header` by name (`unrecognized_keys`),
 * so a column carrying them has no field key and no label the spec recognises.
 * These helpers nevertheless read both, which produced two distinct defects —
 * pinned separately below because they are separate legs, not one:
 *
 *   1. `colLabel`'s chain was `label ?? header ?? field ?? accessorKey`:
 *      INVERTED, not merely tolerant. `header` was preferred OVER `field`, so a
 *      canonical column carrying a stray `header` displayed the undeclared
 *      alias INSTEAD of its own declared identity.
 *   2. `colFieldName` backs `usedFieldNames()`, which the Add-field picker
 *      consults, so a spec-refused column RESERVED a field name — a display
 *      alias leaking into a non-display decision.
 *
 * The counter-probe rows are load-bearing: "the aliases are gone" is otherwise
 * satisfiable by breaking the label and the reservation outright.
 */

import { describe, it, expect } from 'vitest';
import { colFieldName, colLabel, usedFieldNames } from './view-column-io';

/** The stored shape the whole retirement family is about. */
const LEGACY = { accessorKey: 'name', header: 'Name' };

describe('view-column-io · colLabel reads the canonical spelling only', () => {
  it('names a spec-refused column positionally, never by its retired alias', () => {
    // Not `''`: the positional fallback is what keeps the row clickable, and
    // it is the only reason dropping the alias is safe for the LIST surface
    // (the asymmetry objectui#5725 named — an empty field-key box invites
    // re-authoring, an empty list row would leave nothing to click).
    expect(colLabel(LEGACY, 0)).toBe('col 1');
    expect(colLabel({ header: 'Name' }, 3)).toBe('col 4');
    expect(colLabel({ accessorKey: 'name' }, 0)).toBe('col 1');
  });

  it('lets a DECLARED identity outrank a stray undeclared alias', () => {
    // The inverted-precedence leg. Pre-change these read 'STRAY'/'STRAY'.
    expect(colLabel({ field: 'name', label: 'Name', header: 'STRAY' }, 0)).toBe('Name');
    expect(colLabel({ field: 'name', header: 'STRAY' }, 0)).toBe('name');
  });

  it('counter-probe: canonical and bare-string columns are untouched', () => {
    expect(colLabel({ field: 'amount', label: 'Amount' }, 0)).toBe('Amount');
    expect(colLabel({ field: 'amount' }, 0)).toBe('amount');
    expect(colLabel('amount', 0)).toBe('amount');
    expect(colLabel('', 0)).toBe('col 1');
    expect(colLabel(null, 1)).toBe('col 2');
  });
});

describe('view-column-io · colFieldName / usedFieldNames bind the canonical key only', () => {
  it('does not let a spec-refused column bind a field name', () => {
    expect(colFieldName(LEGACY)).toBeUndefined();
    expect(colFieldName({ accessorKey: 'name' })).toBeUndefined();
  });

  it('does not let a spec-refused column RESERVE a name in the picker', () => {
    // The reachability claim: this Set is what the Add-field picker reads.
    // Pre-change it contained 'name', so the picker reported the field as
    // already taken for a column no accepted document actually binds.
    expect([...usedFieldNames([LEGACY])]).toEqual([]);
  });

  it('counter-probe: canonical and bare-string columns still reserve their names', () => {
    expect(colFieldName({ field: 'amount', label: 'Amount' })).toBe('amount');
    expect(colFieldName('amount')).toBe('amount');
    expect([...usedFieldNames([{ field: 'amount' }, 'status', LEGACY])].sort()).toEqual([
      'amount',
      'status',
    ]);
  });
});
