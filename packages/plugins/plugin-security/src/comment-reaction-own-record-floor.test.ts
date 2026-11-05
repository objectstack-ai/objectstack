// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22566] A comment reaction is its reactor's own record, so the platform's
 * own-record floor is the whole of its delete rule (ruling A amended on
 * #22505: "the platform's ordinary rule, a member writes their own records,
 * lets a member add or remove their own reaction on anyone's comment").
 *
 * The floor is `member_default`'s `owner_only_deletes` (object `'*'`,
 * `created_by == current_user.id`, positions `['org_member']`). This suite
 * drives it, as shipped, through the REAL security middleware over a REAL
 * engine and driver, with the column it keys on stamped by the REAL
 * `ObjectQLPlugin` audit hook:
 *
 *  - a member creates a reaction on another member's comment, and deletes it;
 *  - another member cannot delete it — by id or by predicate — and the row
 *    survives;
 *  - two members reacting at once keep two rows.
 *
 * ## The object, written out rather than imported
 *
 * `sys_comment_reaction` is declared by `@objectstack/plugin-audit`, which this
 * package does not depend on. The declaration below copies the properties the
 * floor reads and nothing else: a `sys_` system object with no `sharingModel`
 * (so `owner_only_deletes` is not yielded), audit columns injected (so
 * `created_by` exists and is stamped), and the reaction's own columns. Those
 * properties are pinned on the real declaration by plugin-audit's
 * `sys-comment-reaction.object.test.ts`, so the two cannot drift apart without
 * one side going red — the same arrangement `ownership-floor-alternates.test.ts`
 * uses for `sys_comment`. The comment itself lives in plugin-audit too; the
 * floor never reads it, so here a comment is only the id a reaction names.
 *
 * ## Who grants the bits
 *
 * The object-level create / read / delete bits come from an ordinary
 * position-distributed set an application ships (as an app grants
 * `sys_comment` today), never from the `everyone`-bound baseline, which
 * ADR-0090 D5 keeps free of delete bits. Which shipped set — if any — carries
 * them is an open decision on #22566; the floor pinned here holds whatever set
 * hands the delete bit out.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const REACTION = 'sys_comment_reaction';

/** The properties of plugin-audit's declaration the floor reads (see header). */
const REACTION_OBJECT = {
  name: REACTION,
  label: 'Comment Reaction',
  isSystem: true,
  managedBy: 'platform',
  fields: {
    comment_id: { type: 'text', label: 'Comment', required: true, maxLength: 255 },
    emoji: { type: 'text', label: 'Emoji', required: true, maxLength: 64 },
    user_id: { type: 'text', label: 'User', required: true },
  },
  indexes: [{ fields: ['comment_id', 'emoji', 'user_id'], unique: 'organization' }],
  enable: { apiMethods: ['get', 'list', 'create', 'delete', 'bulk'] },
};

/** The app's grant: read, create and delete on reactions — every row. */
const REACTOR_SET = PermissionSetSchema.parse({
  name: 'qa_comment_reactor',
  label: 'Comment reactor (app grant)',
  objects: {
    [REACTION]: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: true },
  },
});

/** Two rank-and-file members of one organization, holding the app's grant. */
const member = (userId: string) => ({
  userId,
  tenantId: 'org_acme',
  positions: ['org_member', 'everyone'],
  permissions: [REACTOR_SET.name],
  posture: 'MEMBER' as const,
});
const ALICE = member('usr_alice');
const BOB = member('usr_bob');
const SYSTEM = { isSystem: true, userId: 'usr_system' };

/** Bob's comment — the id a reaction names. */
const BOBS_COMMENT = 'cmt_by_bob';

function sqliteDriverPlugin(): Plugin {
  return {
    name: 'test.driver.sqlite',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService(
        'driver.default',
        new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
      );
    },
  };
}

function objectsPlugin(): Plugin {
  return {
    name: 'test.objects',
    type: 'standard',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: PluginContext) {
      ctx.getService<{ register(m: unknown): unknown }>('manifest').register({
        id: 'test.comment-reaction',
        namespace: 'sys',
        version: '1.0.0',
        type: 'plugin',
        name: 'Comment reaction fixture',
        // The identity objects the security plugin's authorization store
        // reads, as `platform-global-no-organization-column.test.ts` mounts them.
        objects: [SysUser, SysMember, SysOrganization, REACTION_OBJECT],
      });
    },
  };
}

let kernel: ObjectKernel | undefined;
afterEach(async () => {
  try {
    await kernel?.shutdown();
  } catch {
    /* a refused boot leaves the kernel stopped */
  }
  kernel = undefined;
});

async function boot(): Promise<ObjectQL> {
  kernel = new ObjectKernel({ logger: { level: 'silent' } });
  await kernel.use(sqliteDriverPlugin());
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(objectsPlugin());
  await kernel.use(
    new SecurityPlugin({
      defaultPermissionSets: [...defaultPermissionSets, REACTOR_SET],
      fallbackPermissionSet: 'member_default',
    }),
  );
  await kernel.bootstrap();
  return kernel.getService<ObjectQL>('objectql');
}

interface Outcome { ok: boolean; code?: string; status?: number }
const attempt = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try {
    await run();
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; status?: number; statusCode?: number };
    return { ok: false, code: err.code, status: err.statusCode ?? err.status };
  }
};

