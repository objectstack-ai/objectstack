// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21613] TEMPORARY measurement probe — reverted before the fix lands.
 *
 * Does the audit ledger serve the engine's `previous` (the write path's prior
 * read) or `result`, and what happens to it when only the RESULT is shaped?
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { installAuditWriters } from './audit-writers.js';

const f = (name: string, type: string, extra: Record<string, unknown> = {}) =>
  ({ name, label: name, type, ...extra }) as any;

const sysAuditLog = {
  name: 'sys_audit_log', label: 'Audit Log',
  fields: {
    id: f('id', 'text', { primaryKey: true }), action: f('action', 'text'),
    user_id: f('user_id', 'text'), object_name: f('object_name', 'text'),
    record_id: f('record_id', 'text'), old_value: f('old_value', 'textarea'),
    new_value: f('new_value', 'textarea'), tenant_id: f('tenant_id', 'text'),
  },
};
const sysActivity = {
  name: 'sys_activity', label: 'Activity',
  fields: {
    id: f('id', 'text', { primaryKey: true }), type: f('type', 'text'),
    timestamp: f('timestamp', 'datetime'), summary: f('summary', 'text'),
    actor_id: f('actor_id', 'text'), object_name: f('object_name', 'text'),
    record_id: f('record_id', 'text'), record_label: f('record_label', 'text'),
    metadata: f('metadata', 'textarea'),
  },
};
const contact = {
  name: 'rq_contact', label: 'Contact',
  fields: { name: f('name', 'text'), email: f('email', 'text') },
};
const RETIRED = ['mailing_street', 'mailing_city'];

function makeDriver(shapeWriteResult: boolean) {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => { let s = stores.get(o); if (!s) { s = new Map(); stores.set(o, s); } return s; };
  const copy = <T,>(r: T): T => (r == null ? r : JSON.parse(JSON.stringify(r)));
  const strip = (r: Record<string, unknown>) => {
    if (!shapeWriteResult) return r;
    const out = { ...r };
    for (const k of RETIRED) delete out[k];
    return out;
  };
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries<any>(where)) {
      if (k.startsWith('$')) continue;
      if (v && typeof v === 'object' && '$in' in v) { if (!(v.$in as unknown[]).includes(row[k])) return false; continue; }
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(o: string, ast: any) { return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)).map(copy); },
    async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return copy(r); return null; },
    async create(o: string, data: Record<string, unknown>) {
      n += 1; const id = (data.id as string) ?? `r_${n}`;
      // A SQL table's `returning('*')`: every column, the retired ones null on a new row.
      const row: Record<string, unknown> = { ...data, id };
      if (o === 'rq_contact') for (const k of RETIRED) if (!(k in row)) row[k] = null;
      storeFor(o).set(id, row); return strip(copy(row));
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(o); const cur = s.get(id); if (!cur) return null;
      const next = { ...cur, ...data, id }; s.set(id, next); return strip(copy(next));
    },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async updateMany(o: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(o, ast); const s = storeFor(o);
      for (const r of rows) s.set(r.id as string, { ...s.get(r.id as string), ...data, id: r.id });
      return rows.length;
    },
    async deleteMany(o: string, ast: any) { const rows = await this.find(o, ast); for (const r of rows) storeFor(o).delete(r.id as string); return rows.length; },
  };
  return { driver, storeFor };
}

async function boot(shapeWriteResult: boolean) {
  const engine = new ObjectQL();
  const d = makeDriver(shapeWriteResult);
  engine.registerDriver(d.driver, true);
  await engine.init();
  for (const o of [sysAuditLog, sysActivity, contact]) engine.registry.registerObject(o as any, 'probe');
  installAuditWriters(engine as any);
  for (const id of ['c1', 'c2', 'c3', 'c4']) {
    d.storeFor('rq_contact').set(id, { id, name: id, email: id === 'c3' || id === 'c4' ? 'bulk@x' : `${id}@x`, mailing_street: `${id} Retired Way`, mailing_city: 'Oldtown' });
  }
  return { engine, ...d };
}

const ledger = (storeFor: any) => Array.from(storeFor('sys_audit_log').values()).map((r: any) => ({
  action: r.action, record: r.record_id,
  old: r.old_value ? RETIRED.filter((k) => k in JSON.parse(r.old_value)).map((k) => `${k}=${JSON.stringify(JSON.parse(r.old_value)[k])}`) : null,
  new: r.new_value ? RETIRED.filter((k) => k in JSON.parse(r.new_value)).map((k) => `${k}=${JSON.stringify(JSON.parse(r.new_value)[k])}`) : null,
}));

describe('[#21613] audit probe', () => {
  it('records what the ledger holds, today and with only the result shaped', async () => {
    const out: Record<string, unknown> = {};
    for (const shaped of [false, true]) {
      const { engine, storeFor } = await boot(shaped);
      await engine.update('rq_contact', { name: 'c1 renamed' }, { where: { id: 'c1' } } as any);
      await engine.delete('rq_contact', { where: { id: 'c2' } } as any);
      await engine.insert('rq_contact', { id: 'n1', name: 'new' });
      await engine.update('rq_contact', { name: 'bulk renamed' } as any, { where: { email: 'bulk@x' }, multi: true } as any);
      await new Promise((r) => setTimeout(r, 20));
      out[shaped ? 'result shaped, previous raw' : 'today (driver rows whole)'] = ledger(storeFor);
    }
    writeFileSync(process.env.OS_PROBE_OUT ?? join(tmpdir(), 'probe-21613-audit.json'), JSON.stringify(out, null, 2));
    expect(true).toBe(true);
  });
});
