// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5425 (rendering half of objectstack#10292, maintainer ruling
 * 2026-08-20) — a dashboard's dimension MEMBERS must resolve through the
 * backing picklist field's declared options, and therefore through that
 * field's translations; the prettified enum stays a fallback for genuinely
 * free-form columns only. And one stored value must not appear under two
 * spellings on one dashboard.
 *
 * ## What this file is, and why it is a pin rather than a fix
 *
 * The card was measured on **17.1.0**. Re-measured on `main` (17.6.0) the
 * reported rendering no longer reproduces: the analytics label net shipped in
 * **17.5.0** (objectui#4030 / PR #4324 for charts and dotted dimensions,
 * objectui#4330 for local selects on table/pivot, objectui#4389 lifting the
 * shared glue) already routes every non-metric dataset dimension through
 * `resolveDimensionFieldMeta` → `buildDimensionLabelMap` → `relabelDimensions`
 * with the locale bundle applied. Both of the card's defects are consequences
 * of that net being absent, so both went with it.
 *
 * What did NOT exist was a test stated in the card's own terms — the four
 * measured widgets, their measured member values, in a zh-CN session — so
 * nothing would have failed if the net regressed. That is what this file adds.
 * It is a characterization pin, and its ablation is recorded below.
 *
 * ## Provenance of the two spellings the card measured
 *
 * The card reports `NeedsAnalysis` on the bar axis and `Needs Analysis` in the
 * pivot row label and calls them "two prettifiers". Run over the card's own
 * stored value, that is exactly what the two functions `git grep` finds do:
 *
 *   humanizeLabel     ('NeedsAnalysis') → 'NeedsAnalysis'   ← plugin-charts/ObjectChart.tsx
 *   humanizeFieldKey  ('NeedsAnalysis') → 'Needs Analysis'  ← plugin-dashboard/utils.ts
 *
 * `humanizeLabel` maps `[_-]` to spaces and title-cases word boundaries, so a
 * PascalCase stored value passes through untouched; `humanizeFieldKey` also
 * splits camelCase, so the same value gains a space. Neither is reachable from
 * a dataset dimension member today — the dataset path prettifies nothing, it
 * relabels through the option map and otherwise renders the value as stored —
 * which is why the two spellings cannot recur on this surface. The residual
 * disagreement between those functions is a HEADER-family concern and is
 * pinned separately in `ObjectDataTable.headerSpelling.test.tsx`.
 *
 * ## DIRECTIONS, written before the ablation was run
 *
 * These assertions pin behaviour that already exists, so they are GREEN on
 * unmodified `main` — that is the finding, not a defect in the pins. To show
 * they are load-bearing rather than phantom, the ablation removes the locale
 * seam at its single wiring point in `DatasetWidget` (passing `undefined` for
 * `fieldOptionLabel` into `deriveDimensionLabelMaps`). Predicted: every zh-CN
 * member assertion turns RED and reads the object's authored English label —
 * the exact 17.1.0 symptom — while the free-form fallback pin and the
 * bar/pivot agreement pin stay GREEN, because neither depends on the bundle.
 *
 * Measured: the four zh-CN member pins went RED as predicted, and so did the
 * bar/pivot agreement pin — a SEQUENCING dependency, not an assertion one, and
 * this line is the correction rather than a re-run to fit the sentence. That
 * pin captures the axis spelling by first waiting for the translated category,
 * so it needs the bundle to get past its `waitFor` even though the property it
 * asserts (the two surfaces agree) is direction-independent. The pin below it
 * is the direction-independent twin: it agrees over a FREE-FORM value, waits on
 * no translation, and stayed GREEN in both legs — which is what shows the
 * agreement itself does not rest on a bundle entry existing. The two remaining
 * boundaries (free-form fallback, `en` session) stayed GREEN as predicted.
 *
 * No `dist/` is involved: the root `vitest.config.mts` aliases every
 * `@object-ui/*` specifier to that package's `src/`, and this file imports
 * `../DatasetWidget` relatively, so both ablation legs read source directly.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { DatasetWidget } from '../DatasetWidget';

