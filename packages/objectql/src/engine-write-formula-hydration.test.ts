// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5504 — a write response is a RECORD, so it carries the record's `formula`
 * fields.
 *
 * `applyFormulaPlan` used to hang off `find` and `findOne` only. `POST
 * /data/:object` and `PATCH /data/:object/:id` therefore answered with the
 * stored document, in which a formula field is not `null` but ABSENT (a
 * formula is virtual — no driver returns a column for one), while the very
 * next `GET` of the same row carried every one of them. Read-your-write was
 * broken in the direction that is hardest to notice: the response calls itself
 * `record`, so a client renders it, and every object whose `nameField` points
 * at a formula rendered blank.
 *
 * These tests drive the real engine through the protocol surface the REST
 * layer calls (`createData` / `updateData` / `createManyData` /
 * `insertManyData`), because that — not a unit call on a helper — is the shape
 * the issue reported.
 *
 * Two orderings are pinned deliberately, because both were constraints on
 * WHERE the hydration could go, not incidental outcomes:
 *
 *  - hydration runs AFTER the write-path strips and refusals landed the same
 *    day (#5503's runtime-owned `autonumber` strip, #5126/#5610's
 *    `strictReadonlyWrites`). A formula reading a stripped field must report
 *    what was STORED, and a refused write must produce no response to hydrate
 *    at all;
 *  - hydration runs BEFORE the afterInsert/afterUpdate dispatch, mirroring the
 *    read path's `applyFormulaPlan` → `afterFind` order, so an after-hook sees
 *    the same complete record on a write that it sees on a read.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ExpressionEngine } from '@objectstack/formula';
import { ObjectQL } from './engine.js';

/**
 * An account whose display title is a formula — the HotCRM shape from the
 * issue (`nameField` pointing at a formula on account / product / case /
 * campaign / quote / forecast / lead / contact).
 *
 * `account_number` is an `autonumber` so the formula reads a RUNTIME-owned
 * value: that is what makes the #5503 interaction observable rather than
 * asserted about internals.
 */
const ACCOUNT = {
  name: 'wf_account',
  label: 'Account',
  nameField: 'display_title',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
    segment: { name: 'segment', label: 'Segment', type: 'text' as const },
    account_number: {
      name: 'account_number',
      label: 'Account No.',
      type: 'autonumber' as const,
      autonumberFormat: 'ACC-{0000}',
    },
    // The locked column a non-system caller may not write (#2948) — a formula
    // reads it so the strip's effect is visible in the response.
    tier: { name: 'tier', label: 'Tier', type: 'text' as const, readonly: true, defaultValue: 'standard' },
    display_title: {
      name: 'display_title',
      label: 'Display Title',
      type: 'formula' as const,
      expression: { dialect: 'cel', source: 'record.account_number + " - " + record.name' },
    },
    tier_label: {
      name: 'tier_label',
      label: 'Tier Label',
      type: 'formula' as const,
      expression: { dialect: 'cel', source: '"tier:" + record.tier' },
    },
  },
};

/** Multi-formula object — the `crm_forecast` shape from the issue. */
const FORECAST = {
  name: 'wf_forecast',
  label: 'Forecast',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    amount: { name: 'amount', label: 'Amount', type: 'number' as const },
    probability: { name: 'probability', label: 'Probability', type: 'number' as const },
    quota: { name: 'quota', label: 'Quota', type: 'number' as const },
    expected_amount: {
      name: 'expected_amount', label: 'Expected', type: 'formula' as const,
      expression: { dialect: 'cel', source: 'record.amount * record.probability' },
    },
    attainment_pct: {
      name: 'attainment_pct', label: 'Attainment', type: 'formula' as const,
      expression: { dialect: 'cel', source: 'record.amount / record.quota' },
    },
    coverage_ratio: {
      name: 'coverage_ratio', label: 'Coverage', type: 'formula' as const,
      expression: { dialect: 'cel', source: 'record.quota / record.amount' },
    },
  },
};

/** No formula at all — the perf threshold's control object. */
const PLAIN = {
  name: 'wf_plain',
  label: 'Plain',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
  },
};

/** Formula referencing the caller — pins the context passthrough (#1979 status quo). */
const MEMO = {
  name: 'wf_memo',
  label: 'Memo',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    body: { name: 'body', label: 'Body', type: 'text' as const },
    author_ref: {
      name: 'author_ref', label: 'Author', type: 'formula' as const,
      expression: { dialect: 'cel', source: 'os.user.id' },
    },
  },
};

function makeStubDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  const matchesWhere = (row: Record<string, unknown>, where: unknown): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where as Record<string, unknown>)) {
      if (k.startsWith('$')) continue;
      const expected = (v && typeof v === 'object' && '$eq' in (v as Record<string, unknown>))
        ? (v as Record<string, unknown>).$eq
        : v;
      const a = row[k] === undefined ? null : row[k];
      const b = expected === undefined ? null : expected;
      if (a !== b) return false;
    }
    return true;
  };
  const driver = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    async execute() { return null; },
    // Shallow COPIES, never live references into the backing table — the shape
    // every real backend hands back (a SQL driver gets it for free from knex; an
    // in-process store has to copy explicitly). It is load-bearing for this
    // file specifically: the READ path hydrates formulas by mutating the rows a
    // driver hands back, so a harness leaking references would write
    // `display_title` into its own store on the first GET and every later
    // write response would echo it — these tests would then pass with the
    // write-path hydration deleted, which is the "green because nothing is
    // produced" failure mode, inverted.
    async find(object: string, ast: { where?: unknown }) {
      return Array.from(storeFor(object).values())
        .filter((r) => matchesWhere(r, ast?.where))
        .map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: { where?: unknown }) {
      for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return { ...r };
      return null;
    },
    // `RETURNING *` semantics, like the SQL driver: a write hands back the
    // whole stored row, which is what makes evaluating the formulas over it
    // equivalent to evaluating them over a readback.
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row: Record<string, unknown> = { ...data, id };
      storeFor(object).set(id, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) return null;
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return { ...updated };
    },
    async updateMany(object: string, ast: { where?: unknown }, data: Record<string, unknown>) {
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
    async count(object: string, ast: { where?: unknown }) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      const out: Record<string, unknown>[] = [];
      for (const r of rows) out.push(await this.create(object, r));
      return out;
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {},
    async rollback() {},
  };
  return { driver, stores };
}

async function makeEngine() {
  const engine = new ObjectQL();
  const rig = makeStubDriver();
  engine.registerDriver(rig.driver as never, true);
  await engine.init();
  for (const obj of [ACCOUNT, FORECAST, PLAIN, MEMO]) {
    engine.registry.registerObject(obj as never);
  }
  const protocol = new ObjectStackProtocolImplementation(engine);
  return { engine, protocol, ...rig };
}

type Rig = Awaited<ReturnType<typeof makeEngine>>;
type Rec = Record<string, unknown>;

describe('#5504 — CREATE response carries formula fields', () => {
  let rig: Rig;
  beforeEach(async () => { rig = await makeEngine(); });

  it('the create response record is EQUIVALENT to the GET that follows it', async () => {
    // The issue's exact repro, minus HTTP:
    //   POST /data/wf_account {"name":"PatchEcho"} → record.display_title
    //   GET  /data/wf_account/<id>                → display_title
    const created = await rig.protocol.createData({
      object: 'wf_account',
      data: { name: 'PatchEcho' },
    });
    const record = created.record as Rec;

    // The key EXISTS (the failure was an absent key, not a null value)…
    expect('display_title' in record).toBe(true);
    expect(record.display_title).toBe('ACC-0001 - PatchEcho');

    // …and it is what the next read reports, field for field.
    const fetched = await rig.protocol.getData({ object: 'wf_account', id: String(created.id) });
    expect((fetched.record as Rec).display_title).toBe(record.display_title);
    expect((fetched.record as Rec).tier_label).toBe(record.tier_label);
  });

  it("a nameField pointing at a formula renders straight from the create response", async () => {
    // The concrete consequence the issue reported: HotCRM's account / product /
    // case / campaign / quote / forecast / lead / contact all name a formula,
    // so "create then show the title" used to render blank.
    const created = await rig.protocol.createData({
      object: 'wf_account',
      data: { name: 'Northwind' },
    });
    const titleField = ACCOUNT.nameField;
    const title = (created.record as Rec)[titleField];
    expect(typeof title).toBe('string');
    expect(title).toBe('ACC-0001 - Northwind');
  });

  it('evaluates EVERY formula on a multi-formula object', async () => {
    // `crm_forecast` in the issue: expected_amount / attainment_pct /
    // coverage_ratio were all missing from the POST response together.
    const created = await rig.protocol.createData({
      object: 'wf_forecast',
      data: { amount: 200, probability: 0.5, quota: 400 },
    });
    const record = created.record as Rec;
    expect(record.expected_amount).toBe(100);
    expect(record.attainment_pct).toBe(0.5);
    expect(record.coverage_ratio).toBe(2);
  });

  it('threads the execution context exactly as the read path does', async () => {
    // Same passthrough find/findOne have today — `os.user` resolved from the
    // execution context. Widening what the context carries is #1979 and is
    // deliberately NOT touched here.
    const created = await rig.protocol.createData({
      object: 'wf_memo',
      data: { body: 'hello' },
      context: { userId: 'u-42' },
    });
    expect((created.record as Rec).author_ref).toBe('u-42');

    const fetched = await rig.protocol.getData({
      object: 'wf_memo',
      id: String(created.id),
      context: { userId: 'u-42' },
    });
    expect((fetched.record as Rec).author_ref).toBe('u-42');
  });

  it('a formula that faults resolves to null, not to a missing key', async () => {
    // Same contract `applyFormulaPlan` gives the read path: an unevaluable
    // expression is `null`. The point of the fix is that the KEY is present
    // either way, so a consumer can tell "not evaluated" from "not configured".
    const created = await rig.protocol.createData({
      object: 'wf_forecast',
      data: { amount: 10 }, // no `quota` → division by an absent field
    });
    const record = created.record as Rec;
    expect('attainment_pct' in record).toBe(true);
    expect(record.attainment_pct).toBeNull();
  });
});

