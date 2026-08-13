// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8144] The auth-event sink writes a REAL, READ-BACK ledger row.
 *
 * ## Why every assertion here reads the row back
 *
 * `sys_audit_log` declares every field `readonly`, and `validateRecord` skips
 * readonly/system fields on both branches (#8203) — so the `action` enum is a
 * vocabulary nothing validates in either direction. A write carrying an action
 * the enum has never heard of is accepted silently. That makes "the call did
 * not throw" worth exactly nothing on this object: it is equally true when the
 * row landed correctly, when it landed wrong, and (before this change) when it
 * was never attempted at all. So each case below inserts through a REAL
 * ObjectQL engine and reads the stored row, asserting `action`, the actor
 * (`user_id` / `actor`) and the tenant.
 *
 * The end-to-end claim — that a real sign-in through better-auth produces this
 * row, visible through the real data API — is `packages/qa/dogfood/test/
 * auth-session-audit-trail.dogfood.test.ts`. This file covers what that one
 * cannot reach cheaply: the single-tenant table shape (no `organization_id`
 * column), the impersonation actor split, and the durability report on a
 * failing write.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { createAuthEventAuditSink } from './auth-event-audit.js';

const OWNER_PACKAGE = 'com.objectstack.test.auth-event-audit';

/** The ledger, in the shape a MULTI-tenant stack registers it. */
const sysAuditLogMultiTenant = {
  name: 'sys_audit_log',
  label: 'Audit Log',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    action: { name: 'action', label: 'Action', type: 'text' as const },
    user_id: { name: 'user_id', label: 'User', type: 'text' as const },
    actor: { name: 'actor', label: 'Actor', type: 'text' as const },
    object_name: { name: 'object_name', label: 'Object', type: 'text' as const },
    record_id: { name: 'record_id', label: 'Record', type: 'text' as const },
    old_value: { name: 'old_value', label: 'Old', type: 'textarea' as const },
    new_value: { name: 'new_value', label: 'New', type: 'textarea' as const },
    ip_address: { name: 'ip_address', label: 'IP', type: 'text' as const },
    user_agent: { name: 'user_agent', label: 'UA', type: 'textarea' as const },
    tenant_id: { name: 'tenant_id', label: 'Tenant', type: 'text' as const },
    metadata: { name: 'metadata', label: 'Metadata', type: 'textarea' as const },
    organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
  },
};

/**
 * An OLDER ledger table: no `actor` column, and none declared for
 * `organization_id` either.
 *
 * Both columns are stamped conditionally by the writer, for the same reason and
 * with different fates today — worth stating because the fixture looks
 * redundant otherwise:
 *
 *  - `organization_id` comes BACK. `applySystemFields` provisions the tenant
 *    column unconditionally now (only `systemFields: false` / `managedBy:
 *    'better-auth'` / `tenancy.enabled: false` opt out) — precisely so "sudo
 *    writers (audit / messaging / inbox / outbox …)" stop failing with "no
 *    column named organization_id" on single-tenant stacks. So this fixture
 *    measures that the probe reads the REGISTERED schema (post-injection),
 *    not the document an author wrote.
 *  - `actor` does NOT. It is a plain declared field that older audit tables
 *    predate, so it is the live half of the conditional stamp: writing it into
 *    a table that lacks it fails the INSERT, and the writer swallows — audit
 *    logging would just stop, with nothing in the response to show it.
 */
const sysAuditLogNoActor = {
  ...sysAuditLogMultiTenant,
  fields: Object.fromEntries(
    Object.entries(sysAuditLogMultiTenant.fields).filter(
      ([k]) => k !== 'organization_id' && k !== 'actor',
    ),
  ),
};

/** Minimal in-memory driver — the `audit-hook-object-scope.test.ts` shape. */
function makeMemoryDriver() {
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
  const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === '$and' && Array.isArray(v)) {
        if (!v.every((sub) => matchesWhere(row, sub))) return false;
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
      return Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
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
  return { driver, storeFor };
}

async function boot(ledger: unknown = sysAuditLogMultiTenant) {
  const engine = new ObjectQL();
  const mem = makeMemoryDriver();
  engine.registerDriver(mem.driver, true);
  await engine.init();
  engine.registry.registerObject(ledger as any, OWNER_PACKAGE);
  return { engine, storeFor: mem.storeFor };
}

/** Read the ledger back THROUGH THE ENGINE, not out of the driver's map. */
async function ledgerRows(engine: any, where: Record<string, unknown> = {}) {
  return (await engine.find('sys_audit_log', { where }, { context: { isSystem: true } })) as any[];
}

