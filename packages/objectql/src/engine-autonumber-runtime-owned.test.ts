// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5503 — `autonumber` is RUNTIME-owned on the write path, not caller-owned.
 *
 * The engine has always documented that "the runtime owns the value, not the
 * client" (`applyAutonumbers`), and required-validation exempts `autonumber`
 * on both verbs because of it. But no write layer enforced it: a plain REST
 * caller could POST an explicit record number (bypassing the sequence) and
 * PATCH an existing one (forging a business identifier). Same defect family as
 * #4447 (`created_at` forgeable by a normal PATCH); the difference is that
 * `readonly: true` fields were already stripped (#2948 / #3043) while
 * `type: 'autonumber'` carries no such flag.
 *
 * The fix treats `type: 'autonumber'` as IMPLICITLY read-only in the engine /
 * validation layer — insert and update at equal rank — so the strip happens
 * BEFORE the payload is dispatched to any driver. That placement is what makes
 * it driver-agnostic: the SQL driver's `supports.autonumber` sequence path is
 * covered without the driver changing a line, which the "native driver" cases
 * below assert directly (the row handed to `driver.create` carries no
 * autonumber key at all).
 *
 * Exemptions keep their existing semantics:
 *  - `isSystem` writes (seed replay, migration, internal provisioning);
 *  - an opt-in "historical" import (`preserveAudit`, #3493) — a data migration
 *    reinstating legacy record numbers is the business case the whitelist
 *    exists for, and `autonumber` is an author-declared business field
 *    (`system !== true`), exactly what `isPreservableUnderAudit` admits;
 *  - server-side stamps: only keys the CALLER supplied are candidates, so a
 *    `beforeInsert` / `beforeUpdate` hook that computes the value survives.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';

const ACCOUNT = {
  name: 'an_account',
  label: 'Account',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
    // The forgeable business identifier: engine-generated, never author-flagged
    // `readonly`. `required` on purpose — the runtime owns it, so required
    // validation must keep exempting it after the strip removes the value.
    account_number: {
      name: 'account_number',
      label: 'Account No.',
      type: 'autonumber' as const,
      required: true,
      autonumberFormat: 'ACC-{0000}',
    },
  },
};

function makeStubDriver(opts: { nativeAutonumber?: boolean } = {}) {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const createdRows: Array<Record<string, unknown>> = [];
  const updatedPayloads: Array<Record<string, unknown>> = [];
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  let nativeSeq = 0;
  const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
      const a = row[k] === undefined ? null : row[k];
      const b = expected === undefined ? null : expected;
      if (a !== b) return false;
    }
    return true;
  };
  const driver: any = {
    name: opts.nativeAutonumber ? 'sql' : 'memory',
    version: '0.0.0',
    // `supports.autonumber: true` is the SQL driver's contract (#1603): the
    // engine defers generation entirely to the driver's persistent sequence.
    supports: opts.nativeAutonumber ? ({ autonumber: true } as any) : ({} as any),
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      createdRows.push({ ...data });
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row: Record<string, unknown> = { ...data, id };
      if (opts.nativeAutonumber) {
        // Mirrors `fillAutoNumberFields`: fill ONLY a slot the caller left
        // empty. With the engine strip in place that slot is always empty for
        // a non-system caller, so the persistent sequence always wins.
        if (row.account_number === undefined || row.account_number === null || row.account_number === '') {
          nativeSeq += 1;
          row.account_number = `SEQ-${String(nativeSeq).padStart(4, '0')}`;
        }
      }
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      updatedPayloads.push({ ...data });
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) throw new Error(`not found: ${object}/${id}`);
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return updated;
    },
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      updatedPayloads.push({ ...data });
      const s = storeFor(object);
      let n = 0;
      for (const [id, row] of s) {
        if (!matchesWhere(row, ast?.where)) continue;
        s.set(id, { ...row, ...data, id });
        n += 1;
      }
      return n;
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      if (id && storeFor(object).has(id)) return this.update(object, id, data);
      return this.create(object, data);
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      const out = [];
      for (const r of rows) out.push(await this.create(object, r));
      return out;
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {},
    async rollback() {},
  };
  return { driver, stores, createdRows, updatedPayloads };
}

