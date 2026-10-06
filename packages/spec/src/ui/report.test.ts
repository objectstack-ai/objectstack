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
  defineReport,
} from './report.zod';
import { strictObjectDeclarations } from '../shared/strict-object';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';

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
 * A `joined` container selects nothing itself: each block binds its own
 * dataset and picks its own dimensions and measures, and the renderer's joined
 * branch returns before it reads any top-level selection key. Until this
 * refinement, a container `dataset` / `rows` / `columns` / `values` parsed
 * green and was then dropped without a word — while `order`, one key over, was
 * already refused for exactly that reason.
 *
 * Every refusal below asserts the envelope a schema door owes: the issue
 * `code`, its `path`, and the prescription (the key moves onto `blocks[]`).
 */
describe('Joined reports refuse top-level selection keys', () => {
  const BLOCK = { name: 'open_block', type: 'summary', dataset: 'tasks', rows: ['status'], values: ['task_count'] } as const;
  const JOINED = { name: 'overview', label: 'Overview', type: 'joined', blocks: [BLOCK] } as const;
  const PRESCRIPTION = (key: string) =>
    `a \`joined\` report selects per block — move \`${key}\` onto \`blocks[]\`, or delete it; on the container it selects nothing.`;
  const ORDER_MESSAGE = 'a `joined` report orders per block — move `order` onto `blocks[]`.';

  /** A NON-EMPTY value the key accepts on a plain report, so only the joined arm can refuse it. */
  const SELECTION: ReadonlyArray<readonly [string, unknown]> = [
    ['dataset', 'tasks'],
    ['rows', ['status']],
    ['columns', ['priority']],
    ['values', ['task_count']],
  ];

  it.each(SELECTION)('`%s` on a joined container is refused at its own path, pointing at `blocks[]`', (key, value) => {
    const r = ReportSchema.safeParse({ ...JOINED, [key]: value });
    expect(r.success, `a joined report carrying \`${key}\` parsed green — the key would be silently dropped`).toBe(false);
    expect(r.error!.issues.map((i) => ({ code: i.code, path: i.path, message: i.message }))).toEqual([
      { code: 'custom', path: [key], message: PRESCRIPTION(key) },
    ]);
  });

  it('refuses all four at once, one issue per key — and the `order` refusal beside them is unchanged', () => {
    const r = ReportSchema.safeParse({
      ...JOINED,
      dataset: 'tasks', rows: ['status'], columns: ['priority'], values: ['task_count'],
      order: [{ by: 'task_count' }],
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => ({ code: i.code, path: i.path, message: i.message }))).toEqual([
      ...SELECTION.map(([key]) => ({ code: 'custom', path: [key], message: PRESCRIPTION(key) })),
      { code: 'custom', path: ['order'], message: ORDER_MESSAGE },
    ]);
  });

  it('the authoring factory refuses it too — `defineReport` throws the same prescription', () => {
    expect(() => defineReport({ ...JOINED, values: ['task_count'] } as never)).toThrow(PRESCRIPTION('values'));
  });

  it('the metadata save door refuses it — the registry\'s `report` schema is the same schema', () => {
    const saveDoor = getMetadataTypeSchema('report');
    expect(saveDoor, 'the `report` metadata type must resolve a schema').toBeDefined();
    const r = saveDoor!.safeParse({ ...JOINED, dataset: 'tasks' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => ({ code: i.code, path: i.path, message: i.message }))).toEqual([
      { code: 'custom', path: ['dataset'], message: PRESCRIPTION('dataset') },
    ]);
  });

  it('taking the advice parses — each key is accepted on a block', () => {
    const r = ReportSchema.safeParse({
      ...JOINED,
      blocks: [{ ...BLOCK, type: 'matrix', dataset: 'tasks', rows: ['status'], columns: ['priority'], values: ['task_count'] }],
    });
    expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
    expect(r.data!.blocks![0]).toMatchObject({ dataset: 'tasks', rows: ['status'], columns: ['priority'], values: ['task_count'] });
  });

  it('an EMPTY list selects nothing, so it is not refused — the same threshold as `order`', () => {
    const r = ReportSchema.safeParse({ ...JOINED, rows: [], columns: [], values: [], order: [] });
    expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
  });

  it('the container keys a joined report DOES read still parse — `runtimeFilter` and `drilldown`', () => {
    const r = ReportSchema.safeParse({ ...JOINED, runtimeFilter: { done: false }, drilldown: false });
    expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
    expect(r.data!.runtimeFilter).toEqual({ done: false });
    expect(r.data!.drilldown).toBe(false);
  });

  it('a non-joined report is untouched — the same four keys are its selection', () => {
    const r = ReportSchema.safeParse({
      name: 'hours_matrix', label: 'Hours', type: 'matrix',
      dataset: 'tasks', rows: ['status'], columns: ['priority'], values: ['task_count'],
    });
    expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
  });

  /**
   * The alias tables route an author ONTO these keys (`measures` → `values`,
   * `dataSet` → `dataset`). On a joined report the prescribed key is itself
   * refused, with the pointer onto `blocks[]` — the same two-step answer an
   * author already gets for `sort` → `order`. The refusal must still be reached
   * after the rename; this pins it end to end, both spellings.
   */
  it.each([
    ['measures', 'values', ['task_count']],
    ['dataSet', 'dataset', 'tasks'],
  ] as const)('the alias `%s` → `%s` still ends at the joined refusal, and then at `blocks[]`', (alias, target, value) => {
    const aliased = ReportSchema.safeParse({ ...JOINED, [alias]: value });
    expect(aliased.success).toBe(false);
    const unknown = aliased.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(unknown, `\`${alias}\` must be refused as an unknown key`).toBeDefined();
    expect(unknown!.message).toContain(`Did you mean \`${alias}\` → \`${target}\`?`);

    const renamed = ReportSchema.safeParse({ ...JOINED, [target]: value });
    expect(renamed.success, `taking the rename put \`${target}\` on a joined container and it parsed green`).toBe(false);
    expect(renamed.error!.issues.map((i) => ({ code: i.code, path: i.path, message: i.message }))).toEqual([
      { code: 'custom', path: [target], message: PRESCRIPTION(target) },
    ]);

    const moved = ReportSchema.safeParse({ ...JOINED, blocks: [{ ...BLOCK, [target]: value }] });
    expect(moved.success, JSON.stringify(moved.error?.issues ?? [])).toBe(true);
  });
});

