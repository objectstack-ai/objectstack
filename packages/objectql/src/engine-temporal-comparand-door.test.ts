// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8690] The temporal-comparand door at the engine's filter collection point.
 *
 * The card's whole table is the fixture: 51 rows seeded, 38 inside a
 * start-of-day 30-days-ago floor, on a declared `datetime` field. Every
 * assertion below is one of its cells, so the suite reads as the defect it
 * closes rather than as an abstraction of it.
 *
 * The refusal pin and the POSITIVE CONTROL live in one `it()` by ruling: a
 * refusal pin with no positive control cannot show the gate is discriminating
 * rather than refusing everything, and the two drifting apart into separate
 * cases is how that guarantee gets lost.
 *
 * ## [#8937] No calendar date is pinned anywhere in this file
 *
 * This suite originally fixed its clock at `2026-08-15T09:00:00.000Z` and
 * threaded it through the engine as `{ context: { now } }`, then asserted the
 * `{30_days_ago}` floor equalled that instant minus 30 days. That assertion
 * passed only while the REAL date and the fixture date agreed: at
 * 2026-08-16T00:00Z it went red on every branch at once, with no code change,
 * and misattributed itself to whatever PR happened to be open.
 *
 * The mechanism was a clock the engine does not offer. `{30_days_ago}` is
 * resolved by `resolveFilterTokens` from an instant the engine never supplies,
 * so the resolver falls back to the process clock — `context.now` was never
 * read, and is not declared on `ExecutionContext` at all (the `as never` casts
 * that used to sit on those calls were the tell). Whether the engine SHOULD
 * expose an injectable clock is #8937's open half; it is a public-contract
 * question, not something this file may assume either way.
 *
 * So every temporal expectation here is derived, never written down:
 *
 * - the fixture seeds from the real clock, keeping the card's 38-in / 13-out
 *   split at any wall time (the nearest in-window row is 28 days back against
 *   a 30-day floor — two days of margin, so a run may even cross UTC midnight);
 * - the floor assertion compares against what the platform's OWN resolver
 *   yields, bracketing the engine call so the comparison is exact rather than
 *   tolerant;
 * - a separate pin shows that resolver is genuinely clock-sensitive, so the
 *   bracket above cannot be satisfied by a frozen or constant floor.
 *
 * The rule this file now follows: assert the engine and the resolver AGREE.
 * Never assert what day it is.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveFilterTokens } from '@objectstack/core';
import { ObjectQL } from './engine.js';

/**
 * The `{30_days_ago}` floor the platform's own resolver yields for `instant` —
 * the single source of truth this file compares the engine against.
 */
function resolvedFloorAt(instant: Date): string {
  const out = resolveFilterTokens({ $gte: '{30_days_ago}' }, { now: instant });
  return out.$gte as string;
}

/** Days back from `now`, as the canonical UTC instant the store holds. */
function daysAgoIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

const support_case = {
  name: 'support_case',
  label: 'Support Case',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    subject: { name: 'subject', type: 'text' as const },
    created_date: { name: 'created_date', type: 'datetime' as const },
    due_on: { name: 'due_on', type: 'date' as const },
    opens_at: { name: 'opens_at', type: 'time' as const },
  },
};

interface SeenRead { ast: any }

/**
 * A recording driver whose comparison is the LEXICOGRAPHIC one every temporal
 * backend performs on canonical UTC text — which is exactly why an
 * uninterpretable comparand answers zero rows instead of erroring: `'…Z' >=
 * 'last_30_days'` is simply false for every row.
 */
