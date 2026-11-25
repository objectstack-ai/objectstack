// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A relationship field's boolean `inlineEdit` RETIRED (#35926) — ADR-0049
 * enforce-or-remove through the ADR-0087 D2 route, on the field-group ruling
 * of #35889 (「一律只看分组」): a field group of the parent decides whether the
 * parent's form inlines a child, and `true` and `false` both read as an absent
 * key at every reader, so the boolean arm leaves the vocabulary.
 *
 * - §1 THE REFUSAL: `true` and `false` are refused with the prescription, at
 *   the key, through both channels (`tsc` and the parse); `'grid'`, `'form'`
 *   and absence still parse, and an unknown string keeps zod's own message.
 * - §2 THE REGISTRATION: the conversion's delete, and the ADR-0087 entries the
 *   upgrade path reads.
 *
 * No tree-scoped absence pin: the view-level `inlineEdit` is a different, live
 * boolean key, so a text scan cannot tell a retired spelling from a live one.
 * The sweep is the input type (`tsc` refuses a boolean at every typed site)
 * and the parse (every untyped site that reaches `defineStack` / `os validate`).
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';

import { FieldSchema, type Field } from './field.zod';
import { collectConversionNotices } from '../conversions/apply';
import { ALL_CONVERSIONS } from '../conversions/registry';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';

const FK = { type: 'master_detail', reference: 'order' } as const;

function issues(result: z.ZodSafeParseResult<unknown>): { code: string; path: string }[] {
  if (result.success) return [];
  return result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') }));
}

const PRESCRIPTION =
  /^`field\.inlineEdit: true` and `field\.inlineEdit: false` were removed in @objectstack\/spec 19\.0\.0 \(ADR-0049 enforce-or-remove\) — .*`fieldGroups\[\]\.relatedList`.*Delete the key, or write `'grid'`.*Run `os migrate meta --from 17`/s;

describe('§1 the boolean arm of `inlineEdit` is refused', () => {
  for (const value of [true, false]) {
    it(`refuses inlineEdit: ${value} with the prescription, at the key`, () => {
      const r = FieldSchema.safeParse({ ...FK, inlineEdit: value });
      expect(r.success).toBe(false);
      expect(issues(r)).toEqual([{ code: 'invalid_value', path: 'inlineEdit' }]);
      expect(r.success ? '' : r.error.issues[0]!.message).toMatch(PRESCRIPTION);
    });
  }

  for (const value of ['grid', 'form'] as const) {
    it(`keeps inlineEdit: '${value}' (control)`, () => {
      const r = FieldSchema.safeParse({ ...FK, inlineEdit: value });
      expect(issues(r)).toEqual([]);
      expect(r.success && r.data.inlineEdit).toBe(value);
    });
  }

  it('keeps an absent key absent (control)', () => {
    const r = FieldSchema.safeParse({ ...FK });
    expect(issues(r)).toEqual([]);
    expect(r.success && r.data).not.toHaveProperty('inlineEdit');
  });

  it("answers an unknown string with zod's own message, not the prescription", () => {
    const r = FieldSchema.safeParse({ ...FK, inlineEdit: 'table' });
    expect(issues(r)).toEqual([{ code: 'invalid_value', path: 'inlineEdit' }]);
    expect(r.success ? '' : r.error.issues[0]!.message).not.toMatch(/was removed/);
  });

  it('is refused by tsc as well (the input type admits only the two form factors)', () => {
    // @ts-expect-error — the boolean arm is retired: `inlineEdit` takes 'grid' | 'form'.
    const field: Field = { ...FK, inlineEdit: true };
    expect(FieldSchema.safeParse(field).success).toBe(false);
  });
});

describe('§2 the conversion and the ADR-0087 entries', () => {
  const CONVERSION_ID = 'field-inline-edit-boolean-removed';
  const convert = (def: Record<string, unknown>, collection = 'objects') => {
    const owner = collection === 'objects' ? { name: 'order_line', fields: { order: def } } : { extend: 'order_line', fields: { order: def } };
    const { stack, notices } = collectConversionNotices({ [collection]: [owner] }, { includeRetired: true });
    const field = ((stack[collection] as Array<{ fields: Record<string, unknown> }>)[0]!).fields.order;
    return { field, notices: notices.filter((n) => n.conversionId === CONVERSION_ID) };
  };

  for (const value of [true, false]) {
    for (const collection of ['objects', 'objectExtensions']) {
      it(`deletes inlineEdit: ${value} on ${collection} and keeps the rest of the field`, () => {
        const { field, notices } = convert({ ...FK, inlineEdit: value }, collection);
        expect(field).toStrictEqual({ ...FK });
        expect(notices).toHaveLength(1);
      });
    }
  }

  for (const value of ['grid', 'form']) {
    it(`leaves inlineEdit: '${value}' untouched`, () => {
      expect(convert({ ...FK, inlineEdit: value })).toStrictEqual({ field: { ...FK, inlineEdit: value }, notices: [] });
    });
  }

  it('is retired from the load path, and wired into step 18 beside its D3 entry', () => {
    const conversion = ALL_CONVERSIONS.find((c) => c.id === CONVERSION_ID);
    expect(conversion?.toMajor).toBe(18);
    expect(conversion?.retiredFromLoadPath).toBe(true);
    const step = MIGRATIONS_BY_MAJOR[18]!;
    expect(step.conversionIds).toContain(CONVERSION_ID);
    expect(step.semantic.map((s) => s.id)).toContain('field-inline-edit-boolean-retired');
    expect(step.rationale).toMatch(/retires the boolean arm of a relationship field's `inlineEdit`/);
  });
});
