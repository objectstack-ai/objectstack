// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D9, C8 stage 8b-0h] Every minted `sys_share_link` row carries
 * `organization_id` — on a REAL engine over a REAL driver, with the REAL
 * `sys_share_link` object, so the column under test is the one the registry
 * injects and the row is read back off the driver, never off the response.
 *
 * ## Why the service decides, not the engine
 *
 * `sys_share_link` is `unclassified` in the #13491 ledger, so
 * `Engine.resolveSystemInsertOrganization` lets an organization-less system
 * insert on it through today. The mint used to rely on that and landed NULL on
 * every link. The organization is derivable at the mint — the linked record
 * and the caller are both in hand — so the service stamps it, and refuses
 * loudly where nothing names one, before and after that exemption retires.
 *
 * ## The four pins
 *
 *  1. walled: the row carries the RECORD's organization — even when the caller
 *     acts in another one (the link exposes the record, so it belongs where
 *     the record does);
 *  2. walled: an organization-less record takes the caller's organization —
 *     reached by a system caller acting in one; a session acting in one does
 *     not reach it at all (ADR-0131 D1: NULL is not an owner, and the
 *     driver's scope carries no `IS NULL` arm), so it mints nothing;
 *  3. `single`: neither names one — the Default Organization (the only one);
 *  4. walled: neither names one — refused with the engine's ADR-0112 envelope,
 *     and no row is written.
 *
 * The posture is the REQUESTED one, read from `OS_TENANCY_POSTURE`, so each
 * case stubs the environment rather than injecting an engine provider.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL, SYSTEM_WRITE_ORGANIZATION_REQUIRED_CODE } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import { ShareLinkService } from './share-link-service.js';
import { SysShareLink } from './objects/index.js';

/**
 * Return driver-created tables to a pre-18 store's shape, tenant column
 * nullable, through the driver's own drift apply door (`relax_not_null`).
 * The organization-less rows this file seeds exist only on such a store:
 * ADR-0131 D1 makes a fresh tenant column NOT NULL.
 */
async function relaxTenantColumns(driver: SqlDriver, tables: readonly string[]): Promise<void> {
  for (const table of tables) {
    const op = { type: 'relax_not_null', table, column: 'organization_id' };
    const { applied } = await driver.applyMigrationEntries([
      { kind: 'nullability_mismatch', remoteName: table, table, column: 'organization_id', category: 'needs_confirm', op } as never,
    ]);
    if (applied.length !== 1) throw new Error(`relaxTenantColumns: ${table} was not relaxed`);
  }
}

const OBJECT = 'os15212_brief';
const ORG_A = 'org_a';
const ORG_B = 'org_b';
const DEFAULT_ORG = 'org_default';

const BRIEF_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id', label: 'Id', primary: true },
  name: { type: 'text', name: 'name', label: 'Name' },
  organization_id: { type: 'text', name: 'organization_id', label: 'Org' },
};

const ORG_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id', label: 'Id', primary: true },
  name: { type: 'text', name: 'name', label: 'Name' },
};

const open: SqlDriver[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  while (open.length) await open.pop()?.disconnect?.();
});

/**
 *   brief_a  ORG_A
 *   brief_p  (null)   <- organization-less; what pins 2-4 mint on
 */
async function boot(posture: 'single' | 'isolated', organizations: readonly string[]) {
  vi.stubEnv('OS_TENANCY_POSTURE', posture);
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  open.push(driver);

  const ql = new ObjectQL();
  ql.registerDriver(driver as never, true);
  await ql.init();
  ql.registerObject({ name: OBJECT, label: 'Brief', fields: BRIEF_FIELDS } as never);
  ql.registerObject(SysShareLink as never);
  // The real `sys_organization` carries no tenant column of its own.
  ql.registerObject({ name: 'sys_organization', label: 'Organization', isSystem: true, systemFields: { tenant: false }, fields: ORG_FIELDS } as never);
  await driver.initObjects(
    [OBJECT, 'sys_share_link', 'sys_organization'].map((name) => ({ name, fields: (ql.getSchema(name) as any).fields }) as never),
  );
  await relaxTenantColumns(driver, [OBJECT, 'sys_share_link']);
  for (const id of organizations) await driver.create('sys_organization', { id, name: id } as never);
  await driver.create(OBJECT, { id: 'brief_a', name: 'A', organization_id: ORG_A } as never);
  await driver.create(OBJECT, { id: 'brief_p', name: 'P' } as never);

  const service = new ShareLinkService({ engine: ql as never, permissive: true, logger: { warn: () => {} } });
  const links = async () =>
    (await driver.find('sys_share_link', {} as never)).map((r: any) => ({
      record_id: String(r.record_id),
      organization_id: r.organization_id ?? null,
    }));
  return { ql, service, links };
}

const caller = (tenantId?: string) =>
  ({ userId: 'u_1', positions: [], permissions: [], ...(tenantId ? { tenantId } : {}) }) as unknown as ExecutionContext;

describe('[ADR-0131 D9] a minted share link carries an organization', () => {
  it("the real sys_share_link object carries the tenant column the stamp writes", async () => {
    const { ql } = await boot('isolated', [ORG_A, ORG_B]);
    expect(Object.keys((ql.getSchema('sys_share_link') as any).fields)).toContain('organization_id');
  });

  it("walled: the RECORD's organization, even when the caller acts in another", async () => {
    const { service, links } = await boot('isolated', [ORG_A, ORG_B]);
    await service.createLink({ object: OBJECT, recordId: 'brief_a' }, { ...caller(ORG_B), isSystem: true } as never);
    expect(await links()).toEqual([{ record_id: 'brief_a', organization_id: ORG_A }]);
  });

  it("walled: an organization-less record takes the caller's organization", async () => {
    const { service, links } = await boot('isolated', [ORG_A, ORG_B]);
    await service.createLink({ object: OBJECT, recordId: 'brief_p' }, { ...caller(ORG_B), isSystem: true } as never);
    expect(await links()).toEqual([{ record_id: 'brief_p', organization_id: ORG_B }]);
  });

  it('walled: a session acting in an organization does not reach an organization-less record — refused, and no row is written', async () => {
    const { service, links } = await boot('isolated', [ORG_A, ORG_B]);
    const refusal = await service
      .createLink({ object: OBJECT, recordId: 'brief_p' }, caller(ORG_B))
      .then(() => undefined, (err: unknown) => err);
    expect(refusal).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(await links()).toEqual([]);
  });

  it('single: neither names one — the Default Organization, the only one there is', async () => {
    const { service, links } = await boot('single', [DEFAULT_ORG]);
    const link = await service.createLink({ object: OBJECT, recordId: 'brief_p' }, caller());
    expect(await links()).toEqual([{ record_id: 'brief_p', organization_id: DEFAULT_ORG }]);
    // The mint response keeps the contract's shape.
    expect(link).not.toHaveProperty('organization_id');
  });

  it('walled: neither names one — refused with the ADR-0112 envelope, and no row is written', async () => {
    const { service, links } = await boot('isolated', [ORG_A, ORG_B]);
    const refusal = await service
      .createLink({ object: OBJECT, recordId: 'brief_p' }, caller())
      .then(() => undefined, (err: unknown) => err);
    expect(refusal).toMatchObject({ code: SYSTEM_WRITE_ORGANIZATION_REQUIRED_CODE, status: 500 });
    expect(await links()).toEqual([]);
  });
});
