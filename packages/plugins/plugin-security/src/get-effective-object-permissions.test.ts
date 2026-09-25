// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18783] `ISecurityService.getEffectiveObjectPermissions` — the effective
 * object-permission map, and the one producer behind both `/auth/me/permissions`
 * and the map `current_user.can()` reads on the write path.
 *
 * Every case resolves the service the way a cross-package consumer does — off
 * the `ctx.registerService('security', …)` call, as a `Partial` (the contract's
 * availability rule) — never off the plugin instance, so what is pinned is the
 * member a consumer can actually REACH.
 *
 * What the contract member's docblock requires, clause by clause:
 *
 *  - byte-for-byte the `objects` slot of `/auth/me/permissions` — pinned as
 *    equality with `buildEffectiveObjectPermissions` (`@objectstack/core`) over
 *    the same resolution and the same engine, the function the endpoint builds
 *    that slot with (the endpoint's own half is pinned in plugin-hono-server's
 *    `current-user-endpoints-effective-objects.test.ts`);
 *  - the WHOLE map — seeded, folded, clamped and annotated, not a slice;
 *  - it THROWS on resolution failure and ⛔ never answers `{}`;
 *  - request-scoped: resolved per ask, never cached across requests.
 *
 * And the wiring half: the SAME method is what the plugin registers on the
 * engine, and an engine without the seam is reported, not silently skipped.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildEffectiveObjectPermissions } from '@objectstack/core';
import type { ISecurityService } from '@objectstack/spec/contracts';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';

/** The metadata-declared baseline every member resolves additively. */
const MEMBER_DEFAULT: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { deal: { allowRead: true }, sys_member: { allowRead: true } },
  fields: {},
  systemPermissions: [],
  tabPermissions: {},
} as any;

/**
 * A DB-authored super-user set: a `'*'` wildcard carrying both bypass bits
 * (and, per #8681, no `allowExport`), plus an explicit write-deny on a
 * better-auth object — the shape that makes all four folds fire.
 */
const OPS_ADMIN_ROW = {
  name: 'ops_admin',
  label: 'Ops Admin',
  object_permissions: JSON.stringify({
    '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true },
    sys_member: { allowRead: true, allowEdit: false },
  }),
  field_permissions: JSON.stringify({}),
  system_permissions: JSON.stringify([]),
  tab_permissions: JSON.stringify({}),
};

/** A DB-authored plain grant — no wildcard, no bypass. */
const SALES_ROW = {
  name: 'sales',
  label: 'Sales',
  object_permissions: JSON.stringify({ deal: { allowRead: true, allowEdit: true } }),
  field_permissions: JSON.stringify({}),
  system_permissions: JSON.stringify([]),
  tab_permissions: JSON.stringify({}),
};

/** Registered schemas: one plain, one better-auth-managed, one whose `apiMethods` tighten exposure. */
const SCHEMAS: Record<string, any> = {
  deal: { name: 'deal', label: 'Deal', fields: { id: { name: 'id' } } },
  sys_member: { name: 'sys_member', label: 'Member', managedBy: 'better-auth', fields: { id: { name: 'id' } } },
  report: { name: 'report', label: 'Report', enable: { apiMethods: ['get', 'list'] }, fields: { id: { name: 'id' } } },
};

function bootPlugin(opts: { dbRows?: Array<Record<string, unknown>>; engineSeam?: boolean } = {}) {
  const dbRows = opts.dbRows ?? [];
  const permissionSetReads: string[][] = [];
  const registered: Array<(context: unknown) => Promise<unknown>> = [];
  const ql: any = {
    registerMiddleware: () => {},
    registry: { getAllObjects: () => Object.values(SCHEMAS) },
    getSchema: (name: string) => SCHEMAS[name] ?? null,
    find: async (object: string, query: any) => {
      if (object !== 'sys_permission_set') return [];
      const wanted: string[] = query?.where?.name?.$in ?? [];
      permissionSetReads.push(wanted);
      return dbRows.filter((r) => wanted.includes(String(r.name)));
    },
  };
  if (opts.engineSeam !== false) {
    ql.registerEffectiveObjectPermissionsResolver = (fn: (context: unknown) => Promise<unknown>) => registered.push(fn);
  }
  const metadata: any = {
    get: async (_type: string, name: string) => SCHEMAS[name] ?? null,
    list: async () => [MEMBER_DEFAULT],
  };
  const services: Record<string, any> = { manifest: { register: vi.fn() }, objectql: ql, metadata };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' } as any);
  return { plugin, ctx, ql, permissionSetReads, registered };
}

async function locate(opts?: Parameters<typeof bootPlugin>[0]) {
  const booted = bootPlugin(opts);
  await booted.plugin.init(booted.ctx);
  await booted.plugin.start(booted.ctx);
  const svc = booted.ctx.registerService.mock.calls.find((c: any[]) => c[0] === 'security')?.[1] as Partial<ISecurityService>;
  return { ...booted, svc };
}

/** The endpoint's computation, stated the way `/auth/me/permissions` states it: its sets, its engine. */
function endpointObjects(sets: unknown, ql: any) {
  return buildEffectiveObjectPermissions(sets as any, {
    allSchemas: () => ql.registry.getAllObjects(),
    schemaOf: (name) => ql.getSchema(name),
  });
}

const ADMIN = { userId: 'u_admin', permissions: ['ops_admin'] } as any;
const REP = { userId: 'u_rep', permissions: ['sales'] } as any;

