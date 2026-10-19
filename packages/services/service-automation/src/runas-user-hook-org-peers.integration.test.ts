// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `runAs:'user'` HOOK reads `sys_user` exactly as the triggering user's own
 * request does: the acting user and the members of the organisation they act
 * in, and nothing beyond. The hook-side twin of
 * `runas-user-org-peers.integration.test.ts` (the flow side).
 *
 * The defect this pins: a hook fired from a hand-built
 * `{ isSystem: true, userId, tenantId }` context (the approvals status mirror
 * and decision writes are the shipped producers) is de-elevated by
 * `ScopedContext.withRunAs('user')` to `{ ...context, isSystem: false }`. That
 * envelope carries no `org_user_ids`, so `sys_user_org_members`
 * (`id in current_user.org_user_ids`) compiled `unresolved-variable` and
 * dropped out: the hook saw only the acting user's own row. The engine now
 * seeds the peer list, through the core resolver the request path uses
 * (`resolveUserAuthzGrants`), where a hook's `runAs:'user'` is resolved.
 *
 * It lives here, beside its flow twin, because this package is the one that
 * already composes the whole stack under test in its dev dependencies: the
 * ObjectQL engine, driver-sql on better-sqlite3 `:memory:`, the identity
 * objects and the real SecurityPlugin with its shipped default permission
 * sets. The defect sits in the hand-off between the hook's identity and the
 * RLS compiler, which no single-layer test sees. No automation runs here.
 *
 * Fixture: organisation A (the Default Organization) and organisation B.
 * `usr_me` belongs to BOTH and acts in A; `usr_peer` belongs to A;
 * `usr_other` belongs to B only; `usr_loner` belongs to none.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel, resolveUserAuthzGrants, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, bindHooksToEngine, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin } from '@objectstack/plugin-security';

const SYS = { isSystem: true } as const;
const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** The object whose insert fires the hook under test. */
const probeObject = {
  name: 'hook_probe',
  label: 'Hook probe',
  // Platform-global, so the organisation-less firing below is a legal system
  // write (ADR-0066) rather than a refusal about which organisation owns the row.
  tenancy: { enabled: false },
  fields: { name: { name: 'name', label: 'Name', type: 'text' as const } },
};

