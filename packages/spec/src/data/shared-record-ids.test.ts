// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 D1, D4] `SharedRecordIds` — the share-grant leaf, pinned where it
 * is declared; the fixed inner read it describes; and the comparand-shape
 * door's `admitFixedReadLeaves` option that admits it.
 *
 * The property everything here defends is ADR-0139 D1's FAIL DIRECTION, kept
 * for this brand: a copy that crossed JSON, a structured clone or a spread
 * arrives unbranded, and an unbranded leaf is a plain object in a list slot —
 * refused as a non-list comparand (`INVALID_FILTER` / 400), ⛔ never admitted,
 * never dropped and never read as an empty list. The door admits a branded
 * leaf only for a caller that names its brand, only as `$in`'s comparand; until
 * ADR-0155 plan steps 2 and 5 no caller names it, so every caller keeps the
 * refusal it had before the leaf existed. The engine's half (position, verb,
 * recipient) is step 2's, against the seam cases in
 * `./fixed-read-leaf-conformance.ts`.
 */

import { describe, it, expect } from 'vitest';
import { StandardErrorCode } from '../api/errors.zod';
import { FieldOperatorsSchema, FilterConditionSchema, VALID_AST_OPERATORS, parseFilterAST } from './filter.zod';
import { assertListComparandShapes } from './filter-comparand-shape';
import { fixedInnerReadOf, fixedReadLeafBrandOf, isFixedReadLeaf } from './fixed-read-leaf';
import { COMPOSED_READABLE_IDS_BRAND, READABLE_IDS_BRAND, ReadableIds, isReadableIds } from './readable-ids';
import { SHARED_RECORD_IDS_BRAND, SharedRecordIds, isSharedRecordIds } from './shared-record-ids';

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

const ADMIT = { admitFixedReadLeaves: [SHARED_RECORD_IDS_BRAND] } as const;

/** A branded value built by hand, for the guard's degraded shapes. */
const handBuilt = (fields: Record<string, unknown>, brandValue: unknown = true, freeze = true) => {
  const value = Object.defineProperty({ ...fields }, SHARED_RECORD_IDS_BRAND, { value: brandValue });
  return freeze ? Object.freeze(value) : value;
};

