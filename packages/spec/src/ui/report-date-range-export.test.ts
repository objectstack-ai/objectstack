// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ReportSchema, JoinedReportBlockSchema, defineReport } from './report.zod';
import { DashboardSchema, DATE_RANGE_DEFAULT_RANGES } from './dashboard.zod';
import { ListViewExportOptionsSchema } from './list-view-export-options';
import { strictObjectDeclarations } from '../shared/strict-object';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';

/**
 * #26548 — a report's period (`dateRange`) and export (`exportOptions`),
 * ruling 6408567749 on #25873 (letter B). Both keys are optional and
 * top-level; a report declaring neither parses exactly as before.
 */

const VALID = {
  name: 'pipeline', label: 'Pipeline', type: 'summary',
  dataset: 'sales', rows: ['stage'], values: ['revenue'],
} as const;

const JOINED = {
  name: 'funnel', label: 'Funnel', type: 'joined',
  blocks: [{ name: 'won', dataset: 'sales', rows: ['stage'], values: ['revenue'] }],
} as const;

const issuesOf = (input: unknown) => {
  const r = ReportSchema.safeParse(input);
  expect(r.success, 'expected a refusal').toBe(false);
  return r.error!.issues;
};

const unknownKeyIssue = (input: unknown, key: string) => {
  const issue = issuesOf(input).find((i) => i.code === 'unrecognized_keys');
  expect(issue, `\`${key}\` must be refused as an unknown key`).toBeDefined();
  expect((issue as { keys?: readonly string[] }).keys).toEqual([key]);
  return issue!;
};

describe('a report without either key is untouched', () => {
  it('parses byte-identically, and the output carries neither key', () => {
    const parsed = ReportSchema.parse(VALID);
    expect(parsed).not.toHaveProperty('dateRange');
    expect(parsed).not.toHaveProperty('exportOptions');
    expect(parsed).toEqual({ ...VALID, drilldown: true });
  });

  it('a joined report without either key parses as before', () => {
    expect(ReportSchema.safeParse(JOINED).success).toBe(true);
  });
});