/** Capture what the widget hands the chart renderer (jsdom lays out no SVG). */
let capturedChartProps: any = null;
beforeAll(() => {
  ComponentRegistry.register('chart', (props: any) => {
    capturedChartProps = props;
    return null;
  });
});

vi.mock('../DrillDownDrawer', () => ({ DrillDownDrawer: () => null }));

afterEach(() => {
  cleanup();
  capturedChartProps = null;
  vi.restoreAllMocks();
});

/**
 * The card's object, carrying the four dimensions its four widgets group by.
 *
 * Two storage conventions are represented deliberately, because the card's
 * measurement contains both: `stage` / `forecast_category` store an opaque
 * PascalCase code whose authored label differs from it, while `lead_source` /
 * `loss_reason` store the display string itself. `buildDimensionLabelMap` keys
 * the map by BOTH the stored value and the authored label, so the same net has
 * to serve both — and a regression that only handled one would slip past a
 * fixture that only contained one.
 */
const OPPORTUNITY = {
  name: 'crm_opportunity',
  fields: {
    stage: {
      type: 'select',
      options: [
        { value: 'NeedsAnalysis', label: 'Needs Analysis' },
        { value: 'Negotiation', label: 'Negotiation' },
        { value: 'Proposal', label: 'Proposal' },
      ],
    },
    forecast_category: {
      type: 'select',
      options: [
        { value: 'BestCase', label: 'Best Case' },
        { value: 'Commit', label: 'Commit' },
      ],
    },
    lead_source: {
      type: 'select',
      options: [
        { value: 'Content / Blog', label: 'Content / Blog' },
        { value: 'Email Campaign', label: 'Email Campaign' },
        { value: 'Event / Trade Show', label: 'Event / Trade Show' },
        { value: 'Partner', label: 'Partner' },
        { value: 'Referral', label: 'Referral' },
        { value: 'Web', label: 'Web' },
      ],
    },
    loss_reason: {
      type: 'select',
      options: [
        { value: 'Bad Timing', label: 'Bad Timing' },
        { value: 'Lost to Competitor', label: 'Lost to Competitor' },
        { value: 'Missing Features', label: 'Missing Features' },
        { value: 'No Budget', label: 'No Budget' },
        { value: 'Price Too High', label: 'Price Too High' },
      ],
    },
    /** A genuinely free-form column: no options, so nothing to resolve through. */
    owner_note: { type: 'text' },
    owner: { type: 'text' },
  },
};

/**
 * The zh-CN bundle, on the one channel list, form and kanban surfaces already
 * read select options through: `{ns}.fieldOptions.<object>.<field>.<value>`.
 * `fields` sits beside it because that is what makes `crm` discoverable as an
 * app namespace.
 */
const ZH_BUNDLE = {
  zh: {
    crm: {
      fields: {
        crm_opportunity: {
          stage: '阶段',
          forecast_category: '预测类别',
          lead_source: '线索来源',
          loss_reason: '丢单原因',
        },
      },
      fieldOptions: {
        crm_opportunity: {
          stage: { NeedsAnalysis: '需求分析', Negotiation: '谈判', Proposal: '提案' },
          forecast_category: { BestCase: '最佳情况', Commit: '承诺' },
          lead_source: {
            'Content / Blog': '内容 / 博客',
            'Email Campaign': '邮件营销',
            'Event / Trade Show': '活动 / 展会',
            Partner: '合作伙伴',
            Referral: '推荐',
            Web: '网站',
          },
          loss_reason: {
            'Bad Timing': '时机不合适',
            'Lost to Competitor': '输给竞争对手',
            'Missing Features': '功能缺失',
            'No Budget': '预算不足',
            'Price Too High': '价格过高',
          },
        },
      },
    },
  },
};

function installMetaRouter(docs: Record<string, unknown>) {
  const requested: string[] = [];
  global.fetch = vi.fn(async (input: unknown) => {
    const m = /\/api\/v1\/meta\/object\/(.+)$/.exec(String(input));
    const name = m ? decodeURIComponent(m[1]) : '';
    requested.push(name);
    const doc = docs[name];
    if (!doc) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({ item: doc }) };
  }) as any;
  return { requested };
}

