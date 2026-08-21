// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10280 — a `formula` field's declared `scale` is applied WHERE THE VALUE IS
 * PRODUCED: inside `applyFormulaPlan`, the moment the expression is evaluated.
 *
 * The card, measured on 17.1.0: HotCRM's `crm_campaign.response_rate` declares
 *
 * ```ts
 * response_rate: Field.formula({
 *   expression: F`coalesce(record.num_sent, 0) > 0
 *                 ? (coalesce(record.num_responses, 0) * 100.0) / record.num_sent
 *                 : 0.0`,
 *   scale: 2,
 * })
 * ```
 *
 * and `GET /api/v1/data/crm_campaign/` answered `41.666666666666664` for
 * `num_sent: 12 / num_responses: 5`. The declaration was inert: `scale` reached
 * no reader on the evaluation path, so every consumer inherited the raw double
 * and the record page printed all fifteen digits.
 *
 * ⚠️ A formula value is **returned**, never stored — it has no SQL column
 * (`driver-sql`'s `fieldHasColumn` returns false for `formula`, and the SQL
 * driver refuses it as a cross-field referent: "virtual, no column"), and
 * `driver-memory` hands back shallow copies, so the in-place mutation
 * `applyFormulaPlan` performs cannot reach any store. The card's title says
 * "stores and returns"; only the second half is true. The `DECIMAL(10,2)`
 * hazard the card describes is real but strictly DOWNSTREAM — an app copying a
 * formula result into a stored money field — and producer-side rounding is
 * what makes that copy writable.
 *
 * ## The three controls this file exists to carry
 *
 *  1. **defect** — the card's own percentage formula returns the value rounded
 *     to its declared `scale`. Fails on `origin/main`.
 *  2. **no-scale** — a formula declaring no `scale` returns full precision,
 *     unchanged. Without it, the fix could quietly round every formula in the
 *     platform and nothing would say so.
 *  3. ⭐ **discriminating** — a caller-supplied over-scale plain number on a
 *     `Field.number({ scale })` is still REJECTED (`max_scale`), never
 *     rounded. #7501 / maintainer ruling 2026-08-11: "`scale` — enforced by
 *     REJECTION, never rounding". This control is what fails if the rounding
 *     is put in `validateFieldValue`'s `scale` branch — the package's only
 *     other `.scale` reader, and the tempting seam. Rounding inside
 *     `applyFormulaPlan`, whose plan entries are `type === 'formula'` ONLY,
 *     leaves that path structurally untouched. Control 1 and control 3 declare
 *     the SAME `scale: 2` on the SAME record here, on purpose: one is
 *     platform-computed (not refusable — there is nobody to refuse), the other
 *     is caller-supplied (refusable, and refused).
 *
 * ## Rounding semantics, pinned rather than assumed
 *
 * `Number(v.toFixed(scale))`, matching objectui's `computeRow`
 * (`GridField.tsx`) so a grid's client-side computed column and the engine's
 * server-side formula round the same way. Per ECMA-262 `toFixed` extracts the
 * sign first and then picks the larger `n` on a tie, i.e. round-half-**away
 * from zero** on the magnitude — measured here, not inferred: `2.5 → 3`,
 * `1.25 → 1.3`, `0.125 → 0.13`, and negatives away from zero (`-1.5 → -2`),
 * NOT toward `+Infinity`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { validationFailureDetails, VALIDATION_FAILED_STATUS } from '@objectstack/types';
import { ObjectQL } from './engine.js';

