// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  ReportSchema,
  ReportChartSchema,
  ReportSortSchema,
  ReportType,
  Report,
  JoinedReportBlockSchema,
  reportSelectionOrder,
} from './report.zod';
import { strictObjectDeclarations } from '../shared/strict-object';

/**
 * ADR-0021 single-form: a report binds a `dataset` and selects `rows`
 * (dimensions) + `values` (measures). The legacy inline `objectName` +
 * `columns` + `groupings` query was removed in the cutover. A `joined` report
 * carries its data on `blocks`, each itself dataset-bound.
 */
describe('ReportSchema (dataset-bound)', () => {
  it('accepts a summary report (dataset + rows + values)', () => {
    const r = ReportSchema.parse({
      name: 'sales_by_stage', label: 'Sales by Stage', type: 'summary',
      dataset: 'sales', rows: ['stage'], values: ['revenue'],
    });
    expect(r.dataset).toBe('sales');
    expect(r.rows).toEqual(['stage']);
  });

  it('accepts a matrix report (rows down × columns across) + runtimeFilter', () => {
    const r = ReportSchema.parse({
      name: 'hours_matrix', label: 'Hours', type: 'matrix',
      dataset: 'tasks', rows: ['owner'], columns: ['category'], values: ['est_hours', 'actual_hours'],
      runtimeFilter: { is_completed: true },
    });
    expect(r.rows).toEqual(['owner']);
    expect(r.columns).toEqual(['category']);
    expect(r.runtimeFilter).toEqual({ is_completed: true });
  });

  it('drilldown defaults on and can be disabled', () => {
    const on = ReportSchema.parse({ name: 'r1', label: 'R', type: 'summary', dataset: 'sales', rows: ['stage'], values: ['revenue'] });
    expect(on.drilldown).toBe(true);
    const off = ReportSchema.parse({ name: 'r2', label: 'R', type: 'summary', dataset: 'sales', rows: ['stage'], values: ['revenue'], drilldown: false });
    expect(off.drilldown).toBe(false);
  });

  it('accepts an embedded chart', () => {
    const r = ReportSchema.parse({
      name: 'rep_x', label: 'R', type: 'summary', dataset: 'sales', rows: ['stage'], values: ['revenue'],
      chart: { type: 'bar', xAxis: 'stage', yAxis: 'revenue' },
    });
    expect(r.chart?.xAxis).toBe('stage');
  });

  it('rejects a (non-joined) report with no dataset', () => {
    expect(() => ReportSchema.parse({ name: 'rep_x', label: 'R', type: 'summary', rows: ['stage'], values: ['revenue'] })).toThrow();
  });

  it('rejects a (non-joined) report with no values', () => {
    expect(() => ReportSchema.parse({ name: 'rep_x', label: 'R', type: 'summary', dataset: 'sales', rows: ['stage'] })).toThrow();
  });

  it('a report supplying only the removed inline fields is invalid', () => {
    expect(() => ReportSchema.parse({ name: 'rep_x', label: 'R', type: 'summary', objectName: 'opportunity', columns: [{ field: 'amount' }] } as any)).toThrow();
  });

  it('Report.create factory parses + returns a typed report', () => {
    const r = Report.create({ name: 'rep_x', label: 'R', type: 'summary', dataset: 'sales', rows: ['stage'], values: ['revenue'] });
    expect(r.name).toBe('rep_x');
  });

  it('ReportType enum', () => {
    expect(ReportType.parse('matrix')).toBe('matrix');
    expect(() => ReportType.parse('nope')).toThrow();
  });
});