function makeRecordingDriver() {
  const rows = new Map<string, Record<string, unknown>>();
  const reads: SeenRead[] = [];
  const matches = (row: any, where: any): boolean => {
    if (where == null) return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === '$and') { if (!(v as any[]).every((w) => matches(row, w))) return false; continue; }
      if (k === '$or') { if (!(v as any[]).some((w) => matches(row, w))) return false; continue; }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const ops = v as Record<string, unknown>;
        if ('$eq' in ops && row[k] !== ops.$eq) return false;
        if ('$gte' in ops && !(String(row[k]) >= String(ops.$gte))) return false;
        if ('$lte' in ops && !(String(row[k]) <= String(ops.$lte))) return false;
        if ('$in' in ops && !(ops.$in as unknown[]).includes(row[k])) return false;
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  };
  const run = (ast: any) => [...rows.values()].filter((r) => matches(r, ast?.where));
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(_o: string, ast: any) { reads.push({ ast }); return run(ast); },
    async findOne(_o: string, ast: any) { reads.push({ ast }); return run(ast)[0] ?? null; },
    async count(_o: string, ast: any) { reads.push({ ast }); return run(ast).length; },
    async aggregate(_o: string, ast: any) { reads.push({ ast }); return run(ast); },
    async create(_o: string, data: Record<string, unknown>) {
      const id = (data.id as string) ?? `r_${rows.size + 1}`;
      const row = { ...data, id }; rows.set(id, row); return row;
    },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      const cur = rows.get(id) ?? {};
      const up = { ...cur, ...data, id }; rows.set(id, up); return up;
    },
    async updateMany(_o: string, ast: any, data: Record<string, unknown>) {
      const hit = run(ast);
      for (const r of hit) rows.set(r.id as string, { ...r, ...data });
      return hit.length;
    },
    async delete(_o: string, id: string) { return rows.delete(id); },
    async deleteMany(_o: string, ast: any) {
      const hit = run(ast);
      for (const r of hit) rows.delete(r.id as string);
      return hit.length;
    },
    async bulkCreate(o: string, batch: Record<string, unknown>[]) {
      return Promise.all(batch.map((r) => this.create(o, r)));
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, reads };
}

