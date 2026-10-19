// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `runAs:'user'` flow reads `sys_user` exactly as the triggering user's own
 * request does: the acting user and the members of the run's organisation,
 * and nothing beyond.
 *
 * The defect this pins: the run's data context carried no `org_user_ids`.
 * `sys_user`'s shipped member scope is two policies, `sys_user_self`
 * (`id == current_user.id`) and `sys_user_org_members`
 * (`id in current_user.org_user_ids`); the second compiles
 * `unresolved-variable` when the peer list is absent and drops out, so the
 * run saw only the acting user's own row while the same user's request saw
 * their colleagues too. On the request path the peer list is seeded by the
 * core resolver (`resolveUserAuthzGrants`, through `resolveAuthzContext`);
 * the run now seeds it through the same resolver at run setup.
 *
 * The REAL stack runs here — ObjectKernel, ObjectQLPlugin, driver-sql on
 * better-sqlite3 `:memory:`, the identity objects, the real SecurityPlugin
 * with its shipped default permission sets, and the real AutomationEngine and
 * CRUD nodes — because the defect lived in the hand-off between the run's
 * identity and the RLS compiler, which no single-layer test sees.
 *
 * Fixture: organisation A (the Default Organization) and organisation B.
 * `usr_me` belongs to BOTH and acts in A; `usr_peer` belongs to A;
 * `usr_other` belongs to B only; `usr_loner` belongs to none. Acting in A,
 * "nothing beyond" means neither `usr_other` (a colleague of `usr_me` in a
 * DIFFERENT organisation) nor `usr_loner`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel, resolveUserAuthzGrants, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';

const SYS = { isSystem: true } as const;

/** start → get_record(sys_user, many) → end, under runAs:'user'; the rows land in the `users` output. */
const directoryFlow = (name: string) => ({
  name,
  label: name,
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
});

describe("a runAs:'user' flow sees the acting user and their organisation's members, and nothing beyond", () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let automation: AutomationEngine;
  let orgA = '';
  const orgB = 'org_b';

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
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
    await kernel.use(createIdentityObjectsPlugin());
    await kernel.use(new SecurityPlugin());
    await kernel.bootstrap();

    ql = kernel.getService<ObjectQL>('objectql');
    automation = kernel.getService<AutomationEngine>('automation');

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

  const ids = (rows: unknown) => (Array.isArray(rows) ? rows.map((r: any) => String(r.id)).sort() : rows);

  async function runDirectory(trigger: Record<string, unknown>) {
    automation.registerFlow('directory', directoryFlow('directory') as any);
    const res = await automation.execute('directory', trigger as any);
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);
    return ids((res.output as { users?: unknown } | undefined)?.users);
  }

  it("CONTROL — the user's own request sees themself and organisation A's members, and nothing beyond", async () => {
    await boot();
    const rows = await ql.find('sys_user', { fields: ['id', 'name'], context: await requestContext('usr_me', orgA) });
    expect(ids(rows)).toEqual(['usr_me', 'usr_peer']);
  });

  it('a run triggered with the record-change shape ({ userId, tenantId }) answers what the request answers', async () => {
    await boot();
    expect(await runDirectory({ userId: 'usr_me', tenantId: orgA })).toEqual(['usr_me', 'usr_peer']);
  });

  it("a run triggered with the doors' pre-resolved shape (positions and permissions already present) answers the same", async () => {
    await boot();
    const req = await requestContext('usr_me', orgA);
    expect(req.permissions.length, 'the doors forward permissions only when non-empty').toBeGreaterThan(0);
    expect(
      await runDirectory({ userId: 'usr_me', tenantId: orgA, positions: req.positions, permissions: req.permissions }),
    ).toEqual(['usr_me', 'usr_peer']);
  });

  it('a run with no organisation answers what an organisation-less request answers: the acting user alone', async () => {
    await boot();
    const rows = await ql.find('sys_user', { fields: ['id', 'name'], context: await requestContext('usr_me') });
    expect(ids(rows)).toEqual(['usr_me']);
    expect(await runDirectory({ userId: 'usr_me' })).toEqual(['usr_me']);
  });
});
