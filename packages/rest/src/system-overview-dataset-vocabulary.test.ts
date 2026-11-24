// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0149 D1/D3] The platform's own System Overview datasets answer an
 * administrator's words through `list_datasets`.
 *
 * The five datasets (`@objectstack/platform-objects/apps`) reach the dataset
 * AI tools only through plugin-auth's runtime manifest, where the vocabulary
 * advisory never reads them. This file feeds the REAL datasets, localized by
 * the REAL Setup bundle through `translateDataset` (the resolver the metadata
 * boundary applies to a `dataset` list read), to the REAL `list_datasets`
 * executor of a service booted by `AnalyticsServicePlugin`. The objects behind
 * the datasets are declaration doubles carrying the columns each dataset reads,
 * every one readable: admission is pinned in `@objectstack/service-analytics`,
 * and this file asks only what the declared words resolve to.
 *
 * The matcher compares a term by EQUALITY after `normalizeDatasetTerm`, so a
 * multi-word phrase ("how many users") resolves only because a member writes
 * that phrase as one synonym; a term no member writes still misses.
 */

import { describe, it, expect } from 'vitest';
import { AnalyticsServicePlugin, type AnalyticsService } from '@objectstack/service-analytics';
import { SetupAppTranslations, SystemOverviewDatasets } from '@objectstack/platform-objects/apps';
import type { ListDatasetsOutput } from '@objectstack/spec/ai';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { translateDataset } from '@objectstack/spec/system';

/** The columns each System Overview dataset reads, on its base object. */
const OBJECTS: Record<string, { fields: Record<string, { type: string }> }> = {
  sys_user: { fields: { id: { type: 'text' } } },
  sys_organization: { fields: { id: { type: 'text' } } },
  sys_session: { fields: { id: { type: 'text' } } },
  sys_package_installation: { fields: { id: { type: 'text' } } },
  sys_audit_log: { fields: { id: { type: 'text' }, action: { type: 'text' }, user_id: { type: 'lookup' } } },
};

const security = {
  getReadFilter: async () => undefined,
  canReadObject: async () => true,
  getReadableFields: async (object: string) => Object.keys(OBJECTS[object]?.fields ?? {}),
  getQueryableFields: async (object: string) => Object.keys(OBJECTS[object]?.fields ?? {}),
};

async function bootAnalytics(): Promise<AnalyticsService> {
  const registered: Record<string, unknown> = {};
  const engine = {
    execute: async () => ({ rows: [] }),
    hasObjectMiddleware: () => false,
    getObject: (name: string) => OBJECTS[name],
    resolveEffectiveDatasource: () => undefined,
  };
  const ctx = {
    getService: (name: string) => {
      if (name === 'security') return security;
      if (name === 'data') return engine;
      return registered[name];
    },
    registerService: (name: string, svc: unknown) => { registered[name] = svc; },
    replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };
  await new AnalyticsServicePlugin().init(ctx as never);
  return registered.analytics as AnalyticsService;
}

async function listFor(locale: string, terms: string[]): Promise<ListDatasetsOutput> {
  const service = await bootAnalytics();
  const tools = service.datasetTools({
    loadDatasets: async () => SystemOverviewDatasets.map((d) => translateDataset(d, SetupAppTranslations, { locale })),
  });
  const caller = { userId: 'u_admin', tenantId: 'org_a', locale } as ExecutionContext;
  return tools.listDatasets({ terms }, caller);
}

/** Every match the answer reports, as `dataset.member` per term. */
function hits(answer: ListDatasetsOutput): Array<{ term: string; at: string; matchedOn: string }> {
  return answer.datasets.flatMap((d) =>
    (d.matches ?? []).map((m) => ({ term: m.term, at: `${d.name}.${m.member}`, matchedOn: m.matchedOn })));
}

describe('[ADR-0149 D1/D3] list_datasets over the System Overview datasets', () => {
  it('lists all five datasets with every member', async () => {
    const answer = await listFor('en', ['用户数']);
    expect(answer.partial).toBeUndefined();
    expect(answer.datasets.map((d) => d.name).sort()).toEqual(SystemOverviewDatasets.map((d) => d.name).sort());
  });

  for (const locale of ['en', 'zh-CN']) {
    it(`${locale}: 「用户数」 resolves to user_count alone, by its declared synonym`, async () => {
      const answer = await listFor(locale, ['用户数']);
      expect(hits(answer)).toEqual([
        { term: '用户数', at: 'sys_user_metrics.measures.user_count', matchedOn: 'synonym' },
      ]);
      expect(answer.candidates).toBeUndefined();
    });

    it(`${locale}: "how many users" resolves to user_count alone, by its declared synonym`, async () => {
      const answer = await listFor(locale, ['how many users']);
      expect(hits(answer)).toEqual([
        { term: 'how many users', at: 'sys_user_metrics.measures.user_count', matchedOn: 'synonym' },
      ]);
      expect(answer.candidates).toBeUndefined();
    });

    it(`${locale}: a word no member declares still misses`, async () => {
      const answer = await listFor(locale, ['营收', 'revenue']);
      expect(hits(answer)).toEqual([]);
      expect(answer.candidates).toBeUndefined();
    });
  }

  it('zh-CN: the catalogue lists each member\'s description at the caller\'s locale', async () => {
    const answer = await listFor('zh-CN', []);
    const users = answer.datasets.find((d) => d.name === 'sys_user_metrics')?.measures.find((m) => m.name === 'user_count');
    const bundled = SetupAppTranslations['zh-CN']?.datasets?.sys_user_metrics?.measures?.user_count?.description;
    expect(bundled).toBeTypeOf('string');
    expect(users?.description).toBe(bundled);
  });
});
