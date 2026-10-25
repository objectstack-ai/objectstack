// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4575 — a dataset-bound REPORT's measures and numeric dimension
 * values follow the display locale, not the machine's.
 *
 * objectui#4566 (PR #4577) gave `formatMeasure` / `formatDimensionValue` in
 * `@object-ui/core` an OPTIONAL trailing `locale` and threaded
 * `useDisplayLocale()` from the dashboard's `DatasetWidget`. The parameter is
 * optional precisely so the producer could land without dragging every consumer
 * with it — which left this renderer's ten call sites still formatting in the
 * MACHINE's locale, beside a dashboard that had stopped doing so. This file
 * pins the report half of that channel.
 *
 * ── Why every case pins TWO locales ──────────────────────────────────────────
 * A lone de assertion is not falsifiable: on a German runner it would pass
 * before the fix too, because the machine locale would already be German. Every
 * case therefore pins the same value in de AND in en. Before the fix the
 * threaded tag is ignored, so BOTH render in the machine's locale and at least
 * one of the two must fail on ANY runner. That is the un-fakeable signal, and
 * it is the property the fix delivers: the machine locale stops being an input.
 *
 * ── Directions, predicted in writing BEFORE the run ──────────────────────────
 * Runner machine locale measured as en-US
 * (`new Intl.NumberFormat().resolvedOptions().locale`).
 *   every de case (tabular cell + dimension + total, currency,
 *   KPI chart, matrix down-axis / across header / cell /
 *   row total / column total / grand total)      RED pre-fix — renders the en form
 *   every en counterpart                         GREEN both sides — the
 *                                                byte-identity pins. en must NOT
 *                                                move on this card: these sites
 *                                                already grouped through `Intl`,
 *                                                so the only thing the fix
 *                                                changes is WHOSE locale is
 *                                                used. (Contrast objectui#4553,
 *                                                where `formatPercent` had never
 *                                                grouped and moving en WAS the
 *                                                fix.)
 *   the memo dep-isolation case                  RED pre-fix, and red again if
 *                                                the fix threads the locale but
 *                                                leaves it out of the `pivot`
 *                                                dep array — see its own note
 *   malformed-tag guard                          GREEN both sides — a guard,
 *                                                labelled as such, not a pin of
 *                                                the defect
 *
 * ⚠️ Malformed-tag SAFETY is the producer's job (#4577's `formatNumberInLocale`
 * retry) and is deliberately not re-implemented here. The single case below
 * only pins that a bad tag reaching this surface degrades instead of taking the
 * report down.
 *
 * ⚠️ The objectui#4487 flake lives in the sibling `DatasetReportRenderer.test.tsx`.
 * This file mounts the same component, so a red here is verified locally and
 * re-run before being owned.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { formatMeasure } from '@object-ui/core';
import { DatasetReportRenderer } from '../DatasetReportRenderer';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** German writes a NO-BREAK SPACE between the amount and the currency sign. */
const NBSP = '\u00a0';

/**
 * Testing Library's DEFAULT normalizer collapses whitespace runs to a plain
 * space, and U+00A0 is whitespace — so the German currency form would be
 * compared as if written with an ordinary space and the no-break space could
 * never be asserted. Trimming only keeps the byte the locale actually produces,
 * which is the whole point of the case (the objectui#4577 lesson).
 */
const KEEP_NBSP = { normalizer: (text: string) => text.trim() };

type Row = Record<string, unknown>;

const sourceOf = (result: unknown) => ({ queryDataset: vi.fn(async () => result) });

/**
 * `locale` on the LocalizationProvider is the tenant's resolved regional
 * default — channel 1 of `useDisplayLocale`, which outranks the UI language.
 *
 * The report element is passed IN and re-used verbatim across a `setLocale`
 * rerender: React bails out of re-rendering a child whose element identity is
 * unchanged, so only the components that actually consume the locale context
 * re-render. That is what makes the dep-isolation case below a real
 * measurement rather than a whole-tree repaint (see its note).
 */