describe('SharedRecordIds.read / .write — the branded leaf', () => {
  it('builds a frozen read form carrying the object and the recipient, branded under the global-registry symbol, invisibly to enumeration and JSON', () => {
    const leaf = SharedRecordIds.read('account', 'u1');
    expect(isSharedRecordIds(leaf)).toBe(true);
    expect(leaf.object).toBe('account');
    expect(leaf.recipient).toBe('u1');
    expect(leaf.accessLevels).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(leaf, 'accessLevels')).toBe(false);
    expect(Object.isFrozen(leaf)).toBe(true);
    expect(SHARED_RECORD_IDS_BRAND).toBe(Symbol.for('objectstack.filter.sharedRecordIds'));
    expect(SHARED_RECORD_IDS_BRAND).not.toBe(READABLE_IDS_BRAND);
    expect(SHARED_RECORD_IDS_BRAND).not.toBe(COMPOSED_READABLE_IDS_BRAND);
    expect(Object.getOwnPropertyDescriptor(leaf, SHARED_RECORD_IDS_BRAND)).toEqual({
      value: true, enumerable: false, writable: false, configurable: false,
    });
    expect(Object.keys(leaf)).toEqual(['object', 'recipient']);
    expect(JSON.stringify(leaf)).toBe('{"object":"account","recipient":"u1"}');
  });

  it('builds a frozen write form carrying a frozen COPY of the levels the producer supplies', () => {
    const levels = ['edit', 'full'];
    const leaf = SharedRecordIds.write('account', 'u1', levels);
    expect(isSharedRecordIds(leaf)).toBe(true);
    expect(leaf.accessLevels).toEqual(['edit', 'full']);
    expect(leaf.accessLevels).not.toBe(levels);
    expect(Object.isFrozen(leaf.accessLevels)).toBe(true);
    levels.push('read');
    expect(leaf.accessLevels).toEqual(['edit', 'full']);
    expect(Object.keys(leaf)).toEqual(['object', 'recipient', 'accessLevels']);
    expect(JSON.stringify(leaf)).toBe('{"object":"account","recipient":"u1","accessLevels":["edit","full"]}');
  });

  it('two users\' leaves never compare or serialise as equal: the inputs are enumerable', () => {
    expect(SharedRecordIds.read('account', 'u1')).not.toEqual(SharedRecordIds.read('account', 'u2'));
    expect(JSON.stringify(SharedRecordIds.read('account', 'u1')))
      .not.toBe(JSON.stringify(SharedRecordIds.read('account', 'u2')));
  });

  it('a holder of the reference cannot re-point the object or the recipient, or edit the levels', () => {
    const leaf = SharedRecordIds.write('account', 'u1', ['edit']);
    expect(() => { (leaf as { object: string }).object = 'sys_user'; }).toThrow(TypeError);
    expect(() => { (leaf as { recipient: string }).recipient = 'u2'; }).toThrow(TypeError);
    expect(() => { (leaf.accessLevels as string[]).push('read'); }).toThrow(TypeError);
    expect(leaf).toEqual({ object: 'account', recipient: 'u1', accessLevels: ['edit'] });
  });

  it('refuses a leaf that names no object or no recipient', () => {
    for (const bad of ['', undefined, null, 42, {}, ['account']] as unknown[]) {
      expect(() => SharedRecordIds.read(bad as string, 'u1'), `object ${String(bad)}`).toThrow(TypeError);
      expect(() => SharedRecordIds.read('account', bad as string), `recipient ${String(bad)}`).toThrow(TypeError);
      expect(() => SharedRecordIds.write(bad as string, 'u1', ['edit']), `write object ${String(bad)}`).toThrow(TypeError);
      expect(() => SharedRecordIds.write('account', bad as string, ['edit']), `write recipient ${String(bad)}`).toThrow(TypeError);
    }
  });

  it('refuses a write form whose levels admit nothing, or are not a list of names — the read form spells "every level"', () => {
    for (const bad of [[], undefined, null, 'edit', [''], ['edit', 7], [null]] as unknown[]) {
      expect(() => SharedRecordIds.write('account', 'u1', bad as string[]), JSON.stringify(bad)).toThrow(TypeError);
    }
    expect(() => SharedRecordIds.write('account', 'u1', [])).toThrow(/SharedRecordIds\.read\(\)/);
  });
});