const sourceOf = (result: unknown) => ({ queryDataset: vi.fn(async () => result) });

function renderIn(language: string, ui: React.ReactElement) {
  return render(
    <I18nProvider
      config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: ZH_BUNDLE }}
    >
      {ui}
    </I18nProvider>,
  );
}

/** A one-dimension bar widget over `dim`, with rows keyed by `values`. */
function barOver(dim: string, values: string[]) {
  return {
    widget: { type: 'bar', dataset: 'sales', dimensions: [dim], values: ['opp_count'] },
    dataSource: sourceOf({
      rows: values.map((v, i) => ({ [dim]: v, opp_count: i + 1 })),
      fields: [
        // `type: 'string'` deliberately: that is what a select dimension is on
        // the wire — `AnalyticsResult.fields[]` has no `select` member.
        { name: dim, type: 'string', label: dim },
        { name: 'opp_count', type: 'number', label: 'Opportunities' },
      ],
      object: 'crm_opportunity',
      dimensionFields: { [dim]: dim },
    }),
  };
}

/** The categories the widget handed the chart renderer, in order. */
const categories = (dim: string): string[] =>
  (capturedChartProps?.schema?.data ?? []).map((r: any) => r[dim]);

describe('objectui#5425 — the four measured dashboards render translated picklist labels', () => {
  it('阶段管道分布 — an opaque stored code resolves through the option label', async () => {
    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    const { widget, dataSource } = barOver('stage', ['NeedsAnalysis', 'Negotiation', 'Proposal']);
    renderIn('zh', <DatasetWidget widget={widget} dataSource={dataSource} />);

    await waitFor(() => expect(categories('stage')).toEqual(['需求分析', '谈判', '提案']));
    // The card's measured spelling must not survive beside the translation.
    expect(categories('stage')).not.toContain('NeedsAnalysis');
  });

  it('预测类别管道分布 — same, on the second opaque-code dimension', async () => {
    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    const { widget, dataSource } = barOver('forecast_category', ['BestCase', 'Commit']);
    renderIn('zh', <DatasetWidget widget={widget} dataSource={dataSource} />);

    await waitFor(() => expect(categories('forecast_category')).toEqual(['最佳情况', '承诺']));
    expect(categories('forecast_category')).not.toContain('BestCase');
  });

  it('线索来源分布 — a value stored AS its display string still translates', async () => {
    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    const { widget, dataSource } = barOver('lead_source', [
      'Content / Blog',
      'Email Campaign',
      'Event / Trade Show',
      'Partner',
      'Referral',
      'Web',
    ]);
    renderIn('zh', <DatasetWidget widget={widget} dataSource={dataSource} />);

    await waitFor(() =>
      expect(categories('lead_source')).toEqual([
        '内容 / 博客',
        '邮件营销',
        '活动 / 展会',
        '合作伙伴',
        '推荐',
        '网站',
      ]),
    );
  });

  it('丢单原因分析 — same, on the fourth measured dimension', async () => {
    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    const { widget, dataSource } = barOver('loss_reason', [
      'Bad Timing',
      'Lost to Competitor',
      'Missing Features',
      'No Budget',
      'Price Too High',
    ]);
    renderIn('zh', <DatasetWidget widget={widget} dataSource={dataSource} />);

    await waitFor(() =>
      expect(categories('loss_reason')).toEqual([
        '时机不合适',
        '输给竞争对手',
        '功能缺失',
        '预算不足',
        '价格过高',
      ]),
    );
    expect(document.body.textContent).not.toContain('Lost to Competitor');
  });

  it('BOUNDARY — a genuinely free-form column keeps the value as stored', async () => {
    // The card's own carve-out: the fallback survives for columns with no
    // declared options. Green in both ablation legs — it never consults the
    // bundle — which is what makes it a boundary rather than a restatement.
    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    const { widget, dataSource } = barOver('owner_note', ['renewal risk', 'needs_analysis']);
    renderIn('zh', <DatasetWidget widget={widget} dataSource={dataSource} />);

    await waitFor(() =>
      expect(categories('owner_note')).toEqual(['renewal risk', 'needs_analysis']),
    );
  });

  it('BOUNDARY — an `en` session keeps the object`s authored labels', async () => {
    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    const { widget, dataSource } = barOver('stage', ['NeedsAnalysis', 'Negotiation']);
    renderIn('en', <DatasetWidget widget={widget} dataSource={dataSource} />);

    await waitFor(() => expect(categories('stage')).toEqual(['Needs Analysis', 'Negotiation']));
    expect(document.body.textContent).not.toContain('需求分析');
  });
});

