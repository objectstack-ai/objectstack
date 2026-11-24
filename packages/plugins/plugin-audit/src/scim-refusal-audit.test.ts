// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31829] The SCIM refusal writer stores a REAL, READ-BACK `scim_refused` row
 * for each refused SCIM request plugin-auth hands it.
 *
 * The slot cases boot the real composition this package ships in
 * (`ObjectQLPlugin` + `AuditPlugin` on a sqlite driver) and reach the writer
 * the way plugin-auth's SCIM door does: through the `audit` service slot's
 * `recordScimRefusal`. Every assertion reads the row back, for the reason
 * `auth-event-audit.test.ts` records: every `sys_audit_log` field is
 * `readonly`, so "the call did not throw" is equally true when the row landed
 * right, landed wrong, or was never attempted. The door's half — which
 * refusals reach the slot, the bound, and that nothing secret is handed over —
 * is pinned in plugin-auth's `scim-refusal-audit.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { AuditPlugin } from './audit-plugin.js';
import {
  SCIM_MANAGER_REFERENCE_LIMIT,
  SCIM_MANAGER_UNRESOLVED_AUDIT_ACTION,
  SCIM_REFUSED_AUDIT_ACTION,
  buildScimManagerUnresolvedAuditRow,
  buildScimRefusalAuditRow,
  createScimRefusalAuditWriter,
  type ScimManagerUnresolvedAuditEvent,
  type ScimRefusalAuditEvent,
  type ScimRefusalAuditWriter,
} from './scim-refusal-audit.js';

const LEDGER = 'sys_audit_log';
const SYS = { isSystem: true } as const;

/** A 409 as the door hands it; each case overrides what it is about. */
function refusal(overrides: Partial<ScimRefusalAuditEvent> = {}): ScimRefusalAuditEvent {
  return {
    connectionId: 'okta-31829',
    organizationId: 'org_31829',
    resource: 'Users',
    method: 'POST',
    status: 409,
    scimType: 'uniqueness',
    ipAddress: '203.0.113.7',
    ...overrides,
  };
}

const metadataOf = (row: Record<string, unknown>): Record<string, any> => JSON.parse(String(row.metadata));

/** [#33918] A served write whose manager reference named no User, as plugin-auth hands it. */
function unresolved(overrides: Partial<ScimManagerUnresolvedAuditEvent> = {}): ScimManagerUnresolvedAuditEvent {
  return {
    connectionId: 'okta-33918',
    organizationId: 'org_33918',
    userId: 'usr_emp_33918',
    referenceKind: 'id',
    reference: 'no-such-scim-id',
    ...overrides,
  };
}

