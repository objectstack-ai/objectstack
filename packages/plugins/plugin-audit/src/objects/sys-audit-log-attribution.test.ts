// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D7] The compliance ledger carries no organization column; the
 * organization a row is ABOUT is the plain attribution field `tenant_id`.
 *
 * ## Why the column is asserted through the injection plan AND the table
 *
 * The tenant column is INJECTED at registration, never authored, so asserting
 * on `fields` alone is a phantom check. `resolveInjectedSystemColumns` is the
 * derivation `applySystemFields` consumes, so it decides whether the column is
 * registered; the provisioned table, introspected after a real schema sync, is
 * what the DDL produced. Each has a control: the same declaration without the
 * opt-out gets the column.
 *
 * ## What the read scope rests on, pinned here for plugin-security
 *
 * plugin-security's `sys-audit-log-row-scope.test.ts` measures the read scope
 * over a stand-in carrying three declarations of this object, because that
 * package does not depend on this one. Those three are pinned below against
 * the shipped declaration: the name, `systemFields: { tenant: false }`, and
 * `tenant_id` as a lookup to the organization object.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolveInjectedSystemColumns } from '@objectstack/spec/data';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin, resolveTenantFieldName } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { AuditPlugin } from '../audit-plugin.js';
import { SysAuditLog } from './sys-audit-log.object.js';

const LEDGER = 'sys_audit_log';
const SYS = { context: { isSystem: true } } as const;

describe('[ADR-0131 D7] sys_audit_log declaration: no organization column, tenant_id is the attribution field', () => {
  it('opts out of the tenant column through `systemFields.tenant`, not the platform-global posture', () => {
    expect(SysAuditLog.name).toBe(LEDGER);
    expect((SysAuditLog as { systemFields?: unknown }).systemFields).toEqual({ tenant: false });
    expect((SysAuditLog as { tenancy?: unknown }).tenancy).toBeUndefined();
  });

  it('the injection plan carries no organization column; CONTROL: without the opt-out it does', () => {
    const plan = resolveInjectedSystemColumns(SysAuditLog);
    expect(plan.tenant).toBe(false);
    expect([...plan.names]).not.toContain('organization_id');
    // Anti-vacuity: the plan still injects the identity and audit columns.
    expect([...plan.names]).toEqual(expect.arrayContaining(['id', 'created_at']));
    const { systemFields: _optOut, ...withoutOptOut } = SysAuditLog as Record<string, unknown>;
    expect(resolveInjectedSystemColumns(withoutOptOut).tenant).toBe(true);
    expect([...resolveInjectedSystemColumns(withoutOptOut).names]).toContain('organization_id');
  });

  it('tenant_id stays a lookup to the organization object, and the tenant-field resolver does not claim it', () => {
    const field = (SysAuditLog.fields as Record<string, { type?: string; reference?: string }>).tenant_id;
    expect(field?.type).toBe('lookup');
    expect(field?.reference).toBe('sys_organization');
    expect(Object.keys(SysAuditLog.fields ?? {})).not.toContain('organization_id');
    expect(resolveTenantFieldName(SysAuditLog)).toBeNull();
  });
});

describe('[ADR-0131 D7] sys_audit_log on a real engine: the table, the write, a real writer', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let driver: SqliteWasmDriver;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();
    engine = kernel.getService<ObjectQL>('objectql');
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    engine.registry.registerObject(
      { name: 'att_note', label: 'Note', fields: { title: { name: 'title', label: 'Title', type: 'text' } } } as any,
      'com.objectstack.audit.test.attribution',
    );
    await engine.syncSchemas();
  });

  afterAll(async () => {
    await kernel?.shutdown?.();
  });

  const columnsOf = async (table: string): Promise<string[]> => {
    const schema = await driver.introspectSchema();
    return (schema.tables[table]?.columns ?? []).map((c: { name: string }) => c.name);
  };

  it('the registered object and the provisioned table carry tenant_id and no organization_id', async () => {
    expect(Object.keys((engine.getSchema(LEDGER) as { fields?: object })?.fields ?? {})).not.toContain('organization_id');
    const columns = await columnsOf(LEDGER);
    expect(columns).toContain('tenant_id');
    expect(columns).not.toContain('organization_id');
    // CONTROL: an ordinary object on the same sync is provisioned WITH the column.
    expect(await columnsOf('att_note')).toContain('organization_id');
  });

  it('a row about a deployment-level action is written with no organization and no refusal', async () => {
    const row = await engine.insert(LEDGER, {
      action: 'platform_admin_standing_change',
      user_id: null,
      object_name: 'sys_user',
      record_id: null,
      tenant_id: null,
      new_value: '[]',
    }, SYS as never) as { id: string };
    const stored = await engine.findOne(LEDGER, { where: { id: row.id }, ...SYS } as never) as Record<string, unknown> | null;
    expect(stored?.action).toBe('platform_admin_standing_change');
    expect(stored?.tenant_id ?? null).toBeNull();
  });

  it('a write still naming the retired column is refused loudly, never stored silently', async () => {
    const refusal = await engine
      .insert(LEDGER, { action: 'config_change', tenant_id: null, organization_id: 'org_1' }, SYS as never)
      .then(() => undefined, (error: unknown) => error as { code?: unknown; status?: unknown });
    expect(refusal?.code).toBe('INVALID_FIELD');
    expect(refusal?.status).toBe(400);
  });

  it('a read naming the retired column is refused, not answered as an empty set', async () => {
    const refusal = await engine
      .find(LEDGER, { where: { organization_id: 'org_1' }, ...SYS } as never)
      .then(() => undefined, (error: unknown) => error as { code?: unknown; status?: unknown });
    expect(refusal?.code).toBe('INVALID_FILTER');
    expect(refusal?.status).toBe(400);
  });

  it('the record mirror stamps the organization a row is about into tenant_id', async () => {
    await engine.insert('att_note', { title: 'hello' }, { context: { userId: 'usr_1', tenantId: 'org_1', positions: [] } } as never);
    const rows = await engine.find(LEDGER, { where: { object_name: 'att_note' }, ...SYS } as never) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('create');
    expect(rows[0].tenant_id).toBe('org_1');
    expect(Object.keys(rows[0])).not.toContain('organization_id');
  });
});
