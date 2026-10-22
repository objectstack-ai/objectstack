// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ── The tenant-audit control's scope is cut by the OBJECT, not the caller's flag (#13491) ──
//
// Maintainer ruling, 2026-08-31 (总监席第 5 场, 联案 #13491 + #13497, verbatim
// 「同意」): isSystem x a tenant-scoped object is IN the control's scope. The
// ruling's first implementation read "tenant-scoped" off a hand-kept per-table
// ledger. ADR-0131 D9 made the question structural — column ⇒ in scope — and
// D13 retired the ledger with its last reader, the tenant-audit mute: the
// object's SCHEMA now answers both cuts, and nothing answers by name.
//
// ## What each test here discriminates
//
// Two gates read the same predicate and fail differently, so both are pinned
// on both sides:
//
//   1. `resolveSystemInsertOrganization` — every object with a tenant column
//      reaches ADR-0131 D9's derive/refuse decision, platform namespace or
//      not. A file pinning only the derive would stay green if the engine
//      stamped a guess on a walled install; one pinning only the refusal would
//      stay green if it refused everything. So each case carries its
//      no-tenant-column control, run through the same engine on the same
//      posture.
//   2. The engine's `bypassTenantAudit` isSystem mute. Pinned as the OPTION
//      the engine hands the driver, because that is the whole of what the
//      engine decides; `@objectstack/objectql` cannot import
//      `@objectstack/driver-sql` (the dependency runs the other way). A
//      platform object and an application object of the same schema shape are
//      handed the SAME options: a name decides nothing.
//
// ## Direction, per the ruling's execution point 3
//
// 「多出来的只能是拒绝/告警，⛔ 永不静默改写行为」. So every assertion below
// reads a REFUSAL, a WARNING-enablement, or a derive that D9 already ruled.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { ObjectQL } from './engine.js';
import * as publicApi from './index.js';

const ORG_ID = 'org_msokm9oaz0cal87q';
const SYSTEM_CTX: ExecutionContext = { isSystem: true } as ExecutionContext;

interface ObservedCall {
  object: string;
  method: string;
  options: Record<string, unknown> | undefined;
}

function makeDriver(observed: ObservedCall[], organizations: string[]) {
  const record = (object: string, method: string, options: any) =>
    observed.push({ object, method, options });
  return {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, _ast: any, options: any) {
      record(object, 'find', options);
      return object === 'sys_organization' ? organizations.map((id) => ({ id })) : [];
    },
    async findOne() { return null; },
    async count() { return 0; },
    async create(object: string, data: any, options: any) {
      record(object, 'create', options);
      return { id: 'r_1', ...data };
    },
    async update(object: string, id: string, data: any, options: any) {
      record(object, 'update', options); return { id, ...data };
    },
    async delete() { return true; },
    async bulkCreate(object: string, rows: any[], options: any) {
      record(object, 'bulkCreate', options);
      return rows.map((r, i) => ({ id: `r_${i + 1}`, ...r }));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async syncSchema() {},
  } as any;
}

const PACKAGE_ID = '#13491';

/** A platform object with a tenant column — #12745 fixed its writer, a backfill was ordered. */
const SYS_FILE = { name: 'sys_file', fields: { key: { type: 'text' } } } as any;
/** Commit ff08691e6's own "legitimately org-less" example, the old ledger's one `global` verdict. */
const SYS_PERMISSION_SET = { name: 'sys_permission_set', fields: { label: { type: 'text' } } } as any;
/** A platform object the old ledger never adjudicated (`unclassified`). */
const SYS_UNADJUDICATED = { name: 'sys_audit_entry', fields: { subject: { type: 'text' } } } as any;
/** An ordinary application object: tenant-scoped by its schema alone. */
const DISPATCH_ORDER = { name: 'dispatch_order', fields: { subject: { type: 'text' } } } as any;
/** ADR-0066: the DECLARED way to say "rows of this object belong to no org". */
const NO_TENANT_FIELD = {
  name: 'billing_license',
  tenancy: { enabled: false },
  fields: { subject: { type: 'text' } },
} as any;

