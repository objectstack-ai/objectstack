// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `runAs:'user'` HOOK reads the rows an email-keyed row policy grants its
 * user, exactly as that user's own request does. The hook-side twin of
 * `runas-user-email-owner.integration.test.ts` (the flow side), and the email
 * twin of `runas-user-hook-org-peers.integration.test.ts` (the peer list).
 *
 * The defect this pins: a hook fired from a hand-built
 * `{ isSystem: true, userId, tenantId }` context is de-elevated by
 * `ScopedContext.withRunAs('user')` and then seeded by
 * `ScopedContext[SEED_USER_GRANTS]` (objectql). That seed took the user's
 * positions, permission sets and peer list from the core resolver the request
 * path uses (`resolveUserAuthzGrants`), but never the email that same
 * resolution returns. The RLS compiler binds `current_user.email` from the
 * execution context's `email` and nothing else, so a policy such as
 * `assignee == current_user.email` (the stock showcase's `task_own_rows`)
 * dropped out inside the hook, and the hook read no rows where its user's own
 * request reads theirs. It failed closed: rows hidden, never leaked.
 *
 * It lives here, beside its twins, because this package is the one that
 * already composes the whole stack under test in its dev dependencies: the
 * ObjectQL engine, driver-sql on better-sqlite3 `:memory:`, the identity
 * objects and the real SecurityPlugin with its shipped default permission sets
 * plus the fixture's set. No automation runs here.
 *
 * Fixture: `qa_hook_owner_task`, whose only row scope is the set
 * `qa_hook_owner_reader`: select keyed on `assignee == current_user.email`.
 * `usr_member` and `usr_other` hold the set in the Default Organization, each
 * with their own stored email, and one task is assigned to each.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, resolveUserAuthzGrants, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, bindHooksToEngine, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema } from '@objectstack/spec/security';

const SYS = { isSystem: true } as const;
const OBJECT = 'qa_hook_owner_task';
const MEMBER = 'usr_member';
const OTHER = 'usr_other';
const EMAIL: Record<string, string> = {
  [MEMBER]: 'qa-hook-member@example.test',
  [OTHER]: 'qa-hook-other@example.test',
};
const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** The showcase task's shape, cut to the fields the policy reads. */
const taskObject = {
  name: OBJECT,
  label: 'Hook owner task',
  sharingModel: 'public_read_write',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    assignee: { name: 'assignee', label: 'Assignee', type: 'text' },
  },
};

/** The object whose insert fires the hook under test. */
const probeObject = {
  name: 'hook_probe',
  label: 'Hook probe',
  // Platform-global, so every firing below is a legal system write (ADR-0066).
  tenancy: { enabled: false },
  fields: { name: { name: 'name', label: 'Name', type: 'text' } },
};

/** `showcase_contributor`'s `task_own_rows`, on the one verb the hook uses. */
const readerSet = PermissionSetSchema.parse({
  name: 'qa_hook_owner_reader',
  label: 'Hook owner task reader',
  objects: { [OBJECT]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false } },
  rowLevelSecurity: [
    { name: 'qa_hook_task_own_rows', object: OBJECT, operation: 'select', using: 'assignee == current_user.email' },
  ],
});