async function makeEngine(opts: { nativeAutonumber?: boolean } = {}) {
  const engine = new ObjectQL();
  const rig = makeStubDriver(opts);
  engine.registerDriver(rig.driver, true);
  await engine.init();
  engine.registry.registerObject(ACCOUNT);
  const protocol = new ObjectStackProtocolImplementation(engine);
  return { engine, protocol, ...rig };
}

describe('#5503 — autonumber is runtime-owned: INSERT', () => {
  let rig: Awaited<ReturnType<typeof makeEngine>>;
  beforeEach(async () => { rig = await makeEngine(); });

  it('strips a caller-supplied record number and issues the sequence value instead', async () => {
    const created = await rig.protocol.createData({
      object: 'an_account',
      data: { name: 'AN forge', account_number: 'ACC-777777' },
    });
    // The forged value never reached the store...
    expect(created.record.account_number).not.toBe('ACC-777777');
    // ...and the engine's own sequence issued the real one.
    expect(created.record.account_number).toBe('ACC-0001');
    // The row handed to the driver carried no forged value either.
    expect(rig.createdRows[0]?.account_number).toBe('ACC-0001');
  });

  it('reports the strip instead of dropping it silently (#3407 / #3431)', async () => {
    const created = await rig.protocol.createData({
      object: 'an_account',
      data: { name: 'AN forge', account_number: 'ACC-777777' },
    });
    const dropped = (created as { droppedFields?: DroppedFieldsEvent[] }).droppedFields ?? [];
    expect(dropped.flatMap((e) => e.fields)).toContain('account_number');
  });

  it('a `required` autonumber still passes insert validation after the strip', async () => {
    // The strip empties a REQUIRED field — required-validation exempts
    // `autonumber` either way, so this must not become a 400.
    await expect(
      rig.protocol.createData({ object: 'an_account', data: { name: 'ok', account_number: 'ACC-9' } }),
    ).resolves.toBeTruthy();
  });

  it('sequence continuity: a forged insert does not steal or skip a number', async () => {
    await rig.protocol.createData({ object: 'an_account', data: { name: 'a' } });
    await rig.protocol.createData({ object: 'an_account', data: { name: 'b', account_number: 'ACC-9999' } });
    const third = await rig.protocol.createData({ object: 'an_account', data: { name: 'c' } });
    expect(third.record.account_number).toBe('ACC-0003');
  });

  it('strips per row in a batch insert', async () => {
    const rows = await rig.engine.insert('an_account', [
      { name: 'a', account_number: 'ACC-111111' },
      { name: 'b' },
    ]);
    expect(rows.map((r: any) => r.account_number)).toEqual(['ACC-0001', 'ACC-0002']);
  });

  it('keeps an explicit value for a system write (seed replay / migration)', async () => {
    const row = await rig.engine.insert(
      'an_account',
      { name: 'seeded', account_number: 'ACC-000042' },
      { context: { isSystem: true } } as any,
    );
    expect(row.account_number).toBe('ACC-000042');
  });

  it('keeps an explicit value for a `preserveAudit` historical import (#3493)', async () => {
    const row = await rig.engine.insert(
      'an_account',
      { name: 'legacy', account_number: 'LEGACY-0007' },
      { context: { preserveAudit: true } } as any,
    );
    expect(row.account_number).toBe('LEGACY-0007');
  });

  it('keeps a beforeInsert hook stamp — only CALLER-supplied keys are candidates', async () => {
    rig.engine.registerHook('beforeInsert', async (ctx: any) => {
      ctx.input.data.account_number = 'HOOK-0001';
    }, { object: 'an_account' });
    const row = await rig.engine.insert('an_account', { name: 'hooked' });
    expect(row.account_number).toBe('HOOK-0001');
  });
});

