// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0149 D2–D4] The dataset AI tools — `list_datasets` and `query_dataset`
 * — against a service booted by `AnalyticsServicePlugin` (the plugin-wired
 * admission hooks, bridged to a `security` double) over an engine double that
 * records every read.
 *
 * What is pinned:
 * - D4 caveat: a service WITHOUT the plugin-wired hooks is refused by both
 *   tools before anything is read; the plugin-wired one is served.
 * - The catalogue asks the query's own gates: an object the caller may not
 *   read or that is not API-exposed leaves its dataset ABSENT; a member over a
 *   field the caller may not read is withheld and the narrowing is stated; a
 *   member over an `internal` field is left out for EVERY caller, unstated.
 * - D3 `matches`: equality after normalization, label locales and synonyms,
 *   never a substring, never a withheld member.
 * - `query_dataset`: one NOT_FOUND for missing and hidden; `provenance`
 *   composed from what ran, which the model's input cannot set; the row cap
 *   and `truncated`; the delegation statement; no `sql`.
 * - [#34919] `nextStep` and `sourceLine` (ADR-0149 M1 note): the decision for
 *   each term, the precedence among mixed cases, the partial-answer rule, the
 *   sentence's language, and that neither sentence names a member the caller
 *   was not admitted to — on a mirror of `examples/app-crm`'s dataset.
 */

import { describe, it, expect, vi } from 'vitest';
import { ListDatasetsOutputSchema, QueryDatasetOutputSchema, getDatasetToolJsonSchemas } from '@objectstack/spec/ai';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsServicePlugin } from '../plugin.js';
import { AnalyticsService } from '../analytics-service.js';
import { createDatasetTools, getDatasetToolDefinitions } from '../dataset-tools.js';
import { DATASET_NEXT_STEP_PRECEDENCE, composeDatasetSourceLine, datasetToolSentenceLocale } from '../dataset-next-step.js';

const ME = { userId: 'u_me', tenantId: 'org_a', locale: 'zh-CN' } as ExecutionContext;
const ADMIN = { userId: 'u_admin', tenantId: 'org_a' } as ExecutionContext;

const OBJECTS: Record<string, { enable?: unknown; fields: Record<string, Record<string, unknown>> }> = {
  crm_opp: {
    fields: {
      id: { type: 'text' },
      stage: { type: 'text' },
      region: { type: 'text' },
      amount: { type: 'number' },
      margin: { type: 'number' },
      secret: { type: 'number', internal: true },
    },
  },
  crm_locked: { fields: { id: { type: 'text' }, amount: { type: 'number' } } },
  crm_closed: { enable: { apiEnabled: false }, fields: { id: { type: 'text' }, amount: { type: 'number' } } },
  // [#34919] app-crm's two pipeline objects, as `examples/app-crm/src/objects` declares the fields its datasets read.
  crm_opportunity: {
    fields: {
      id: { type: 'text' },
      stage: { type: 'select' },
      account: { type: 'text' },
      close_date: { type: 'date' },
      amount: { type: 'currency' },
    },
  },
  crm_opportunity_line_item: {
    fields: { id: { type: 'text' }, product: { type: 'text' }, quantity: { type: 'number' }, amount: { type: 'currency' } },
  },
};

const PIPELINE = {
  name: 'pipeline',
  label: { en: 'Pipeline', 'zh-CN': '销售分析' },
  description: 'Won and open opportunities.',
  object: 'crm_opp',
  dimensions: [
    { name: 'stage', label: 'Stage', field: 'stage', type: 'string', synonyms: ['阶段', 'phase'], description: 'Sales stage.' },
    { name: 'region', label: 'Region', field: 'region', type: 'string' },
  ],
  measures: [
    {
      name: 'revenue',
      label: { en: 'Revenue', 'zh-CN': '营收' },
      aggregate: 'sum',
      field: 'amount',
      synonyms: ['收入', 'sales'],
      description: { en: 'Won amount.', 'zh-CN': '已赢单金额合计' },
      format: '$0,0',
    },
    { name: 'margin_total', label: 'Margin', aggregate: 'sum', field: 'margin', synonyms: ['毛利'] },
    { name: 'deal_count', label: 'Deals', aggregate: 'count' },
    { name: 'secret_sum', label: 'Secret', aggregate: 'sum', field: 'secret' },
    { name: 'margin_rate', label: 'Margin rate', derived: { op: 'ratio', of: ['margin_total', 'revenue'] } },
  ],
};
const LOCKED = {
  name: 'locked_ds',
  label: 'Locked',
  object: 'crm_locked',
  dimensions: [],
  measures: [{ name: 'total', label: 'Total', aggregate: 'sum', field: 'amount' }],
};
const CLOSED = {
  name: 'closed_ds',
  label: 'Closed',
  object: 'crm_closed',
  dimensions: [],
  measures: [{ name: 'total', label: 'Total', aggregate: 'sum', field: 'amount' }],
};
const SAVED = [PIPELINE, LOCKED, CLOSED];

/** The SQL posture: one strategy, every read through the engine double's `execute`. */
const nativeSql = () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false });

function fakeEngine(rows: Record<string, unknown>[]) {
  const reads: string[] = [];
  return {
    reads,
    engine: {
      execute: async (sql: unknown, options?: { object?: string }) => {
        reads.push(`execute:${options?.object ?? String(sql)}`);
        return { rows: rows.map((r) => ({ ...r })) };
      },
      hasObjectMiddleware: () => false,
      getObject: (name: string) => OBJECTS[name],
      resolveEffectiveDatasource: () => undefined,
    },
  };
}

/**
 * The security double: u_me may not read `crm_locked` nor the `margin` field;
 * [#34919] u_rep may not read the `amount` field of app-crm's two objects;
 * u_admin reads everything.
 */
function fieldsFor(object: string, ctx?: ExecutionContext): string[] {
  const all = Object.keys(OBJECTS[object]?.fields ?? {});
  if (ctx?.userId === 'u_me') return all.filter((f) => f !== 'margin');
  if (ctx?.userId === 'u_rep' && object.startsWith('crm_opportunity')) return all.filter((f) => f !== 'amount');
  return all;
}
const security = {
  getReadFilter: async () => undefined,
  canReadObject: (object: string, ctx?: ExecutionContext) => !(ctx?.userId === 'u_me' && object === 'crm_locked'),
  getReadableFields: async (object: string, ctx?: ExecutionContext) => fieldsFor(object, ctx),
  getQueryableFields: async (object: string, ctx?: ExecutionContext) => fieldsFor(object, ctx),
};

async function bootWired(rows: Record<string, unknown>[] = [{ stage: 'won', revenue: 100 }]) {
  const { engine, reads } = fakeEngine(rows);
  const registered: Record<string, unknown> = {};
  const warn = vi.fn();
  const ctx = {
    getService: (name: string) => {
      if (name === 'security') return security;
      if (name === 'data') return engine;
      return registered[name];
    },
    registerService: (name: string, svc: unknown) => { registered[name] = svc; },
    replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
    logger: { info() {}, warn, error() {}, debug() {} },
  };
  await new AnalyticsServicePlugin({ queryCapabilities: nativeSql }).init(ctx as never);
  return { service: registered.analytics as AnalyticsService, reads, warn };
}

const loadSaved = vi.fn(async () => SAVED.map((d) => ({ ...d, _diagnostics: { source: 'test' } })));

const messageOf = (e: unknown) => (e as Error).message;

describe('the two AIToolDefinitions', () => {
  it('declares list_datasets then query_dataset, with the spec projections as parameters and outputSchema', () => {
    const defs = getDatasetToolDefinitions();
    expect(defs.map((d) => d.name)).toEqual(['list_datasets', 'query_dataset']);
    const schemas = getDatasetToolJsonSchemas();
    for (const d of defs) {
      expect(d.parameters).toBe(schemas[d.name as 'list_datasets'].parameters);
      expect(d.outputSchema).toBe(schemas[d.name as 'list_datasets'].outputSchema);
      expect(d.label).toEqual(expect.any(String));
    }
    // The D3 rule rides with the tool to an MCP client.
    expect(defs[0].description).toMatch(/ask the user/i);
    expect(defs[0].description).toContain('非指标口径');
    expect(defs[1].description).toContain('provenance');
  });

  it('[#34919] says follow nextStep and cite sourceLine, and names the precedence the executor applies', () => {
    const [list, query] = getDatasetToolDefinitions();
    expect(list.description).toContain('nextStep');
    expect(list.description).toContain(DATASET_NEXT_STEP_PRECEDENCE.join(', '));
    expect(query.description).toContain('sourceLine');
    expect(DATASET_NEXT_STEP_PRECEDENCE).toEqual(['several_measures', 'one_measure', 'candidates_only', 'no_measure']);
  });
});

