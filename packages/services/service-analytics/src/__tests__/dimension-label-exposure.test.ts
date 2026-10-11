// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22661] The dataset door's dimension-label passes read a SECOND object — the
 * target a reference-class dimension points at — and ask that target the
 * spec's one exposure decision (`apiExposureDenialReason(enable, 'get')`,
 * ADR-0049) before reading it. A target the decision does not serve is never
 * read: the display pass leaves the stored id in the row, and the sort-key pass
 * orders by it — the answer a target the reader's row scope hides already gets.
 *
 * Both passes are driven through `AnalyticsService.queryDataset` with the
 * generic-exit declaration probe wired, the way `AnalyticsServicePlugin` wires
 * it. Each withheld shape is paired with a CONTROL the decision serves (the
 * names render and sort), and a select dimension beside the lookup keeps its
 * option labels — the gate is about the second object, not about labels. The
 * real plugin bridge, for an administrator and a member, is pinned in
 * `@objectstack/dogfood`.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import type { DimensionLabelDeps, FieldMetaLite } from '../dimension-labels.js';
import type { ObjectDeclaration } from '../api-exposure-door.js';

const CTX = { tenantId: 'org_A' } as ExecutionContext;
const TARGET = 'lx_account';

const byAccount = DatasetSchema.parse({
  name: 'deals_by_account', label: 'Deals', object: 'lx_deal', include: [],
  dimensions: [
    { name: 'account', field: 'account', type: 'lookup', label: 'Account' },
    { name: 'stage', field: 'stage', type: 'string', label: 'Stage' },
  ],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
});

const FIELDS: Record<string, Record<string, FieldMetaLite>> = {
  lx_deal: {
    account: { type: 'lookup', reference: TARGET },
    stage: { type: 'select', options: [{ value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }] },
    amount: { type: 'number' },
  },
  [TARGET]: { name: { type: 'text' } },
};

/**
 * Three orders that all disagree: by id (a1, b2, c3), by name (b2 Apple, c3
 * Mango, a1 Zebra), and as the strategy returns the rows (c3, a1, b2) — so a
 * sort by the stored id, a sort by the withheld name, and no sort at all are
 * three different answers.
 */
const NAMES: Record<string, string> = { a1: 'Zebra', b2: 'Apple', c3: 'Mango' };
const ROWS = [
  { account: 'c3', stage: 'won', revenue: 30 },
  { account: 'a1', stage: 'won', revenue: 10 },
  { account: 'b2', stage: 'lost', revenue: 20 },
];

function service(targetEnable: Record<string, unknown> | undefined, opts: { throwOnTarget?: boolean; probe?: boolean } = {}) {
  const fetched: string[] = [];
  const labelResolver: DimensionLabelDeps = {
    getObjectFields: (obj) => FIELDS[obj],
    fetchRecordLabels: async (target, ids) => {
      fetched.push(target);
      const m = new Map<unknown, string>();
      for (const id of ids) if (NAMES[String(id)]) m.set(id, NAMES[String(id)]);
      return m;
    },
  };
  const getObjectDeclaration = (name: string): ObjectDeclaration | undefined => {
    if (name === TARGET) {
      if (opts.throwOnTarget) throw new Error('declaration store unavailable');
      return { enable: targetEnable, fields: FIELDS[TARGET] };
    }
    return name === 'lx_deal' ? { fields: FIELDS.lx_deal } : undefined;
  };
  const svc = new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async () => ROWS.map((r) => ({ ...r })),
    labelResolver,
    ...(opts.probe === false ? {} : { getObjectDeclaration }),
  });
  return { svc, fetched };
}

async function displayPass(svc: AnalyticsService) {
  const result = await svc.queryDataset(byAccount, { dimensions: ['account', 'stage'], measures: ['revenue'] }, CTX);
  return result.rows.map((r) => [r.account, r.stage]);
}

async function sortKeyPass(svc: AnalyticsService) {
  const result = await svc.queryDataset(byAccount, { dimensions: ['account'], measures: ['revenue'], order: { account: 'asc' } }, CTX);
  return result.rows.map((r) => r.account);
}

const WITHHELD: Array<[string, Record<string, unknown>]> = [
  ['apiEnabled: false (a whitelist granting get beside it changes nothing)', { apiEnabled: false, apiMethods: ['get'] }],
  ['a whitelist that grants no read', { apiMethods: ['create'] }],
  ['the deny-all whitelist', { apiMethods: [] }],
  ['a whitelist that grants list but not get', { apiMethods: ['list'] }],
];

const SERVED: Array<[string, Record<string, unknown> | undefined]> = [
  ['no enable block', undefined],
  ['a whitelist that grants get', { apiMethods: ['get'] }],
];

describe('[#22661] a dimension label reads only a target the API serves', () => {
  for (const [label, enable] of WITHHELD) {
    it(`${label}: the display pass renders the stored ids and never reads the target`, async () => {
      const { svc, fetched } = service(enable);
      expect(await displayPass(svc)).toEqual([['c3', 'Won'], ['a1', 'Won'], ['b2', 'Lost']]);
      expect(fetched).toEqual([]);
    });
    it(`${label}: the sort-key pass orders by the stored ids and never reads the target`, async () => {
      const { svc, fetched } = service(enable);
      expect(await sortKeyPass(svc)).toEqual(['a1', 'b2', 'c3']);
      expect(fetched).toEqual([]);
    });
  }

  for (const [label, enable] of SERVED) {
    it(`CONTROL ${label}: both passes read the target, and the names render and sort`, async () => {
      const { svc, fetched } = service(enable);
      expect(await displayPass(svc)).toEqual([['Mango', 'Won'], ['Zebra', 'Won'], ['Apple', 'Lost']]);
      expect(await sortKeyPass(svc)).toEqual(['Apple', 'Mango', 'Zebra']);
      expect(fetched.length).toBeGreaterThan(0);
      expect(new Set(fetched)).toEqual(new Set([TARGET]));
    });
  }

  it('a declaration that cannot be read withholds the labels (fail-closed); the query still answers', async () => {
    const { svc, fetched } = service(undefined, { throwOnTarget: true });
    expect(await displayPass(svc)).toEqual([['c3', 'Won'], ['a1', 'Won'], ['b2', 'Lost']]);
    expect(fetched).toEqual([]);
  });

  it('CONTROL no declaration probe wired: no gate, the names render (the query face reports the stand-down)', async () => {
    const { svc } = service({ apiEnabled: false }, { probe: false });
    expect(await displayPass(svc)).toEqual([['Mango', 'Won'], ['Zebra', 'Won'], ['Apple', 'Lost']]);
  });
});
