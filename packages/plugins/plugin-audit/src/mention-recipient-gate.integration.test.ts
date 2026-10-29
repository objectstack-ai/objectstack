// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `collab.mention` notification reaches a mentioned user only when that user
 * can READ both the comment it previews and the record it links
 * (`mention-recipient-gate.ts`).
 *
 * ## What is real
 *
 * The kernel, ObjectQL, a real SQLite driver, `AuditPlugin` (its comment write
 * gates, its comment read gate and its mention writer, wired with the real
 * recipient gate), the identity rows (`sys_user`, `sys_member` — the
 * platform's own object definitions) and the grant resolution over them
 * (`resolveUserAuthzGrants`, `vetOrganizationClaim`, `resolveReadableParentIds`
 * from `@objectstack/core`). Every comment is inserted through the engine as
 * its author, so the comment write gates run and the mention writer fires from
 * the real `afterInsert`.
 *
 * ## The three stand-ins
 *
 * - plugin-security's read enforcement on the record object, played by ONE
 *   engine middleware: the ADR-0093 tenant wall (`isolated`: the caller's
 *   active organization; `group`: any organization the caller is a member of;
 *   no organization under a wall: nothing) and an owner-only rule for a
 *   `confidential` row standing in for record sharing. The real pair is
 *   plugin-security's to pin; what is pinned HERE is that the gate asks the
 *   read in the mentioned user's own envelope, with their organization claim
 *   vetted — the stand-in admits whatever envelope it is handed.
 * - plugin-security's object-level read grant on `sys_comment`, played by a
 *   second middleware: a caller whose envelope holds the `comment_reader`
 *   position may read comments, and any other caller's read is refused the way
 *   the real layer refuses it — a throw. It stands in for "the set this
 *   position distributes grants read on comments". ALICE, CAROL and BOB hold
 *   the position, each in their own organization; DAVE, a member of ORG_A like
 *   CAROL, does not — so he reads the open record and not its comments.
 * - the `messaging` service, played by a recorder of `emit()` calls (the
 *   inbox materialisation is service-messaging's to pin).
 *
 * plugin-security also owns the two grant tables the resolver reads beside
 * `sys_member` (`sys_user_position`, `sys_user_permission_set`). They are
 * registered here with the columns the resolver reads. `sys_user_position`
 * carries the `comment_reader` assignments above and nothing else, and
 * `sys_user_permission_set` is left EMPTY, so membership alone decides the
 * wall. Unregistered, the resolver refuses (an unreadable authorization store
 * is an outage, not a denial) and the gate withholds every notification.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectKernel, resolveUserAuthzGrants, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SysMember, SysUser } from '@objectstack/platform-objects/identity';

import { AuditPlugin } from './audit-plugin.js';
import { admitMentionRecipients } from './mention-recipient-gate.js';

const TASK = 'mrg_task';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.mention-gate';
const SYS = { isSystem: true } as const;

const ORG_A = 'org_a';
const ORG_B = 'org_b';
/** The author: a member of ORG_A. */
const ALICE = { id: 'u_alice', email: 'alice@a.test' };
/** A fellow member of ORG_A, who reads every non-confidential task there. */
const CAROL = { id: 'u_carol', email: 'carol@a.test' };
/** A member of ORG_B only. */
const BOB = { id: 'u_bob', email: 'bob@b.test' };
/** A fellow member of ORG_A who reads every non-confidential task there, and holds no read on comments. */
const DAVE = { id: 'u_dave', email: 'dave@a.test' };
/** The position whose holders the comment stand-in lets read comments — assigned through `sys_user_position`. */
const COMMENT_READER_POSITION = 'comment_reader';

type Posture = 'single' | 'isolated' | 'group';
const tenancy: { posture: Posture } = { posture: 'isolated' };

const READ_OPS = new Set(['find', 'findOne', 'count']);

/**
 * plugin-security's read enforcement on TASK, as the module header sets out —
 * composed into the read's WHERE, as the real layers are, so a read that
 * projects only `id` is narrowed exactly like one that reads every column.
 */
function enforcement(context: any): Record<string, unknown> {
  const clauses: Array<Record<string, unknown>> = [];
  const deny = '__no_organization__';
  if (tenancy.posture === 'isolated') clauses.push({ organization_id: context.tenantId ?? deny });
  if (tenancy.posture === 'group') {
    const reach: string[] = context.accessible_org_ids ?? [];
    clauses.push({ organization_id: { $in: reach.length > 0 ? reach : [deny] } });
  }
  clauses.push({ $or: [{ confidential: false }, { owner_id: context.userId ?? deny }] });
  return { $and: clauses };
}

/**
 * plugin-security's object-level read grant on `sys_comment`, as the module
 * header sets out: read off the caller's envelope, refused by a throw.
 */
function assertReadsComments(context: any): void {
  const positions: unknown = context?.positions;
  if (Array.isArray(positions) && positions.includes(COMMENT_READER_POSITION)) return;
  const err: any = new Error('stand-in: no read grant on sys_comment');
  err.code = 'PERMISSION_DENIED';
  err.status = 403;
  throw err;
}

const emits: Array<Record<string, any>> = [];

function standIns(): Plugin {
  return {
    name: 'test.mention-gate-stand-ins',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService('tenancy', {
        get posture() {
          return tenancy.posture;
        },
        defaultOrgId: async () => ORG_A,
      });
      ctx.registerService('messaging', {
        emit: async (event: Record<string, any>) => {
          emits.push(event);
          return {};
        },
      });
    },
  };
}

