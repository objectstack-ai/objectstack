// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ── The tenant-audit control's scope is cut by the OBJECT, not the caller's flag (#13491) ──
//
// Maintainer ruling, 2026-08-31 (总监席第 5 场, 联案 #13491 + #13497, verbatim
// 「同意」). It narrowed the batch #9 ruling ("isSystem writes are out of this
// control's scope") by that ruling's OWN look-back clause, which #13497's
// measurement fired:
//
//   - isSystem x a TENANT-SCOPED object = IN scope;
//   - isSystem x a genuinely GLOBAL object = OUT of scope, #8672's reasoning
//     inheriting PER OBJECT rather than by namespace.
//
// ## What each test here discriminates
//
// Two gates were narrowed in one stroke and they fail differently, so both are
// pinned on both sides:
//
//   1. `resolveSystemInsertOrganization` — an admitted object now reaches
//      #8844's derive/refuse machinery. A file pinning only the derive would
//      stay green if the engine stamped a guess on a walled install; one
//      pinning only the refusal would stay green if it refused everything. So
//      each admitted-object case carries its excluded-object control, run
//      through the same engine on the same posture.
//   2. The engine's `bypassTenantAudit` isSystem mute. This is the gate the
//      #13178 census measured as silencing 135 of 175 write call sites (77%) —
//      the control's LARGEST gate, sitting ahead of the condition the control
//      is about. Pinned as the OPTION the engine hands the driver, because that
//      is the whole of what the engine decides; `@objectstack/objectql` cannot
//      import `@objectstack/driver-sql` (the dependency runs the other way).
//
// ## Direction, per the ruling's execution point 3
//
// 「多出来的只能是拒绝/告警，⛔ 永不静默改写行为」. So every assertion below
// reads a REFUSAL, a WARNING-enablement, or a derive that #8844 already ruled —
// and the `unclassified` cases assert that behaviour did NOT move, which is
// what keeps the reclassification's blast radius equal to the admitted list.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { ObjectQL } from './engine.js';
import {
  PLATFORM_OBJECT_TENANCY,
  classifyPlatformObjectTenancy,
  isPlatformObjectOutOfTenantAuditScope,
  tenantScopedPlatformObjects,
} from './tenancy/platform-object-tenancy.js';

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

/** ADMITTED by the inventory — #12745 fixed its writer, a backfill was ordered. */
const SYS_FILE = { name: 'sys_file', fields: { key: { type: 'text' } } } as any;
/** GLOBAL by the inventory — #8672's own example, named verbatim in the ruling. */
const SYS_PERMISSION_SET = { name: 'sys_permission_set', fields: { label: { type: 'text' } } } as any;
/** UNCLASSIFIED — a platform object the inventory did not adjudicate. */
const SYS_UNADJUDICATED = { name: 'sys_audit_entry', fields: { subject: { type: 'text' } } } as any;
/** An ordinary application object: tenant-scoped by its schema alone. */
const DISPATCH_ORDER = { name: 'dispatch_order', fields: { subject: { type: 'text' } } } as any;
/** ADR-0066: the DECLARED way to say "rows of this object belong to no org". */
const NO_TENANT_FIELD = {
  name: 'billing_license',
  tenancy: { enabled: false },
  fields: { subject: { type: 'text' } },
} as any;

const ORG_OBJECT = { name: 'sys_organization', fields: { name: { type: 'text' } } } as any;

