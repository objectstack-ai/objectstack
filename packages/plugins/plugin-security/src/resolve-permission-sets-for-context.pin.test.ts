// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7616] `resolvePermissionSetsForContext` — DECLARED = REACHABLE.
 *
 * `ISecurityService` declaring a method proves nothing about a deployment: the
 * consumers of this surface (`/auth/me/permissions`, `/me/apps` in
 * `plugin-hono-server`) must never take a runtime dependency on this plugin —
 * it is optional in the stacks those endpoints serve — so the ONLY seam they
 * can reach it through is the service locator. A method the class declares but
 * the registered literal does not expose is unreachable across that seam, and
 * a consumer's feature detection would correctly report it absent forever.
 *
 * So every case below resolves the service the way a cross-package consumer
 * does — off the `ctx.registerService('security', …)` call — and never off the
 * plugin instance. `getMetadataReadableFields` is pinned the same way in
 * `get-metadata-readable-fields.test.ts`; this file extends the pattern to the
 * one thing that surface could not answer before: the sets themselves.
 *
 * The second half is what makes the declaration honest rather than nominal. The
 * contract says the sets come back WHOLE — `objects`, `fields`,
 * `systemPermissions`, `tabPermissions` — because a consumer that must MERGE
 * the caller's grants cannot reach any of those four from
 * `resolvePermissionSetNames`. Each is asserted through the located handle, on
 * BOTH paths a set can arrive by (the metadata list, and the security
 * catalog's definition through the plugin's catalog loader — ADR-0131 D3/D4),
 * because a loader is where a column silently goes missing.
 */

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import type { PermissionSet } from '@objectstack/spec/security';
import type { ISecurityService } from '@objectstack/spec/contracts';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';

/** A metadata-declared set: the platform baseline every member resolves additively. */
const MEMBER_DEFAULT: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { deal: { allowRead: true } },
  fields: { 'deal.amount': { readable: true, editable: false } },
  systemPermissions: [],
  tabPermissions: { app_crm: 'default_on' },
} as any;

/**
 * An environment-authored set, as the security catalog holds it — the engine
 * registry's definition (hydrated from `sys_metadata`), which the plugin's
 * catalog loader hands back whole.
 */
const SALES_MANAGER: PermissionSet = {
  name: 'sales_manager',
  label: 'Sales Manager',
  objects: { deal: { allowRead: true, allowEdit: true } },
  fields: { 'deal.amount': { readable: true, editable: true } },
  systemPermissions: ['setup.access'],
  tabPermissions: { app_crm: 'visible' },
} as any;

/** The `sys_permission_set` reads for a set the resolution asked about — there must be none. */
let permissionSetRowReads = 0;

function bootPlugin(catalog: PermissionSet[] = [], dbRows: Array<Record<string, unknown>> = []) {
  permissionSetRowReads = 0;
  const schema: any = { name: 'deal', label: 'Deal', systemFields: false, fields: { id: { name: 'id' }, amount: { name: 'amount' } } };
  const ql: any = {
    registerMiddleware: () => {},
    getSchema: (name: string) => (name === 'deal' ? schema : null),
    findOne: async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return null; },
    find: async (object: string, query: any) => {
      if (object !== 'sys_permission_set') return [];
      // Only a read asking for a set the resolution asked about counts: the
      // boot's own background passes (the org-admin backfill, the baseline
      // binder) read their own names and race the request.
      if (/legacy_auditor|sales_manager/.test(JSON.stringify(query?.where ?? {}))) permissionSetRowReads += 1;
      const wanted: string[] = query?.where?.name?.$in ?? [];
      return dbRows.filter((r) => wanted.includes(String(r.name)));
    },
    // The engine registry the security catalog reads first (ADR-0131 D3).
    registry: {
      getItem: (type: string, name: string) => (type === 'permission' ? catalog.find((d) => d.name === name) : undefined),
      listItems: (type: string) => (type === 'permission' ? catalog : []),
      isPackageDisabled: () => false,
    },
  };
  const metadata: any = {
    get: async (_type: string, name: string) => (name === 'deal' ? schema : null),
    list: async () => [MEMBER_DEFAULT],
  };
  const services: Record<string, any> = { manifest: { register: vi.fn() }, objectql: ql, metadata };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  return { plugin: new SecurityPlugin({ fallbackPermissionSet: 'member_default' } as any), ctx };
}

/**
 * Resolve the service EXACTLY as a cross-package consumer does: as a `Partial`
 * off the locator, never off the plugin instance. The `Partial` is not
 * defensive styling — it is the contract's own availability rule, and it is
 * what makes the feature detection below the same expression the endpoints
 * will write.
 */
async function locateSecurityService(
  catalog: PermissionSet[] = [],
  dbRows: Array<Record<string, unknown>> = [],
): Promise<Partial<ISecurityService>> {
  const { plugin, ctx } = bootPlugin(catalog, dbRows);
  await plugin.init(ctx);
  await plugin.start(ctx);
  // Boot-time probes are not the resolution under test.
  permissionSetRowReads = 0;
  const registered = ctx.registerService.mock.calls.find((c: any[]) => c[0] === 'security')?.[1];
  return registered as Partial<ISecurityService>;
}

