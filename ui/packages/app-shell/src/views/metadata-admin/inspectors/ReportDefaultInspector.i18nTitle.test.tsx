// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9274 — the report inspector's localizable text boxes must not
 * narrow an `I18nLabel` to a plain string on the way in, nor flatten the
 * stored locale map on the way out.
 *
 * `@objectstack/spec` (measured at 17.4.0, see the PR body) types
 * `ReportChartSchema.title` — and `ReportSchema.label` — as a union of a plain
 * string and an inline per-locale map. Against a stored map the two halves of
 * this inspector used to fail in OPPOSITE directions and amplify each other:
 *
 *   READ   `typeof chart.title === 'string' ? … : ''` fails the map arm, so
 *          Studio painted an EMPTY box over a report that has a title.
 *   WRITE  `{ ...chart, ...patch }` put the typed string in place of the WHOLE
 *          map, so every locale the author was not looking at was gone.
 *
 * ⭐ Every assertion about the write half reads the COMMITTED PATCH, never the
 * input box. The box looking right is the defect's own symptom — a pin that
 * only reads the input passes against the bug.
 *
 * ⭐ The plain-string arm is the LIT CONTROL: it must read identically before
 * and after the repair, which is what makes the rest of this file able to fail.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ReportDefaultInspector } from './ReportDefaultInspector';
import type { DatasetCatalogEntry } from '../previews/useDatasetCatalog';

afterEach(cleanup);

// Same module-scope fetch double as ReportDefaultInspector.test.tsx
// (objectui#7439 / #6640): `useDatasetSemantics` fires a relative-URL read that
// no test body awaits, so a per-test teardown would restore the real fetch
// while the tree is still mounted.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

const catalog: DatasetCatalogEntry[] = [
  {
    name: 'sales_metrics',
    label: 'Sales metrics',
    dimensions: [{ name: 'stage', type: 'text' }],
    measures: [{ name: 'total_amount', aggregate: 'sum' }],
  },
];

const baseProps = {
  type: 'report',
  name: 'pipeline',
  onSelectionChange: vi.fn(),
  datasetCatalogOverride: catalog,
};

function labelledInput(label: string): HTMLInputElement {
  const lab = screen.getByText(label);
  return lab.parentElement!.querySelector('input, textarea') as HTMLInputElement;
}

/** A report with a chart, so the curated Chart panel renders its Title box. */
function chartDraft(title: unknown) {
  return {
    name: 'pipeline',
    label: 'Pipeline',
    type: 'summary',
    dataset: 'sales_metrics',
    rows: ['stage'],
    values: ['total_amount'],
    chart: { type: 'bar', xAxis: 'stage', yAxis: 'total_amount', ...(title === undefined ? {} : { title }) },
  };
}

/** The `chart` object of the single patch this inspector committed. */
function committedChart(onPatch: ReturnType<typeof vi.fn>): Record<string, unknown> | undefined {
  expect(onPatch).toHaveBeenCalledTimes(1);
  const patch = onPatch.mock.calls[0][0] as { chart?: Record<string, unknown> };
  return patch.chart;
}

