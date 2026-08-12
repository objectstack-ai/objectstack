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
 * BOTH authoring paths a set can arrive by (declared in metadata, and authored
 * in `sys_permission_set` through the DB loader), because the loader is where
 * a column silently goes missing.
 */

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import type { PermissionSet } from '@objectstack/spec/security';
import type { ISecurityService } from '@objectstack/spec/contracts';

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
 * A DB-authored set, as it sits in `sys_permission_set` — snake_case columns,
 * JSON-encoded payloads. This is the row shape the plugin's `dbLoader` parses,
 * and the shape `/me/apps` reads `tab_permissions` off today in its own copy.
 */
const SALES_MANAGER_ROW = {
  name: 'sales_manager',
  label: 'Sales Manager',
  object_permissions: JSON.stringify({ deal: { allowRead: true, allowEdit: true } }),
  field_permissions: JSON.stringify({ 'deal.amount': { readable: true, editable: true } }),
  system_permissions: JSON.stringify(['setup.access']),
  tab_permissions: JSON.stringify({ app_crm: 'visible' }),
};

function bootPlugin(dbRows: Array<Record<string, unknown>> = []) {
  const schema: any = { name: 'deal', label: 'Deal', systemFields: false, fields: { id: { name: 'id' }, amount: { name: 'amount' } } };
  const ql: any = {
    registerMiddleware: () => {},
    getSchema: (name: string) => (name === 'deal' ? schema : null),
    findOne: async () => null,
    find: async (object: string, query: any) => {
      if (object !== 'sys_permission_set') return [];
      const wanted: string[] = query?.where?.name?.$in ?? [];
      return dbRows.filter((r) => wanted.includes(String(r.name)));
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
async function locateSecurityService(dbRows: Array<Record<string, unknown>> = []): Promise<Partial<ISecurityService>> {
  const { plugin, ctx } = bootPlugin(dbRows);
  await plugin.init(ctx);
  await plugin.start(ctx);
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
    const svc = await locateSecurityService([SALES_MANAGER_ROW]);

    const sets = await svc.resolvePermissionSetsForContext?.({
      userId: 'u1',
      permissions: ['sales_manager'],
    } as any);

    // Reachable AND working: a bound method that throws on call would satisfy
    // the typeof probe above and fail every consumer.
    const byName = new Map((sets ?? []).map((s) => [s.name, s]));
    expect([...byName.keys()].sort()).toEqual(['member_default', 'sales_manager']);

    // All four columns the names surface cannot reach, on the DB-authored set —
    // the path where a column goes missing, since the loader projects the row
    // by hand.
    const dbAuthored: any = byName.get('sales_manager');
    expect(dbAuthored.objects).toEqual({ deal: { allowRead: true, allowEdit: true } });
    expect(dbAuthored.fields).toEqual({ 'deal.amount': { readable: true, editable: true } });
    expect(dbAuthored.systemPermissions).toEqual(['setup.access']);
    // The column `/me/apps` filters its app list with. Dropped by this loader
    // until #7616 — which would have made the published contract false for
    // every DB-authored set the moment a consumer trusted it.
    expect(dbAuthored.tabPermissions).toEqual({ app_crm: 'visible' });

    // …and on the metadata-declared set, which arrives by the other path.
    const declared: any = byName.get('member_default');
    expect(declared.objects).toEqual({ deal: { allowRead: true } });
    expect(declared.systemPermissions).toEqual([]);
    expect(declared.tabPermissions).toEqual({ app_crm: 'default_on' });
  });

  it('is the SAME resolution the names surface reports — baseline additive, no cliff', async () => {
    const svc = await locateSecurityService([SALES_MANAGER_ROW]);
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