describe('[ADR-0149 D4 caveat] the tools require the plugin-wired service', () => {
  it('REFUSES both tools on a hand-built service without the admission hooks, before anything is read', async () => {
    const executeRawSql = vi.fn(async () => [{ revenue: 1 }]);
    const handBuilt = new AnalyticsService({
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      queryCapabilities: nativeSql,
      executeRawSql,
      isRegisteredObject: () => true,
    });
    expect(handBuilt.hasPluginWiredAdmission()).toBe(false);
    const load = vi.fn(async () => SAVED);
    const tools = handBuilt.datasetTools({ loadDatasets: load });
    const unwired = { code: 'SERVICE_UNAVAILABLE', status: 503 };
    await expect(tools.listDatasets({}, ME)).rejects.toMatchObject(unwired);
    await expect(
      tools.queryDataset({ datasetName: 'pipeline', selection: { measures: ['revenue'] } }, ME),
    ).rejects.toMatchObject(unwired);
    expect(load).not.toHaveBeenCalled();
    expect(executeRawSql).not.toHaveBeenCalled();
    // The same service answers the direct call — what the tools refuse to lend their caller.
    await expect(handBuilt.queryDataset(PIPELINE as never, { measures: ['revenue'] } as never, ME)).resolves.toBeDefined();
  });

  it('REFUSES when the analytics service is absent or another implementation', async () => {
    for (const analytics of [undefined, { queryDataset: async () => ({ rows: [] }) }]) {
      const tools = createDatasetTools({ analytics, loadDatasets: loadSaved });
      await expect(tools.listDatasets({}, ME)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    }
  });

  it('SERVES the same calls on the service AnalyticsServicePlugin registered', async () => {
    const { service, reads } = await bootWired();
    expect(service.hasPluginWiredAdmission()).toBe(true);
    const tools = service.datasetTools({ loadDatasets: loadSaved });
    expect(tools.definitions).toBe(getDatasetToolDefinitions());
    const listed = await tools.listDatasets({}, ME);
    expect(listed.datasets.map((d) => d.name)).toEqual(['pipeline']);
    const answered = await tools.queryDataset({ datasetName: 'pipeline', selection: { measures: ['revenue'] } }, ME);
    expect(answered.rows.length).toBeGreaterThan(0);
    expect(reads).toEqual(['execute:crm_opp']);
  });
});

describe('list_datasets — the catalogue asks the query\'s own gates', () => {
  it('lists only what the caller may query, withholds the unreadable member and states it, omits the internal one unstated', async () => {
    const { service, reads, warn } = await bootWired();
    const tools = service.datasetTools({ loadDatasets: loadSaved });
    const out = await tools.listDatasets({}, ME);

    // locked_ds (object read denied) and closed_ds (not API-exposed) are absent, not marked.
    expect(out.datasets.map((d) => d.name)).toEqual(['pipeline']);
    expect(out.partial).toBeUndefined();
    const [pipeline] = out.datasets;
    expect(pipeline).toMatchObject({
      name: 'pipeline',
      label: '销售分析',
      description: 'Won and open opportunities.',
      object: 'crm_opp',
      membersWithheld: true,
    });
    expect(pipeline.dimensions).toEqual([
      { name: 'stage', label: 'Stage', description: 'Sales stage.', type: 'string', synonyms: ['阶段', 'phase'] },
      { name: 'region', label: 'Region', type: 'string' },
    ]);
    // margin_total and the derived margin_rate read `margin` (withheld);
    // secret_sum reads an internal field (omitted for everyone).
    expect(pipeline.measures.map((m) => m.name)).toEqual(['revenue', 'deal_count']);
    expect(pipeline.measures[0]).toEqual({
      name: 'revenue',
      label: '营收',
      description: '已赢单金额合计',
      aggregate: 'sum',
      format: '$0,0',
      synonyms: ['收入', 'sales'],
    });
    expect(pipeline.matches).toBeUndefined();
    // Nothing was queried to build it.
    expect(reads).toEqual([]);
    // The internal member is reported to the server log, once, by name.
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('dataset AI catalogue'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"pipeline.measures.secret_sum"');
    await tools.listDatasets({}, ME);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('dataset AI catalogue'))).toHaveLength(1);
  });

  it('lists the readable members for a caller who reads them, with no withholding stated; the internal one stays out', async () => {
    const { service } = await bootWired();
    const out = await service.datasetTools({ loadDatasets: loadSaved }).listDatasets({}, ADMIN);
    expect(out.datasets.map((d) => d.name)).toEqual(['pipeline', 'locked_ds']);
    const pipeline = out.datasets[0];
    expect(pipeline.membersWithheld).toBeUndefined();
    expect(pipeline.measures.map((m) => m.name)).toEqual(['revenue', 'margin_total', 'deal_count', 'margin_rate']);
    // No locale on the context: the inline map resolves to its default.
    expect(pipeline.label).toBe('Pipeline');
    const rate = pipeline.measures.find((m) => m.name === 'margin_rate');
    expect(rate).toEqual({ name: 'margin_rate', label: 'Margin rate' });
  });

  it('reports which terms equal which member — name, any label locale, synonym — and never a substring or a withheld member', async () => {
    const { service } = await bootWired();
    const out = await service.datasetTools({ loadDatasets: loadSaved }).listDatasets(
      { terms: ['营收', 'Phase', 'deal_count', 'rev', '毛利', 'Revenue'] },
      ME,
    );
    expect(out.datasets[0].matches).toEqual([
      { term: '营收', member: 'measures.revenue', matchedOn: 'label' },
      { term: 'Phase', member: 'dimensions.stage', matchedOn: 'synonym' },
      { term: 'deal_count', member: 'measures.deal_count', matchedOn: 'name' },
      // Case-folded, `Revenue` is the member's NAME too: one member answers once, name first.
      { term: 'Revenue', member: 'measures.revenue', matchedOn: 'name' },
    ]);
  });

  it('refuses an unknown input key with the prescription, and answers a degraded read as partial', async () => {
    const { service } = await bootWired();
    const tools = service.datasetTools({ loadDatasets: loadSaved });
    await expect(tools.listDatasets({ terms: ['x'], datasets: ['pipeline'] }, ME)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });

    const failing = service.datasetTools({ loadDatasets: async () => { throw new Error('metadata loader down'); } });
    const failed = await failing.listDatasets({}, ME);
    expect(failed).toMatchObject({ datasets: [], partial: true });
    expect(failed.warning).toContain('metadata loader down');

    const degraded = service.datasetTools({
      loadDatasets: async () => ({ items: [PIPELINE], partial: true as const, warning: 'one source unavailable' }),
    });
    const short = await degraded.listDatasets({}, ME);
    expect(short.datasets.map((d) => d.name)).toEqual(['pipeline']);
    expect(short).toMatchObject({ partial: true, warning: 'one source unavailable' });
  });
});

