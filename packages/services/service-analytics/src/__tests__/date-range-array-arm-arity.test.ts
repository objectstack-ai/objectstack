// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17124] Every face in this package that reads `dateRange`'s ARRAY arm gives
 * an odd-sized array ONE answer — the ADR-0112 refusal — and gives a
 * two-element window exactly the answer it gave before.
 *
 * ## What was wrong
 *
 * MEASURED on `abc4b83ce` before this change, `['2026-01-01']` over four rows
 * (2020, 2026-01-01, 2026-06, 2099):
 *
 * | face | answer |
 * |---|---|
 * | `ObjectQLStrategy.dateRangeBounds` | `{$gte: '2026-01-01', $lte: '2026-01-01'}` — the point |
 * | `NativeSQLStrategy` | NO time clause emitted at all — the whole dataset |
 * | `evaluateAnalyticsQueryOverRows` | selected 2026-01-01, 2026-06 AND 2099 — unbounded above |
 * | `DatasetExecutor.runCompare` | primary pass kept the one-element array, compare pass got the point `['2025-12-31','2025-12-31']` |
 *
 * ⇒ one authored document, three readings, and on a dashboard the difference
 * between one day's number and the whole dataset's. `[]` and `[a, b, c]` split
 * the same three ways, and `[null, null]` reached `parseUTC(null)` as a bare
 * `TypeError` — a 500 for a malformed request.
 *
 * ## What is pinned
 *
 *  - the refusal on ALL FOUR faces, on the ENVELOPE (`code` + `status`) the
 *    route classifies on — ⛔ not on `toThrow()`, which an unfixed face
 *    throwing a bare `Error` would satisfy, and which `[null, null]`'s
 *    `TypeError` did satisfy;
 *  - ONE envelope across the four, because one condition gets one envelope;
 *  - the message discipline: what arrived, the two-element contract, the
 *    single-day spelling to write instead;
 *  - ⭐ the CONTROL that the refusal did not widen — the two-element window
 *    answers byte-for-byte as it did before on each face, including the #3777
 *    half-open bare-day widening on the SQL side and the inclusive upper
 *    reading (#16179) on the others. Without it a green here would be
 *    satisfiable by a face that refused everything.
 *
 * ⚠️ The arity rule is this PACKAGE's, asserted here, because the shared
 * cross-package kit (`analyticsDateRangeConformanceFindings`) has no arity case
 * — its only array case is a two-element window. ⇒ A face in another package
 * can still grow a fourth reading; that is reported, not fixed here.
 */

import { describe, it, expect, vi } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { Cube } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { AnalyticsQuery, AnalyticsResult, IAnalyticsService } from '@objectstack/spec/contracts';
import { AnalyticsService } from '../analytics-service.js';
import { evaluateAnalyticsQueryOverRows } from '../preview-evaluator.js';
import { compileDataset } from '../dataset-compiler.js';
import { DatasetExecutor } from '../dataset-executor.js';

/** The ADR-0112 fields `rest-server.ts`'s catch classifies a thrown error on. */
interface Refusal extends Error {
  code?: unknown;
  status?: unknown;
}

const CTX = { tenantId: 'org_A' } as ExecutionContext;

/**
 * Every array shape that is not a two-bound window, each a shape an author or a
 * generator really writes — ⛔ not fuzz.
 */
const NOT_A_WINDOW: ReadonlyArray<readonly [string, readonly unknown[]]> = [
  ['one element — the card\'s shape', ['2026-01-01']],
  ['empty', []],
  ['three elements', ['2026-01-01', '2026-01-31', '2026-02-01']],
  ['two null bounds', [null, null]],
];

/** The window an author writes when they mean that single day — all faces agree on it. */
const ONE_DAY: readonly string[] = ['2026-01-01', '2026-01-01'];

const DATASET = DatasetSchema.parse({
  name: 'events', label: 'Events', object: 'events', include: [],
  dimensions: [
    { name: 'created_at', field: 'created_at', type: 'date' },
    { name: 'probe', field: 'probe', type: 'string' },
  ],
  measures: [{ name: 'count', aggregate: 'count' }],
});

// ── face 1: the ObjectQL aggregate strategy ──────────────────────────────────

/** The emitted ObjectQL filter for `created_at`, or `undefined` if none was emitted. */
async function objectqlBounds(range: readonly unknown[]): Promise<unknown> {
  const calls: Array<Record<string, unknown>> = [];
  const svc = new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (_o: string, opts: unknown) => { calls.push(opts as Record<string, unknown>); return []; },
  });
  await svc.queryDataset(DATASET, {
    dimensions: ['created_at'], measures: ['count'],
    timeDimensions: [{ dimension: 'created_at', dateRange: range }],
  } as never, CTX);
  return (calls[0]?.filter as Record<string, unknown> | undefined)?.created_at;
}

