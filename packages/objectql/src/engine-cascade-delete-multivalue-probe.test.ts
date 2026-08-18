// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9362] `cascadeDeleteRelations` must probe a `multiple: true` reference
 * field with the spelling that field's storage can answer.
 *
 * ## The reported failure
 *
 * ```
 * POST   /api/v1/data/showcase_account  {"name":"anything","status":"active"} -> 201
 * DELETE /api/v1/data/showcase_account/<id>                                   -> 400 INVALID_FILTER
 * ```
 *
 * The probe built a BARE EQUALITY filter for every `lookup` / `master_detail`
 * field pointing at the object being deleted, including the ones declaring
 * `multiple: true`. Such a field stores an array, which every SQL backend here
 * puts in a JSON TEXT column, so bare equality compares the whole serialization
 * (`["a","b"]`) against one id. `driver-sql` refuses that spelling outright
 * (`INVALID_FILTER` / 400, #7398) — correctly, and that refusal is untouched by
 * this fix — and #8895's discriminate-or-propagate `catch` (also correct, also
 * untouched) let it through to the caller. Result: any object pointed at by any
 * registered `multiple: true` lookup could not be deleted at all. It is
 * SCHEMA-driven: the probe runs per DECLARED relation, so emptying the
 * dependent table changes nothing, which is the first thing the suite below
 * pins.
 *
 * ## The double
 *
 * `makeJsonColumnDriver` is a driver double that models the ONE behaviour this
 * card turns on: a field declared `multiple: true` is stored and queried as a
 * JSON TEXT column, so bare equality (and `$in`) against it raises the same
 * `INVALID_FILTER` / 400 refusal `driver-sql` raises, while `$contains` matches
 * as a SUBSTRING of the serialization — which is exactly what `LIKE '%v%'`
 * does there. It is deliberately not looser than the real driver on either
 * half: a double that answered bare equality would make every assertion below
 * pass without the fix.
 *
 * ## Both directions, always
 *
 * A probe that finds NOTHING would also turn the 400 into a 200 — and would
 * silently delete referenced records, which is worse than the bug. So every
 * happy-path assertion here is paired with a guard assertion on the same
 * relationship, and the `restrict` refusal is asserted through its full
 * ADR-0112 envelope (`code` AND `status`), never a bare `toThrow()`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

const OWNER_PACKAGE = 'test-9362';

const acct: ServiceObject = {
  name: 'mv_acct',
  label: 'Account',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const },
    name: { name: 'name', label: 'Name', type: 'text' as const },
  },
};

/** The showcase shape: `Field.lookup('showcase_account', { multiple: true })`. */
const zoo: ServiceObject = {
  name: 'mv_zoo',
  label: 'Field Zoo',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    // deleteBehavior defaults to `set_null`
    f_lookups: {
      name: 'f_lookups', label: 'Lookups', type: 'lookup' as const,
      reference: 'mv_acct', multiple: true,
    },
  },
};

/** The same multi-value relationship, declared `restrict`: the guard direction. */
const guard: ServiceObject = {
  name: 'mv_guard',
  label: 'Guard',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    accounts: {
      name: 'accounts', label: 'Accounts', type: 'lookup' as const,
      reference: 'mv_acct', multiple: true, deleteBehavior: 'restrict' as const,
    },
  },
};

/** Multi-value, `set_null` spelled OUT — `||` collapses it with the default. */
const explicitSetNull: ServiceObject = {
  name: 'mv_explicit_set_null',
  label: 'Explicit set_null',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const },
    accounts: {
      name: 'accounts', label: 'Accounts', type: 'lookup' as const,
      reference: 'mv_acct', multiple: true, deleteBehavior: 'set_null' as const,
    },
  },
};

/** Multi-value + explicit `cascade` — the escalation must NOT reach it. */
const cascadeMulti: ServiceObject = {
  name: 'mv_cascade_multi',
  label: 'Cascade (multi)',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const },
    accounts: {
      name: 'accounts', label: 'Accounts', type: 'lookup' as const,
      reference: 'mv_acct', multiple: true, deleteBehavior: 'cascade' as const,
    },
  },
};

/** SINGLE-valued, defaulted `set_null` — the limb that must still run. */
const singleSetNull: ServiceObject = {
  name: 'mv_single',
  label: 'Single (set_null)',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const },
    account: {
      name: 'account', label: 'Account', type: 'lookup' as const,
      reference: 'mv_acct',
    },
  },
};

