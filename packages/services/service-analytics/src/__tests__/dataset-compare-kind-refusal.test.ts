// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An unrecognised `compareTo.kind` is REFUSED, not answered with a
 * previous-period window under a 200.
 *
 * ## What was wrong
 *
 * `shiftRange` had one branch and a fall-through: `previousYear` was named, and
 * EVERYTHING else — including a value the declared type says is impossible —
 * landed in the `previousPeriod` arm. There was no `default` and no
 * exhaustiveness check, so `compareTo: { kind: 'previousQuarter' }` came back as
 * a previous-period comparison under an ordinary **200**. Nothing in the
 * response distinguished it from a real answer, and the wrong answer is a
 * comparison WINDOW — a number a dashboard renders and a person reads as fact.
 *
 * ## Why the declared type did not save it
 *
 * `DatasetCompareTo.kind` is declared as the closed pair
 * `'previousPeriod' | 'previousYear'` (`spec/contracts/analytics-service.ts`),
 * but `DatasetSelection` is a TypeScript interface with **no Zod schema anywhere
 * in the repo**, and `/analytics/dataset/query`'s door parses only the seven
 * members `DatasetSelection` shares with `AnalyticsQuery` — `compareTo` is one of
 * the four it projects away before the parse, and the route forwards the
 * caller's selection to the service untouched. So `kind` is checked by `tsc`
 * inside this repo and by nothing at all on the wire. The dashboard AUTHORING
 * path is doored (`dashboard.zod.ts` parses the widget's `kind` as a
 * `z.enum`), which is why both halves are pinned here: the compile-time one that
 * already held, and the runtime one that did not.
 *
 * ## What is pinned
 *
 *  - the refusal itself, in the ADR-0112 envelope the route classifies on
 *    (`DATASET_INVALID` / 400) — the fourth member of `resolveCompareDimension`'s
 *    family, not a new error vocabulary;
 *  - its message discipline: what was received, the two legal values, what to do;
 *  - the CONTROL that the refusal did not widen — both declared kinds return
 *    exactly the windows they returned before;
 *  - that the refusal reaches the executor seam, and reaches it BEFORE the
 *    comparison pass is issued;
 *  - ⭐ the surface asymmetry that makes ONE refusal site sufficient:
 *    `alignedCompareBucketKey` branches on the same two-valued `kind` with the
 *    same shape, and needs no refusal of its own because it is not on the
 *    package's public surface and its only caller runs `shiftRange` first. That
 *    is a claim about `src/index.ts`, so it is pinned against `src/index.ts`
 *    rather than asserted in prose — export that function and this file goes red.
 *
 * Every runtime assertion here was run RED first against the pre-fix
 * `shiftRange` (the fall-through returned a window, so each refusal case came
 * back as a successful previous-period answer).
 */

import { describe, it, expect, vi } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { AnalyticsQuery, AnalyticsResult, IAnalyticsService } from '@objectstack/spec/contracts';
import { compileDataset } from '../dataset-compiler.js';
import { DatasetExecutor, shiftRange } from '../dataset-executor.js';

/** The ADR-0112 fields `rest-server.ts`'s catch classifies a thrown error on. */
interface Refusal extends Error {
  code?: unknown;
  status?: unknown;
}