/** The card's own object, field for field. */
const CAMPAIGN = {
  name: 'fs_campaign',
  label: 'Campaign',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    num_sent: { name: 'num_sent', label: 'Sent', type: 'number' as const },
    num_responses: { name: 'num_responses', label: 'Responses', type: 'number' as const },
    /** CONTROL 1 — the card's declaration verbatim. */
    response_rate: {
      name: 'response_rate', label: 'Response Rate %', type: 'formula' as const,
      expression: {
        dialect: 'cel',
        source: 'coalesce(record.num_sent, 0) > 0 '
          + '? (coalesce(record.num_responses, 0) * 100.0) / record.num_sent '
          + ': 0.0',
      },
      scale: 2,
    },
    /** CONTROL 2 — the SAME expression with no `scale`: full precision, untouched. */
    response_rate_raw: {
      name: 'response_rate_raw', label: 'Response Rate (raw)', type: 'formula' as const,
      expression: {
        dialect: 'cel',
        source: 'coalesce(record.num_sent, 0) > 0 '
          + '? (coalesce(record.num_responses, 0) * 100.0) / record.num_sent '
          + ': 0.0',
      },
    },
    /** Same expression at `scale: 0` — rounding, not truncation. */
    response_rate_whole: {
      name: 'response_rate_whole', label: 'Response Rate (whole)', type: 'formula' as const,
      expression: {
        dialect: 'cel',
        source: 'coalesce(record.num_sent, 0) > 0 '
          + '? (coalesce(record.num_responses, 0) * 100.0) / record.num_sent '
          + ': 0.0',
      },
      scale: 0,
    },
    /**
     * ⭐ CONTROL 3 — a CALLER-SUPPLIED number carrying the same `scale: 2`
     * declaration, on the same object. #7501 refuses an over-scale write here;
     * nothing on this branch may start rounding it.
     */
    plain_rate: { name: 'plain_rate', label: 'Plain Rate', type: 'number' as const, scale: 2 },
  },
};

/**
 * The rounding helper's whole domain, one formula field per case.
 *
 * Most sources are literals or a bare `record.<field>` passthrough: a
 * passthrough is how a value that no expression can compute (`-0.001`, `1e21`)
 * is put in front of the rounding step through the real evaluation path rather
 * than by unit-calling a private helper.
 */
const EDGE = {
  name: 'fs_edge',
  label: 'Edge',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    tiny: { name: 'tiny', label: 'Tiny', type: 'number' as const },
    big: { name: 'big', label: 'Big', type: 'number' as const },

    // ── ties: half AWAY FROM ZERO, both signs ──
    tie_up: f('tie_up', '2.5', 0),
    tie_up_1dp: f('tie_up_1dp', '1.25', 1),
    tie_up_2dp: f('tie_up_2dp', '0.125', 2),
    tie_neg: f('tie_neg', '-1.5', 0),
    tie_neg_2: f('tie_neg_2', '-2.5', 0),

    // ── results that are not numbers: the helper must not touch them ──
    // ⚠️ `'hello'.toFixed` does not exist — without the `typeof` guard this
    // field alone throws and takes the whole read down with it.
    str_out: f('str_out', '"hello"', 2),
    bool_out: f('bool_out', 'true', 2),
    null_out: f('null_out', 'record.absent', 2),

    // ── non-finite results ──
    inf_out: f('inf_out', '1.0 / 0.0', 2),
    nan_out: f('nan_out', '0.0 / 0.0', 2),

    // ── negative zero: `(-0.001).toFixed(2)` is '-0.00' ──
    neg_zero: f('neg_zero', 'record.tiny', 2),

    // ── beyond `toFixed`'s exponential threshold ──
    huge: f('huge', 'record.big', 2),

    // ── beyond `toFixed`'s 100-digit domain: RangeError if not guarded ──
    deep_scale: f('deep_scale', 'record.tiny', 200),

    // ── a malformed declaration is left unenforced, as at the write path ──
    malformed_scale: f('malformed_scale', 'record.tiny', 2.5),
    negative_scale: f('negative_scale', 'record.tiny', -1),
  },
};

/** Formula field shorthand for the edge table above. */
function f(name: string, source: string, scale?: number) {
  return {
    name, label: source, type: 'formula' as const,
    expression: { dialect: 'cel', source },
    ...(scale === undefined ? {} : { scale }),
  };
}

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
    // every real backend hands back, and load-bearing here: the read path
    // hydrates by mutating the rows a driver returns, so a harness leaking
    // references would write the rounded value into its own store on the first
    // read and every later assertion would pass with the fix deleted.
    async find(object: string, ast: { where?: unknown }) {
      return Array.from(storeFor(object).values())
        .filter((r) => matchesWhere(r, ast?.where))
        .map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: { where?: unknown }) {
      for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return { ...r };
      return null;
    },
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
  for (const obj of [CAMPAIGN, EDGE]) engine.registry.registerObject(obj as never);
  const protocol = new ObjectStackProtocolImplementation(engine);
  return { engine, protocol, ...rig };
}