describe("a runAs:'user' hook reads the rows an email-keyed policy grants its user, as the user's own request does", () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let orgA = '';
  /** The task titles the hook's read answered, per firing. */
  const seen: string[][] = [];
  /** The context the hook's read carried to the middleware chain, per firing. */
  const seenContexts: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'fatal' } });
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await kernel.use({
      name: 'test.driver.sqlite', type: 'standard', version: '1.0.0',
      async init(ctx: PluginContext) { ctx.registerService('driver.default', driver); },
    });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(createIdentityObjectsPlugin());
    await kernel.use(new SecurityPlugin({ defaultPermissionSets: [...securityDefaultPermissionSets, readerSet] }));
    await kernel.bootstrap();

    ql = kernel.getService<ObjectQL>('objectql');
    ql.registry.registerObject(taskObject as any, 'hook-email-owner-test', 'hook-email-owner-test');
    ql.registry.registerObject(probeObject as any, 'hook-email-owner-test', 'hook-email-owner-test');
    await ql.syncSchemas();

    const orgs = await ql.find('sys_organization', { context: SYS });
    expect(orgs.map((o: any) => o.slug)).toEqual(['default']);
    orgA = String(orgs[0].id);
    for (const id of [MEMBER, OTHER]) {
      await ql.insert('sys_user', { id, name: id, email: EMAIL[id] }, { context: SYS });
      await ql.insert('sys_member', { id: `mem_${id}`, user_id: id, organization_id: orgA, role: 'member' }, { context: SYS });
      await ql.insert('sys_user_permission_set', { id: `ups_${id}`, user_id: id, permission_set: readerSet.name, organization_id: orgA }, { context: SYS });
    }
    await ql.insert(OBJECT, { title: 'member task', assignee: EMAIL[MEMBER] }, { context: SYS });
    await ql.insert(OBJECT, { title: 'other task', assignee: EMAIL[OTHER] }, { context: SYS });

    let inHook = false;
    ql.registerMiddleware(async (opCtx: any, next: any) => {
      if (inHook && opCtx.object === OBJECT) seenContexts.push({ ...(opCtx.context ?? {}) });
      return next();
    });
    bindHooksToEngine(ql, [
      {
        name: 'read_own_tasks',
        object: 'hook_probe',
        events: ['afterInsert'],
        priority: 100,
        runAs: 'user',
        handler: async (ctx: any) => {
          inHook = true;
          try {
            seen.push(titles(await ctx.api.object(OBJECT).find({ fields: ['id', 'title'] })));
          } finally {
            inHook = false;
          }
        },
      } as any,
    ], { packageId: 'app:test', logger: silentLogger });
  }, 30_000);

  afterAll(async () => {
    try { await kernel?.shutdown(); } catch { /* noop */ }
  });

  const titles = (rows: unknown): string[] => (Array.isArray(rows) ? rows.map((r: any) => String(r.title)).sort() : []);

  /**
   * The context the request path hands ObjectQL for `userId` acting in the
   * organization: `resolveAuthzContext` copies exactly these grants onto it,
   * the email included (`ctx.email`, the session's or else the stored one).
   */
  async function requestContext(userId: string, opts: { email?: boolean } = {}) {
    const g = await resolveUserAuthzGrants(ql, userId, { tenantId: orgA, bypassGrantsCache: true });
    return {
      userId,
      tenantId: orgA,
      isSystem: false,
      positions: g.positions,
      permissions: g.permissions,
      systemPermissions: g.systemPermissions,
      org_user_ids: g.org_user_ids,
      accessible_org_ids: g.accessible_org_ids,
      ...(opts.email === false || !g.email ? {} : { email: g.email }),
    };
  }

  /** Fire the hook with `context` as the triggering write's context; answer what its read saw and carried. */
  async function fire(context: Record<string, unknown>) {
    const before = seen.length;
    await ql.insert('hook_probe', { name: 'p' }, { context: context as any });
    expect(seen.length, 'the hook ran exactly once').toBe(before + 1);
    return { rows: seen[seen.length - 1], hookCtx: seenContexts[seenContexts.length - 1] };
  }

  it("CONTROL — the member's own request sees the task assigned to their email and nothing beyond; without the email it sees nothing", async () => {
    const req = await requestContext(MEMBER);
    expect(req.email, 'the request path seeds the stored email').toBe(EMAIL[MEMBER]);
    expect(titles(await ql.find(OBJECT, { fields: ['id', 'title'], context: req as any }))).toEqual(['member task']);
    // GUARD: the email-keyed policy is the only access this fixture grants.
    const noEmail = await requestContext(MEMBER, { email: false });
    expect(titles(await ql.find(OBJECT, { fields: ['id', 'title'], context: noEmail as any }))).toEqual([]);
  });

  it("the card's reproduction: fired from a hand-built { isSystem: true, userId, tenantId } context, the hook sees what the member's request sees", async () => {
    const { rows, hookCtx } = await fire({ isSystem: true, userId: MEMBER, tenantId: orgA });
    expect(rows).toEqual(['member task']);
    expect(hookCtx.isSystem).toBe(false);
    expect(hookCtx.email, 'the pin carries the stored email').toBe(EMAIL[MEMBER]);
  });

  it('fired from the request-resolved envelope, the hook answers the same and keeps that envelope verbatim (control)', async () => {
    const req = await requestContext(MEMBER);
    // The triggering write is elevated only because the reader set grants no
    // create on the probe object; the hook's runAs:'user' pins it back to
    // `isSystem: false`, which is exactly the request context.
    const { rows, hookCtx } = await fire({ ...req, isSystem: true });
    expect(rows).toEqual(['member task']);
    expect(hookCtx.email).toBe(req.email);
    expect(hookCtx.positions).toEqual(req.positions);
    expect(hookCtx.permissions).toEqual(req.permissions);
    expect(hookCtx.org_user_ids).toEqual(req.org_user_ids);
  });

  it('an email the triggering context already carries is kept VERBATIM, never overwritten by the stored one', async () => {
    // A value deliberately different from `usr_member`'s stored email: the
    // hook reads by the carried one, so it sees that one's task and not its own.
    const { rows, hookCtx } = await fire({ isSystem: true, userId: MEMBER, tenantId: orgA, email: EMAIL[OTHER] });
    expect(hookCtx.email).toBe(EMAIL[OTHER]);
    expect(rows).toEqual(['other task']);
  });

  it('a context that already carries positions, permission sets and a peer list but no email still gets the email, and keeps the rest verbatim', async () => {
    const req = await requestContext(MEMBER, { email: false });
    const { rows, hookCtx } = await fire({
      isSystem: true, userId: MEMBER, tenantId: orgA,
      positions: req.positions, permissions: req.permissions, org_user_ids: req.org_user_ids,
    });
    expect(hookCtx.email).toBe(EMAIL[MEMBER]);
    expect(rows).toEqual(['member task']);
    expect(hookCtx.positions).toEqual(req.positions);
    expect(hookCtx.permissions).toEqual(req.permissions);
    expect(hookCtx.org_user_ids).toEqual(req.org_user_ids);
  });
});