describe('Joined reports', () => {
  it('accepts a joined report whose blocks are dataset-bound', () => {
    const r = ReportSchema.parse({
      name: 'overview', label: 'Overview', type: 'joined',
      blocks: [
        { name: 'open_block', label: 'Open', type: 'summary', dataset: 'tasks', rows: ['status'], values: ['task_count'], runtimeFilter: { done: false } },
        { name: 'done_block', label: 'Done', type: 'summary', dataset: 'tasks', rows: ['status'], values: ['task_count'], runtimeFilter: { done: true } },
      ],
    });
    expect(r.blocks).toHaveLength(2);
  });

  it('rejects a joined report with no blocks', () => {
    expect(() => ReportSchema.parse({ name: 'rep_x', label: 'R', type: 'joined' })).toThrow();
  });

  it('JoinedReportBlockSchema parses a dataset-bound block', () => {
    const b = JoinedReportBlockSchema.parse({ name: 'blk_x', type: 'summary', dataset: 'tasks', rows: ['status'], values: ['task_count'] });
    expect(b.dataset).toBe('tasks');
  });
});

/**
 * #3916 — reports can declare an ordering. Before this the report schema had no
 * sort field at all: `DatasetSelection.order` existed but was unreachable for
 * report authors (dashboard widgets had their own `options.sortBy` channel),
 * so a matrix report's date columns rendered in whatever order the rows arrived.
 */
describe('Report ordering (#3916)', () => {
  it('accepts an order over a dimension and a measure, direction defaulting to asc', () => {
    const r = ReportSchema.parse({
      name: 'hours_matrix', label: 'Hours', type: 'matrix',
      dataset: 'tasks', rows: ['owner'], columns: ['closed_month'], values: ['est_hours'],
      order: [{ by: 'closed_month' }, { by: 'est_hours', direction: 'desc' }],
    });
    expect(r.order).toEqual([
      { by: 'closed_month', direction: 'asc' },
      { by: 'est_hours', direction: 'desc' },
    ]);
  });

  it('is optional — a report without it stays valid (the runtime still defaults the time axis)', () => {
    const r = ReportSchema.parse({
      name: 'rep_x', label: 'R', type: 'summary', dataset: 'sales', rows: ['stage'], values: ['revenue'],
    });
    expect(r.order).toBeUndefined();
  });

  it('rejects a key the report does not select — the mistyped-sort failure mode', () => {
    expect(() => ReportSchema.parse({
      name: 'rep_x', label: 'R', type: 'summary',
      dataset: 'sales', rows: ['stage'], values: ['revenue'],
      order: [{ by: 'closed_month' }],
    })).toThrow(/not selected by this report/);
  });

  it('rejects a duplicated key', () => {
    expect(() => ReportSchema.parse({
      name: 'rep_x', label: 'R', type: 'summary',
      dataset: 'sales', rows: ['stage'], values: ['revenue'],
      order: [{ by: 'stage' }, { by: 'stage', direction: 'desc' }],
    })).toThrow(/duplicate order key/);
  });

  it('a joined report orders per block, not at the container', () => {
    const blocks = [
      { name: 'open_block', type: 'summary', dataset: 'tasks', rows: ['status'], values: ['task_count'], order: [{ by: 'task_count', direction: 'desc' }] },
    ];
    const r = ReportSchema.parse({ name: 'overview', label: 'Overview', type: 'joined', blocks });
    expect(r.blocks[0].order).toEqual([{ by: 'task_count', direction: 'desc' }]);
    expect(() => ReportSchema.parse({
      name: 'overview', label: 'Overview', type: 'joined', blocks, order: [{ by: 'task_count' }],
    })).toThrow(/orders per block/);
  });

  it('a block order key is validated against that block\'s own selection', () => {
    expect(() => JoinedReportBlockSchema.parse({
      name: 'blk_x', type: 'summary', dataset: 'tasks', rows: ['status'], values: ['task_count'],
      order: [{ by: 'revenue' }],
    })).toThrow(/not selected by this report/);
  });

  it('ReportSortSchema defaults direction to asc', () => {
    expect(ReportSortSchema.parse({ by: 'stage' })).toEqual({ by: 'stage', direction: 'asc' });
  });

  it('reportSelectionOrder lowers the list to DatasetSelection.order, keys in list order', () => {
    const lowered = reportSelectionOrder([
      { by: 'closed_month' },
      { by: 'revenue', direction: 'desc' },
    ]);
    expect(lowered).toEqual({ closed_month: 'asc', revenue: 'desc' });
    // Key ORDER is the contract — it is how sort significance survives the
    // lowering into a plain object.
    expect(Object.keys(lowered!)).toEqual(['closed_month', 'revenue']);
  });

  it('reportSelectionOrder returns undefined for an absent or empty order', () => {
    // Not `{}` — the caller must omit the field so the runtime's own defaults
    // (chronological time axis) still apply.
    expect(reportSelectionOrder(undefined)).toBeUndefined();
    expect(reportSelectionOrder([])).toBeUndefined();
  });
});

