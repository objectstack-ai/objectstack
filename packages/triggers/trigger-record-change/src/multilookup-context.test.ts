// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #1872 — a multi-value (`multiple: true`) lookup is an array column the driver
 * may not echo back on create, so it was absent from the after-create record the
 * record-change flow sees (condition / interpolation on it resolved empty). The
 * trigger now merges the input doc under the after-row so fields the driver
 * didn't return are still available.
 */
import { describe, it, expect } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { RecordChangeTriggerPlugin } from './plugin.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Memory driver whose create() does NOT echo `target_channels` (simulates a
 *  driver that doesn't return the multi-lookup array column). */
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
      // Echo everything EXCEPT the multi-lookup column (the #1872 gap).
      const { target_channels, ...echoed } = full;
      return echoed;
    },
    async update(_o: string, id: string, data: any) { const cur = store.get(id) ?? {}; const u = { ...cur, ...data, id }; store.set(id, u); return u; },
    async find(_o: string, ast: any) { return [...store.values()].filter((r) => matches(r, ast?.where)); },
    async findOne(_o: string, ast: any) { for (const r of store.values()) if (matches(r, ast?.where)) return r; return null; },
    async delete(_o: string, id: string) { return store.delete(id); },
    async count(_o: string, ast: any) { return (await this.find(_o, ast)).length; },
    async upsert(_o: string, d: any) { return this.create(_o, d); },
    async bulkCreate(_o: string, rows: any[]) { return Promise.all(rows.map((r) => this.create(_o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
}

describe('record-change context hydrates multi-lookup from input (#1872)', () => {
  it('fires a record-after-create flow gated on a multi-lookup the driver did not echo', async () => {
    const kernel = new ObjectKernel({ logLevel: 'silent' });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin());
    await kernel.use(new RecordChangeTriggerPlugin());
    await kernel.bootstrap();

    const objectql = kernel.getService('objectql') as any;
    const data = kernel.getService('data') as any;
    const automation = kernel.getService<AutomationEngine>('automation');
    objectql.registerDriver(makeDriver(), true);
    objectql.registry.registerObject({
      name: 'piece', label: 'Piece',
      fields: {
        title: { name: 'title', label: 'T', type: 'text' },
        target_channels: { name: 'target_channels', label: 'Ch', type: 'lookup', reference: 'channel', multiple: true },
        stamp: { name: 'stamp', label: 'S', type: 'text' },
      },
    }, 'test', 'test');

    automation.registerFlow('cta_default', {
      name: 'cta_default', label: 'CTA', type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { objectName: 'piece', triggerType: 'record-after-create', condition: 'record.target_channels != null' } },
        { id: 'stamp', type: 'update_record', label: 'Stamp', config: { objectName: 'piece', filter: { id: '{record.id}' }, fields: { stamp: '{record.target_channels.0}' } } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [ { id: 'e1', source: 'start', target: 'stamp' }, { id: 'e2', source: 'stamp', target: 'end' } ],
    } as any);

    const created = await data.insert('piece', { title: 'X', target_channels: ['ch_1', 'ch_2'] });
    const id = Array.isArray(created) ? created[0]?.id : created?.id ?? created;
    await sleep(200);
    const row = await data.findOne('piece', { where: { id } });
    console.log('[dbg] row=', JSON.stringify(row));
    // Flow fired (condition saw target_channels) AND `{record.target_channels.0}` resolved.
    expect(row?.stamp).toBe('ch_1');
  }, 15000);
});