describe('[#18783] getEffectiveObjectPermissions — reachable, and the endpoint\'s answer', () => {
  it('is exposed on the REGISTERED literal, where a cross-package consumer feature-detects it', async () => {
    const { svc } = await locate();
    expect(typeof svc.getEffectiveObjectPermissions).toBe('function');
  });

  it('is BYTE-EQUAL to the /auth/me/permissions computation over the same resolution', async () => {
    const { svc, ql } = await locate({ dbRows: [OPS_ADMIN_ROW, SALES_ROW] });
    for (const context of [ADMIN, REP, { userId: 'u_member' }]) {
      const sets = await svc.resolvePermissionSetsForContext!(context);
      const member = await svc.getEffectiveObjectPermissions!(context);
      expect(JSON.stringify(member), context.userId).toBe(JSON.stringify(endpointObjects(sets, ql)));
    }
  });

  it('is the WHOLE map — merged, seeded, folded, clamped and annotated, not a slice', async () => {
    const { svc } = await locate({ dbRows: [OPS_ADMIN_ROW] });
    const map: any = await svc.getEffectiveObjectPermissions!(ADMIN);
    // Fold: the wildcard super-user reaches an object another set named explicitly.
    expect(map.deal).toMatchObject({ allowRead: true, allowEdit: true, allowDelete: true });
    // Seed: a restricting object no set names still gets an entry for a super-user…
    expect(map.report).toMatchObject({ allowRead: true, allowEdit: true });
    // …annotated with its effective operation set.
    expect(Array.isArray(map.report.apiOperations)).toBe(true);
    // Clamp: the better-auth guard wins over the fold on a write the object never opted in.
    expect(map.sys_member).toMatchObject({ allowRead: true, allowEdit: false, allowCreate: false, allowDelete: false });
    // The wildcard itself is carried, as the endpoint serves it.
    expect(map['*']).toMatchObject({ modifyAllRecords: true });
  });

  it('is frozen at the top level and aliases no permission set', async () => {
    const { svc } = await locate({ dbRows: [SALES_ROW] });
    const sets: any[] = await svc.resolvePermissionSetsForContext!(REP);
    const map: any = await svc.getEffectiveObjectPermissions!(REP);
    expect(Object.isFrozen(map)).toBe(true);
    for (const set of sets) {
      for (const entry of Object.values(set.objects ?? {})) {
        expect(Object.values(map)).not.toContain(entry);
      }
    }
  });

  it('an EMPTY map is a real answer: a caller that resolves no set gets `{}`', async () => {
    const { svc } = await locate();
    // No principal ⇒ no additive baseline ⇒ nothing resolves (the middleware's own answer).
    await expect(svc.getEffectiveObjectPermissions!({ positions: [], permissions: [] } as any)).resolves.toEqual({});
  });
});

describe('[#18783] failure stance and scope', () => {
  it('a resolution failure THROWS, untouched — it never degrades to `{}`', async () => {
    const { svc, plugin } = await locate();
    const boom = Object.assign(new Error('permission-set resolution failed'), { status: 503 });
    vi.spyOn(plugin as any, 'resolvePermissionSetsForContext').mockRejectedValueOnce(boom);
    await expect(svc.getEffectiveObjectPermissions!(REP)).rejects.toBe(boom);
  });

  it('is request-scoped: one resolution per request context, a fresh one for the next request', async () => {
    const { svc, permissionSetReads } = await locate({ dbRows: [SALES_ROW] });
    // The loads that resolve THIS subject's grant (boot-time reads name nothing).
    const salesLoads = () => permissionSetReads.filter((names) => names.includes('sales')).length;
    const before = salesLoads();
    const request1 = { ...REP };
    await svc.getEffectiveObjectPermissions!(request1);
    await svc.getEffectiveObjectPermissions!(request1);
    // Within one request the plugin's per-context memo answers the second ask.
    expect(salesLoads() - before).toBe(1);
    // A new request is a new context object — resolved again, never served from the last one.
    await svc.getEffectiveObjectPermissions!({ ...REP });
    expect(salesLoads() - before).toBe(2);
  });

  it('a grant revoked between two requests is gone from the second map', async () => {
    const rows: Array<Record<string, unknown>> = [SALES_ROW];
    const { svc } = await locate({ dbRows: rows });
    const before: any = await svc.getEffectiveObjectPermissions!({ ...REP });
    expect(before.deal.allowEdit).toBe(true);
    rows.length = 0; // the `sales` set is taken away
    const after: any = await svc.getEffectiveObjectPermissions!({ ...REP });
    expect(after.deal?.allowEdit).not.toBe(true);
  });
});

describe('[#18783] the engine is handed the same producer', () => {
  it('registers ONE resolver on the engine, and it answers exactly what the service answers', async () => {
    const { svc, registered } = await locate({ dbRows: [OPS_ADMIN_ROW, SALES_ROW] });
    expect(registered).toHaveLength(1);
    for (const context of [ADMIN, REP]) {
      const viaEngine = await registered[0](context);
      const viaService = await svc.getEffectiveObjectPermissions!(context);
      expect(JSON.stringify(viaEngine)).toBe(JSON.stringify(viaService));
    }
  });

  it('an engine without the seam is REPORTED at start — absence is loud, not silent', async () => {
    const { ctx, registered } = await locate({ engineSeam: false });
    expect(registered).toHaveLength(0);
    const lines = ctx.logger.warn.mock.calls.map((c: any[]) => String(c[0]));
    expect(lines.some((l: string) => l.includes('registerEffectiveObjectPermissionsResolver'))).toBe(true);
  });
});
