// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { OrganizationsPlugin } from './organizations-plugin.js';

// ⛔ Nothing is granted here, and nothing needs to be. In the closed runtime
// this suite opened with `grantDevelopmentMultiOrgEntitlement(...)` because the
// constructor refused without an entitlement (cloud#1020). The open package
// carries no licence check at all (ADR-0132 boundary 3), so the ~17 instances
// below construct on their own account. A grant reappearing here would mean a
// gate had been re-added to a package that must not have one.

function makeCtx(extraServices: Record<string, any> = {}) {
  const middlewares: any[] = [];
  const baseSchema = {
    name: 'task',
    fields: {
      id: { name: 'id' },
      organization_id: { name: 'organization_id' },
      owner_id: { name: 'owner_id' },
      name: { name: 'name' },
    },
  };
  const ql: any = {
    registerMiddleware: (mw: any) => middlewares.push(mw),
    getSchema: () => baseSchema,
    find: vi.fn(async () => []),
    insert: vi.fn(async () => ({ id: 'x' })),
  };
  const metadata: any = { get: async () => baseSchema };
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata,
    ...extraServices,
  };
  const registered: Record<string, any> = {};
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn() },
    registerService: (name: string, svc: any) => {
      registered[name] = svc;
      services[name] = svc;
    },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  return { ctx, ql, middlewares, registered };
}