describe('#5503 — autonumber is runtime-owned: INSERT on a native-autonumber driver', () => {
  it('hands the driver NO autonumber key, so the persistent sequence wins', async () => {
    // The strip lives in the engine, BEFORE dispatch — which is precisely why
    // the SQL driver's `supports.autonumber` path is covered without the
    // driver changing. Asserted here on the driver-facing payload, not by
    // patching a driver.
    const rig = await makeEngine({ nativeAutonumber: true });
    const created = await rig.protocol.createData({
      object: 'an_account',
      data: { name: 'AN forge', account_number: 'ACC-777777' },
    });
    expect('account_number' in (rig.createdRows[0] ?? {})).toBe(false);
    expect(created.record.account_number).toBe('SEQ-0001');
  });

  it('a system write still reaches the driver with its explicit value', async () => {
    const rig = await makeEngine({ nativeAutonumber: true });
    const row = await rig.engine.insert(
      'an_account',
      { name: 'seeded', account_number: 'ACC-000042' },
      { context: { isSystem: true } } as any,
    );
    expect(rig.createdRows[0]?.account_number).toBe('ACC-000042');
    expect(row.account_number).toBe('ACC-000042');
  });
});

describe('#5503 — autonumber is runtime-owned: bulk-create surfaces', () => {
  it('createManyData strips per row and reports the union', async () => {
    const rig = await makeEngine();
    const res: any = await rig.protocol.createManyData({
      object: 'an_account',
      records: [
        { name: 'a', account_number: 'ACC-111111' },
        { name: 'b' },
      ],
    });
    expect(res.records.map((r: any) => r.account_number)).toEqual(['ACC-0001', 'ACC-0002']);
    expect((res.droppedFields ?? []).flatMap((e: DroppedFieldsEvent) => e.fields)).toContain('account_number');
  });

  it('insertManyData keeps ROW precision — only the forging row is reported', async () => {
    // The import runner prefers this partial-success surface, so it is the one
    // that has to stay honest about which row lost its record number.
    const rig = await makeEngine();
    const res: any = await rig.protocol.insertManyData({
      object: 'an_account',
      records: [
        { name: 'a' },
        { name: 'b', account_number: 'ACC-111111' },
      ],
    });
    expect(res.outcomes.map((o: any) => o.record.account_number)).toEqual(['ACC-0001', 'ACC-0002']);
    expect(res.outcomes[0].droppedFields).toBeUndefined();
    expect(res.outcomes[1].droppedFields.flatMap((e: DroppedFieldsEvent) => e.fields)).toEqual(['account_number']);
  });
});

/**
 * #5503 x #5126 — the two features superposed.
 *
 * #5126 gave the readonly strip a LOUD half: `strictReadonlyWrites` refuses the
 * write instead of committing it without the stripped columns. #5503 makes
 * `autonumber` an implicitly-readonly field. The correct joint semantics fall
 * straight out of #5126's own stated rule — "strict adds no second policy, it
 * refuses exactly what the strip would have taken" — so:
 *
 *  - strict ON  → a caller-supplied record number is REFUSED, at equal rank
 *    with a declared `readonly` field, on insert AND update;
 *  - strict OFF → unchanged: stripped, committed, reported via
 *    `onFieldsDropped`;
 *  - a value the strip does NOT take is not rejected either, so the `isSystem`
 *    and `preserveAudit` exemptions survive strict untouched. That is the
 *    rule applied verbatim, not a new decision.
 *
 * On UPDATE this needed no new code — the autonumber limb rides
 * `stripReadonlyFields` → `reportDroppedFields` → `assertNoStrictDrops`, the
 * seam #5126 already built. On INSERT it did: #5126 left `strictReadonlyWrites`
 * inert there with the standing note "if insert ever gains a strip, both
 * members wire up together at that site", and #5503 is that strip.
 */
