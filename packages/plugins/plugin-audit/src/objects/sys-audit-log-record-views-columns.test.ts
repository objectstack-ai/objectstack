// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9539 — the `record_views` list view's columns must stay a SUBSET of the
 * keys the `read` writer actually stamps on a row.
 *
 * `sys_audit_log` is `readonly: true` on every field, and `validateRecord`
 * skips readonly fields on insert (the same structural gap
 * `sys-audit-log-retired-actions.test.ts` pins for the `action` enum) — so
 * nothing else in the repo rejects a view column the writer never produces.
 * `record_views` shipped with `ip_address` in its column list even though
 * `buildRow` in `read-audit.ts` never sets that key: the column was
 * structurally empty on every row it could ever show, which on a compliance
 * screen reads as "we captured the fingerprint and this request had none" —
 * a stronger and wrong claim (maintainer ruling 2026-08-18; triage
 * auto-adjudication 2026-08-19; both Option 1: drop the column, replace it
 * with `actor`, which IS stamped).
 *
 * The stamped key set is DERIVED here, never copied. `buildRow` is a private
 * closure inside `installReadAuditWriter` — it cannot be imported and
 * introspected directly — so this test runs the writer for real, against a
 * real engine, on a read shaped to make every conditionally-stamped key
 * present (a human principal that ALSO carries a service `actor` label, on a
 * record that carries an `organization_id`), and reads the keys back off the
 * row the writer actually persisted. If `buildRow` ever stops stamping a key
 * this view lists, the observed key set shrinks and the assertion goes red —
 * no hand-kept list to fall out of sync with the writer it is supposed to
 * police.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { installReadAuditWriter } from '../read-audit.js';
import { SysAuditLog } from './sys-audit-log.object.js';

/** Minimal in-memory driver — just enough for one findOne + insert round trip. */
function makeStubDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) {
      s = new Map();
      stores.set(obj, s);
    }
    return s;
  };
  let nextId = 0;
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === '$and') {
        if (!(v as any[]).every((m) => matches(row, m))) return false;
        continue;
      }
      if (k.startsWith('$')) continue;
      const expected = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory',
    version: '0.0.0',
    supports: {} as any,
    async connect() {},
    async disconnect() {},
    async checkHealth() {
      return true;
    },
    async execute() {
      return null;
    },
    async find(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row: Record<string, unknown> = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) return null;
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return updated;
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      if (id && storeFor(object).has(id)) return this.update(object, id, data);
      return this.create(object, data);
    },
    async delete(object: string, id: string) {
      return storeFor(object).delete(id);
    },
    async count(object: string, ast: any) {
      return (await this.find(object, ast)).length;
    },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() {
      return [];
    },
    async bulkDelete() {},
    async updateMany() {
      return 0;
    },
    async beginTransaction() {
      return { commit: async () => {}, rollback: async () => {} };
    },
    async commit() {},
    async rollback() {},
  };
  return driver;
}

const contactObject = {
  name: 'contact',
  label: 'Contact',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    full_name: { name: 'full_name', label: 'Name', type: 'text' as const },
    organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
  },
};

const HARNESS_PACKAGE = 'com.objectstack.audit.test.record-views-columns';

/** Every key stamped on the one row the writer actually persists — captured, never copied. */
let stampedKeys: Set<string>;

beforeAll(async () => {
  const engine = new ObjectQL();
  engine.registerDriver(makeStubDriver(), true);
  await engine.init();
  engine.registry.registerObject(contactObject as any, HARNESS_PACKAGE);
  // The REAL sys_audit_log object under test — not a hand-copied stand-in —
  // so `objectHasField` (the conditional-stamp gate for `organization_id` /
  // `actor` in `buildRow`) reads the actual production field declarations.
  engine.registry.registerObject(SysAuditLog as any, HARNESS_PACKAGE);

  await engine.insert(
    'contact',
    { id: 'c1', full_name: 'Wei Zhang', organization_id: 'org_a' },
    { context: { isSystem: true } },
  );

  const writer = installReadAuditWriter(engine, { objects: ['contact'] })!;
  // A principal that carries BOTH a `userId` and a service `actor` label, on
  // a record that carries `organization_id` — the one read shape that makes
  // every conditionally-stamped key in `buildRow` present at once, so the
  // captured set is the writer's FULL vocabulary, not just today's default
  // path through it.
  await engine.findOne('contact', {
    where: { id: 'c1' },
    context: { userId: 'u_alice', actor: 'svc:export-worker', tenantId: 'org_a' },
  });
  await writer.flush();

  const rows = (await engine.find('sys_audit_log', {})) as Array<Record<string, unknown>>;
  expect(rows).toHaveLength(1);
  stampedKeys = new Set(Object.keys(rows[0]));
});

/** The columns the shipped `record_views` list view declares. */
function recordViewsColumns(): string[] {
  const view = (SysAuditLog as { listViews?: Record<string, { columns?: unknown }> }).listViews
    ?.record_views;
  const columns = view?.columns;
  return Array.isArray(columns) ? columns.map(String) : [];
}

describe('#9539 record_views columns stay inside the read writer\'s stamped key set', () => {
  it('the writer actually stamped at least one row to derive the set from', () => {
    expect(stampedKeys.size).toBeGreaterThan(0);
  });

  it.each(recordViewsColumns().map((c) => [c] as const))(
    'column %s is a key the read writer actually stamps',
    (column) => {
      expect(
        stampedKeys.has(column),
        `record_views declares column '${column}', but the read writer's buildRow() in ` +
          'read-audit.ts never sets that key on a persisted row — this view would show it ' +
          'structurally empty on every row it can ever display, which on a compliance ' +
          'screen reads as a false capability claim (#9539, 审计面宁窄勿谎). Stamped keys ' +
          `observed on the writer's own output: ${[...stampedKeys].sort().join(', ')}.`,
      ).toBe(true);
    },
  );

  it('ip_address specifically stays out — the read writer structurally cannot stamp it', () => {
    // Named explicitly, not just covered by the loop above: this is the exact
    // regression #9539 fixed, and `ReadAuditEvent` (read-audit.ts) carries no
    // field for a client fingerprint at all, so this is not a near-miss the
    // writer could accidentally start passing.
    expect(recordViewsColumns()).not.toContain('ip_address');
    expect(stampedKeys.has('ip_address')).toBe(false);
  });
});
