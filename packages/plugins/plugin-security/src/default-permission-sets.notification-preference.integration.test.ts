// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [rulings 6968686390 and 6969143776] A member reads and writes their OWN
 * notification preferences, and nothing else; an organization administrator
 * keeps the Setup grid exactly as it was.
 *
 * `member_default` names `sys_notification_preference` (read, create, edit, no
 * delete) and declares `sys_notification_preference_self`: row scope
 * `user_id == current_user.id`, the write check `user_id == current_user.id`,
 * `positions: ['org_member']`. This suite drives that line and that policy, as
 * shipped, on a real stack:
 *
 *  - the REAL `SecurityPlugin` with the shipped permission sets;
 *  - the REAL `sys_notification_preference` object (service-messaging), whose
 *    empty `user_id` is the organization's default for everyone (ADR-0118 D1);
 *  - the REAL caller resolution (`resolveAuthzContext`, then
 *    `assembleExecutionContext`) over the identity rows seeded below, so the
 *    member's `org_member` and the administrator's `org_admin` are the
 *    resolver's answer, not this file's;
 *  - the REAL `PreferenceResolver`, the filter `emit` runs, over what the
 *    member wrote.
 *
 * The readings pinned are the ones os-dev-report 6968930571 measured. Each key
 * of the policy is load-bearing: without the `check`, the `owner_only_writes`
 * floor joins the write check and a member moves a row they created to
 * another person or to the empty user; without `positions`, the
 * administrator's grid narrows to their own rows. Both ablations are in the
 * pull request that landed this suite.
 *
 * Refusals assert the wire `code` AND `status` the data door maps the engine's
 * error to (ADR-0112), and that nothing was stored.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, resolveAuthzContext, assembleExecutionContext, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { NotificationPreference, PreferenceResolver, PREFERENCE_OBJECT } from '@objectstack/service-messaging';
import { mapDataError } from '@objectstack/types';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const OBJ = PREFERENCE_OBJECT;
const ORG = 'org_npref';
/** Two ordinary members and an organization administrator. */
const ALICE = 'usr_npref_alice';
const BOB = 'usr_npref_bob';
const CAROL = 'usr_npref_carol';

const SYS = { isSystem: true, tenantId: ORG } as const;

type Row = Record<string, any>;
type Ctx = Record<string, unknown>;

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
        id: 'test.notification-preference-grants',
        namespace: 'npref',
        version: '1.0.0',
        type: 'plugin',
        name: 'Notification preference grants fixture',
        objects: [SysUser, SysMember, SysOrganization, NotificationPreference],
      });
    },
  };
}

/** The wire answer a refused engine call maps to, as the data door sends it. */
async function refusal(run: () => Promise<unknown>): Promise<{ status: number; code: string }> {
  let thrown: unknown;
  try {
    await run();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, `the ${OBJ} call was refused`).toBeDefined();
  const wire = mapDataError(thrown, OBJ);
  return { status: wire.status, code: String(wire.body.code) };
}

const silent = { info() {}, warn() {}, error() {} };