/** A single-valued lookup on the same target — the unchanged-behaviour control. */
const opp: ServiceObject = {
  name: 'mv_opp',
  label: 'Opportunity',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    account: {
      name: 'account', label: 'Account', type: 'lookup' as const,
      reference: 'mv_acct', deleteBehavior: 'restrict' as const,
    },
  },
};

/** Which fields this double stores as a JSON TEXT column, per object. */
const JSON_COLUMNS: Record<string, readonly string[]> = {
  mv_zoo: ['f_lookups'],
  mv_guard: ['accounts'],
  mv_explicit_set_null: ['accounts'],
  mv_cascade_multi: ['accounts'],
};

/**
 * The #7398 refusal, reproduced in the double with the envelope the real driver
 * gives it — `INVALID_FILTER` / 400, the ADR-0112 class-1 shape.
 */
function jsonColumnRefusal(field: string, op: string): Error {
  const err: any = new Error(
    `A constraint in this filter WAS NOT APPLIED: "${field}" is stored as a JSON TEXT column and ` +
    `"${op}" compares that whole serialized text against a single value. Use "$contains" for membership.`,
  );
  err.code = 'INVALID_FILTER';
  err.status = 400;
  return err;
}

function makeJsonColumnDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const probes: Array<{ object: string; where: unknown }> = [];
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;

  const isJson = (object: string, field: string) => JSON_COLUMNS[object]?.includes(field) === true;

  /**
   * The #7398 gate, where the real driver has it: on the FILTER, before a
   * single row is read. `driver-sql` raises this while COMPILING the predicate
   * (`assertOperatorAppliesToColumn`, reached from `applyFilters`), so an empty
   * table refuses exactly as a full one does — which is what makes the card's
   * fault schema-driven rather than data-driven.
   *
   * Evaluating it per row instead would make this double LOOSER than the driver
   * it stands in for, and the card's own reproduction — a delete refused with
   * an EMPTY referring table — would pass without the fix. Measured: it did,
   * on the first draft of this file.
   */
  const assertCompilable = (object: string, where: any): void => {
    if (!where || typeof where !== 'object') return;
    for (const [k, v] of Object.entries(where)) {
      if (k === '$or' || k === '$and') {
        for (const sub of v as any[]) assertCompilable(object, sub);
        continue;
      }
      if (k.startsWith('$')) continue;
      if (!isJson(object, k)) continue;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        const op = Object.keys(v as Record<string, unknown>)[0] ?? '';
        // `$contains` is the one membership spelling a JSON column answers;
        // every scalar comparison is refused.
        if (op !== '$contains') throw jsonColumnRefusal(k, op);
        continue;
      }
      throw jsonColumnRefusal(k, 'bare equality');
    }
  };

  /** One `{ field: <spec> }` entry, evaluated the way the real backends do. */
  const matchesField = (
    object: string, row: Record<string, unknown>, field: string, spec: unknown,
  ): boolean => {
    const stored = row[field];
    if (spec !== null && typeof spec === 'object' && !Array.isArray(spec)) {
      const [op, comparand] = Object.entries(spec as Record<string, unknown>)[0] ?? [];
      if (op === '$contains') {
        // `LIKE '%v%'` over the serialization — a SUBSTRING test, exactly as
        // driver-sql lowers it on a JSON column. Substring, not membership:
        // that is why the engine narrows the rows afterwards.
        if (isJson(object, field)) {
          return JSON.stringify(stored ?? null).includes(String(comparand));
        }
        return typeof stored === 'string' && stored.includes(String(comparand));
      }
      if (op === '$eq' || op === '$in') {
        const wanted = op === '$in' ? (comparand as unknown[]) : [comparand];
        return wanted.some((w) => (stored ?? null) === (w ?? null));
      }
      return false;
    }
    return (stored ?? null) === (spec ?? null);
  };

  const matches = (object: string, row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === '$or') {
        if (!(v as any[]).some((sub) => matches(object, row, sub))) return false;
        continue;
      }
      if (k === '$and') {
        if (!(v as any[]).every((sub) => matches(object, row, sub))) return false;
        continue;
      }
      if (k.startsWith('$')) continue;
      if (!matchesField(object, row, k, v)) return false;
    }
    return true;
  };

  const driver: any = {
    name: 'json-column', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(o: string, ast: any) {
      probes.push({ object: o, where: ast?.where });
      assertCompilable(o, ast?.where);
      return Array.from(storeFor(o).values()).filter((r) => matches(o, r, ast?.where));
    },
    async findOne(o: string, ast: any) {
      assertCompilable(o, ast?.where);
      for (const r of storeFor(o).values()) if (matches(o, r, ast?.where)) return r;
      return null;
    },
    async create(o: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(o).set(id, row);
      return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(o); const cur = s.get(id);
      if (!cur) throw new Error(`nf ${o}/${id}`);
      const up = { ...cur, ...data, id }; s.set(id, up); return up;
    },
    async upsert(o: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      return id && storeFor(o).has(id) ? this.update(o, id, data) : this.create(o, data);
    },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async count(o: string, ast: any) {
      assertCompilable(o, ast?.where);
      return Array.from(storeFor(o).values()).filter((r) => matches(o, r, ast?.where)).length;
    },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(o, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, stores, probes };
}

