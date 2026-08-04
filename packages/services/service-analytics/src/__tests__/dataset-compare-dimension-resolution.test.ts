// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5011 — `DatasetCompareTo.dimension` is optional, resolved BY THE EXECUTOR.
 *
 * ## Why the rule lives here and not in a renderer
 *
 * The widget's `compareTo` used to be a different vocabulary from the one this
 * executor implements, and the ADR-0021 renderer papered over the gap by
 * dropping what it could not forward. The convergence removed the widget's
 * second vocabulary; making `dimension` optional is what stops the convergence
 * from being a downgrade — an author with one obvious date column should not
 * have to name it. But "resolve the obvious one" is a rule, and a rule
 * implemented in each consumer is N rules. So it lives at the producer of the
 * comparison: every caller — dashboard widget, report, raw `queryDataset` —
 * gets the same dimension or the same error, and no renderer is ever in a
 * position to guess (PD #12).
 *
 * ## What is pinned
 *
 * The three branches, and the two properties that make the rule safe:
 *
 *   - **exactly one dated candidate** → it is used, and the SHIFT lands on it;
 *   - **zero** → a loud error saying a comparison needs a bounded window;
 *   - **several** → a loud error LISTING them, never a silent first-wins. This
 *     is the branch that matters most: picking `created_at` when the author
 *     meant `close_date` yields a comparison column that is WRONG rather than
 *     missing, which is the failure nobody audits.
 *   - the candidate set is the executor's own criterion (`dateRange` present),
 *     so a resolution can never pick something `shiftRange` then fails on;
 *   - an explicitly named dimension is still validated, and its error now names
 *     what IS dated instead of printing `"undefined"`.
 *
 * Every assertion here was run RED first against the pre-#5011 executor.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IAnalyticsService, AnalyticsQuery, AnalyticsResult } from '@objectstack/spec/contracts';
import { DatasetSchema } from '@objectstack/spec/ui';
import { compileDataset } from '../dataset-compiler.js';
import { DatasetExecutor } from '../dataset-executor.js';

const dataset = DatasetSchema.parse({
  name: 'sales',
  label: 'Sales',
  object: 'opportunity',
  filter: { is_deleted: { $ne: true } },
  dimensions: [
    { name: 'region', field: 'region', type: 'string' },
    { name: 'close_date', field: 'close_date', type: 'date' },
    { name: 'created_at', field: 'created_at', type: 'date' },
  ],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
});

function fakeService(handler: (q: AnalyticsQuery) => AnalyticsResult): IAnalyticsService {
  return { query: vi.fn(async (q: AnalyticsQuery) => handler(q)), getMeta: async () => [] };
}

/** Runs a selection and hands back every query the executor issued. */
async function run(selection: Record<string, unknown>) {
  const seen: AnalyticsQuery[] = [];
  const svc = fakeService((q) => {
    seen.push(q);
    return { rows: [{ region: 'NA', revenue: 100 }], fields: [] };
  });
  const res = await new DatasetExecutor(svc).execute(compileDataset(dataset), selection as never);
  return { seen, res };
}

const WINDOW = ['2026-01-01', '2026-01-31'] as [string, string];
const SHIFTED = ['2025-12-01', '2025-12-31'];

describe('#5011 — compareTo.dimension resolution (exactly one dated candidate)', () => {
  it('resolves the single dated time dimension when `dimension` is omitted', async () => {
    const { seen } = await run({
      dimensions: ['region'],
      measures: ['revenue'],
      timeDimensions: [{ dimension: 'close_date', dateRange: WINDOW }],
      compareTo: { kind: 'previousPeriod' },
    });
    // The comparison pass must exist AND have shifted the right dimension.
    const shifted = seen.find((q) => JSON.stringify(q.timeDimensions).includes('2025-12'));
    expect(shifted, 'the comparison pass must have run').toBeDefined();
    expect(shifted!.timeDimensions![0]!.dimension).toBe('close_date');
    expect(shifted!.timeDimensions![0]!.dateRange).toEqual(SHIFTED);
  });

  it('attaches the comparison column, so the resolution reaches the RESULT', async () => {
    const svc = fakeService((q) => {
      const isShifted = JSON.stringify(q.timeDimensions).includes('2025-12');
      return { rows: [{ region: 'NA', revenue: isShifted ? 80 : 100 }], fields: [] };
    });
    const res = await new DatasetExecutor(svc).execute(compileDataset(dataset), {
      dimensions: ['region'],
      measures: ['revenue'],
      timeDimensions: [{ dimension: 'close_date', dateRange: WINDOW }],
      compareTo: { kind: 'previousPeriod' },
    } as never);
    expect(res.rows[0]).toMatchObject({ region: 'NA', revenue: 100, revenue__compare: 80 });
  });

  /**
   * The candidate set is `dateRange`-bearing entries, not "every time
   * dimension". A second time dimension with no window is not a candidate,
   * because there is nothing to shift on it — so this selection is
   * unambiguous even though it declares two `timeDimensions`.
   */
  it('ignores a time dimension that carries no dateRange — nothing to shift is not a candidate', async () => {
    const { seen } = await run({
      dimensions: ['region'],
      measures: ['revenue'],
      timeDimensions: [
        { dimension: 'created_at', granularity: 'month' },
        { dimension: 'close_date', dateRange: WINDOW },
      ],
      compareTo: { kind: 'previousYear' },
    });
    const shifted = seen.find((q) => JSON.stringify(q.timeDimensions).includes('2025-01'));
    expect(shifted, 'the comparison pass must have run on the DATED dimension').toBeDefined();
    const entry = shifted!.timeDimensions!.find((t) => t.dimension === 'close_date')!;
    expect(entry.dateRange).toEqual(['2025-01-01', '2025-01-31']);
  });
});

describe('#5011 — an unresolvable dimension is LOUD, never guessed', () => {
  const expectRejection = async (selection: Record<string, unknown>) => {
    const svc = fakeService(() => ({ rows: [], fields: [] }));
    return new DatasetExecutor(svc)
      .execute(compileDataset(dataset), selection as never)
      .then(
        () => { throw new Error('expected the executor to REJECT this selection'); },
        (e: Error) => e.message,
      );
  };

  it('several dated candidates → names every one of them and refuses to pick', async () => {
    const msg = await expectRejection({
      dimensions: ['region'],
      measures: ['revenue'],
      timeDimensions: [
        { dimension: 'close_date', dateRange: WINDOW },
        { dimension: 'created_at', dateRange: WINDOW },
      ],
      compareTo: { kind: 'previousPeriod' },
    });
    expect(msg).toContain('ambiguous');
    // Both candidates by name — the fix must be copy-pasteable, not a hunt.
    expect(msg).toContain('"close_date"');
    expect(msg).toContain('"created_at"');
    // And it must show the shape to write, with the kind the caller asked for.
    expect(msg).toContain("kind: 'previousPeriod'");
    expect(msg).toContain('dimension:');
  });

  it('zero dated candidates → says a comparison needs a bounded window', async () => {
    const msg = await expectRejection({
      dimensions: ['region'],
      measures: ['revenue'],
      compareTo: { kind: 'previousPeriod' },
    });
    expect(msg).toContain('dateRange');
    expect(msg).toContain('or drop compareTo');
    expect(msg).toContain('only defined against a bounded window');
  });

  it('a NAMED dimension that is not dated still fails — and now says what IS', async () => {
    // The pre-#5011 message printed `"undefined"` here, because the widget path
    // never supplied a dimension at all. Naming the real candidates is the
    // difference between a bug report and a fix.
    const msg = await expectRejection({
      dimensions: ['region'],
      measures: ['revenue'],
      timeDimensions: [{ dimension: 'close_date', dateRange: WINDOW }],
      compareTo: { kind: 'previousYear', dimension: 'created_at' },
    });
    expect(msg).toContain('"created_at"');
    expect(msg).toContain('"close_date"');
    expect(msg, 'the "undefined" message is the #5011 symptom itself').not.toContain('"undefined"');
  });

  it('a NAMED dimension with nothing dated at all gets the other half of the advice', async () => {
    const msg = await expectRejection({
      dimensions: ['region'],
      measures: ['revenue'],
      compareTo: { kind: 'previousYear', dimension: 'close_date' },
    });
    expect(msg).toContain('"close_date"');
    expect(msg).toContain('no timeDimension with a dateRange');
  });

  /**
   * Control: none of the above is satisfied by an executor that simply throws.
   * The same selections MINUS `compareTo` must all succeed.
   */
  it('control — every one of those selections runs fine without compareTo', async () => {
    for (const timeDimensions of [
      undefined,
      [{ dimension: 'close_date', dateRange: WINDOW }],
      [{ dimension: 'close_date', dateRange: WINDOW }, { dimension: 'created_at', dateRange: WINDOW }],
    ]) {
      const { res } = await run({
        dimensions: ['region'],
        measures: ['revenue'],
        ...(timeDimensions ? { timeDimensions } : {}),
      });
      expect(res.rows).toHaveLength(1);
    }
  });
});

/**
 * The widget projection, end to end: what `DashboardWidgetSchema` now accepts is
 * exactly what this executor consumes, with no mapping step in between. If the
 * two shapes ever drift again, this is where it shows up as a runtime failure
 * rather than as a renderer quietly dropping something.
 */
describe('#5011 — a widget-authored compareTo runs verbatim', () => {
  it('forwards `{ kind }` and `{ kind, dimension }` with no translation', async () => {
    for (const compareTo of [
      { kind: 'previousPeriod' as const },
      { kind: 'previousYear' as const, dimension: 'close_date' },
    ]) {
      const { seen } = await run({
        dimensions: ['region'],
        measures: ['revenue'],
        timeDimensions: [{ dimension: 'close_date', dateRange: WINDOW }],
        compareTo,
      });
      // Two passes: the current window and the shifted one.
      expect(seen.length).toBeGreaterThanOrEqual(2);
    }
  });
});
