// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30108 — maintainer ruling 6633054352, 「同意 A」] Every member reads and
 * posts comments, and reads the activity history, of the records they can
 * read — with no grant from the app author — and of no other record.
 *
 * The platform baseline `member_default` names `sys_comment` (read, create,
 * edit) and `sys_activity` (read). Those lines open the OBJECTS; the rows are
 * decided by plugin-audit's parent-record gates. This suite drives the two
 * together, as shipped, on a real stack:
 *
 *  - the REAL `SecurityPlugin` with the shipped permission sets, and an app
 *    set that names the app's own objects and nothing else — the shape of a
 *    `create-objectstack` project, where the refusal was measured;
 *  - the REAL `AuditPlugin`: `sys_comment` and `sys_activity`, the CRUD mirror
 *    that writes the activity rows, the comment gate, the activity gate and
 *    the `enable.feeds` capability gate;
 *  - the REAL caller resolution (`resolveAuthzContext`, then
 *    `assembleExecutionContext`) over the identity rows seeded below, so a
 *    member's `everyone` anchor and an external's lack of it are the
 *    resolver's answer, not this file's.
 *
 * What the ruling asked to be measured before landing, one block each:
 *
 *  1. a member uses both on a record they can read;
 *  2. a member gets nothing of a record they cannot read — a row in an object
 *     they read (row scope) and a row in an object they do not read at all;
 *  3. an external member: the grant does not reach one (`org_external` holds
 *     no `everyone` anchor and resolves `external_default` in this set's
 *     place), and one holding an explicit grant meets the same two gates;
 *  4. an object with `enable.feeds: false` refuses a comment's create and its
 *     re-thread into that object;
 *  5. the console header's feed read (`GET /data/sys_activity?top=20&sort=-timestamp`,
 *     its rows and its `total`) logs no `[Security] Access denied` line for
 *     the parent objects it skips — armed by the read that does log one.
 *
 * `@objectstack/plugin-audit` reads from source here (this package's vitest
 * alias); `@objectstack/core` from its built output, as this package's other
 * suites read it.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectKernel, resolveAuthzContext, assembleExecutionContext, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { mapDataError } from '@objectstack/types';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const COMMENT = 'sys_comment';
const ACTIVITY = 'sys_activity';
/** The app's record object. A member reads the tickets they requested. */
const TICKET = 'fdg_ticket';
/** An app object no member reads at all. */
const VAULT = 'fdg_vault';
/** An app object that turns comments and the activity mirror off. */
const QUIET = 'fdg_quiet';
const ORG = 'org_fdg';

const ALICE = 'usr_alice';
const BOB = 'usr_bob';
/** An external member holding an explicit portal grant. */
const EVE = 'usr_eve';
/** An external member holding nothing but its own baseline. */
const EZRA = 'usr_ezra';

/** plugin-security's denial line, as a matcher (its developer sentence's opener). */
const DENIAL = '[Security] Access denied';

/**
 * The app's every-member set — the set a `create-objectstack` project ships:
 * its own objects and NOTHING else. No `sys_comment`, no `sys_activity`: the
 * baseline is what has to carry them.
 */
const APP_SET = PermissionSetSchema.parse({
  name: 'fdg_app_member',
  label: 'Help desk member (the app set)',
  objects: {
    [TICKET]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
    [QUIET]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
  },
  rowLevelSecurity: [
    { name: 'fdg_ticket_requester', object: TICKET, operation: 'select', using: 'requester_id == current_user.id' },
  ],
});

/**
 * A portal grant an app hands its external users explicitly: their own
 * tickets, and the two feed objects named outright.
 */
const PORTAL_SET = PermissionSetSchema.parse({
  name: 'fdg_portal',
  label: 'Help desk portal (explicit external grant)',
  objects: {
    [TICKET]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    [COMMENT]: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false },
    [ACTIVITY]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
  },
  rowLevelSecurity: [
    { name: 'fdg_ticket_portal_requester', object: TICKET, operation: 'select', using: 'requester_id == current_user.id' },
  ],
});