const rows = (stores: Map<string, Map<string, Record<string, unknown>>>, o: string) =>
  stores.get(o)?.size ?? 0;

describe('[#9362] the dependents probe reads a multi-value reference field the way it is stored', () => {
  let engine: ObjectQL;
  let stores: Map<string, Map<string, Record<string, unknown>>>;
  let probes: Array<{ object: string; where: unknown }>;

  beforeEach(async () => {
    engine = new ObjectQL();
    const stub = makeJsonColumnDriver();
    stores = stub.stores;
    probes = stub.probes;
    engine.registerDriver(stub.driver, true);
    await engine.init();
    for (const o of [acct, zoo, guard, opp, explicitSetNull, cascadeMulti, singleSetNull]) {
      engine.registry.registerObject(o, OWNER_PACKAGE);
    }
  });

  // ── The card's own reproduction.

  it('deletes a record whose only multi-value referrer table is EMPTY (the schema-driven 400)', async () => {
    const a = await engine.insert('mv_acct', { name: 'anything' });
    expect(rows(stores, 'mv_zoo')).toBe(0);
    expect(rows(stores, 'mv_guard')).toBe(0);

    await engine.delete('mv_acct', { where: { id: a.id } } as any);

    expect(rows(stores, 'mv_acct')).toBe(0);
    // The relation WAS probed — a fix that stopped probing multi-value
    // relations would also pass the line above, and would be the worse bug.
    expect(probes.some((p) => p.object === 'mv_zoo')).toBe(true);
    expect(probes.some((p) => p.object === 'mv_guard')).toBe(true);
  });

  it('the multi-value probe is spelled `$contains`, the single-valued one stays bare equality', async () => {
    const a = await engine.insert('mv_acct', { id: 'acc_x', name: 'anything' });
    await engine.delete('mv_acct', { where: { id: a.id } } as any);

    expect(probes.find((p) => p.object === 'mv_zoo')?.where)
      .toEqual({ f_lookups: { $contains: 'acc_x' } });
    expect(probes.find((p) => p.object === 'mv_guard')?.where)
      .toEqual({ accounts: { $contains: 'acc_x' } });
    // Unchanged: a scalar foreign key is still asked the scalar question.
    expect(probes.find((p) => p.object === 'mv_opp')?.where).toEqual({ account: 'acc_x' });
  });

  // ── The other direction: the guard must still refuse.

  it('a live dependent through the multi-value field still REFUSES the delete', async () => {
    const a = await engine.insert('mv_acct', { name: 'referenced' });
    await engine.insert('mv_guard', { name: 'g', accounts: [a.id] });

    const err: any = await engine.delete('mv_acct', { where: { id: a.id } } as any).catch((e) => e);
    expect(err.code).toBe('DELETE_RESTRICTED');
    expect(err.status).toBe(409);
    expect(err.dependentObject).toBe('mv_guard');
    expect(err.dependentCount).toBe(1);
    expect(rows(stores, 'mv_acct')).toBe(1);
  });

  it('the refusal counts the referencing rows, and only those, when the array holds several ids', async () => {
    const a = await engine.insert('mv_acct', { id: 'acc_1', name: 'one' });
    const b = await engine.insert('mv_acct', { id: 'acc_2', name: 'two' });
    await engine.insert('mv_guard', { id: 'g1', name: 'both', accounts: [a.id, b.id] });
    await engine.insert('mv_guard', { id: 'g2', name: 'other', accounts: [b.id] });

    const err: any = await engine.delete('mv_acct', { where: { id: a.id } } as any).catch((e) => e);
    expect(err.code).toBe('DELETE_RESTRICTED');
    expect(err.status).toBe(409);
    expect(err.dependentCount).toBe(1);
  });

  // ── The narrowing: `$contains` is a SUBSTRING test, so the pushdown
  //    over-matches and the exact answer has to be taken on the rows.

  it('an id that is a PREFIX of another does not inherit the other id\'s dependents', async () => {
    const a1 = await engine.insert('mv_acct', { id: 'acc_1', name: 'one' });
    await engine.insert('mv_acct', { id: 'acc_10', name: 'ten' });
    // Only `acc_10` is referenced. `$contains: 'acc_1'` matches this row's
    // serialization anyway — the narrowing is what stops a spurious 409.
    await engine.insert('mv_guard', { id: 'g1', name: 'g', accounts: ['acc_10'] });

    await engine.delete('mv_acct', { where: { id: a1.id } } as any);

    expect(stores.get('mv_acct')?.has('acc_1')).toBe(false);
    expect(stores.get('mv_acct')?.has('acc_10')).toBe(true);
    // …and the guard on the id that IS referenced still fires.
    const err: any = await engine.delete('mv_acct', { where: { id: 'acc_10' } } as any).catch((e) => e);
    expect(err.code).toBe('DELETE_RESTRICTED');
    expect(err.status).toBe(409);
  });

  it('a cascade through a multi-value field removes the rows that reference, and no others', async () => {
    const cascadeZoo: ServiceObject = {
      name: 'mv_cascade',
      label: 'Cascade',
      fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        accounts: {
          name: 'accounts', label: 'Accounts', type: 'lookup' as const,
          reference: 'mv_acct', multiple: true, deleteBehavior: 'cascade' as const,
        },
      },
    };
    engine.registry.registerObject(cascadeZoo, OWNER_PACKAGE);
    (JSON_COLUMNS as Record<string, readonly string[]>).mv_cascade = ['accounts'];
    try {
      await engine.insert('mv_acct', { id: 'acc_1', name: 'one' });
      await engine.insert('mv_acct', { id: 'acc_10', name: 'ten' });
      await engine.insert('mv_cascade', { id: 'c1', accounts: ['acc_1'] });
      await engine.insert('mv_cascade', { id: 'c2', accounts: ['acc_10'] });

      await engine.delete('mv_acct', { where: { id: 'acc_1' } } as any);

      // `c2` references `acc_10`, which the substring pushdown also matched.
      // Deleting it would be data loss caused by the fix itself.
      expect(stores.get('mv_cascade')?.has('c1')).toBe(false);
      expect(stores.get('mv_cascade')?.has('c2')).toBe(true);
    } finally {
      delete (JSON_COLUMNS as Record<string, readonly string[] | undefined>).mv_cascade;
    }
  });

  // ── An id that needs JSON escaping is asked for in BOTH stored spellings, so
  //    the guard cannot fail OPEN on it.

  it('an id containing a quote is still found through the escaped serialization', async () => {
    const weird = 'acc"1';
    await engine.insert('mv_acct', { id: weird, name: 'quoted' });
    await engine.insert('mv_guard', { id: 'g1', name: 'g', accounts: [weird] });

    const err: any = await engine.delete('mv_acct', { where: { id: weird } } as any).catch((e) => e);
    expect(err.code).toBe('DELETE_RESTRICTED');
    expect(err.status).toBe(409);
    expect(err.dependentCount).toBe(1);
    expect(probes.find((p) => p.object === 'mv_guard')?.where).toEqual({
      $or: [
        { accounts: { $contains: 'acc"1' } },
        { accounts: { $contains: 'acc\\"1' } },
      ],
    });
  });

  // ── #8895 stays exactly as it landed: a probe that could not RUN propagates.

  it('a probe failure that is not the JSON-column refusal still propagates (#8895 unchanged)', async () => {
    const a = await engine.insert('mv_acct', { name: 'anything' });
    const injected = Object.assign(new Error('connection terminated unexpectedly'), {
      code: 'ECONNRESET',
    });
    const realFind = (engine as any).drivers.get('json-column').find;
    (engine as any).drivers.get('json-column').find = async (o: string, ast: any) => {
      if (o === 'mv_zoo') throw injected;
      return realFind.call((engine as any).drivers.get('json-column'), o, ast);
    };

    const err: any = await engine.delete('mv_acct', { where: { id: a.id } } as any).catch((e) => e);
    expect(err).toBe(injected);
    expect(rows(stores, 'mv_acct')).toBe(1);
  });
});

