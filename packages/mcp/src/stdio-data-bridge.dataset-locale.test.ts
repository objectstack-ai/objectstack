// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0149 D2] The stdio bridge localizes its saved datasets for the
 * workspace default locale, the way the HTTP door localizes them for a call
 * with no `Accept-Language`.
 *
 * D2's `list_datasets` source is "localized at the metadata boundary for the
 * caller's locale the way the REST door localizes a saved dataset", with no
 * transport exception. The stdio transport carries no request, so its locale
 * is the i18n service's default — the one locale this face speaks.
 *
 * The executor here is a stand-in that lists what the bridge loaded and
 * matches the terms with the platform's own `matchDatasetTerms`, so a hit on a
 * bundle label reads `matchedOn: 'label'` exactly when the bridge handed the
 * translated label over.
 *
 * Pinned:
 * - a zh-CN default: the catalogue carries the zh-CN bundle labels, and a
 *   bundle-only term (总金额 / 阶段) hits as `label`;
 * - an `en` default: today's answer — the authored labels, and no hit for the
 *   zh-CN bundle term;
 * - an i18n service the host cannot resolve (its resolver throws), or none:
 *   the untranslated list, never an error.
 */

import { describe, it, expect } from 'vitest';
import type { ListDatasetsOutput } from '@objectstack/spec/ai';
import { matchDatasetTerms, type MatchableMember } from '@objectstack/service-analytics';
import { createStdioDataBridge, type StdioDataBridgeDeps, type StdioDatasetToolsService } from './stdio-data-bridge.js';

const PRINCIPAL = { userId: 'u_key', tenantId: 'org_1' };

const METRICS = {
  name: 'opp_metrics',
  label: 'Opportunity Metrics',
  object: 'crm_opportunity',
  dimensions: [{ name: 'stage', label: 'Stage', field: 'stage', type: 'string' }],
  measures: [{ name: 'total_amount', label: 'Total Amount', aggregate: 'sum', field: 'amount' }],
};

const ZH_CN = {
  datasets: {
    opp_metrics: {
      label: '商机指标',
      dimensions: { stage: { label: '阶段' } },
      measures: { total_amount: { label: '总金额' } },
    },
  },
};

/** An i18n service double: the zh-CN bundle above, and the default the test names. */
function i18nService(defaultLocale: string) {
  const bundles: Record<string, unknown> = { 'zh-CN': ZH_CN, en: {} };
  return {
    getLocales: () => Object.keys(bundles),
    getTranslations: (locale: string) => bundles[locale],
    getDefaultLocale: () => defaultLocale,
  };
}

type Member = MatchableMember & { label?: unknown };
type LoadedDataset = { name: string; label?: string; object: string; dimensions: Member[]; measures: Member[] };

/** The stand-in executor: lists the loaded datasets and matches terms with the platform matcher. */
const service: StdioDatasetToolsService = {
  datasetTools: ({ loadDatasets }) => ({
    definitions: [],
    async listDatasets(input, context) {
      const terms = (input as { terms?: string[] }).terms;
      const loaded = (await loadDatasets(context)) as LoadedDataset[];
      return {
        datasets: loaded.map((d) => ({
          name: d.name,
          label: d.label,
          object: d.object,
          dimensions: d.dimensions.map((m) => ({ name: m.name, label: m.label, type: 'string' })),
          measures: d.measures.map((m) => ({ name: m.name, label: m.label, aggregate: 'sum' })),
          ...(terms ? { matches: matchDatasetTerms(terms, { dimensions: d.dimensions, measures: d.measures }) } : {}),
        })),
      } as unknown as ListDatasetsOutput;
    },
    async queryDataset() {
      throw new Error('not used');
    },
  }),
};

function bridgeWith(i18n: StdioDataBridgeDeps['i18n']) {
  return createStdioDataBridge({
    engine: {} as any,
    metadataService: { list: async () => [] } as any,
    protocol: () => ({ getMetaItems: async () => ({ items: [METRICS] }) }) as any,
    resolvePrincipal: async () => PRINCIPAL as any,
    datasetTools: service,
    ...(i18n ? { i18n } : {}),
  });
}

const TERMS = ['总金额', '阶段', 'Total Amount'];

describe('[ADR-0149 D2] stdio list_datasets is localized for the workspace default locale', () => {
  it('a zh-CN default serves the zh-CN bundle labels, and a bundle-only term hits as `label`', async () => {
    const answer = await bridgeWith(() => i18nService('zh-CN')).listDatasets!({ terms: TERMS });
    const [ds] = answer.datasets;
    expect(ds.label).toBe('商机指标');
    expect(ds.dimensions.map((m) => m.label)).toEqual(['阶段']);
    expect(ds.measures.map((m) => m.label)).toEqual(['总金额']);
    expect(ds.matches).toEqual([
      { term: '总金额', member: 'measures.total_amount', matchedOn: 'label' },
      { term: '阶段', member: 'dimensions.stage', matchedOn: 'label' },
      { term: 'Total Amount', member: 'measures.total_amount', matchedOn: 'name' },
    ]);
  });

  it('an `en` default keeps the authored labels, and the zh-CN bundle term does not hit', async () => {
    const answer = await bridgeWith(() => i18nService('en')).listDatasets!({ terms: TERMS });
    const [ds] = answer.datasets;
    expect(ds.label).toBe('Opportunity Metrics');
    expect(ds.dimensions.map((m) => m.label)).toEqual(['Stage']);
    expect(ds.measures.map((m) => m.label)).toEqual(['Total Amount']);
    expect(ds.matches).toEqual([
      { term: 'Total Amount', member: 'measures.total_amount', matchedOn: 'name' },
    ]);
  });

  it('an i18n service whose resolution throws leaves the list untranslated, not an error', async () => {
    const answer = await bridgeWith(() => {
      throw new Error('i18n service not registered');
    }).listDatasets!({ terms: TERMS });
    const [ds] = answer.datasets;
    expect(ds.label).toBe('Opportunity Metrics');
    expect(ds.measures.map((m) => m.label)).toEqual(['Total Amount']);
    expect(ds.matches).toEqual([
      { term: 'Total Amount', member: 'measures.total_amount', matchedOn: 'name' },
    ]);
  });

  it('a host with no i18n service leaves the list untranslated', async () => {
    const answer = await bridgeWith(undefined).listDatasets!({});
    expect(answer.datasets[0].measures.map((m) => m.label)).toEqual(['Total Amount']);
  });
});
