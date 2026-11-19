// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [rulings 6968686390, 6969143776 and 6973785798] A member reads and writes
 * their OWN notification preferences, and nothing else; so does a delegated
 * administrator. An organization owner or administrator keeps the Setup grid
 * exactly as it was.
 *
 * `member_default` names `sys_notification_preference` (read, create, edit, no
 * delete) and declares two policies on it:
 *  - `sys_notification_preference_self`: row scope and write check both
 *    `user_id == current_user.id`, NO `positions`, so it binds every principal
 *    that resolves the grant;
 *  - `sys_notification_preference_org_admin`: row scope `id != null`, write
 *    check `topic != null`, positions the organization owner and administrator
 *    identities (`delegated_admin` is not in it).
 * This suite drives that line and those policies, as shipped, on a real stack:
 *
 *  - the REAL `SecurityPlugin` with the shipped permission sets;
 *  - the REAL `sys_notification_preference` object (service-messaging), whose
 *    empty `user_id` is the organization's default for everyone (ADR-0118 D1);
 *  - the REAL caller resolution (`resolveAuthzContext`, then
 *    `assembleExecutionContext`) over the identity rows seeded below, so each
 *    persona's positions are the resolver's answer, not this file's;
 *  - the REAL `PreferenceResolver`, the filter `emit` runs, over what the
 *    member wrote.
 *
 * Each key is load-bearing: without the self policy's `check`, the
 * `owner_only_writes` floor joins the write check and a member moves a row
 * they created to another person or to the empty user; with `positions` on the
 * self policy, a role outside them is matched by no policy and reads and writes
 * every row; without the widener, an owner's or administrator's grid narrows
 * to their own rows; and a widener check that does not hold on a row being
 * created (`id != null`) refuses every administrator create. The ablations are
 * in the pull request that landed each.
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
/** Two ordinary members, a delegated administrator, an administrator and an owner. */
const ALICE = 'usr_npref_alice';
const BOB = 'usr_npref_bob';
const CAROL = 'usr_npref_carol';
const DAVE = 'usr_npref_dave';
const OWEN = 'usr_npref_owen';

/** The principals the self policy narrows to their own rows. */
const NARROWED = [
  { label: 'an ordinary member', key: 'alice', userId: ALICE },
  { label: 'a delegated administrator', key: 'dave', userId: DAVE },
] as const;
/** The principals the widener keeps on every row of their organization. */
const WIDENED = [
  { label: 'an organization administrator', key: 'carol', userId: CAROL },
  { label: 'an organization owner', key: 'owen', userId: OWEN },
] as const;

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