/** A platform object that DECLARES itself out of the machinery on its own schema. */
const SYS_TENANTLESS = {
  name: 'sys_tenantless_ledger',
  systemFields: { tenant: false },
  fields: { subject: { type: 'text' } },
} as any;

const ORG_OBJECT = { name: 'sys_organization', fields: { name: { type: 'text' } } } as any;
/** The notification family's event row (#23284). */
const SYS_NOTIFICATION = { name: 'sys_notification', fields: { topic: { type: 'text' } } } as any;

async function makeEngine(opts: { posture?: string; organizations?: string[] } = {}) {
  const observed: ObservedCall[] = [];
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver(observed, opts.organizations ?? [ORG_ID]), true);
  await engine.init();
  for (const o of [SYS_FILE, SYS_PERMISSION_SET, SYS_UNADJUDICATED, DISPATCH_ORDER, NO_TENANT_FIELD, SYS_TENANTLESS, ORG_OBJECT, SYS_NOTIFICATION]) {
    engine.registry.registerObject(o, PACKAGE_ID);
  }
  if (opts.posture) engine.setTenancyPostureProvider(() => opts.posture);
  return { engine, observed };
}

const lastWrite = (observed: ObservedCall[], object: string) =>
  [...observed].reverse().find((c) => c.object === object && c.method !== 'find');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ADR-0131 D13 — the per-table ledger is retired, not merely unread', () => {
  it('@objectstack/objectql no longer exports the ledger or its predicates', () => {
    // A tombstone, not a count. The ledger published four names, every one
    // spelled around "platform object" (the table, its classifier, its audit
    // predicate, its tenant-scoped list); re-adding any of them — or a sibling
    // under a new name — reds here.
    expect(Object.keys(publicApi).filter((name) => /PlatformObject|PLATFORM_OBJECT/.test(name))).toEqual([]);
  });
});

