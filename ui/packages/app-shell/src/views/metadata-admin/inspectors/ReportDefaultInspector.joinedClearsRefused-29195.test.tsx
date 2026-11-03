// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29195 — switching a report to `joined` clears EVERY container key
 * the joined arm of `ReportSchema` refuses, `dateRange` and `exportOptions`
 * included, and `ReportSchema` is the judge of "every".
 *
 * The joined arm refuses a container `dateRange` and `exportOptions` whatever
 * their value (objectstack#26548: "a `joined` report takes no `dateRange`" /
 * "a `joined` report offers no export"), and the spec form's "Period & export"
 * section hides both on a joined report. The type picker cleared the six
 * selection / ordering / chart keys (objectui#10746) but not these two, so a
 * report that carried either one and was switched to Joined saved into a
 * refusal at a key no visible control reached.
 *
 * The spec exports no list of the refused keys, so this file does not keep a
 * second one. It builds a report carrying every top-level key a non-joined
 * report can carry (`MAXIMAL`), pins that fixture against the spec's own
 * property list (a key the spec adds later must join the fixture or the
 * named exclusion set), switches it to `joined` through the inspector, and
 * asks `ReportSchema` two things: the keys it refuses on the type-only switch
 * are exactly the keys the patch clears, and the switched report parses.
 *
 * Patches are read with `toStrictEqual`: `toEqual` treats an own key holding
 * `undefined` as absent, so it cannot tell a clear from a missing key.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportSchema } from '@objectstack/spec/ui';
import { MetadataProtectionFields, OverrideDeclarationFields } from '@objectstack/spec/kernel';
import { ReportDefaultInspector } from './ReportDefaultInspector';
import { getReportSchema } from '../report-schema';
import type { DatasetCatalogEntry } from '../previews/useDatasetCatalog';

afterEach(cleanup);

// One fetch double at MODULE scope, never torn down: `useDatasetSemantics`
// fires a fire-and-forget read that no test body awaits (as in
// `ReportDefaultInspector.test.tsx`).
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

const catalog: DatasetCatalogEntry[] = [
  {
    name: 'sales_metrics',
    label: 'Sales metrics',
    dimensions: [
      { name: 'stage', type: 'text' },
      { name: 'close_quarter', type: 'date' },
    ],
    measures: [
      { name: 'total_amount', aggregate: 'sum' },
      { name: 'deal_count', aggregate: 'count' },
    ],
  },
];

const baseProps = {
  type: 'report',
  name: 'pipeline',
  locale: 'en-US' as const,
  onSelectionChange: vi.fn(),
  datasetCatalogOverride: catalog,
};

/** One dataset-bound block: what a joined report needs before it saves. */
const block = { name: 'won_deals', dataset: 'sales_metrics', rows: ['stage'], values: ['total_amount'] };

/**
 * A matrix report carrying every top-level key a non-joined report can carry,
 * each with a value the spec accepts there. The `coverage` case below holds it
 * against the spec's property list.
 */
const MAXIMAL: Record<string, unknown> = {
  name: 'pipeline',
  label: 'Pipeline',
  description: 'Won deals by stage and quarter',
  type: 'matrix',
  dataset: 'sales_metrics',
  rows: ['stage'],
  columns: ['close_quarter'],
  values: ['total_amount'],
  runtimeFilter: { stage: 'won' },
  order: [{ by: 'total_amount' }],
  drilldown: false,
  chart: { type: 'bar', xAxis: 'stage', yAxis: 'total_amount' },
  dateRange: { dimension: 'close_quarter', defaultRange: 'this_quarter', allowCustomRange: false },
  exportOptions: { formats: ['csv'], includeHeaders: true, fileNamePrefix: 'pipeline' },
};

/**
 * Spec properties `MAXIMAL` deliberately leaves out, each read from the spec
 * where it can be: `blocks` is the joined report's own key (added after the
 * switch below); `protection` is the package author's lock block, which the
 * save door refuses; the ADR-0010 envelope (`MetadataProtectionFields`) is set
 * by the loader; `overrides` is the ADR-0146 override declaration
 * (`OverrideDeclarationFields`). None of them is report-type data.
 */
const EXCLUDED = new Set([
  'blocks',
  'protection',
  ...Object.keys(MetadataProtectionFields),
  ...Object.keys(OverrideDeclarationFields),
]);

type Patch = Record<string, unknown>;

/** Mount on `draft`, pick `optionLabel` in the Report type control, hand back the one patch. */
async function switchType(draft: Record<string, unknown>, optionLabel: string): Promise<Patch> {
  const onPatch = vi.fn<(patch: Patch) => void>();
  render(<ReportDefaultInspector {...baseProps} draft={draft} onPatch={onPatch} readOnly={false} />);
  await userEvent.click(screen.getByRole('combobox', { name: 'Report type' }));
  await userEvent.click(await screen.findByRole('option', { name: optionLabel }));
  expect(onPatch, 'the type picker commits exactly one patch').toHaveBeenCalledTimes(1);
  return onPatch.mock.calls[0][0];
}