function renderIn(locale: string | undefined, element: React.ReactElement, language = 'en') {
  const Tree = ({ loc }: { loc: string | undefined }) => (
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={loc ? { locale: loc } : {}}>{element}</LocalizationProvider>
    </I18nProvider>
  );
  const utils = render(<Tree loc={locale} />);
  return { ...utils, setLocale: (l: string) => utils.rerender(<Tree loc={l} />) };
}

// ─── The grouped (summary) table — sites 487 / 488 / 502 ──────────────────────

const TABLE_FIELDS = [
  { name: 'bucket', type: 'number', label: 'Bucket' },
  { name: 'revenue', type: 'number', label: 'Revenue', format: '0.0' },
];
// A fractional DIMENSION value alongside the measure, so `formatDimensionValue`
// is exercised at its own site and not merely inferred from the measure's.
const TABLE_RESULT = {
  rows: [{ bucket: 9876.5, revenue: 1234.5 }] as Row[],
  fields: TABLE_FIELDS,
  totals: [{ dimensions: [] as string[], rows: [{ revenue: 2469 }] }],
};
const SUMMARY_REPORT = {
  name: 'sales_summary',
  type: 'summary',
  dataset: 'sales',
  rows: ['bucket'],
  values: ['revenue'],
};

describe('report grouped table follows the display locale (objectui#4575)', () => {
  it('localizes the measure cell, the dimension cell and the totals row in a de session', async () => {
    renderIn(
      'de-DE',
      <DatasetReportRenderer report={SUMMARY_REPORT as never} dataSource={sourceOf(TABLE_RESULT)} />,
    );
    // site 487 — the measure cell
    expect(await screen.findByText('1.234,5')).toBeInTheDocument();
    // site 488 — the numeric dimension cell
    expect(screen.getByText('9.876,5')).toBeInTheDocument();
    // site 502 — the server-computed grand total
    expect(within(screen.getByTestId('dataset-report-total-row')).getByText('2.469,0')).toBeInTheDocument();
  });

  it('leaves the en session byte-identical (must-not-change)', async () => {
    renderIn(
      'en-US',
      <DatasetReportRenderer report={SUMMARY_REPORT as never} dataSource={sourceOf(TABLE_RESULT)} />,
    );
    expect(await screen.findByText('1,234.5')).toBeInTheDocument();
    expect(screen.getByText('9,876.5')).toBeInTheDocument();
    expect(within(screen.getByTestId('dataset-report-total-row')).getByText('2,469.0')).toBeInTheDocument();
  });

  it('places the currency sign the way the locale does, not the way en does', async () => {
    const result = {
      rows: [{ bucket: 1, revenue: 1234.5 }] as Row[],
      fields: [
        { name: 'bucket', type: 'number', label: 'Bucket' },
        { name: 'revenue', type: 'number', label: 'Revenue', format: '0.00', currency: 'EUR' },
      ],
    };
    renderIn(
      'de-DE',
      <DatasetReportRenderer report={SUMMARY_REPORT as never} dataSource={sourceOf(result)} />,
    );
    // German writes the sign LAST, separated by a no-break space.
    expect(await screen.findByText(`1.234,50${NBSP}€`, KEEP_NBSP)).toBeInTheDocument();
  });

  it('keeps the en currency form byte-identical (must-not-change)', async () => {
    const result = {
      rows: [{ bucket: 1, revenue: 1234.5 }] as Row[],
      fields: [
        { name: 'bucket', type: 'number', label: 'Bucket' },
        { name: 'revenue', type: 'number', label: 'Revenue', format: '0.00', currency: 'EUR' },
      ],
    };
    renderIn(
      'en-US',
      <DatasetReportRenderer report={SUMMARY_REPORT as never} dataSource={sourceOf(result)} />,
    );
    // English writes it FIRST, with no space at all.
    expect(await screen.findByText('€1,234.50', KEEP_NBSP)).toBeInTheDocument();
  });
});

// ─── The embedded single-value chart — site 737 ───────────────────────────────