describe('#5503 x #5126 — strictReadonlyWrites covers runtime-owned fields', () => {
  it('INSERT: refuses a caller-supplied record number and writes NOTHING', async () => {
    const rig = await makeEngine();
    const err = await rig.engine
      .insert(
        'an_account',
        { name: 'AN forge', account_number: 'ACC-777777' },
        { strictReadonlyWrites: true },
      )
      .then(() => null, (e) => e);

    expect(err?.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(err.fields).toEqual(['account_number']);
    expect(err.operation).toBe('insert');
    expect(err.message).toContain('account_number');
    // The refusal lands BEFORE the driver — not even the legitimate `name`.
    expect(rig.createdRows).toHaveLength(0);
    // …and no sequence value was burned on the refused attempt.
    const ok = await rig.engine.insert('an_account', { name: 'clean' });
    expect(ok.account_number).toBe('ACC-0001');
  });

  it('INSERT: the listener does NOT fire under strict — a refused write did not complete', async () => {
    const rig = await makeEngine();
    const events: DroppedFieldsEvent[] = [];
    await rig.engine
      .insert(
        'an_account',
        { name: 'x', account_number: 'ACC-777777' },
        { strictReadonlyWrites: true, onFieldsDropped: (e) => { events.push(e); } },
      )
      .catch(() => {});
    expect(events).toEqual([]);
  });

  it('INSERT: strict is inert when nothing would be stripped', async () => {
    const rig = await makeEngine();
    const row = await rig.engine.insert('an_account', { name: 'clean' }, { strictReadonlyWrites: true });
    expect(row.account_number).toBe('ACC-0001');
  });

  it('INSERT: the exemptions survive strict — strict refuses only what the strip takes', async () => {
    // #5126's rule, applied verbatim rather than re-decided: an exempt writer's
    // value is never stripped, so there is nothing for strict to refuse.
    const rig = await makeEngine();
    const seeded = await rig.engine.insert(
      'an_account',
      { name: 'seeded', account_number: 'ACC-000042' },
      { strictReadonlyWrites: true, context: { isSystem: true } },
    );
    expect(seeded.account_number).toBe('ACC-000042');

    const legacy = await rig.engine.insert(
      'an_account',
      { name: 'legacy', account_number: 'LEGACY-0007' },
      { strictReadonlyWrites: true, context: { preserveAudit: true } },
    );
    expect(legacy.account_number).toBe('LEGACY-0007');
  });

  it('UPDATE: refuses a caller-supplied record number, at equal rank with a declared readonly field', async () => {
    const rig = await makeEngine();
    const created = await rig.protocol.createData({ object: 'an_account', data: { name: 'Acme' } });
    const id = created.id as string;

    const err = await rig.engine
      .update(
        'an_account',
        { id, name: 'renamed', account_number: 'ACC-888888' },
        { where: { id }, strictReadonlyWrites: true },
      )
      .then(() => null, (e) => e);

    expect(err?.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(err.fields).toEqual(['account_number']);
    expect([...err.drops].map((d: DroppedFieldsEvent) => d.reason)).toEqual(['readonly']);
    // Nothing was written — not even the legitimate rename.
    const readback = await rig.engine.findOne('an_account', { where: { id } });
    expect(readback.name).toBe('Acme');
    expect(readback.account_number).toBe('ACC-0001');
  });

  it('UPDATE: strict OFF keeps the default — stripped, committed, reported', async () => {
    const rig = await makeEngine();
    const created = await rig.protocol.createData({ object: 'an_account', data: { name: 'Acme' } });
    const id = created.id as string;
    const events: DroppedFieldsEvent[] = [];

    await rig.engine.update(
      'an_account',
      { id, name: 'renamed', account_number: 'ACC-888888' },
      { where: { id }, onFieldsDropped: (e) => { events.push(e); } },
    );

    expect(events.flatMap((e) => e.fields)).toContain('account_number');
    const readback = await rig.engine.findOne('an_account', { where: { id } });
    expect(readback.name).toBe('renamed');          // the legitimate half landed
    expect(readback.account_number).toBe('ACC-0001'); // the forged half did not
  });

  it('UPDATE: the preserveAudit exemption survives strict', async () => {
    const rig = await makeEngine();
    const created = await rig.protocol.createData({ object: 'an_account', data: { name: 'Acme' } });
    const id = created.id as string;
    const res = await rig.engine.update(
      'an_account',
      { id, account_number: 'LEGACY-0007' },
      { where: { id }, strictReadonlyWrites: true, context: { preserveAudit: true } },
    );
    expect(res.account_number).toBe('LEGACY-0007');
  });

  it('a strict BATCH insert is refused whole — consistent with "NOTHING was written"', async () => {
    // `insertMany`'s partial-success mode culls bad ROWS; strict is a refusal of
    // the WRITE. When a caller asks for both, the refusal wins: the error
    // contract says nothing was written, and degrading to "we kept the other
    // rows" would make that false. Pinned so the corner is a decision, not an
    // accident.
    const rig = await makeEngine();
    const err = await rig.engine
      .insertMany(
        'an_account',
        [{ name: 'a' }, { name: 'b', account_number: 'ACC-111111' }],
        { strictReadonlyWrites: true },
      )
      .then(() => null, (e) => e);
    expect(err?.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(rig.createdRows).toHaveLength(0);
  });
});

describe('#5503 — autonumber is runtime-owned: UPDATE', () => {
  let rig: Awaited<ReturnType<typeof makeEngine>>;
  let id: string;

  beforeEach(async () => {
    rig = await makeEngine();
    const created = await rig.protocol.createData({ object: 'an_account', data: { name: 'Acme' } });
    id = created.id as string;
    expect(created.record.account_number).toBe('ACC-0001');
  });

  it('strips a caller-supplied record number — the stored number is unchanged', async () => {
    const res = await rig.protocol.updateData({
      object: 'an_account',
      id,
      data: { account_number: 'ACC-888888' },
    });
    expect(res.record.account_number).toBe('ACC-0001');
    const readback = await rig.engine.findOne('an_account', { where: { id } });
    expect(readback.account_number).toBe('ACC-0001');
  });

  it('the driver never sees the forged column', async () => {
    await rig.protocol.updateData({
      object: 'an_account',
      id,
      data: { name: 'Acme Renamed', account_number: 'ACC-888888' },
    });
    const payload = rig.updatedPayloads.at(-1) ?? {};
    expect('account_number' in payload).toBe(false);
    // The legitimate part of the same PATCH still landed.
    expect(payload.name).toBe('Acme Renamed');
  });

  it('reports the strip through droppedFields', async () => {
    const res = await rig.protocol.updateData({
      object: 'an_account',
      id,
      data: { account_number: 'ACC-888888' },
    });
    const dropped = (res as { droppedFields?: DroppedFieldsEvent[] }).droppedFields ?? [];
    expect(dropped.flatMap((e) => e.fields)).toContain('account_number');
  });

  it('strips on a multi-row update too (the #3106 call-site shape)', async () => {
    // A second row sharing the predicate value, so the bulk branch really
    // rewrites BOTH rows — otherwise "the numbers did not change" would pass
    // for the empty reason that nothing was matched at all.
    await rig.protocol.createData({ object: 'an_account', data: { name: 'Acme' } });
    await rig.engine.update(
      'an_account',
      { account_number: 'ACC-888888', name: 'bulk' },
      { where: { name: 'Acme' }, multi: true } as any,
    );
    const payload = rig.updatedPayloads.at(-1) ?? {};
    expect('account_number' in payload).toBe(false);
    expect(payload.name).toBe('bulk'); // the legitimate half of the same write landed
    const rows = await rig.engine.find('an_account', {});
    expect(rows.map((r: any) => r.name)).toEqual(['bulk', 'bulk']); // both rows were rewritten
    expect(rows.map((r: any) => r.account_number).sort()).toEqual(['ACC-0001', 'ACC-0002']);
  });

  it('keeps an explicit value for a system write', async () => {
    const res = await rig.engine.update(
      'an_account',
      { id, account_number: 'ACC-000042' },
      { where: { id }, context: { isSystem: true } } as any,
    );
    expect(res.account_number).toBe('ACC-000042');
  });

  it('keeps an explicit value for a `preserveAudit` historical import / undo (#3493)', async () => {
    const res = await rig.engine.update(
      'an_account',
      { id, account_number: 'LEGACY-0007' },
      { where: { id }, context: { preserveAudit: true } } as any,
    );
    expect(res.account_number).toBe('LEGACY-0007');
  });

  it('keeps a beforeUpdate hook stamp — only CALLER-supplied keys are candidates', async () => {
    rig.engine.registerHook('beforeUpdate', async (ctx: any) => {
      ctx.input.data.account_number = 'HOOK-0002';
    }, { object: 'an_account' });
    const res = await rig.engine.update('an_account', { id, name: 'x' }, { where: { id } } as any);
    expect(res.account_number).toBe('HOOK-0002');
  });
});

/**
 * #5628 — the FLAGGED autonumber field: `Field.autonumber` now injects
 * `readonly: true` so the form half of the `readonly` contract ("never editable
 * in forms") holds for a record number the server was already guaranteed to
 * discard. Every case above uses an UNflagged `type: 'autonumber'`, so none of
 * them sees what that flag changes on the way in.
 *
 * What it changes is WHICH strip gets to the field first. A `readonly` field is
 * also stripped at the DataProtocol create INGRESS (`stripReadonlyForInsert`,
 * #3043) — a seam that knows only the `isSystem` exemption, while the engine's
 * runtime-owned strip also honours `preserveAudit` (#3493: a historical import
 * reinstating legacy record numbers). Left alone, the flag would therefore have
 * SILENTLY narrowed a documented exemption: the ingress would delete the legacy
 * number before the engine could keep it, with no test anywhere going red,
 * because every existing preserveAudit pin calls `engine.insert` directly.
 *
 * So the ingress skips runtime-owned types outright (they are covered by the
 * engine strip on EVERY insert path, including the direct `engine.insert`
 * callers the ingress never sees) and these cases pin both halves of that: the
 * ordinary caller is still stripped, and the historical import still keeps its
 * value — flagged or not, the verdicts are identical.
 */
describe('#5628 — a `readonly: true` autonumber keeps the #5503 exemption set', () => {
  // What `Field.autonumber({ label: 'Invoice No.' })` produces since #5628.
  const INVOICE = {
    name: 'an_invoice',
    label: 'Invoice',
    fields: {
      id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
      name: { name: 'name', label: 'Name', type: 'text' as const },
      invoice_number: {
        name: 'invoice_number',
        label: 'Invoice No.',
        type: 'autonumber' as const,
        readonly: true,
        autonumberFormat: 'INV-{0000}',
      },
    },
  };

  let rig: Awaited<ReturnType<typeof makeEngine>>;
  beforeEach(async () => {
    rig = await makeEngine();
    rig.engine.registry.registerObject(INVOICE, 'test');
  });

  it('still strips an ordinary caller-supplied number and issues the sequence value', async () => {
    const created = await rig.protocol.createData({
      object: 'an_invoice',
      data: { name: 'forge', invoice_number: 'INV-9999' },
    });
    expect(created.record.invoice_number).toBe('INV-0001');
    expect(rig.createdRows[rig.createdRows.length - 1]?.invoice_number).toBe('INV-0001');
  });

  it('still REPORTS the strip to the caller (#3407 / #3431)', async () => {
    const created = await rig.protocol.createData({
      object: 'an_invoice',
      data: { name: 'forge', invoice_number: 'INV-9999' },
    });
    const dropped = (created as { droppedFields?: DroppedFieldsEvent[] }).droppedFields ?? [];
    expect(dropped.flatMap((e) => e.fields)).toContain('invoice_number');
  });

  it('keeps a legacy number for a `preserveAudit` historical import THROUGH THE INGRESS (#3493)', async () => {
    // The regression this whole describe exists for: the ingress strip has no
    // `preserveAudit` exemption, so if it acted on the flag the value would be
    // gone before the engine's whitelist ran.
    const created = await rig.protocol.createData({
      object: 'an_invoice',
      data: { name: 'legacy', invoice_number: 'LEGACY-0007' },
      context: { preserveAudit: true },
    });
    expect(created.record.invoice_number).toBe('LEGACY-0007');
  });

  it('keeps an explicit number for a system write through the ingress', async () => {
    const created = await rig.protocol.createData({
      object: 'an_invoice',
      data: { name: 'seeded', invoice_number: 'INV-000042' },
      context: { isSystem: true },
    });
    expect(created.record.invoice_number).toBe('INV-000042');
  });

  it('an author-declared `readonly` field of an ORDINARY type is still stripped at the ingress', async () => {
    // The #3043 strip keeps its full width — only runtime-owned types moved.
    rig.engine.registry.registerObject({
      name: 'an_case',
      label: 'Case',
      fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        title: { name: 'title', label: 'Title', type: 'text' as const },
        approval_status: {
          name: 'approval_status',
          label: 'Approval',
          type: 'text' as const,
          readonly: true,
          defaultValue: 'draft',
        },
      },
    } as any, 'test');
    const created = await rig.protocol.createData({
      object: 'an_case',
      data: { title: 'forged', approval_status: 'approved' },
    });
    expect(created.record.approval_status).toBe('draft');
  });
});
