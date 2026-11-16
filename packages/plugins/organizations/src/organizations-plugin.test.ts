// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
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

  // [#21666] FILL-ONLY in a user context too (ADR-0105 D5). A supplied value —
  // another tenant's included — is left exactly as sent, for plugin-security's
  // Layer 0 write wall to judge the way it judges the PATCH that names the same
  // organization. Rewriting it here answered the create 201 with the row stored
  // somewhere the caller never named. The refusal half (#2937's forged insert
  // is still refused, by the wall) is pinned against the real SecurityPlugin in
  // `create-explicit-organization-wall.test.ts`; this unit pins only that the
  // stamp no longer touches the value.
  it('[#21666] leaves a supplied organization_id naming another tenant untouched in a user context', async () => {
    const plugin = new OrganizationsPlugin();
    const { ctx, middlewares } = makeCtx();
    await plugin.init(ctx);
    await plugin.start(ctx);
    const opCtx: any = {
      object: 'task',
      operation: 'insert',
      // 'org-2' is another tenant.
      data: { name: 'A', organization_id: 'org-2' },
      context: { userId: 'u1', tenantId: 'org-1' },
    };
    await middlewares[0](opCtx, async () => {});
    expect(opCtx.data.organization_id).toBe('org-2');
  });

  it('[#21666] fills an EMPTY-string organization_id in a user context, as it fills an absent one', async () => {
    const plugin = new OrganizationsPlugin();
    const { ctx, middlewares } = makeCtx();
    await plugin.init(ctx);
    await plugin.start(ctx);
    const opCtx: any = {
      object: 'task',
      operation: 'insert',
      data: { name: 'A', organization_id: '' },
      context: { userId: 'u1', tenantId: 'org-1' },
    };
    await middlewares[0](opCtx, async () => {});
    expect(opCtx.data.organization_id).toBe('org-1');
  });

  it('[#2937] a same-tenant explicit organization_id is preserved', async () => {
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

  // [#2937] The legitimate "set org_id on behalf" path (per-org seed replay,
  // migrations) runs under SYSTEM_CTX — it must keep an explicit
  // cross-org value verbatim, and it meets neither the stamp nor the wall.
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
  // acting with an org scope) gets the same FILL-ONLY stamp a user context gets
  // — one rule for every non-system context since #21666.
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
    const { ctx, middlewares, ql } = makeCtx();
    // Replace schema so the column does not exist. `ql` is the same object the
    // fake ctx hands back from `getService('objectql')` — reached through the
    // harness rather than through a lookup erased to `any`, which
    // `pnpm check:slot-lookup` refuses and whose baseline never grows.
    ql.getSchema = () => ({
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

// [#30281] The per-org replay picks its seed datasets by locale, and at founding
// the organization has no Localization setting of its own yet, so the founder's
// language is what decides (item 3 of the card lands on option (a) by
// construction, with the app's declared default behind it). Middleware B is the
// only place that knows the founder: better-auth's create runs as SYSTEM with
// the signed-in creator as `attributedUserId`. These pin that it hands that id
// to the replayer, and that a system insert with no person behind it keeps the
// one-argument call every existing replayer (and the cloud host's) understands.
describe('per-org seed replay names the founder (#30281)', () => {
  const insertBy = (id: string, context: Record<string, unknown>) => ({
    object: 'sys_organization',
    operation: 'insert' as const,
    data: { id, name: 'New Co' },
    result: { id },
    context,
  });
  /** better-auth's member write, as the adapter hands it to the engine. */
  const memberInsert = (organizationId: string, userId: string) => ({
    object: 'sys_member',
    operation: 'insert' as const,
    data: { organization_id: organizationId, user_id: userId, role: 'owner' },
    result: { id: `mem_${organizationId}_${userId}`, organization_id: organizationId, user_id: userId, role: 'owner' },
    context: { isSystem: true, attributedUserId: userId },
  });

  async function startWithReplayer() {
    const plugin = new OrganizationsPlugin();
    const { ctx, middlewares } = makeCtx({ 'seed-datasets': [{ object: 'crm_account', records: [{ id: 'a1' }] }] });
    const seedReplayer = vi.fn(async (_orgId: string, _options?: { userId?: string }) => ({
      inserted: 1, updated: 0, skipped: 0, errors: [],
    }));
    ctx.registerService('seed-replayer', seedReplayer);
    await plugin.init(ctx);
    await plugin.start(ctx);
    return { seedReplayer, middlewares };
  }

  it('hands the replayer the insert\'s attributed user as the founder', async () => {
    const { seedReplayer, middlewares } = await startWithReplayer();

    await middlewares[1](insertBy('org_zh', { isSystem: true, attributedUserId: 'usr_founder' }), async () => {});
    // [#34038] better-auth writes the founder's member row next; the replay runs on it.
    await middlewares[1](memberInsert('org_zh', 'usr_founder'), async () => {});

    expect(seedReplayer).toHaveBeenCalledTimes(1);
    expect(seedReplayer.mock.calls[0]).toEqual(['org_zh', { userId: 'usr_founder' }]);
  });

  it('[#34038] an organization a person created waits for its first member row, and replays once', async () => {
    const { seedReplayer, middlewares } = await startWithReplayer();

    await middlewares[1](insertBy('org_wait', { isSystem: true, attributedUserId: 'usr_founder' }), async () => {});
    expect(seedReplayer).not.toHaveBeenCalled();

    // A member of ANOTHER organization does not release it.
    await middlewares[1](memberInsert('org_other', 'usr_founder'), async () => {});
    expect(seedReplayer).not.toHaveBeenCalled();

    await middlewares[1](memberInsert('org_wait', 'usr_founder'), async () => {});
    await middlewares[1](memberInsert('org_wait', 'usr_colleague'), async () => {});
    expect(seedReplayer.mock.calls).toEqual([['org_wait', { userId: 'usr_founder' }]]);
  });

  it('[#34038] a member row of an organization nobody is waiting on replays nothing', async () => {
    const { seedReplayer, middlewares } = await startWithReplayer();

    await middlewares[1](memberInsert('org_existing', 'usr_someone'), async () => {});

    expect(seedReplayer).not.toHaveBeenCalled();
  });

  it('keeps the one-argument call when no person founded the organization', async () => {
    const { seedReplayer, middlewares } = await startWithReplayer();

    await middlewares[1](insertBy('org_sys', { isSystem: true }), async () => {});

    expect(seedReplayer).toHaveBeenCalledTimes(1);
    expect(seedReplayer.mock.calls[0]).toEqual(['org_sys']);
  });
});

// [#34425] The walled default-organization bootstrap writes the `default`
// organization as SYSTEM, with no person behind it, and then the platform
// owner's member row. Its replay waits for that member row, the same way an
// organization a person created does (#34038), and names the owner it binds.
// When the bootstrap binds nobody, the replay still runs, with no person, once
// the bootstrap call is over. The real walled boot is pinned in
// `default-organization-seed-owner.wall.test.ts`; these pin the two branches
// on an engine double whose inserts run the plugin's middlewares.
describe('the walled default-organization bootstrap replays after the owner it binds (#34425)', () => {
  const OWNER_EMAIL = 'owner@bootstrap.test';
  type Row = Record<string, unknown>;

  function makeEngine(store: Record<string, Row[]>, options: { refuseMembers?: boolean } = {}) {
    const middlewares: any[] = [];
    const matches = (row: Row, where: Row | undefined): boolean =>
      !where ||
      Object.entries(where).every(([key, value]) => {
        // ⛔ Refuse a combinator rather than reading it as a field name
        // (`pnpm check:where-matcher`): exact-match keys only.
        if (key.startsWith('$')) throw new Error(`fake engine: WHERE combinator \`${key}\` is not implemented`);
        return value === null ? row[key] == null : row[key] === value;
      });
    const ql: any = {
      registerMiddleware: (mw: any) => middlewares.push(mw),
      getSchema: () => null,
      find: vi.fn(async (object: string, query: any) => {
        const rows = (store[object] ?? []).filter((r) => matches(r, query?.where));
        return rows.slice(0, query?.limit ?? rows.length);
      }),
      insert: vi.fn(async (object: string, data: Row, opts?: { context?: Row }) => {
        if (object === 'sys_member' && options.refuseMembers) throw new Error('member write refused');
        (store[object] ??= []).push({ ...data });
        // Each middleware awaits `next()` first, so running them after the
        // store is the order the engine gives them.
        const opCtx = { object, operation: 'insert', data, result: { ...data }, context: opts?.context };
        for (const mw of middlewares) await mw(opCtx, async () => {});
        return { ...data };
      }),
    };
    return { ql, middlewares };
  }

  async function bootWalled(options: { refuseMembers?: boolean } = {}) {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER_EMAIL;
    resetPlatformAdminEmailMemo();
    const store: Record<string, Row[]> = {};
    const { ql } = makeEngine(store, options);
    const replays: Array<{ args: unknown[]; membersAtReplay: Row[] }> = [];
    const seedReplayer = vi.fn(async (...args: unknown[]) => {
      replays.push({ args, membersAtReplay: [...(store.sys_member ?? [])] });
      return { inserted: 1, updated: 0, skipped: 0, errors: [] };
    });
    const services: Record<string, unknown> = {
      manifest: { register: vi.fn() },
      objectql: ql,
      settings: {
        getNamespace: vi.fn(async () => ({ values: { membership_policy: { value: 'invite-only', source: 'env' } } })),
      },
      auth: { getMembershipPolicy: () => 'invite-only' },
      'seed-datasets': [{ object: 'crm_account', records: [{ id: 'a1' }] }],
      'seed-replayer': seedReplayer,
    };
    const ctx: any = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerService: (name: string, svc: unknown) => {
        services[name] = svc;
      },
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`service not registered: ${name}`);
        return services[name];
      },
      // No `kernel:ready` is fired: the owner's verified `sys_user` insert is
      // the trigger, as on a walled boot.
      hook: vi.fn(),
    };
    const plugin = new OrganizationsPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    // The declared owner's verified account lands: a bootstrap trigger.
    await ql.insert(
      'sys_user',
      { id: 'usr_owner', email: OWNER_EMAIL, email_verified: true, name: 'Owner', created_at: '2026-01-01' },
      { context: { isSystem: true } },
    );
    return { store, replays };
  }

  const savedPosture = process.env.OS_TENANCY_POSTURE;
  const savedOwner = process.env.OS_PLATFORM_OWNER_EMAIL;
  afterEach(() => {
    if (savedPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = savedPosture;
    if (savedOwner === undefined) delete process.env.OS_PLATFORM_OWNER_EMAIL;
    else process.env.OS_PLATFORM_OWNER_EMAIL = savedOwner;
    resetPlatformAdminEmailMemo();
  });

  it('replays the default organization once, inside the owner\'s member write, naming the owner', async () => {
    const { store, replays } = await bootWalled();

    const orgId = store.sys_organization?.[0]?.id;
    expect(store.sys_organization?.map((o) => o.slug)).toEqual(['default']);
    expect(replays.map((r) => r.args)).toEqual([[orgId, { userId: 'usr_owner' }]]);
    // The owner's member row was stored before the replay read membership.
    expect(replays[0]!.membersAtReplay.map((m) => [m.organization_id, m.user_id, m.role])).toEqual([
      [orgId, 'usr_owner', 'owner'],
    ]);
  });

  it('control: when the bootstrap binds nobody, the default organization still replays once, with no person', async () => {
    const { store, replays } = await bootWalled({ refuseMembers: true });

    const orgId = store.sys_organization?.[0]?.id;
    expect(orgId).toBeTruthy();
    expect(store.sys_member ?? []).toEqual([]);
    expect(replays.map((r) => r.args)).toEqual([[orgId]]);
  });
});
