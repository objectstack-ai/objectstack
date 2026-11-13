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
 */

import { describe, it, expect, vi } from 'vitest';
import { getDatasetToolJsonSchemas } from '@objectstack/spec/ai';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsServicePlugin } from '../plugin.js';
import { AnalyticsService } from '../analytics-service.js';
import { createDatasetTools, getDatasetToolDefinitions } from '../dataset-tools.js';

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

/** The security double: u_me may not read `crm_locked` nor the `margin` field; u_admin reads everything. */
const security = {
  getReadFilter: async () => undefined,
  canReadObject: (object: string, ctx?: ExecutionContext) => !(ctx?.userId === 'u_me' && object === 'crm_locked'),
  getReadableFields: async (object: string, ctx?: ExecutionContext) => {
    const all = Object.keys(OBJECTS[object]?.fields ?? {});
    return ctx?.userId === 'u_me' ? all.filter((f) => f !== 'margin') : all;
  },
  getQueryableFields: async (object: string, ctx?: ExecutionContext) => {
    const all = Object.keys(OBJECTS[object]?.fields ?? {});
    return ctx?.userId === 'u_me' ? all.filter((f) => f !== 'margin') : all;
  },
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