describe('OrganizationsPlugin', () => {
  it('has correct metadata', () => {
    const plugin = new OrganizationsPlugin();
    expect(plugin.name).toBe('com.objectstack.organizations');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.dependencies).toContain('com.objectstack.engine.objectql');
  });

  it('registers itself as `org-scoping` service during init', async () => {
    const plugin = new OrganizationsPlugin();
    const { ctx, registered } = makeCtx();
    await plugin.init(ctx);
    expect(registered['org-scoping']).toBe(plugin);
  });

  // [ADR-0105 D12, as amended by ADR-0132] The registered service carries the ENTITLEMENT.
  // Open core reads `supportedPostures` off it and fails closed on anything
  // unlisted, so THIS package — not open core — decides which multi-org shapes
  // it sells. Both walled postures are entitled today; `single` never is (it is
  // the no-wall posture and needs no runtime).
  describe('posture entitlement (ADR-0105 D12)', () => {
    it('declares the walled postures it entitles on the registered service', async () => {
      const plugin = new OrganizationsPlugin();
      const { ctx, registered } = makeCtx();
      await plugin.init(ctx);
      const service = registered['org-scoping'] as { supportedPostures?: readonly string[] };
      expect(service.supportedPostures).toBeDefined();
      expect([...(service.supportedPostures ?? [])].sort()).toEqual(['group', 'isolated']);
    });

    it('never entitles `single` — the no-wall posture needs no runtime', () => {
      expect(new OrganizationsPlugin().supportedPostures).not.toContain('single');
    });

    it('entitles at least one posture — an empty list would brick every multi-org deployment', () => {
      // Guard against an edit that empties the list. Open core fails closed on
      // an unentitled posture, so `[]` would make every deployment that requested
      // a wall REFUSE TO BOOT (ADR-0093 D5), not merely lose a feature.
      expect(new OrganizationsPlugin().supportedPostures.length).toBeGreaterThan(0);
    });
  });

  it('auto-stamps organization_id on insert from tenantId', async () => {
    const plugin = new OrganizationsPlugin();
    const { ctx, middlewares } = makeCtx();
    await plugin.init(ctx);
    await plugin.start(ctx);
    const insertMw = middlewares[0];
    const opCtx: any = {
      object: 'task',
      operation: 'insert',
      data: { name: 'A' },
      context: { userId: 'u1', tenantId: 'org-1' },
    };
    await insertMw(opCtx, async () => {});
    expect(opCtx.data.organization_id).toBe('org-1');
  });

  // [#2937] AUTHORITATIVE overwrite (behavior delta). A user-context insert may
  // not choose its tenant: a supplied — possibly forged — organization_id is
  // OVERWRITTEN with the caller's active org, closing the cross-tenant insert
  // gap. (Previously a non-empty value was preserved — the vulnerability.)
  it('[#2937] OVERWRITES a forged organization_id in user context with the active tenant', async () => {
    const plugin = new OrganizationsPlugin();
    const { ctx, middlewares } = makeCtx();
    await plugin.init(ctx);
    await plugin.start(ctx);
    const opCtx: any = {
      object: 'task',
      operation: 'insert',
      // 'org-2' is another tenant — the attacker's forged value.
      data: { name: 'A', organization_id: 'org-2' },
      context: { userId: 'u1', tenantId: 'org-1' },
    };
    await middlewares[0](opCtx, async () => {});
    // Normalized to the caller's active org — NOT the forged value.
    expect(opCtx.data.organization_id).toBe('org-1');
  });

  it('[#2937] a same-tenant explicit organization_id is preserved (idempotent overwrite)', async () => {
    const plugin = new OrganizationsPlugin();
    const { ctx, middlewares } = makeCtx();
    await plugin.init(ctx);
    await plugin.start(ctx);
    const opCtx: any = {
      object: 'task',
      operation: 'insert',
      data: { name: 'A', organization_id: 'org-1' },
      context: { userId: 'u1', tenantId: 'org-1' },
    };
    await middlewares[0](opCtx, async () => {});
    expect(opCtx.data.organization_id).toBe('org-1');
  });

  it('skips auto-stamping in system context', async () => {
    const plugin = new OrganizationsPlugin();
    const { ctx, middlewares } = makeCtx();
    await plugin.init(ctx);
    await plugin.start(ctx);
    const opCtx: any = {
      object: 'task',
      operation: 'insert',
      data: { name: 'A' },
      context: { isSystem: true, tenantId: 'org-1' },
    };
    await middlewares[0](opCtx, async () => {});
    expect(opCtx.data.organization_id).toBeUndefined();
  });

  // [#2937] The legitimate "set org_id on behalf" path (per-org seed replay /
  // clone / orphan-claim, imports, migrations) runs under SYSTEM_CTX — it must
  // keep an explicit cross-org value verbatim, NOT be overwritten.
  it('[#2937] system context preserves an explicit cross-org organization_id (on-behalf writes unaffected)', async () => {
    const plugin = new OrganizationsPlugin();
    const { ctx, middlewares } = makeCtx();
    await plugin.init(ctx);
    await plugin.start(ctx);
    const opCtx: any = {
      object: 'task',
      operation: 'insert',
      data: { name: 'A', organization_id: 'org-donor' },
      context: { isSystem: true, tenantId: 'org-1' },
    };
    await middlewares[0](opCtx, async () => {});
    expect(opCtx.data.organization_id).toBe('org-donor');
  });

  // A non-`isSystem` context that carries a tenant but NO principal (a service
  // acting with an org scope) keeps the prior FILL-ONLY semantics — it may still
  // set an explicit value; only USER-context inserts are overwritten.
  it('[#2937] principal-less (non-system) context keeps fill-only semantics', async () => {
    const plugin = new OrganizationsPlugin();
    const { ctx, middlewares } = makeCtx();
    await plugin.init(ctx);
    await plugin.start(ctx);
    const opCtx: any = {
      object: 'task',
      operation: 'insert',
      data: { name: 'A', organization_id: 'org-explicit' },
      context: { tenantId: 'org-1' }, // no userId, not isSystem
    };
    await middlewares[0](opCtx, async () => {});
    expect(opCtx.data.organization_id).toBe('org-explicit');
  });

  it('no-ops when tenantId is absent', async () => {
    const plugin = new OrganizationsPlugin();
    const { ctx, middlewares } = makeCtx();
    await plugin.init(ctx);
    await plugin.start(ctx);
    const opCtx: any = {
      object: 'task',
      operation: 'insert',
      data: { name: 'A' },
      context: { userId: 'u1' },
    };
    await middlewares[0](opCtx, async () => {});
    expect(opCtx.data.organization_id).toBeUndefined();
  });

  it('skips when target object has no organization_id field', async () => {
    const plugin = new OrganizationsPlugin();
    const { ctx, middlewares } = makeCtx();
    // Replace schema so the column does not exist.
    (ctx.getService('objectql') as any).getSchema = () => ({
      name: 'task',
      fields: { id: { name: 'id' }, name: { name: 'name' } },
    });
    await plugin.init(ctx);
    await plugin.start(ctx);
    const opCtx: any = {
      object: 'task',
      operation: 'insert',
      data: { name: 'A' },
      context: { userId: 'u1', tenantId: 'org-1' },
    };
    await middlewares[0](opCtx, async () => {});
    expect(opCtx.data.organization_id).toBeUndefined();
  });

  // ── Middleware B: per-org seed replay on sys_organization insert ─────────
  //
  // The consumer side of the framework #3453 fix. In multi-tenant mode a brand-new
  // org gets its own copy of demo data by replaying the kernel's `seed-datasets`
  // list — which, post-fix, holds the UNION of every seed source (every config app
  // + every marketplace package) — via the `seed-replayer` callable AppPlugin
  // registers. These tests pin that Middleware B invokes the replayer for the new
  // org and honours a multi-source result, and that a misconfigured producer
  // (datasets but no replayer) is surfaced, not silently skipped.
  describe('per-org seed replay (Middleware B, framework #3453)', () => {
    const newOrgInsert = (id: string) => ({
      object: 'sys_organization',
      operation: 'insert' as const,
      data: { id, name: 'New Co' },
      result: { id },
      // On-behalf seed writes run under SYSTEM_CTX (see Middleware A tests above).
      context: { isSystem: true },
    });

    it('replays the full multi-source seed union for a newly inserted organization', async () => {
      const plugin = new OrganizationsPlugin();
      // What the FIXED framework producer now registers: one shared array holding
      // the union of every source — two config apps plus a marketplace package.
      const datasets = [
        { object: 'crm_account', records: [{ id: 'a1' }, { id: 'a2' }] }, // config app A
        { object: 'crm_contact', records: [{ id: 'b1' }] },              // config app B
        { object: 'hot_lead', records: [{ id: 'm1' }] },                 // marketplace pkg
      ];
      const { ctx, middlewares } = makeCtx({ 'seed-datasets': datasets });

      // A faithful stand-in for AppPlugin's registered replayer: reads the LIVE
      // `seed-datasets` service and reports what it seeded, scoped to the org.
      let replayedWith: { orgId: string; objects: string[] } | undefined;
      const seedReplayer = vi.fn(async (orgId: string) => {
        const live = ctx.getService('seed-datasets') as any[];
        replayedWith = { orgId, objects: live.map((d) => d.object) };
        const inserted = live.reduce((n: number, d: any) => n + d.records.length, 0);
        return { inserted, updated: 0, skipped: 0, errors: [] };
      });
      ctx.registerService('seed-replayer', seedReplayer);

      await plugin.init(ctx);
      await plugin.start(ctx);

      // A brand-new org is inserted → the per-org seed pipeline (Middleware B) runs.
      await middlewares[1](newOrgInsert('org_new'), async () => {});

      // The replayer ran once, scoped to the new org, over EVERY source — not just
      // the first config app (the #3453 regression, locked in end-to-end here).
      expect(seedReplayer).toHaveBeenCalledTimes(1);
      expect(seedReplayer).toHaveBeenCalledWith('org_new');
      expect(replayedWith).toEqual({
        orgId: 'org_new',
        objects: ['crm_account', 'crm_contact', 'hot_lead'],
      });
      // A successful replay short-circuits the legacy claim/clone fallbacks.
      expect(
        (ctx.logger.info as any).mock.calls.some((c: any[]) =>
          String(c[0]).includes('per-org seed replay for org_new'),
        ),
      ).toBe(true);
    });

    it('surfaces a missing replayer — datasets present, no replayer registered — instead of silently skipping', async () => {
      const plugin = new OrganizationsPlugin();
      const datasets = [{ object: 'crm_account', records: [{ id: 'a1' }] }];
      // `seed-datasets` registered, but NO `seed-replayer`. Post-#881 the
      // resolver returns `undefined` for an unregistered service (instead of
      // the lookup throwing into the generic outer catch), so the pipeline
      // reaches the PRECISE misconfiguration warning rather than the vague
      // "replay failed" one — still loud, never silently un-seeded.
      const { ctx, middlewares } = makeCtx({ 'seed-datasets': datasets });

      await plugin.init(ctx);
      await plugin.start(ctx);

      await middlewares[1](newOrgInsert('org_new'), async () => {});

      expect(
        (ctx.logger.warn as any).mock.calls.some((c: any[]) =>
          String(c[0]).includes('datasets present but no replayer registered'),
        ),
      ).toBe(true);
    });

    it('#881: resolves an ASYNC-registered replayer via getServiceAsync — the real kernel shape', async () => {
      const plugin = new OrganizationsPlugin();
      const datasets = [{ object: 'crm_account', records: [{ id: 'a1' }, { id: 'a2' }] }];
      const seedReplayer = vi.fn(async () => ({ inserted: 2, updated: 0, skipped: 0, errors: [] }));
      const { ctx, middlewares } = makeCtx({ 'seed-datasets': datasets });
      // The real kernel registers `seed-replayer` (and `seed-datasets`) via an
      // async factory: sync getService THROWS "Service is async - use await",
      // and only getServiceAsync resolves. Before #881 that landed every boot
      // in the fallback path with "per-org seed replay failed, falling back".
      const syncGetService = ctx.getService;
      ctx.getService = (name: string) => {
        if (name === 'seed-replayer' || name === 'seed-datasets') {
          throw new Error(`Service '${name}' is async - use await`);
        }
        return syncGetService(name);
      };
      ctx.getServiceAsync = async (name: string) => {
        if (name === 'seed-replayer') return seedReplayer;
        if (name === 'seed-datasets') return datasets;
        return syncGetService(name);
      };

      await plugin.init(ctx);
      await plugin.start(ctx);

      await middlewares[1](newOrgInsert('org_async'), async () => {});

      // The PRIMARY path engaged — no fallback warning fired.
      expect(seedReplayer).toHaveBeenCalledTimes(1);
      expect(seedReplayer).toHaveBeenCalledWith('org_async');
      expect(
        (ctx.logger.warn as any).mock.calls.some((c: any[]) =>
          String(c[0]).includes('per-org seed replay failed, falling back'),
        ),
      ).toBe(false);
    });

    it('ignores inserts on other objects (only sys_organization drives per-org replay)', async () => {
      const plugin = new OrganizationsPlugin();
      const { ctx, middlewares } = makeCtx({ 'seed-datasets': [{ object: 'x', records: [{ id: '1' }] }] });
      const seedReplayer = vi.fn(async () => ({ inserted: 1, updated: 0, skipped: 0, errors: [] }));
      ctx.registerService('seed-replayer', seedReplayer);

      await plugin.init(ctx);
      await plugin.start(ctx);

      // A plain business-object insert must NOT trigger the seed pipeline.
      await middlewares[1](
        { object: 'task', operation: 'insert', data: { id: 't1' }, result: { id: 't1' }, context: { isSystem: true } },
        async () => {},
      );
      expect(seedReplayer).not.toHaveBeenCalled();
    });
  });
});
