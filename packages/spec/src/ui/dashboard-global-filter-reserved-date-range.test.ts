// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29213 — on a dashboard that declares the built-in `dateRange`, a
 * `globalFilters` entry keyed `dateRange` (its `name`, else its `field`) is
 * refused.
 *
 * Measured on `main` @ `5a2bdf9c` before the rule: `DashboardSchema` accepted
 * `{ dateRange: { field: 'close_date' }, globalFilters: [{ name: 'dateRange', field: 'region' }] }`,
 * and the console's `resolveDashboardFilterDefs` (like lint's
 * `dashboardFilterDefs`) built the built-in date range first and let the
 * entry replace it, so the board drew a `region` control where the date range
 * belonged and `filterBindings.dateRange` bound `region`. The refusal is
 * located at the entry's key.
 */
import { describe, expect, it } from 'vitest';
import { DashboardSchema } from './dashboard.zod';
import { reservedDateRangeGlobalFilters } from './duplicate-global-filter-names';

const board = (extra: Record<string, unknown>) => ({
  name: 'qa_probe_drg',
  label: 'QA probe',
  widgets: [],
  ...extra,
});

const customIssues = (input: unknown) => {
  const result = DashboardSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.filter((i) => i.code === 'custom');
};

describe('#29213 DashboardSchema refuses a globalFilters entry keyed dateRange beside a declared dateRange', () => {
  it('CONTROL: a declared dateRange beside a differently named filter parses', () => {
    const result = DashboardSchema.safeParse(board({
      dateRange: { field: 'close_date' },
      globalFilters: [{ name: 'region', field: 'region', type: 'text' }],
    }));
    expect(result.success).toBe(true);
  });

  it('CONTROL: with no dateRange declared, an entry named dateRange is an ordinary filter and parses', () => {
    const result = DashboardSchema.safeParse(board({
      globalFilters: [{ name: 'dateRange', field: 'close_date', type: 'date' }],
    }));
    expect(result.success).toBe(true);
  });

  it('the card reproduction is refused at globalFilters[0].name, naming the reserved word and the built-in date range', () => {
    const result = DashboardSchema.safeParse(board({
      dateRange: { field: 'close_date' },
      globalFilters: [{ name: 'dateRange', field: 'region', type: 'text' }],
    }));
    expect(result.success).toBe(false);
    const issues = result.error!.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'custom', path: ['globalFilters', 0, 'name'] });
    expect(issues[0]!.message.startsWith(
      "globalFilters[0] is keyed 'dateRange', the reserved name of the built-in date range this dashboard declares in `dateRange`.",
    )).toBe(true);
    expect(issues[0]!.message).toMatch(/Give this filter another `name` .* or delete it and keep the built-in `dateRange`\.$/);
    // Runtime strings carry no tracker number (check:doc-authoring).
    expect(issues[0]!.message).not.toMatch(/#\d{3,}/);
  });

  it('an empty dateRange object is a declared dateRange (the shape both resolvers test)', () => {
    const issues = customIssues(board({
      dateRange: {},
      globalFilters: [{ name: 'dateRange', field: 'region', type: 'text' }],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: ['globalFilters', 0, 'name'] });
  });

  it('an UNNAMED entry whose field is dateRange is keyed by the field, located at .field', () => {
    const issues = customIssues(board({
      dateRange: {},
      globalFilters: [{ name: 'region', field: 'region', type: 'text' }, { field: 'dateRange', type: 'text' }],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: ['globalFilters', 1, 'field'] });
    expect(issues[0]!.message).toContain('(a filter with no `name` is keyed by its `field`)');
  });

  it('CONTROL: a named entry over a field called dateRange is keyed by its name and parses', () => {
    const result = DashboardSchema.safeParse(board({
      dateRange: {},
      globalFilters: [{ name: 'period', field: 'dateRange', type: 'text' }],
    }));
    expect(result.success).toBe(true);
  });

  it('two entries keyed dateRange answer one reserved-name issue each, beside the duplicate-key issue', () => {
    const issues = customIssues(board({
      dateRange: {},
      globalFilters: [{ name: 'dateRange', field: 'region' }, { name: 'dateRange', field: 'status' }],
    }));
    const reserved = issues.filter((i) => i.message.includes('reserved name of the built-in date range'));
    expect(reserved.map((i) => i.path)).toEqual([['globalFilters', 0, 'name'], ['globalFilters', 1, 'name']]);
    expect(issues.filter((i) => i.message.startsWith('This dashboard declares the global filter')).map((i) => i.path))
      .toEqual([['globalFilters', 1, 'name']]);
  });

  it('the refusal still answers when another key of the dashboard fails too', () => {
    const result = DashboardSchema.safeParse(board({
      columns: 99,
      dateRange: {},
      globalFilters: [{ name: 'dateRange', field: 'region', type: 'text' }],
    }));
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('columns');
    expect(paths).toContain('globalFilters.0.name');
  });
});

describe('#29213 reservedDateRangeGlobalFilters reads a stored body', () => {
  it('answers nothing without a declared dateRange object', () => {
    const filters = [{ name: 'dateRange', field: 'region' }];
    expect(reservedDateRangeGlobalFilters(undefined, filters)).toEqual([]);
    expect(reservedDateRangeGlobalFilters(null, filters)).toEqual([]);
    expect(reservedDateRangeGlobalFilters('this_month', filters)).toEqual([]);
  });

  it('a non-array, a non-object entry and an entry with neither key are left to the schema', () => {
    expect(reservedDateRangeGlobalFilters({}, undefined)).toEqual([]);
    expect(reservedDateRangeGlobalFilters({}, { name: 'dateRange' })).toEqual([]);
    expect(reservedDateRangeGlobalFilters({}, [null, 'dateRange', 7, { label: 'dateRange' }])).toEqual([]);
  });

  it('an empty name falls back to the field, as the duplicate-key predicate does', () => {
    expect(reservedDateRangeGlobalFilters({}, [{ name: '', field: 'dateRange' }]).map((e) => [e.index, e.key]))
      .toEqual([[0, 'field']]);
  });
});