describe('[#31829] the SCIM refusal writer on the real `audit` slot', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let audit: ScimRefusalAuditWriter;

  /** The `scim_refused` rows at rest, oldest first. */
  const rows = async (): Promise<Array<Record<string, any>>> =>
    (await engine.find(LEDGER, {
      where: { action: SCIM_REFUSED_AUDIT_ACTION },
      orderBy: [{ field: 'created_at', order: 'asc' }],
      context: SYS,
    })) as Array<Record<string, any>>;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();
    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    await engine.syncSchemas();
    audit = kernel.getService<ScimRefusalAuditWriter>('audit');
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('the slot carries the writer beside the other ledger ingresses', () => {
    expect(typeof audit.recordScimRefusal).toBe('function');
    expect(typeof (audit as any).recordAuthEvent).toBe('function');
    expect(typeof (audit as any).recordDataExport).toBe('function');
  });

  it('a refusal on a verified connection writes ONE row naming it, its organization, the request, the status and the SCIM type', async () => {
    const before = (await rows()).length;
    await audit.recordScimRefusal(refusal());
    const after = await rows();
    expect(after).toHaveLength(before + 1);
    const row = after[after.length - 1]!;
    expect(row).toMatchObject({
      action: 'scim_refused',
      user_id: null,
      actor: 'svc:scim:okta-31829',
      object_name: null,
      record_id: null,
      tenant_id: 'org_31829',
      ip_address: '203.0.113.7',
    });
    expect(row.old_value ?? null).toBeNull();
    expect(row.new_value ?? null).toBeNull();
    expect(metadataOf(row)).toEqual({
      scim_connection_id: 'okta-31829',
      resource: 'Users',
      method: 'POST',
      status: 409,
      scim_type: 'uniqueness',
    });
  });

  it('a 401 names no connection: actor null, tenant null, `unknown`, and which kind of credential was presented', async () => {
    await audit.recordScimRefusal({
      // An organization with no connection is not recorded: it rides only with one.
      organizationId: 'org_31829',
      presentedCredential: 'scim_bearer',
      resource: 'Users',
      method: 'GET',
      status: 401,
      ipAddress: '198.51.100.9',
    });
    const row = (await rows()).at(-1)!;
    expect(row).toMatchObject({ actor: null, user_id: null, tenant_id: null, ip_address: '198.51.100.9' });
    expect(metadataOf(row)).toEqual({
      scim_connection_id: 'unknown',
      presented_credential: 'scim_bearer',
      resource: 'Users',
      method: 'GET',
      status: 401,
    });
  });

  it('a connection whose credential names no organization writes a deployment-level row (tenant null)', async () => {
    await audit.recordScimRefusal(refusal({ connectionId: 'azure-31829', organizationId: undefined, status: 404, scimType: undefined }));
    const row = (await rows()).at(-1)!;
    expect(row).toMatchObject({ actor: 'svc:scim:azure-31829', tenant_id: null });
  });

  it('a row after a bounded burst carries the dropped count as `suppressed`', async () => {
    await audit.recordScimRefusal(refusal({ method: 'GET', status: 404, scimType: undefined, suppressed: 7 }));
    expect(metadataOf((await rows()).at(-1)!)).toEqual({
      scim_connection_id: 'okta-31829',
      resource: 'Users',
      method: 'GET',
      status: 404,
      suppressed: 7,
    });
  });

  it('[#33918] an unresolvable manager reference writes ONE row on the user\'s record, naming the connection and the reference', async () => {
    const at = async () => (await engine.find(LEDGER, {
      where: { action: SCIM_MANAGER_UNRESOLVED_AUDIT_ACTION },
      context: SYS,
    })) as Array<Record<string, any>>;
    const before = (await at()).length;
    await audit.recordScimManagerUnresolved(unresolved({ suppressed: 4 }));
    const after = await at();
    expect(after).toHaveLength(before + 1);
    const row = after.at(-1)!;
    expect(row).toMatchObject({
      action: 'scim_manager_unresolved',
      user_id: null,
      actor: 'svc:scim:okta-33918',
      object_name: 'sys_user',
      record_id: 'usr_emp_33918',
      tenant_id: 'org_33918',
    });
    expect(row.old_value ?? null).toBeNull();
    expect(row.new_value ?? null).toBeNull();
    expect(metadataOf(row)).toEqual({
      scim_connection_id: 'okta-33918',
      reference_kind: 'id',
      manager_reference: 'no-such-scim-id',
      suppressed: 4,
    });
  });

  it('an event that is not a refusal (no status of 400 or above) writes nothing', async () => {
    const before = (await rows()).length;
    await audit.recordScimRefusal(refusal({ status: 201 }));
    await audit.recordScimRefusal(refusal({ status: '409' as any }));
    await audit.recordScimRefusal(undefined as any);
    expect(await rows()).toHaveLength(before);
  });
});

describe('[#31829] the scim_refused row never carries what the request sent', () => {
  const all = () => true;

  it('fields the event type does not declare never reach the row', () => {
    const row = buildScimRefusalAuditRow(
      {
        ...refusal(),
        detail: 'SCIM User userName alice@example.com already exists',
        bearer: 'oss_scim_SECRETSECRET',
        body: { userName: 'alice@example.com' },
      } as any,
      all,
    )!;
    const stored = JSON.stringify(row);
    for (const value of ['alice@example.com', 'oss_scim_', 'SECRETSECRET', 'already exists']) {
      expect(stored.includes(value), `the row carries ${value}: ${stored}`).toBe(false);
    }
  });

  it('every declared field is re-checked against its token shape', () => {
    const row = buildScimRefusalAuditRow(
      {
        connectionId: 'okta 31829; drop',
        organizationId: 'org 31829; drop',
        presentedCredential: 'oss_scim_SECRET' as any,
        resource: 'Users/alice@example.com',
        method: 'brew',
        status: 400,
        scimType: 'invalid value: alice@example.com',
        errorCode: 'not a code',
        ipAddress: 'alice@example.com',
        suppressed: -3,
      },
      all,
    )!;
    expect(row).toMatchObject({ actor: null, ip_address: null, tenant_id: null });
    expect(metadataOf(row)).toEqual({
      scim_connection_id: 'unknown',
      presented_credential: 'none',
      resource: '?',
      method: '?',
      status: 400,
    });
  });

  it('a ledger deployed without the `actor` column gets no `actor` key', () => {
    const row = buildScimRefusalAuditRow(refusal(), (_o, field) => field !== 'actor')!;
    expect(row).not.toHaveProperty('actor');
    expect(metadataOf(row).scim_connection_id).toBe('okta-31829');
  });

  it('a malformed organization on a verified connection is not stamped', () => {
    const row = buildScimRefusalAuditRow(refusal({ organizationId: 'org 31829; drop' }), all)!;
    expect(row).toMatchObject({ actor: 'svc:scim:okta-31829', tenant_id: null });
  });
});

