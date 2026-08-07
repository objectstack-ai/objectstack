// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5918 — a DOTTED measure is refused loudly, naming what the caller wrote.
 *
 * The fourth mint site of the punctuation #5739 sorted out. That issue narrowed
 * the three DIMENSION-shaped mints in `inferCubeFromQuery` from "strip the first
 * segment of any dotted member" to "strip the `<cube>.` qualifier and nothing
 * else", so `owner.region` became a traversal instead of the base table's own
 * `region` column. `measures` deliberately kept the blanket strip, on
 * measurement: `lookupMember`'s synthetic relation-traversal tier is
 * dimension-only (`if (kind === 'dimension')`), so a dotted MEASURE had no
 * correct traversal answer to converge on, and minting it verbatim would have
 * turned a plain typo (`total.sum`) from a clean 400 into ObjectQL's uncoded
 * "cannot evaluate a cross-object measure".
 *
 * What that left, measured on `origin/main` `01faeb13a` with `crm_account`
 * carrying a base column also called `region`:
 *
 * ```
 * measures: ['owner.region_count_distinct']
 *   NativeSQL → SELECT COUNT(DISTINCT region) AS "owner.region_count_distinct" FROM "crm_account"
 *   ObjectQL  → aggregations: [{field:'region', method:'count_distinct',
 *                               alias:'owner.region_count_distinct'}]
 *   getMeta   → crm_account.region_count_distinct
 * ```
 *
 * No JOIN, no error, and a response column LABELLED with a relation attribute
 * whose number came from the base table — the caller cannot see it is wrong.
 * Where the object had no same-named column it degraded instead to #4437's
 * `400 INVALID_FIELD` naming the STRIPPED tail (`… aggregates field 'score'`
 * for a caller who wrote `owner.score_sum`): honest about what reached SQL,
 * about a string nobody sent.
 *
 * **Maintainer ruling, 2026-08-07 (#5918, option 3): refuse the dotted measure
 * loudly** — `INVALID_FIELD` / 400 naming the caller's original spelling.
 * Explicitly NOT an extension of #5739's ruling: there, refusing would have
 * rejected queries that already compiled correctly; here there is no correct
 * answer to converge on. Both the typo (`total.sum`) and the genuine traversal
 * intent (`owner.amount_sum`) eat this 400, because the two are lexically
 * indistinguishable and telling them apart needs field metadata the ad-hoc path
 * does not have. A real traversal measure would be a capability with its own
 * justification. This TIGHTENS externally visible behaviour on purpose: queries
 * that pass silently today start answering 400 — today they aggregate the wrong
 * column.
 *
 * ## Both mint sites, because both were reachable
 *
 * `ensureCube` mints a Metric from a request spelling in two places, and the
 * issue's repro reaches BOTH. The ad-hoc mint (`inferCubeFromQuery`) REGISTERS
 * what it infers, so from the second request onwards the same cube arrives at
 * the augmentation loop in the "cube exists" branch instead. Measured on
 * `origin/main` `01faeb13a`, one service, two queries:
 *
 * ```
 * ① measures: ['count']                       → SELECT COUNT(*) …            (warms the registry)
 * ② measures: ['owner.region_count_distinct']  → SELECT COUNT(DISTINCT region) AS "owner.region_count_distinct"
 * ```
 *
 * Refusing at only one site would have closed the cold request and left every
 * warm one exactly as it was — i.e. left the reported harm in place on any
 * live server. Block 2 is that half; `mintableMeasureKey` is the one rule both
 * sites call.
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Restoring the blanket strip at either mint site turns blocks 1 and 2 RED, in
 * the ordinary direction: every case there asserts a refusal that names the
 * caller's spelling in `member`, and the same-named-column cases additionally
 * assert that NOTHING was executed (`sqls` / `calls` empty). With the strip
 * back, those queries succeed and produce exactly the statement quoted above,
 * so they cannot pass by producing nothing. The no-same-named-column case
 * (`owner.score_sum`) goes red on `member`/`field` rather than on execution: it
 * was refused before the change too, but by #4437's gate, which names `score` in
 * `field` and sets no `member` — the inversion trap this file avoids by
 * asserting the DIAGNOSTIC, not merely that something threw.
 *
 * Block 3 fences what the ruling does NOT move — the `<cube>.` qualifier, bare
 * measures, a cube's own declared vocabulary, and the DIMENSION traversal #5739
 * ruled the other way — and four of its five cases stay green in both
 * directions. The fifth does not, and it is worth naming rather than rounding
 * off: "a cube's OWN declared dotted measure … still runs" goes RED under the
 * full reversal, because the blanket strip does not merely mis-cast REQUEST
 * spellings — it also walks straight past a cube's declared dotted key
 * (`owner.amount_sum`), mints `amount_sum` over a base column `amount` that
 * `crm_account` does not have, and lets #4437 refuse the cube's own authored
 * vocabulary. Checking the declared key VERBATIM first is therefore part of this
 * change and not a tidy-up: without it the refusal would have taken a working
 * authored measure with it.
 *
 * **Predicted before running: 10 red (blocks 1+2, plus that one block-3 case),
 * 4 green. Measured exactly that set.**
 */

import { describe, it, expect, vi } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import { AnalyticsService } from '../analytics-service.js';

const silentLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as any;

/**
 * `crm_account`'s real columns. `region` is deliberately one of them — it is the
 * base column `owner.region_count_distinct` used to be aggregated over, and the
 * reason the defect was silent rather than a `no such column`. There is no
 * `score`, which is the other measured tier (#4437's 400 on the stripped tail).
 */
const ACCOUNT_FIELDS = ['id', 'name', 'industry', 'region', 'owner', 'created_at'];

type Refusal = Error & {
  code?: string;
  status?: number;
  field?: string;
  member?: string;
  param?: string;
  cube?: string;
  measure?: string;
};

function makeService(opts: { native?: boolean; cubes?: Cube[] } = {}) {
  const sqls: string[] = [];
  const calls: Array<{ object: string; aggregations?: unknown }> = [];
  const service = new AnalyticsService({
    logger: silentLogger,
    ...(opts.cubes ? { cubes: opts.cubes } : {}),
    queryCapabilities: () => ({
      nativeSql: !!opts.native,
      objectqlAggregate: !opts.native,
      inMemory: false,
    }),
    executeAggregate: async (object: string, options: any) => {
      calls.push({ object, aggregations: options?.aggregations });
      return [{ count: 5 }];
    },
    executeRawSql: async (_object: string, sql: string) => {
      sqls.push(sql);
      return [{ count: 1 }];
    },
    isRegisteredObject: (n: string) => n === 'crm_account',
    getObjectFieldNames: (n: string) => (n === 'crm_account' ? ACCOUNT_FIELDS : undefined),
  } as any);
  return { service, sqls, calls };
}

/** Run one query on a fresh service and report everything it produced. */
async function run(query: unknown, opts: { native?: boolean; cubes?: Cube[] } = {}) {
  const { service, sqls, calls } = makeService(opts);
  let rows: unknown[] | undefined;
  let error: Refusal | undefined;
  try {
    rows = (await service.query(query as never)).rows as unknown[];
  } catch (e) {
    error = e as Refusal;
  }
  const [meta] = await service.getMeta((query as { cube: string }).cube);
  const cubePrefix = `${(query as { cube: string }).cube}.`;
  return {
    rows,
    error,
    sqls,
    calls,
    service,
    measures: (meta?.measures ?? []).map((m) => m.name.replace(cubePrefix, '')).sort(),
  };
}

/** The one wire shape every refusal in blocks 1 and 2 must have. */
function expectDottedMeasureRefusal(error: Refusal | undefined, member: string) {
  expect(error).toBeInstanceOf(Error);
  // The #4437 family's envelope — one class of mistake, one shape (ADR-0112).
  expect(error?.code).toBe('INVALID_FIELD');
  expect(error?.status).toBe(400);
  expect(error?.param).toBe('measures');
  expect(error?.cube).toBe('crm_account');
  // The ruling's substance: the caller's ORIGINAL spelling, verbatim.
  expect(error?.member).toBe(member);
  expect(error?.message).toContain(`Measure '${member}'`);
  // …and never the string the old strip produced instead.
  expect(error?.message).not.toMatch(/aggregates field/);
  // `field` is the source-field gates' diagnostic (a missing base COLUMN). This
  // refusal has no column to name — naming one would invent a fact (#5716).
  expect(error?.field).toBeUndefined();
}

// ── 1. The two shapes the issue measured, on both strategies ─────────────────

describe('[#5918] a dotted measure is refused, naming the caller\'s spelling', () => {
  it('NativeSQL — the silent one: base table has a same-named column', async () => {
    const { error, sqls, rows } = await run(
      { cube: 'crm_account', measures: ['owner.region_count_distinct'] },
      { native: true },
    );

    expectDottedMeasureRefusal(error, 'owner.region_count_distinct');
    // The whole point: it never became `COUNT(DISTINCT region)` on the base table.
    expect(sqls).toEqual([]);
    expect(rows).toBeUndefined();
  });

  it('ObjectQL — the same silent one, refused identically', async () => {
    // Refusing at the MINT is what makes the two strategies agree for free: the
    // verdict is reached before a strategy is even resolved.
    const { error, calls } = await run({
      cube: 'crm_account',
      measures: ['owner.region_count_distinct'],
    });

    expectDottedMeasureRefusal(error, 'owner.region_count_distinct');
    expect(calls).toEqual([]);
  });

  it('the honest-but-misnamed one: base table has NO same-named column', async () => {
    // Was #4437's `400 INVALID_FIELD` with `field: 'score'` — true of what
    // reached SQL, about a string the caller never wrote. Now it names
    // `owner.score_sum`, like its silent sibling above, so the two tiers of the
    // SAME mistake stop giving two different answers.
    const { error, sqls } = await run(
      { cube: 'crm_account', measures: ['owner.score_sum'] },
      { native: true },
    );

    expectDottedMeasureRefusal(error, 'owner.score_sum');
    expect(error?.message).not.toContain("'score'");
    expect(sqls).toEqual([]);
  });

  it('the TYPO spelling eats the same 400 — deliberately, not incidentally', async () => {
    // `total.sum` is a `total_sum` slip, not a traversal, and the ruling covers
    // it on purpose: the two are lexically indistinguishable here, and telling
    // them apart would need field metadata this path does not have.
    const { error, sqls } = await run(
      { cube: 'crm_account', measures: ['total.sum'] },
      { native: true },
    );

    expectDottedMeasureRefusal(error, 'total.sum');
    expect(sqls).toEqual([]);
  });

  it('refuses `/analytics/sql` too — a dry run must not hand back the wrong SQL', async () => {
    const { service } = makeService({ native: true });

    const error = await service
      .generateSql({ cube: 'crm_account', measures: ['owner.region_count_distinct'] } as any)
      .then(() => undefined, (e) => e as Refusal);

    expectDottedMeasureRefusal(error, 'owner.region_count_distinct');
  });

  it('leaves the registry as it found it — a retry gets the same answer', async () => {
    // Same rule the #3867 and #4437 gates keep: a rejected query must leave no
    // trace, or the retry finds a "registered" cube carrying the bogus measure
    // and sails straight into SQL.
    const { service, sqls } = makeService({ native: true });
    const q = { cube: 'crm_account', measures: ['owner.region_count_distinct'] } as any;

    await expect(service.query(q)).rejects.toThrow();
    expect(service.cubeRegistry.get('crm_account')).toBeUndefined();

    const second = await service.query(q).then(
      () => { throw new Error('expected the retry to be refused too'); },
      (e) => e as Refusal,
    );
    expectDottedMeasureRefusal(second, 'owner.region_count_distinct');
    expect(sqls).toEqual([]);
  });
});

// ── 2. The second mint site: a WARM registry ─────────────────────────────────

describe('[#5918] the warm registry gets the same answer as the cold one', () => {
  it('NativeSQL — a first query registers the inferred cube; the second is still refused', async () => {
    // The ad-hoc path registers what it infers, so request #2 arrives at
    // `ensureCube`'s augmentation loop instead of `inferCubeFromQuery`. Before
    // the ruling that loop still blanket-stripped, so a live server silently
    // aggregated the wrong column from the second request onwards.
    const { service, sqls } = makeService({ native: true });

    await service.query({ cube: 'crm_account', measures: ['count'] } as any);
    expect(sqls).toEqual(['SELECT COUNT(*) AS "count" FROM "crm_account"']);
    expect(service.cubeRegistry.get('crm_account')).toBeDefined();

    const error = await service
      .query({ cube: 'crm_account', measures: ['owner.region_count_distinct'] } as any)
      .then(() => undefined, (e) => e as Refusal);

    expectDottedMeasureRefusal(error, 'owner.region_count_distinct');
    // Nothing new executed…
    expect(sqls).toEqual(['SELECT COUNT(*) AS "count" FROM "crm_account"']);
    // …and the registered cube was not augmented with the bogus measure either.
    expect(Object.keys(service.cubeRegistry.get('crm_account')!.measures)).toEqual(['count']);
  });

  it('ObjectQL — same', async () => {
    const { service, calls } = makeService();

    await service.query({ cube: 'crm_account', measures: ['count'] } as any);
    expect(calls).toHaveLength(1);

    const error = await service
      .query({ cube: 'crm_account', measures: ['owner.region_count_distinct'] } as any)
      .then(() => undefined, (e) => e as Refusal);

    expectDottedMeasureRefusal(error, 'owner.region_count_distinct');
    expect(calls).toHaveLength(1);
  });

  it('an AUTHORED cube mints measures through the same rule', async () => {
    // The augmentation loop serves authored cubes too, and the dotted spelling
    // was never a traversal there either: it minted `balance_sum` over the BASE
    // table, so nothing that worked is being taken away.
    const authored: Cube = {
      name: 'crm_account',
      title: 'Accounts',
      sql: 'crm_account',
      measures: { count: { name: 'count', label: 'Count', type: 'count', sql: '*' } },
      dimensions: {},
      public: false,
    };
    const { error, sqls } = await run(
      { cube: 'crm_account', measures: ['owner.region_count_distinct'] },
      { native: true, cubes: [authored] },
    );

    expectDottedMeasureRefusal(error, 'owner.region_count_distinct');
    expect(sqls).toEqual([]);
  });
});

// ── 3. What the ruling does NOT move ─────────────────────────────────────────

describe('[#5918] the surfaces the ruling leaves alone', () => {
  it('the `<cube>.` qualifier is still the one dot a measure may carry', async () => {
    // `getMeta` hands members out cube-prefixed and callers echo them back, so
    // this prefix is noise — stripping it is right, and is all that is stripped.
    const { error, sqls, measures } = await run(
      { cube: 'crm_account', measures: ['crm_account.region_count_distinct'] },
      { native: true },
    );

    expect(error).toBeUndefined();
    expect(measures).toContain('region_count_distinct');
    expect(sqls[0]).toBe(
      'SELECT COUNT(DISTINCT region) AS "crm_account.region_count_distinct" FROM "crm_account"',
    );
  });

  it('bare measures are untouched — inferred suffixes, `count`, engine columns', async () => {
    const { service, sqls } = makeService({ native: true });

    await service.query({ cube: 'crm_account', measures: ['count'] } as any);
    await service.query({
      cube: 'crm_account',
      measures: ['region_count_distinct', 'created_at_max'],
    } as any);

    expect(sqls).toEqual([
      'SELECT COUNT(*) AS "count" FROM "crm_account"',
      'SELECT COUNT(DISTINCT region) AS "region_count_distinct", MAX(created_at) AS "created_at_max" ' +
        'FROM "crm_account"',
    ]);
  });

  it('a cube\'s OWN declared dotted measure is authored, not minted — and still runs', async () => {
    // The refusal is about INVENTING a Metric from a request spelling. A cube
    // that declares the dotted key authored it deliberately, `lookupMember`
    // resolves it by direct hit, and the JOIN machinery serves it — which is
    // also the escape hatch the refusal message points callers at.
    const authored: Cube = {
      name: 'crm_account',
      title: 'Accounts',
      sql: 'crm_account',
      measures: {
        count: { name: 'count', label: 'Count', type: 'count', sql: '*' },
        'owner.amount_sum': {
          name: 'owner.amount_sum', label: 'Owner amount', type: 'sum', sql: 'owner.amount',
        },
      },
      dimensions: {},
      public: false,
    };
    const { error, sqls } = await run(
      { cube: 'crm_account', measures: ['owner.amount_sum'] },
      { native: true, cubes: [authored] },
    );

    expect(error).toBeUndefined();
    expect(sqls[0]).toContain('SUM("owner"."amount")');
    expect(sqls[0]).toContain('LEFT JOIN "owner"');
  });

  it('DIMENSIONS still traverse — #5739 ruled the other way, and stays ruled', async () => {
    // The two rulings are different because the two faces are: a dotted
    // dimension HAS a correct traversal answer to converge on, and converges.
    const { error, sqls } = await run(
      { cube: 'crm_account', measures: ['count'], dimensions: ['owner.region'] },
      { native: true },
    );

    expect(error).toBeUndefined();
    expect(sqls[0]).toContain('LEFT JOIN "owner" ON "crm_account"."owner" = "owner"."id"');
    expect(sqls[0]).toContain('"owner"."region"');
  });

  it('an unknown CUBE is still a 404 before any measure is judged', async () => {
    // Precedence, not politeness: the cube must exist before its measures can be
    // wrong about anything (#3867).
    const { error } = await run(
      { cube: 'not_an_object', measures: ['owner.region_count_distinct'] },
      { native: true },
    );

    expect(error?.code).toBe('CUBE_NOT_FOUND');
    expect(error?.status).toBe(404);
  });
});
