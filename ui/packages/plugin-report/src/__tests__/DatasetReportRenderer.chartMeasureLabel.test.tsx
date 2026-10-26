// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4020 — a report chart printed the raw dataset measure `name` where
 * the summary table beneath it, and a dashboard chart over the same dataset,
 * both printed the authored `label`.
 *
 * The renderer handed the chart component `series: [{ dataKey: yAxis }]`: no
 * label at all. `ChartRenderer` then fills `config[dataKey].label` with the
 * dataKey itself, so the legend, the mark's tooltip name and (on a single-value
 * family) the caption all read `potential_upside_tons` under a fully-translated
 * console. The authored `chart.series[].label` — declared by
 * `ReportChartSchema` since rc.1 — never reached the chart either, which is why
 * the card's reporter measured it as inert metadata.
 *
 * The resolution these cases pin, highest first:
 *   ① `chart.series[]`'s entry naming the measure,
 *   ② the bound dataset's measure label (the result field's `label`),
 *   ③ the measure `name`.
 *
 * DIRECTIONS, written before the reverse verification was run. "Revert it and
 * watch them go red" is ambiguous here, because there are two different ways to
 * take the resolution away and they do NOT move the same case — so both were
 * predicted, then run, and both matched:
 *
 *  - **name直读** (`measureLabel = yAxis`): 9 red, 1 green. The survivor is ③,
 *    and necessarily so — reading the name directly COINCIDES with level ③, so
 *    that case cannot distinguish the two. Every failure printed
 *    `potential_upside_tons`, i.e. the card's reported symptom verbatim.
 *  - **the exact pre-change lines** (`series: [{ dataKey }]`, caption
 *    `headerLabel(yAxis)`): 9 red, 1 green — a DIFFERENT survivor. ③ goes red
 *    here (the forwarded series carried no `label` key at all, so it is
 *    `undefined`, not the name), and the green one is "a kpi caption still
 *    falls back to the dataset measure label" — measured `'120可抢吨位(吨)'`.
 *    That is not a weak case; it is the record that the single-value branch
 *    already resolved ② and ③ before this change, and that ① was the only level
 *    missing there. The series branch resolved none of the three.
 *
 * So ③'s job is not "red before": it is the guard that the last resort still
 * lands on the NAME and did not become `undefined` or `[object Object]` — a
 * failure ① and ② cannot see, and the one the pre-change code actually had.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { DatasetReportRenderer } from '../DatasetReportRenderer';

/** The card's own dataset: a measure whose authored label is Chinese. */
const RESULT = {
  rows: [
    { account_name: 'Acme', potential_upside_tons: 120 },
    { account_name: 'Globex', potential_upside_tons: 80 },
  ],
  fields: [
    { name: 'account_name', type: 'string', label: '客户名称' },
    { name: 'potential_upside_tons', type: 'number', label: '可抢吨位(吨)' },
  ],
};

/** The same result with NO field labels — the level ③ shape. */
const UNLABELLED = {
  rows: RESULT.rows,
  fields: [
    { name: 'account_name', type: 'string' },
    { name: 'potential_upside_tons', type: 'number' },
  ],
};

const sourceOf = (result: unknown) => ({ queryDataset: vi.fn(async () => result) });

/** Props the registered chart component was handed, or `null` if never called. */
let captured: { schema: Record<string, any> } | null = null;

