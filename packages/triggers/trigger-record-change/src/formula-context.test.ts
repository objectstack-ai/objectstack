// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3426 — a `formula` field is a virtual the engine evaluates post-fetch. It
 * used to be evaluated on `find`/`findOne` ONLY, so it was absent from the raw
 * after-create/after-update row a record-change flow is seeded with, and
 * `{record.full_name}` in a notify template (or a start condition) resolved to
 * an empty string. The trigger fixed that by re-reading the written record
 * through the data engine, so the seeded `record` carries the same computed
 * fields a data-API read returns.
 *
 * #5504 later hydrated the write path's own return value as well, so the raw
 * row is no longer the empty half of that pair. The re-read still earns its
 * keep — `summary` / `rollup` virtuals and hook-side effects are only visible
 * through a read — and this test keeps pinning the trigger's contract: the
 * seeded record resolves computed fields, whatever the write path returned.
 *
 * This exercises the whole stack (real ObjectQL + automation + record-change
 * trigger) with a formula field, proving the seeded record resolves it. The
 * notify node interpolates the very same variable map, so a formula that
 * resolves for `update_record` here resolves for a notify `title`/`body` too.
 */
import { describe, it, expect } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { RecordChangeTriggerPlugin } from './plugin.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Memory driver storing full rows. Formula virtuals are computed by the
 *  ENGINE post-fetch, never by the driver — so `full_name` is never stored. */
function makeDriver(): any {
  const store = new Map<string, Record<string, unknown>>();
  let n = 0;
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      const exp = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (exp ?? null)) return false;
    }
    return true;
  };
  return {
    name: 'memory', version: '0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; }, async syncSchema() {},
    async create(_o: string, data: any) {
      n += 1; const id = data.id ?? `r_${n}`;
      const full = { ...data, id };
      store.set(id, full);
      return { ...full };
    },
    async update(_o: string, id: string, data: any) { const cur = store.get(id) ?? {}; const u = { ...cur, ...data, id }; store.set(id, u); return { ...u }; },
    async find(_o: string, ast: any) { return [...store.values()].filter((r) => matches(r, ast?.where)).map((r) => ({ ...r })); },
    async findOne(_o: string, ast: any) { for (const r of store.values()) if (matches(r, ast?.where)) return { ...r }; return null; },
    async delete(_o: string, id: string) { return store.delete(id); },
    async count(_o: string, ast: any) { return (await this.find(_o, ast)).length; },
    async upsert(_o: string, d: any) { return this.create(_o, d); },
    async bulkCreate(_o: string, rows: any[]) { return Promise.all(rows.map((r) => this.create(_o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
}

describe('record-change context hydrates read-time formula fields (#3426)', () => {
  it('resolves a formula field ({record.full_name}) in a seeded flow record', async () => {
    const kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin());
    await kernel.use(new RecordChangeTriggerPlugin());
    await kernel.bootstrap();

    const objectql = kernel.getService('objectql') as any;
    const data = kernel.getService('data') as any;
    const automation = kernel.getService<AutomationEngine>('automation');
    objectql.registerDriver(makeDriver(), true);
    objectql.registry.registerObject({
      name: 'crm_lead', label: 'Lead',
      fields: {
        first_name: { name: 'first_name', label: 'First', type: 'text' },
        last_name: { name: 'last_name', label: 'Last', type: 'text' },
        // Read-time formula virtual — never present on the raw written row.
        full_name: {
          name: 'full_name', label: 'Full name', type: 'formula',
          expression: { dialect: 'cel', source: 'record.first_name + " " + record.last_name' },
        },
        greeting: { name: 'greeting', label: 'Greeting', type: 'text' },
      },
    }, 'test', 'test');

    // On create, stamp `greeting` from the formula field. Before the fix this
    // stamped '' because `{record.full_name}` was blank in the seeded record.
    automation.registerFlow('lead_greeting', {
      name: 'lead_greeting', label: 'Greeting', type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { objectName: 'crm_lead', triggerType: 'record-after-create' } },
        { id: 'stamp', type: 'update_record', label: 'Stamp', config: { objectName: 'crm_lead', filter: { id: '{record.id}' }, fields: { greeting: 'Hello, {record.full_name}!' } } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [ { id: 'e1', source: 'start', target: 'stamp' }, { id: 'e2', source: 'stamp', target: 'end' } ],
    } as any);

    const created = await data.insert('crm_lead', { first_name: 'Ada', last_name: 'Lovelace' }, { context: { userId: 'u_trigger' } });
    const id = Array.isArray(created) ? created[0]?.id : created?.id ?? created;
    await sleep(200);
    const row = await data.findOne('crm_lead', { where: { id } });
    expect(row?.full_name).toBe('Ada Lovelace'); // read-path sanity
    expect(row?.greeting).toBe('Hello, Ada Lovelace!'); // flow saw the formula
  }, 15000);
});
