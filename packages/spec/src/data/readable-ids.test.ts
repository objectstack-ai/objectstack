// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D1] `ReadableIds` — the branded comparand leaf, pinned where it is
 * declared, and at the comparand-shape door that admits it.
 *
 * The property everything here defends is the FAIL DIRECTION: a copy of the
 * leaf that crossed JSON, a structured clone or a spread arrives unbranded, and
 * an unbranded leaf is a plain object in a list slot — refused as a non-list
 * comparand (`INVALID_FILTER` / 400), ⛔ never admitted and never dropped. The
 * door admits a branded leaf only for the caller that opts in, only as `$in`'s
 * comparand; every other caller keeps the refusal it had before the leaf
 * existed. The engine's half (the uncomposed leaf never reaches a driver) is
 * pinned in `@objectstack/objectql`'s `engine-readable-ids-door.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { StandardErrorCode } from '../api/errors.zod';
import { FieldOperatorsSchema, FilterConditionSchema, parseFilterAST } from './filter.zod';
import { assertListComparandShapes } from './filter-comparand-shape';
import { READABLE_IDS_BRAND, ReadableIds, isReadableIds } from './readable-ids';

type Refusal = Error & { code?: string; status?: number };

const refusalOf = (run: () => unknown): Refusal => {
  try {
    run();
  } catch (e) {
    return e as Refusal;
  }
  throw new Error('expected a refusal, but the call returned');
};

const ENVELOPE = { code: StandardErrorCode.enum.INVALID_FILTER, status: 400 };
const envelopeOf = (err: Refusal) => ({ code: err.code, status: err.status });

const ADMIT = { admitReadableIds: true } as const;

describe('ReadableIds.of — the branded leaf', () => {
  it('builds a frozen leaf naming its object, branded under the global-registry symbol, invisibly to enumeration and JSON', () => {
    const leaf = ReadableIds.of('cpz_doc');
    expect(isReadableIds(leaf)).toBe(true);
    expect(leaf.object).toBe('cpz_doc');
    expect(Object.isFrozen(leaf)).toBe(true);
    expect(READABLE_IDS_BRAND).toBe(Symbol.for('objectstack.filter.readableIds'));
    expect(Object.getOwnPropertyDescriptor(leaf, Symbol.for('objectstack.filter.readableIds'))).toEqual({
      value: true, enumerable: false, writable: false, configurable: false,
    });
    expect(Object.keys(leaf)).toEqual(['object']);
    expect(JSON.stringify(leaf)).toBe('{"object":"cpz_doc"}');
  });

  it('a holder of the reference cannot re-point the leaf at another object', () => {
    const leaf = ReadableIds.of('cpz_doc');
    expect(() => { (leaf as { object: string }).object = 'sys_user'; }).toThrow(TypeError);
    expect(leaf.object).toBe('cpz_doc');
  });

  it('refuses to build a leaf that names no object', () => {
    for (const bad of ['', undefined, null, 42, {}] as unknown[]) {
      expect(() => ReadableIds.of(bad as string), String(bad)).toThrow(TypeError);
    }
  });
});