beforeEach(() => {
  captured = null;
  ComponentRegistry.register('chart', (props: any) => {
    captured = props;
    return null;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The label the chart component is asked to paint for the plotted measure. */
async function chartSeriesLabel(report: Record<string, unknown>, result: unknown = RESULT) {
  render(<DatasetReportRenderer report={report as never} dataSource={sourceOf(result) as never} />);
  await waitFor(() => expect(captured?.schema?.series?.[0]?.dataKey).toBe('potential_upside_tons'));
  return captured!.schema.series[0].label;
}

const BASE = {
  name: 'heimao_key_account_attack_list',
  type: 'tabular',
  dataset: 'heimao_account_metrics',
  rows: ['account_name'],
  values: ['potential_upside_tons'],
};

describe('report chart measure label — three levels (objectui#4020)', () => {
  it('① an authored chart.series[].label naming the measure wins', async () => {
    // The card measured this exact metadata as inert: authored, rebuilt,
    // restarted, still `potential_upside_tons` on the axis.
    const label = await chartSeriesLabel({
      ...BASE,
      chart: {
        type: 'horizontal-bar',
        xAxis: 'account_name',
        yAxis: 'potential_upside_tons',
        series: [{ name: 'potential_upside_tons', label: '本季可抢吨位' }],
      },
    });
    // Beats the dataset's own label, which is a DIFFERENT string here on
    // purpose: a per-chart override that merely agreed with the dataset would
    // pass whether or not it was read.
    expect(label).toBe('本季可抢吨位');
  });

  it('② with no series authored, the dataset measure label is the default', async () => {
    const label = await chartSeriesLabel({
      ...BASE,
      chart: { type: 'horizontal-bar', xAxis: 'account_name', yAxis: 'potential_upside_tons' },
    });
    expect(label).toBe('可抢吨位(吨)');
  });

  it('③ with neither, the measure name is the last resort', async () => {
    const label = await chartSeriesLabel(
      { ...BASE, chart: { type: 'horizontal-bar', xAxis: 'account_name', yAxis: 'potential_upside_tons' } },
      UNLABELLED,
    );
    expect(label).toBe('potential_upside_tons');
  });

  it('a series entry naming ANOTHER measure does not relabel this one', async () => {
    // Membership belongs to the report's `values`/`yAxis`; an authored entry
    // that names something else is presentation for a series this chart does
    // not plot, and must not leak onto the one it does.
    const label = await chartSeriesLabel({
      ...BASE,
      chart: {
        type: 'horizontal-bar',
        xAxis: 'account_name',
        yAxis: 'potential_upside_tons',
        series: [{ name: 'shipped_volume_tons', label: '发货量(吨)' }],
      },
    });
    expect(label).toBe('可抢吨位(吨)');
  });

  it('an entry naming the measure with no usable label falls through to ②', async () => {
    const label = await chartSeriesLabel({
      ...BASE,
      chart: {
        type: 'horizontal-bar',
        xAxis: 'account_name',
        yAxis: 'potential_upside_tons',
        series: [{ name: 'potential_upside_tons' }],
      },
    });
    expect(label).toBe('可抢吨位(吨)');
  });

  it('the FIRST entry naming the measure wins over a later duplicate', async () => {
    const label = await chartSeriesLabel({
      ...BASE,
      chart: {
        type: 'horizontal-bar',
        xAxis: 'account_name',
        yAxis: 'potential_upside_tons',
        series: [
          { name: 'potential_upside_tons', label: '第一次' },
          { name: 'potential_upside_tons', label: '第二次' },
        ],
      },
    });
    expect(label).toBe('第一次');
  });
});

describe('report chart measure label — one measure, one string, one screen', () => {
  it('the chart series and the summary-table header read the SAME label', async () => {
    // The card's diagnosis in one assertion: the two elements sit on one
    // screen, over one measure, and disagreed.
    render(
      <DatasetReportRenderer
        report={
          {
            ...BASE,
            chart: { type: 'horizontal-bar', xAxis: 'account_name', yAxis: 'potential_upside_tons' },
          } as never
        }
        dataSource={sourceOf(RESULT) as never}
      />,
    );
    await waitFor(() => expect(captured?.schema?.series?.[0]?.label).toBeTruthy());
    const headers = (await screen.findAllByRole('columnheader')).map((th) => th.textContent);
    expect(headers).toContain('可抢吨位(吨)');
    expect(captured!.schema.series[0].label).toBe('可抢吨位(吨)');
    // And the raw name is nowhere on the screen the chart component paints.
    expect(headers).not.toContain('potential_upside_tons');
  });
});

describe('report chart measure label — an i18n label record picks the console language', () => {
  it('resolves the zh limb of an authored { en, zh-CN } series label', async () => {
    // `ReportChartSchema.series[].label` is the spec's I18nLabel, so the record
    // form is as authorable as the string one. Resolving it "first string wins"
    // would paint the English limb on a zh console — the defect class this card
    // closes, reintroduced by the fix.
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: { zh: {} } }}>
        <DatasetReportRenderer
          report={
            {
              ...BASE,
              chart: {
                type: 'horizontal-bar',
                xAxis: 'account_name',
                yAxis: 'potential_upside_tons',
                series: [
                  { name: 'potential_upside_tons', label: { en: 'Upside (t)', 'zh-CN': '可抢吨位' } },
                ],
              },
            } as never
          }
          dataSource={sourceOf(RESULT) as never}
        />
      </I18nProvider>,
    );
    await waitFor(() => expect(captured?.schema?.series?.[0]?.label).toBeTruthy());
    expect(captured!.schema.series[0].label).toBe('可抢吨位');
  });
});

describe('report chart measure label — the single-value families take the same resolution', () => {
  it('a kpi caption honours the authored series label over the dataset one', async () => {
    // `metric`/`kpi`/`gauge` render the measure as a number with its display
    // name beneath; that caption resolved ② and ③ already and skipped ①. One
    // resolution now serves both branches, so the two cannot drift.
    render(
      <DatasetReportRenderer
        report={
          {
            ...BASE,
            chart: {
              type: 'kpi',
              yAxis: 'potential_upside_tons',
              series: [{ name: 'potential_upside_tons', label: '本季可抢吨位' }],
            },
          } as never
        }
        dataSource={sourceOf(RESULT) as never}
      />,
    );
    const metric = await screen.findByTestId('dataset-report-metric');
    expect(metric.textContent).toContain('本季可抢吨位');
    expect(metric.textContent).not.toContain('potential_upside_tons');
  });

  it('a kpi caption still falls back to the dataset measure label', async () => {
    render(
      <DatasetReportRenderer
        report={{ ...BASE, chart: { type: 'kpi', yAxis: 'potential_upside_tons' } } as never}
        dataSource={sourceOf(RESULT) as never}
      />,
    );
    const metric = await screen.findByTestId('dataset-report-metric');
    expect(metric.textContent).toContain('可抢吨位(吨)');
  });
});