type Rig = Awaited<ReturnType<typeof makeEngine>>;
type Rec = Record<string, unknown>;

/** The card's seed data: 5 of 12 → 41.666666666666664 before rounding. */
const SEED = { name: 'Spring blast', num_sent: 12, num_responses: 5 };

/** The raw double the card reported, spelled once. */
const RAW = 41.666666666666664;

describe('#10280 CONTROL 1 (defect) — a formula applies its declared `scale`', () => {
  let rig: Rig;
  beforeEach(async () => { rig = await makeEngine(); });

  it("the card's own repro: 5 of 12 returns 41.67, not 41.666666666666664", async () => {
    const created = await rig.protocol.createData({ object: 'fs_campaign', data: SEED });
    const record = created.record as Rec;

    expect(record.response_rate).toBe(41.67);
    // Spelled as a NON-assertion too, because the card is about the digits a
    // user reads on the record page — this is the string that was printed.
    expect(String(record.response_rate)).toBe('41.67');
    expect(record.response_rate).not.toBe(RAW);
  });

  it('rounds, never truncates — `scale: 0` on the same value gives 42', async () => {
    const created = await rig.protocol.createData({ object: 'fs_campaign', data: SEED });
    expect((created.record as Rec).response_rate_whole).toBe(42);
  });

  it('an exactly-representable result is unchanged (the card\'s `roi` accident)', async () => {
    // 4 of 16 = 25 exactly. `scale` must be a no-op here, not a re-shape.
    const created = await rig.protocol.createData({
      object: 'fs_campaign',
      data: { name: 'Even', num_sent: 16, num_responses: 4 },
    });
    expect((created.record as Rec).response_rate).toBe(25);
  });
});

describe('#10280 CONTROL 1 — every plan-entry call site rounds, not just `find`', () => {
  let rig: Rig;
  beforeEach(async () => { rig = await makeEngine(); });

  // `planFormulaProjection` feeds exactly three call sites in the engine:
  // `find`, `findOne`, and `hydrateWriteFormulas` (the write response, itself
  // reached from the single-record and the batch write paths). A fix that
  // rounded on read but not on the write response would ship the defect on
  // half the surface, so each is asserted through the protocol surface REST
  // calls rather than by unit-calling the helper.

  it('WRITE response — create', async () => {
    const created = await rig.protocol.createData({ object: 'fs_campaign', data: SEED });
    expect((created.record as Rec).response_rate).toBe(41.67);
  });

  it('WRITE response — update recomputes from the post-write values, rounded', async () => {
    const created = await rig.protocol.createData({ object: 'fs_campaign', data: SEED });
    const updated = await rig.protocol.updateData({
      object: 'fs_campaign',
      id: String(created.id),
      data: { num_responses: 7 },
    });
    // 7/12*100 = 58.333333333333336
    expect((updated.record as Rec).response_rate).toBe(58.33);
    expect((updated.record as Rec).response_rate_raw).toBe(58.333333333333336);
  });

  it('WRITE response — batch (`createManyData` → the bulk hydration site)', async () => {
    const res = await rig.protocol.createManyData({
      object: 'fs_campaign',
      records: [SEED, { name: 'Second', num_sent: 3, num_responses: 1 }],
    });
    // 1/3*100 = 33.33333333333333
    expect((res.records as Rec[]).map((r) => r.response_rate)).toEqual([41.67, 33.33]);
  });

  it('WRITE response — partial-success batch (`insertManyData`)', async () => {
    const res = await rig.protocol.insertManyData({
      object: 'fs_campaign',
      records: [SEED],
    });
    const [ok] = res.outcomes;
    expect(ok.ok).toBe(true);
    expect((ok.record as Rec).response_rate).toBe(41.67);
  });

  it('READ — `findOne` (GET /data/:object/:id)', async () => {
    const created = await rig.protocol.createData({ object: 'fs_campaign', data: SEED });
    const fetched = await rig.protocol.getData({ object: 'fs_campaign', id: String(created.id) });
    expect((fetched.record as Rec).response_rate).toBe(41.67);
  });

  it('READ — `find` (GET /data/:object), full projection', async () => {
    await rig.protocol.createData({ object: 'fs_campaign', data: SEED });
    const rows = await rig.engine.find('fs_campaign', {} as never) as Rec[];
    expect(rows).toHaveLength(1);
    expect(rows[0].response_rate).toBe(41.67);
  });

  it('READ — `find` with an EXPLICIT projection (the `projected` branch)', async () => {
    // The other half of `planFormulaProjection`: a caller-named field list
    // takes a different branch to build the plan, and it must carry `scale`
    // too.
    await rig.protocol.createData({ object: 'fs_campaign', data: SEED });
    const rows = await rig.engine.find('fs_campaign', { fields: ['response_rate'] } as never) as Rec[];
    expect(rows[0].response_rate).toBe(41.67);
  });

  it('the write response and the following read agree, digit for digit', async () => {
    const created = await rig.protocol.createData({ object: 'fs_campaign', data: SEED });
    const fetched = await rig.protocol.getData({ object: 'fs_campaign', id: String(created.id) });
    expect((fetched.record as Rec).response_rate).toBe((created.record as Rec).response_rate);
  });
});

