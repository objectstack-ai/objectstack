// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A write refusal names a field, an option and an object in the language of
 * the request with the rule the metadata route serves the same labels by
 * (`ResolveOptions` over the deployment's translations, `@objectstack/spec/system`):
 * a request in the deployment's declared `i18n.sourceLocale` reads the label
 * as the author wrote it, and is never answered from the `defaultLocale` row.
 *
 * The scenario: an app authored in English (`sourceLocale: 'en'`) that
 * defaults its users to Chinese (`defaultLocale: 'zh-CN'`) and declares no
 * `fallbackLocale`, so the served adapter's fallback collapses to `zh-CN`
 * (`os serve` passes `fallbackLocale || defaultLocale`). It ships a `zh-CN`
 * bundle and no `en` one. `t('…label', 'en')` misses `en`, falls to `zh-CN`
 * and answers the Chinese row; `/meta` answers the English label. The refusal
 * must say what `/meta` says.
 *
 * CONTROLS: a `zh-CN` request still reads the `zh-CN` rows, and a deployment
 * that declares no `sourceLocale` answers an `en` request as before (its
 * authored language is `defaultLocale`, so `en` walks to the `zh-CN` row).
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

const account = {
  name: 'lsl_account',
  label: 'Account',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const, label: 'Name' },
  },
};
const deal = {
  name: 'lsl_deal',
  label: 'Deal',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    amount: { name: 'amount', type: 'currency' as const, label: 'Amount', min: 0 },
    stage: {
      name: 'stage',
      type: 'select' as const,
      label: 'Stage',
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'won', label: 'Won' },
      ],
    },
    account: {
      name: 'account', type: 'lookup' as const, reference: 'lsl_account',
      label: 'Owning Account', required: true,
    },
  },
  validations: [{
    type: 'state_machine',
    name: 'deal_stage_progression',
    message: '',
    field: 'stage',
    transitions: { draft: ['won'], won: [] },
  }],
};

/** The deployment ships `zh-CN` rows only. */
const ZH_CN = {
  objects: {
    lsl_account: { label: '客户', fields: { name: { label: '名称' } } },
    lsl_deal: {
      label: '商机',
      fields: {
        amount: { label: '金额' },
        stage: { label: '阶段', options: { draft: '草稿', won: '赢单' } },
        account: { label: '所属客户' },
      },
    },
  },
};

/** Every word of the `zh-CN` bundle — none may reach an `en` refusal. */
const ZH_WORDS = ['客户', '名称', '商机', '金额', '阶段', '草稿', '赢单', '所属客户'];

/**
 * The served adapter's shape (`FileI18nAdapter`): `t()` reads the requested
 * locale, then the declared fallback, then echoes the key; the getters report
 * the declaration as `os serve` hands it over.
 */
function servedI18n(declared: { defaultLocale: string; fallbackLocale?: string; sourceLocale?: string }) {
  const bundles: Record<string, Record<string, unknown>> = { 'zh-CN': ZH_CN };
  const fallback = declared.fallbackLocale ?? declared.defaultLocale;
  const read = (data: unknown, key: string): string | undefined => {
    let cur: unknown = data;
    for (const part of key.split('.')) {
      if (!cur || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return typeof cur === 'string' ? cur : undefined;
  };
  return {
    t: (key: string, locale: string) =>
      read(bundles[locale], key) ?? (fallback !== locale ? read(bundles[fallback], key) : undefined) ?? key,
    getLocales: () => Object.keys(bundles),
    getTranslations: (locale: string) => bundles[locale] ?? {},
    getDefaultLocale: () => declared.defaultLocale,
    getFallbackLocale: () => fallback,
    getSourceLocale: () => declared.sourceLocale,
  };
}

function makeStubDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => { let s = stores.get(o); if (!s) { s = new Map(); stores.set(o, s); } return s; };
  let nextId = 0;
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      const exp = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (exp ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(o: string, ast: any) {
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r; return null; },
    async create(o: string, data: Record<string, unknown>) {
      nextId += 1; const id = (data.id as string) ?? `r_${nextId}`; const row = { ...data, id }; storeFor(o).set(id, row); return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(o); const cur = s.get(id); if (!cur) throw new Error(`nf ${o}/${id}`);
      const up = { ...cur, ...data, id }; s.set(id, up); return up;
    },
    async upsert(o: string, data: Record<string, unknown>) { const id = data.id as string | undefined; return id && storeFor(o).has(id) ? this.update(o, id, data) : this.create(o, data); },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; }, async commit() {}, async rollback() {},
  };
  return driver;
}

