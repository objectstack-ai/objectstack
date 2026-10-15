// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D7 · #23429 E2, the #22107 precedent] Who reads the `sys_metadata`
 * family through the generic data door, on the real `SecurityPlugin`
 * middleware, with the family's REAL declarations.
 *
 * The family declares no organization column (`systemFields.tenant: false`),
 * so there is no tenant wall on it, and a walled deployment's
 * `organization_admin` holds a `'*'` grant with `viewAllRecords`. Without an
 * object-level gate that admin would read every organization's audit trail,
 * history bodies and commit ranges. `sys_metadata_audit`, `_history` and
 * `_commit` therefore require `studio.access` (platform-scoped: no tenant
 * administrator holds it by role); `sys_metadata` itself stays ungated — its
 * rows are what `/meta` already serves to every organization.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  SysMetadataAuditObject,
  SysMetadataCommitObject,
  SysMetadataHistoryObject,
  SysMetadataObject,
  assertEngineFindOnePredicate,
  type EngineFindOneQueryInput,
} from '@objectstack/metadata-core';
import { PLATFORM_CAPABILITIES } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';

/** The real middleware over one real declaration (the `security-plugin.test.ts` harness shape). */
async function middlewareFor(
  schema: any,
  permissionSets: PermissionSet[],
  opts: { walled: boolean; fallback: string },
) {
  let middleware: any;
  const findOne = vi.fn(async (object: string, query: any) => {
    assertEngineFindOnePredicate(object, query as EngineFindOneQueryInput);
    return null;
  });
  const ql = {
    registerMiddleware: (mw: any) => { if (!middleware) middleware = mw; },
    getSchema: () => schema,
    findOne,
    find: vi.fn(async () => [] as Record<string, unknown>[]),
  };
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: { get: async () => schema, list: async () => permissionSets },
  };
  if (opts.walled) {
    services['org-scoping'] = { name: 'com.objectstack.org-scoping' };
    services['tenancy'] = { posture: 'isolated' };
  }
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: opts.fallback });
  await plugin.init(ctx);
  await plugin.start(ctx);
  return async (systemPermissions: string[]) => {
    const opCtx: any = {
      object: schema.name, operation: 'find', ast: { where: undefined },
      context: { userId: 'u1', tenantId: 'org-1', positions: [], permissions: [], systemPermissions },
    };
    await middleware(opCtx, async () => {});
    return opCtx;
  };
}

/** A walled deployment's organization administrator: the `'*'` superuser bits, the tenant RLS, no platform capability. */
const organizationAdmin: PermissionSet = {
  name: 'organization_admin', label: 'Organization admin',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true } },
  rowLevelSecurity: [
    { name: 'tenant_isolation', object: '*', operation: 'all', using: 'organization_id = current_user.organization_id' },
  ],
} as any;
/** The same grant, plus the Studio capability every `/meta` trail door admits. */
const studioHolder: PermissionSet = { ...organizationAdmin, name: 'studio_author', systemPermissions: ['studio.access'] } as any;
/** A single deployment's plain member: a read wildcard and nothing else. */
const member: PermissionSet = {
  name: 'member_default', label: 'Member',
  objects: { '*': { allowRead: true } },
} as any;

const GATED = [
  ['sys_metadata_audit', SysMetadataAuditObject],
  ['sys_metadata_history', SysMetadataHistoryObject],
  ['sys_metadata_commit', SysMetadataCommitObject],
] as const;

describe('[ADR-0131 D7] the sys_metadata family through the generic data door', () => {
  it('the gating capability is platform-scoped, so no tenant administrator holds it by role', () => {
    expect(PLATFORM_CAPABILITIES.find((c) => c.name === 'studio.access')?.scope).toBe('platform');
  });

  for (const [name, object] of GATED) {
    describe(name, () => {
      it('declares no organization column, and gates every read on studio.access', () => {
        expect((object as any).systemFields?.tenant).toBe(false);
        expect(Object.keys((object as any).fields)).not.toContain('organization_id');
        expect((object as any).requiredPermissions).toEqual(['studio.access']);
      });

      it('under a wall: the organization admin (\'*\' + viewAllRecords, no capability) is REFUSED', async () => {
        const read = await middlewareFor(object, [organizationAdmin], { walled: true, fallback: 'organization_admin' });
        await expect(read([])).rejects.toMatchObject({ name: 'PermissionDeniedError' });
      });

      it('under a wall: the studio.access holder reads', async () => {
        const read = await middlewareFor(object, [studioHolder], { walled: true, fallback: 'studio_author' });
        await expect(read(['studio.access'])).resolves.toBeDefined();
      });

      it('single: the studio.access holder reads; a plain member is refused (the table no longer answers the read wildcard alone)', async () => {
        const author = await middlewareFor(object, [studioHolder], { walled: false, fallback: 'studio_author' });
        await expect(author(['studio.access'])).resolves.toBeDefined();
        const plain = await middlewareFor(object, [member], { walled: false, fallback: 'member_default' });
        await expect(plain([])).rejects.toMatchObject({ name: 'PermissionDeniedError' });
      });
    });
  }

  it('control: sys_metadata itself stays ungated — the organization admin and a single member both read it', async () => {
    expect((SysMetadataObject as any).requiredPermissions).toBeUndefined();
    const admin = await middlewareFor(SysMetadataObject, [organizationAdmin], { walled: true, fallback: 'organization_admin' });
    await expect(admin([])).resolves.toBeDefined();
    const plain = await middlewareFor(SysMetadataObject, [member], { walled: false, fallback: 'member_default' });
    await expect(plain([])).resolves.toBeDefined();
  });
});