describe('#10280 CONTROL 2 (no-scale) — an undeclared `scale` changes nothing', () => {
  let rig: Rig;
  beforeEach(async () => { rig = await makeEngine(); });

  it('a formula declaring NO `scale` returns full precision', async () => {
    const created = await rig.protocol.createData({ object: 'fs_campaign', data: SEED });
    // The same expression as `response_rate`, on the same record, in the same
    // response: the ONLY difference is the declaration.
    expect((created.record as Rec).response_rate_raw).toBe(RAW);
    expect(String((created.record as Rec).response_rate_raw)).toBe('41.666666666666664');
  });

  it('…on the read path too', async () => {
    await rig.protocol.createData({ object: 'fs_campaign', data: SEED });
    const rows = await rig.engine.find('fs_campaign', {} as never) as Rec[];
    expect(rows[0].response_rate_raw).toBe(RAW);
  });

  it('a malformed `scale` declaration is left UNENFORCED, exactly as at the write path', async () => {
    // Same posture as `validateFieldValue`'s `Number.isInteger(def.scale) &&
    // def.scale >= 0` guard: `scale: 2.5` has no defined meaning and inventing
    // one (floor? round?) is the consumer-side guessing PD #12 forbids. The
    // producer refuses it — `FieldSchema.scale` is `z.number().int().min(0)`.
    await rig.protocol.createData({ object: 'fs_edge', data: { tiny: -0.001, big: 1e21 } });
    const [row] = await rig.engine.find('fs_edge', {} as never) as Rec[];
    expect(row.malformed_scale).toBe(-0.001);
    expect(row.negative_scale).toBe(-0.001);
  });
});

describe('#10280 CONTROL 3 ⭐ (discriminating) — `Field.number({ scale })` still REJECTS', () => {
  let rig: Rig;
  beforeEach(async () => { rig = await makeEngine(); });

  /**
   * Maintainer ruling 2026-08-11 (#7501): "`scale` — enforced by REJECTION,
   * never rounding". A caller-supplied value has somebody to refuse; a
   * platform-computed formula result does not. This test is red if the
   * rounding is placed in the validator's `scale` branch instead of in
   * `applyFormulaPlan`.
   */
  it('an over-scale caller-supplied number is refused, not silently rounded', async () => {
    const attempt = rig.protocol.createData({
      object: 'fs_campaign',
      data: { ...SEED, plain_rate: RAW },
    });
    await expect(attempt).rejects.toThrow();

    const err = await attempt.then(() => null, (e: unknown) => e) as any;

    // The ADR-0112 envelope, not merely "it threw": code…
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields[0]).toMatchObject({
      field: 'plain_rate',
      code: 'max_scale',
      constraint: { scale: 2, actual: 15 },
    });
    // …and the status. An objectql `ValidationError` deliberately carries no
    // `.status` of its own — deciding it means 400 is the serving boundary's
    // job — so the assertion reads the platform's own recogniser rather than
    // re-spelling a status here.
    expect(validationFailureDetails(err)).toBeDefined();
    expect(VALIDATION_FAILED_STATUS).toBe(400);

    // And nothing was written: a refusal, not a rounded row.
    expect(await rig.engine.find('fs_campaign', {} as never)).toEqual([]);
  });

  it('the same `scale: 2`, the same record: the formula rounds, the plain number refuses', async () => {
    // The boundary in one assertion pair. `plain_rate` is supplied in-scale so
    // the write survives; `response_rate` is computed and rounded.
    const created = await rig.protocol.createData({
      object: 'fs_campaign',
      data: { ...SEED, plain_rate: 41.67 },
    });
    const record = created.record as Rec;
    expect(record.plain_rate).toBe(41.67);
    expect(record.response_rate).toBe(41.67);

    // …and the caller-supplied one is refused a decimal place later, while the
    // computed one is not.
    await expect(rig.protocol.updateData({
      object: 'fs_campaign',
      id: String(created.id),
      data: { plain_rate: 41.675 },
    })).rejects.toThrow(/decimal places/);
  });

  it('rejection reaches the UPDATE path too — the branch is untouched in both modes', async () => {
    const created = await rig.protocol.createData({ object: 'fs_campaign', data: SEED });
    const attempt = rig.protocol.updateData({
      object: 'fs_campaign',
      id: String(created.id),
      data: { plain_rate: RAW },
    });
    const err = await attempt.then(() => null, (e: unknown) => e) as any;
    expect(err?.code).toBe('VALIDATION_FAILED');
    expect(err.fields[0]).toMatchObject({ field: 'plain_rate', code: 'max_scale' });
  });
});