/**
 * #5013 — the scope-filter prescription, pinned by PARSE rather than by reading
 * the alias table.
 *
 * The structural half (every alias key is one the shape rejects, every target
 * one it accepts) is gated package-wide in `shared/alias-integrity.test.ts`.
 * What that gate cannot say is what the author actually SEES, which is the
 * thing that was broken: `filter` pointed at `filters`, a key `ReportSchema`
 * does not declare either, so the fix earned a second rejection carrying no
 * suggestion at all.
 *
 * These assertions guard a KEY verdict — which spelling the rejection names —
 * so the prescribed key is proved by a full green parse of an otherwise-valid
 * report, not merely by the absence of an `unrecognized_keys` issue.
 */
describe('ReportSchema — scope-filter aliases point at `runtimeFilter` (#5013)', () => {
  const VALID = {
    name: 'pipeline', label: 'Pipeline', type: 'summary',
    dataset: 'sales', rows: ['stage'], values: ['revenue'],
  } as const;

  const messageFor = (key: string): string => {
    const r = ReportSchema.safeParse({ ...VALID, [key]: { won: true } });
    expect(r.success, `\`${key}\` must still be rejected — it is not a declared key`).toBe(false);
    return r.error!.issues.map((i) => i.message).join('\n');
  };

  it.each(['filter', 'filters', 'where', 'criteria'])(
    '`%s` is renamed onto `runtimeFilter`, the key this schema really declares',
    (key) => {
      const message = messageFor(key);
      expect(message).toContain(`\`${key}\` → \`runtimeFilter\``);
      // The old prescription, and the reason it was a defect: `filters` is not
      // a key of this schema, so being sent there is a second rejection.
      expect(message).not.toContain('→ `filters`');
    },
  );

  it('the prescribed key parses — taking the advice ends the conversation', () => {
    // The half that was false before: following the suggestion has to WORK.
    const r = ReportSchema.safeParse({ ...VALID, runtimeFilter: { won: true } });
    expect(r.success).toBe(true);
    expect(r.data!.runtimeFilter).toEqual({ won: true });
  });

  it('matches the block table verbatim — a sub-report corrects the author the same way', () => {
    const block = JoinedReportBlockSchema.safeParse({
      name: 'b', label: 'B', type: 'summary', dataset: 'sales', rows: ['stage'], values: ['revenue'],
      filter: { won: true },
    });
    expect(block.success).toBe(false);
    expect(block.error!.issues.map((i) => i.message).join('\n')).toContain('`filter` → `runtimeFilter`');
  });

  it('`columns` and `chart` are real keys here, so nothing renames them away', () => {
    // Both were alias KEYS on this schema until #5013 — entries that could
    // never run, because the shape declares both. Pinned from the other side:
    // authoring either must simply work.
    const r = ReportSchema.safeParse({
      ...VALID, type: 'matrix', columns: ['region'],
      chart: { type: 'bar', xAxis: 'stage', yAxis: 'revenue' },
    });
    expect(r.success).toBe(true);
    expect(r.data!.columns).toEqual(['region']);
  });
});

