// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24164 ruling E′; ruling A′ on #24449] `sys_user` declares ONE default row
 * scope, its two shipped literals joined with `||`:
 * `id == current_user.id || id in current_user.org_user_ids`. That one
 * predicate keeps the reader's own row only where the context carries
 * `org_user_ids` — unresolved, the whole predicate drops, own row included,
 * where the two literals apart kept the self arm. Ruling A′ puts the list on
 * every user-context producer instead of splitting the key, so this pins the
 * premise on each producer that reads `sys_user` as a user:
 *   - a request (the core resolver, as `resolveAuthzContext` copies it);
 *   - a `runAs: 'user'` flow run (seeded at run setup);
 *   - a `runAs: 'user'` hook fired from a hand-built system context (seeded
 *     where the hook's `runAs` is resolved).
 * Each must read the user's own row, plus the members of the organisation the
 * context names, under the declared default — and exactly the rows the two
 * shipped literals admit together on that same context.
 *
 * The default applies only where the caller's sets carry no row policy for
 * `sys_user`. Every human holds the platform baseline (`member_default`),
 * which carries both literals, so this deployment composes no baseline and
 * grants one authored `'*'` read set with no row policy of its own — the
 * ruling's no-baseline principal. Explain names the object default, so the
 * rows read are the declaration's, not a set's.
 *
 * The REAL stack, as its two twins beside it compose it: ObjectKernel,
 * ObjectQLPlugin, driver-sql on better-sqlite3 `:memory:`, the identity
 * objects as `@objectstack/platform-objects` declares them, the real
 * SecurityPlugin and the real AutomationEngine with its CRUD nodes.
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
import { RLSCompiler, SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';

const SYS = { isSystem: true } as const;
const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** The ruling's principal: an authored `'*'` read set that carries no row policy. */
const STAR_READER = PermissionSetSchema.parse({
  name: 'qa_star_reader',
  label: 'Star reader',
  objects: { '*': { allowRead: true, allowCreate: true } },
}) as PermissionSet;

/** The two shipped literals the declaration merges, read off the baseline set (never retyped). */
const SHIPPED_LITERALS = (securityDefaultPermissionSets.find((s) => s.name === 'member_default')?.rowLevelSecurity ?? [])
  .filter((p) => p.object === 'sys_user' && (p.name === 'sys_user_self' || p.name === 'sys_user_org_members'));

/** The object whose insert fires the hook under test. */
const probeObject = {
  name: 'hook_probe',
  label: 'Hook probe',
  tenancy: { enabled: false },
  fields: { name: { name: 'name', label: 'Name', type: 'text' as const } },
};

/** start → get_record(sys_user, many) → end, under runAs:'user'. */
const directoryFlow = {
  name: 'directory',
  label: 'directory',
  type: 'autolaunched',
  runAs: 'user',
  variables: [{ name: 'users', type: 'object', isOutput: true }],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'read',
      type: 'get_record',
      label: 'Read directory',
      config: { objectName: 'sys_user', fields: ['id', 'name'], limit: 50, outputVariable: 'users' },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'read' },
    { id: 'e2', source: 'read', target: 'end' },
  ],
};