describe('[#7616] resolvePermissionSetsForContext is reachable through the service locator', () => {
  it('is exposed on the REGISTERED literal, not merely declared on the class', async () => {
    const svc = await locateSecurityService();

    // The expression a consumer writes. It is the whole point of the card: the
    // class has carried this method (privately) all along, and every previous
    // consumer still had to re-implement the resolution because this probe
    // answered `undefined`.
    expect(typeof svc.resolvePermissionSetsForContext).toBe('function');

    // The rest of the published surface is untouched — the addition is
    // additive, and a consumer that only knows the names surface is unaffected.
    expect(typeof svc.resolvePermissionSetNames).toBe('function');
    expect(typeof svc.getReadFilter).toBe('function');
  });

  it('is CALLABLE through that handle and returns the sets whole', async () => {
    const svc = await locateSecurityService([SALES_MANAGER]);

    const sets = await svc.resolvePermissionSetsForContext?.({
      userId: 'u1',
      permissions: ['sales_manager'],
    } as any);

    // Reachable AND working: a bound method that throws on call would satisfy
    // the typeof probe above and fail every consumer.
    const byName = new Map((sets ?? []).map((s) => [s.name, s]));
    expect([...byName.keys()].sort()).toEqual(['member_default', 'sales_manager']);

    // All four members the names surface cannot reach, on the catalog-loaded
    // set — the path where a member could go missing.
    const dbAuthored: any = byName.get('sales_manager');
    expect(dbAuthored.objects).toEqual({ deal: { allowRead: true, allowEdit: true } });
    expect(dbAuthored.fields).toEqual({ 'deal.amount': { readable: true, editable: true } });
    expect(dbAuthored.systemPermissions).toEqual(['setup.access']);
    // The member `/me/apps` filters its app list with (#7616): dropped, it
    // would make the published contract false for every environment-authored
    // set the moment a consumer trusted it.
    expect(dbAuthored.tabPermissions).toEqual({ app_crm: 'visible' });

    // …and on the metadata-declared set, which arrives by the other path.
    const declared: any = byName.get('member_default');
    expect(declared.objects).toEqual({ deal: { allowRead: true } });
    expect(declared.systemPermissions).toEqual([]);
    expect(declared.tabPermissions).toEqual({ app_crm: 'default_on' });
  });

  it('is the SAME resolution the names surface reports — baseline additive, no cliff', async () => {
    const svc = await locateSecurityService([SALES_MANAGER]);
    const context = { userId: 'u1', permissions: ['sales_manager'] } as any;

    const names = await svc.resolvePermissionSetNames?.(context);
    const sets = await svc.resolvePermissionSetsForContext?.(context);

    // Not "two methods that agree today" — the names surface is literally
    // `.map(s => s.name)` over these sets. Pinning the equality is what stops a
    // future edit from giving the two surfaces separate resolutions, which is
    // the drift shape this card exists to end.
    expect((sets ?? []).map((s) => s.name)).toEqual(names);

    // [ADR-0090 D5 / #7608] The baseline is ADDITIVE: a caller holding an
    // explicit grant still resolves `member_default`. The `resolved.length === 0`
    // cliff is what took a member from 2 apps to 1 on `/me/apps` the day they
    // received their first grant — a consumer delegating here inherits the
    // corrected rule instead of re-deriving it.
    expect(names).toContain('member_default');
    expect(names).toContain('sales_manager');
  });

  it('a caller with no grants of their own still resolves the baseline', async () => {
    const svc = await locateSecurityService();

    const sets = await svc.resolvePermissionSetsForContext?.({ userId: 'u1' } as any);
    expect((sets ?? []).map((s) => s.name)).toEqual(['member_default']);
  });

  it('an ANONYMOUS caller resolves nothing — the baseline is gated on a principal', async () => {
    const svc = await locateSecurityService();

    // No `userId` → no additive baseline, matching the engine middleware. The
    // contract promises the enforcement path's answer, so this surface must not
    // hand a guest the member floor either.
    const sets = await svc.resolvePermissionSetsForContext?.({ positions: [], permissions: [] } as any);
    expect(sets).toEqual([]);
  });
});

/**
 * [ADR-0131 D3/D4] A set is the security catalog's definition; no
 * `sys_permission_set` row is read.
 *
 * The plugin's third source used to be a per-organization row loader (the
 * caller's own row, else an organization-less one). The authorization
 * resolver already took a set's body from the catalog and granted nothing
 * through a row-only set (#15196 Q3 = A); a row fallback here applied that
 * set's object map anyway — two sources with opposite verdicts on one set.
 * The loader now reads the catalog, which is environment-level: the same
 * definition for a caller in any organization or none.
 */
const ROW_ONLY = {
  name: 'legacy_auditor',
  label: 'Legacy Auditor',
  organization_id: 'org_a',
  object_permissions: JSON.stringify({ deal: { allowRead: true, allowDelete: true } }),
  active: true,
};

describe('[ADR-0131 D3/D4] the catalog loader reads definitions, never sys_permission_set rows', () => {
  for (const [label, organizationId] of [['in an organization', 'org_a'], ['with no organization', undefined]] as const) {
    it(`a set only a row carries resolves nothing for a caller ${label}, and no row is read`, async () => {
      const svc = await locateSecurityService([], [ROW_ONLY, { ...ROW_ONLY, organization_id: null }]);
      const sets = await svc.resolvePermissionSetsForContext?.({
        userId: 'u1',
        ...(organizationId ? { organizationId } : {}),
        permissions: ['legacy_auditor'],
      } as any);
      expect((sets ?? []).map((s) => s.name)).toEqual(['member_default']);
      expect(permissionSetRowReads).toBe(0);
    });

    it(`CONTROL: the catalog's definition resolves whole for a caller ${label}`, async () => {
      const svc = await locateSecurityService([SALES_MANAGER], [ROW_ONLY]);
      const sets = await svc.resolvePermissionSetsForContext?.({
        userId: 'u1',
        ...(organizationId ? { organizationId } : {}),
        permissions: ['sales_manager'],
      } as any);
      const found: any = (sets ?? []).find((s) => s.name === 'sales_manager');
      expect(found?.objects).toEqual({ deal: { allowRead: true, allowEdit: true } });
      expect(permissionSetRowReads).toBe(0);
    });
  }
});