describe('isSharedRecordIds — every copy and every forgery answers false', () => {
  const leaf = SharedRecordIds.write('account', 'u1', ['edit']);

  it('a JSON round-trip, a structured clone, a spread and Object.assign all drop the brand', () => {
    const copies = {
      json: JSON.parse(JSON.stringify(leaf)),
      structuredClone: structuredClone(leaf),
      spread: { ...leaf },
      assign: Object.assign({}, leaf),
    };
    for (const [how, copy] of Object.entries(copies)) {
      expect(copy, how).toEqual({ object: 'account', recipient: 'u1', accessLevels: ['edit'] });
      expect(isSharedRecordIds(copy), how).toBe(false);
      expect(isFixedReadLeaf(copy), how).toBe(false);
    }
  });

  it('only the declared shape, frozen, answers true', () => {
    const levels = Object.freeze(['edit']);
    expect(isSharedRecordIds(handBuilt({ object: 'account', recipient: 'u1' })), 'the read form, built by hand').toBe(true);
    expect(isSharedRecordIds(handBuilt({ object: 'account', recipient: 'u1', accessLevels: levels })), 'the write form, built by hand').toBe(true);
    expect(isSharedRecordIds(handBuilt({ object: 'account', recipient: 'u1' }, 'true'))).toBe(false);
    expect(isSharedRecordIds(handBuilt({ object: 'account', recipient: 'u1' }, 1))).toBe(false);
    expect(isSharedRecordIds(handBuilt({ object: 'account', recipient: 'u1' }, true, false)), 'unfrozen').toBe(false);
    expect(isSharedRecordIds(handBuilt({ object: '', recipient: 'u1' }))).toBe(false);
    expect(isSharedRecordIds(handBuilt({ object: 'account', recipient: '' }))).toBe(false);
    expect(isSharedRecordIds(handBuilt({ object: 'account' })), 'no recipient').toBe(false);
    expect(isSharedRecordIds(handBuilt({ recipient: 'u1' })), 'no object').toBe(false);
    expect(isSharedRecordIds(handBuilt({ object: 'account', recipient: 7 }))).toBe(false);
    expect(isSharedRecordIds(handBuilt({ object: 'account', recipient: 'u1', accessLevels: Object.freeze([]) })), 'empty levels').toBe(false);
    expect(isSharedRecordIds(handBuilt({ object: 'account', recipient: 'u1', accessLevels: ['edit'] })), 'unfrozen levels').toBe(false);
    expect(isSharedRecordIds(handBuilt({ object: 'account', recipient: 'u1', accessLevels: undefined })), 'an own levels key holding undefined').toBe(false);
    expect(isSharedRecordIds(handBuilt({ object: 'account', recipient: 'u1', accessLevels: Object.freeze(['']) }))).toBe(false);
    expect(isSharedRecordIds(handBuilt({ object: 'account', recipient: 'u1', scope: undefined })), 'a key it never carries').toBe(false);
    expect(isSharedRecordIds(handBuilt({ object: 'account', recipient: 'u1', organization: 'org_a' })), 'an organization').toBe(false);
    expect(isSharedRecordIds(Object.create(leaf)), 'inherited').toBe(false);
    expect(isSharedRecordIds(Object.freeze(Object.defineProperty([], SHARED_RECORD_IDS_BRAND, { value: true })))).toBe(false);
  });

  it('a value carrying another leaf\'s brand beside its own is not a SharedRecordIds leaf: one brand, one meaning', () => {
    const both = Object.defineProperty({ object: 'account', recipient: 'u1' }, SHARED_RECORD_IDS_BRAND, { value: true });
    Object.defineProperty(both, READABLE_IDS_BRAND, { value: true });
    Object.freeze(both);
    expect(isSharedRecordIds(both)).toBe(false);
    expect(fixedReadLeafBrandOf(both)).toBeUndefined();
    // It reads as what its OTHER brand says, so the door treats it as that leaf
    // for a composing caller and refuses it for every other one.
    expect(isReadableIds(both)).toBe(true);
    const err = refusalOf(() => assertListComparandShapes({ id: { $in: both } }, undefined, 'where', ADMIT));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
  });

  it('a ReadableIds leaf, the plain-object spelling, null and every primitive are not a leaf', () => {
    for (const value of [ReadableIds.of('account'), { object: 'account', recipient: 'u1' }, null, undefined, 'u1', 0, true, [], ['d1']]) {
      expect(isSharedRecordIds(value), String(value)).toBe(false);
    }
  });
});