/**
 * [#9438] `set_null` on a SET-valued foreign key removes the deleted MEMBER
 * and writes what remains; the emptied set is written as `[]`, never `null`.
 *
 * The residual-shape sentence is NOT this suite's finding: `FieldSchema` pins
 * it (`packages/spec/src/data/field.zod.ts`, the `multiple` and `required`
 * doc blocks — #9447, maintainer ruling 2026-08-18, binding for every
 * writer). This suite pins that the cascade repair CONSUMES that contract.
 *
 * The #9437 holding position — refusing these deletes 409 while the residual
 * shape was undecided — is REMOVED by the same change, so the success pins
 * here are also the revert's pins: under the hold every one of them was a
 * `DELETE_RESTRICTED` refusal.
 *
 * Controls stay OVER-FIRE FIRST, as the hold's suite had them: single-valued
 * `set_null`, multi-value `cascade`, an already-declared `restrict`, and a
 * relation with no dependents are asserted beside the member-removal pins.
 * The single-valued control is non-vacuous in the WIDEN direction (treat
 * every field as multi-valued and it goes red on the array write), not under
 * a removal ablation.
 */
describe('[#9438] set_null on a multi-value reference removes the deleted member', () => {
  let engine: ObjectQL;
  let stores: Map<string, Map<string, Record<string, unknown>>>;

  beforeEach(async () => {
    engine = new ObjectQL();
    const stub = makeJsonColumnDriver();
    stores = stub.stores;
    engine.registerDriver(stub.driver, true);
    await engine.init();
    for (const o of [acct, zoo, guard, opp, explicitSetNull, cascadeMulti, singleSetNull]) {
      engine.registry.registerObject(o, OWNER_PACKAGE);
    }
  });

  // ── The write: member removal, on both spellings of set_null.

  it('a DEFAULTED set_null removes the deleted member and keeps the rest', async () => {
    const a = await engine.insert('mv_acct', { id: 'acc_a', name: 'A' });
    await engine.insert('mv_acct', { id: 'acc_b', name: 'B' });
    await engine.insert('mv_zoo', { id: 'z1', name: 'z', f_lookups: ['acc_a', 'acc_b'] });

    await engine.delete('mv_acct', { where: { id: a.id } } as any);

    expect(stores.get('mv_acct')?.has('acc_a')).toBe(false);
    // The whole point of the card: the sibling reference SURVIVES, and the
    // record it points at is still there to resolve.
    expect(stores.get('mv_zoo')?.get('z1')?.f_lookups).toEqual(['acc_b']);
    expect(stores.get('mv_acct')?.has('acc_b')).toBe(true);
  });

  it('an EXPLICITLY authored set_null takes the same member removal', async () => {
    // `fdef.deleteBehavior || 'set_null'` collapses the absent declaration and
    // this one into the same value — both spellings take the same write.
    const a = await engine.insert('mv_acct', { id: 'acc_a', name: 'A' });
    await engine.insert('mv_acct', { id: 'acc_b', name: 'B' });
    await engine.insert('mv_explicit_set_null', { id: 'h1', accounts: ['acc_a', 'acc_b'] });

    await engine.delete('mv_acct', { where: { id: a.id } } as any);

    expect(stores.get('mv_explicit_set_null')?.get('h1')?.accounts).toEqual(['acc_b']);
  });

  it('removing the LAST member writes `[]`, never `null` — the ruled representation', async () => {
    const a = await engine.insert('mv_acct', { id: 'acc_a', name: 'A' });
    await engine.insert('mv_zoo', { id: 'z1', name: 'z', f_lookups: ['acc_a'] });

    await engine.delete('mv_acct', { where: { id: a.id } } as any);

    const stored = stores.get('mv_zoo')?.get('z1')?.f_lookups;
    // Assert the literal shape, both ways: the contract sentence is exactly
    // "`[]`, never `null`" (field.zod.ts, `multiple` doc block).
    expect(stored).toEqual([]);
    expect(stored).not.toBeNull();
    expect(Array.isArray(stored)).toBe(true);
  });

  it('removal compares WHOLE members — an id keeps a member it is only a prefix of', async () => {
    // The probe pushdown is a substring superset; the write must not be.
    const a = await engine.insert('mv_acct', { id: 'acc_1', name: 'one' });
    await engine.insert('mv_acct', { id: 'acc_10', name: 'ten' });
    await engine.insert('mv_zoo', { id: 'z1', name: 'z', f_lookups: ['acc_1', 'acc_10'] });

    await engine.delete('mv_acct', { where: { id: a.id } } as any);

    expect(stores.get('mv_zoo')?.get('z1')?.f_lookups).toEqual(['acc_10']);
  });

  it('every dependent row loses the member, each keeping its own others', async () => {
    const a = await engine.insert('mv_acct', { id: 'acc_a', name: 'A' });
    await engine.insert('mv_acct', { id: 'acc_b', name: 'B' });
    await engine.insert('mv_zoo', { id: 'z1', name: 'z1', f_lookups: ['acc_a', 'acc_b'] });
    await engine.insert('mv_zoo', { id: 'z2', name: 'z2', f_lookups: ['acc_a'] });
    await engine.insert('mv_zoo', { id: 'z3', name: 'z3', f_lookups: ['acc_b'] });

    await engine.delete('mv_acct', { where: { id: a.id } } as any);

    expect(stores.get('mv_zoo')?.get('z1')?.f_lookups).toEqual(['acc_b']);
    expect(stores.get('mv_zoo')?.get('z2')?.f_lookups).toEqual([]);
    // A row that never referenced the deleted record is not touched.
    expect(stores.get('mv_zoo')?.get('z3')?.f_lookups).toEqual(['acc_b']);
  });

  // ── The refusal channel: plain policy again, no interim sentence.

  it("an already-declared multi-value restrict refuses with its OWN sentence — the interim's is gone", async () => {
    const a = await engine.insert('mv_acct', { id: 'acc_a', name: 'A' });
    await engine.insert('mv_guard', { id: 'g1', name: 'g', accounts: ['acc_a'] });

    const err: any = await engine.delete('mv_acct', { where: { id: a.id } } as any).catch((e) => e);
    expect(err.code).toBe('DELETE_RESTRICTED');
    expect(err.status).toBe(409);
    expect(err.dependentObject).toBe('mv_guard');
    // Configured policy only: the holding-position wording must not outlive
    // the hold (it cited its card literally so that this grep is possible).
    expect(err.developerMessage).not.toContain('TEMPORARY');
    expect(err.developerMessage).not.toContain('9438');
    expect(stores.get('mv_guard')?.get('g1')?.accounts).toEqual(['acc_a']);
  });

  // ── Controls the removal must leave alone.

  it('a SINGLE-valued set_null still clears the foreign key to null, exactly as before', async () => {
    const a = await engine.insert('mv_acct', { id: 'acc_a', name: 'A' });
    await engine.insert('mv_single', { id: 's1', account: 'acc_a' });

    await engine.delete('mv_acct', { where: { id: a.id } } as any);

    expect(stores.get('mv_acct')?.has('acc_a')).toBe(false);
    expect(stores.get('mv_single')?.get('s1')?.account).toBeNull();
  });

  it('a multi-value CASCADE still deletes the dependents', async () => {
    const a = await engine.insert('mv_acct', { id: 'acc_a', name: 'A' });
    await engine.insert('mv_cascade_multi', { id: 'c1', accounts: ['acc_a'] });

    await engine.delete('mv_acct', { where: { id: a.id } } as any);

    expect(stores.get('mv_acct')?.has('acc_a')).toBe(false);
    expect(stores.get('mv_cascade_multi')?.has('c1')).toBe(false);
  });

  it('a multi-value set_null relation with NO dependent rows still deletes', async () => {
    const a = await engine.insert('mv_acct', { id: 'acc_a', name: 'A' });
    expect(stores.get('mv_zoo')?.size ?? 0).toBe(0);
    expect(stores.get('mv_explicit_set_null')?.size ?? 0).toBe(0);

    await engine.delete('mv_acct', { where: { id: a.id } } as any);

    expect(stores.get('mv_acct')?.has('acc_a')).toBe(false);
  });
});