const authorContext = () => ({
  userId: ALICE.id,
  tenantId: ORG_A,
  positions: ['org_member', COMMENT_READER_POSITION],
  permissions: [],
  accessible_org_ids: [ORG_A],
});

describe('@mention notifications reach only mentioned users who can read the comment and its record', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let openTask: string;
  let confidentialTask: string;
  let seq = 0;

  /** Post a comment on `taskId` as ALICE, mentioning `mentions`; the stored row. */
  const post = async (taskId: string, mentions: unknown[]): Promise<Record<string, any>> => {
    seq += 1;
    return engine.insert(
      'sys_comment',
      { thread_id: `${TASK}:${taskId}`, body: `note ${seq}`, mentions: JSON.stringify(mentions) },
      { context: authorContext() },
    );
  };
  /** Post a comment on `taskId` as ALICE, mentioning `mentions`; the mention emits it produced. */
  const comment = async (taskId: string, mentions: unknown[]) => {
    emits.length = 0;
    await post(taskId, mentions);
    return emits.filter((e) => e.topic === 'collab.mention');
  };
  /** `user`'s own read of the comment `commentId`, in the envelope the request path gives them. */
  const readCommentAs = (user: { id: string }, positions: string[], commentId: string) =>
    engine.find('sys_comment', {
      where: { id: commentId },
      context: { userId: user.id, tenantId: ORG_A, positions, permissions: [], accessible_org_ids: [ORG_A] },
    });
  const audiences = (events: Array<Record<string, any>>) => events.map((e) => e.audience);

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(standIns());
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();

    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    engine.registry.registerObject(SysUser as any, HARNESS_PACKAGE);
    engine.registry.registerObject(SysMember as any, HARNESS_PACKAGE);
    for (const [name, grantColumn] of [['sys_user_position', 'position'], ['sys_user_permission_set', 'permission_set']]) {
      engine.registry.registerObject(
        {
          name,
          label: name,
          fields: {
            user_id: { name: 'user_id', label: 'User', type: 'text' },
            organization_id: { name: 'organization_id', label: 'Organization', type: 'text' },
            [grantColumn]: { name: grantColumn, label: grantColumn, type: 'text' },
          },
        } as any,
        HARNESS_PACKAGE,
      );
    }
    engine.registry.registerObject(
      {
        name: TASK,
        label: 'Task',
        fields: {
          name: { name: 'name', label: 'Name', type: 'text' },
          organization_id: { name: 'organization_id', label: 'Organization', type: 'text' },
          owner_id: { name: 'owner_id', label: 'Owner', type: 'text' },
          confidential: { name: 'confidential', label: 'Confidential', type: 'boolean' },
        },
      } as any,
      HARNESS_PACKAGE,
    );
    await engine.syncSchemas();

    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      if (READ_OPS.has(op.operation) && op.ast && !op.context?.isSystem) {
        const narrowing = enforcement(op.context ?? {});
        op.ast.where = op.ast.where ? { $and: [op.ast.where, narrowing] } : narrowing;
      }
      return next();
    }, { object: TASK });
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      if (READ_OPS.has(op.operation) && op.ast && !op.context?.isSystem) assertReadsComments(op.context);
      return next();
    }, { object: 'sys_comment' });

    for (const u of [ALICE, CAROL, BOB, DAVE]) {
      await engine.insert('sys_user', { id: u.id, name: u.id, email: u.email }, { context: SYS });
    }
    for (const [user, org] of [[ALICE, ORG_A], [CAROL, ORG_A], [BOB, ORG_B], [DAVE, ORG_A]] as const) {
      await engine.insert('sys_member', { user_id: user.id, organization_id: org, role: 'member' }, { context: SYS });
    }
    for (const [user, org] of [[ALICE, ORG_A], [CAROL, ORG_A], [BOB, ORG_B]] as const) {
      await engine.insert(
        'sys_user_position',
        { user_id: user.id, organization_id: org, position: COMMENT_READER_POSITION },
        { context: SYS },
      );
    }
    openTask = (await engine.insert(TASK, { name: 'open', organization_id: ORG_A, owner_id: ALICE.id, confidential: false }, { context: SYS })).id;
    confidentialTask = (
      await engine.insert(TASK, { name: 'confidential', organization_id: ORG_A, owner_id: ALICE.id, confidential: true }, { context: SYS })
    ).id;
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  beforeEach(() => {
    tenancy.posture = 'isolated';
  });

  describe('isolated', () => {
    it('control: the other organization\'s user cannot read the record, the fellow member can', async () => {
      const asBob = await engine.find(TASK, { where: { id: openTask }, context: { userId: BOB.id, tenantId: ORG_B } });
      const asCarol = await engine.find(TASK, { where: { id: openTask }, context: { userId: CAROL.id, tenantId: ORG_A } });
      expect(asBob).toEqual([]);
      expect(asCarol.map((r: any) => r.id)).toEqual([openTask]);
    });

    it('withholds the notification from a user of another organization mentioned by id', async () => {
      expect(audiences(await comment(openTask, [BOB.id]))).toEqual([]);
    });

    it('withholds the notification from a user of another organization mentioned by email', async () => {
      expect(audiences(await comment(openTask, [BOB.email]))).toEqual([]);
    });

    it('notifies a fellow member who can read the record, with the record as the deep link', async () => {
      const events = await comment(openTask, [CAROL.id, BOB.id]);
      expect(audiences(events)).toEqual([[CAROL.id]]);
      expect(events[0]).toMatchObject({
        source: { object: TASK, id: openTask },
        organizationId: ORG_A,
        payload: { body: `note ${seq}` },
      });
    });

    it('resolves a fellow member mentioned by email to their user id', async () => {
      expect(audiences(await comment(openTask, [CAROL.email]))).toEqual([[CAROL.id]]);
    });

    it('resolves an email mention whatever its casing, the way sign-in finds the user', async () => {
      // The stored address is the lowercased one identity writes; sign-in
      // looks it up lowercased, and so must a mention.
      expect(audiences(await comment(openTask, ['Carol@A.Test']))).toEqual([[CAROL.id]]);
      expect(audiences(await comment(openTask, [` ${CAROL.email.toUpperCase()} `]))).toEqual([[CAROL.id]]);
    });

    it('never notifies the author, by id or by email', async () => {
      expect(audiences(await comment(openTask, [ALICE.id, ALICE.email]))).toEqual([]);
    });

    it('treats an audience expansion as no mention at all', async () => {
      expect(audiences(await comment(openTask, ['role:member', `team:t1`, `owner_of:${TASK}:${openTask}`]))).toEqual([]);
    });
  });

  describe('group', () => {
    it('withholds from a non-member of the record\'s organization and notifies a member', async () => {
      tenancy.posture = 'group';
      expect(audiences(await comment(openTask, [BOB.id, BOB.email, CAROL.id]))).toEqual([[CAROL.id]]);
    });
  });

  describe('single', () => {
    it('withholds from a fellow member the record\'s own sharing excludes', async () => {
      tenancy.posture = 'single';
      const asCarol = await engine.find(TASK, { where: { id: confidentialTask }, context: { userId: CAROL.id, tenantId: ORG_A } });
      expect(asCarol).toEqual([]);
      expect(audiences(await comment(confidentialTask, [CAROL.id]))).toEqual([]);
      expect(audiences(await comment(openTask, [CAROL.id]))).toEqual([[CAROL.id]]);
    });
  });

  describe('the comment itself must be readable, not only its record', () => {
    it('control: the resolver projects the comment grant to CAROL and not to DAVE; both read the record, only CAROL its comment', async () => {
      const carol = await resolveUserAuthzGrants(engine, CAROL.id, { tenantId: ORG_A });
      const dave = await resolveUserAuthzGrants(engine, DAVE.id, { tenantId: ORG_A });
      expect(carol.positions).toContain(COMMENT_READER_POSITION);
      expect(dave.positions).not.toContain(COMMENT_READER_POSITION);

      const asDave = await engine.find(TASK, { where: { id: openTask }, context: { userId: DAVE.id, tenantId: ORG_A } });
      expect(asDave.map((r: any) => r.id)).toEqual([openTask]);

      const row = await post(openTask, []);
      expect((await readCommentAs(CAROL, carol.positions, String(row.id))).map((r: any) => r.id)).toEqual([row.id]);
      await expect(readCommentAs(DAVE, dave.positions, String(row.id))).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
        status: 403,
      });
    });

    it('withholds the notification from a mentioned user who may read the record but not the comment, by id or by email', async () => {
      expect(audiences(await comment(openTask, [DAVE.id]))).toEqual([]);
      expect(audiences(await comment(openTask, [DAVE.email]))).toEqual([]);
    });

    it('notifies the mentioned user who may read both, and never the author', async () => {
      const events = await comment(openTask, [DAVE.id, CAROL.id, ALICE.id]);
      expect(audiences(events)).toEqual([[CAROL.id]]);
      expect(events[0]).toMatchObject({ source: { object: TASK, id: openTask }, payload: { body: `note ${seq}` } });
    });

    it('holds under the single posture as under a wall', async () => {
      tenancy.posture = 'single';
      expect(audiences(await comment(openTask, [DAVE.id, DAVE.email, CAROL.id]))).toEqual([[CAROL.id]]);
    });
  });

  describe('the withheld-recipient log', () => {
    const gate = (warned: Array<{ message: string; meta?: Record<string, unknown> }>) => ({
      engine: engine as any,
      getTenancyPosture: () => 'isolated' as const,
      logger: { warn: (message: string, meta?: Record<string, unknown>) => warned.push({ message, meta }) },
    });

    it('logs each withheld recipient with the user id and the reason, never the comment text', async () => {
      const row = await post(openTask, []);
      const commentId = String(row.id);
      const warned: Array<{ message: string; meta?: Record<string, unknown> }> = [];
      const admitted = await admitMentionRecipients(gate(warned), {
        mentions: [BOB.id, DAVE.id, CAROL.id, 'nobody@nowhere.test'],
        threadId: `${TASK}:${openTask}`,
        actorId: ALICE.id,
        organizationId: ORG_A,
        commentId,
      });
      expect(admitted).toEqual([CAROL.id]);
      expect(warned.map((w) => w.meta)).toEqual([
        { reason: 'unknown_email', commentId },
        { reason: 'cannot_read_source', userId: BOB.id, commentId },
        { reason: 'cannot_read_thread', userId: DAVE.id, commentId },
      ]);
      expect(JSON.stringify(warned)).not.toContain(String(row.body));
    });

    it('logs no unknown_email for a differently-cased address of a stored user', async () => {
      const commentId = String((await post(openTask, [])).id);
      const warned: Array<{ message: string; meta?: Record<string, unknown> }> = [];
      const admitted = await admitMentionRecipients(gate(warned), {
        mentions: ['CAROL@A.TEST'],
        threadId: `${TASK}:${openTask}`,
        actorId: ALICE.id,
        organizationId: ORG_A,
        commentId,
      });
      expect(admitted).toEqual([CAROL.id]);
      expect(warned).toEqual([]);
    });

    it('withholds every recipient when the comment cannot be read back by its id', async () => {
      const warned: Array<{ message: string; meta?: Record<string, unknown> }> = [];
      const input = { mentions: [CAROL.id], threadId: `${TASK}:${openTask}`, actorId: ALICE.id, organizationId: ORG_A };
      expect(await admitMentionRecipients(gate(warned), input)).toEqual([]);
      expect(await admitMentionRecipients(gate(warned), { ...input, commentId: 'cmt_never_written' })).toEqual([]);
      expect(warned.map((w) => w.meta)).toEqual([
        { reason: 'no_comment_id', userId: CAROL.id },
        { reason: 'cannot_read_thread', userId: CAROL.id, commentId: 'cmt_never_written' },
      ]);
    });
  });
});