describe('#10280 — rounding semantics, measured not assumed', () => {
  let rig: Rig;
  let row: Rec;
  beforeEach(async () => {
    rig = await makeEngine();
    await rig.protocol.createData({ object: 'fs_edge', data: { tiny: -0.001, big: 1e21 } });
    [row] = await rig.engine.find('fs_edge', {} as never) as Rec[];
  });

  it('ties round HALF AWAY FROM ZERO, not half-to-even', async () => {
    expect(row.tie_up).toBe(3);        // 2.5  @0 — half-even would give 2
    expect(row.tie_up_1dp).toBe(1.3);  // 1.25 @1 — half-even would give 1.2
    expect(row.tie_up_2dp).toBe(0.13); // 0.125@2 — half-even would give 0.12
  });

  it('negatives round AWAY FROM ZERO, not toward +Infinity', async () => {
    // The one semantic worth stating out loud: -1.5 → -2, not -1.
    expect(row.tie_neg).toBe(-2);
    expect(row.tie_neg_2).toBe(-3);
  });

  it('a non-number result is returned untouched — and does not throw', async () => {
    // `'hello'.toFixed` is not a function: without the `typeof` guard this
    // single field takes down every read of every record of this object.
    expect(row.str_out).toBe('hello');
    expect(row.bool_out).toBe(true);
    expect(row.null_out).toBeNull();
  });

  it('a non-finite result is returned untouched', async () => {
    expect(row.inf_out).toBe(Infinity);
    expect(Number.isNaN(row.nan_out)).toBe(true);
    // ⚠️ NOT the string 'NaN': `NaN.toFixed(2)` yields a STRING, and a value
    // that arrives at a client as "NaN" instead of a number is a type change,
    // not a rounding.
    expect(typeof row.nan_out).toBe('number');
  });

  it('a value that rounds to zero from below is +0, never -0', async () => {
    // `(-0.001).toFixed(2)` is '-0.00' and `Number('-0.00')` is -0. It
    // JSON-serializes as 0, but `Intl.NumberFormat` formats it as "-0.00" —
    // which would put a brand-new display wart on the very record page this
    // card is about. Normalized at the producer.
    expect(row.neg_zero).toBe(0);
    expect(Object.is(row.neg_zero, -0)).toBe(false);
    expect(Object.is(row.neg_zero, 0)).toBe(true);
  });

  it('a magnitude past `toFixed`\'s exponential threshold is unchanged', async () => {
    // For |v| >= 1e21 `toFixed` returns exponential form ('1e+21'), which
    // `Number()` round-trips losslessly — the rounding degrades to a no-op
    // rather than corrupting the value.
    expect(row.huge).toBe(1e21);
  });

  it('a `scale` past `toFixed`\'s 100-digit domain is skipped, not thrown', async () => {
    // `(1).toFixed(101)` throws RangeError. A display-precision declaration
    // must never be able to fail a read, and asking for more decimals than an
    // IEEE-754 double carries is a no-op request either way.
    expect(row.deep_scale).toBe(-0.001);
  });
});