describe('objectui#9274 — chart Title: the READ half', () => {
  it('shows the ACTIVE locale entry of a map-valued title, not an empty box', () => {
    render(
      <ReportDefaultInspector
        {...baseProps}
        locale="en-US"
        draft={chartDraft({ en: 'Pricing', 'zh-CN': '定价' })}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    // On the base tree this is `''` — Studio paints the absence of what the
    // author stored. That empty box is what invites the destroying retype.
    expect(labelledInput('Chart title').value).toBe('Pricing');
  });

  it('follows the active locale — the same map under zh-CN reads the zh-CN entry', () => {
    render(
      <ReportDefaultInspector
        {...baseProps}
        locale="zh-CN"
        draft={chartDraft({ en: 'Pricing', 'zh-CN': '定价' })}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    expect(labelledInput('图表标题').value).toBe('定价');
  });

  it('LIT CONTROL — a plain-string title still reads verbatim', () => {
    render(
      <ReportDefaultInspector
        {...baseProps}
        locale="en-US"
        draft={chartDraft('Pricing')}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    expect(labelledInput('Chart title').value).toBe('Pricing');
  });
});

describe('objectui#9274 — chart Title: the WRITE half (asserted on the committed patch)', () => {
  it('an edit lands in the active locale entry and every other locale survives verbatim', () => {
    const onPatch = vi.fn();
    render(
      <ReportDefaultInspector
        {...baseProps}
        locale="en-US"
        draft={chartDraft({ en: 'Pricing', 'zh-CN': '定价', ja: '価格' })}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    fireEvent.change(labelledInput('Chart title'), { target: { value: 'Plans' } });

    // On the base tree the committed `title` is the bare string 'Plans' and
    // zh-CN / ja are gone. This is the unrecoverable half.
    expect(committedChart(onPatch)?.title).toEqual({ en: 'Plans', 'zh-CN': '定价', ja: '価格' });
  });

  it('an edit made under zh-CN cannot touch the English entry', () => {
    const onPatch = vi.fn();
    render(
      <ReportDefaultInspector
        {...baseProps}
        locale="zh-CN"
        draft={chartDraft({ en: 'Pricing', 'zh-CN': '定价' })}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    fireEvent.change(labelledInput('图表标题'), { target: { value: '套餐' } });
    expect(committedChart(onPatch)?.title).toEqual({ en: 'Pricing', 'zh-CN': '套餐' });
  });

  it('an author shown a DISPLAY FALLBACK cannot overwrite the locale it fell back to', () => {
    // `ja` has no entry, so the box shows the `en` string. Saving must ADD a
    // `ja` entry, never replace the English one it was only borrowing.
    const onPatch = vi.fn();
    render(
      <ReportDefaultInspector
        {...baseProps}
        locale={'ja' as unknown as 'en-US'}
        draft={chartDraft({ en: 'Pricing' })}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    const box = labelledInput('Chart title');
    expect(box.value).toBe('Pricing');
    fireEvent.change(box, { target: { value: '価格' } });
    expect(committedChart(onPatch)?.title).toEqual({ en: 'Pricing', ja: '価格' });
  });

  it('LIT CONTROL — editing a plain-string title still commits the bare string', () => {
    const onPatch = vi.fn();
    render(
      <ReportDefaultInspector
        {...baseProps}
        locale="en-US"
        draft={chartDraft('Pricing')}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    fireEvent.change(labelledInput('Chart title'), { target: { value: 'Plans' } });
    expect(committedChart(onPatch)?.title).toBe('Plans');
  });

  it('LIT CONTROL — a title-bearing chart keeps its other chart keys', () => {
    const onPatch = vi.fn();
    render(
      <ReportDefaultInspector
        {...baseProps}
        locale="en-US"
        draft={chartDraft('Pricing')}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    fireEvent.change(labelledInput('Chart title'), { target: { value: 'Plans' } });
    expect(committedChart(onPatch)).toMatchObject({ type: 'bar', xAxis: 'stage', yAxis: 'total_amount' });
  });
});

/**
 * ⭐ THE CLEARING RULING (objectui#9274, ruled in this PR — triage deliberately
 * did not rule it and forbade inheriting today's behaviour as the default).
 *
 * Clearing the box removes ONLY the active locale's entry. Sibling locales
 * survive. When that entry was the last one, the key is dropped entirely,
 * which is exactly what clearing a plain-string title does today.
 *
 * Rationale, pinned here so the next reader gets the reasoning with the
 * assertion: "clear" is the inverse of "type", and typing can only ever reach
 * the active locale's entry (`setLocalized` adds one rather than overwriting a
 * display fallback). Letting CLEAR delete the whole map would reopen, through
 * the clearing door, the exact hole this card closes on the typing door — a
 * single-locale author destroying locales they cannot even see.
 */
describe('objectui#9274 — chart Title: the CLEARING ruling', () => {
  it('clearing removes only the active locale entry; siblings survive', () => {
    const onPatch = vi.fn();
    render(
      <ReportDefaultInspector
        {...baseProps}
        locale="en-US"
        draft={chartDraft({ en: 'Pricing', 'zh-CN': '定价' })}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    fireEvent.change(labelledInput('Chart title'), { target: { value: '' } });
    expect(committedChart(onPatch)?.title).toEqual({ 'zh-CN': '定价' });
  });

  it('clearing the LAST entry drops the key entirely (chart itself survives)', () => {
    const onPatch = vi.fn();
    render(
      <ReportDefaultInspector
        {...baseProps}
        locale="en-US"
        draft={chartDraft({ en: 'Pricing' })}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    fireEvent.change(labelledInput('Chart title'), { target: { value: '' } });
    const chart = committedChart(onPatch)!;
    expect(chart.title).toBeUndefined();
    expect(chart).toMatchObject({ type: 'bar' });
  });

  it('clearing a DISPLAY FALLBACK is a refusal, not a deletion', () => {
    // Shown the `en` string under `ja`, clearing must not delete English.
    const onPatch = vi.fn();
    render(
      <ReportDefaultInspector
        {...baseProps}
        locale={'ja' as unknown as 'en-US'}
        draft={chartDraft({ en: 'Pricing' })}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    fireEvent.change(labelledInput('Chart title'), { target: { value: '' } });
    expect(committedChart(onPatch)?.title).toEqual({ en: 'Pricing' });
  });

  it('LIT CONTROL — clearing a plain-string title still drops the key', () => {
    const onPatch = vi.fn();
    render(
      <ReportDefaultInspector
        {...baseProps}
        locale="en-US"
        draft={chartDraft('Pricing')}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    fireEvent.change(labelledInput('Chart title'), { target: { value: '' } });
    expect(committedChart(onPatch)?.title).toBeUndefined();
  });
});

/**
 * The SIBLING measured on this surface (objectui#9274's must-check).
 *
 * The card named `chart.subtitle` / `chart.description`. Both are real in the
 * spec union but this inspector renders NO input for either (the curated Chart
 * panel offers type / title / X / Y, and `chart` is in SchemaForm's
 * `hiddenFields`), so neither has a write path to defend — see the PR body.
 *
 * The live sibling is the report's own top-level `label`: same union, same
 * inspector, same narrow-then-flatten shape, and REQUIRED on every report, so
 * strictly more reachable than `chart.title`.
 */
describe('objectui#9274 — the report `label` sibling: same union, same defect', () => {
  const mapLabelDraft = {
    name: 'pipeline',
    label: { en: 'Pipeline', 'zh-CN': '销售漏斗' },
    type: 'summary',
    dataset: 'sales_metrics',
    rows: ['stage'],
    values: ['total_amount'],
  };

  it('reads the active locale entry instead of an empty box', () => {
    render(
      <ReportDefaultInspector
        {...baseProps}
        locale="en-US"
        draft={mapLabelDraft}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    expect(labelledInput('Label').value).toBe('Pipeline');
  });

  it('an edit preserves every other locale (asserted on the committed patch)', () => {
    const onPatch = vi.fn();
    render(
      <ReportDefaultInspector
        {...baseProps}
        locale="en-US"
        draft={mapLabelDraft}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    fireEvent.change(labelledInput('Label'), { target: { value: 'Pipeline 2' } });
    expect(onPatch).toHaveBeenCalledWith({ label: { en: 'Pipeline 2', 'zh-CN': '销售漏斗' } });
  });

  it('clearing removes only the active locale entry', () => {
    const onPatch = vi.fn();
    render(
      <ReportDefaultInspector
        {...baseProps}
        locale="en-US"
        draft={mapLabelDraft}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    fireEvent.change(labelledInput('Label'), { target: { value: '' } });
    expect(onPatch).toHaveBeenCalledWith({ label: { 'zh-CN': '销售漏斗' } });
  });

  it('LIT CONTROL — a plain-string label still reads and commits verbatim', () => {
    const onPatch = vi.fn();
    render(
      <ReportDefaultInspector
        {...baseProps}
        locale="en-US"
        draft={{ ...mapLabelDraft, label: 'Pipeline' }}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    expect(labelledInput('Label').value).toBe('Pipeline');
    fireEvent.change(labelledInput('Label'), { target: { value: 'Pipeline 2' } });
    expect(onPatch).toHaveBeenCalledWith({ label: 'Pipeline 2' });
  });

  it('LIT CONTROL — clearing a plain-string label still commits the empty string', () => {
    const onPatch = vi.fn();
    render(
      <ReportDefaultInspector
        {...baseProps}
        locale="en-US"
        draft={{ ...mapLabelDraft, label: 'Pipeline' }}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    fireEvent.change(labelledInput('Label'), { target: { value: '' } });
    expect(onPatch).toHaveBeenCalledWith({ label: '' });
  });
});