const SYS = { isSystem: true, tenantId: ORG } as const;

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
  const appObject = (name: string, label: string, extra: Record<string, unknown> = {}) => ({
    name,
    label,
    fields: {
      name: { type: 'text', label: 'Name' },
      requester_id: { type: 'text', label: 'Requester' },
    },
    ...extra,
  });
  return {
    name: 'test.objects',
    type: 'standard',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: PluginContext) {
      ctx.getService<{ register(m: unknown): unknown }>('manifest').register({
        id: 'test.member-default-feed-grants',
        namespace: 'fdg',
        version: '1.0.0',
        type: 'plugin',
        name: 'Feed grants fixture',
        objects: [
          SysUser,
          SysMember,
          SysOrganization,
          appObject(TICKET, 'Ticket'),
          appObject(VAULT, 'Vault'),
          appObject(QUIET, 'Quiet', { enable: { feeds: false, activities: false } }),
        ],
      });
    },
  };
}

type Row = Record<string, any>;
type Ctx = Record<string, unknown>;
const ids = (rows: Row[]) => rows.map((r) => String(r.id)).sort();

/** The wire answer a refused engine call maps to, as the data door sends it. */
async function refusal(run: () => Promise<unknown>, object: string): Promise<{ status: number; code: string }> {
  let thrown: unknown;
  try {
    await run();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, `the ${object} call was refused`).toBeDefined();
  const wire = mapDataError(thrown, object);
  return { status: wire.status, code: String(wire.body.code) };
}