describe('query_dataset', () => {
  it('answers one NOT_FOUND for a missing dataset and for one the caller may not query, reading nothing', async () => {
    const { service, reads } = await bootWired();
    const tools = service.datasetTools({ loadDatasets: loadSaved });
    const missing = await tools
      .queryDataset({ datasetName: 'nope', selection: { measures: ['total'] } }, ME)
      .catch((e) => e);
    const hidden = await tools
      .queryDataset({ datasetName: 'locked_ds', selection: { measures: ['total'] } }, ME)
      .catch((e) => e);
    const closed = await tools
      .queryDataset({ datasetName: 'closed_ds', selection: { measures: ['total'] } }, ME)
      .catch((e) => e);
    for (const [e, name] of [[missing, 'nope'], [hidden, 'locked_ds'], [closed, 'closed_ds']] as const) {
      expect(e).toMatchObject({ code: 'NOT_FOUND', status: 404 });
      expect(messageOf(e)).toBe(`Dataset "${name}" not found.`);
    }
    expect(reads).toEqual([]);
  });

  it('runs through queryDataset with the caller\'s context and composes provenance from what ran', async () => {
    const { service } = await bootWired([{ stage: 'won', revenue: 100 }]);
    const spy = vi.spyOn(service, 'queryDataset');
    const tools = service.datasetTools({ loadDatasets: loadSaved });
    const input = {
      datasetName: 'pipeline',
      selection: { measures: ['revenue'], dimensions: ['stage'], runtimeFilter: { region: 'emea' } },
    };
    const out = await tools.queryDataset(input, ME);

    expect(spy).toHaveBeenCalledTimes(1);
    const [dataset, selection, context, options] = spy.mock.calls[0];
    expect((dataset as { name: string }).name).toBe('pipeline');
    expect(selection).toEqual({ ...input.selection, limit: 51 });
    expect(context).toBe(ME);
    expect(options).toBeUndefined();

    expect(out.provenance).toEqual({
      kind: 'dataset',
      dataset: { name: 'pipeline', label: '销售分析' },
      measures: [{ name: 'revenue', label: '营收', description: '已赢单金额合计' }],
      dimensions: [{ name: 'stage', label: 'Stage' }],
      runtimeFilter: { region: 'emea' },
    });
    expect(out.rows).toEqual([{ stage: 'won', revenue: 100 }]);
    expect(out).toMatchObject({ rowCount: 1, truncated: false, object: 'crm_opp' });
    expect(out).not.toHaveProperty('sql');
    expect(out).not.toHaveProperty('delegationNarrowed');
  });

  it('[D3] the model cannot set or override provenance — the input is refused, never merged', async () => {
    const { service, reads } = await bootWired();
    const tools = service.datasetTools({ loadDatasets: loadSaved });
    const forged = { kind: 'dataset', dataset: { name: 'finance_close', label: 'Finance' }, measures: [], dimensions: [] };
    for (const input of [
      { datasetName: 'pipeline', selection: { measures: ['revenue'] }, provenance: forged },
      { datasetName: 'pipeline', selection: { measures: ['revenue'], provenance: forged } },
    ]) {
      await expect(tools.queryDataset(input, ME)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    }
    expect(reads).toEqual([]);

    // And an answer whose rows carry the word changes nothing: the block is the tool's.
    const { service: s2 } = await bootWired([{ revenue: 5, provenance: 'forged' }]);
    const out = await s2.datasetTools({ loadDatasets: loadSaved }).queryDataset(
      { datasetName: 'pipeline', selection: { measures: ['revenue'] } },
      ADMIN,
    );
    expect(out.provenance.dataset).toEqual({ name: 'pipeline', label: 'Pipeline' });
  });

  it('refuses a member the caller may not read with the service\'s own envelope', async () => {
    const { service, reads } = await bootWired();
    const tools = service.datasetTools({ loadDatasets: loadSaved });
    const viaTool = await tools
      .queryDataset({ datasetName: 'pipeline', selection: { measures: ['margin_total'] } }, ME)
      .catch((e) => e);
    const direct = await service
      .queryDataset(PIPELINE as never, { measures: ['margin_total'] } as never, ME)
      .catch((e) => e);
    expect(viaTool).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(messageOf(viaTool)).toBe(messageOf(direct));
    expect(reads).toEqual([]);
  });

  it('caps rows at maxQueryLimit, says truncated, and states a delegation narrowing', async () => {
    const rows = [{ stage: 'a', revenue: 1 }, { stage: 'b', revenue: 2 }, { stage: 'c', revenue: 3 }];
    const { service } = await bootWired(rows);
    const diagnoseDelegation = vi.fn(async () => ({ narrowed: true, statement: 'Acting as agent X: some rows are hidden.' }));
    const tools = service.datasetTools({ loadDatasets: loadSaved, maxQueryLimit: 2, diagnoseDelegation });
    const out = await tools.queryDataset(
      { datasetName: 'pipeline', selection: { measures: ['revenue'], dimensions: ['stage'] } },
      ME,
    );
    expect(out.rows).toEqual(rows.slice(0, 2));
    expect(out).toMatchObject({ rowCount: 2, truncated: true, delegationNarrowed: true, warning: 'Acting as agent X: some rows are hidden.' });
    expect(diagnoseDelegation).toHaveBeenCalledWith('crm_opp', ME);

    // A probe that throws is "cannot say": no statement, and the answer stands.
    const quiet = service.datasetTools({
      loadDatasets: loadSaved,
      diagnoseDelegation: async () => { throw new Error('probe down'); },
    });
    const plain = await quiet.queryDataset({ datasetName: 'pipeline', selection: { measures: ['revenue'] } }, ME);
    expect(plain).not.toHaveProperty('delegationNarrowed');
    expect(plain).not.toHaveProperty('warning');
  });

  // The tool asks the service for one row past the cap so `truncated` is a
  // fact, then serves `cap` rows. Every member of the answer aligned to `rows`
  // by index is served to the same length, entry i beside row i: a drill
  // sidecar that kept the probe row described a bucket the caller was never
  // shown. Members aligned to something else are served as the service
  // answered them.
  describe('a truncated answer serves every row-aligned sidecar to the served rows', () => {
    const rows = [
      { stage: 'draft', revenue: 1 },
      { stage: 'paid', revenue: 2 },
      { stage: 'void', revenue: 3 },
    ];

    for (const limit of [1, 2]) {
      it(`limit ${limit}: drillRawRows holds exactly the served rows' raw values, in row order`, async () => {
        const { service } = await bootWired(rows);
        const out = await service.datasetTools({ loadDatasets: loadSaved }).queryDataset(
          { datasetName: 'pipeline', selection: { measures: ['revenue'], dimensions: ['stage'], limit } },
          ADMIN,
        );
        expect(out).toMatchObject({ rowCount: limit, truncated: true, dimensionFields: { stage: 'stage' } });
        expect(out.rows).toHaveLength(limit);
        expect(out.drillRawRows).toHaveLength(out.rows.length);
        out.rows.forEach((row, i) => expect(out.drillRawRows?.[i]).toEqual({ stage: row.stage }));
      });
    }

    it('trims drillRanges with the rows and leaves totals, drillRawTotals, dimensionFields and drillScopes as answered', async () => {
      const { service } = await bootWired();
      const range = (gte: string, lt: string) => ({ closed_on: { field: 'closed_on', gte, lt } });
      const totals = [{ dimensions: [], rows: [{ revenue: 6 }] }];
      const drillRawTotals = [[{}]];
      const drillScopes = { revenue: { amount: { $null: false } } };
      vi.spyOn(service, 'queryDataset').mockResolvedValue({
        rows: rows.map((r) => ({ ...r })),
        fields: [{ name: 'stage', type: 'string' }, { name: 'revenue', type: 'number' }],
        object: 'crm_opp',
        totals,
        dimensionFields: { stage: 'stage' },
        drillRawRows: rows.map((r) => ({ stage: r.stage })),
        drillRawTotals,
        drillRanges: [range('2026-01-01', '2026-02-01'), range('2026-02-01', '2026-03-01'), range('2026-03-01', '2026-04-01')],
        drillScopes,
      });
      const out = await service.datasetTools({ loadDatasets: loadSaved }).queryDataset(
        { datasetName: 'pipeline', selection: { measures: ['revenue'], dimensions: ['stage'], limit: 2 } },
        ADMIN,
      );
      expect(out).toMatchObject({ rowCount: 2, truncated: true });
      expect(out.drillRawRows).toEqual([{ stage: 'draft' }, { stage: 'paid' }]);
      expect(out.drillRanges).toEqual([range('2026-01-01', '2026-02-01'), range('2026-02-01', '2026-03-01')]);
      // Aligned to `totals`, keyed by name, or describing the whole answer: not row-indexed.
      expect(out.totals).toEqual(totals);
      expect(out.drillRawTotals).toEqual(drillRawTotals);
      expect(out.dimensionFields).toEqual({ stage: 'stage' });
      expect(out.drillScopes).toEqual(drillScopes);
    });

    it('CONTROL: an answer within the cap is served as the service answered it', async () => {
      const { service } = await bootWired(rows);
      const direct = await service.queryDataset(PIPELINE as never, { measures: ['revenue'], dimensions: ['stage'] } as never, ADMIN);
      const out = await service.datasetTools({ loadDatasets: loadSaved }).queryDataset(
        { datasetName: 'pipeline', selection: { measures: ['revenue'], dimensions: ['stage'], limit: 3 } },
        ADMIN,
      );
      expect(out).toMatchObject({ rowCount: 3, truncated: false });
      expect(out.rows).toEqual(direct.rows);
      expect(out.drillRawRows).toEqual(direct.drillRawRows);
      expect(out.drillRawRows).toEqual([{ stage: 'draft' }, { stage: 'paid' }, { stage: 'void' }]);
    });
  });

  it('answers 503 when the dataset read itself fails, never NOT_FOUND', async () => {
    const { service } = await bootWired();
    const tools = service.datasetTools({ loadDatasets: async () => { throw new Error('loader down'); } });
    await expect(
      tools.queryDataset({ datasetName: 'pipeline', selection: { measures: ['revenue'] } }, ME),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
  });

  // A selection naming no measure has nothing to project. The spec selection
  // accepts `measures: []`, so it used to reach `service.queryDataset`, whose
  // SELECT had an empty projection: the SQL driver answered 500
  // `DATABASE_ERROR` with its own text, and with dimensions the tool served
  // group rows carrying no measure. The tool now refuses it before anything is
  // read, with the REST door's answer to the same selection
  // (`POST /analytics/dataset/query`: 400 `VALIDATION_FAILED`, the same
  // sentence). Both faces this executor serves are pinned: the direct member
  // the MCP bridge calls, and `execute`, the registry face the product AI's
  // chat tool calls. The dogfood suite holds the REST door and the MCP tool to
  // one answer for one caller.
  it.each([
    ['without dimensions', { measures: [] }],
    ['with dimensions', { measures: [], dimensions: ['stage'] }],
  ])('refuses measures: [] %s 400 VALIDATION_FAILED in the REST door\'s words, on both faces, reading nothing', async (_case, selection) => {
    const { service, reads } = await bootWired();
    const spy = vi.spyOn(service, 'queryDataset');
    const tools = service.datasetTools({ loadDatasets: loadSaved });
    const input = { datasetName: 'pipeline', selection };
    const direct = await tools.queryDataset(input, ME).catch((e) => e);
    const chat = await tools.execute({ toolName: 'query_dataset', input }, ME).catch((e) => e);
    for (const e of [direct, chat]) {
      expect(e).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
      expect(messageOf(e)).toBe('body.selection.measures must be a non-empty array of measure names.');
    }
    expect(spy).not.toHaveBeenCalled();
    expect(reads).toEqual([]);
  });

  it('CONTROL: a selection naming a measure, with dimensions, is served on both faces as before', async () => {
    const { service } = await bootWired([{ stage: 'won', revenue: 100 }]);
    const tools = service.datasetTools({ loadDatasets: loadSaved });
    const input = { datasetName: 'pipeline', selection: { measures: ['revenue'], dimensions: ['stage'] } };
    const direct = await tools.queryDataset(input, ME);
    const chat = await tools.execute({ toolName: 'query_dataset', input }, ME);
    for (const out of [direct, chat] as Array<{ rows: unknown[]; rowCount: number }>) {
      expect(out.rows).toEqual([{ stage: 'won', revenue: 100 }]);
      expect(out.rowCount).toBe(1);
    }
  });

  it('dispatches by tool name through execute, and refuses an unknown one', async () => {
    const { service } = await bootWired();
    const tools = service.datasetTools({ loadDatasets: loadSaved });
    const listed = await tools.execute({ toolName: 'list_datasets', input: {} }, ME);
    expect((listed as { datasets: unknown[] }).datasets).toHaveLength(1);
    await expect(tools.execute({ toolName: 'drop_dataset', input: {} }, ME)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});

// [ADR-0149] The dataset is the one declared definition: `query_dataset`
// answers only the members it declares. A raw field (`amount`), the
// service's ad-hoc `count`, a suffix spelling (`amount_sum`) or an
// undeclared dimension used to reach `service.queryDataset`, which minted an
// aggregate for it, and the answer's provenance then cited that aggregate as
// a governed metric. The tool refuses it before anything is read, on both
// faces, naming the members this caller may use, so the model picks one or
// falls back to the object query tools.
describe('query_dataset refuses a member the dataset does not declare', () => {
  it.each([
    ['a raw field as a measure', { measures: ['amount'] }, 'amount', 'measures'],
    ['the ad-hoc count', { measures: ['count'] }, 'count', 'measures'],
    ['a suffix spelling', { measures: ['amount_sum'] }, 'amount_sum', 'measures'],
    ['a dataset-qualified spelling of a declared measure', { measures: ['pipeline.revenue'] }, 'pipeline.revenue', 'measures'],
    ['an undeclared measure beside a declared one', { measures: ['revenue', 'amount'] }, 'amount', 'measures'],
    ['a raw field as a dimension', { measures: ['revenue'], dimensions: ['amount'] }, 'amount', 'dimensions'],
    [
      'a raw field as a time dimension',
      { measures: ['revenue'], timeDimensions: [{ dimension: 'closed_on', granularity: 'month' }] },
      'closed_on',
      'timeDimensions',
    ],
  ])('%s: 400 INVALID_FIELD naming the member and the declared ones, on both faces, reading nothing', async (_case, selection, member, param) => {
    const { service, reads } = await bootWired();
    const spy = vi.spyOn(service, 'queryDataset');
    const tools = service.datasetTools({ loadDatasets: loadSaved });
    const input = { datasetName: 'pipeline', selection };
    const direct = await tools.queryDataset(input, ADMIN).catch((e) => e);
    const chat = await tools.execute({ toolName: 'query_dataset', input }, ADMIN).catch((e) => e);
    for (const e of [direct, chat]) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toMatchObject({ code: 'INVALID_FIELD', status: 400, member, param, cube: 'pipeline' });
      // The declared members the caller may use are named, so the model can pick one.
      for (const declared of ['revenue', 'margin_total', 'deal_count', 'margin_rate', 'stage', 'region']) {
        expect(messageOf(e)).toContain(declared);
      }
    }
    expect(spy).not.toHaveBeenCalled();
    expect(reads).toEqual([]);
  });

  it('names only the members THIS caller may use: never a withheld one, never one over an internal field', async () => {
    const { service } = await bootWired();
    const e = await service
      .datasetTools({ loadDatasets: loadSaved })
      .queryDataset({ datasetName: 'pipeline', selection: { measures: ['amount'] } }, ME)
      .catch((err) => err);
    expect(e).toMatchObject({ code: 'INVALID_FIELD', status: 400, member: 'amount' });
    expect(messageOf(e)).toContain('revenue');
    expect(messageOf(e)).not.toContain('margin_total');
    expect(messageOf(e)).not.toContain('secret');
  });

  it('a dataset that is missing or hidden is still NOT_FOUND first, whatever the members', async () => {
    const { service } = await bootWired();
    const tools = service.datasetTools({ loadDatasets: loadSaved });
    for (const datasetName of ['nope', 'locked_ds']) {
      await expect(
        tools.queryDataset({ datasetName, selection: { measures: ['amount'] } }, ME),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    }
  });

  it('CONTROL: every declared measure (a derived one included) and dimension is served', async () => {
    const { service } = await bootWired([{ stage: 'won', revenue: 100 }]);
    const spy = vi.spyOn(service, 'queryDataset');
    const tools = service.datasetTools({ loadDatasets: loadSaved });
    const out = await tools.queryDataset(
      { datasetName: 'pipeline', selection: { measures: ['revenue', 'deal_count', 'margin_rate'], dimensions: ['stage', 'region'] } },
      ADMIN,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out.provenance.measures.map((m) => m.name)).toEqual(['revenue', 'deal_count', 'margin_rate']);
  });

  it('CONTROL: a time dimension the dataset declares reaches the service', async () => {
    const { service } = await bootWired();
    const spy = vi.spyOn(service, 'queryDataset');
    await service
      .datasetTools({ loadDatasets: loadSaved })
      .queryDataset({ datasetName: 'pipeline', selection: { measures: ['revenue'], timeDimensions: [{ dimension: 'stage' }] } }, ADMIN)
      .catch(() => undefined);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ── [#32072, ADR-0150 D3] query_dataset resolves the name by package ────────
// The tools' callers (the MCP bridges) belong to no package, and the input
// carries none, so `datasetName` resolves by the one package-scoped rule for a
// caller with no package, over the holders the listed items' `_packageId`s
// name: the environment's own item, else the one package holder; a name two
// packages hold is refused naming both. It never takes the first listed.
// Admission comes first (epic ruling 6766102988 on #32098, ADR-0149 D2): only
// the holders the caller may query are candidates, and a hidden one is never
// named.
describe('[#32072] query_dataset resolves the dataset by package (ADR-0150 D3)', () => {
  const ALPHA = 'com.acme.alpha';
  const BETA = 'com.acme.beta';
  const held = (packageId: string | undefined, label: string) =>
    ({ ...PIPELINE, label, ...(packageId !== undefined ? { _packageId: packageId } : {}), _diagnostics: { source: 'test' } });
  const run = async (listed: unknown[], context: ExecutionContext = ADMIN) => {
    const { service, reads } = await bootWired([{ stage: 'won', revenue: 100 }]);
    const spy = vi.spyOn(service, 'queryDataset');
    const tools = service.datasetTools({ loadDatasets: async () => listed.map((d) => ({ ...(d as object) })) });
    const answer = await tools
      .queryDataset({ datasetName: 'pipeline', selection: { measures: ['revenue'] } }, context)
      .catch((e: unknown) => e);
    return { answer, spy, reads };
  };
  /** A `pipeline` over `crm_locked`, which u_me may not read: hidden from ME, admitted to ADMIN. */
  const lockedHeld = (packageId: string, label: string) => ({
    name: 'pipeline', label, object: 'crm_locked', dimensions: [],
    measures: [{ name: 'revenue', label: 'Revenue', aggregate: 'sum', field: 'amount' }],
    _packageId: packageId, _diagnostics: { source: 'test' },
  });
  /** Everything an answer carries a reader could see: the thrown error's own fields, or the result. */
  const visible = (answer: unknown) =>
    answer instanceof Error
      ? JSON.stringify({ message: answer.message, ...(answer as unknown as Record<string, unknown>) })
      : JSON.stringify(answer);

  it('a name two packages hold is refused 409 RESOURCE_CONFLICT naming both, whichever is listed first; nothing is read', async () => {
    for (const listed of [[held(ALPHA, 'Alpha'), held(BETA, 'Beta')], [held(BETA, 'Beta'), held(ALPHA, 'Alpha')]]) {
      const { answer, spy, reads } = await run(listed);
      expect(answer).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
      expect(messageOf(answer)).toContain(ALPHA);
      expect(messageOf(answer)).toContain(BETA);
      expect(spy).not.toHaveBeenCalled();
      expect(reads).toEqual([]);
    }
  });

  // Was "…and is refused even when one holder's item fails the parse". Forced by
  // the admission-first ruling (6766102988): an item the parse leaves out is
  // refused for every caller, so it is admitted to none and is no candidate.
  it('an item the parse leaves out is admitted to no caller: the other holder is served, the broken one never named', async () => {
    const broken = { ...held(BETA, 'Beta'), measures: [{ name: 'x', aggregate: 'not_a_real_agg' }] };
    const { answer, spy } = await run([held(ALPHA, 'Alpha'), broken]);
    expect(answer).toMatchObject({ rowCount: 1 });
    expect((spy.mock.calls[0][0] as { label?: unknown }).label).toBe('Alpha');
    expect(visible(answer)).not.toContain(BETA);
  });

  it('admitted to neither holder: NOT_FOUND, byte-equal to the answer for a name nothing holds; neither is named', async () => {
    const missing = await run([], ME);
    const hidden = await run([lockedHeld(ALPHA, 'Alpha'), lockedHeld(BETA, 'Beta')], ME);
    expect(hidden.answer).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(visible(hidden.answer)).toBe(visible(missing.answer));
    expect(messageOf(hidden.answer)).toBe(messageOf(missing.answer));
    expect(visible(hidden.answer)).not.toContain(ALPHA);
    expect(visible(hidden.answer)).not.toContain(BETA);
    expect(hidden.spy).not.toHaveBeenCalled();
    expect(hidden.reads).toEqual([]);
  });

  it('admitted to exactly one holder: that one is served, in either list order, and the hidden holder is never named', async () => {
    for (const listed of [[held(ALPHA, 'Alpha'), lockedHeld(BETA, 'Beta')], [lockedHeld(BETA, 'Beta'), held(ALPHA, 'Alpha')]]) {
      const { answer, spy } = await run(listed, ME);
      expect(answer).toMatchObject({ rowCount: 1 });
      expect(spy).toHaveBeenCalledTimes(1);
      expect((spy.mock.calls[0][0] as { label?: unknown; _packageId?: unknown })).toMatchObject({ label: 'Alpha', _packageId: ALPHA });
      expect(visible(answer)).not.toContain(BETA);
    }
  });

  it('admitted to two of three holders: 409 naming only those two; the hidden third is never named', async () => {
    const GAMMA = 'com.acme.gamma';
    const { answer, spy } = await run([held(ALPHA, 'Alpha'), lockedHeld(BETA, 'Beta'), held(GAMMA, 'Gamma')], ME);
    expect(answer).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
    expect(messageOf(answer)).toContain(ALPHA);
    expect(messageOf(answer)).toContain(GAMMA);
    expect(visible(answer)).not.toContain(BETA);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a degraded read (`partial: true`) with fewer than two admitted holders is 503, never a 404 or a pick; nothing is read', async () => {
    for (const items of [[], [held(ALPHA, 'Alpha')]]) {
      const { service, reads } = await bootWired([{ stage: 'won', revenue: 100 }]);
      const spy = vi.spyOn(service, 'queryDataset');
      const tools = service.datasetTools({
        loadDatasets: async () => ({ items, partial: true as const, warning: 'one source did not answer' }),
      });
      const answer = await tools
        .queryDataset({ datasetName: 'pipeline', selection: { measures: ['revenue'] } }, ADMIN)
        .catch((e: unknown) => e);
      expect(answer).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
      expect(messageOf(answer)).toContain('one source did not answer');
      expect(spy).not.toHaveBeenCalled();
      expect(reads).toEqual([]);
    }
  });

  it('two listed rows of ONE holder (an overlay beside the composite) are one holder: served, never a TypeError', async () => {
    const one = await run([held(ALPHA, 'Overlay'), held(ALPHA, 'Composite')]);
    expect(one.answer).toMatchObject({ rowCount: 1 });
    expect((one.spy.mock.calls[0][0] as { label?: unknown }).label).toBe('Overlay');
    // The holder's first row that parsed, as the `find` before answered.
    const broken = { ...held(ALPHA, 'Broken'), measures: [{ name: 'x', aggregate: 'not_a_real_agg' }] };
    const parsedSecond = await run([broken, held(ALPHA, 'Good')]);
    expect(parsedSecond.answer).toMatchObject({ rowCount: 1 });
    expect((parsedSecond.spy.mock.calls[0][0] as { label?: unknown }).label).toBe('Good');
    // Beside a second holder the rule still refuses, naming each holder once.
    const two = await run([held(ALPHA, 'Overlay'), held(ALPHA, 'Composite'), held(BETA, 'Beta')]);
    expect(two.answer).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
    expect(two.answer).not.toBeInstanceOf(TypeError);
  });

  it('CONTROL: one package holder is served, the same dataset the list carried', async () => {
    const { answer, spy } = await run([held(ALPHA, 'Alpha'), { ...LOCKED, _packageId: BETA }]);
    expect(answer).toMatchObject({ rowCount: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0][0] as { label?: unknown; _packageId?: unknown })).toMatchObject({ label: 'Alpha', _packageId: ALPHA });
  });

  it('CONTROL: the environment\'s own item (no `_packageId`, or the `sys_metadata` sentinel) is served', async () => {
    for (const env of [held(undefined, 'Env'), held('sys_metadata', 'Env')]) {
      const { answer, spy } = await run([env]);
      expect(answer).toMatchObject({ rowCount: 1 });
      expect((spy.mock.calls[0][0] as { label?: unknown }).label).toBe('Env');
    }
  });

  it('a holder whose only item fails the parse is still not found, as before', async () => {
    const broken = { ...held(ALPHA, 'Alpha'), measures: [{ name: 'x', aggregate: 'not_a_real_agg' }] };
    const { answer, spy } = await run([broken]);
    expect(answer).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('[#34763] list_datasets candidates — only what this caller may read, never beside a match', () => {
  /** Every candidate names a dataset the same answer lists and a member that entry lists. */
  function expectResolvable(out: Awaited<ReturnType<ReturnType<AnalyticsService['datasetTools']>['listDatasets']>>) {
    for (const c of out.candidates ?? []) {
      const entry = out.datasets.find((d) => d.name === c.dataset);
      expect(entry, `${c.dataset} is listed`).toBeDefined();
      const [kind, name] = c.member.split('.') as ['measures' | 'dimensions', string];
      expect(entry![kind].map((m) => m.name), `${c.member} is listed in ${c.dataset}`).toContain(name);
    }
    expect(ListDatasetsOutputSchema.safeParse(out).success).toBe(true);
  }

  const TERMS = ['rev', '营收', 'secret', 'rate', 'tot', 'marg'];

  it('offers the readable near member for a term that matched nothing, and nothing for a term that matched', async () => {
    const { service } = await bootWired();
    const out = await service.datasetTools({ loadDatasets: loadSaved }).listDatasets({ terms: TERMS }, ME);
    // `secret` (an internal-field member), `rate` and `marg` (members over the
    // unreadable `margin`) and `tot` (a measure of locked_ds, which u_me may
    // not query, and of closed_ds, which is not API-exposed) offer nothing.
    expect(out.candidates).toEqual([{ term: 'rev', dataset: 'pipeline', member: 'measures.revenue' }]);
    expect(out.datasets[0].matches).toEqual([{ term: '营收', member: 'measures.revenue', matchedOn: 'label' }]);
    expectResolvable(out);
  });

  it('a caller who reads more is offered more, from the same rule; an unexposed dataset is offered to nobody', async () => {
    const { service } = await bootWired();
    const out = await service.datasetTools({ loadDatasets: loadSaved }).listDatasets({ terms: TERMS }, ADMIN);
    expect(out.candidates).toEqual([
      { term: 'rev', dataset: 'pipeline', member: 'measures.revenue' },
      { term: 'rate', dataset: 'pipeline', member: 'measures.margin_rate' },
      // `margin_total` folds to "margin total", which contains `tot`; datasets in listing order.
      { term: 'tot', dataset: 'pipeline', member: 'measures.margin_total' },
      { term: 'tot', dataset: 'locked_ds', member: 'measures.total' },
      { term: 'marg', dataset: 'pipeline', member: 'measures.margin_total' },
      { term: 'marg', dataset: 'pipeline', member: 'measures.margin_rate' },
    ]);
    expect(out.candidates!.some((c) => c.dataset === 'closed_ds' || c.member === 'measures.secret_sum')).toBe(false);
    expectResolvable(out);
  });

  it('a term with a match anywhere in the answer has no candidate, though a member is near it', async () => {
    const { service } = await bootWired();
    const tools = service.datasetTools({ loadDatasets: loadSaved });
    // `margin` equals margin_total's label; margin_rate ("Margin rate") contains it and is not offered.
    const matched = await tools.listDatasets({ terms: ['margin'] }, ADMIN);
    expect(matched.datasets[0].matches).toEqual([{ term: 'margin', member: 'measures.margin_total', matchedOn: 'label' }]);
    expect('candidates' in matched).toBe(false);
    // The control: the near form alone is offered both members.
    const near = await tools.listDatasets({ terms: ['marg'] }, ADMIN);
    expect(near.candidates?.map((c) => c.member)).toEqual(['measures.margin_total', 'measures.margin_rate']);
  });

  it('omits the key when nothing is offered: no terms, every term matched, or nothing readable is near', async () => {
    const { service } = await bootWired();
    const tools = service.datasetTools({ loadDatasets: loadSaved });
    for (const input of [{}, { terms: ['营收', 'phase'] }, { terms: ['secret', 'rate', 'tot', 'qa_no_word'] }]) {
      const out = await tools.listDatasets(input, ME);
      expect('candidates' in out, JSON.stringify(input)).toBe(false);
    }
  });
});

/**
 * [#34919] `examples/app-crm`'s `crm_opportunity_metrics`
 * (`src/datasets/opportunity.dataset.ts`), member for member with its labels
 * and synonyms, beside a second dataset over app-crm's line items. app-crm
 * declares one dataset, and the D1 rule refuses a word that answers to two
 * members of one dataset, so "a word with two matches" needs a second dataset:
 * `deal value` is `total_amount`'s synonym there and `line_amount`'s here.
 */
const CRM_OPPORTUNITY_METRICS = {
  name: 'crm_opportunity_metrics',
  label: 'Opportunity Metrics',
  description: 'Semantic layer for sales-pipeline counts and amounts',
  object: 'crm_opportunity',
  dimensions: [
    { name: 'stage', label: 'Stage', field: 'stage', type: 'string', synonyms: ['sales stage', 'deal stage', 'pipeline stage', '销售阶段', '商机阶段', '漏斗阶段'] },
    { name: 'account', label: 'Account', field: 'account', type: 'string', synonyms: ['customer', 'client', 'company', '客户', '公司', '客户名称'] },
    { name: 'close_date', label: 'Close Date', field: 'close_date', type: 'date', dateGranularity: 'month', synonyms: ['closing month', 'expected close date', '成交日期', '预计成交日期', '成交月份'] },
  ],
  measures: [
    { name: 'opp_count', label: 'Opportunities', aggregate: 'count', synonyms: ['deal count', 'number of deals', '商机数', '商机数量', '机会数'] },
    { name: 'total_amount', label: 'Total Amount', aggregate: 'sum', field: 'amount', format: '0,0', synonyms: ['deal value', 'opportunity amount', '商机金额', '金额合计'] },
    { name: 'avg_amount', label: 'Avg Deal Size', aggregate: 'avg', field: 'amount', format: '0,0', synonyms: ['average deal value', 'average opportunity amount', '平均商机金额'] },
  ],
};
const CRM_LINE_ITEM_METRICS = {
  name: 'crm_line_item_metrics',
  label: 'Line Item Metrics',
  object: 'crm_opportunity_line_item',
  // `deal count` is also `opp_count`'s synonym in the other dataset: a word equal to a measure there and a dimension here.
  dimensions: [{ name: 'product', label: 'Product', field: 'product', type: 'string', synonyms: ['deal count'] }],
  measures: [
    { name: 'line_amount', label: 'Line Amount', aggregate: 'sum', field: 'amount', synonyms: ['deal value', '明细金额'] },
    { name: 'quantity_total', label: 'Quantity', aggregate: 'sum', field: 'quantity' },
  ],
};
const loadCrm = async () => [CRM_OPPORTUNITY_METRICS, CRM_LINE_ITEM_METRICS];
const REP = { userId: 'u_rep', tenantId: 'org_a' } as ExecutionContext;
/** The members u_rep may not read (each over `amount`), by every word a sentence could name them with. */
const WITHHELD_WORDS = ['Total Amount', 'total_amount', 'Avg Deal Size', 'avg_amount', 'Line Amount', 'line_amount'];
/** Ruling B's ask-first instruction for a left-out word with candidates, by the locale the context names. */
const ASK_FIRST: Record<string, string> = {
  en: 'ask the user which one is meant before using it; do not pick one',
  'zh-CN': '先问用户指的是哪一个再使用；不要替用户选',
  'zh-TW': '先問使用者指的是哪一個再使用；不要替使用者選',
  'ja-JP': '使う前にどれを指しているかユーザーに確認してください。代わりに選ばないでください',
};
const FOUR_LOCALES = [ADMIN, { ...ADMIN, locale: 'zh-CN' }, { ...ADMIN, locale: 'zh-TW' }, { ...ADMIN, locale: 'ja-JP' }] as ExecutionContext[];

type ListOut = Awaited<ReturnType<ReturnType<AnalyticsService['datasetTools']>['listDatasets']>>;

/**
 * The invariants `DatasetNextStepSchema` names and cannot refuse: the answer
 * parses; `nextStep` is present exactly when terms were sent; every term it
 * names was sent; a `candidates_only` term has entries in `candidates`; a
 * measure case's terms have measure entries in `matches`.
 */
function expectNextStepInvariants(out: ListOut, sent: readonly string[] | undefined) {
  expect(ListDatasetsOutputSchema.safeParse(out).success).toBe(true);
  if (sent === undefined || sent.length === 0) {
    expect('nextStep' in out).toBe(false);
    return;
  }
  const step = out.nextStep!;
  expect(step).toBeDefined();
  for (const term of step.terms) {
    expect(sent).toContain(term);
    // Distinct members: a word sent twice repeats its entries in `matches`.
    const measureHits = [...new Set(out.datasets.flatMap((d) => (d.matches ?? [])
      .filter((m) => m.term === term && m.member.startsWith('measures.'))
      .map((m) => `${d.name}.${m.member}`)))];
    const offered = (out.candidates ?? []).filter((c) => c.term === term);
    if (step.decision === 'one_measure') expect(measureHits).toHaveLength(1);
    if (step.decision === 'several_measures') expect(measureHits.length).toBeGreaterThan(1);
    if (step.decision === 'candidates_only') expect([measureHits.length, offered.length > 0]).toEqual([0, true]);
    if (step.decision === 'no_measure') expect([measureHits.length, offered.length]).toEqual([0, 0]);
  }
  expect(new Set(step.terms).size).toBe(step.terms.length);
}

describe('[#34919] list_datasets nextStep on examples/app-crm — the decision each word gets', () => {
  async function ask(terms: string[] | undefined, ctx: ExecutionContext = ADMIN) {
    const { service } = await bootWired();
    const out = await service.datasetTools({ loadDatasets: loadCrm }).listDatasets(terms === undefined ? {} : { terms }, ctx);
    expectNextStepInvariants(out, terms);
    return out;
  }

  it('a word with one match ⇒ one_measure, naming the measure, its dataset and the names to query', async () => {
    const out = await ask(['商机数']);
    expect(out.nextStep).toMatchObject({ decision: 'one_measure', terms: ['商机数'] });
    expect(out.nextStep!.note).toContain('Opportunities (dataset: Opportunity Metrics)');
    expect(out.nextStep!.note).toContain('"crm_opportunity_metrics"');
    expect(out.nextStep!.note).toContain('"opp_count"');
  });

  it('one_measure beside a near-miss word: the measure is computed and the note names the left-out word with its candidates (ruling B)', async () => {
    const CANDIDATES = ['Total Amount', 'Avg Deal Size', 'Line Amount'];
    for (const ctx of [ADMIN, { ...ADMIN, locale: 'zh-CN' }, { ...ADMIN, locale: 'zh-TW' }, { ...ADMIN, locale: 'ja-JP' }] as ExecutionContext[]) {
      const out = await ask(['商机数', '金额'], ctx);
      expect(out.nextStep).toMatchObject({ decision: 'one_measure', terms: ['商机数'] });
      const note = out.nextStep!.note;
      expect(note, String(ctx.locale)).toContain('"opp_count"');
      expect(note, String(ctx.locale)).toContain('金额');
      for (const label of [...CANDIDATES, 'Line Item Metrics']) expect(note, `${ctx.locale} ⇒ ${label}`).toContain(label);
      // Ruling B's ask-first sentence, after the candidates it is about.
      const ask1st = ASK_FIRST[String(ctx.locale ?? 'en')];
      expect(note, `${ctx.locale} ⇒ ask first`).toContain(ask1st);
      expect(note.indexOf(ask1st), String(ctx.locale)).toBeGreaterThan(note.indexOf('Line Item Metrics'));
    }
    expect((await ask(['商机数', '金额'])).nextStep!.note).toContain('Total Amount (dataset: Opportunity Metrics)');
    // The control: alone, the measure word's note asks nothing first.
    expect((await ask(['商机数'])).nextStep!.note).not.toContain(ASK_FIRST.en);
  });

  it('one_measure beside an unknown word and a grouping word: the note keeps the unknown word\'s labelled fallback and names the grouping', async () => {
    for (const ctx of [ADMIN, { ...ADMIN, locale: 'zh-CN' }, { ...ADMIN, locale: 'zh-TW' }, { ...ADMIN, locale: 'ja-JP' }] as ExecutionContext[]) {
      const out = await ask(['商机数', '库存周转', '销售阶段'], ctx);
      expect(out.nextStep).toMatchObject({ decision: 'one_measure', terms: ['商机数'] });
      const note = out.nextStep!.note;
      expect(note, String(ctx.locale)).toContain('库存周转');
      expect(note, String(ctx.locale)).toContain('query_records');
      expect(note, String(ctx.locale)).toContain('Stage');
    }
    expect((await ask(['商机数', '库存周转', '销售阶段'])).nextStep!.note).toContain('Stage (dataset: Opportunity Metrics)');
    // The control: alone, the measure word's note sends nobody to the object tools.
    expect((await ask(['商机数'])).nextStep!.note).not.toContain('query_records');
  });

  it('candidates_only beside an unknown word and a grouping word: the note names both, the unknown one with its labelled fallback (ruling B, seat S3)', async () => {
    for (const ctx of FOUR_LOCALES) {
      const out = await ask(['库存周转', '金额', '销售阶段'], ctx);
      expect(out.nextStep).toMatchObject({ decision: 'candidates_only', terms: ['金额'] });
      const note = out.nextStep!.note;
      for (const label of ['Total Amount', 'Avg Deal Size', 'Line Amount']) expect(note, `${ctx.locale} ⇒ ${label}`).toContain(label);
      expect(note, String(ctx.locale)).toContain('库存周转');
      expect(note, String(ctx.locale)).toContain('query_records');
      expect(note, String(ctx.locale)).toContain('Stage');
    }
    const two = await ask(['库存周转', '金额']);
    expect(two.nextStep).toMatchObject({ decision: 'candidates_only', terms: ['金额'] });
    expect(two.nextStep!.note).toContain('"库存周转" equals no measure and has no possible reading.');
    expect(two.nextStep!.note).toContain('no governed metric was used for them');
    expect((await ask(['金额', '销售阶段'])).nextStep!.note).toContain('Stage (dataset: Opportunity Metrics)');
    // The control: alone, the near-miss word's note sends nobody to the object tools.
    expect((await ask(['金额'])).nextStep!.note).not.toContain('query_records');
  });

  it('two words that equal the same measure are one metric, not "each its own"', async () => {
    const out = await ask(['商机数', '商机数量']);
    expect(out.nextStep).toMatchObject({ decision: 'one_measure', terms: ['商机数', '商机数量'] });
    expect(out.nextStep!.note).not.toContain('Each is its own metric');
    expect(out.nextStep!.note).toContain('using that measure');
    // The control: two words with two measures are two metrics.
    expect((await ask(['商机数', '商机金额'])).nextStep!.note).toContain('Each is its own metric');
  });

  it('a mixed no_measure note falls back for the unknown word and still asks which number the grouping word means', async () => {
    const out = await ask(['库存周转', '销售阶段']);
    expect(out.nextStep).toMatchObject({ decision: 'no_measure', terms: ['库存周转', '销售阶段'] });
    expect(out.nextStep!.note).toContain('query_records');
    expect(out.nextStep!.note).toContain('ask the user which number they mean');
  });

  it('a word with two matches ⇒ several_measures, the note naming each by its label and its dataset\'s label', async () => {
    const out = await ask(['deal value']);
    expect(out.nextStep).toMatchObject({ decision: 'several_measures', terms: ['deal value'] });
    expect(out.nextStep!.note).toContain('Total Amount (dataset: Opportunity Metrics)');
    expect(out.nextStep!.note).toContain('Line Amount (dataset: Line Item Metrics)');
  });

  it('a near-miss word ⇒ candidates_only, the note naming each offered member by its label and its dataset\'s label', async () => {
    const out = await ask(['金额']);
    expect(out.nextStep).toMatchObject({ decision: 'candidates_only', terms: ['金额'] });
    expect(out.candidates!.map((c) => c.member)).toEqual(['measures.total_amount', 'measures.avg_amount', 'measures.line_amount']);
    for (const named of ['Total Amount (dataset: Opportunity Metrics)', 'Avg Deal Size (dataset: Opportunity Metrics)', 'Line Amount (dataset: Line Item Metrics)']) {
      expect(out.nextStep!.note).toContain(named);
    }
  });

  it('an unknown word ⇒ no_measure, and the note sends the reader to the object tools', async () => {
    const out = await ask(['库存周转']);
    expect(out.nextStep).toMatchObject({ decision: 'no_measure', terms: ['库存周转'] });
    expect(out.nextStep!.note).toContain('query_records');
  });

  it('a word equal only to a dimension ⇒ no_measure, naming the grouping, and asks for the number instead of falling back', async () => {
    const out = await ask(['销售阶段']);
    expect(out.nextStep).toMatchObject({ decision: 'no_measure', terms: ['销售阶段'] });
    expect(out.nextStep!.note).toContain('Stage (dataset: Opportunity Metrics)');
    expect(out.nextStep!.note).not.toContain('query_records');
  });

  it('no terms, or an empty list, ⇒ no nextStep', async () => {
    await ask(undefined);
    await ask([]);
  });

  it('a withheld member appears in no decision and no sentence (N5)', async () => {
    // u_rep reads no `amount`: total_amount, avg_amount and line_amount are withheld.
    for (const terms of [['deal value'], ['金额'], ['商机金额', '销售阶段'], ['商机数', 'deal value', '金额']]) {
      const out = await ask(terms, REP);
      const text = JSON.stringify(out.nextStep);
      for (const word of WITHHELD_WORDS) expect(text, `${terms.join('+')} ⇒ ${word}`).not.toContain(word);
    }
    // What the same words read as for u_rep: the withheld equalities are gone, so nothing is a measure.
    expect((await ask(['deal value'], REP)).nextStep).toMatchObject({ decision: 'no_measure', terms: ['deal value'] });
    expect((await ask(['金额'], REP)).nextStep).toMatchObject({ decision: 'no_measure', terms: ['金额'] });
    // The control: the same words name those members for a caller who reads `amount`.
    expect((await ask(['deal value'])).nextStep!.note).toContain('Total Amount');
  });
});

describe('[#34919] list_datasets nextStep — the precedence among mixed cases', () => {
  async function decide(terms: string[]) {
    const { service } = await bootWired();
    const out = await service.datasetTools({ loadDatasets: loadCrm }).listDatasets({ terms }, ADMIN);
    expectNextStepInvariants(out, terms);
    return { decision: out.nextStep!.decision, terms: out.nextStep!.terms };
  }

  it('N1: a dimension-matched word never outranks a measure-matched one', async () => {
    expect(await decide(['商机金额', '销售阶段'])).toEqual({ decision: 'one_measure', terms: ['商机金额'] });
    expect(await decide(['销售阶段', '商机金额'])).toEqual({ decision: 'one_measure', terms: ['商机金额'] });
  });

  it('several_measures > one_measure > candidates_only > no_measure, naming every word in the reported case', async () => {
    expect(await decide(['商机数', 'deal value'])).toEqual({ decision: 'several_measures', terms: ['deal value'] });
    expect(await decide(['金额', 'deal value'])).toEqual({ decision: 'several_measures', terms: ['deal value'] });
    expect(await decide(['deal value', '库存周转'])).toEqual({ decision: 'several_measures', terms: ['deal value'] });
    expect(await decide(['金额', '商机数'])).toEqual({ decision: 'one_measure', terms: ['商机数'] });
    expect(await decide(['库存周转', '金额'])).toEqual({ decision: 'candidates_only', terms: ['金额'] });
    expect(await decide(['库存周转', '销售阶段'])).toEqual({ decision: 'no_measure', terms: ['库存周转', '销售阶段'] });
    // Two words with one measure each are two metrics: both named, in the order sent.
    expect(await decide(['商机金额', '商机数', '销售阶段'])).toEqual({ decision: 'one_measure', terms: ['商机金额', '商机数'] });
  });

  it('a word equal to one measure and to a dimension is one_measure: the dimension is not counted', async () => {
    expect(await decide(['deal count'])).toEqual({ decision: 'one_measure', terms: ['deal count'] });
  });

  it('a word sent twice is one word, and the member it equals is counted once', async () => {
    expect(await decide(['商机数', '商机数'])).toEqual({ decision: 'one_measure', terms: ['商机数'] });
  });
});

describe('[#34919] list_datasets nextStep — an incomplete catalogue says so (N4)', () => {
  it('a degraded read keeps nextStep over what it lists and ends the note by saying the catalogue was incomplete', async () => {
    const { service } = await bootWired();
    const whole = await service.datasetTools({ loadDatasets: loadCrm }).listDatasets({ terms: ['商机数'] }, ADMIN);
    const degraded = await service.datasetTools({
      loadDatasets: async () => ({ items: [CRM_OPPORTUNITY_METRICS], partial: true as const, warning: 'one source unavailable' }),
    }).listDatasets({ terms: ['商机数'] }, ADMIN);
    expectNextStepInvariants(degraded, ['商机数']);
    expect(degraded).toMatchObject({ partial: true, nextStep: { decision: 'one_measure', terms: ['商机数'] } });
    // The whole read's sentence, plus one closing sentence naming the warning.
    expect(degraded.nextStep!.note.startsWith(whole.nextStep!.note)).toBe(true);
    const added = degraded.nextStep!.note.slice(whole.nextStep!.note.length);
    expect(added).toContain('incomplete');
    expect(added).toContain('warning');
    expect(whole.nextStep!.note).not.toContain('incomplete');
  });

  it('a catalogue that could not be read at all answers no_measure for every word, and says the catalogue was incomplete', async () => {
    const { service } = await bootWired();
    const failed = await service.datasetTools({ loadDatasets: async () => { throw new Error('metadata loader down'); } })
      .listDatasets({ terms: ['商机数', '销售阶段'] }, ADMIN);
    expectNextStepInvariants(failed, ['商机数', '销售阶段']);
    expect(failed).toMatchObject({ datasets: [], partial: true, nextStep: { decision: 'no_measure', terms: ['商机数', '销售阶段'] } });
    expect(failed.nextStep!.note).toContain('incomplete');
  });

  it('an admission that could not be judged is a partial answer too, and its note says so', async () => {
    const { service } = await bootWired();
    vi.spyOn(service, 'admitDatasetCatalogEntry').mockImplementation(async () => ({ admitted: false, unresolved: true }) as never);
    const out = await service.datasetTools({ loadDatasets: loadCrm }).listDatasets({ terms: ['商机数'] }, ADMIN);
    expect(out).toMatchObject({ partial: true, nextStep: { decision: 'no_measure' } });
    expect(out.nextStep!.note).toContain('incomplete');
  });
});

describe('[#34919] the sentences are in the caller\'s language, by the user-text ladder', () => {
  it('reads the request locale, then the workspace default, through the platform locale table; en below both', () => {
    expect(datasetToolSentenceLocale(['zh-CN'])).toBe('zh-Hans');
    expect(datasetToolSentenceLocale(['zh-TW'])).toBe('zh-Hant');
    expect(datasetToolSentenceLocale(['zh-Hant-HK'])).toBe('zh-Hant');
    expect(datasetToolSentenceLocale(['ja-JP'])).toBe('ja');
    expect(datasetToolSentenceLocale(['en-GB'])).toBe('en');
    // A language with no sentences takes the next rung: the workspace default, then en.
    expect(datasetToolSentenceLocale(['fr-FR', 'ja-JP'])).toBe('ja');
    expect(datasetToolSentenceLocale(['fr-FR'])).toBe('en');
    expect(datasetToolSentenceLocale([])).toBe('en');
  });

  it('the executor writes the note for the context\'s locale, then its workspace default', async () => {
    const { service } = await bootWired();
    const tools = service.datasetTools({ loadDatasets: loadCrm });
    const notes: Record<string, string> = {};
    for (const [key, ctx] of Object.entries({
      en: ADMIN,
      zh: { ...ADMIN, locale: 'zh-CN' },
      hant: { ...ADMIN, locale: 'zh-TW' },
      ja: { ...ADMIN, locale: 'ja-JP' },
      frThenJa: { ...ADMIN, locale: 'fr-FR', workspaceLocale: 'ja-JP' },
    } as Record<string, ExecutionContext>)) {
      const out = await tools.listDatasets({ terms: ['deal value'] }, ctx);
      expect(out.nextStep!.decision).toBe('several_measures');
      notes[key] = out.nextStep!.note;
    }
    expect(new Set([notes.en, notes.zh, notes.hant, notes.ja]).size).toBe(4);
    expect(notes.frThenJa).toBe(notes.ja);
    // Every language still names both members by label and dataset label.
    for (const note of Object.values(notes)) {
      for (const label of ['Total Amount', 'Opportunity Metrics', 'Line Amount', 'Line Item Metrics']) expect(note).toContain(label);
    }
  });
});

describe('[#34919] query_dataset sourceLine — the provenance as one finished line', () => {
  it('is composed from the answer\'s provenance, in the caller\'s language, and parses', async () => {
    const { service } = await bootWired([{ stage: 'won', revenue: 100 }]);
    const tools = service.datasetTools({ loadDatasets: loadSaved });
    const out = await tools.queryDataset({ datasetName: 'pipeline', selection: { measures: ['revenue'], dimensions: ['stage'] } }, ME);
    expect(out.sourceLine).toBe(composeDatasetSourceLine(out.provenance, ['zh-CN']));
    for (const label of ['营收', '销售分析', 'Stage']) expect(out.sourceLine).toContain(label);
    const admin = await tools.queryDataset({ datasetName: 'pipeline', selection: { measures: ['revenue'] } }, ADMIN);
    expect(admin.sourceLine).toBe(composeDatasetSourceLine(admin.provenance, []));
    for (const label of ['Revenue', 'Pipeline']) expect(admin.sourceLine).toContain(label);
    for (const answer of [out, admin]) expect(QueryDatasetOutputSchema.safeParse(answer).success).toBe(true);
  });

  it('names no member the caller was not admitted to (N5): a withheld measure is refused before any line exists', async () => {
    const { service } = await bootWired([{ stage: 'won', opp_count: 3 }]);
    const tools = service.datasetTools({ loadDatasets: loadCrm });
    const out = await tools.queryDataset({ datasetName: 'crm_opportunity_metrics', selection: { measures: ['opp_count'], dimensions: ['stage'] } }, REP);
    for (const label of ['Opportunities', 'Opportunity Metrics', 'Stage']) expect(out.sourceLine).toContain(label);
    for (const word of WITHHELD_WORDS) expect(out.sourceLine).not.toContain(word);
    await expect(tools.queryDataset({ datasetName: 'crm_opportunity_metrics', selection: { measures: ['total_amount'] } }, REP))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
  });
});
