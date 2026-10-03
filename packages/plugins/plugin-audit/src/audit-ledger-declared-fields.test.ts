// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21613] The audit ledger records the DECLARED record of a write — never a
 * column no metadata declares — on every side it takes: a create's
 * `new_value`, both halves of an update diff, and a delete's `old_value`.
 *
 * ## Why this ledger is the measured door for the engine's `previous`
 *
 * `sys_audit_log` is a served object: its `old_value` / `new_value` are read
 * back through the data door. The writer records the engine's own rows — the
 * write result (`ctx.result`) and the prior read bound as `ctx.previous` — so
 * whatever the engine hands it is what an auditor reads. On a table carrying a
 * column of a field an upgrade retired, measured before the engine shaped
 * those rows:
 *
 *  - a delete's `old_value` recorded the retired column WITH its stored value;
 *  - a create's `new_value` recorded it as `null`;
 *  - an update recorded nothing of it, only because both sides carried it.
 *
 * The third line is why the prior read is shaped with the write result: with
 * only the result shaped, every update of such a row recorded the retired
 * column as CHANGED — `'1 Retired Way' → null` — putting its stored value
 * into the ledger on every write. The update case below goes red on exactly
 * that.
 *
 * The store driver is SQL-shaped: every write answers with the whole stored
 * row, as driver-sql's `returning('*')` and its `select *` readback do.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { installAuditWriters } from './audit-writers.js';

type Row = Record<string, unknown>;

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

const CONTACT = 'rq_contact';
const RETIRED = ['mailing_street', 'mailing_city'] as const;

const contact = {
  name: CONTACT, label: 'Contact',
  fields: { name: f('name', 'text'), email: f('email', 'text') },
};

function makeSqlShapedStore() {
  const tables = new Map<string, Map<string, Row>>();
  const tableFor = (o: string): Map<string, Row> => {
    let t = tables.get(o);
    if (!t) { t = new Map<string, Row>(); tables.set(o, t); }
    return t;
  };
  const copy = <T,>(r: T): T => (r == null ? r : JSON.parse(JSON.stringify(r)));
  const run = (o: string, where?: Row, limit?: number): Row[] => {
    const rows = Array.from(tableFor(o).values())
      .filter((r) => Object.entries(where ?? {}).every(([k, v]) => k.startsWith('$') || (r[k] ?? null) === (v ?? null)));
    // The caller's bound, after the filter, by presence.
    const page = typeof limit === 'number' ? rows.slice(0, limit) : rows;
    return page.map(copy);
  };
  let seq = 0;
  const driver: any = {
    name: 'store-sql-shaped', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(o: string, ast?: { where?: Row; limit?: number }) { return run(o, ast?.where, ast?.limit); },
    async findOne(o: string, ast?: { where?: Row; limit?: number }) { return run(o, ast?.where, ast?.limit)[0] ?? null; },
    async create(o: string, data: Row) {
      seq += 1;
      const retired = o === CONTACT ? Object.fromEntries(RETIRED.map((c) => [c, null])) : {};
      const row: Row = { ...retired, ...data, id: data.id ?? `r_${seq}` };
      tableFor(o).set(String(row.id), row);
      return copy(row);
    },
    async update(o: string, id: string, data: Row) {
      const cur = tableFor(o).get(id);
      if (!cur) return null;
      const next: Row = { ...cur, ...data, id };
      tableFor(o).set(id, next);
      return copy(next);
    },
    async delete(o: string, id: string) { return tableFor(o).delete(id); },
    async count(o: string, ast?: { where?: Row }) { return run(o, ast?.where).length; },
  };
  return { driver, tableFor };
}

async function boot() {
  const engine = new ObjectQL();
  const store = makeSqlShapedStore();
  engine.registerDriver(store.driver, true);
  await engine.init();
  for (const o of [sysAuditLog, sysActivity, contact]) {
    engine.registry.registerObject(o as any, 'com.objectstack.test.audit-ledger-declared-fields');
  }
  installAuditWriters(engine as any);
  for (const id of ['c1', 'c2']) {
    store.tableFor(CONTACT).set(id, {
      id, name: id, email: `${id}@x`, mailing_street: `${id} Retired Way`, mailing_city: 'Oldtown',
    });
  }
  const ledger = (action: string, recordId: string) => {
    const row = Array.from(store.tableFor('sys_audit_log').values())
      .find((r) => r.object_name === CONTACT && r.action === action && r.record_id === recordId);
    expect(row, `${action} ${recordId} audit row`).toBeDefined();
    return {
      old: row!.old_value == null ? null : JSON.parse(String(row!.old_value)) as Row,
      next: row!.new_value == null ? null : JSON.parse(String(row!.new_value)) as Row,
    };
  };
  return { engine, ledger };
}

function expectDeclaredOnly(row: Row | null): void {
  expect(row).toBeTruthy();
  for (const retired of RETIRED) expect(Object.keys(row!)).not.toContain(retired);
}

describe('[#21613] the audit ledger records the declared record of a write', () => {
  it('update: the diff records the real change and no retired column', async () => {
    const { engine, ledger } = await boot();
    await engine.update(CONTACT, { name: 'c1 renamed' }, { where: { id: 'c1' } } as any);
    const { old, next } = ledger('update', 'c1');
    expect(old).toEqual({ name: 'c1' });
    expect(next).toEqual({ name: 'c1 renamed' });
  });

  it('delete: `old_value` is the declared pre-image', async () => {
    const { engine, ledger } = await boot();
    await engine.delete(CONTACT, { where: { id: 'c2' } } as any);
    const { old } = ledger('delete', 'c2');
    expect(old).toMatchObject({ id: 'c2', name: 'c2', email: 'c2@x' });
    expectDeclaredOnly(old);
  });

  it('create: `new_value` is the declared record', async () => {
    const { engine, ledger } = await boot();
    await engine.insert(CONTACT, { id: 'n1', name: 'new' });
    const { next } = ledger('create', 'n1');
    expect(next).toMatchObject({ id: 'n1', name: 'new' });
    expectDeclaredOnly(next);
  });
});
