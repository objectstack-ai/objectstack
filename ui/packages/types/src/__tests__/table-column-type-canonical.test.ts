/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * VALUE-LEVEL parity pin for `TableColumn.type` (objectui#5853, maintainer
 * ruling 2026-08-25, Option B: the 8-literal interface union is canonical).
 *
 * ## Why a value-level pin exists at all
 *
 * objectui#5684's anti-drift guard is KEY-SET only — it checks that a key is
 * present on both the interface and its zod mirror. It cannot see a VALUE
 * schema diverging, which is exactly how this instance survived while its
 * siblings were caught: `type` was present on both sides the whole time, the
 * interface declaring 8 literals and the mirror declaring `z.string()`. Without
 * a pin at the value level the three ends re-diverge silently.
 *
 * ## ⭐ A new inference value turning this file red is BY DESIGN
 *
 * If a producer starts inferring a new column type, or the renderer starts
 * branching on a spelling the interface does not publish, the read-set pin
 * below goes red. That is the alarm working, not a defect in the alarm.
 * ⛔ Do NOT "fix" it by loosening the mirror back toward `z.string()` or by
 * appending the new spelling to the alias table. The two correct repairs are:
 * add the value to {@link TABLE_COLUMN_TYPES} (all three ends move together,
 * `minor` + a changeset), or fold it at the producer's emit seam so the
 * undeclared spelling never reaches the slot — the repair this card shipped.
 *
 * The renderer-source half of the pin lives next to the renderer, in
 * `packages/components/src/renderers/complex/__tests__/`.
 */

import { describe, it, expect } from 'vitest';
import { FieldType as SpecFieldTypeEnum } from '@objectstack/spec/data';
import { TABLE_COLUMN_TYPES, normalizeTableColumnType } from '../data-display';
import type { TableColumnType } from '../data-display';
import { TableColumnSchema } from '../zod/data-display.zod';

/** The `type` member's declared options, read off the live zod schema. */
function mirrorOptions(): string[] {
  const shape = (TableColumnSchema as unknown as { shape: Record<string, any> }).shape;
  const member = shape.type;
  const inner = typeof member?.unwrap === 'function' ? member.unwrap() : member;
  return [...(inner.options as string[])];
}

describe('the canonical vocabulary is declared exactly once', () => {
  it('publishes the 8 literals the ruling made canonical', () => {
    expect([...TABLE_COLUMN_TYPES]).toEqual([
      'text', 'number', 'date', 'datetime', 'currency', 'percent', 'boolean', 'action',
    ]);
  });

  it('the zod mirror enumerates the SAME values, in the same order', () => {
    // The mirror builds its `z.enum` from `TABLE_COLUMN_TYPES`, so this is a
    // guard against someone restating the members by hand — the shape the
    // divergence took last time.
    expect(mirrorOptions()).toEqual([...TABLE_COLUMN_TYPES]);
  });

  it('the mirror is no longer a bare string — `money` is refused loudly', () => {
    // The card's headline defect: this parsed GREEN, matched no renderer
    // branch, and the column silently fell through to plain text rendering.
    const bad = TableColumnSchema.safeParse({ header: 'A', accessorKey: 'a', type: 'money' });
    expect(bad.success).toBe(false);
    // Loud means the failure NAMES the key, so an author can act on it.
    expect(bad.error!.issues[0]!.path).toEqual(['type']);
  });

  it.each(['int', 'integer', 'float', 'double', 'datetime-local', 'select', 'banana'])(
    'refuses the out-of-union spelling %s at parse time',
    (spelling) => {
      expect(
        TableColumnSchema.safeParse({ header: 'A', accessorKey: 'a', type: spelling }).success,
      ).toBe(false);
    },
  );

  it.each([...TABLE_COLUMN_TYPES])('accepts the declared spelling %s', (spelling) => {
    expect(
      TableColumnSchema.safeParse({ header: 'A', accessorKey: 'a', type: spelling }).success,
    ).toBe(true);
  });

  it('the key stays optional — a column with no type is still valid', () => {
    expect(TableColumnSchema.safeParse({ header: 'A', accessorKey: 'a' }).success).toBe(true);
  });
});

describe('normalizeTableColumnType is TOTAL over everything a producer can emit', () => {
  const declared = new Set<string>(TABLE_COLUMN_TYPES);

  it('is identity on every declared spelling', () => {
    for (const t of TABLE_COLUMN_TYPES) {
      expect(normalizeTableColumnType(t)).toBe(t);
    }
  });

  it.each([
    ['int', 'number'],
    ['integer', 'number'],
    ['float', 'number'],
    ['double', 'number'],
    ['datetime-local', 'datetime'],
  ] as const)('folds the undeclared dialect %s onto %s', (alias, canonical) => {
    expect(normalizeTableColumnType(alias)).toBe(canonical);
  });

  it('never yields an undeclared value for ANY spec FieldType', () => {
    // The load-bearing property. Column inference reads an object schema's
    // field type, whose vocabulary is the spec's — 49 values, only 7 of them
    // members of this union. Forwarding that verbatim is what made the
    // declaration a lie; the fold is what makes it true again.
    const specTypes = SpecFieldTypeEnum.options as readonly string[];
    expect(specTypes.length).toBeGreaterThan(40);

    const leaked: string[] = [];
    for (const t of specTypes) {
      const out = normalizeTableColumnType(t);
      if (out !== undefined && !declared.has(out)) leaked.push(`${t} -> ${out}`);
    }
    expect(leaked).toEqual([]);
  });

  it('drops the ANNOTATION for an out-of-union type rather than guessing text', () => {
    // T1's general case. `undefined` says only what is true — this column's
    // type is not one of the 8. `'text'` would assert something false about a
    // `lookup` column, and that lie would leak into any future reader of the
    // key. The COLUMN itself is never dropped; only this annotation is.
    for (const t of ['select', 'lookup', 'user', 'file', 'formula', 'json', 'vector']) {
      expect(normalizeTableColumnType(t)).toBeUndefined();
    }
  });

  it('is undefined-safe for the non-string values a loose producer can hand it', () => {
    for (const v of [undefined, null, 42, {}, [], true]) {
      expect(normalizeTableColumnType(v)).toBeUndefined();
    }
  });

  it('returns a value assignable to TableColumnType, so the fold types the slot', () => {
    const out: TableColumnType | undefined = normalizeTableColumnType('int');
    expect(out).toBe('number');
  });
});
