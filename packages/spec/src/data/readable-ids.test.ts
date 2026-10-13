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
import { filterSubtreeProvenanceOf, markFilterSubtreeProvenance } from './filter-subtree-provenance';
import {
  COMPOSED_READABLE_IDS_BRAND,
  READABLE_IDS_BRAND,
  RLS_DENY_FILTER,
  ReadableIds,
  isComposedReadableIds,
  isReadableIds,
} from './readable-ids';

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

// ── [ADR-0139 D2] What the engine's composition reads ────────────────────────

describe('RLS_DENY_FILTER — the deny sentinel, declared once and recognised by identity', () => {
  it('is the published value, frozen, and an ordinary zero-row predicate to anyone who never heard of it', () => {
    // The value is published (explain's readFilter, a bound SQL parameter in
    // analytics), so it is pinned; what D2 step 2 reads is the reference.
    expect(RLS_DENY_FILTER).toEqual({ id: '__rls_deny__:00000000-0000-0000-0000-000000000000' });
    expect(Object.keys(RLS_DENY_FILTER)).toEqual(['id']);
    expect(Object.isFrozen(RLS_DENY_FILTER)).toBe(true);
    expect(() => { (RLS_DENY_FILTER as { id: string }).id = 'widened'; }).toThrow(TypeError);
    expect(RLS_DENY_FILTER.id).toBe('__rls_deny__:00000000-0000-0000-0000-000000000000');
  });

  it('no read-scope merge boundary can stamp a provenance mark on it — frozen, so it stays unmarked, which withholds', () => {
    expect(markFilterSubtreeProvenance(RLS_DENY_FILTER, 'author')).toBe(RLS_DENY_FILTER);
    expect(filterSubtreeProvenanceOf(RLS_DENY_FILTER)).toBeNull();
  });

  it('a copy carries the same value and is NOT the sentinel — the reason every producer returns the reference', () => {
    const copy = { ...RLS_DENY_FILTER };
    expect(copy).toEqual(RLS_DENY_FILTER);
    expect(copy).not.toBe(RLS_DENY_FILTER);
  });
});

describe('ReadableIds.compose — the composed leaf of D2 step 3', () => {
  const scope = { owner_id: 'u1' };

  it('builds a frozen leaf carrying { object, scope }, the scope by reference, branded under its own global-registry symbol, invisibly to enumeration and JSON', () => {
    const composed = ReadableIds.compose(ReadableIds.of('cpz_doc'), scope);
    expect(isComposedReadableIds(composed)).toBe(true);
    expect(composed.object).toBe('cpz_doc');
    expect(composed.scope).toBe(scope);
    expect(Object.isFrozen(composed)).toBe(true);
    expect(COMPOSED_READABLE_IDS_BRAND).toBe(Symbol.for('objectstack.filter.readableIds.composed'));
    expect(COMPOSED_READABLE_IDS_BRAND).not.toBe(READABLE_IDS_BRAND);
    expect(Object.getOwnPropertyDescriptor(composed, COMPOSED_READABLE_IDS_BRAND)).toEqual({
      value: true, enumerable: false, writable: false, configurable: false,
    });
    expect(Object.keys(composed)).toEqual(['object', 'scope']);
    expect(JSON.stringify(composed)).toBe('{"object":"cpz_doc","scope":{"owner_id":"u1"}}');
  });

  it('composes "no row restriction" as an own scope key holding undefined', () => {
    const composed = ReadableIds.compose(ReadableIds.of('cpz_doc'), undefined);
    expect(isComposedReadableIds(composed)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(composed, 'scope')).toBe(true);
    expect(composed.scope).toBeUndefined();
  });

  it('a holder of the reference cannot re-point the object or swap the scope', () => {
    const composed = ReadableIds.compose(ReadableIds.of('cpz_doc'), scope);
    expect(() => { (composed as { object: string }).object = 'sys_user'; }).toThrow(TypeError);
    expect(() => { (composed as { scope: unknown }).scope = undefined; }).toThrow(TypeError);
    expect(composed.object).toBe('cpz_doc');
    expect(composed.scope).toBe(scope);
  });

  it('refuses to compose anything but a branded ReadableIds leaf', () => {
    const leaf = ReadableIds.of('cpz_doc');
    for (const bad of [{ ...leaf }, { object: 'cpz_doc' }, ReadableIds.compose(leaf, undefined), null, 'cpz_doc'] as unknown[]) {
      expect(() => ReadableIds.compose(bad as never, undefined), String(bad)).toThrow(TypeError);
    }
  });

  it('refuses a scope that is neither undefined nor a plain filter object', () => {
    const leaf = ReadableIds.of('cpz_doc');
    for (const bad of [null, [], [{ owner_id: 'u1' }], 'owner_id = u1', 0, false] as unknown[]) {
      expect(() => ReadableIds.compose(leaf, bad as never), JSON.stringify(bad)).toThrow(TypeError);
    }
  });

  it('refuses the deny sentinel BY IDENTITY: D2 step 2 answers it $in: [], never a composed leaf', () => {
    const leaf = ReadableIds.of('cpz_doc');
    expect(() => ReadableIds.compose(leaf, RLS_DENY_FILTER)).toThrow(TypeError);
    expect(() => ReadableIds.compose(leaf, RLS_DENY_FILTER)).toThrow(/\$in: \[\] \(ADR-0139 D2 step 2\)/);
    // Identity, not value: a copy is an ordinary scope (one that matches zero
    // rows), exactly as D2 step 2 would see it — ⛔ no structural recognition.
    const copy = { ...RLS_DENY_FILTER };
    expect(ReadableIds.compose(leaf, copy).scope).toBe(copy);
  });
});