describe('ReportSchema.dateRange', () => {
  it('`{}` parses to the dashboard defaults', () => {
    const parsed = ReportSchema.parse({ ...VALID, dateRange: {} });
    expect(parsed.dateRange).toEqual({ defaultRange: 'this_month', allowCustomRange: true });
  });

  it('carries a named date dimension through', () => {
    const parsed = ReportSchema.parse({
      ...VALID,
      dateRange: { dimension: 'close_date', defaultRange: 'this_quarter', allowCustomRange: false },
    });
    expect(parsed.dateRange).toEqual({ dimension: 'close_date', defaultRange: 'this_quarter', allowCustomRange: false });
  });

  it.each(DATE_RANGE_DEFAULT_RANGES.map((r) => [r]))('accepts every dashboard default range — `%s`', (defaultRange) => {
    const r = ReportSchema.safeParse({ ...VALID, dateRange: { defaultRange } });
    expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
  });

  it('refuses a preset the table does not hold, and the message names the presets', () => {
    const issue = issuesOf({ ...VALID, dateRange: { defaultRange: 'last_6_months' } })[0]!;
    expect(issue.path).toEqual(['dateRange', 'defaultRange']);
    expect(issue.code).toBe('invalid_value');
    for (const preset of ['this_quarter', 'last_30_days', 'custom']) expect(issue.message).toContain(preset);
  });

  it.each([
    ['dateField', 'dimension', 'close_date'],
    ['field', 'dimension', 'close_date'],
    ['timeDimension', 'dimension', 'close_date'],
    ['preset', 'defaultRange', 'this_year'],
    ['range', 'defaultRange', 'this_year'],
    ['allowCustom', 'allowCustomRange', false],
  ] as const)('`%s` earns its rename hint onto `%s`', (key, target, value) => {
    const issue = unknownKeyIssue({ ...VALID, dateRange: { [key]: value } }, key);
    expect(issue.path).toEqual(['dateRange']);
    expect(issue.message).toContain(`Did you mean \`${key}\` → \`${target}\`?`);
    // Taking the advice parses.
    expect(ReportSchema.safeParse({ ...VALID, dateRange: { [target]: value } }).success).toBe(true);
  });

  it('refuses an unknown member', () => {
    unknownKeyIssue({ ...VALID, dateRange: { granularity: 'month' } }, 'granularity');
  });

  it.each([['dateFilter'], ['timeRange']])('the dashboard top-level spelling `%s` is renamed onto `dateRange`', (key) => {
    const issue = unknownKeyIssue({ ...VALID, [key]: {} }, key);
    expect(issue.message).toContain(`Did you mean \`${key}\` → \`dateRange\`?`);
  });

  it('is refused on a joined container at its own path, `{}` included, with no pointer onto blocks', () => {
    const issues = issuesOf({ ...JOINED, dateRange: {} });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['dateRange']);
    expect(issues[0]!.message).toMatch(/^a `joined` report takes no `dateRange`/);
    expect(issues[0]!.message).not.toContain('blocks[]');
  });

  it('a block declares no `dateRange` — refused with its guidance, at the block', () => {
    const issue = unknownKeyIssue({ ...JOINED, blocks: [{ ...JOINED.blocks[0], dateRange: {} }] }, 'dateRange');
    expect(issue.path).toEqual(['blocks', 0]);
    expect(issue.message).toContain('`dateRange` is a key of a non-joined report, not of a block');
    expect(issue.message).not.toContain('Did you mean');
  });

  /**
   * "Verbatim" is asserted, not stated: the two members a report shares with
   * the dashboard are compared at the live declarations — enum, default,
   * describe — and the dashboard's alias hints for them are carried unchanged.
   */
  it('shares the dashboard declaration verbatim — one preset table, one set of defaults and hints', () => {
    ReportSchema.safeParse(VALID);
    DashboardSchema.safeParse({ name: 'd', label: 'D', widgets: [] });
    const declarationOf = (surface: string) => {
      const found = strictObjectDeclarations().filter((d) => d.options.surface === surface);
      expect(found, `exactly one declaration answers to "${surface}"`).toHaveLength(1);
      return found[0]!;
    };
    const report = declarationOf('this report date range');
    const board = declarationOf('this dashboard date range');

    for (const member of ['defaultRange', 'allowCustomRange'] as const) {
      const ours = report.shape[member] as z.ZodType;
      const theirs = board.shape[member] as z.ZodType;
      expect(ours.description, member).toBe(theirs.description);
      expect(z.toJSONSchema(ours), member).toEqual(z.toJSONSchema(theirs));
    }
    const boardHints = Object.entries(board.options.aliases ?? {}).filter(([, t]) => t === 'defaultRange' || t === 'allowCustomRange');
    expect(boardHints.length).toBeGreaterThan(0);
    for (const [key, target] of boardHints) expect(report.options.aliases?.[key], key).toBe(target);
    // The dashboard's raw-field `field` key is a report's `dimension`; every
    // spelling the dashboard routes onto `field` routes onto `dimension` here.
    for (const [key, target] of Object.entries(board.options.aliases ?? {})) {
      if (target === 'field') expect(report.options.aliases?.[key], key).toBe('dimension');
    }
    expect(report.options.aliases?.field).toBe('dimension');
  });
});