describe('#5504 — UPDATE response carries formula fields', () => {
  let rig: Rig;
  beforeEach(async () => { rig = await makeEngine(); });

  it('the PATCH response record is EQUIVALENT to the GET that follows it', async () => {
    const created = await rig.protocol.createData({ object: 'wf_account', data: { name: 'PatchEcho' } });
    const id = String(created.id);

    const updated = await rig.protocol.updateData({
      object: 'wf_account',
      id,
      data: { segment: 'growth' },
    });
    const record = updated.record as Rec;
    expect('display_title' in record).toBe(true);

    const fetched = await rig.protocol.getData({ object: 'wf_account', id });
    expect((fetched.record as Rec).display_title).toBe(record.display_title);
  });

  it('recomputes from the POST-write values, not the pre-write ones', async () => {
    const created = await rig.protocol.createData({ object: 'wf_account', data: { name: 'Before' } });
    const id = String(created.id);
    expect((created.record as Rec).display_title).toBe('ACC-0001 - Before');

    const updated = await rig.protocol.updateData({
      object: 'wf_account',
      id,
      data: { name: 'After' },
    });
    // Hydration sits on the driver's post-write readback, so the formula
    // reflects the write that just happened.
    expect((updated.record as Rec).display_title).toBe('ACC-0001 - After');
  });

  it('a PREDICATE (multi) update keeps its affected-COUNT contract — nothing to hydrate', async () => {
    // `driver.updateMany` returns a count and names no row (#4639), so a bulk
    // update has no record to materialize. Pinned so a future reader does not
    // read the absence as a missed call site: giving a bulk update a record
    // response would be a contract change, not a hydration gap.
    await rig.protocol.createData({ object: 'wf_account', data: { name: 'A', segment: 'smb' } });
    await rig.protocol.createData({ object: 'wf_account', data: { name: 'B', segment: 'smb' } });

    const affected = await rig.engine.update(
      'wf_account',
      { segment: 'growth' },
      { where: { segment: 'smb' }, multi: true },
    );
    expect(affected).toBe(2);
  });
});

describe('#5504 — batch write responses', () => {
  let rig: Rig;
  beforeEach(async () => { rig = await makeEngine(); });

  it('every row of a batch insert is hydrated', async () => {
    const rows = await rig.engine.insert('wf_forecast', [
      { amount: 100, probability: 0.5, quota: 200 },
      { amount: 300, probability: 0.25, quota: 600 },
    ]) as Rec[];
    expect(rows.map((r) => r.expected_amount)).toEqual([50, 75]);
    expect(rows.map((r) => r.attainment_pct)).toEqual([0.5, 0.5]);
  });

  it('`createManyData` returns hydrated records', async () => {
    const res = await rig.protocol.createManyData({
      object: 'wf_account',
      records: [{ name: 'Alpha' }, { name: 'Beta' }],
    });
    const records = res.records as Rec[];
    expect(records.map((r) => r.display_title)).toEqual([
      'ACC-0001 - Alpha',
      'ACC-0002 - Beta',
    ]);
  });

  it('`insertManyData` hydrates the surviving rows and fabricates nothing for the dead ones', async () => {
    // Partial-success path (framework#3172): a culled row carries an error and
    // no `record`, so there must be nothing to hydrate for it either.
    const res = await rig.protocol.insertManyData({
      object: 'wf_account',
      records: [{ name: 'Good' }, { segment: 'no-name' }],
    });
    const [ok, dead] = res.outcomes;
    expect(ok.ok).toBe(true);
    expect((ok.record as Rec).display_title).toBe('ACC-0001 - Good');
    expect(dead.ok).toBe(false);
    expect(dead.record).toBeUndefined();
  });
});