const KPI_REPORT = {
  name: 'sales_kpi',
  type: 'tabular',
  dataset: 'sales',
  rows: [] as string[],
  // The table beneath selects no measures (it renders the "no measures" state),
  // so the only number on screen is the chart's — no ambiguous match.
  values: [] as string[],
  chart: { type: 'kpi', yAxis: 'revenue' },
};
const KPI_RESULT = {
  rows: [{ revenue: 1234.5 }] as Row[],
  fields: [{ name: 'revenue', type: 'number', label: 'Revenue', format: '0.0' }],
};

describe("report chart's single-value metric follows the display locale (objectui#4575)", () => {
  it('renders the German form in a de session', async () => {
    renderIn('de-DE', <DatasetReportRenderer report={KPI_REPORT as never} dataSource={sourceOf(KPI_RESULT)} />);
    const metric = await screen.findByTestId('dataset-report-metric');
    expect(within(metric).getByText('1.234,5')).toBeInTheDocument();
  });

  it('renders the English form unchanged in an en session (must-not-change)', async () => {
    renderIn('en-US', <DatasetReportRenderer report={KPI_REPORT as never} dataSource={sourceOf(KPI_RESULT)} />);
    const metric = await screen.findByTestId('dataset-report-metric');
    expect(within(metric).getByText('1,234.5')).toBeInTheDocument();
  });
});

// ─── The cross-tab — sites 792 / 980 / 994 / 1005 / 1019 / 1029 ───────────────

/**
 * Both axes carry FRACTIONAL dimension values so the across-axis header (built
 * by `bucketLabel` inside the `pivot` memo) and the down-axis cell (formatted in
 * the render body) are each observable, and every total is a distinct number so
 * no assertion can be satisfied by the wrong cell.
 */
const MATRIX_FIELDS = [
  { name: 'bucket', type: 'number', label: 'Bucket' },
  { name: 'quarter', type: 'number', label: 'Quarter' },
  { name: 'revenue', type: 'number', label: 'Revenue', format: '0.0' },
];
const MATRIX_RESULT = {
  rows: [{ bucket: 9876.5, quarter: 2468.5, revenue: 1234.5 }] as Row[],
  fields: MATRIX_FIELDS,
  totals: [
    { dimensions: ['bucket'], rows: [{ bucket: 9876.5, revenue: 1111.5 }] },
    { dimensions: ['quarter'], rows: [{ quarter: 2468.5, revenue: 2222.5 }] },
    { dimensions: [] as string[], rows: [{ revenue: 3333.5 }] },
  ],
};
const MATRIX_REPORT = {
  name: 'sales_matrix',
  type: 'matrix',
  dataset: 'sales',
  rows: ['bucket'],
  columns: ['quarter'],
  values: ['revenue'],
};

