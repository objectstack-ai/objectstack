// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The built-in tasks and notes (`sys_task`, `sys_note`) in a real runtime.
 *
 * `@objectstack/platform-objects` declares both objects, their sharing and the
 * platform-owned columns; what each of those MEANS is decided by the engine,
 * the security plugin and the sharing service together, so it is asserted
 * here, with all of them composed:
 *
 *  - both objects register from `PlatformObjectsPlugin` in a fresh runtime,
 *    with no application declaring either;
 *  - a task's `completed_at` is written when its status becomes done and
 *    cleared when it leaves done, through the engine's write path;
 *  - the platform's member baseline (`member_default`) opens both objects
 *    (maintainer ruling 7131539862, option A: read, create and edit, no
 *    delete), and with that grant in place a task is still read by its
 *    creator and its assignee only, a note by its creator only — by id and by
 *    list. The ruling rests on that premise;
 *  - the assignee edits the task: the declared `sys_task_assignee` rule grants
 *    `edit`, and the member baseline's ownership floor (`owner_only_writes`,
 *    `created_by == current_user.id`) defers to that share.
 *
 * Real stack: an `ObjectKernel` with `ObjectQLPlugin` over a better-sqlite3
 * file, `PlatformObjectsPlugin`, `SecurityPlugin` with the platform permission
 * sets only (every member resolves `member_default` and nothing else — no
 * application set) and `SharingServicePlugin`.
 *
 * ## Two boots over one database
 *
 * The organization and its members are written by a first boot, and the
 * assertions run on a second boot over the same file. The sharing service
 * binds its per-record rule hooks at boot, from the declared rules it serves
 * then, and under a walled posture it serves a declared rule once per
 * organization that exists — so the second boot is the one that serves
 * `sys_task_assignee` for this organization, as a running deployment does.
 *
 * One boot would not: a kernel that boots with no organization binds no
 * per-record hook for a declared rule, and the organization created later is
 * served the rule without one, so no grant is written until the next boot
 * (filed as #36982). The two boots keep this test about the objects.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const ORG = 'org_tn';
const CREATOR = 'usr_tn_creator';
const ASSIGNEE = 'usr_tn_assignee';
const STRANGER = 'usr_tn_stranger';
const PEOPLE = [CREATOR, ASSIGNEE, STRANGER];

const SYSTEM = { isSystem: true, tenantId: ORG } as const;
/**
 * A member's request context, as the auth layer builds it (the org peer set
 * included). No permission set of its own: the member baseline is all it holds.
 */
const as = (userId: string) => ({ userId, tenantId: ORG, positions: [], permissions: [], org_user_ids: PEOPLE });

type Outcome = { kind: 'landed' } | { kind: 'refused'; code?: string; status?: number };
const outcomeOf = (p: Promise<unknown>): Promise<Outcome> =>
  p.then(
    () => ({ kind: 'landed' as const }),
    (e: { code?: unknown; status?: unknown; statusCode?: unknown } | null) => {
      const status = e?.statusCode ?? e?.status;
      return {
        kind: 'refused' as const,
        code: e?.code == null ? undefined : String(e.code),
        status: status == null ? undefined : Number(status),
      };
    },
  );

function sqliteDriverPlugin(filename: string): Plugin {
  return {
    name: 'test.driver.sqlite',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService(
        'driver.default',
        new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true }),
      );
    },
  };
}

/** The identity objects only: tasks and notes come from `PlatformObjectsPlugin`. */
function identityPlugin(): Plugin {
  return {
    name: 'test.identity',
    type: 'standard',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: PluginContext) {
      ctx.getService<{ register(m: unknown): unknown }>('manifest').register({
        id: 'test.task-note-identity',
        namespace: 'qa_tn',
        version: '1.0.0',
        type: 'plugin',
        name: 'Task and note identity',
        objects: [SysUser, SysMember, SysOrganization],
      });
    },
  };
}

async function boot(filename: string): Promise<ObjectKernel> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' } } as never);
  await kernel.use(sqliteDriverPlugin(filename));
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(identityPlugin());
  await kernel.use(new PlatformObjectsPlugin());
  await kernel.use(new SecurityPlugin({
    defaultPermissionSets,
    fallbackPermissionSet: 'member_default',
  }));
  await kernel.use(new SharingServicePlugin({ registerShareLinkRoutes: false }));
  await kernel.bootstrap();
  return kernel;
}

const shutdown = async (kernel: ObjectKernel | undefined) => {
  if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
};