describe('isReadableIds — every copy and every forgery answers false', () => {
  const leaf = ReadableIds.of('cpz_doc');

  it('a JSON round-trip, a structured clone, a spread and Object.assign all drop the brand', () => {
    const copies = {
      json: JSON.parse(JSON.stringify(leaf)),
      structuredClone: structuredClone(leaf),
      spread: { ...leaf },
      assign: Object.assign({}, leaf),
    };
    for (const [how, copy] of Object.entries(copies)) {
      expect(copy, how).toEqual({ object: 'cpz_doc' });
      expect(isReadableIds(copy), how).toBe(false);
    }
  });

  it('a brand with any value but true, on an empty object name, inherited, or on an array is not a leaf', () => {
    const branded = (value: unknown, object: unknown) =>
      Object.defineProperty({ object }, READABLE_IDS_BRAND, { value });
    expect(isReadableIds(branded(true, 'cpz_doc')), 'the declared shape, built by hand').toBe(true);
    expect(isReadableIds(branded('true', 'cpz_doc'))).toBe(false);
    expect(isReadableIds(branded(1, 'cpz_doc'))).toBe(false);
    expect(isReadableIds(branded(true, ''))).toBe(false);
    expect(isReadableIds(branded(true, 7))).toBe(false);
    expect(isReadableIds(Object.create(leaf))).toBe(false);
    expect(isReadableIds(Object.defineProperty([], READABLE_IDS_BRAND, { value: true }))).toBe(false);
  });

  it('the plain-object spelling, null and every primitive are not a leaf', () => {
    for (const value of [{ object: 'cpz_doc' }, null, undefined, 'cpz_doc', 0, true, [], ['cpz_doc']]) {
      expect(isReadableIds(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe('the comparand-shape door admits a branded leaf only for a composing caller, only as $in', () => {
  const leaf = ReadableIds.of('cpz_doc');

  it('admits the branded leaf as $in\'s comparand for the caller that opts in, under $and / $or / $not too', () => {
    const filters = [
      { record_id: { $in: leaf } },
      { $and: [{ object_name: 'cpz_doc' }, { record_id: { $in: leaf } }] },
      { $or: [{ object_name: 'other' }, { object_name: 'cpz_doc', record_id: { $in: leaf } }] },
      { $not: { record_id: { $in: leaf } } },
    ];
    for (const where of filters) {
      expect(() => assertListComparandShapes(where, undefined, 'where', ADMIT), JSON.stringify(where)).not.toThrow();
    }
  });

  it('refuses the same branded leaf for every caller that does not opt in — the refusal that existed before the leaf', () => {
    const err = refusalOf(() => assertListComparandShapes({ record_id: { $in: leaf } }));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
    expect(err.message).toMatch(/^Operator "\$in" on field "record_id" requires an ARRAY of values\. Received object/);
    expect(err.message).toContain('at where.record_id.$in');
  });

  it('a JSON round-trip of a where holding the leaf is refused 400 even for the caller that opts in', () => {
    const where = { $and: [{ object_name: 'cpz_doc' }, { record_id: { $in: leaf } }] };
    const wire = JSON.parse(JSON.stringify(where));
    expect(wire).toEqual({ $and: [{ object_name: 'cpz_doc' }, { record_id: { $in: { object: 'cpz_doc' } } }] });
    const err = refusalOf(() => assertListComparandShapes(wire, undefined, 'where', ADMIT));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
    expect(err.message).toContain('at where.$and[1].record_id.$in');
  });

  it('a structured clone of a where holding the leaf is refused 400 even for the caller that opts in', () => {
    const err = refusalOf(() => assertListComparandShapes(structuredClone({ record_id: { $in: leaf } }), undefined, 'where', ADMIT));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
  });

  it('the plain-object spelling a request could write is refused 400 even for the caller that opts in', () => {
    const err = refusalOf(() => assertListComparandShapes(
      { record_id: { $in: { object: 'cpz_doc' } } }, undefined, 'where', ADMIT,
    ));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
    expect(err.message).toMatch(/^Operator "\$in" on field "record_id" requires an ARRAY of values\. Received object/);
  });

  it('$nin admits nothing — the leaf is declared as $in\'s comparand only', () => {
    const err = refusalOf(() => assertListComparandShapes({ record_id: { $nin: leaf } }, undefined, 'where', ADMIT));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
    expect(err.message).toMatch(/^Operator "\$nin" on field "record_id" requires an ARRAY of values/);
  });

  it('the authoring lowering refuses the leaf: parseFilterAST is a door that composes nothing', () => {
    const err = refusalOf(() => parseFilterAST([['record_id', 'in', leaf]]));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
    expect(err.message).toMatch(/Operator "\$in" on field "record_id" requires an ARRAY of values/);
  });

  it('the schema doors never admit it — no operator spells it', () => {
    expect(FieldOperatorsSchema.safeParse({ $in: leaf }).success).toBe(false);
    expect(FilterConditionSchema.safeParse({ record_id: { $in: leaf } }).success).toBe(false);
  });

  it('LIT CONTROL — a list comparand keeps passing, with and without the option', () => {
    const where = { record_id: { $in: ['p1', 'p2'] } };
    expect(() => assertListComparandShapes(where)).not.toThrow();
    expect(() => assertListComparandShapes(where, undefined, 'where', ADMIT)).not.toThrow();
  });
});