/**
 * The selection and ordering spellings a block already corrects, pinned by
 * PARSE on the top-level report — the surface where they were missing.
 *
 * `ReportSchema`'s table says it is kept parallel to the block's, and ten of
 * the block's entries were absent from it: `measures:` on a plain report was
 * refused with no suggestion at all, while the same key one level down was
 * told `values`. Measured before the fix, nine of the ten got no suggestion;
 * `orderBy` alone reached `order` by edit distance.
 *
 * Two halves, as in the scope-filter block above: what the author SEES (the
 * rejection names the prescribed key), and that taking the advice parses.
 */
describe('ReportSchema — routes the block vocabulary the way a block does', () => {
  const VALID = {
    name: 'pipeline', label: 'Pipeline', type: 'summary',
    dataset: 'sales', rows: ['stage'], values: ['revenue'],
  } as const;

  /** A value the TARGET key accepts on `VALID`, so the advice can be taken verbatim. */
  const VALUE_FOR: Record<string, unknown> = {
    values: ['revenue'],
    rows: ['stage'],
    order: [{ by: 'revenue', direction: 'desc' }],
    dataset: 'sales',
  };

  const ROUTES: ReadonlyArray<readonly [string, string]> = [
    ['measures', 'values'],
    ['metrics', 'values'],
    ['dimensions', 'rows'],
    ['groupBy', 'rows'],
    ['groupings', 'rows'],
    ['sort', 'order'],
    ['orderBy', 'order'],
    ['sortBy', 'order'],
    ['objectName', 'dataset'],
    ['object', 'dataset'],
  ];

  it.each(ROUTES)('`%s` on a top-level report is renamed onto `%s`', (key, target) => {
    const r = ReportSchema.safeParse({ ...VALID, [key]: VALUE_FOR[target] });
    expect(r.success, `\`${key}\` must still be rejected — it is not a declared key`).toBe(false);
    const issue = r.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue, `\`${key}\` must be refused as an unknown key`).toBeDefined();
    expect((issue as { keys?: readonly string[] }).keys).toEqual([key]);
    expect(issue!.message).toContain(`Did you mean \`${key}\` → \`${target}\`?`);
  });

  it.each(ROUTES)('taking the advice for `%s` parses — `%s` is a key this report accepts', (_key, target) => {
    const r = ReportSchema.safeParse({ ...VALID, [target]: VALUE_FOR[target] });
    expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
  });

  /**
   * The parity claim itself, derived from the two tables at runtime rather
   * than from a list: every key the block routes to a target this schema also
   * declares is routed here, to the same target — or, where a key must not
   * route at the top level, answered by a `guidance` entry that says why.
   * Never silence.
   */
  it('every block alias whose target the report declares is routed here too, to the same target', () => {
    // Force both lazy schemas so their declarations are registered.
    ReportSchema.safeParse(VALID);
    JoinedReportBlockSchema.safeParse({ ...VALID, type: 'tabular' });
    const declarationOf = (surface: string) => {
      const found = strictObjectDeclarations().filter((d) => d.options.surface === surface);
      expect(found, `exactly one declaration answers to "${surface}"`).toHaveLength(1);
      return found[0]!;
    };
    const block = declarationOf('this joined report block');
    const top = declarationOf('this report');

    const judged = Object.entries(block.options.aliases ?? {}).filter(([, target]) => target in top.shape);
    // Not vacuous: the derivation reaches every key this pin was written for.
    expect(judged.map(([key]) => key)).toEqual(expect.arrayContaining(ROUTES.map(([key]) => key)));

    const topAliases = top.options.aliases ?? {};
    const topGuidance = top.options.guidance ?? {};
    const silentOrDivergent = judged
      .filter(([key, target]) => topAliases[key] !== target && !(key in topGuidance))
      .map(([key, target]) => `${key} → ${target} (top level: ${topAliases[key] ?? 'absent'})`);
    expect(silentOrDivergent).toEqual([]);
  });
});

describe('ReportChartSchema', () => {
  it('requires xAxis + yAxis', () => {
    expect(ReportChartSchema.parse({ type: 'bar', xAxis: 'stage', yAxis: 'revenue' }).type).toBe('bar');
    expect(() => ReportChartSchema.parse({ type: 'bar' })).toThrow();
  });
});