describe('objectui#5425 — one stored value, ONE spelling across bar axis and pivot header', () => {
  /**
   * The card's second defect, stated as the property it asks for. The two
   * surfaces are fed the value in the two shapes they really receive it in:
   * the chart query returns the dimension UNRESOLVED (the stored code), while
   * a table/pivot query returns it SERVER-RESOLVED to the object's authored
   * English label (ADR-0021). Those are the two inputs that produced the card's
   * two spellings; they must now produce one.
   */
  const STORED = 'NeedsAnalysis';
  const SERVER_RESOLVED = 'Needs Analysis';

  it('the bar axis and the pivot header agree on the same stored value', async () => {
    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    const { widget, dataSource } = barOver('stage', [STORED]);
    renderIn('zh', <DatasetWidget widget={widget} dataSource={dataSource} />);
    await waitFor(() => expect(categories('stage')).toEqual(['需求分析']));
    const axisSpelling = categories('stage')[0];
    cleanup();

    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    renderIn(
      'zh',
      <DatasetWidget
        widget={{
          type: 'pivot',
          dataset: 'sales',
          dimensions: ['owner', 'stage'],
          values: ['opp_count'],
        }}
        dataSource={sourceOf({
          rows: [{ owner: 'Dev Admin', stage: SERVER_RESOLVED, opp_count: 5 }],
          fields: [
            { name: 'owner', type: 'string', label: 'Owner' },
            { name: 'stage', type: 'string', label: 'Stage' },
            { name: 'opp_count', type: 'number', label: 'Opportunities' },
          ],
          object: 'crm_opportunity',
          dimensionFields: { owner: 'owner', stage: 'stage' },
        })}
      />,
    );

    await waitFor(() => expect(document.body.textContent).toContain(axisSpelling));
    // Neither of the card's two measured spellings may reach the screen.
    expect(document.body.textContent).not.toContain(SERVER_RESOLVED);
    expect(document.body.textContent).not.toContain(STORED);
  });

  it('BOUNDARY — a free-form value also gets ONE spelling on both surfaces', async () => {
    // Green in both ablation legs. The point is that the agreement does not
    // depend on a bundle entry existing: with no options to resolve through,
    // BOTH surfaces render the value as stored — neither prettifies it, which
    // is why `NeedsAnalysis` vs `Needs Analysis` cannot recur here.
    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    const { widget, dataSource } = barOver('owner_note', ['needs_analysis']);
    renderIn('zh', <DatasetWidget widget={widget} dataSource={dataSource} />);
    await waitFor(() => expect(categories('owner_note')).toEqual(['needs_analysis']));
    cleanup();

    installMetaRouter({ crm_opportunity: OPPORTUNITY });
    renderIn(
      'zh',
      <DatasetWidget
        widget={{
          type: 'pivot',
          dataset: 'sales',
          dimensions: ['owner', 'owner_note'],
          values: ['opp_count'],
        }}
        dataSource={sourceOf({
          rows: [{ owner: 'Dev Admin', owner_note: 'needs_analysis', opp_count: 5 }],
          fields: [
            { name: 'owner', type: 'string', label: 'Owner' },
            { name: 'owner_note', type: 'string', label: 'Note' },
            { name: 'opp_count', type: 'number', label: 'Opportunities' },
          ],
          object: 'crm_opportunity',
          dimensionFields: { owner: 'owner', owner_note: 'owner_note' },
        })}
      />,
    );

    await waitFor(() => expect(document.body.textContent).toContain('needs_analysis'));
    // The prettified spellings the card measured must not appear on either side.
    expect(document.body.textContent).not.toContain('Needs Analysis');
    expect(document.body.textContent).not.toContain('NeedsAnalysis');
  });
});