// ── face 2: the native-SQL strategy ──────────────────────────────────────────

/** The bound statement's WHERE clause and parameters. */
async function nativeSql(range: readonly unknown[]): Promise<{ where: string; params: string[] }> {
  const stmts: string[] = []; const bound: unknown[][] = [];
  const svc = new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async (_o: string, sql: string, params: unknown[]) => { stmts.push(sql); bound.push(params); return []; },
  });
  await svc.queryDataset(DATASET, {
    dimensions: ['probe'], measures: ['count'],
    timeDimensions: [{ dimension: 'created_at', dateRange: range }],
  } as never, CTX);
  return {
    where: /WHERE (.*?)(?: GROUP BY| ORDER BY| LIMIT|$)/s.exec(stmts[0] ?? '')?.[1]?.trim() ?? '',
    params: (bound[0] ?? []).map(String),
  };
}

// ── face 3: the draft-preview evaluator ──────────────────────────────────────

const PREVIEW_CUBE = {
  name: 'events', sql: 'events',
  dimensions: {
    id: { name: 'id', type: 'string', sql: 'id' },
    created_at: { name: 'created_at', type: 'time', sql: 'created_at' },
  },
  measures: { count: { name: 'count', type: 'count', sql: '*' } },
} as unknown as Cube;

/**
 * Rows spanning far outside the window on BOTH sides, so "unbounded above" and
 * "window dropped" are distinguishable from "one day" rather than all reading
 * as the same row set.
 */
const ROWS = [
  { id: 'a_2020', created_at: '2020-01-01T00:00:00.000Z' },
  { id: 'b_target', created_at: '2026-01-01T12:00:00.000Z' },
  { id: 'c_2026_06', created_at: '2026-06-15T00:00:00.000Z' },
  { id: 'd_2099', created_at: '2099-12-31T00:00:00.000Z' },
];

/** Which row ids the preview face keeps — the END-TO-END reading, not the lowering's report. */
function previewSelects(range: readonly unknown[]): string[] {
  const result = evaluateAnalyticsQueryOverRows({
    measures: ['count'], dimensions: ['id'],
    timeDimensions: [{ dimension: 'created_at', dateRange: range }],
  } as never, PREVIEW_CUBE, ROWS.map((r) => ({ ...r })));
  return result.rows.map((r) => String(r.id)).sort();
}

// ── face 4: the dataset executor's compareTo window ──────────────────────────

const CMP_DATASET = DatasetSchema.parse({
  name: 'trend', label: 'Trend', object: 'events', include: [],
  dimensions: [{ name: 'created_at', field: 'created_at', type: 'date', dateGranularity: 'month' }],
  measures: [{ name: 'count', aggregate: 'count' }],
});

/** The `dateRange` of every pass the executor issues — the primary one and the shifted one. */
async function compareWindows(range: readonly unknown[]): Promise<unknown[]> {
  const seen: AnalyticsQuery[] = [];
  const svc: IAnalyticsService = {
    query: vi.fn(async (q: AnalyticsQuery): Promise<AnalyticsResult> => { seen.push(q); return { rows: [], fields: [] }; }),
    getMeta: async () => [],
  };
  await new DatasetExecutor(svc).execute(compileDataset(CMP_DATASET), {
    dimensions: ['created_at'], measures: ['count'],
    timeDimensions: [{ dimension: 'created_at', dateRange: range, granularity: 'month' }],
    compareTo: { kind: 'previousPeriod' },
  } as never, CTX);
  return seen.map((q) => (q.timeDimensions ?? []).map((t) => (t as { dateRange?: unknown }).dateRange));
}