async function makeEngine(opts: { posture?: string; organizations?: string[] } = {}) {
  const observed: ObservedCall[] = [];
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver(observed, opts.organizations ?? [ORG_ID]), true);
  await engine.init();
  for (const o of [SYS_FILE, SYS_PERMISSION_SET, SYS_UNADJUDICATED, DISPATCH_ORDER, NO_TENANT_FIELD, ORG_OBJECT]) {
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

describe('#13491 the inventory — a verdict per object, never a namespace', () => {
  it('an admitted object is tenant-scoped and an unlisted platform name is NOT guessed', () => {
    expect(classifyPlatformObjectTenancy('sys_file')).toBe('tenant-scoped');
    // ⛔ The escape hatch the ruling made mandatory: an object nobody
    // adjudicated reads `unclassified`, never a guess in either direction.
    expect(classifyPlatformObjectTenancy('sys_never_heard_of_it')).toBe('unclassified');
  });

  it('#8672 inherits PER OBJECT — the same namespace holds both verdicts', () => {
    expect(classifyPlatformObjectTenancy('sys_permission_set')).toBe('global');
    expect(classifyPlatformObjectTenancy('sys_file')).toBe('tenant-scoped');
    // The discriminating half: the old blanket predicate answered the SAME
    // thing for both of these, which is the exemption the ruling withdrew.
    expect(isPlatformObjectOutOfTenantAuditScope('sys_permission_set')).toBe(true);
    expect(isPlatformObjectOutOfTenantAuditScope('sys_file')).toBe(false);
  });

  it('the exemption applies to platform namespaces only — an application object was never in it', () => {
    expect(isPlatformObjectOutOfTenantAuditScope('dispatch_order')).toBe(false);
  });

  it('every non-unclassified entry cites its evidence', () => {
    // The admission bar the ledger header states: a verdict without a citation
    // is the guess execution point 2 forbids.
    for (const [name, entry] of Object.entries(PLATFORM_OBJECT_TENANCY)) {
      expect(entry.tenancy, name).not.toBe('unclassified');
      expect(entry.evidence.length, name).toBeGreaterThan(40);
    }
  });

  it('the admitted list is exactly the objects whose behaviour this card moves', () => {
    // Pinned as a LIST, not a count: the blast radius of the reclassification
    // IS this set, and a silent arrival here is a behaviour change nobody
    // adjudicated. Growing it is a maintainer decision, not a refactor.
    expect(tenantScopedPlatformObjects()).toEqual([
      'sys_approval_action',
      'sys_approval_approver',
      'sys_approval_request',
      'sys_automation_run',
      'sys_file',
      'sys_notification_delivery',
      'sys_upload_session',
    ]);
  });
});

describe('#13491 gate 1 — an admitted platform object reaches #8844 derive/refuse', () => {
  it('single posture, one organization: an admitted object now DERIVES it', async () => {
    const { engine, observed } = await makeEngine({ posture: 'single' });
    await engine.insert('sys_file', { key: 'k1' }, { context: SYSTEM_CTX } as any);
    expect(lastWrite(observed, 'sys_file')?.options?.tenantId).toBe(ORG_ID);
  });

  it('single posture: a GLOBAL platform object still stays org-less — the control', async () => {
    const { engine, observed } = await makeEngine({ posture: 'single' });
    await engine.insert('sys_permission_set', { label: 'Admin' }, { context: SYSTEM_CTX } as any);
    expect(lastWrite(observed, 'sys_permission_set')?.options?.tenantId).toBeUndefined();
  });

  it('single posture: an UNCLASSIFIED platform object stays org-less — behaviour did not move', async () => {
    const { engine, observed } = await makeEngine({ posture: 'single' });
    await engine.insert('sys_audit_entry', { subject: 'e1' }, { context: SYSTEM_CTX } as any);
    expect(lastWrite(observed, 'sys_audit_entry')?.options?.tenantId).toBeUndefined();
  });

  it.each(['isolated', 'group'] as const)(
    '%s posture: an org-less system write on an admitted object is REFUSED, loudly',
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
    '%s posture: a GLOBAL platform object is NOT refused — the discriminating control',
    async (posture) => {
      const { engine, observed } = await makeEngine({ posture });
      await engine.insert('sys_permission_set', { label: 'Admin' }, { context: SYSTEM_CTX } as any);
      expect(lastWrite(observed, 'sys_permission_set')?.options?.tenantId).toBeUndefined();
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

describe('#13491 gate 2 — the isSystem mute narrows by the SAME classification', () => {
  it('an elevated write on an admitted platform object is no longer auto-muted', async () => {
    const { engine, observed } = await makeEngine({ posture: 'single' });
    await engine.insert('sys_file', { key: 'k1' }, { context: SYSTEM_CTX } as any);
    expect(lastWrite(observed, 'sys_file')?.options?.bypassTenantAudit).toBeUndefined();
  });

  it('an elevated write on an ordinary tenant-scoped object is no longer auto-muted', async () => {
    // The 135-of-175 population the census measured. Restoring it is the whole
    // reason the control has an effective population at all.
    const { engine, observed } = await makeEngine({ posture: 'single' });
    await engine.insert('dispatch_order', { subject: 'e1' }, { context: SYSTEM_CTX } as any);
    expect(lastWrite(observed, 'dispatch_order')?.options?.bypassTenantAudit).toBeUndefined();
  });

  it('a GLOBAL platform object is still muted — #8672, inherited per object', async () => {
    const { engine, observed } = await makeEngine({ posture: 'single' });
    await engine.insert('sys_permission_set', { label: 'Admin' }, { context: SYSTEM_CTX } as any);
    expect(lastWrite(observed, 'sys_permission_set')?.options?.bypassTenantAudit).toBe(true);
  });

  it('an UNCLASSIFIED platform object is still muted — status quo, pending adjudication', async () => {
    const { engine, observed } = await makeEngine({ posture: 'single' });
    await engine.insert('sys_audit_entry', { subject: 'e1' }, { context: SYSTEM_CTX } as any);
    expect(lastWrite(observed, 'sys_audit_entry')?.options?.bypassTenantAudit).toBe(true);
  });

  it('an object with NO tenant field is still muted — nothing to be unscoped from', async () => {
    const { engine, observed } = await makeEngine({ posture: 'single' });
    await engine.insert('billing_license', { subject: 'e1' }, { context: SYSTEM_CTX } as any);
    expect(lastWrite(observed, 'billing_license')?.options?.bypassTenantAudit).toBe(true);
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