describe('member_default: comments and activity on the records a member can read', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  /** The kernel logger every plugin context shares — plugin-security's `ctx.logger`. */
  let logger: { warn: (...args: unknown[]) => void };
  /** The registered `security` service: the object the gates resolve on every read. */
  let security: { canReadObject?: unknown };
  const as: Record<string, Ctx> = {};
  const rec: Record<string, string> = {};
  /** Comments seeded as the system, by the record they are about. */
  const seeded: Record<string, string> = {};

  /** The caller's context, as a request assembles it from the session. */
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

  const thread = (object: string, id: string) => `${object}:${id}`;
  const comments = async (ctx: Ctx, where?: Row) => (await ql.find(COMMENT, { ...(where ? { where } : {}), context: ctx } as never)) as Row[];
  const activity = async (ctx: Ctx, where?: Row) => (await ql.find(ACTIVITY, { ...(where ? { where } : {}), context: ctx } as never)) as Row[];
  const post = (ctx: Ctx, threadId: string, body: string) =>
    ql.insert(COMMENT, { thread_id: threadId, body }, { context: ctx } as never) as Promise<Row>;
  const stored = async (object: string, where: Row) => (await ql.find(object, { where, context: SYS } as never)) as Row[];
  /** The stored activity rows about one record. */
  const historyOf = (object: string, id: string) => stored(ACTIVITY, { object_name: object, record_id: id });

  /** Every WARN plugin-security logs as a denial while `run` is in flight. */
  const denialsDuring = async <T>(run: () => Promise<T>): Promise<{ value: T; denials: string[] }> => {
    const spy = vi.spyOn(logger, 'warn');
    try {
      const value = await run();
      return { value, denials: spy.mock.calls.map((args) => String(args[0])).filter((w) => w.includes(DENIAL)) };
    } finally {
      spy.mockRestore();
    }
  };

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(sqliteDriverPlugin());
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(objectsPlugin());
    await kernel.use(new AuditPlugin());
    await kernel.use(
      new SecurityPlugin({
        defaultPermissionSets: [...defaultPermissionSets, APP_SET, PORTAL_SET],
        // The every-member baseline: the app's set composed with `member_default`.
        fallbackPermissionSet: APP_SET.name,
      }),
    );
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');
    security = kernel.getService<{ canReadObject?: unknown }>('security');
    logger = (kernel as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger;

    await ql.insert('sys_organization', { id: ORG, name: 'Help Desk Co', slug: 'help-desk' }, { context: SYS } as never);
    const role: Record<string, string> = { [ALICE]: 'member', [BOB]: 'member', [EVE]: 'external', [EZRA]: 'external' };
    for (const userId of [ALICE, BOB, EVE, EZRA]) {
      await ql.insert(
        'sys_user',
        { id: userId, name: userId, email: `${userId}@help-desk.test`, email_verified: true },
        { context: SYS } as never,
      );
      await ql.insert('sys_member', { user_id: userId, organization_id: ORG, role: role[userId] }, { context: SYS } as never);
    }
    await ql.insert('sys_user_permission_set', { user_id: EVE, permission_set: PORTAL_SET.name }, { context: SYS } as never);

    // The records, written as the system: the CRUD mirror records each create.
    const write = async (object: string, name: string, requester: string) =>
      String((await ql.insert(object, { name, requester_id: requester }, { context: SYS } as never)).id);
    rec.alice = await write(TICKET, "alice's printer", ALICE);
    rec.bob = await write(TICKET, "bob's laptop", BOB);
    rec.eve = await write(TICKET, "eve's delivery", EVE);
    rec.vault = await write(VAULT, 'payroll', BOB);
    rec.quiet = await write(QUIET, 'quiet note', ALICE);
    // Bob, the technician, has answered on every record but the quiet one.
    for (const [key, object] of [['alice', TICKET], ['bob', TICKET], ['eve', TICKET], ['vault', VAULT]] as const) {
      seeded[key] = String(
        (await ql.insert(COMMENT, { thread_id: thread(object, rec[key]), author_id: BOB, body: `on ${key}` }, { context: SYS } as never)).id,
      );
    }

    for (const [name, userId] of [['alice', ALICE], ['bob', BOB], ['eve', EVE], ['ezra', EZRA]] as const) {
      as[name] = await contextOf(userId);
    }
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 30_000);

  it('the fixture is armed: the resolver gives a member the everyone anchor and an external none, and the stores hold what the cases read', async () => {
    expect(as.alice.positions).toEqual(expect.arrayContaining(['org_member', 'everyone']));
    expect(as.eve.positions).toContain('org_external');
    expect(as.eve.positions).not.toContain('everyone');
    expect(as.ezra.positions).not.toContain('everyone');
    // The member reads their own ticket and not bob's: the row scope the gates defer to.
    expect(ids((await ql.find(TICKET, { context: as.alice } as never)) as Row[])).toEqual([rec.alice]);
    // Every record the cases read has history, written by the real mirror —
    // except the quiet one, whose `enable.activities: false` writes none.
    for (const [object, key] of [[TICKET, 'alice'], [TICKET, 'bob'], [TICKET, 'eve'], [VAULT, 'vault']] as const) {
      expect((await historyOf(object, rec[key])).length, `${object} ${key} history`).toBeGreaterThan(0);
    }
    expect(await historyOf(QUIET, rec.quiet)).toEqual([]);
  });

  // ── 1. a record the member can read ─────────────────────────────────────
  describe('1. on a record the member can read', () => {
    it('reads its comments', async () => {
      expect(ids(await comments(as.alice, { thread_id: thread(TICKET, rec.alice) }))).toEqual([seeded.alice]);
    });

    it('posts a comment, stamped as the member', async () => {
      const row = await post(as.alice, thread(TICKET, rec.alice), 'the printer is jammed again');
      const [written] = await stored(COMMENT, { id: String(row.id) });
      expect(written?.author_id).toBe(ALICE);
      expect(ids(await comments(as.alice, { thread_id: thread(TICKET, rec.alice) }))).toContain(String(row.id));
    });

    it('edits the comment they wrote, and not one somebody else wrote', async () => {
      const own = String((await post(as.alice, thread(TICKET, rec.alice), 'first draft')).id);
      await ql.update(COMMENT, { body: 'second draft' }, { where: { id: own }, context: as.alice } as never);
      expect((await stored(COMMENT, { id: own }))[0]?.body).toBe('second draft');

      const theirs = await refusal(
        () => ql.update(COMMENT, { body: 'rewritten' }, { where: { id: seeded.alice }, context: as.alice } as never),
        COMMENT,
      );
      expect(theirs).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
      expect((await stored(COMMENT, { id: seeded.alice }))[0]?.body).toBe('on alice');
    });

    it('reads its activity history', async () => {
      const served = ids(await activity(as.alice, { object_name: TICKET, record_id: rec.alice }));
      expect(served).toEqual(ids(await historyOf(TICKET, rec.alice)));
      expect(served.length).toBeGreaterThan(0);
    });

    it('deletes nothing: the grant carries no delete bit', async () => {
      const own = String((await post(as.alice, thread(TICKET, rec.alice), 'to be kept')).id);
      const answer = await refusal(() => ql.delete(COMMENT, { where: { id: own }, context: as.alice } as never), COMMENT);
      expect(answer).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
      expect((await stored(COMMENT, { id: own })).length).toBe(1);
    });
  });

  // ── 2. records the member cannot read ───────────────────────────────────
  describe('2. on a record the member cannot read', () => {
    const unreadable = () =>
      [
        { what: "another requester's ticket (row scope)", object: TICKET, key: 'bob' },
        { what: 'a record of an object the member does not read', object: VAULT, key: 'vault' },
      ] as const;

    it('a list of every comment serves none of its comments, and its count agrees', async () => {
      const served = ids(await comments(as.alice));
      for (const { what, key } of unreadable()) expect(served, what).not.toContain(seeded[key]);
      expect(served).toContain(seeded.alice);
      expect(await ql.count(COMMENT, {}, { context: as.alice } as never)).toBe(served.length);
    });

    it('a direct read of one of its comments finds nothing', async () => {
      for (const { what, key } of unreadable()) {
        expect(await ql.findOne(COMMENT, { where: { id: seeded[key] }, context: as.alice } as never), what).toBeNull();
      }
    });

    it('a post to its thread is refused, and nothing is written', async () => {
      for (const { what, object, key } of unreadable()) {
        const before = (await stored(COMMENT, { thread_id: thread(object, rec[key]) })).length;
        expect(await refusal(() => post(as.alice, thread(object, rec[key]), 'let me in'), COMMENT), what).toEqual({
          status: 403,
          code: 'RECORD_NOT_ACCESSIBLE',
        });
        expect((await stored(COMMENT, { thread_id: thread(object, rec[key]) })).length, what).toBe(before);
      }
    });

    it('a list of every activity row serves none of its history, and its count agrees', async () => {
      const served = await activity(as.alice);
      for (const { what, object, key } of unreadable()) {
        expect(
          served.filter((r) => r.object_name === object && String(r.record_id) === rec[key]),
          what,
        ).toEqual([]);
      }
      expect(served.some((r) => r.object_name === TICKET && String(r.record_id) === rec.alice)).toBe(true);
      expect(await ql.count(ACTIVITY, {}, { context: as.alice } as never)).toBe(served.length);
    });

    it('a direct read of one of its activity rows finds nothing', async () => {
      for (const { what, object, key } of unreadable()) {
        const [row] = await historyOf(object, rec[key]);
        expect(await ql.findOne(ACTIVITY, { where: { id: String(row.id) }, context: as.alice } as never), what).toBeNull();
      }
    });
  });

  // ── 3. external members ─────────────────────────────────────────────────
  describe('3. an external member', () => {
    it('with only its own baseline: the grant does not reach it — both objects stay refused', async () => {
      expect(await refusal(() => comments(as.ezra), COMMENT)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
      expect(await refusal(() => activity(as.ezra), ACTIVITY)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    });

    it('with an explicit grant: the comments and history of its own ticket only', async () => {
      expect(ids(await comments(as.eve))).toEqual([seeded.eve]);
      for (const key of ['alice', 'bob', 'vault'] as const) {
        expect(await ql.findOne(COMMENT, { where: { id: seeded[key] }, context: as.eve } as never), key).toBeNull();
      }
      const served = await activity(as.eve);
      expect(served.some((r) => r.object_name === TICKET && String(r.record_id) === rec.eve)).toBe(true);
      for (const [object, key] of [[TICKET, 'alice'], [TICKET, 'bob'], [VAULT, 'vault']] as const) {
        expect(served.filter((r) => r.object_name === object && String(r.record_id) === rec[key]), key).toEqual([]);
      }
    });

    it('with an explicit grant: posts on its own ticket, and is refused on a ticket it cannot read', async () => {
      const row = await post(as.eve, thread(TICKET, rec.eve), 'when will it arrive?');
      expect((await stored(COMMENT, { id: String(row.id) }))[0]?.author_id).toBe(EVE);
      const before = (await stored(COMMENT, { thread_id: thread(TICKET, rec.alice) })).length;
      expect(await refusal(() => post(as.eve, thread(TICKET, rec.alice), 'hello?'), COMMENT)).toEqual({
        status: 403,
        code: 'RECORD_NOT_ACCESSIBLE',
      });
      expect((await stored(COMMENT, { thread_id: thread(TICKET, rec.alice) })).length).toBe(before);
    });
  });

  // ── 4. enable.feeds: false ──────────────────────────────────────────────
  describe('4. an object with `enable.feeds: false`, on a record the member reads and edits', () => {
    it('the member reads the record (the refusals below are the switch, not the row scope)', async () => {
      expect(ids((await ql.find(QUIET, { context: as.alice } as never)) as Row[])).toEqual([rec.quiet]);
    });

    it('refuses a comment create: 403 FEEDS_DISABLED, and nothing is written', async () => {
      expect(await refusal(() => post(as.alice, thread(QUIET, rec.quiet), 'psst'), COMMENT)).toEqual({
        status: 403,
        code: 'FEEDS_DISABLED',
      });
      expect(await stored(COMMENT, { thread_id: thread(QUIET, rec.quiet) })).toEqual([]);
    });

    it('refuses re-threading a comment into it: 403 FEEDS_DISABLED, and the comment stays where it was', async () => {
      const own = String((await post(as.alice, thread(TICKET, rec.alice), 'move me')).id);
      expect(
        await refusal(
          () => ql.update(COMMENT, { thread_id: thread(QUIET, rec.quiet) }, { where: { id: own }, context: as.alice } as never),
          COMMENT,
        ),
      ).toEqual({ status: 403, code: 'FEEDS_DISABLED' });
      expect((await stored(COMMENT, { id: own }))[0]?.thread_id).toBe(thread(TICKET, rec.alice));
    });
  });

  // ── 5. the feed read logs no denial per skipped object ──────────────────
  describe('5. the console header feed read logs no access denial for the objects it skips', () => {
    /** `GET /api/v1/data/sys_activity?top=20&sort=-timestamp`: its rows, then its `total`. */
    const headerFeed = async (ctx: Ctx) => ({
      rows: (await ql.find(ACTIVITY, { orderBy: [{ field: 'timestamp', order: 'desc' }], limit: 20, context: ctx } as never)) as Row[],
      total: await ql.count(ACTIVITY, {}, { context: ctx } as never),
    });

    it('armed: a read the member does make of a refused object logs its denial, exactly once', async () => {
      const { denials } = await denialsDuring(() => refusal(() => ql.find(VAULT, { context: as.alice } as never), VAULT));
      expect(denials).toHaveLength(1);
      expect(denials[0]).toContain(VAULT);
    });

    it('armed: without the object-level admission the same read logs one per refused parent', async () => {
      const own = Object.getOwnPropertyDescriptor(security, 'canReadObject');
      expect(own, 'the registered service carries canReadObject as its own member').toBeTruthy();
      delete security.canReadObject;
      try {
        const { denials } = await denialsDuring(() => headerFeed(as.alice));
        expect(denials.some((d) => d.includes(VAULT)), denials.join('\n')).toBe(true);
      } finally {
        Object.defineProperty(security, 'canReadObject', own!);
      }
    });

    it('the member reads the feed with no denial logged, and it serves only rows about records they read', async () => {
      const { value, denials } = await denialsDuring(() => headerFeed(as.alice));
      expect(denials).toEqual([]);
      expect(value.rows.length).toBeGreaterThan(0);
      expect(value.rows.filter((r) => r.object_name === VAULT)).toEqual([]);
      expect(value.total).toBeGreaterThanOrEqual(value.rows.length);
    });
  });
});
