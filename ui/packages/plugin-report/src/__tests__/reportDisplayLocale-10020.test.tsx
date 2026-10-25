// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10020 — the five display sites in `@object-ui/plugin-report` that
 * handed `Intl` the literal tag `'en-US'` now format in the DISPLAY locale.
 *
 * The contract they contradicted is `useDisplayLocale` in `@object-ui/i18n`,
 * which names that exact tag as the wrong answer, verbatim:
 *
 *   > `'en'` — a concrete last resort rather than `undefined`. `undefined`
 *   > would hand `Intl` the *machine's* locale, which is invisible in review
 *   > and non-deterministic in CI; `'en'` at least fails the same way
 *   > everywhere. Note this is `'en'`, not `'en-US'`: the point of
 *   > objectui#4033 is that `en-US` is not the world's default.
 *
 * ⚠️ Two DIFFERENT defect shapes live in this package and must not be merged
 * (the card says so in as many words). This file pins the WRONG-TAG shape —
 * `'en-US'` passed explicitly, which is the same wrong answer on every machine.
 * The NO-TAG shape (a bare `toLocaleString()`, i.e. `undefined` to `Intl`, which
 * is the MACHINE's locale and non-deterministic in CI) is objectui#9909's, still
 * present in `../ReportExportEngine.ts`, and deliberately untouched here.
 *
 * ── Why every case pins TWO locales ──────────────────────────────────────────
 * A lone de assertion is not falsifiable on its own: on a German runner it would
 * pass before the fix too, because the machine locale would already be German.
 * Every case therefore pins the same value in de AND in en. Before the fix the
 * threaded tag is ignored, so BOTH render the US form and the de half must fail
 * on ANY runner. (The same construction as the sibling card's
 * `DatasetReportRenderer.measureLocale.test.tsx`.)
 *
 * ── Directions, predicted in writing BEFORE the run ──────────────────────────
 *   every de case (4 `formatValue` branches,
 *   `ReportViewer`'s 3 call sites, the Excel cell)   RED pre-fix — renders the
 *                                                    US form
 *   every en counterpart                             GREEN both sides — these
 *                                                    sites already grouped
 *                                                    through `Intl`, so the only
 *                                                    thing the fix changes is
 *                                                    WHOSE locale is used
 *   the `formatValue` default case                   Predicted green; MEASURED
 *                                                    RED, and the prediction was
 *                                                    the thing that was wrong —
 *                                                    its second assertion
 *                                                    contrasts the default
 *                                                    against de, and pre-fix the
 *                                                    de call does not move
 *                                                    either. Recorded as run,
 *                                                    not as planned.
 *   the Excel default case                           GREEN both sides
 *   the malformed-tag guard                          GREEN both sides — a guard,
 *                                                    labelled as such, not a pin
 *                                                    of the defect
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { formatValue } from '../formatValue';
import { ReportViewer } from '../ReportViewer';
import { exportExcelWithFormulas } from '../LiveReportExporter';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── 1. `formatValue` — the four number branches ─────────────────────────────

describe('formatValue formats in the threaded display locale (objectui#10020)', () => {
  const NUM = { name: 'n', type: 'number' } as never;
  const CNY = { name: 'n', type: 'number', format: 'currency' } as never;
  const USD = { name: 'n', type: 'number', format: 'currency_usd' } as never;
  const PCT = { name: 'n', type: 'number', format: 'percent' } as never;

  it('localizes the default thousands branch in a de session', () => {
    expect(formatValue(1234.5, NUM, 'de-DE')).toBe('1.234,5');
  });
  it('leaves the default thousands branch byte-identical in en (must-not-change)', () => {
    expect(formatValue(1234.5, NUM, 'en-US')).toBe('1,234.5');
  });

  it('localizes the currency / currency_cny branch in a de session', () => {
    expect(formatValue(1234567, CNY, 'de-DE')).toBe('¥1.234.567');
  });
  it('leaves the currency branch byte-identical in en (must-not-change)', () => {
    expect(formatValue(1234567, CNY, 'en-US')).toBe('¥1,234,567');
  });

  it('localizes the currency_usd branch in a de session', () => {
    expect(formatValue(1234567, USD, 'de-DE')).toBe('$1.234.567');
  });
  it('leaves the currency_usd branch byte-identical in en (must-not-change)', () => {
    expect(formatValue(1234567, USD, 'en-US')).toBe('$1,234,567');
  });

  it('localizes the percent branch in a de session', () => {
    expect(formatValue(1234.5, PCT, 'de-DE')).toBe('1.234,5%');
  });
  it('leaves the percent branch byte-identical in en (must-not-change)', () => {
    expect(formatValue(1234.5, PCT, 'en-US')).toBe('1,234.5%');
  });

  /**
   * The parameter is OPTIONAL, so its DEFAULT is a contract decision of its own:
   * it is `'en'`, the last resort `useDisplayLocale` itself falls back to, and
   * it may be neither `'en-US'` (the tag this card removes) nor `undefined`
   * (which means the MACHINE's locale — objectui#9909's shape).
   *
   * ⚠️ What this case can and cannot distinguish, stated rather than implied:
   * `'en'` and `'en-US'` produce byte-identical numbers, so on ANY runner this
   * assertion cannot tell those two apart — the source literal and its comment
   * are what carry that half. What it DOES falsify, on a non-en runner, is a
   * default of `undefined`: the machine locale would then reach `Intl` and the
   * omitted-argument call would stop agreeing with the explicit `'en'` one.
   */
  it('defaults to the contract last resort, which is not the machine locale', () => {
    expect(formatValue(1234.5, NUM)).toBe(formatValue(1234.5, NUM, 'en'));
    expect(formatValue(1234.5, NUM)).not.toBe(formatValue(1234.5, NUM, 'de-DE'));
  });

  /**
   * GUARD, not a pin of the defect — green before and after.
   *
   * It exists because the fix CREATES the hazard it guards: a hard-coded
   * `'en-US'` can never be malformed, while a THREADED tag arrives from tenant
   * configuration (ADR-0053) and `'en_US'` — underscore, the likeliest typo —
   * makes `Intl` throw `RangeError`. Uncaught, that throw is inside a cell
   * render and takes the whole report down. The degradation is to the contract's
   * own last resort rather than to `undefined`, because dropping the tag is the
   * other wrong answer this card must not introduce.
   */
  it('degrades a malformed tag to the last resort instead of throwing', () => {
    expect(() => formatValue(1234.5, NUM, 'en_US')).not.toThrow();
    expect(formatValue(1234.5, NUM, 'en_US')).toBe(formatValue(1234.5, NUM, 'en'));
  });
});

// ─── 2. `ReportViewer` — all three in-repo call sites ────────────────────────

/**
 * `locale` on the LocalizationProvider is the tenant's resolved regional
 * default — channel 1 of `useDisplayLocale`, which outranks the UI language.
 */
function renderIn(locale: string, element: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>{element}</LocalizationProvider>
    </I18nProvider>,
  );
}

/**
 * One schema that reaches all THREE `formatValue` call sites in `ReportViewer`,
 * each with a distinct value so `getByText` addresses them one at a time:
 *
 *   `agg`     — a column carrying `aggregation`, which returns from the
 *               aggregation arm of `renderCellValue`
 *   `plain`   — a column with neither `type` nor `aggregation`, which falls past
 *               the cell-renderer registry to the trailing arm
 *   `revenue` — the summary card, which formats `computeReportAggregation`
 */
const VIEWER_SCHEMA: any = {
  type: 'report-viewer',
  showToolbar: false,
  allowExport: false,
  allowPrint: false,
  data: [{ agg: 1234.5, plain: 9876.5, revenue: 2468.5 }],
  report: {
    title: 'T',
    fields: [{ name: 'revenue', label: 'Revenue', showInSummary: true, aggregation: 'sum' }],
    sections: [
      {
        type: 'table',
        title: 'Details',
        columns: [
          { name: 'agg', label: 'Agg', aggregation: 'sum' },
          { name: 'plain', label: 'Plain' },
        ],
      },
      { type: 'summary', title: 'Summary' },
    ],
  },
};

describe('ReportViewer passes a resolved display locale at every call site (objectui#10020)', () => {
  it('localizes the aggregation cell, the untyped cell and the summary card in a de session', () => {
    renderIn('de-DE', <ReportViewer schema={VIEWER_SCHEMA} />);
    expect(screen.getByText('1.234,5')).toBeInTheDocument(); // aggregation arm
    expect(screen.getByText('9.876,5')).toBeInTheDocument(); // trailing arm
    expect(screen.getByText('2.468,5')).toBeInTheDocument(); // summary card
  });

  it('leaves the en session byte-identical (must-not-change)', () => {
    renderIn('en-US', <ReportViewer schema={VIEWER_SCHEMA} />);
    expect(screen.getByText('1,234.5')).toBeInTheDocument();
    expect(screen.getByText('9,876.5')).toBeInTheDocument();
    expect(screen.getByText('2,468.5')).toBeInTheDocument();
  });
});

// ─── 3. `exportExcelWithFormulas` — the non-component site ───────────────────

/**
 * `LiveReportExporter` is not a component and has no hook to read, so its locale
 * can only come from its CALLER — an optional `locale` on the options bag the
 * function already takes. The spreadsheet is delivered through a transient
 * download anchor, so the Blob handed to `URL.createObjectURL` is the only place
 * the formatted cell is observable.
 */
const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;
let captured: Blob | null = null;

beforeAll(() => {
  URL.createObjectURL = ((blob: Blob) => {
    captured = blob;
    return 'blob:stub';
  }) as never;
  URL.revokeObjectURL = (() => undefined) as never;
});

afterAll(() => {
  URL.createObjectURL = realCreateObjectURL;
  URL.revokeObjectURL = realRevokeObjectURL;
});

describe('exportExcelWithFormulas formats cells in the caller-supplied locale (objectui#10020)', () => {
  const REPORT: any = { title: 'R', fields: [] };
  const ROWS = [{ amount: 1234.5 }];
  const COLUMNS = [{ name: 'amount', header: 'Amount', numberFormat: '#,##0.00' }];

  beforeEach(() => {
    captured = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  async function tsvFor(options: Record<string, unknown>): Promise<string> {
    exportExcelWithFormulas(REPORT, ROWS, { columns: COLUMNS, ...options } as never);
    expect(captured).not.toBeNull();
    return await (captured as unknown as Blob).text();
  }

  it('writes the de form when the caller passes a de locale', async () => {
    expect(await tsvFor({ locale: 'de-DE' })).toContain('1.234,50');
  });

  it('writes the en form byte-identically when the caller passes en (must-not-change)', async () => {
    expect(await tsvFor({ locale: 'en-US' })).toContain('1,234.50');
  });

  it('defaults to the contract last resort when the caller passes nothing', async () => {
    expect(await tsvFor({})).toBe(await tsvFor({ locale: 'en' }));
  });
});