describe("sys_user's one `||` default keeps the reader's own row on every user-context producer", () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let automation: AutomationEngine;
  let orgA = '';
  const orgB = 'org_b';
  /** What the hook's `sys_user` read answered, per firing. */
  let hookSeen: string[][] = [];
  /** The context each non-system `sys_user` read carried to the middleware chain. */
  let readContexts: Array<Record<string, unknown>> = [];

  afterEach(async () => {
    try { await kernel?.shutdown(); } catch { /* noop */ }
  });

  const ids = (rows: unknown): string[] => (Array.isArray(rows) ? rows.map((r: any) => String(r.id)).sort() : []);

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
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
    await kernel.use(createIdentityObjectsPlugin());
    await kernel.use(new SecurityPlugin({
      defaultPermissionSets: [...securityDefaultPermissionSets, STAR_READER],
      fallbackPermissionSet: null,
    }));
    await kernel.bootstrap();

    ql = kernel.getService<ObjectQL>('objectql');
    automation = kernel.getService<AutomationEngine>('automation');
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
    // The one grant: a global (organisation-less) assignment of the `'*'` reader,
    // written straight into the table — a system write here must name one of
    // the two organisations, and a global grant names none.
    await (driver as unknown as { knex: (t: string) => { insert(r: object): Promise<unknown> } })
      .knex('sys_user_permission_set')
      .insert({ id: 'ups_me', user_id: 'usr_me', permission_set: STAR_READER.name, organization_id: null });

    hookSeen = [];
    readContexts = [];
    ql.registerMiddleware(async (opCtx: any, next: any) => {
      if (opCtx.object === 'sys_user' && opCtx.context && !opCtx.context.isSystem) readContexts.push({ ...opCtx.context });
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
          hookSeen.push(ids(await ctx.api.object('sys_user').find({ fields: ['id', 'name'] })));
        },
      } as any,
    ], { packageId: 'app:test', logger: silentLogger });
  }

  /** The context the request path hands ObjectQL: `resolveAuthzContext` copies exactly these grants onto it. */
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

  const producers: Record<string, (tenantId?: string) => Promise<string[]>> = {
    request: async (tenantId) =>
      ids(await ql.find('sys_user', { fields: ['id', 'name'], context: await requestContext('usr_me', tenantId) })),
    "runAs:'user' flow": async (tenantId) => {
      automation.registerFlow('directory', directoryFlow as any);
      const res = await automation.execute('directory', { userId: 'usr_me', ...(tenantId ? { tenantId } : {}) } as any);
      expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);
      return ids((res.output as { users?: unknown } | undefined)?.users);
    },
    "runAs:'user' hook, hand-built system context": async (tenantId) => {
      const before = hookSeen.length;
      await ql.insert('hook_probe', { name: 'p' }, { context: { isSystem: true, userId: 'usr_me', ...(tenantId ? { tenantId } : {}) } as any });
      expect(hookSeen.length, 'the hook ran exactly once').toBe(before + 1);
      return hookSeen[hookSeen.length - 1];
    },
  };

  /** The rows the two shipped literals admit together on `context`, each compiled apart and read past every scope. */
  async function unionOfLiterals(context: Record<string, unknown>): Promise<string[]> {
    const compiler = new RLSCompiler();
    const out = new Set<string>();
    for (const literal of SHIPPED_LITERALS) {
      const where = compiler.compileFilter([literal as any], context as any);
      if (where === null) throw new Error(`literal ${literal.name} compiled to no filter`);
      for (const id of ids(await ql.find('sys_user', { where, fields: ['id'], context: SYS }))) out.add(id);
    }
    return [...out].sort();
  }

  it('the premise: the two shipped literals the declaration merges are present and spelled as it joins them', async () => {
    await boot();
    expect(SHIPPED_LITERALS.map((p) => p.name).sort()).toEqual(['sys_user_org_members', 'sys_user_self']);
    const declared = (ql.registry.getObject('sys_user') as any).defaultRowScope;
    const [self, peers] = ['sys_user_self', 'sys_user_org_members'].map((n) => SHIPPED_LITERALS.find((p) => p.name === n)!);
    expect(declared).toMatchObject({ name: 'sys_user_self_or_org_members', operation: 'select', using: `${self.using} || ${peers.using}` });
  });

  for (const [producer, read] of Object.entries(producers)) {
    it(`${producer}, acting in organisation A: its own row and A's members, nothing beyond, and exactly the literals' union`, async () => {
      await boot();
      expect(await read(orgA)).toEqual(['usr_me', 'usr_peer']);
      const context = readContexts[readContexts.length - 1];
      expect(Array.isArray(context.org_user_ids), 'the read carries org_user_ids').toBe(true);
      expect(await unionOfLiterals(context)).toEqual(['usr_me', 'usr_peer']);
    });

    it(`${producer}, acting in no organisation: its own row alone, and exactly the literals' union`, async () => {
      await boot();
      expect(await read(undefined)).toEqual(['usr_me']);
      const context = readContexts[readContexts.length - 1];
      expect(context.org_user_ids).toEqual(['usr_me']);
      expect(await unionOfLiterals(context)).toEqual(['usr_me']);
    });
  }

  it('CONTROL: the rows are the object default\'s — explain names it, and a system read sees all four users', async () => {
    await boot();
    expect(ids(await ql.find('sys_user', { context: SYS }))).toEqual(['usr_loner', 'usr_me', 'usr_other', 'usr_peer']);
    type Explained = { layers: Array<{ layer: string; verdict: string; detail: string }> };
    const security = kernel.getService<{ explain(input: { object: string; operation: string }, context: object): Promise<Explained> }>('security');
    const decision = await security.explain({ object: 'sys_user', operation: 'read' }, await requestContext('usr_me', orgA));
    const rls = decision.layers.find((l) => l.layer === 'rls');
    expect(rls?.verdict).toBe('narrows');
    expect(rls?.detail).toContain("'sys_user_self_or_org_members'");
    expect(rls?.detail).toContain('object default row scope');
  });
});