/**
 * #20161 — a `joined` report draws no chart. Its renderer draws each block as
 * a table and returns before the one container `chart` read, and nothing ever
 * read a block's `chart` — so both parsed and plotted nothing. The block key is
 * REMOVED from the closed block shape (answered by its `guidance` entry); the
 * container key stays declared for every non-joined report and is refused by
 * the joined arm of the refinement.
 *
 * Each refusal asserts what a schema door owes: the issue `code`, its `path`,
 * and the first sentence of the prescription.
 */
describe('A joined report draws no chart — block `chart` removed, container `chart` refused', () => {
  const BLOCK = { name: 'open_block', type: 'summary', dataset: 'tasks', rows: ['status'], values: ['task_count'] } as const;
  const JOINED = { name: 'overview', label: 'Overview', type: 'joined', blocks: [BLOCK] } as const;
  const CHART = { type: 'bar', xAxis: 'status', yAxis: 'task_count' } as const;
  const BLOCK_FIRST_SENTENCE = '`report.blocks[].chart` was removed in @objectstack/spec 17.5.0 (ADR-0049 enforce-or-remove)';
  const CONTAINER_FIRST_SENTENCE = 'a `joined` report draws no chart — it draws each block as a table and never reads `chart`, on the container or on a block.';
  const MIGRATE = 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.';

  const issuesOf = (r: { success: boolean; error?: { issues: ReadonlyArray<{ code: string; path: PropertyKey[]; message: string }> } }) =>
    (r.error?.issues ?? []).map((i) => ({ code: i.code, path: i.path, message: i.message }));

  it('a block `chart` is refused as a removed key, carrying the prescription — not a silent strip', () => {
    const r = JoinedReportBlockSchema.safeParse({ ...BLOCK, chart: CHART });
    expect(r.success, 'a block `chart` parsed green — it would plot nothing').toBe(false);
    const issues = issuesOf(r);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('unrecognized_keys');
    expect(issues[0]!.path).toEqual([]);
    expect(issues[0]!.message).toContain(BLOCK_FIRST_SENTENCE);
    expect(issues[0]!.message).toContain('Delete the key.');
    expect(issues[0]!.message).toContain(MIGRATE);
  });

  it('…and the same refusal is located under the report, at the block that carries it', () => {
    const r = ReportSchema.safeParse({ ...JOINED, blocks: [BLOCK, { ...BLOCK, name: 'done_block', chart: CHART }] });
    expect(r.success).toBe(false);
    const issues = issuesOf(r);
    expect(issues.map((i) => [i.code, i.path])).toEqual([['unrecognized_keys', ['blocks', 1]]]);
    expect(issues[0]!.message).toContain(BLOCK_FIRST_SENTENCE);
  });

  it('a container `chart` on a joined report is refused at its own path, with no pointer onto `blocks[]`', () => {
    const r = ReportSchema.safeParse({ ...JOINED, chart: CHART });
    expect(r.success, 'a joined report carrying `chart` parsed green — it would plot nothing').toBe(false);
    const issues = issuesOf(r);
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['chart']]]);
    expect(issues[0]!.message.startsWith(CONTAINER_FIRST_SENTENCE), issues[0]!.message).toBe(true);
    expect(issues[0]!.message).toContain('Delete `chart`');
    expect(issues[0]!.message).not.toContain('onto `blocks[]`');
    expect(issues[0]!.message).toContain(MIGRATE);
  });

  it('it joins the selection refusals rather than replacing them — one issue per key, `chart` last', () => {
    const r = ReportSchema.safeParse({ ...JOINED, dataset: 'tasks', order: [{ by: 'task_count' }], chart: CHART });
    expect(issuesOf(r).map((i) => [i.code, i.path])).toEqual([
      ['custom', ['dataset']],
      ['custom', ['order']],
      ['custom', ['chart']],
    ]);
  });

  it('the authoring factory refuses both — `defineReport` throws each prescription', () => {
    expect(() => defineReport({ ...JOINED, chart: CHART } as never)).toThrow(CONTAINER_FIRST_SENTENCE);
    expect(() => defineReport({ ...JOINED, blocks: [{ ...BLOCK, chart: CHART }] } as never)).toThrow(BLOCK_FIRST_SENTENCE);
  });

  it('the metadata save door\'s schema refuses both — the registry\'s `report` schema is the same schema', () => {
    const saveDoor = getMetadataTypeSchema('report');
    expect(saveDoor, 'the `report` metadata type must resolve a schema').toBeDefined();
    const container = saveDoor!.safeParse({ ...JOINED, chart: CHART });
    expect(container.success).toBe(false);
    expect(issuesOf(container as never).map((i) => [i.code, i.path])).toEqual([['custom', ['chart']]]);
    const block = saveDoor!.safeParse({ ...JOINED, blocks: [{ ...BLOCK, chart: CHART }] });
    expect(block.success).toBe(false);
    expect(issuesOf(block as never).map((i) => [i.code, i.path])).toEqual([['unrecognized_keys', ['blocks', 0]]]);
  });

  it('a block on a NON-joined container is the same closed shape — its `chart` is refused there too', () => {
    const r = ReportSchema.safeParse({
      name: 'hours', label: 'Hours', type: 'summary', dataset: 'tasks', rows: ['status'], values: ['task_count'],
      blocks: [{ ...BLOCK, chart: CHART }],
    });
    expect(issuesOf(r).map((i) => [i.code, i.path])).toEqual([['unrecognized_keys', ['blocks', 0]]]);
  });

  it('a non-joined report keeps its live `chart` — every non-joined type parses it and round-trips it', () => {
    for (const type of ['tabular', 'summary', 'matrix'] as const) {
      const r = ReportSchema.safeParse({
        name: 'hours', label: 'Hours', type, dataset: 'tasks', rows: ['status'],
        ...(type === 'matrix' ? { columns: ['priority'] } : {}),
        values: ['task_count'], chart: CHART,
      });
      expect(r.success, `${type}: ${JSON.stringify(r.error?.issues ?? [])}`).toBe(true);
      expect(r.data!.chart).toMatchObject(CHART);
    }
  });

  it('a joined report without a chart parses exactly as before', () => {
    const r = ReportSchema.safeParse({ ...JOINED, runtimeFilter: { done: false }, drilldown: false });
    expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
    expect(r.data!.chart).toBeUndefined();
    expect(r.data!.blocks![0]).not.toHaveProperty('chart');
  });
});

/**
 * #3916 — reports can declare an ordering. Before this the report schema had no
 * sort field at all: `DatasetSelection.order` existed but was unreachable for
 * report authors (dashboard widgets had their own `options.sortBy` channel),
 * so a matrix report's date columns rendered in whatever order the rows arrived.
 */
describe('Report ordering — a report declares its own sort', () => {
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
describe('ReportSchema — scope-filter aliases point at `runtimeFilter`', () => {
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