/** The hosts' shallow merge (`{ ...draft, ...patch }`). */
const merge = (draft: Record<string, unknown>, patch: Patch): Record<string, unknown> => ({ ...draft, ...patch });

/** What reaches the wire: the draft JSON-encoded, as `client.save` sends a body. */
const serialised = (doc: Record<string, unknown>): Record<string, unknown> => JSON.parse(JSON.stringify(doc));

/** Top-level keys `ReportSchema` refuses on `doc`, sorted. */
function refusedTopLevelKeys(doc: Record<string, unknown>): string[] {
  const parsed = ReportSchema.safeParse(doc);
  if (parsed.success) return [];
  return [...new Set(parsed.error.issues.map((i) => String(i.path[0])))].sort();
}

/** Keys a patch clears (an own key holding `undefined`), sorted. */
const clearedKeys = (patch: Patch): string[] =>
  Object.keys(patch)
    .filter((k) => patch[k] === undefined)
    .sort();

describe('ReportDefaultInspector — switching to `joined` clears every key the joined arm refuses (objectstack#29195)', () => {
  it('INSTRUMENT: the maximal fixture is a valid non-joined report', () => {
    const parsed = ReportSchema.safeParse(MAXIMAL);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
  });

  it('coverage: the fixture carries every spec property except the named exclusions', () => {
    const specKeys = Object.keys(getReportSchema().properties ?? {}).sort();
    const covered = [...Object.keys(MAXIMAL), ...EXCLUDED].sort();
    expect(
      covered,
      'a top-level key the spec added joins MAXIMAL (with a valid non-joined value) or EXCLUDED (with its reason)',
    ).toStrictEqual(specKeys);
  });

  it('SPEC AS JUDGE: the patch clears exactly the keys `ReportSchema` refuses on a joined container, and the switched report parses', async () => {
    const patch = await switchType(MAXIMAL, 'Joined');
    // What the type alone would commit, with the blocks a joined report needs.
    const typeOnly = serialised({ ...MAXIMAL, type: 'joined', blocks: [block] });
    const refused = refusedTopLevelKeys(typeOnly);
    expect(refused, 'INSTRUMENT CONTROL: the spec refuses the type-only switch').toContain('dateRange');
    expect(clearedKeys(patch)).toStrictEqual(refused);

    const saved = serialised({ ...merge(MAXIMAL, patch), blocks: [block] });
    const parsed = ReportSchema.safeParse(saved);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    // The keys the joined branch reads travel through.
    expect(saved).toMatchObject({ runtimeFilter: { stage: 'won' }, drilldown: false, description: MAXIMAL.description });
  });

  it('THE DEFECT: a report with `dateRange` and `exportOptions` switched to `joined` saves without them, and the spec accepts the save', async () => {
    const draft = {
      name: 'pipeline',
      label: 'Pipeline',
      type: 'summary',
      dataset: 'sales_metrics',
      values: ['total_amount'],
      dateRange: { defaultRange: 'this_month' },
      exportOptions: { formats: ['csv', 'xlsx'] },
      blocks: [block],
    };
    const patch = await switchType(draft, 'Joined');
    expect(patch).toStrictEqual({
      type: 'joined',
      dataset: undefined,
      values: undefined,
      dateRange: undefined,
      exportOptions: undefined,
    });
    const saved = serialised(merge(draft, patch));
    expect(saved).not.toHaveProperty('dateRange');
    expect(saved).not.toHaveProperty('exportOptions');
    const parsed = ReportSchema.safeParse(saved);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
  });

  it('an empty `dateRange` and an export turned off are cleared too: the joined arm refuses any present value', async () => {
    const draft = { name: 'pipeline', label: 'Pipeline', type: 'tabular', dateRange: {}, exportOptions: { formats: [] } };
    const patch = await switchType(draft, 'Joined');
    expect(patch).toStrictEqual({ type: 'joined', dateRange: undefined, exportOptions: undefined });
  });

  it('`joined` → non-joined brings neither key back: the patch is the type alone', async () => {
    const first = await switchType(MAXIMAL, 'Joined');
    const joined = { ...serialised(merge(MAXIMAL, first)), blocks: [block] };
    cleanup();
    const patch = await switchType(joined, 'Summary');
    expect(patch).toStrictEqual({ type: 'summary' });
    const committed = merge(joined, patch);
    expect(committed).not.toHaveProperty('dateRange');
    expect(committed).not.toHaveProperty('exportOptions');
  });

  it('CONTROL: switching between two non-joined types keeps `dateRange` and `exportOptions`', async () => {
    const patch = await switchType(MAXIMAL, 'Summary');
    expect(patch).toStrictEqual({ type: 'summary' });
    expect(serialised(merge(MAXIMAL, patch))).toMatchObject({
      dateRange: MAXIMAL.dateRange,
      exportOptions: MAXIMAL.exportOptions,
    });
  });
});