describe('sys_task and sys_note in a real runtime: registration, the completion stamp, and who reads and edits them', () => {
  let dir: string | undefined;
  let kernel: ObjectKernel | undefined;
  let ql: ObjectQL;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-task-note-'));
    const file = join(dir, 'data.sqlite');

    const first = await boot(file);
    const seed = first.getService<ObjectQL>('objectql');
    await seed.insert('sys_organization', { id: ORG, name: 'Acme', slug: 'acme' }, { context: SYSTEM } as never);
    for (const userId of PEOPLE) {
      await seed.insert('sys_user', { id: userId, name: userId, email: `${userId}@acme.test`, email_verified: true }, { context: SYSTEM } as never);
      await seed.insert('sys_member', { user_id: userId, organization_id: ORG, role: 'member' }, { context: SYSTEM } as never);
    }
    await shutdown(first);

    kernel = await boot(file);
    ql = kernel.getService<ObjectQL>('objectql');
  }, 120_000);

  afterAll(async () => {
    await shutdown(kernel);
    if (dir) rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  const stored = async (object: string, id: string) =>
    ((await ql.find(object, { where: { id }, context: SYSTEM } as never)) as Array<Record<string, unknown>>)[0] ?? null;
  const readAs = async (userId: string, object: string, id: string) =>
    (await ql.findOne(object, { where: { id }, context: as(userId) } as never)) as Record<string, unknown> | null;
  const createTask = async (id: string) => {
    await ql.insert('sys_task', { id, title: `task ${id}`, assignee_id: ASSIGNEE }, { context: as(CREATOR) } as never);
    return id;
  };

  it('registers both objects from PlatformObjectsPlugin, with no application declaring either', () => {
    expect(ql.getSchema('sys_task')).toMatchObject({ name: 'sys_task', sharingModel: 'private' });
    expect(ql.getSchema('sys_note')).toMatchObject({ name: 'sys_note', sharingModel: 'private' });
  });

  it('writes completed_at when the status becomes done, and clears it when the status leaves done', async () => {
    const id = await createTask('t_stamp');
    expect(await stored('sys_task', id)).toMatchObject({ status: 'todo', completed_at: null, owner_id: CREATOR });

    await ql.update('sys_task', { status: 'done' }, { where: { id }, context: as(CREATOR) } as never);
    const done = await stored('sys_task', id);
    expect(done?.status).toBe('done');
    expect(Number.isNaN(Date.parse(String(done?.completed_at)))).toBe(false);

    await ql.update('sys_task', { status: 'in_progress' }, { where: { id }, context: as(CREATOR) } as never);
    expect(await stored('sys_task', id)).toMatchObject({ status: 'in_progress', completed_at: null });
  });

  const listedAs = async (userId: string, object: string) =>
    ((await ql.find(object, { context: as(userId) } as never)) as Array<{ id: string }>).map((row) => row.id);

  it('the member baseline opens both objects: read, create and edit, no delete', () => {
    const baseline = defaultPermissionSets.find((set) => set.name === 'member_default');
    // No widening bit either: the rows stay the objects' own sharing's.
    const shape = {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false,
      allowTransfer: false, viewAllRecords: false, modifyAllRecords: false,
    };
    expect(baseline?.objects?.sys_task).toEqual(shape);
    expect(baseline?.objects?.sys_note).toEqual(shape);
  });

  it('a task is read by its creator and its assignee, and not by another member holding the same baseline', async () => {
    const id = await createTask('t_read');
    expect(await readAs(CREATOR, 'sys_task', id)).toMatchObject({ id });
    expect(await readAs(ASSIGNEE, 'sys_task', id)).toMatchObject({ id });
    expect(await readAs(STRANGER, 'sys_task', id)).toBeNull();
    expect(await listedAs(CREATOR, 'sys_task')).toContain(id);
    expect(await listedAs(ASSIGNEE, 'sys_task')).toContain(id);
    expect(await listedAs(STRANGER, 'sys_task')).not.toContain(id);
  });

  it('a note is read by its creator only', async () => {
    await ql.insert('sys_note', { id: 'n_read', body: 'groceries' }, { context: as(CREATOR) } as never);
    expect(await stored('sys_note', 'n_read')).toMatchObject({ owner_id: CREATOR, heading: 'groceries' });
    expect(await readAs(CREATOR, 'sys_note', 'n_read')).toMatchObject({ id: 'n_read' });
    expect(await readAs(STRANGER, 'sys_note', 'n_read')).toBeNull();
    expect(await readAs(ASSIGNEE, 'sys_note', 'n_read')).toBeNull();
    expect(await listedAs(CREATOR, 'sys_note')).toContain('n_read');
    expect(await listedAs(STRANGER, 'sys_note')).not.toContain('n_read');
    expect(await listedAs(ASSIGNEE, 'sys_note')).not.toContain('n_read');
  });

  it('the assignee edits the task and marks it done; another member is refused as if the task did not exist', async () => {
    const id = await createTask('t_edit');

    expect(await outcomeOf(
      ql.update('sys_task', { status: 'done' }, { where: { id }, context: as(ASSIGNEE) } as never),
    )).toEqual({ kind: 'landed' });
    const done = await stored('sys_task', id);
    expect(done).toMatchObject({ status: 'done', updated_by: ASSIGNEE, owner_id: CREATOR });
    expect(Number.isNaN(Date.parse(String(done?.completed_at)))).toBe(false);

    expect(await outcomeOf(
      ql.update('sys_task', { title: 'renamed' }, { where: { id }, context: as(STRANGER) } as never),
    )).toEqual({ kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 });
    expect(await stored('sys_task', id)).toMatchObject({ title: `task ${id}` });
  });
});