describe('member_default: a member reads and writes only their own notification preferences', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  const as: Record<string, Ctx> = {};
  /** Rows seeded as the system: the organization default, and one row each for bob and alice. */
  const seeded: Record<string, string> = {};

  const contextOf = async (userId: string): Promise<Ctx> => {
    const authz = await resolveAuthzContext({
      ql,
      headers: {},
      getSession: async () => ({
        user: { id: userId },
        session: { id: `ses_${userId}`, userId, activeOrganizationId: ORG },
      }),
    } as never);
    return assembleExecutionContext({
      authz,
      oauth: undefined,
      localization: undefined,
      requestLocale: undefined,
      accessToken: undefined,
    } as never) as unknown as Ctx;
  };

  const insert = (ctx: Ctx, data: Row) => ql.insert(OBJ, data, { context: ctx } as never) as Promise<Row>;
  const update = (ctx: Ctx, id: string, data: Row) => ql.update(OBJ, data, { where: { id }, context: ctx } as never);
  const list = async (ctx: Ctx) => (await ql.find(OBJ, { context: ctx } as never)) as Row[];
  const stored = async (where: Row) => (await ql.find(OBJ, { where, context: SYS } as never)) as Row[];
  const storedById = async (id: string) => (await stored({ id }))[0];
  const keys = (rows: Row[]) => rows.map((r) => `${r.user_id ?? '(everyone)'}|${r.topic}|${r.channel}`).sort();

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(sqliteDriverPlugin());
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(objectsPlugin());
    await kernel.use(new SecurityPlugin({ defaultPermissionSets }));
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');

    await ql.insert('sys_organization', { id: ORG, name: 'Preference Co', slug: 'preference-co' }, { context: SYS } as never);
    const role: Record<string, string> = { [ALICE]: 'member', [BOB]: 'member', [CAROL]: 'admin' };
    for (const userId of [ALICE, BOB, CAROL]) {
      await ql.insert(
        'sys_user',
        { id: userId, name: userId, email: `${userId}@preference-co.test`, email_verified: true },
        { context: SYS } as never,
      );
      await ql.insert('sys_member', { user_id: userId, organization_id: ORG, role: role[userId] }, { context: SYS } as never);
    }
    seeded.everyone = String((await insert(SYS, { topic: 'approval.reminder', channel: 'email', enabled: false })).id);
    seeded.bob = String((await insert(SYS, { user_id: BOB, topic: 'collab.mention', channel: 'email', enabled: false })).id);
    // A row in alice's name an administrator wrote: its `created_by` is not hers.
    seeded.aliceByAdmin = String((await insert(SYS, { user_id: ALICE, topic: 'approval.comment', channel: 'inbox', enabled: true })).id);

    for (const [name, userId] of [['alice', ALICE], ['carol', CAROL]] as const) as[name] = await contextOf(userId);
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('the fixture is armed: the resolver makes alice an ordinary member and carol an organization administrator', () => {
    expect(as.alice.positions).toEqual(expect.arrayContaining(['org_member', 'everyone']));
    expect(as.carol.positions).toEqual(expect.arrayContaining(['org_admin', 'everyone']));
    expect(as.carol.positions).not.toContain('org_member');
  });

  describe('a member, on their own rows', () => {
    it('creates a preference in their own name and lists only their own rows', async () => {
      const row = await insert(as.alice, { user_id: ALICE, topic: 'approval.requested', channel: 'email', enabled: false });
      expect((await storedById(String(row.id)))?.user_id).toBe(ALICE);
      const mine = await list(as.alice);
      expect(mine.every((r) => r.user_id === ALICE)).toBe(true);
      expect(keys(mine)).toEqual(expect.arrayContaining([`${ALICE}|approval.requested|email`, `${ALICE}|approval.comment|inbox`]));
    });

    it('edits their own row, the one they created and the one an administrator wrote in their name', async () => {
      const own = String((await insert(as.alice, { user_id: ALICE, topic: 'approval.returned', channel: '*', enabled: true })).id);
      await update(as.alice, own, { enabled: false, digest: 'daily' });
      expect(await storedById(own)).toMatchObject({ user_id: ALICE, enabled: false, digest: 'daily' });
      await update(as.alice, seeded.aliceByAdmin, { enabled: false });
      expect((await storedById(seeded.aliceByAdmin))?.enabled).toBe(false);
    });

    it('deletes nothing: the grant carries no delete bit', async () => {
      const own = String((await insert(as.alice, { user_id: ALICE, topic: 'approval.escalated', channel: 'email', enabled: false })).id);
      expect(await refusal(() => ql.delete(OBJ, { where: { id: own }, context: as.alice } as never))).toEqual({
        status: 403,
        code: 'PERMISSION_DENIED',
      });
      expect(await storedById(own)).toBeDefined();
    });
  });

  describe('a member never writes a row that is not their own', () => {
    for (const [label, data] of [
      ['user_id omitted (the default for everyone)', {}],
      ['user_id null (the default for everyone)', { user_id: null }],
      ["user_id '' (the default for everyone)", { user_id: '' }],
      ["another member's user_id", { user_id: BOB }],
    ] as const) {
      it(`refuses a create with ${label}: 403 PERMISSION_DENIED, nothing stored`, async () => {
        const topic = `refused.create.${label.length}`;
        expect(await refusal(() => insert(as.alice, { ...data, topic, channel: '*', enabled: false }))).toEqual({
          status: 403,
          code: 'PERMISSION_DENIED',
        });
        expect(await stored({ topic })).toEqual([]);
      });
    }

    for (const [label, to] of [
      ['to another member', BOB],
      ['to the empty user (the default for everyone)', null],
    ] as const) {
      it(`refuses moving a row they created ${label}: 403 PERMISSION_DENIED, the row keeps its owner`, async () => {
        const own = String((await insert(as.alice, { user_id: ALICE, topic: `move.${String(to)}`, channel: '*', enabled: false })).id);
        expect((await storedById(own))?.created_by).toBe(ALICE);
        expect(await refusal(() => update(as.alice, own, { user_id: to }))).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
        expect((await storedById(own))?.user_id).toBe(ALICE);
      });
    }

    it("refuses moving a row an administrator wrote in their name: 403 PERMISSION_DENIED", async () => {
      expect(await refusal(() => update(as.alice, seeded.aliceByAdmin, { user_id: BOB }))).toEqual({
        status: 403,
        code: 'PERMISSION_DENIED',
      });
      expect((await storedById(seeded.aliceByAdmin))?.user_id).toBe(ALICE);
    });

    it("neither reads nor edits the organization's default or another member's row: 404 RECORD_NOT_FOUND", async () => {
      const visible = (await list(as.alice)).map((r) => String(r.id));
      expect(visible).not.toContain(seeded.everyone);
      expect(visible).not.toContain(seeded.bob);
      for (const id of [seeded.everyone, seeded.bob]) {
        expect(await refusal(() => update(as.alice, id, { enabled: true }))).toEqual({ status: 404, code: 'RECORD_NOT_FOUND' });
        expect((await storedById(id))?.enabled).toBe(false);
      }
    });
  });

  describe('an organization administrator keeps the Setup grid', () => {
    it("lists every row of the organization, the default and each member's", async () => {
      const ids = (await list(as.carol)).map((r) => String(r.id));
      expect(ids).toEqual(expect.arrayContaining([seeded.everyone, seeded.bob, seeded.aliceByAdmin]));
    });

    it("creates and edits the organization's default, and edits another person's row", async () => {
      const created = await insert(as.carol, { topic: 'system.upgrade_impact', channel: 'email', enabled: false });
      expect((await storedById(String(created.id)))?.user_id ?? null).toBeNull();
      await update(as.carol, seeded.everyone, { digest: 'weekly' });
      expect((await storedById(seeded.everyone))?.digest).toBe('weekly');
      await update(as.carol, seeded.bob, { enabled: true });
      expect((await storedById(seeded.bob))?.enabled).toBe(true);
      await update(as.carol, seeded.bob, { enabled: false });
    });
  });

  describe('what a member wrote takes effect on the next emit', () => {
    const resolver = (mandatoryTopics: string[] = []) =>
      new PreferenceResolver({ getData: () => ql as never, logger: silent, mandatoryTopics });

    it("the member's own mute drops that channel for them and for nobody else", async () => {
      const topic = 'deal.won';
      const before = await resolver().filter([ALICE, BOB], ['inbox', 'email'], { topic, organizationId: ORG });
      expect(before).toEqual([
        { recipient: ALICE, channels: ['inbox', 'email'] },
        { recipient: BOB, channels: ['inbox', 'email'] },
      ]);
      await insert(as.alice, { user_id: ALICE, topic, channel: 'email', enabled: false });
      const after = await resolver().filter([ALICE, BOB], ['inbox', 'email'], { topic, organizationId: ORG });
      expect(after).toEqual([
        { recipient: ALICE, channels: ['inbox'] },
        { recipient: BOB, channels: ['inbox', 'email'] },
      ]);
    });

    it('a mandatory topic is still delivered on every channel, whatever the member wrote', async () => {
      const topic = 'security.access_upgrade';
      await insert(as.alice, { user_id: ALICE, topic, channel: '*', enabled: false });
      expect(await resolver().filter([ALICE], ['inbox', 'email'], { topic, organizationId: ORG })).toEqual([]);
      expect(await resolver(['security.']).filter([ALICE], ['inbox', 'email'], { topic, organizationId: ORG })).toEqual([
        { recipient: ALICE, channels: ['inbox', 'email'] },
      ]);
    });
  });
});