describe('SharedRecordIds.innerRead — the fixed inner read each form denotes (ADR-0155 D2)', () => {
  it('the read form: today\'s grant read, with no cap and no level predicate', () => {
    const read = SharedRecordIds.innerRead(SharedRecordIds.read('account', 'u1'));
    expect(read).toEqual({
      table: 'sys_record_share',
      column: 'record_id',
      equals: { object_name: 'account', recipient_type: 'user', recipient_id: 'u1' },
      memberOf: {},
      tenantScope: 'none',
    });
    expect(Object.isFrozen(read)).toBe(true);
    expect(Object.isFrozen(read.equals)).toBe(true);
    expect(Object.isFrozen(read.memberOf)).toBe(true);
  });

  it('the write form adds one membership predicate inside the subquery: the levels the leaf carries', () => {
    const read = SharedRecordIds.innerRead(SharedRecordIds.write('account', 'u1', ['edit', 'full']));
    expect(read.memberOf).toEqual({ access_level: ['edit', 'full'] });
    expect(Object.isFrozen(read.memberOf.access_level)).toBe(true);
    expect(read.equals).toEqual({ object_name: 'account', recipient_type: 'user', recipient_id: 'u1' });
  });

  it('the inner read carries no organization, whatever the leaf: ① ruled A', () => {
    const read = SharedRecordIds.innerRead(SharedRecordIds.write('account', 'u1', ['edit']));
    expect(read.tenantScope).toBe('none');
    expect(Object.keys(read.equals)).not.toContain('organization_id');
    expect(Object.keys(read.memberOf)).not.toContain('organization_id');
  });

  it('answers a fresh value per call, and the shared dispatch answers the same description', () => {
    const leaf = SharedRecordIds.read('account', 'u1');
    expect(SharedRecordIds.innerRead(leaf)).not.toBe(SharedRecordIds.innerRead(leaf));
    expect(fixedInnerReadOf(leaf)).toEqual(SharedRecordIds.innerRead(leaf));
  });

  it('refuses to describe anything but a branded leaf — ⛔ never an ordinary comparand read as one', () => {
    const leaf = SharedRecordIds.read('account', 'u1');
    for (const bad of [{ ...leaf }, JSON.parse(JSON.stringify(leaf)), ReadableIds.of('account'), null, 'account', ['d1']] as unknown[]) {
      expect(() => SharedRecordIds.innerRead(bad as never), String(bad)).toThrow(TypeError);
      expect(() => fixedInnerReadOf(bad as never), String(bad)).toThrow(TypeError);
    }
  });
});

describe('the fixed-read brand dispatch (ADR-0155 D4)', () => {
  it('recognises the leaf by its brand, and nothing else', () => {
    const leaf = SharedRecordIds.read('account', 'u1');
    expect(fixedReadLeafBrandOf(leaf)).toBe(SHARED_RECORD_IDS_BRAND);
    expect(isFixedReadLeaf(leaf)).toBe(true);
    expect(isFixedReadLeaf(leaf, [SHARED_RECORD_IDS_BRAND])).toBe(true);
    expect(isFixedReadLeaf(leaf, []), 'an empty list names no brand').toBe(false);
    for (const notAList of [true, 'objectstack.filter.sharedRecordIds', SHARED_RECORD_IDS_BRAND] as unknown[]) {
      expect(isFixedReadLeaf(leaf, notAList as never), `brands ${String(notAList)}`).toBe(false);
    }
    for (const value of [ReadableIds.of('account'), ReadableIds.compose(ReadableIds.of('account'), undefined), { ...leaf }, null, ['d1']]) {
      expect(fixedReadLeafBrandOf(value), String(value)).toBeUndefined();
      expect(isFixedReadLeaf(value), String(value)).toBe(false);
    }
  });
});