describe('isComposedReadableIds — disjoint from isReadableIds, and every copy answers false', () => {
  const leaf = ReadableIds.of('cpz_doc');
  const composed = ReadableIds.compose(leaf, { owner_id: 'u1' });

  it('the two recognisers are disjoint: a composed leaf is not a ReadableIds leaf, and an uncomposed one is not composed', () => {
    expect(isComposedReadableIds(composed)).toBe(true);
    expect(isReadableIds(composed)).toBe(false);
    expect(isReadableIds(leaf)).toBe(true);
    expect(isComposedReadableIds(leaf)).toBe(false);
  });

  it('a hand-built value carrying BOTH brands is not composed: it reads as an uncomposed leaf, whichever recogniser is asked first', () => {
    // Both keys are global-registry symbols, so in-process code can build this.
    const both = { object: 'x', scope: undefined };
    Object.defineProperty(both, READABLE_IDS_BRAND, { value: true });
    Object.defineProperty(both, COMPOSED_READABLE_IDS_BRAND, { value: true });
    expect(isComposedReadableIds(both)).toBe(false);
    expect(isReadableIds(both)).toBe(true);
    // The comparand door, as measured: it admits the value as an UNCOMPOSED leaf
    // for the composing caller (so the engine composes it from the caller's
    // access) and refuses it for every other caller.
    expect(() => assertListComparandShapes({ record_id: { $in: both } }, undefined, 'where', ADMIT)).not.toThrow();
    const err = refusalOf(() => assertListComparandShapes({ record_id: { $in: both } }));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
  });

  it('a JSON round-trip, a structured clone, a spread and Object.assign all drop the brand', () => {
    const copies = {
      json: JSON.parse(JSON.stringify(composed)),
      structuredClone: structuredClone(composed),
      spread: { ...composed },
      assign: Object.assign({}, composed),
    };
    for (const [how, copy] of Object.entries(copies)) {
      expect(copy, how).toEqual({ object: 'cpz_doc', scope: { owner_id: 'u1' } });
      expect(isComposedReadableIds(copy), how).toBe(false);
      expect(isReadableIds(copy), how).toBe(false);
    }
  });

  it('a brand with any value but true, an empty object name, a missing or malformed scope, inherited, or on an array is not a composed leaf', () => {
    const branded = (value: unknown, fields: Record<string, unknown>) =>
      Object.defineProperty({ ...fields }, COMPOSED_READABLE_IDS_BRAND, { value });
    expect(isComposedReadableIds(branded(true, { object: 'cpz_doc', scope: undefined })), 'the declared shape, built by hand').toBe(true);
    expect(isComposedReadableIds(branded(true, { object: 'cpz_doc', scope: { a: 1 } })), 'the declared shape, built by hand').toBe(true);
    expect(isComposedReadableIds(branded('true', { object: 'cpz_doc', scope: undefined }))).toBe(false);
    expect(isComposedReadableIds(branded(true, { object: '', scope: undefined }))).toBe(false);
    expect(isComposedReadableIds(branded(true, { object: 7, scope: undefined }))).toBe(false);
    expect(isComposedReadableIds(branded(true, { object: 'cpz_doc' })), 'no scope key at all').toBe(false);
    expect(isComposedReadableIds(branded(true, { object: 'cpz_doc', scope: null }))).toBe(false);
    expect(isComposedReadableIds(branded(true, { object: 'cpz_doc', scope: [] }))).toBe(false);
    expect(isComposedReadableIds(branded(true, { object: 'cpz_doc', scope: 'owner_id = u1' }))).toBe(false);
    expect(isComposedReadableIds(Object.create(composed))).toBe(false);
    expect(isComposedReadableIds(Object.defineProperty([], COMPOSED_READABLE_IDS_BRAND, { value: true }))).toBe(false);
    for (const value of [{ object: 'cpz_doc', scope: undefined }, null, undefined, 'cpz_doc', 0, true, []]) {
      expect(isComposedReadableIds(value), String(value)).toBe(false);
    }
  });
});

describe('the comparand-shape door never admits a composed leaf — not even for the caller that composes', () => {
  it('a composed leaf handed to the engine from outside is refused 400 as a non-list comparand, never trusted as a resolved scope', () => {
    const composed = ReadableIds.compose(ReadableIds.of('cpz_doc'), undefined);
    const err = refusalOf(() => assertListComparandShapes({ record_id: { $in: composed } }, undefined, 'where', ADMIT));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
    expect(err.message).toMatch(/^Operator "\$in" on field "record_id" requires an ARRAY of values\. Received object/);
  });
});