describe('gate 1 — every object with a tenant column reaches ADR-0131 D9 derive/refuse', () => {
  it('single posture, one organization: a platform object with a tenant column DERIVES it', async () => {
    const { engine, observed } = await makeEngine({ posture: 'single' });
    await engine.insert('sys_file', { key: 'k1' }, { context: SYSTEM_CTX } as any);
    expect(lastWrite(observed, 'sys_file')?.options?.tenantId).toBe(ORG_ID);
  });

  // [ADR-0131 C8 stage 8b] No name decides the write under any posture: every
  // platform object with a tenant column is judged (`single` first, the walled
  // postures in 18.x).
  it.each([
    ['sys_permission_set', { label: 'Admin' }],
    ['sys_audit_entry', { subject: 'e1' }],
  ] as const)(
    'single posture, one organization: the platform object %s DERIVES it',
    async (object, row) => {
      const { engine, observed } = await makeEngine({ posture: 'single' });
      await engine.insert(object, { ...row }, { context: SYSTEM_CTX } as any);
      expect(lastWrite(observed, object)?.options?.tenantId).toBe(ORG_ID);
    },
  );

  it.each([
    ['no organization', [] as string[], 0],
    ['two organizations', [ORG_ID, 'org_second'], 2],
  ] as const)(
    'single posture, %s: an org-less system insert on a platform object is REFUSED, loudly, and never written',
    async (_label, organizations, count) => {
      const { engine, observed } = await makeEngine({ posture: 'single', organizations: [...organizations] });
      await expect(
        engine.insert('sys_audit_entry', { subject: 'e1' }, { context: SYSTEM_CTX } as any),
      ).rejects.toMatchObject({
        code: 'ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED',
        status: 500,
        organizationCount: count,
      });
      expect(lastWrite(observed, 'sys_audit_entry')).toBeUndefined();
    },
  );

  it.each([
    ['isolated', 'sys_audit_entry', { subject: 'e1' }],
    ['group', 'sys_audit_entry', { subject: 'e1' }],
    ['isolated', 'sys_permission_set', { label: 'Admin' }],
    ['group', 'sys_permission_set', { label: 'Admin' }],
  ] as const)(
    '[C8 stage 8b] %s posture: the platform object %s is judged — its org-less system insert is REFUSED, and never written',
    async (posture, object, row) => {
      const { engine, observed } = await makeEngine({ posture });
      await expect(
        engine.insert(object, { ...row }, { context: SYSTEM_CTX } as any),
      ).rejects.toMatchObject({ code: 'ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED', status: 500 });
      expect(lastWrite(observed, object)).toBeUndefined();
    },
  );

  it.each(['isolated', 'group'] as const)(
    '%s posture: an org-less system write on sys_file is REFUSED, loudly',
    async (posture) => {
      const { engine, observed } = await makeEngine({ posture });
      // The envelope, not the throw: a bare `toThrow()` would stay green for a
      // transport-layer failure and for a driver that throws a plain Error.
      await expect(
        engine.insert('sys_file', { key: 'k1' }, { context: SYSTEM_CTX } as any),
      ).rejects.toMatchObject({
        code: 'ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED',
        status: 500,
      });
      expect(lastWrite(observed, 'sys_file')).toBeUndefined();
    },
  );

  it.each(['isolated', 'group'] as const)(
    '%s posture: an object with NO tenant column is NOT refused — the discriminating control',
    async (posture) => {
      // ADR-0131 D7: a deployment-level table declares no organization column,
      // and that declaration — never a platform-namespace verdict — is what keeps
      // its rows organization-less under a wall.
      const { engine, observed } = await makeEngine({ posture });
      await engine.insert('billing_license', { subject: 'lic' }, { context: SYSTEM_CTX } as any);
      expect(lastWrite(observed, 'billing_license')?.options?.tenantId).toBeUndefined();
    },
  );

  it('a write that CARRIES its organization is untouched on a walled posture', async () => {
    const { engine, observed } = await makeEngine({ posture: 'isolated' });
    await engine.insert(
      'sys_file',
      { key: 'k1' },
      { context: { isSystem: true, tenantId: ORG_ID } } as any,
    );
    expect(lastWrite(observed, 'sys_file')?.options?.tenantId).toBe(ORG_ID);
  });
});

describe('#23284 — a notification no producer could attribute takes the owner ADR-0131 D9 derives', () => {
  // The producers thread an organization when they have one (the run's, the
  // record the notification is about, the approval request's). What is left —
  // a notification about no record, from a run with no organization — reaches
  // the engine with none, and its tenant column is what puts it under the
  // system-write rule instead of landing it with `organization_id` NULL.
  it('single posture, one organization: the org-less notification takes the sole organization', async () => {
    const { engine, observed } = await makeEngine({ posture: 'single' });
    await engine.insert('sys_notification', { topic: 'sweep.breach', organization_id: null }, { context: SYSTEM_CTX } as any);
    expect(lastWrite(observed, 'sys_notification')?.options?.tenantId).toBe(ORG_ID);
  });

  it('single posture, two organizations: the org-less notification is REFUSED, loudly, and never written', async () => {
    const { engine, observed } = await makeEngine({ posture: 'single', organizations: [ORG_ID, 'org_second'] });
    await expect(
      engine.insert('sys_notification', { topic: 'sweep.breach', organization_id: null }, { context: SYSTEM_CTX } as any),
    ).rejects.toMatchObject({ code: 'ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED', status: 500 });
    expect(lastWrite(observed, 'sys_notification')).toBeUndefined();
  });

  it.each(['isolated', 'group'] as const)(
    '%s posture: the org-less notification is REFUSED, loudly, and never written',
    async (posture) => {
      const { engine, observed } = await makeEngine({ posture });
      await expect(
        engine.insert('sys_notification', { topic: 'sweep.breach', organization_id: null }, { context: SYSTEM_CTX } as any),
      ).rejects.toMatchObject({ code: 'ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED', status: 500 });
      expect(lastWrite(observed, 'sys_notification')).toBeUndefined();
    },
  );

  it('a notification that CARRIES its organization is written as it came, on a walled posture too', async () => {
    const { engine, observed } = await makeEngine({ posture: 'isolated', organizations: [ORG_ID, 'org_second'] });
    await engine.insert('sys_notification', { topic: 'sweep.breach', organization_id: 'org_second' }, { context: SYSTEM_CTX } as any);
    const write = lastWrite(observed, 'sys_notification');
    expect(write?.method).toBe('create');
    // Nothing was derived over the producer's answer: the engine resolved no
    // organization of its own for a row that already names one.
    expect(write?.options?.tenantId).toBeUndefined();
  });
});