describe('[#31829] the writer never changes the SCIM answer', () => {
  it('with no engine it writes nothing and does not throw', async () => {
    const writer = createScimRefusalAuditWriter({ getEngine: () => undefined });
    await expect(writer.recordScimRefusal(refusal())).resolves.toBeUndefined();
  });

  it('a refused insert is reported at error once per cause, and never thrown', async () => {
    const error = vi.fn();
    const debug = vi.fn();
    const failing = {
      insert: async () => {
        throw Object.assign(new Error('disk full'), { code: 'SQLITE_FULL' });
      },
      getSchema: () => undefined,
    } as any;
    const writer = createScimRefusalAuditWriter({ getEngine: () => failing, logger: { error, debug, warn: vi.fn() } });

    await expect(writer.recordScimRefusal(refusal())).resolves.toBeUndefined();
    await expect(writer.recordScimRefusal(refusal())).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('scim_refused');
    expect(debug).toHaveBeenCalledTimes(1);
  });
});

describe('[#33918] the scim_manager_unresolved row is bounded to the reference', () => {
  const all = () => true;

  it('the reference is capped, and the row says it was', () => {
    const long = 'r'.repeat(SCIM_MANAGER_REFERENCE_LIMIT + 1);
    const meta = metadataOf(buildScimManagerUnresolvedAuditRow(unresolved({ reference: long }), all)!);
    expect(meta.manager_reference).toBe(long.slice(0, SCIM_MANAGER_REFERENCE_LIMIT));
    expect(meta.manager_reference_truncated).toBe(true);
    const exact = metadataOf(buildScimManagerUnresolvedAuditRow(unresolved({ reference: long.slice(1) }), all)!);
    expect(exact).not.toHaveProperty('manager_reference_truncated');
  });

  it('fields the event type does not declare never reach the row', () => {
    const row = buildScimManagerUnresolvedAuditRow(
      { ...unresolved(), body: { userName: 'alice@example.com' }, email: 'alice@example.com', bearer: 'oss_scim_SECRET' } as any,
      all,
    )!;
    const stored = JSON.stringify(row);
    for (const value of ['alice@example.com', 'oss_scim_', 'SECRET']) {
      expect(stored.includes(value), `the row carries ${value}: ${stored}`).toBe(false);
    }
  });

  it('an event that cannot name its connection, its user or its reference writes nothing', () => {
    expect(buildScimManagerUnresolvedAuditRow(unresolved({ connectionId: 'okta 33918; drop' }), all)).toBeNull();
    expect(buildScimManagerUnresolvedAuditRow(unresolved({ userId: '' }), all)).toBeNull();
    expect(buildScimManagerUnresolvedAuditRow(unresolved({ referenceKind: 'email' as any }), all)).toBeNull();
    expect(buildScimManagerUnresolvedAuditRow(unresolved({ reference: '' }), all)).toBeNull();
    expect(buildScimManagerUnresolvedAuditRow(undefined as any, all)).toBeNull();
  });

  it('a malformed organization is not stamped, and a ledger without `actor` gets no `actor` key', () => {
    expect(buildScimManagerUnresolvedAuditRow(unresolved({ organizationId: 'org 33918; drop' }), all))
      .toMatchObject({ tenant_id: null, actor: 'svc:scim:okta-33918' });
    expect(buildScimManagerUnresolvedAuditRow(unresolved(), (_o, field) => field !== 'actor')).not.toHaveProperty('actor');
  });

  it('a refused insert is reported at error once per cause, apart from the refusal rows, and never thrown', async () => {
    const error = vi.fn();
    const debug = vi.fn();
    const failing = {
      insert: async () => {
        throw Object.assign(new Error('disk full'), { code: 'SQLITE_FULL' });
      },
      getSchema: () => undefined,
    } as any;
    const writer = createScimRefusalAuditWriter({ getEngine: () => failing, logger: { error, debug, warn: vi.fn() } });

    await expect(writer.recordScimManagerUnresolved(unresolved())).resolves.toBeUndefined();
    await expect(writer.recordScimManagerUnresolved(unresolved())).resolves.toBeUndefined();
    await expect(writer.recordScimRefusal(refusal())).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(2);
    expect(String(error.mock.calls[0]?.[0])).toContain('scim_manager_unresolved');
    expect(String(error.mock.calls[1]?.[0])).toContain('scim_refused');
    expect(debug).toHaveBeenCalledTimes(1);
  });
});