async function makeEngine(i18n: ReturnType<typeof servedI18n>) {
  const engine = new ObjectQL();
  engine.registerDriver(makeStubDriver(), true);
  await engine.init();
  for (const o of [account, deal]) engine.registry.registerObject(o as any);
  engine.setI18nService(i18n);
  return engine;
}

async function refused(run: Promise<unknown>): Promise<any> {
  try {
    await run;
  } catch (e) {
    return e;
  }
  throw new Error('expected the write to be refused');
}

/** The three refusals of the card: a field, an option pair and two objects. */
async function refusalsIn(engine: ObjectQL, locale: string) {
  const context = { locale } as any;
  const acct = await engine.insert('lsl_account', { name: 'Acme' });
  const won = await engine.insert('lsl_deal', { amount: 10, stage: 'won', account: acct.id });
  const field = await refused(engine.insert('lsl_deal', { amount: -1, stage: 'draft', account: acct.id }, { context }));
  const option = await refused(engine.update('lsl_deal', { id: won.id, stage: 'draft' }, { context }));
  const object = await refused(engine.delete('lsl_account', { where: { id: acct.id }, context } as any));
  return { field, option, object };
}

const SOURCE_EN = { defaultLocale: 'zh-CN', sourceLocale: 'en' };

describe('a refusal in the declared sourceLocale names labels as authored', () => {
  it('field: an en write refusal names the field by its declared English label', async () => {
    const { field } = await refusalsIn(await makeEngine(servedI18n(SOURCE_EN)), 'en');
    expect(field.code).toBe('VALIDATION_FAILED');
    expect(field.fields[0]).toMatchObject({ field: 'amount', code: 'min_value', label: 'Amount' });
    expect(field.fields[0].message).toContain('Amount');
    for (const word of ZH_WORDS) expect(field.message).not.toContain(word);
  });

  it('option: an en invalid_transition names both states by their declared English labels', async () => {
    const { option } = await refusalsIn(await makeEngine(servedI18n(SOURCE_EN)), 'en');
    expect(option.code).toBe('VALIDATION_FAILED');
    expect(option.fields[0]).toMatchObject({
      field: 'stage', code: 'invalid_transition', label: 'Stage', constraint: { from: 'won', to: 'draft' },
    });
    expect(option.fields[0].message).toBe('Invalid transition for Stage: Won → Draft');
  });

  it('object: an en DELETE_RESTRICTED names both objects and the field by their declared English labels', async () => {
    const { object } = await refusalsIn(await makeEngine(servedI18n(SOURCE_EN)), 'en');
    expect(object).toMatchObject({ code: 'DELETE_RESTRICTED', status: 409 });
    for (const label of ['Account', 'Deal', 'Owning Account']) expect(object.message).toContain(label);
    for (const word of ZH_WORDS) expect(object.message).not.toContain(word);
  });

  it('CONTROL: a zh-CN request still reads the zh-CN rows', async () => {
    const { field, option, object } = await refusalsIn(await makeEngine(servedI18n(SOURCE_EN)), 'zh-CN');
    expect(field.fields[0].label).toBe('金额');
    expect(option.fields[0].message).toBe('阶段不允许从 赢单 变更为 草稿');
    for (const word of ['客户', '商机', '所属客户']) expect(object.message).toContain(word);
  });

  it('CONTROL: with no sourceLocale declared, an en request walks to the zh-CN row as before', async () => {
    const { field, option, object } = await refusalsIn(await makeEngine(servedI18n({ defaultLocale: 'zh-CN' })), 'en');
    expect(field.fields[0].label).toBe('金额');
    expect(option.fields[0].message).toBe('Invalid transition for 阶段: 赢单 → 草稿');
    for (const word of ['客户', '商机', '所属客户']) expect(object.message).toContain(word);
  });
});