/** The four faces, each reduced to "drive me with this dateRange". */
const FACES: ReadonlyArray<readonly [string, (r: readonly unknown[]) => Promise<unknown>]> = [
  ['ObjectQLStrategy.dateRangeBounds', objectqlBounds],
  ['NativeSQLStrategy', nativeSql],
  ['draft-preview evaluator', async (r) => previewSelects(r)],
  ['DatasetExecutor.runCompare', compareWindows],
];

/** Run `thunk` and hand back the error it threw, if any. */
async function refusalFrom(thunk: () => unknown | Promise<unknown>): Promise<Refusal | undefined> {
  try {
    await thunk();
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('#17124 — an array arm that is not a two-bound window is REFUSED on every face', () => {
  for (const [faceName, drive] of FACES) {
    for (const [shapeName, range] of NOT_A_WINDOW) {
      it(`${faceName} refuses ${shapeName}`, async () => {
        const err = await refusalFrom(() => drive(range));
        expect(err, `${faceName} ANSWERED ${JSON.stringify(range)} — a face grew its own reading again`)
          .toBeInstanceOf(Error);
        // Read exactly as `rest-server.ts`'s catch reads them: code + 4xx status.
        // ⛔ Not `toThrow()`: `[null, null]` used to throw a bare TypeError here.
        expect(err?.code).toBe('ANALYTICS_DATE_RANGE_UNRECOGNIZED');
        expect(err?.status).toBe(400);
      });
    }
  }

  it('the four faces raise ONE envelope, not four — one condition, one answer', async () => {
    const envelopes = new Set<string>();
    for (const [, drive] of FACES) {
      for (const [, range] of NOT_A_WINDOW) {
        const err = await refusalFrom(() => drive(range));
        envelopes.add(JSON.stringify({ code: err?.code, status: err?.status }));
      }
    }
    expect(envelopes.size, `raised ${envelopes.size} envelopes: ${[...envelopes].join(' | ')}`).toBe(1);
  });

  it('says what arrived, the two-element contract, and the single-day spelling to write', async () => {
    const msg = String((await refusalFrom(() => objectqlBounds(['2026-01-01'])))?.message);
    // ① what arrived — so the author can find it in the document they wrote.
    expect(msg).toContain('["2026-01-01"]');
    expect(msg).toContain('1-element array');
    // ② the contract, in the spec's own words.
    expect(msg).toContain('TWO-element array [start, end]');
    // ③ what to do instead — the spelling every face already agrees on.
    expect(msg).toContain('["2026-01-01", "2026-01-01"]');
  });
});

describe('#17124 CONTROL — a two-element window answers exactly as it did before', () => {
  // ⭐ Without these four, every assertion above is satisfied by a face that
  // refuses EVERY array, which is the opposite defect and just as silent.
  it('ObjectQLStrategy keeps the inclusive bounds the caller wrote (#16179)', async () => {
    expect(await objectqlBounds(ONE_DAY)).toEqual({ $gte: '2026-01-01', $lte: '2026-01-01' });
  });

  it('NativeSQLStrategy keeps the half-open bare-day widening (#3777)', async () => {
    const { where, params } = await nativeSql(ONE_DAY);
    expect(where).toBe('(created_at >= $1 AND created_at < $2)');
    expect(params).toEqual(['2026-01-01', '2026-01-02']);
  });

  it('the draft-preview evaluator selects exactly that day', async () => {
    expect(previewSelects(ONE_DAY)).toEqual(['b_target']);
  });

  it('DatasetExecutor still shifts the window it was given', async () => {
    expect(await compareWindows(ONE_DAY)).toEqual([
      [['2026-01-01', '2026-01-01']],
      [['2025-12-31', '2025-12-31']],
    ]);
  });
});