/** Run `thunk` and hand back the error it threw, if any. */
async function refusalFrom(thunk: () => unknown | Promise<unknown>): Promise<Refusal | undefined> {
  try {
    await thunk();
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
}

const WINDOW: [string, string] = ['2026-01-01', '2026-01-31'];

/** The window `previousPeriod` made of {@link WINDOW} before this change, and still does. */
const PREVIOUS_PERIOD: [string, string] = ['2025-12-01', '2025-12-31'];
/** And what `previousYear` made of it. */
const PREVIOUS_YEAR: [string, string] = ['2025-01-01', '2025-01-31'];

/**
 * Three spellings an unparsed wire body can carry in `kind`: a plausible fourth
 * window name, the retired string form, and a non-string. The declared type
 * permits none of them; nothing on the wire stops any of them.
 */
const UNRECOGNISED: unknown[] = ['previousQuarter', 'previous_period', 7];

/** Calls the published export the way an unparsed body reaches it. */
const shiftWith = (kind: unknown) => shiftRange(WINDOW, kind as never);

/**
 * A trend dataset: `close_date` is a GRID dimension AND bucketed, which is the
 * #6007 shape — the only shape that reaches `alignedCompareBucketKey` at all.
 */
const dataset = DatasetSchema.parse({
  name: 'sales_trend',
  label: 'Sales Trend',
  object: 'opportunity',
  dimensions: [
    { name: 'close_date', field: 'close_date', type: 'date', label: 'Close Date', dateGranularity: 'month' },
  ],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount', label: 'Revenue' }],
});

/** An analytics service that records every query the executor issues. */
function recordingService(): { svc: IAnalyticsService; seen: AnalyticsQuery[] } {
  const seen: AnalyticsQuery[] = [];
  const svc: IAnalyticsService = {
    query: vi.fn(async (q: AnalyticsQuery): Promise<AnalyticsResult> => {
      seen.push(q);
      return { rows: [{ close_date: '2026-01', revenue: 100 }], fields: [] };
    }),
    getMeta: async () => [],
  };
  return { svc, seen };
}

/** The trend selection, with whatever `kind` the case is about. */
const selectionWith = (kind: unknown) => ({
  dimensions: ['close_date'],
  measures: ['revenue'],
  timeDimensions: [{ dimension: 'close_date', dateRange: WINDOW, granularity: 'month' }],
  compareTo: { kind },
});

/** Did the executor ask the service for the SHIFTED window? */
const sawShiftedPass = (seen: AnalyticsQuery[]) =>
  seen.some((q) => JSON.stringify(q.timeDimensions ?? []).includes('2025-12'));

// ─────────────────────────────────────────────────────────────────────────────

describe('shiftRange refuses an unrecognised compareTo.kind', () => {
  for (const kind of UNRECOGNISED) {
    it(`${JSON.stringify(kind)} → DATASET_INVALID / 400, the envelope the route reads`, async () => {
      const err = await refusalFrom(() => shiftWith(kind));
      expect(err, 'an unrecognised kind was ANSWERED — the fall-through is back').toBeInstanceOf(Error);
      // Read exactly as `rest-server.ts`'s catch reads them: code + 4xx status.
      expect(err?.code).toBe('DATASET_INVALID');
      expect(err?.status).toBe(400);
    });
  }

  it('says what it received, what the two legal windows are, and what to do', async () => {
    const err = await refusalFrom(() => shiftWith('previousQuarter'));
    const msg = String(err?.message);
    // ① what arrived — so the caller can find it in the body they sent.
    expect(msg).toContain('"previousQuarter"');
    // ② the whole legal set, both members, spelled as an author would write them.
    expect(msg).toContain("'previousPeriod'");
    expect(msg).toContain("'previousYear'");
    // ③ the fix, and the fact that it IS this key's value that is wrong.
    expect(msg).toContain('compareTo.kind');
    expect(msg).toContain('drop compareTo');
  });

  it('CONTROL — both declared kinds still return the windows they always did', () => {
    expect(shiftRange(WINDOW, 'previousPeriod')).toEqual(PREVIOUS_PERIOD);
    expect(shiftRange(WINDOW, 'previousYear')).toEqual(PREVIOUS_YEAR);
    // A window whose length is not a month, so the previousPeriod arithmetic is
    // exercised rather than only the month-aligned happy case.
    expect(shiftRange(['2026-03-10', '2026-03-12'], 'previousPeriod')).toEqual(['2026-03-07', '2026-03-09']);
  });

  it('and `tsc` still owns the compile-time half', () => {
    // @ts-expect-error — 'previousQuarter' is not a `DatasetCompareTo['kind']`.
    // This assertion is about the EXPECTED ERROR, not the throw: the runtime
    // refusal above exists for the wire, where no schema parses `kind` at all.
    expect(() => shiftRange(WINDOW, 'previousQuarter')).toThrow();
  });
});

describe('the refusal reaches the executor seam, BEFORE the comparison pass', () => {
  it('DatasetExecutor.execute() refuses the selection in the same envelope', async () => {
    const { svc } = recordingService();
    const err = await refusalFrom(() =>
      new DatasetExecutor(svc).execute(compileDataset(dataset), selectionWith('previousQuarter') as never),
    );
    expect(err).toBeInstanceOf(Error);
    expect(err?.code).toBe('DATASET_INVALID');
    expect(err?.status).toBe(400);
  });

  it('the SHIFTED pass is never issued — so the second `kind` reader is never reached', async () => {
    const { svc, seen } = recordingService();
    await refusalFrom(() =>
      new DatasetExecutor(svc).execute(compileDataset(dataset), selectionWith('previousQuarter') as never),
    );
    // `runCompare` reads `kind` twice: into `shiftRange`, and (for this exact
    // grid-and-bucketed shape) into `alignedCompareBucketKey` over the shifted
    // pass's ROWS. The shift is what produces the second call's own argument, so
    // refusing in `shiftRange` means no shifted query, no shifted rows, and
    // nothing for the second reader to mis-align.
    expect(sawShiftedPass(seen), 'the comparison window was queried despite the refusal').toBe(false);
  });

  it('CONTROL — the same selection with a legal kind DOES issue the shifted pass', async () => {
    const { svc, seen } = recordingService();
    const res = await new DatasetExecutor(svc).execute(
      compileDataset(dataset),
      selectionWith('previousPeriod') as never,
    );
    expect(sawShiftedPass(seen), 'the control never reached the comparison pass either').toBe(true);
    expect(res.rows.length).toBeGreaterThan(0);
  });
});

describe('one refusal site is enough — the surface asymmetry that makes it so', () => {
  /**
   * `shiftRange` owes a refusal because an external caller can reach it without
   * passing through `runCompare`. `alignedCompareBucketKey` does not, because no
   * external caller can reach it at all: the barrel names its exports one by one
   * (no `export *`) and the manifest maps only `.`, so the function's sole caller
   * is `runCompare`, which runs `shiftRange` first.
   *
   * ⚠️ Adding it to the barrel makes that reasoning false. This case is what
   * turns that into a red test instead of a silent reopening of the defect.
   */
  it('publishes shiftRange and NOT alignedCompareBucketKey', async () => {
    const barrel = await import('../index.js');
    const published = Object.keys(barrel);
    // The firing control: the same probe, on the export that IS published.
    expect(published, 'the barrel probe itself is broken').toContain('shiftRange');
    expect(
      published,
      'alignedCompareBucketKey is now published — it needs its own `kind` verdict, see its docblock',
    ).not.toContain('alignedCompareBucketKey');
  });
});