describe("a runAs:'user' hook sees the acting user and their organisation's members, and nothing beyond", () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let orgA = '';
  const orgB = 'org_b';
  /** What the hook's `sys_user` read answered, per firing. */
  let seen: string[][] = [];
  /** The context the hook's `sys_user` read carried to the middleware chain, per firing. */
  let seenContexts: Array<Record<string, unknown>> = [];

  afterEach(async () => {
    try { await kernel?.shutdown(); } catch { /* noop */ }
  });

  async function boot() {
    kernel = new ObjectKernel({ logger: { level: 'fatal' } });
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await kernel.use({
      name: 'test.driver.sqlite',
      type: 'standard',
      version: '1.0.0',
      async init(ctx: PluginContext) {
        ctx.registerService('driver.default', driver);
      },
    });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(createIdentityObjectsPlugin());
    await kernel.use(new SecurityPlugin());
    await kernel.bootstrap();

    ql = kernel.getService<ObjectQL>('objectql');
    ql.registry.registerObject(probeObject as any);
    await (ql as any).syncObjectSchema?.('hook_probe');

    const orgs = await ql.find('sys_organization', { context: SYS });
    expect(orgs.map((o: any) => o.slug)).toEqual(['default']);
    orgA = String(orgs[0].id);
    await ql.insert('sys_organization', { id: orgB, name: 'Organisation B', slug: 'org-b' }, { context: SYS });

    for (const [id, name] of [['usr_me', 'Me'], ['usr_peer', 'Peer'], ['usr_other', 'Other'], ['usr_loner', 'Loner']]) {
      await ql.insert('sys_user', { id, name, email: `${id}@example.test` }, { context: SYS });
    }
    const memberships: Array<[string, string, string]> = [
      ['mem_me_a', 'usr_me', orgA],
      ['mem_me_b', 'usr_me', orgB],
      ['mem_peer_a', 'usr_peer', orgA],
      ['mem_other_b', 'usr_other', orgB],
    ];
    for (const [id, userId, organizationId] of memberships) {
      await ql.insert('sys_member', { id, user_id: userId, organization_id: organizationId, role: 'member' }, { context: SYS });
    }

    seen = [];
    seenContexts = [];
    let inHook = false;
    ql.registerMiddleware(async (opCtx: any, next: any) => {
      if (inHook && opCtx.object === 'sys_user') seenContexts.push({ ...(opCtx.context ?? {}) });
      return next();
    });
    bindHooksToEngine(ql, [
      {
        name: 'read_directory',
        object: 'hook_probe',
        events: ['afterInsert'],
        priority: 100,
        runAs: 'user',
        handler: async (ctx: any) => {
          inHook = true;
          try {
            const rows = await ctx.api.object('sys_user').find({ fields: ['id', 'name'] });
            seen.push(ids(rows));
          } finally {
            inHook = false;
          }
        },
      } as any,
    ], { packageId: 'app:test', logger: silentLogger });
  }

  /**
   * The context the request path hands ObjectQL for `userId` acting in
   * `tenantId`: `resolveAuthzContext` copies exactly these grants onto it.
   */
  async function requestContext(userId: string, tenantId?: string) {
    const grants = await resolveUserAuthzGrants(ql, userId, { tenantId, bypassGrantsCache: true });
    return {
      userId,
      ...(tenantId ? { tenantId } : {}),
      isSystem: false,
      positions: grants.positions,
      permissions: grants.permissions,
      systemPermissions: grants.systemPermissions,
      org_user_ids: grants.org_user_ids,
      accessible_org_ids: grants.accessible_org_ids,
    };
  }

  const ids = (rows: unknown): string[] => (Array.isArray(rows) ? rows.map((r: any) => String(r.id)).sort() : []);

  /** Fire the hook with `context` as the triggering write's context; answer what its `sys_user` read saw. */
  async function fire(context: Record<string, unknown>) {
    const before = seen.length;
    await ql.insert('hook_probe', { name: 'p' }, { context: context as any });
    expect(seen.length, 'the hook ran exactly once').toBe(before + 1);
    console.log("PROBE", JSON.stringify(context), "=>", JSON.stringify(seen[seen.length - 1]), "ctx:", JSON.stringify(Object.fromEntries(Object.entries(seenContexts[seenContexts.length - 1] ?? {}).filter(([k]) => ["isSystem","userId","tenantId","positions","permissions","org_user_ids"].includes(k)))));
    return seen[seen.length - 1];
  }

  it("CONTROL — the user's own request sees themself and organisation A's members, and nothing beyond", async () => {
    await boot();
    const rows = await ql.find('sys_user', { fields: ['id', 'name'], context: await requestContext('usr_me', orgA) });
    expect(ids(rows)).toEqual(['usr_me', 'usr_peer']);
  });

  it('fired from the hand-built approvals shape ({ isSystem: true, userId, tenantId }), the hook answers what the request answers', async () => {
    await boot();
    expect(await fire({ isSystem: true, userId: 'usr_me', tenantId: orgA })).toEqual(['usr_me', 'usr_peer']);
  });

  it('fired from a context that already carries the request-resolved envelope, the hook answers the same and keeps that envelope verbatim (control)', async () => {
    await boot();
    const req = await requestContext('usr_me', orgA);
    // The triggering write itself is elevated only because the member's
    // shipped sets grant no create on the probe object; the hook's runAs:'user'
    // pins it back to `isSystem: false`, which is exactly the request context.
    expect(await fire({ ...req, isSystem: true })).toEqual(['usr_me', 'usr_peer']);
    const hookCtx = seenContexts[seenContexts.length - 1];
    expect(hookCtx.org_user_ids).toEqual(req.org_user_ids);
    expect(hookCtx.positions).toEqual(req.positions);
    expect(hookCtx.permissions).toEqual(req.permissions);
  });

  it("fired from the approvals writes' exact envelope (empty positions and sets, no organisation), the hook carries a peer list: the user alone", async () => {
    await boot();
    // `plugin-approvals`' SYSTEM_CTX plus the acting user: the status mirror
    // deliberately carries no organisation, so the list is the organisation-less
    // one. What moves is that the list EXISTS: a policy reading it resolves
    // rather than dropping out.
    expect(await fire({ isSystem: true, positions: [], permissions: [], userId: 'usr_me' })).toEqual(['usr_me']);
    const hookCtx = seenContexts[seenContexts.length - 1];
    expect(hookCtx.org_user_ids).toEqual(['usr_me']);
    expect(hookCtx.positions).toEqual([]);
    expect(hookCtx.permissions).toEqual([]);
  });

  it('fired with no organisation, the hook answers what an organisation-less request answers: the acting user alone', async () => {
    await boot();
    const rows = await ql.find('sys_user', { fields: ['id', 'name'], context: await requestContext('usr_me') });
    expect(ids(rows)).toEqual(['usr_me']);
    expect(await fire({ isSystem: true, userId: 'usr_me' })).toEqual(['usr_me']);
  });
});