describe('gate 2 — the isSystem tenant-audit mute is decided by the SCHEMA (ADR-0131 D13)', () => {
  it.each([
    ['sys_file', { key: 'k1' }],
    // The old ledger's `global` verdict: muted by name until D13.
    ['sys_permission_set', { label: 'Admin' }],
    // The old ledger's `unclassified` default: muted by absence until D13.
    ['sys_audit_entry', { subject: 'e1' }],
    ['dispatch_order', { subject: 'e1' }],
  ] as const)(
    'an elevated write on %s, which has a tenant column, is NOT auto-muted',
    async (object, row) => {
      const { engine, observed } = await makeEngine({ posture: 'single' });
      await engine.insert(object, { ...row }, { context: SYSTEM_CTX } as any);
      expect(lastWrite(observed, object)?.options?.bypassTenantAudit).toBeUndefined();
    },
  );

  it('a platform object and an application object of the same shape are handed the SAME driver options — the name decides nothing', async () => {
    // The ablation this card was accepted on: put a per-table exemption back
    // for `sys_audit_entry` and this pin reds while no write pin above moves —
    // the mute is the only thing a per-table entry could ever change.
    const { engine, observed } = await makeEngine({ posture: 'single' });
    await engine.insert('sys_audit_entry', { subject: 'e1' }, { context: SYSTEM_CTX } as any);
    await engine.insert('dispatch_order', { subject: 'e1' }, { context: SYSTEM_CTX } as any);
    expect(lastWrite(observed, 'sys_audit_entry')?.options).toEqual(lastWrite(observed, 'dispatch_order')?.options);
  });

  it('an object with NO tenant field is still muted — nothing to be unscoped from', async () => {
    const { engine, observed } = await makeEngine({ posture: 'single' });
    await engine.insert('billing_license', { subject: 'e1' }, { context: SYSTEM_CTX } as any);
    expect(lastWrite(observed, 'billing_license')?.options?.bypassTenantAudit).toBe(true);
  });

  it('a platform object that declares `systemFields.tenant: false` is muted by that declaration', async () => {
    // The structural way out of the audit: a declaration on the object's own
    // schema, the one the census records per object — never a list of names.
    const { engine, observed } = await makeEngine({ posture: 'single' });
    await engine.insert('sys_tenantless_ledger', { subject: 'e1' }, { context: SYSTEM_CTX } as any);
    expect(lastWrite(observed, 'sys_tenantless_ledger')?.options?.bypassTenantAudit).toBe(true);
  });

  it('an EXPLICIT caller bypass is still honoured — this branch only fills a gap', async () => {
    const { engine, observed } = await makeEngine({ posture: 'single' });
    await engine.insert(
      'dispatch_order',
      { subject: 'e1' },
      { context: SYSTEM_CTX, bypassTenantAudit: true } as any,
    );
    expect(lastWrite(observed, 'dispatch_order')?.options?.bypassTenantAudit).toBe(true);
  });
});
