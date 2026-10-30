// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26750, ruling A] The compliance ledger's deployment-level rows — rows that
 * carry no organization in `tenant_id` (ADR-0131 D7) — are served to the
 * platform administrator alone, in every tenancy posture, `single` included.
 * Pinned on the plugin's READ PATH, one boot per posture.
 *
 * ## Each boot
 *
 * `ObjectQLPlugin`, the `tenancy` service as AuthPlugin registers it for the
 * posture (its posture, whether the wall is up, and the Default Organization
 * under `single` alone), and `AuditPlugin`, which mounts the ledger's read
 * gate at `kernel:ready` — so a rule that stops being mounted fails here
 * exactly like a rule that was never written. The rows about an organization
 * are written by the real CRUD mirror; the deployment-level rows as their
 * writers write them: as the system, about no organization (service-settings'
 * GLOBAL `config_change`, plugin-security's platform-admin standing roster).
 *
 * ⛔ No security plugin, on purpose. WHICH organization's rows an organization
 * reader is served under a wall is the platform row policy's answer
 * (`sys_audit_log_org`, pinned in plugin-security's
 * `sys-audit-log-row-scope.test.ts`); the rule this package adds reads no
 * posture and no organization, so the boots below differ only in what the
 * posture changes about the WRITES, and the readers' answers must not.
 *
 * ## The readers
 *
 *  - an organization HOLDER of the ledger audit capability (the `MEMBER`
 *    rung), the reader the ruling is about;
 *  - an organization ADMIN (the `TENANT_ADMIN` rung, no capability);
 *  - the PLATFORM administrator: the `PLATFORM_ADMIN` rung, holding the
 *    capability as `admin_full_access` grants it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, type Plugin } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { AuditPlugin } from './audit-plugin.js';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

const LEDGER = 'sys_audit_log';
/** A parent object every caller reads, so the parent-record gate keeps every row about one of its records. */
const NOTE = 'dlr_note';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.deployment-level-rows';
const CAP = 'view_all_audit_log';
const SYS = { isSystem: true } as const;

type Posture = 'single' | 'group' | 'isolated';
type Row = Record<string, any>;

/** The deployment-level rows, as their writers insert them: as the system, with no organization. */
const DEPLOYMENT_LEVEL = [
  { action: 'config_change', object_name: 'sys_platform_setting', record_id: null },
  { action: 'platform_admin_standing_change', object_name: 'sys_user', record_id: null },
];

const noteObject = {
  name: NOTE,
  label: 'Note',
  fields: { name: { name: 'name', label: 'Name', type: 'text' as const } },
};

/** The `tenancy` service AuthPlugin registers for `posture`, reduced to what the audit writer asks. */
function tenancyFor(posture: Posture): Plugin {
  return {
    name: `test.tenancy-${posture}`,
    async init(ctx) {
      ctx.registerService('tenancy', {
        posture,
        isolationActive: posture !== 'single',
        defaultOrgId: async () => (posture === 'single' ? DEFAULT_ORGANIZATION_ID : null),
      });
    },
  } as Plugin;
}

const key = (r: Row) => `${r.action}:${r.object_name ?? 'NULL'}@${r.tenant_id ?? 'NULL'}`;
const keys = (rows: Row[]) => rows.map(key).sort();