describe('[#8690] the temporal-comparand door at the engine collection point', () => {
  let engine: ObjectQL;
  let reads: SeenRead[];
  /**
   * [#8937] The REAL clock, read per run — never a pinned calendar date. The
   * engine resolves `{30_days_ago}` against the process clock, so a fixture
   * pinned to a written-down day is a test that arms itself to fail on a date.
   */
  let now: Date;

  beforeEach(async () => {
    now = new Date();
    const rec = makeRecordingDriver();
    reads = rec.reads;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    await engine.init();
    engine.registry.registerObject(support_case, 'test');
    // The card's dataset shape: 51 rows, 38 of them inside a start-of-day
    // 30-days-ago floor. `{30_days_ago}` resolves to that floor's `YYYY-MM-DD`,
    // and canonical UTC text sorts chronologically against it.
    for (let i = 0; i < 38; i++) {
      await engine.insert('support_case', {
        id: `in_${i}`, subject: `in ${i}`, created_date: daysAgoIso(now, i % 29),
      });
    }
    for (let i = 0; i < 13; i++) {
      await engine.insert('support_case', {
        id: `out_${i}`, subject: `out ${i}`, created_date: daysAgoIso(now, 40 + i),
      });
    }
    reads.length = 0;
  });

  const refusalOf = async (p: Promise<unknown>) =>
    p.then(() => null, (e: any) => e as Error & { code?: string; status?: number });

  it('refuses the card\'s comparands with code AND status, while the positive control still returns 38', async () => {
    // ── the defect's own cells ──────────────────────────────────────────────
    for (const comparand of ['last_30_days', 'not-a-date-at-all', 'last_7_days', 'last_90_days']) {
      // No context is threaded: the refusal precedes token resolution entirely,
      // so no clock — injected or otherwise — can participate in this verdict.
      const err = await refusalOf(
        engine.find('support_case', { where: { created_date: { $gte: comparand } } }),
      );
      expect(err, `${comparand} must be refused, not answered with an empty chart`).not.toBeNull();
      // The reverse-verification requirement: BOTH halves of the envelope.
      expect(err!.code).toBe('INVALID_FILTER');
      expect(err!.status).toBe(400);
      // The caller learns which field, which value, and that nothing ran.
      expect(err!.message).toContain('created_date');
      expect(err!.message).toContain(comparand);
      expect(err!.message).toMatch(/NOT applied/);
      // And no driver read happened — the refusal precedes the driver.
      expect(reads).toHaveLength(0);
    }

    // ── the POSITIVE CONTROL, in this same test by ruling ───────────────────
    // Without it the four refusals above are equally consistent with a gate
    // that refuses everything.
    // [#8937] Bracket the call rather than writing a date down: the engine
    // resolves against the process clock, so the floor it produced must be the
    // one the platform's own resolver yields for some instant inside the call.
    // Both ends are almost always the same string; they differ only if the call
    // straddles UTC midnight, which this comparison then absorbs exactly.
    const before = new Date();
    const inWindow = await engine.find(
      'support_case',
      { where: { created_date: { $gte: '{30_days_ago}' } } },
    );
    const after = new Date();

    expect(inWindow).toHaveLength(38);
    // The token really resolved — the door let the platform's own spelling
    // through untouched rather than judging it as an uninterpretable string.
    // Indexed rather than `.at(-1)`: this package's tsconfig targets a lib
    // older than ES2022, so `Array.prototype.at` is not declared for it.
    const boundFloor = reads[reads.length - 1].ast.where.created_date.$gte;
    expect([resolvedFloorAt(before), resolvedFloorAt(after)]).toContain(boundFloor);
    // …and it is a resolved DAY, not the placeholder surviving to the driver —
    // the failure this positive control exists to catch.
    expect(boundFloor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  /**
   * [#8937] The discriminating half of the floor assertion above.
   *
   * `toContain` against a resolver-derived value would also pass if the
   * resolver were frozen, constant, or clock-blind — in which case the engine
   * and the "source of truth" would agree on a wrong answer forever. These pins
   * show the resolver's floor genuinely tracks the instant it is handed, so
   * agreement with it is a real statement about the engine's clock.
   */
  it('resolves {30_days_ago} against the instant it is given, not a constant', () => {
    const a = new Date('2026-03-10T12:00:00.000Z');
    const b = new Date('2026-03-15T12:00:00.000Z');
    // Two instants five days apart yield two DIFFERENT floors, five days apart.
    expect(resolvedFloorAt(a)).toBe('2026-02-08');
    expect(resolvedFloorAt(b)).toBe('2026-02-13');
    expect(resolvedFloorAt(a)).not.toBe(resolvedFloorAt(b));
    // A month/year boundary. Safe to write down because these are the
    // resolver's INPUTS, not the wall clock: this case cannot rot on a date.
    expect(resolvedFloorAt(new Date('2026-01-05T00:00:00.000Z'))).toBe('2025-12-06');
    // With no instant supplied at all the resolver falls back to the process
    // clock — the behaviour the engine relies on. Bracketed, not compared to a
    // written-down day, so it holds across a UTC midnight too.
    const before = new Date();
    const fallback = resolveFilterTokens({ $gte: '{30_days_ago}' }, {}).$gte;
    const after = new Date();
    expect([resolvedFloorAt(before), resolvedFloorAt(after)]).toContain(fallback);
  });

  /**
   * [#8937] A CHARACTERIZATION pin, not an endorsement.
   *
   * `now` is not declared on `ExecutionContext` (neither the spec schema nor
   * `ExecutionContextLike` in `@objectstack/core` carries it), and nothing on
   * the engine's read path reads it — `filterTokenContextFrom` takes an
   * explicit `now` argument the engine never passes. An injected `context.now`
   * is therefore inert today, which is exactly what let a date-armed fixture
   * look like it was pinning a clock.
   *
   * Recorded here so the trap is a stated, tested fact instead of a silent one.
   * If #8937's open half lands — the engine gaining a declared, injectable
   * clock — this pin SHOULD go red: delete it in that PR, deliberately.
   */
  it('does not honour an injected context.now today — the engine reads the process clock', async () => {
    // An instant far from now: were it honoured, the floor would be near it.
    const injected = new Date('2020-06-01T00:00:00.000Z');
    const before = new Date();
    await engine.find(
      'support_case',
      { where: { created_date: { $gte: '{30_days_ago}' } } },
      { context: { now: injected } as never },
    );
    const after = new Date();

    const boundFloor = reads[reads.length - 1].ast.where.created_date.$gte;
    expect(boundFloor).not.toBe(resolvedFloorAt(injected));
    expect([resolvedFloorAt(before), resolvedFloorAt(after)]).toContain(boundFloor);
  });

  it('refuses on both doors — the lowered object form and the authored array sugar', async () => {
    const object = await refusalOf(
      engine.find('support_case', { where: { created_date: { $gte: 'last_30_days' } } }),
    );
    const array = await refusalOf(
      engine.find('support_case', { where: [['created_date', '>=', 'last_30_days']] as never }),
    );
    for (const err of [object, array]) {
      expect(err).not.toBeNull();
      expect(err).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    }
    expect(reads).toHaveLength(0);
  });

  it('covers every verb that collects a filter, read and write sides', async () => {
    const where = { created_date: { $gte: 'last_30_days' } };
    for (const call of [
      () => engine.find('support_case', { where }),
      () => engine.findOne('support_case', { where }),
      () => engine.count('support_case', { where }),
      () => engine.aggregate('support_case', { where, groupBy: ['subject'] } as never),
      () => engine.update('support_case', { subject: 'x' }, { where, multi: true }),
      () => engine.delete('support_case', { where, multi: true }),
    ]) {
      const err = await refusalOf(call());
      expect(err).not.toBeNull();
      expect(err).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    }
    expect(reads).toHaveLength(0);
  });

  it('judges the other two temporal kinds by their own storage rule', async () => {
    // `date` reads a leading `YYYY-MM-DD` and nothing else, so a slash-spelled
    // day is uninterpretable there even though `Date.parse` reads it — today it
    // survives to the driver and compares as text against `YYYY-MM-DD` values.
    const badDate = await refusalOf(engine.find('support_case', { where: { due_on: { $gte: '2026/07/15' } } }));
    expect(badDate).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    // …and the spelling that rule DOES read is not refused. A VERDICT, not a
    // row count: these two columns are unset on the fixture, so which rows come
    // back is the recording driver's business and not this door's.
    await expect(engine.find('support_case', { where: { due_on: { $gte: '2026-07-15' } } })).resolves.toBeDefined();

    // `time` reads a wall clock whose components are in range.
    const badTime = await refusalOf(engine.find('support_case', { where: { opens_at: { $gte: '25:00' } } }));
    expect(badTime).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    await expect(engine.find('support_case', { where: { opens_at: { $gte: '09:30' } } })).resolves.toBeDefined();
  });

  it('judges every comparand position a temporal field can carry', async () => {
    for (const where of [
      { created_date: 'last_30_days' },                                  // implicit equality
      { created_date: { $in: ['2026-07-15', 'last_30_days'] } },         // a list MEMBER
      { created_date: { $between: ['2026-07-15', 'last_30_days'] } },    // a range bound
      { $and: [{ subject: 'x' }, { created_date: { $lte: 'last_30_days' } }] },
      { $or: [{ subject: 'x' }, { $not: { created_date: { $gte: 'last_30_days' } } }] },
    ]) {
      const err = await refusalOf(engine.find('support_case', { where: where as never }));
      expect(err, JSON.stringify(where)).not.toBeNull();
      expect(err).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    }
    expect(reads).toHaveLength(0);
  });

  it('leaves alone everything the ruling scoped out', async () => {
    // A NON-temporal field: `$gte 'last_30_days'` on text is a legitimate
    // lexicographic bound and the door has no opinion about it.
    await expect(engine.find('support_case', { where: { subject: { $gte: 'last_30_days' } } })).resolves.toBeDefined();
    // The EMPTY-string cell stays its own card — measured, it binds as `''` and
    // returns every non-null row (51 of 51). Unchanged here, deliberately.
    await expect(engine.find('support_case', { where: { created_date: { $gte: '' } } })).resolves.toHaveLength(51);
    // Non-strings: epoch milliseconds and a real `Date` are read correctly today.
    await expect(engine.find('support_case', { where: { created_date: { $gte: now.getTime() } } })).resolves.toBeDefined();
    await expect(engine.find('support_case', { where: { created_date: { $gte: now } } })).resolves.toBeDefined();
    // A `null` comparand is a null test, not a temporal value.
    await expect(engine.find('support_case', { where: { created_date: null } })).resolves.toBeDefined();
    // A `{ $field }` reference is not a literal.
    await expect(
      engine.find('support_case', { where: { created_date: { $gte: { $field: 'due_on' } } } as never }),
    ).resolves.toBeDefined();
  });

  it('leaves an UNKNOWN placeholder to the token resolver, which still refuses it loudly', async () => {
    // The door runs BEFORE token resolution, so stepping around placeholders is
    // what keeps `{30_days_ago}` working. The unknown ones keep their own
    // refusal — a different code on purpose, because nothing here is a token.
    for (const token of ['{TODAY}', '{not_a_token}']) {
      const err = await refusalOf(engine.find('support_case', { where: { created_date: { $gte: token } } }));
      expect(err).not.toBeNull();
      expect(err!.code).toBe('FILTER_TOKEN_UNKNOWN');
      expect(err!.status).toBe(400);
    }
  });

  it('invents no verdict on an object whose field map it cannot see', async () => {
    // A registry-less host must not refuse a filter on a field it cannot type —
    // the same early return the neighbouring gates make.
    await expect(
      engine.find('unregistered_object', { where: { created_date: { $gte: 'last_30_days' } } }),
    ).resolves.toBeDefined();
  });
});