describe('#5504 — ordering against the same-day write-path strips', () => {
  let rig: Rig;
  beforeEach(async () => { rig = await makeEngine(); });

  it('a formula over a STRIPPED autonumber reports the issued value, not the forged one (#5503)', async () => {
    // Direction of the proof: hydration runs AFTER `stripRuntimeOwnedFields`.
    // Were it before (or over the caller's payload rather than the driver's
    // readback), `display_title` would echo the forged 'ACC-777777'.
    const created = await rig.protocol.createData({
      object: 'wf_account',
      data: { name: 'Forger', account_number: 'ACC-777777' },
    });
    const record = created.record as Rec;
    expect(record.account_number).toBe('ACC-0001');
    expect(record.display_title).toBe('ACC-0001 - Forger');
    expect(String(record.display_title)).not.toContain('777777');
  });

  it('a formula over a STRIPPED readonly write reports the stored value (#2948)', async () => {
    const created = await rig.protocol.createData({ object: 'wf_account', data: { name: 'Locked' } });
    const id = String(created.id);
    // `tier` is `readonly`; the caller's write is dropped and the update
    // commits without it, so the formula must show what is STORED.
    const updated = await rig.protocol.updateData({
      object: 'wf_account',
      id,
      data: { segment: 'growth', tier: 'platinum' },
    });
    expect((updated.record as Rec).tier).toBe('standard');
    expect((updated.record as Rec).tier_label).toBe('tier:standard');
  });

  it('a REFUSED strict write produces no response at all — nothing is hydrated (#5126/#5610)', async () => {
    const created = await rig.protocol.createData({ object: 'wf_account', data: { name: 'Strict' } });
    const id = String(created.id);
    await expect(
      rig.engine.update(
        'wf_account',
        { id, tier: 'platinum' },
        { strictReadonlyWrites: true },
      ),
    ).rejects.toThrow(/read-only|readonly/i);
    // …and the refusal left the row untouched, formula included.
    const fetched = await rig.protocol.getData({ object: 'wf_account', id });
    expect((fetched.record as Rec).tier_label).toBe('tier:standard');
  });
});

describe('#5504 — the after-hook view matches the read path', () => {
  let rig: Rig;
  beforeEach(async () => { rig = await makeEngine(); });

  it('an afterInsert hook observes the same complete record `afterFind` gets', async () => {
    // Hydration is placed BEFORE the dispatch on purpose — the read path runs
    // `applyFormulaPlan` before `afterFind`, and a hook should not have to know
    // which verb materialized the record it is handed.
    const seen: unknown[] = [];
    rig.engine.registerHook('afterInsert', (ctx) => {
      seen.push((ctx.result as Rec)?.display_title);
    }, { object: 'wf_account' });

    await rig.protocol.createData({ object: 'wf_account', data: { name: 'Hooked' } });
    expect(seen).toEqual(['ACC-0001 - Hooked']);
  });

  it('an afterUpdate hook observes it too', async () => {
    const created = await rig.protocol.createData({ object: 'wf_account', data: { name: 'Hooked' } });
    const seen: unknown[] = [];
    rig.engine.registerHook('afterUpdate', (ctx) => {
      seen.push((ctx.result as Rec)?.display_title);
    }, { object: 'wf_account' });

    await rig.protocol.updateData({
      object: 'wf_account',
      id: String(created.id),
      data: { name: 'Rehooked' },
    });
    expect(seen).toEqual(['ACC-0001 - Rehooked']);
  });
});

describe('#5504 — cost threshold: same gate the read path uses', () => {
  let rig: Rig;
  let evaluate: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    rig = await makeEngine();
    evaluate = vi.spyOn(ExpressionEngine, 'evaluate');
  });
  afterEach(() => { evaluate.mockRestore(); });

  it('an object declaring NO formula evaluates nothing on write', async () => {
    const created = await rig.protocol.createData({ object: 'wf_plain', data: { name: 'nothing derived' } });
    expect(evaluate).not.toHaveBeenCalled();
    // …and the response carries exactly the stored keys — no phantom columns.
    expect(Object.keys(created.record as Rec).sort()).toEqual(['id', 'name']);
  });

  it('an object declaring formulas evaluates once per formula field per row', async () => {
    await rig.protocol.createData({ object: 'wf_forecast', data: { amount: 2, probability: 1, quota: 4 } });
    // 3 formula fields × 1 row. No `defaultValue` expression on this object, so
    // every evaluation observed here is the hydration's.
    expect(evaluate).toHaveBeenCalledTimes(3);
  });
});