/**
 * [#24164 ruling E′ item 4] On the same booted composition: the one shipped
 * `extend` of a platform object in this repository — plugin-auth's
 * `sys_sso_provider` extension (`authObjectExtensions`, registered by the
 * identity objects plugin) — still registers, and a contribution that sets
 * `defaultRowScope` on a platform object is refused by name, leaving the
 * object's own declaration in force.
 */
describe('the registry\'s `extend` rule on a booted composition', () => {
  let kernel: ObjectKernel;
  afterEach(async () => {
    try { await kernel?.shutdown(); } catch { /* noop */ }
  });

  async function bootRegistry(): Promise<ObjectQL> {
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
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
    await kernel.use(createIdentityObjectsPlugin());
    await kernel.use(new SecurityPlugin());
    await kernel.bootstrap();
    return kernel.getService<ObjectQL>('objectql');
  }

  it('every `extend` contribution the composition registers is plugin-auth\'s on sys_sso_provider, and it folded', async () => {
    const ql = await bootRegistry();
    const extensions = ql.registry.getAllObjects().flatMap((o: any) =>
      ql.registry.getObjectContributors(o.name)
        .filter((c: any) => c.ownership === 'extend')
        .map((c: any) => `${c.packageId} -> ${o.name}`),
    );
    expect(extensions).toEqual(['com.objectstack.plugin-auth -> sys_sso_provider']);
    expect(Object.keys((ql.registry.getObject('sys_sso_provider') as any).fields)).toContain('oidc_client_secret');
  });

  it('a contribution that sets `defaultRowScope` on sys_user is refused by name; the declared default stands', async () => {
    const ql = await bootRegistry();
    const declared = (ql.registry.getObject('sys_user') as any).defaultRowScope;
    expect(declared?.name).toBe('sys_user_self_or_org_members');
    const err = (() => {
      try {
        ql.registry.registerObject(
          { name: 'sys_user', defaultRowScope: { name: 'everyone', operation: 'select', using: 'id != null' }, fields: {} } as any,
          'app.loosener',
          undefined,
          'extend',
        );
      } catch (e) {
        return e as { code?: string; status?: number; name?: string };
      }
      return undefined;
    })();
    expect({ code: err?.code, status: err?.status, name: err?.name }).toEqual({
      code: 'INVALID_METADATA',
      status: 422,
      name: 'ExtensionDefaultRowScopeRefusedError',
    });
    expect((ql.registry.getObject('sys_user') as any).defaultRowScope).toEqual(declared);
    expect(ql.registry.getObjectContributors('sys_user').map((c: any) => c.packageId)).not.toContain('app.loosener');
  });
});