describe('the comparand-shape door admits the leaf only for a caller that names its brand, only as $in', () => {
  const read = SharedRecordIds.read('account', 'u1');
  const write = SharedRecordIds.write('account', 'u1', ['edit', 'full']);

  it('admits either form as $in\'s comparand for the caller that names the brand, under $and / $or / $not too', () => {
    const filters = [
      { id: { $in: read } },
      { id: { $in: write } },
      { $or: [{ owner_id: 'u1' }, { id: { $in: read } }] },
      { $and: [{ status: 'open' }, { $or: [{ owner_id: 'u1' }, { id: { $in: write } }] }] },
      { $not: { id: { $in: read } } },
    ];
    for (const where of filters) {
      expect(() => assertListComparandShapes(where, undefined, 'where', ADMIT), JSON.stringify(where)).not.toThrow();
    }
  });

  it('refuses the same branded leaf for every caller that names no brand — the refusal that existed before the leaf', () => {
    for (const options of [undefined, {}, { admitFixedReadLeaves: [] }, { admitReadableIds: true }, { admitFixedReadLeaves: true as never }] as const) {
      const err = refusalOf(() => assertListComparandShapes({ id: { $in: read } }, undefined, 'where', options));
      expect(envelopeOf(err), JSON.stringify(options)).toEqual(ENVELOPE);
      expect(err.message).toMatch(/^Operator "\$in" on field "id" requires an ARRAY of values\. Received object/);
      expect(err.message).toContain('at where.id.$in');
    }
  });

  it('naming the fixed-read brand admits no ReadableIds leaf: the two options are independent', () => {
    const err = refusalOf(() => assertListComparandShapes({ record_id: { $in: ReadableIds.of('account') } }, undefined, 'where', ADMIT));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
    expect(() => assertListComparandShapes(
      { $or: [{ record_id: { $in: ReadableIds.of('account') } }, { id: { $in: read } }] },
      undefined, 'where', { admitReadableIds: true, ...ADMIT },
    )).not.toThrow();
  });

  it('a JSON round-trip of a where holding the leaf is refused 400 even for the caller that names the brand', () => {
    const where = { $or: [{ owner_id: 'u1' }, { id: { $in: write } }] };
    const wire = JSON.parse(JSON.stringify(where));
    expect(wire).toEqual({ $or: [{ owner_id: 'u1' }, { id: { $in: { object: 'account', recipient: 'u1', accessLevels: ['edit', 'full'] } } }] });
    const err = refusalOf(() => assertListComparandShapes(wire, undefined, 'where', ADMIT));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
    expect(err.message).toContain('at where.$or[1].id.$in');
  });

  it('a structured clone of a where holding the leaf is refused 400 even for the caller that names the brand', () => {
    const err = refusalOf(() => assertListComparandShapes(structuredClone({ id: { $in: read } }), undefined, 'where', ADMIT));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
  });

  it('the plain-object spelling a request could write is refused 400 even for the caller that names the brand', () => {
    const err = refusalOf(() => assertListComparandShapes(
      { id: { $in: { object: 'account', recipient: 'u1' } } }, undefined, 'where', ADMIT,
    ));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
    expect(err.message).toMatch(/^Operator "\$in" on field "id" requires an ARRAY of values\. Received object/);
  });

  it('$nin admits nothing — the leaf is declared as $in\'s comparand only', () => {
    const err = refusalOf(() => assertListComparandShapes({ id: { $nin: read } }, undefined, 'where', ADMIT));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
    expect(err.message).toMatch(/^Operator "\$nin" on field "id" requires an ARRAY of values/);
  });

  it('the authoring lowering refuses the leaf: parseFilterAST is a door that names no brand', () => {
    const err = refusalOf(() => parseFilterAST([['id', 'in', read]]));
    expect(envelopeOf(err)).toEqual(ENVELOPE);
    expect(err.message).toMatch(/Operator "\$in" on field "id" requires an ARRAY of values/);
  });

  it('the schema doors never admit it, and no operator spells it', () => {
    expect(FieldOperatorsSchema.safeParse({ $in: read }).success).toBe(false);
    expect(FilterConditionSchema.safeParse({ id: { $in: read } }).success).toBe(false);
    expect([...VALID_AST_OPERATORS].some((op) => /shared/i.test(op))).toBe(false);
  });

  it('LIT CONTROL — a list comparand keeps passing, with and without the option', () => {
    const where = { id: { $in: ['d1', 'd2'] } };
    expect(() => assertListComparandShapes(where)).not.toThrow();
    expect(() => assertListComparandShapes(where, undefined, 'where', ADMIT)).not.toThrow();
  });
});