describe('[#8144] createAuthEventAuditSink writes a login row that names its actor', () => {
  it('records action/user/tenant/session, read back from the ledger', async () => {
    const { engine } = await boot();
    const sink = createAuthEventAuditSink({ getEngine: () => engine as any });

    await sink.recordAuthEvent({
      action: 'login',
      userId: 'usr_1',
      sessionId: 'ses_1',
      organizationId: 'org_1',
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (probe)',
      context: { endpoint: '/sign-in/email' },
    });

    // Filter on the action the acceptance criterion filters on, so the query is
    // the one the `auth_events` list view issues rather than a friendlier one.
    const rows = await ledgerRows(engine, { action: 'login' });
    expect(rows).toHaveLength(1);
    const [row] = rows;
    // The three things #7675 said were missing: the event, the actor, the tenant.
    expect(row.action).toBe('login');
    expect(row.user_id).toBe('usr_1');
    expect(row.tenant_id).toBe('org_1');
    expect(row.organization_id).toBe('org_1');
    // ADR-0014 D2's principal label — the subject acted for themselves here.
    expect(row.actor).toBe('usr_1');
    // Navigable back to the session it is about.
    expect(row.object_name).toBe('sys_session');
    expect(row.record_id).toBe('ses_1');
    expect(row.ip_address).toBe('203.0.113.7');
    expect(row.user_agent).toBe('Mozilla/5.0 (probe)');
    expect(JSON.parse(String(row.metadata))).toEqual({ endpoint: '/sign-in/email' });
    // An auth event is not a field diff — recording `{}` would be a claim about
    // a record that never changed.
    expect(row.old_value ?? null).toBeNull();
    expect(row.new_value ?? null).toBeNull();
  });

  it('logout is a distinct row with its own action', async () => {
    const { engine } = await boot();
    const sink = createAuthEventAuditSink({ getEngine: () => engine as any });

    await sink.recordAuthEvent({ action: 'login', userId: 'usr_1', sessionId: 'ses_1' });
    await sink.recordAuthEvent({
      action: 'logout',
      userId: 'usr_1',
      sessionId: 'ses_1',
      context: { endpoint: '/sign-out' },
    });

    expect(await ledgerRows(engine, { action: 'login' })).toHaveLength(1);
    const outs = await ledgerRows(engine, { action: 'logout' });
    expect(outs).toHaveLength(1);
    expect(outs[0].user_id).toBe('usr_1');
    // …and the two are different rows, not one row overwritten.
    expect(await ledgerRows(engine)).toHaveLength(2);
  });

  it('an impersonation session credits the ADMIN as actor and keeps the subject on user_id', async () => {
    // `user_id` is a strict `sys_user` lookup and the session really is the
    // subject's; `actor` is "the principal that performed the action". Writing
    // the impersonated user as the sole principal would be a WRONG record — the
    // reader could not tell it from a self-service sign-in.
    const { engine } = await boot();
    const sink = createAuthEventAuditSink({ getEngine: () => engine as any });

    await sink.recordAuthEvent({
      action: 'login',
      userId: 'usr_subject',
      actor: 'usr_admin',
      context: { endpoint: '/admin/impersonate-user', impersonated_by: 'usr_admin' },
    });

    const [row] = await ledgerRows(engine, { action: 'login' });
    expect(row.user_id).toBe('usr_subject');
    expect(row.actor).toBe('usr_admin');
    expect(JSON.parse(String(row.metadata)).impersonated_by).toBe('usr_admin');
  });

  it('a ledger table without an `actor` column still gets its row, unstamped', async () => {
    // The failure this guards is silent by construction: stamping a column the
    // table does not have makes the INSERT fail, and the writer swallows — so
    // audit logging would simply stop, with nothing in the response to show it.
    const { engine } = await boot(sysAuditLogNoActor);
    const sink = createAuthEventAuditSink({ getEngine: () => engine as any });

    await sink.recordAuthEvent({ action: 'login', userId: 'usr_1', organizationId: 'org_1' });

    const rows = await ledgerRows(engine, { action: 'login' });
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe('usr_1');
    // The declared lookup carries the tenant either way…
    expect(rows[0].tenant_id).toBe('org_1');
    // …and the probe reads the REGISTERED schema, so the unconditionally
    // provisioned tenant column is stamped even though the fixture omits it.
    expect(rows[0].organization_id).toBe('org_1');
    // The one column that really is absent is left alone.
    expect(rows[0].actor).toBeUndefined();
  });

  it('no engine yet, or no subject: nothing is written and nothing throws', async () => {
    const { engine } = await boot();
    const noEngine = createAuthEventAuditSink({ getEngine: () => undefined });
    await expect(noEngine.recordAuthEvent({ action: 'login', userId: 'usr_1' })).resolves.toBeUndefined();

    const sink = createAuthEventAuditSink({ getEngine: () => engine as any });
    await sink.recordAuthEvent({ action: 'login', userId: '' as string });
    // An unattributed auth row is the defect this card removes; not writing one
    // is the correct answer, not a silent loss.
    expect(await ledgerRows(engine)).toHaveLength(0);
  });

  it('a failed ledger write is reported at ERROR, once, and never breaks the caller', async () => {
    // #5226's discipline on the auth seam: the sign-in returned 200 and the
    // session is on disk, so the only sign the ledger lost a row is this line.
    const broken: any = {
      getSchema: () => null,
      insert: async () => {
        throw new Error('no such table: sys_audit_log');
      },
    };
    const logger = { error: vi.fn(), debug: vi.fn() };
    const sink = createAuthEventAuditSink({ getEngine: () => broken, logger });

    await expect(sink.recordAuthEvent({ action: 'login', userId: 'usr_1' })).resolves.toBeUndefined();
    await sink.recordAuthEvent({ action: 'logout', userId: 'usr_1' });

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [msg] = logger.error.mock.calls[0];
    // The two things a durability `error` owes, in its first line.
    expect(String(msg)).toContain('INCOMPLETE');
    expect(String(msg)).toContain('Fix:');
    // Said once — an auth event fires on every sign-in, so a per-write `error`
    // on a systemic cause trains everyone to skim the channel.
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });
});