describe('member_default: who reads and writes sys_notification_preference rows', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  const as: Record<string, Ctx> = {};
  /** Rows seeded as the system: the organization default, a row for bob, and one an administrator wrote for each narrowed persona. */
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
    const role: Record<string, string> = {
      [ALICE]: 'member',
      [BOB]: 'member',
      [CAROL]: 'admin',
      [DAVE]: 'delegated_admin',
      [OWEN]: 'owner',
    };
    for (const userId of Object.keys(role)) {
      await ql.insert(
        'sys_user',
        { id: userId, name: userId, email: `${userId}@preference-co.test`, email_verified: true },
        { context: SYS } as never,
      );
      await ql.insert('sys_member', { user_id: userId, organization_id: ORG, role: role[userId] }, { context: SYS } as never);
    }
    seeded.everyone = String((await insert(SYS, { topic: 'approval.reminder', channel: 'email', enabled: false })).id);
    seeded.bob = String((await insert(SYS, { user_id: BOB, topic: 'collab.mention', channel: 'email', enabled: false })).id);
    // A row in each narrowed persona's name an administrator wrote: its `created_by` is not theirs.
    for (const { key, userId } of NARROWED) {
      seeded[`${key}ByAdmin`] = String((await insert(SYS, { user_id: userId, topic: 'approval.comment', channel: 'inbox', enabled: true })).id);
    }

    for (const { key, userId } of [...NARROWED, ...WIDENED]) as[key] = await contextOf(userId);
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('the fixture is armed: the resolver gives each persona the position this suite is about', () => {
    expect(as.alice.positions).toEqual(expect.arrayContaining(['org_member', 'everyone']));
    expect(as.dave.positions).toEqual(expect.arrayContaining(['delegated_admin', 'everyone']));
    expect(as.carol.positions).toEqual(expect.arrayContaining(['org_admin', 'everyone']));
    expect(as.owen.positions).toEqual(expect.arrayContaining(['org_owner', 'everyone']));
    // The delegated administrator is in neither the member domain nor the widener's.
    for (const p of ['org_member', 'org_admin', 'org_owner']) expect(as.dave.positions).not.toContain(p);
    for (const key of ['carol', 'owen']) expect(as[key].positions).not.toContain('org_member');
  });

  for (const { label: persona, key, userId } of NARROWED) {
    describe(`${persona}, on their own rows`, () => {
      it('creates a preference in their own name and lists only their own rows', async () => {
        const row = await insert(as[key], { user_id: userId, topic: 'approval.requested', channel: 'email', enabled: false });
        expect((await storedById(String(row.id)))?.user_id).toBe(userId);
        const mine = await list(as[key]);
        expect(mine.every((r) => r.user_id === userId)).toBe(true);
        expect(keys(mine)).toEqual(expect.arrayContaining([`${userId}|approval.requested|email`, `${userId}|approval.comment|inbox`]));
      });

      it('edits their own row, the one they created and the one an administrator wrote in their name', async () => {
        const own = String((await insert(as[key], { user_id: userId, topic: 'approval.returned', channel: '*', enabled: true })).id);
        await update(as[key], own, { enabled: false, digest: 'daily' });
        expect(await storedById(own)).toMatchObject({ user_id: userId, enabled: false, digest: 'daily' });
        await update(as[key], seeded[`${key}ByAdmin`], { enabled: false });
        expect((await storedById(seeded[`${key}ByAdmin`]))?.enabled).toBe(false);
      });

      it('deletes nothing: the grant carries no delete bit', async () => {
        const own = String((await insert(as[key], { user_id: userId, topic: 'approval.escalated', channel: 'email', enabled: false })).id);
        expect(await refusal(() => ql.delete(OBJ, { where: { id: own }, context: as[key] } as never))).toEqual({
          status: 403,
          code: 'PERMISSION_DENIED',
        });
        expect(await storedById(own)).toBeDefined();
      });
    });

    describe(`${persona} never writes a row that is not their own`, () => {
      for (const [label, data] of [
        ['user_id omitted (the default for everyone)', {}],
        ['user_id null (the default for everyone)', { user_id: null }],
        ["user_id '' (the default for everyone)", { user_id: '' }],
        ["another member's user_id", { user_id: BOB }],
      ] as const) {
        it(`refuses a create with ${label}: 403 PERMISSION_DENIED, nothing stored`, async () => {
          const topic = `refused.create.${key}.${label.length}`;
          expect(await refusal(() => insert(as[key], { ...data, topic, channel: '*', enabled: false }))).toEqual({
            status: 403,
            code: 'PERMISSION_DENIED',
          });
          expect(await stored({ topic })).toEqual([]);
        });
      }

      it('refuses a create for the default with topic and channel omitted: 403 PERMISSION_DENIED, nothing stored', async () => {
        const channel = `refused.defaulted.${key}`;
        expect(await refusal(() => insert(as[key], { channel, enabled: false }))).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
        expect(await stored({ channel })).toEqual([]);
      });

      for (const [label, to] of [
        ['to another member', BOB],
        ['to the empty user (the default for everyone)', null],
      ] as const) {
        it(`refuses moving a row they created ${label}: 403 PERMISSION_DENIED, the row keeps its owner`, async () => {
          const own = String((await insert(as[key], { user_id: userId, topic: `move.${String(to)}`, channel: '*', enabled: false })).id);
          expect((await storedById(own))?.created_by).toBe(userId);
          expect(await refusal(() => update(as[key], own, { user_id: to }))).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
          expect((await storedById(own))?.user_id).toBe(userId);
        });
      }

      it('refuses moving a row an administrator wrote in their name: 403 PERMISSION_DENIED', async () => {
        expect(await refusal(() => update(as[key], seeded[`${key}ByAdmin`], { user_id: BOB }))).toEqual({
          status: 403,
          code: 'PERMISSION_DENIED',
        });
        expect((await storedById(seeded[`${key}ByAdmin`]))?.user_id).toBe(userId);
      });

      it("neither reads nor edits the organization's default or another member's row: 404 RECORD_NOT_FOUND", async () => {
        const visible = (await list(as[key])).map((r) => String(r.id));
        expect(visible).not.toContain(seeded.everyone);
        expect(visible).not.toContain(seeded.bob);
        for (const id of [seeded.everyone, seeded.bob]) {
          expect(await refusal(() => update(as[key], id, { enabled: true }))).toEqual({ status: 404, code: 'RECORD_NOT_FOUND' });
          expect((await storedById(id))?.enabled).toBe(false);
        }
      });
    });
  }

  for (const { label: persona, key } of WIDENED) {
    describe(`${persona} keeps the Setup grid`, () => {
      it("lists every row of the organization, the default and each member's", async () => {
        const ids = (await list(as[key])).map((r) => String(r.id));
        expect(ids).toEqual(expect.arrayContaining([seeded.everyone, seeded.bob, seeded.aliceByAdmin, seeded.daveByAdmin]));
      });

      it("creates the organization's default and another person's row", async () => {
        const def = await insert(as[key], { topic: `system.upgrade_impact.${key}`, channel: 'email', enabled: false });
        expect((await storedById(String(def.id)))?.user_id ?? null).toBeNull();
        const forBob = await insert(as[key], { user_id: BOB, topic: `system.upgrade_impact.${key}`, channel: 'email', enabled: false });
        expect((await storedById(String(forBob.id)))?.user_id).toBe(BOB);
      });

      it('creates a default with topic omitted: the check judges the defaulted topic', async () => {
        // The widener's `check` is `topic != null`, coupled to `topic` being
        // required with a default: the write image it judges carries `*`.
        const channel = `defaulted.${key}`;
        const row = await insert(as[key], { channel, enabled: false });
        expect(await storedById(String(row.id))).toMatchObject({ topic: '*', channel });
        expect((await storedById(String(row.id)))?.user_id ?? null).toBeNull();
      });

      it("edits the organization's default and another person's row", async () => {
        await update(as[key], seeded.everyone, { digest: 'weekly' });
        expect((await storedById(seeded.everyone))?.digest).toBe('weekly');
        await update(as[key], seeded.bob, { enabled: true });
        expect((await storedById(seeded.bob))?.enabled).toBe(true);
        await update(as[key], seeded.bob, { enabled: false });
        await update(as[key], seeded.everyone, { digest: 'none' });
      });

      it('deletes a row, as today', async () => {
        const doomed = String((await insert(SYS, { topic: `doomed.${key}`, channel: 'email', enabled: false })).id);
        await ql.delete(OBJ, { where: { id: doomed }, context: as[key] } as never);
        expect(await storedById(doomed)).toBeUndefined();
      });
    });
  }

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