describe.each(['single', 'group', 'isolated'] as const)('[#26750] deployment-level ledger rows under `%s`', (posture) => {
  /** The organization the readers and the note belong to: the Default Organization under `single`. */
  const ORG = posture === 'single' ? DEFAULT_ORGANIZATION_ID : 'org_a';
  const HOLDER = { userId: 'u_holder', tenantId: ORG, positions: ['org_member'], systemPermissions: [CAP], posture: 'MEMBER' as const };
  const ORG_ADMIN = { userId: 'u_org_admin', tenantId: ORG, positions: ['org_admin'], posture: 'TENANT_ADMIN' as const };
  const PLATFORM_ADMIN = { userId: 'u_platform', tenantId: ORG, positions: ['platform_admin'], systemPermissions: [CAP], posture: 'PLATFORM_ADMIN' as const };

  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let atRest: Row[] = [];
  let aboutTheOrganization: string[] = [];
  let deploymentLevel: string[] = [];

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(tenancyFor(posture));
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();

    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    engine.registry.registerObject(noteObject as any, HARNESS_PACKAGE);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    // The rows about the organization: the real CRUD mirror's, about a note of it.
    const noteId = (await engine.insert(NOTE, { name: 'note', organization_id: ORG }, { context: { ...SYS, tenantId: ORG } })).id;
    await engine.update(NOTE, { name: 'note, renamed' }, { where: { id: noteId }, context: { ...SYS, tenantId: ORG } });
    for (const row of DEPLOYMENT_LEVEL) {
      await engine.insert(LEDGER, { ...row, user_id: null, actor: 'svc:fixture', tenant_id: null }, { context: SYS });
    }

    atRest = await engine.find(LEDGER, { context: SYS });
    aboutTheOrganization = atRest.filter((r) => r.object_name === NOTE).map(key).sort();
    deploymentLevel = atRest.filter((r) => r.tenant_id == null).map(key).sort();
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('control: the mirror stamped the organization on its rows, and the deployment-level rows carry none', () => {
    expect(aboutTheOrganization).toEqual([`create:${NOTE}@${ORG}`, `update:${NOTE}@${ORG}`]);
    expect(deploymentLevel).toEqual(DEPLOYMENT_LEVEL.map((r) => key({ ...r, tenant_id: null })).sort());
    expect(keys(atRest)).toEqual([...aboutTheOrganization, ...deploymentLevel].sort());
  });

  it('the organization holder of the audit capability is served its organization’s rows, and no deployment-level row', async () => {
    const rows = await engine.find(LEDGER, { context: HOLDER });
    expect(keys(rows)).toEqual(aboutTheOrganization);
    expect(await engine.count(LEDGER, {}, { context: HOLDER })).toBe(aboutTheOrganization.length);
  });

  it('the organization admin is served its organization’s rows, and no deployment-level row', async () => {
    expect(keys(await engine.find(LEDGER, { context: ORG_ADMIN }))).toEqual(aboutTheOrganization);
  });

  it('a read that asks for the deployment-level rows by name or by id is served none of them', async () => {
    for (const reader of [HOLDER, ORG_ADMIN]) {
      expect(await engine.find(LEDGER, { where: { tenant_id: null }, context: reader })).toEqual([]);
      expect(await engine.count(LEDGER, { where: { action: 'platform_admin_standing_change' } }, { context: reader })).toBe(0);
      for (const row of atRest.filter((r) => r.tenant_id == null)) {
        expect(await engine.findOne(LEDGER, { where: { id: row.id }, context: reader })).toBeNull();
      }
    }
  });

  it('a grouped count sees no deployment-level row', async () => {
    const groups = await engine.aggregate(
      LEDGER,
      { groupBy: ['action'], aggregations: [{ function: 'count', alias: 'n' }], context: HOLDER },
    );
    expect(Object.fromEntries(groups.map((g: Row) => [g.action, Number(g.n)]))).toEqual({ create: 1, update: 1 });
  });

  it('the platform administrator is served both: the organization’s rows and every deployment-level row', async () => {
    const rows = await engine.find(LEDGER, { context: PLATFORM_ADMIN });
    expect(keys(rows)).toEqual([...aboutTheOrganization, ...deploymentLevel].sort());
    expect(await engine.count(LEDGER, {}, { context: PLATFORM_ADMIN })).toBe(atRest.length);
    for (const row of atRest.filter((r) => r.tenant_id == null)) {
      expect((await engine.findOne(LEDGER, { where: { id: row.id }, context: PLATFORM_ADMIN }))?.id).toBe(row.id);
    }
  });
});