describe('ReportSchema.exportOptions', () => {
  it.each([
    [{ formats: ['csv', 'xlsx'] }],
    [{ formats: [] }],
    [{ includeHeaders: false, fileNamePrefix: 'pipeline' }],
    [{}],
  ])('accepts %j', (exportOptions) => {
    const parsed = ReportSchema.parse({ ...VALID, exportOptions });
    expect(parsed.exportOptions).toEqual(exportOptions);
  });

  it('refuses `json` with a message naming the two report formats', () => {
    const issue = issuesOf({ ...VALID, exportOptions: { formats: ['json'] } })[0]!;
    expect(issue.path).toEqual(['exportOptions', 'formats', 0]);
    expect(issue.message).toMatch(/^a report exports its table as 'csv' or 'xlsx'\. 'json' is a list export's record format/);
  });

  it('refuses `pdf` with the report-side answer, not the list retirement sentence', () => {
    const issue = issuesOf({ ...VALID, exportOptions: { formats: ['pdf'] } })[0]!;
    expect(issue.path).toEqual(['exportOptions', 'formats', 0]);
    expect(issue.message).toMatch(/^a report exports its table as 'csv' or 'xlsx' — there is no PDF export of a report/);
    expect(issue.message).not.toContain('view.exportOptions');
  });

  it('refuses any other value with the enum message listing csv and xlsx only', () => {
    const issue = issuesOf({ ...VALID, exportOptions: { formats: ['docx'] } })[0]!;
    expect(issue.code).toBe('invalid_value');
    expect(issue.message).toContain('"csv"');
    expect(issue.message).toContain('"xlsx"');
    expect(issue.message).not.toContain('"json"');
  });

  it.each([['maxRecords', 500], ['streaming', false]] as const)(
    'refuses the list record-stream member `%s` as unknown, with its guidance',
    (key, value) => {
      const issue = unknownKeyIssue({ ...VALID, exportOptions: { [key]: value } }, key);
      expect(issue.path).toEqual(['exportOptions']);
      expect(issue.message).toContain(`\`${key}\` is a list export's record-stream member, and a report has none`);
    },
  );

  it('answers a bare format array by name', () => {
    const issue = issuesOf({ ...VALID, exportOptions: ['csv'] })[0]!;
    expect(issue.path).toEqual(['exportOptions']);
    expect(issue.message).toMatch(/^Expected the report export options object/);
  });

  it('is refused on a joined container at its own path', () => {
    const issues = issuesOf({ ...JOINED, exportOptions: { formats: ['csv'] } });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['exportOptions']);
    expect(issues[0]!.message).toMatch(/^a `joined` report offers no export/);
  });

  it('a block declares no `exportOptions` — refused with its guidance', () => {
    const r = JoinedReportBlockSchema.safeParse({ ...JOINED.blocks[0], exportOptions: {} });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toContain('`exportOptions` is a key of a non-joined report, not of a block');
  });

  it('shares the list block\'s members — `includeHeaders` by identity, the list schema unchanged', () => {
    const report = ReportSchema.parse({ ...VALID, exportOptions: { includeHeaders: true } });
    expect(report.exportOptions).toEqual({ includeHeaders: true });
    // The list block still carries all five members and its own formats.
    expect(ListViewExportOptionsSchema.safeParse({ formats: ['json'], maxRecords: 5, streaming: false }).success).toBe(true);
  });
});

describe('guidance on report keys that are not report metadata', () => {
  it('`allowExport` names the permission-set axis and the report key', () => {
    const issue = unknownKeyIssue({ ...VALID, allowExport: true }, 'allowExport');
    expect(issue.message).toContain('`ObjectPermission.allowExport`');
    expect(issue.message).toContain('`exportOptions: { formats: [] }`');
  });

  it.each([['subscription'], ['schedule']])('`%s` is answered: no scheduled delivery of a report', (key) => {
    const issue = unknownKeyIssue({ ...VALID, [key]: { cron: '0 8 * * 1' } }, key);
    expect(issue.message).toContain('a report declares no subscription or scheduled delivery');
  });
});

describe('every door reads the same schema', () => {
  it('the authoring factory and the save door refuse a joined date range alike', () => {
    expect(() => defineReport({ ...JOINED, dateRange: {} } as never)).toThrow(/takes no `dateRange`/);
    const registry = getMetadataTypeSchema('report');
    expect(registry).toBeDefined();
    const r = registry!.safeParse({ ...JOINED, dateRange: {} });
    expect(r.success).toBe(false);
  });
});