describe('report cross-tab follows the display locale (objectui#4575)', () => {
  it('localizes the across header, the down-axis cell, the cell and all three totals in a de session', async () => {
    renderIn('de-DE', <DatasetReportRenderer report={MATRIX_REPORT as never} dataSource={sourceOf(MATRIX_RESULT)} />);
    // site 792 (via `bucketLabel`, inside the `pivot` memo) — the across header
    expect(await screen.findByRole('columnheader', { name: '2.468,5' })).toBeInTheDocument();
    // site 980 — the down-axis dimension cell
    expect(screen.getByText('9.876,5')).toBeInTheDocument();
    // site 994 — the measure cell
    expect(screen.getByText('1.234,5')).toBeInTheDocument();
    // site 1005 — the row total (the "Total" COLUMN)
    expect(within(screen.getByTestId('matrix-row-total')).getByText('1.111,5')).toBeInTheDocument();
    // site 1019 — the column total (inside the "Total" ROW)
    expect(within(screen.getByTestId('matrix-total-row')).getByText('2.222,5')).toBeInTheDocument();
    // site 1029 — the grand total
    expect(within(screen.getByTestId('matrix-grand-total')).getByText('3.333,5')).toBeInTheDocument();
  });

  it('leaves the en session byte-identical (must-not-change)', async () => {
    renderIn('en-US', <DatasetReportRenderer report={MATRIX_REPORT as never} dataSource={sourceOf(MATRIX_RESULT)} />);
    expect(await screen.findByRole('columnheader', { name: '2,468.5' })).toBeInTheDocument();
    expect(screen.getByText('9,876.5')).toBeInTheDocument();
    expect(screen.getByText('1,234.5')).toBeInTheDocument();
    expect(within(screen.getByTestId('matrix-row-total')).getByText('1,111.5')).toBeInTheDocument();
    expect(within(screen.getByTestId('matrix-total-row')).getByText('2,222.5')).toBeInTheDocument();
    expect(within(screen.getByTestId('matrix-grand-total')).getByText('3,333.5')).toBeInTheDocument();
  });

  /**
   * ── The dependency-array case, and why it ISOLATES here ────────────────────
   * The across-axis header labels are built by `bucketLabel` INSIDE the `pivot`
   * `React.useMemo`, so threading the locale into the call is only half the fix:
   * without the locale in that memo's dependency array the header keeps the
   * labels it was first built with.
   *
   * Isolating that needs a locale change that does NOT also invalidate the
   * memo's other dependencies. `rows` / `columnsAcross` arrive as fresh arrays
   * from `readNames(...)` on every render of the PARENT, so a whole-tree repaint
   * would re-run the memo regardless and prove nothing. The harness therefore
   * re-uses one report ELEMENT across the rerender: React bails out on a child
   * whose element identity is unchanged, so the parent does not re-render, the
   * array props keep their identity, `useDatasetRows` does not refetch (its
   * effect is keyed on a signature the locale is not part of), and the only
   * dependency that moves is the locale itself.
   *
   * Measured, not assumed — the three states this case separates:
   *   pre-fix                                     RED (nothing is threaded)
   *   fix threaded but locale NOT in the deps     RED (header stays `2,468.5`)
   *   fix threaded and locale in the deps         GREEN
   * The middle state is what makes the dep entry load-bearing rather than
   * decorative, and it was run in both directions before this was committed.
   */
  it('re-labels the across header when only the locale changes (memo dependency)', async () => {
    const element = (
      <DatasetReportRenderer report={MATRIX_REPORT as never} dataSource={sourceOf(MATRIX_RESULT)} />
    );
    const { setLocale } = renderIn('en-US', element);
    expect(await screen.findByRole('columnheader', { name: '2,468.5' })).toBeInTheDocument();

    setLocale('de-DE');
    // The memo-built header — the assertion the dependency array owns.
    await waitFor(() => expect(screen.getByRole('columnheader', { name: '2.468,5' })).toBeInTheDocument());
    // The render-body cell, which would follow the locale even with a stale
    // memo — asserted so a future reader can tell the two apart.
    expect(screen.getByText('1.234,5')).toBeInTheDocument();
  });
});

// ─── Guard, not a defect pin ──────────────────────────────────────────────────

describe('locale-tag robustness (guard, not a defect pin)', () => {
  /**
   * ⚠️ HONEST LABELLING — GREEN on both sides of the fix, because before it the
   * tag was never passed and nothing could throw. It does not pin the #4575
   * defect; it pins that the hazard the threading introduces is contained. The
   * containment itself belongs to the producer (#4577's `formatNumberInLocale`
   * retries without the locale), so this asserts the SURFACE survives and
   * degrades to the producer's own no-locale output — deliberately not a
   * re-implementation of that retry, and machine-locale-independent because the
   * expected value is computed through the same function.
   */
  it('a malformed tenant locale tag degrades instead of taking the report down', async () => {
    renderIn(
      'en_US', // the likeliest tenant-config typo: underscore, not hyphen
      <DatasetReportRenderer report={SUMMARY_REPORT as never} dataSource={sourceOf(TABLE_RESULT)} />,
    );
    expect(await screen.findByText(formatMeasure(1234.5, '0.0'))).toBeInTheDocument();
    expect(screen.getByTestId('dataset-report-total-row')).toBeInTheDocument();
  });
});