const react = (ql: ObjectQL, caller: ReturnType<typeof member>, emoji: string) =>
  ql.insert(REACTION, { comment_id: BOBS_COMMENT, emoji, user_id: caller.userId }, { context: caller });
const rowById = (ql: ObjectQL, id: string) => ql.findOne(REACTION, { where: { id }, context: SYSTEM });

describe('[#22566] a reaction is its reactor’s own record — the own-record floor, as shipped', () => {
  it('a member reacts to another member’s comment and removes the reaction again', async () => {
    const ql = await boot();
    const created = await react(ql, ALICE, '👍');
    // The column the floor keys on carries the reactor.
    expect((await rowById(ql, created.id))?.created_by).toBe(ALICE.userId);

    const removed = await attempt(() => ql.delete(REACTION, { where: { id: created.id }, context: ALICE }));
    expect(removed).toEqual({ ok: true });
    expect(await rowById(ql, created.id)).toBeNull();
  }, 60_000);

  it('another member cannot delete it — by id or by predicate — and the row survives', async () => {
    const ql = await boot();
    const created = await react(ql, ALICE, '🎉');
    // Bob can SEE Alice's reaction (the floor narrows writes, never reads)…
    expect((await ql.findOne(REACTION, { where: { id: created.id }, context: BOB }))?.id).toBe(created.id);

    // …and may not remove it.
    const byId = await attempt(() => ql.delete(REACTION, { where: { id: created.id }, context: BOB }));
    expect(byId).toMatchObject({ ok: false, code: 'PERMISSION_DENIED', status: 403 });

    await attempt(() =>
      ql.delete(REACTION, { where: { comment_id: BOBS_COMMENT }, multi: true, context: BOB }),
    );
    expect((await rowById(ql, created.id))?.id).toBe(created.id);
  }, 60_000);

  it('two members reacting at once keep two rows, each deletable only by its reactor', async () => {
    const ql = await boot();
    const [a, b] = await Promise.all([react(ql, ALICE, '❤️'), react(ql, BOB, '❤️')]);
    const rows = await ql.find(REACTION, { where: { comment_id: BOBS_COMMENT }, context: SYSTEM });
    expect(rows.map((r: any) => r.created_by).sort()).toEqual([ALICE.userId, BOB.userId].sort());

    expect(await attempt(() => ql.delete(REACTION, { where: { id: a.id }, context: BOB }))).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
      status: 403,
    });
    expect(await attempt(() => ql.delete(REACTION, { where: { id: b.id }, context: BOB }))).toEqual({ ok: true });
    const left = await ql.find(REACTION, { where: { comment_id: BOBS_COMMENT }, context: SYSTEM });
    expect(left.map((r: any) => r.id)).toEqual([a.id]);
  }, 60_000);
});

/**
 * The object grants `bulk`, and the batch doors are the protocol's own
 * `createManyData` / `deleteManyData` — driven here over the same real engine,
 * so what is pinned is the door's real loop, not a re-statement of it.
 * `deleteManyData` deletes one id at a time by id, so each row meets the floor;
 * a row it may not delete fails ON ITS OWN, with the floor's code, and the row
 * survives.
 */
describe('[#22566] the batch doors keep the own-record floor', () => {
  interface BatchResult { id: string; success: boolean; errors?: Array<{ code?: string }> }
  interface BatchDoor {
    createManyData(req: { object: string; records: unknown[]; context?: unknown }): Promise<{ records: Array<{ id: string }> }>;
    deleteManyData(req: {
      object: string;
      ids: string[];
      options?: { continueOnError?: boolean };
      context?: unknown;
    }): Promise<{ succeeded: number; failed: number; results: BatchResult[] }>;
  }
  const doorOver = (ql: ObjectQL): BatchDoor =>
    new ObjectStackProtocolImplementation(ql as never, () => new Map(), undefined) as unknown as BatchDoor;

  it('createMany then deleteMany: a member removes its own reactions in one batch; another member’s is refused alone and survives', async () => {
    const ql = await boot();
    const door = doorOver(ql);
    const { records: mine } = await door.createManyData({
      object: REACTION,
      records: [
        { comment_id: BOBS_COMMENT, emoji: '👍', user_id: ALICE.userId },
        { comment_id: BOBS_COMMENT, emoji: '🎉', user_id: ALICE.userId },
      ],
      context: ALICE,
    });
    expect(mine).toHaveLength(2);
    const bobs = await react(ql, BOB, '👍');

    const ids = [mine[0]!.id, bobs.id, mine[1]!.id].map(String);
    const res = await door.deleteManyData({ object: REACTION, ids, options: { continueOnError: true }, context: ALICE });

    expect(res.succeeded).toBe(2);
    expect(res.failed).toBe(1);
    const refused = res.results.find((r) => r.id === String(bobs.id));
    expect(refused?.success).toBe(false);
    expect(refused?.errors?.[0]?.code).toBe('PERMISSION_DENIED');
    // Ground truth past every scope: Bob's row is still there, Alice's are gone.
    const left = await ql.find(REACTION, { where: { comment_id: BOBS_COMMENT }, context: SYSTEM });
    expect(left.map((r: any) => String(r.id))).toEqual([String(bobs.id)]);
  }, 60_000);
});
