// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Aggregate-vocabulary conformance for `buildAggregationPipeline` +
 * `postProcessAggregation` — the shared `AGGREGATION_CASES` standard, answered
 * without a server (#6850, #6814).
 *
 * `mongodb-aggregation.ts` is an independent lowering of `QueryAST.aggregations`
 * + `QueryAST.groupBy`: it shares no line of code with the SQL compiler, with
 * Turso's remote transport, or with `objectql`'s in-memory fallback. Nothing
 * held it to the standard in `@objectstack/spec/data`, and all three defects the
 * DEBT row recorded were the kind that ANSWER rather than fail:
 *
 *   1. a structured `GroupByNode` stringified into a `"[object Object]"`
 *      `$group._id` — rows grouped by a field path that matches nothing, under
 *      a column of that name (#6850);
 *   2. `count_distinct` sized a `$addToSet` that CONTAINS the explicit nulls, so
 *      a nullable column answered one higher than `COUNT(DISTINCT col)` (#6814);
 *   3. measured here and named by neither card: `count(col)` ignored `field`
 *      entirely and answered the ROW count, so `count(stage)` came back 6 where
 *      the case-set says 4 — the number `count(*)` already has.
 *
 * ## Why this half must always run
 *
 * The real-mongod suites in this package are OPT-IN since #5517 (a ~123 MB
 * binary download that made green runs exit 1), so a defect only a downloadable
 * binary can catch is a defect nobody catches. `buildAggregationPipeline` and
 * `postProcessAggregation` are pure functions, which is what makes this half
 * possible at all — the same split as `mongodb-filter-logic-translation.test.ts`
 * and the shape #6814's closing conditions asked for.
 *
 * ## Why there is a pipeline evaluator in here
 *
 * The builder's output is a pipeline and the shared cases are stated as VALUES,
 * so something has to bridge the two. Pinning the emitted stages literally for
 * every case would pin today's spelling rather than the semantics — and it is
 * the semantics that were wrong: every one of the three defects above emitted a
 * perfectly well-formed pipeline.
 *
 * So {@link runPipeline} executes the emitted stages over
 * {@link AGGREGATION_ROWS} by MongoDB's documented semantics, and is
 * deliberately **strict**: every stage, accumulator and expression it does not
 * model is a thrown error, never a tolerated no-op. A stand-in more permissive
 * than the real engine turns a suite into a green light for broken code. Its own
 * discrimination is proved at the bottom of this file — each of the three
 * pre-fix lowerings is replayed through it and must FAIL the case it broke — so
 * "all green" cannot mean "the evaluator says yes to anything".
 *
 * What it deliberately does NOT answer: whether a real mongod agrees. `$cond` /
 * `$ifNull` / `$addToSet` are modelled here from the documentation, not
 * observed. That is the question the opt-in half would answer, and it is
 * recorded as open rather than implied — this environment cannot fetch a mongod
 * binary at all, and a suite nobody has executed is a claim, not a check.
 */

import { describe, it, expect } from 'vitest';
import {
  AGGREGATION_CASES,
  AGGREGATION_ROWS,
  type AggregationCase,
  type GroupByNode,
} from '@objectstack/spec/data';
import { buildAggregationPipeline, postProcessAggregation, type AggregationInput } from './mongodb-aggregation.js';

/** The alias every case's measure is projected under — never a fixture column. */
const MEASURE = 'measure';

// ── A deliberately strict reader of the emitted pipeline ────────────────────

/** Thrown for any shape this evaluator does not model — never swallowed. */
class UnsupportedShape extends Error {}

/** A field path that resolved to nothing. MongoDB distinguishes it from `null`. */
const MISSING = Symbol('missing');

type Doc = Record<string, unknown>;

/** Resolve a `'$a.b'` field path against a document, or {@link MISSING}. */
function resolvePath(doc: Doc, ref: string): unknown {
  if (!ref.startsWith('$')) throw new UnsupportedShape(`not a field path: ${ref}`);
  let current: unknown = doc;
  for (const part of ref.slice(1).split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return MISSING;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return MISSING;
    current = (current as Doc)[part];
  }
  return current;
}

/**
 * Evaluate an aggregation EXPRESSION against one document.
 *
 * Models only the operators this builder emits. `$$`-prefixed system variables
 * are refused rather than guessed at — `$$ROOT` reaches the `array_agg` arm, and
 * an evaluator that quietly resolved it would be asserting a semantics nobody
 * checked.
 */
function evalExpr(doc: Doc, expr: unknown): unknown {
  if (typeof expr === 'string' && expr.startsWith('$')) {
    if (expr.startsWith('$$')) throw new UnsupportedShape(`system variable '${expr}' is not modelled`);
    return resolvePath(doc, expr);
  }
  if (expr === null || typeof expr !== 'object') return expr; // literal
  if (Array.isArray(expr)) return expr.map((e) => evalExpr(doc, e));

  const keys = Object.keys(expr as Doc);
  if (keys.length !== 1) throw new UnsupportedShape(`expression with ${keys.length} keys: ${keys.join(', ')}`);
  const [op] = keys;
  const arg = (expr as Doc)[op];

  switch (op) {
    case '$ifNull': {
      if (!Array.isArray(arg) || arg.length !== 2) throw new UnsupportedShape('$ifNull takes [expr, replacement]');
      const value = evalExpr(doc, arg[0]);
      return value === MISSING || value === null ? evalExpr(doc, arg[1]) : value;
    }
    case '$eq': {
      if (!Array.isArray(arg) || arg.length !== 2) throw new UnsupportedShape('$eq takes two operands');
      // MISSING and null compare EQUAL under `$eq` in the aggregation language,
      // which is why the `count` lowering routes through `$ifNull` first rather
      // than relying on it.
      const left = evalExpr(doc, arg[0]);
      const right = evalExpr(doc, arg[1]);
      const norm = (v: unknown) => (v === MISSING ? null : v);
      return norm(left) === norm(right);
    }
    case '$cond': {
      if (!Array.isArray(arg) || arg.length !== 3) throw new UnsupportedShape('$cond takes [if, then, else]');
      return evalExpr(doc, arg[0]) ? evalExpr(doc, arg[1]) : evalExpr(doc, arg[2]);
    }
    default:
      throw new UnsupportedShape(`unsupported aggregation expression operator '${op}'`);
  }
}

/** One accumulator, folded over the documents of a single group. */
function accumulate(rows: Doc[], acc: unknown): unknown {
  if (acc === null || typeof acc !== 'object' || Array.isArray(acc)) {
    throw new UnsupportedShape(`accumulator must be a one-key document, got ${JSON.stringify(acc)}`);
  }
  const keys = Object.keys(acc as Doc);
  if (keys.length !== 1) throw new UnsupportedShape(`accumulator with ${keys.length} keys`);
  const [op] = keys;
  const arg = (acc as Doc)[op];
  const values = rows.map((row) => evalExpr(row, arg));
  /** MongoDB's arithmetic accumulators ignore missing and non-numeric values. */
  const numbers = values.filter((v): v is number => typeof v === 'number');

  switch (op) {
    case '$sum':
      return numbers.reduce((a, b) => a + b, 0);
    case '$avg':
      return numbers.length === 0 ? null : numbers.reduce((a, b) => a + b, 0) / numbers.length;
    case '$min':
      return numbers.length === 0 ? null : Math.min(...numbers);
    case '$max':
      return numbers.length === 0 ? null : Math.max(...numbers);
    case '$addToSet': {
      // `$addToSet` skips a MISSING field and keeps an explicit `null` — the
      // whole of #6814 lives in that second half.
      const set: unknown[] = [];
      for (const v of values) {
        if (v === MISSING) continue;
        if (!set.includes(v)) set.push(v);
      }
      return set;
    }
    case '$push':
      return values.filter((v) => v !== MISSING);
    default:
      throw new UnsupportedShape(`unsupported accumulator '${op}'`);
  }
}

/** Execute an emitted pipeline over the fixture. Throws on any shape not modelled. */
export function runPipeline(rows: readonly Doc[], pipeline: readonly Doc[]): Doc[] {
  let docs: Doc[] = rows.map((row) => ({ ...row }));

  for (const stage of pipeline) {
    const keys = Object.keys(stage);
    if (keys.length !== 1) throw new UnsupportedShape(`pipeline stage with ${keys.length} keys`);
    const [name] = keys;
    const spec = stage[name];

    switch (name) {
      case '$group': {
        const { _id: idSpec, ...accumulators } = spec as Doc;
        const groups = new Map<string, { id: unknown; rows: Doc[] }>();
        for (const doc of docs) {
          let id: unknown;
          if (idSpec === null) {
            id = null;
          } else if (idSpec && typeof idSpec === 'object' && !Array.isArray(idSpec)) {
            const key: Doc = {};
            for (const [outKey, ref] of Object.entries(idSpec as Doc)) {
              const value = evalExpr(doc, ref);
              key[outKey] = value === MISSING ? null : value;
            }
            id = key;
          } else {
            throw new UnsupportedShape(`$group._id must be null or a document, got ${JSON.stringify(idSpec)}`);
          }
          const bucket = JSON.stringify(id);
          if (!groups.has(bucket)) groups.set(bucket, { id, rows: [] });
          groups.get(bucket)!.rows.push(doc);
        }
        docs = [...groups.values()].map(({ id, rows: groupRows }) => {
          const out: Doc = { _id: id };
          for (const [alias, acc] of Object.entries(accumulators)) {
            out[alias] = accumulate(groupRows, acc);
          }
          return out;
        });
        break;
      }
      case '$project': {
        docs = docs.map((doc) => {
          const out: Doc = {};
          for (const [key, rule] of Object.entries(spec as Doc)) {
            if (rule === 0 || rule === false) continue;
            if (rule === 1 || rule === true) {
              const value = resolvePath(doc, `$${key}`);
              if (value !== MISSING) out[key] = value;
              continue;
            }
            if (typeof rule === 'string') {
              const value = resolvePath(doc, rule);
              if (value !== MISSING) out[key] = value;
              continue;
            }
            throw new UnsupportedShape(`unsupported $project rule for '${key}': ${JSON.stringify(rule)}`);
          }
          return out;
        });
        break;
      }
      case '$match':
        // Reachable only from `opts.where`, which no case in the shared set
        // spells. Refused rather than approximated: this file's `$match` would
        // be a second, weaker copy of the matcher
        // `mongodb-filter-logic-translation.test.ts` already owns.
        throw new UnsupportedShape('$match is not modelled here — see mongodb-filter-logic-translation.test.ts');
      case '$sort': {
        const entries = Object.entries(spec as Doc);
        docs = [...docs].sort((a, b) => {
          for (const [field, dir] of entries) {
            if (dir !== 1 && dir !== -1) throw new UnsupportedShape(`$sort direction ${String(dir)}`);
            const av = a[field];
            const bv = b[field];
            if (av === bv) continue;
            return ((av as never) < (bv as never) ? -1 : 1) * (dir as number);
          }
          return 0;
        });
        break;
      }
      case '$skip':
        docs = docs.slice(spec as number);
        break;
      case '$limit':
        docs = docs.slice(0, spec as number);
        break;
      default:
        throw new UnsupportedShape(`unsupported pipeline stage '${name}'`);
    }
  }

  return docs;
}

// ── Driving the shared case-set ─────────────────────────────────────────────

/** How a case's single `groupBy` column is spelled on the wire. */
type GroupBySpelling = 'bare' | 'structured';

function groupByFor(c: AggregationCase, spelling: GroupBySpelling): GroupByNode[] | undefined {
  if (!c.groupBy) return undefined;
  if (c.groupByAlias) return [{ field: c.groupBy, alias: c.groupByAlias }];
  return spelling === 'bare' ? [c.groupBy] : [{ field: c.groupBy }];
}

/** Run one case end to end and return its answers, ascending by group. */
function answer(c: AggregationCase, spelling: GroupBySpelling = 'bare'): Array<{ group: string | null; value: unknown }> {
  const aggregations: AggregationInput[] = [{ function: c.function, field: c.field, alias: MEASURE }];
  const pipeline = buildAggregationPipeline({ aggregations, groupBy: groupByFor(c, spelling) });
  const rows = postProcessAggregation(runPipeline(AGGREGATION_ROWS as unknown as Doc[], pipeline), aggregations);

  // The group value is read from `groupByAlias ?? groupBy` — the rule the
  // case-set states, and the one that makes the alias cases fail on a face that
  // ignores `alias` instead of passing on the numbers.
  const outKey = c.groupByAlias ?? c.groupBy;
  return rows
    .map((row) => ({
      group: outKey === undefined ? null : (row[outKey] as string | null),
      value: row[MEASURE],
    }))
    .sort((a, b) => String(a.group).localeCompare(String(b.group)));
}

describe('driver-mongodb — the aggregate vocabulary, without a server (#6850/#6814)', () => {
  for (const c of AGGREGATION_CASES) {
    it(c.name, () => {
      expect(answer(c), c.note ?? '').toEqual([...c.expected]);
    });
  }
});

describe('a PLAIN structured groupBy node answers exactly like the bare field name', () => {
  // The half of the union that no capability bit guards: `{ field: 'region' }`
  // with no granularity is pushed down to every driver (#6212's finding on the
  // Turso remote transport), so it has to mean what `'region'` means. Before
  // #6850 it meant `"[object Object]"` here.
  for (const c of AGGREGATION_CASES.filter((x) => x.groupBy && !x.groupByAlias)) {
    it(c.name, () => {
      expect(answer(c, 'structured')).toEqual([...c.expected]);
    });
  }
});

// ── The wire shapes the values cannot show ──────────────────────────────────

describe('the emitted pipeline', () => {
  const countAgg: AggregationInput[] = [{ function: 'count', alias: 'n' }];

  it('keys $group._id on the ALIAS and its value on the FIELD, and projects the alias', () => {
    expect(buildAggregationPipeline({ aggregations: countAgg, groupBy: [{ field: 'region', alias: 'bucket' }] }))
      .toEqual([
        { $group: { _id: { bucket: '$region' }, n: { $sum: 1 } } },
        { $project: { _id: 0, bucket: '$_id.bucket', n: 1 } },
      ]);
  });

  it('leaves the bare-string spelling exactly as it was', () => {
    expect(buildAggregationPipeline({ aggregations: countAgg, groupBy: ['region'] })).toEqual([
      { $group: { _id: { region: '$region' }, n: { $sum: 1 } } },
      { $project: { _id: 0, region: '$_id.region', n: 1 } },
    ]);
  });

  it('an alias equal to the field name is a no-op, not a second column', () => {
    expect(buildAggregationPipeline({ aggregations: countAgg, groupBy: [{ field: 'region', alias: 'region' }] }))
      .toEqual(buildAggregationPipeline({ aggregations: countAgg, groupBy: ['region'] }));
  });

  it('never emits "[object Object]" anywhere, for any spelling of the union', () => {
    const spellings: GroupByNode[][] = [
      ['region'],
      [{ field: 'region' }],
      [{ field: 'region', alias: 'bucket' }],
      ['region', { field: 'stage', alias: 'phase' }],
    ];
    for (const groupBy of spellings) {
      const emitted = JSON.stringify(buildAggregationPipeline({ aggregations: countAgg, groupBy }));
      expect(emitted, `groupBy: ${JSON.stringify(groupBy)}`).not.toContain('[object Object]');
    }
  });

  it('counts NON-NULL values for count(col) and rows for count(*)', () => {
    // The lowering, stated literally: the two spellings of `count` are different
    // expressions, which is what defect 3 above collapsed.
    expect(buildAggregationPipeline({ aggregations: [{ function: 'count', alias: 'n' }] })[0])
      .toEqual({ $group: { _id: null, n: { $sum: 1 } } });
    expect(buildAggregationPipeline({ aggregations: [{ function: 'count', field: 'stage', alias: 'n' }] })[0])
      .toEqual({
        $group: {
          _id: null,
          n: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$stage', null] }, null] }, 0, 1] } },
        },
      });
  });
});

// ── Refusals carry the ADR-0112 envelope ────────────────────────────────────

describe('a groupBy entry with no lowering is REFUSED, not ignored', () => {
  const aggregations: AggregationInput[] = [{ function: 'count', alias: 'n' }];

  it('a dateGranularity node answers NOT_IMPLEMENTED / 501', () => {
    let thrown: (Error & { code?: string; status?: number }) | undefined;
    try {
      buildAggregationPipeline({ aggregations, groupBy: [{ field: 'closed_at', dateGranularity: 'month' }] });
    } catch (err) {
      thrown = err as Error & { code?: string; status?: number };
    }
    expect(thrown, 'a granularity this backend cannot bucket must not be silently dropped').toBeDefined();
    expect(thrown!.code).toBe('NOT_IMPLEMENTED');
    expect(thrown!.status).toBe(501);
    expect(thrown!.message).toMatch(/Date bucketing by 'month' is not supported/);
    expect(thrown!.message).toMatch(/queryDateGranularity/);
  });

  it('refuses every declared granularity, so none is half-supported', () => {
    for (const g of ['day', 'week', 'month', 'quarter', 'year'] as const) {
      expect(() => buildAggregationPipeline({ aggregations, groupBy: [{ field: 'closed_at', dateGranularity: g }] }))
        .toThrow(new RegExp(`Date bucketing by '${g}'`));
    }
  });

  it('an entry that is neither half of the union answers INVALID_QUERY / 400', () => {
    for (const node of [{}, { field: '' }, 42, null] as unknown[]) {
      let thrown: (Error & { code?: string; status?: number }) | undefined;
      try {
        buildAggregationPipeline({ aggregations, groupBy: [node as GroupByNode] });
      } catch (err) {
        thrown = err as Error & { code?: string; status?: number };
      }
      expect(thrown, `groupBy entry ${JSON.stringify(node)} must be refused`).toBeDefined();
      expect(thrown!.code).toBe('INVALID_QUERY');
      expect(thrown!.status).toBe(400);
      expect(thrown!.message).toMatch(/GroupByNodeSchema/);
    }
  });

  it('refuses before a pipeline exists, so no stage is built from a half-read groupBy', () => {
    expect(() => buildAggregationPipeline({
      aggregations,
      groupBy: ['region', { field: 'closed_at', dateGranularity: 'year' }],
    })).toThrow(/Date bucketing/);
  });
});

// ── The evaluator is not the thing being tested, so it gets tested ──────────

describe('the in-process pipeline evaluator discriminates', () => {
  const rows = AGGREGATION_ROWS as unknown as Doc[];

  it('the pre-#6850 $group._id FAILS the alias case it broke', () => {
    // What `groupId[field] = '$' + field` emitted for `{ field: 'region',
    // alias: 'bucket' }`: the key is the stringified object and the value a
    // field path that matches nothing. This is the finding's own description,
    // executed — all six rows collapse into ONE group under a column literally
    // named `[object Object]`, holding null, and nothing is projected under
    // `bucket` at all. It does not throw; it answers.
    const broken = runPipeline(rows, [
      { $group: { _id: { '[object Object]': '$[object Object]' }, n: { $sum: 1 } } },
      { $project: { _id: 0, '[object Object]': '$_id.[object Object]', n: 1 } },
    ]);
    expect(broken).toEqual([{ '[object Object]': null, n: 6 }]);
    expect(broken.every((row) => row.bucket === undefined)).toBe(true);
    // The two group counts the alias case requires (east 2, west 4) are not
    // merely mis-keyed here — they do not exist.
    expect(broken).toHaveLength(1);
  });

  it('the pre-#6814 count_distinct sizing FAILS the null case it broke', () => {
    const set = runPipeline(rows, [{ $group: { _id: null, n: { $addToSet: '$stage' } } }])[0].n as unknown[];
    // The evaluator keeps the explicit null, which is what MongoDB does — so
    // the old `.length` answered 3 and the standard says 2.
    expect(set).toContain(null);
    expect(set.length).toBe(3);
    expect(set.filter((v) => v != null).length).toBe(2);
  });

  it('the pre-#6814 count(col) lowering FAILS the case it broke', () => {
    // `{ $sum: 1 }` regardless of `field`: the row count, not the value count.
    expect(runPipeline(rows, [{ $group: { _id: null, n: { $sum: 1 } } }])[0].n).toBe(6);
    expect(answer(AGGREGATION_CASES.find((c) => c.name.startsWith('count(stage) counts'))!)).toEqual([
      { group: null, value: 4 },
    ]);
  });

  it('computes per GROUP rather than over the whole fixture', () => {
    const grouped = runPipeline(rows, [
      { $group: { _id: { region: '$region' }, n: { $sum: '$score' } } },
      { $project: { _id: 0, region: '$_id.region', n: 1 } },
    ]);
    expect(grouped).toEqual([{ region: 'west', n: 100 }, { region: 'east', n: 110 }]);
  });

  it('refuses any stage, accumulator or expression it does not model', () => {
    expect(() => runPipeline(rows, [{ $lookup: {} }])).toThrow(/unsupported pipeline stage/);
    expect(() => runPipeline(rows, [{ $group: { _id: null, n: { $stdDevPop: '$score' } } }]))
      .toThrow(/unsupported accumulator/);
    expect(() => runPipeline(rows, [{ $group: { _id: null, n: { $sum: { $abs: '$score' } } } }]))
      .toThrow(/unsupported aggregation expression operator/);
    expect(() => runPipeline(rows, [{ $group: { _id: '$region', n: { $sum: 1 } } }]))
      .toThrow(/\$group\._id must be null or a document/);
    expect(() => runPipeline(rows, [{ $match: { region: 'west' } }])).toThrow(/\$match is not modelled/);
  });

  it('distinguishes a MISSING field from an explicit null, like MongoDB does', () => {
    const sparse: Doc[] = [{ id: '1', stage: null }, { id: '2' }, { id: '3', stage: 'won' }];
    const set = runPipeline(sparse, [{ $group: { _id: null, n: { $addToSet: '$stage' } } }])[0].n as unknown[];
    expect(set).toEqual([null, 'won']);
    // …and the `count` lowering counts neither of them.
    const counted = runPipeline(sparse, [{
      $group: { _id: null, n: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$stage', null] }, null] }, 0, 1] } } },
    }])[0].n;
    expect(counted).toBe(1);
  });
});
