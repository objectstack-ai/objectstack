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
 *   the untranslated list, never an error;
 * - an i18n service that resolves but whose `getLocales` / `getTranslations`
 *   throws, over the REAL executor: the datasets untranslated, with a warning,
 *   on both dataset tools and the object tools (#34993, its own describe below);
 * - a header-less call answers labels and sentences in one language (#35083).
 */

import { describe, it, expect } from 'vitest';
import type { ListDatasetsOutput } from '@objectstack/spec/ai';
import {
  AnalyticsServicePlugin,
  matchDatasetTerms,
  type AnalyticsService,
  type MatchableMember,
} from '@objectstack/service-analytics';
import {
  createStdioDataBridge,
  servedLocaleObjectView,
  type StdioDataBridgeDeps,
  type StdioDatasetToolsService,
} from './stdio-data-bridge.js';

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

/**
 * [ADR-0149 D2 · #34993] An i18n service that RESOLVES but whose reads throw
 * is a translation fault, which the shared translator (`translationBundleOf`)
 * answers as no bundle and says. The executor here is the REAL one (the
 * analytics service `AnalyticsServicePlugin` registers, admission wired):
 * `list_datasets` keeps the dataset, in its authored text, `partial` with the
 * fault's warning; `query_dataset` answers; the object tools serve the
 * authored labels. The control case lists the dataset in the bundle labels.
 *
 * Flipped on purpose by #34993 (seat ruling B) from #34876's ruling-A pin
 * (`datasets: []` + `partial`, and a 503), on both transports at once.
 */
describe('[ADR-0149 D2] stdio dataset tools when the i18n service resolves but its reads throw', () => {
  /**
   * The analytics service AnalyticsServicePlugin registers, so the executor is
   * the platform's own; over an open security double and an engine double
   * that declares `crm_opportunity`, so a dataset the load hands over IS
   * listed (the control case below), and an empty catalogue is the load's doing.
   */
  async function wiredAnalytics(): Promise<AnalyticsService> {
    const fields = { id: { type: 'text' }, stage: { type: 'text' }, amount: { type: 'number' } };
    const engine = {
      execute: async () => ({ rows: [{ stage: 'won', total_amount: 100 }] }),
      hasObjectMiddleware: () => false,
      getObject: (name: string) => (name === 'crm_opportunity' ? { fields } : undefined),
      resolveEffectiveDatasource: () => undefined,
    };
    const security = {
      getReadFilter: async () => undefined,
      canReadObject: () => true,
      getReadableFields: async () => Object.keys(fields),
      getQueryableFields: async () => Object.keys(fields),
    };
    const registered: Record<string, unknown> = { data: engine, security };
    const ctx = {
      getService: (name: string) => registered[name],
      registerService: (name: string, svc: unknown) => { registered[name] = svc; },
      replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    };
    await new AnalyticsServicePlugin({ queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }) }).init(ctx as never);
    const analytics = registered.analytics as AnalyticsService;
    expect(analytics.hasPluginWiredAdmission()).toBe(true);
    return analytics;
  }

  /** A resolved i18n service whose `read` throws `message`; the other read answers the zh-CN bundle. */
  function i18nWhoseReadThrows(read: 'getLocales' | 'getTranslations', message: string) {
    return {
      getLocales: () => {
        if (read === 'getLocales') throw new Error(message);
        return ['zh-CN', 'en'];
      },
      getTranslations: (locale: string) => {
        if (read === 'getTranslations') throw new Error(message);
        return locale === 'zh-CN' ? ZH_CN : {};
      },
      getDefaultLocale: () => 'zh-CN',
    };
  }

  async function bridgeOverRealExecutor(i18n: () => unknown, principal: object = PRINCIPAL) {
    return createStdioDataBridge({
      engine: {} as any,
      metadataService: { list: async () => [] } as any,
      protocol: () => ({ getMetaItems: async () => ({ items: [METRICS] }) }) as any,
      resolvePrincipal: async () => principal as any,
      datasetTools: await wiredAnalytics(),
      i18n,
    });
  }

  const CASES = [
    { read: 'getLocales' as const, message: 'locales exploded' },
    { read: 'getTranslations' as const, message: 'bundle offline' },
  ];

  it('control: the same harness lists the dataset, in the bundle labels, when the reads answer', async () => {
    const bridge = await bridgeOverRealExecutor(() => i18nService('zh-CN'));
    const answer = await bridge.listDatasets!({});
    expect(answer.partial).toBeUndefined();
    expect(answer.datasets.map((d) => [d.name, d.label])).toEqual([['opp_metrics', '商机指标']]);
  });

  it.each(CASES)('$read throwing: list_datasets keeps the dataset untranslated, partial, naming the i18n error', async ({ read, message }) => {
    const bridge = await bridgeOverRealExecutor(() => i18nWhoseReadThrows(read, message));
    const answer = await bridge.listDatasets!({ terms: TERMS });
    expect(answer.datasets.map((d) => [d.name, d.label])).toEqual([['opp_metrics', 'Opportunity Metrics']]);
    expect(answer).toMatchObject({ partial: true, warning: expect.stringContaining(message) });
  });

  it.each(CASES)('$read throwing: query_dataset answers, in the authored labels', async ({ read, message }) => {
    const bridge = await bridgeOverRealExecutor(() => i18nWhoseReadThrows(read, message));
    const answer = await bridge.queryDataset!({ datasetName: 'opp_metrics', selection: { measures: ['total_amount'] } }, { maxRows: 10 });
    expect(answer.rowCount).toBe(1);
    expect(answer.provenance.dataset).toEqual({ name: 'opp_metrics', label: 'Opportunity Metrics' });
  });

  it.each(CASES)('$read throwing: the object tools serve the authored labels', async ({ read, message }) => {
    const deal = { name: 'crm_opportunity', label: 'Opportunity', fields: { stage: { type: 'text', label: 'Stage' } } };
    const view = servedLocaleObjectView(
      { listObjects: async () => [deal], getObject: async () => deal } as any,
      { i18n: () => i18nWhoseReadThrows(read, message) },
    );
    const [listed] = (await view.listObjects()) as Array<typeof deal>;
    expect([listed.label, listed.fields.stage.label]).toEqual(['Opportunity', 'Stage']);
    expect(((await view.getObject('crm_opportunity')) as typeof deal).label).toBe('Opportunity');
  });

  /**
   * [#35083] A header-less stdio call, an i18n default of zh-CN and a
   * workspace of `en`: the labels AND the executor's sentences answer what a
   * zh-CN principal is answered — one language, the labels'.
   */
  it('a header-less call answers labels and sentences in one language', async () => {
    const ask = async (principal: object, defaultLocale = 'zh-CN') => {
      const bridge = await bridgeOverRealExecutor(() => i18nService(defaultLocale), principal);
      return {
        list: await bridge.listDatasets!({ terms: ['total_amount'] }),
        query: await bridge.queryDataset!({ datasetName: 'opp_metrics', selection: { measures: ['total_amount'] } }, { maxRows: 10 }),
      };
    };
    const headerless = await ask({ ...PRINCIPAL, workspaceLocale: 'en' });
    const zh = await ask({ ...PRINCIPAL, locale: 'zh-CN' });
    const en = await ask({ ...PRINCIPAL, locale: 'en' }, 'en');
    expect(headerless.list.datasets[0].label).toBe('商机指标');
    expect(headerless.list.nextStep).toEqual(zh.list.nextStep);
    expect(headerless.query.sourceLine).toBe(zh.query.sourceLine);
    // Control: the two languages' sentences differ, so the equalities above are the locale's doing.
    expect(en.query.sourceLine).not.toBe(zh.query.sourceLine);
  });
});
