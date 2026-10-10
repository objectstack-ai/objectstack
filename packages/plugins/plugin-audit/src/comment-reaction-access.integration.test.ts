// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_comment_reaction` on the plugin's real read and write paths (#22566,
 * ruling A amended on #22505).
 *
 * A reaction is one (comment, emoji, user) row, the reactor's own record. This
 * file pins the half of its contract this plugin owns:
 *
 *  - READ: a reaction is readable exactly when its comment is — for every
 *    caller, the set of comments its readable reactions point at equals the
 *    set of reacted comments it can read, on `find`, `count`, `findOne` and
 *    `aggregate`;
 *  - CREATE: a member reacts to another member's comment it can read, and is
 *    refused on one it cannot (or one that does not exist), with `user_id`
 *    stamped from the session and `created_by` — the key of the platform's
 *    own-record delete floor — carrying the same reactor;
 *  - UNIQUENESS: two members reacting at once keep two rows; the same
 *    (comment, emoji, user) twice is refused by the declared index and reaches
 *    the data door as `409 UNIQUE_VIOLATION`;
 *  - a deleted comment does not take its author's delete down with it, and its
 *    reactions are read by nobody.
 *
 * The delete half — a member removes their own reaction and not another
 * member's — is the platform's own-record floor, and is pinned where that
 * floor lives (plugin-security, `comment-reaction-own-record-floor.test.ts`).
 *
 * ## Why a real engine, a real driver and the real plugin
 *
 * The read rule is a WHERE the gate ANDs into the caller's query, built from a
 * caller-scoped read of `sys_comment` that itself runs the comment's thread
 * gate. Whether that composition selects the right rows is a question about
 * the engine's middleware chain and the Filter Protocol as a driver runs it,
 * so both are real here, and the gates are mounted by `AuditPlugin` itself.
 *
 * ## The one stand-in
 *
 * PARENT-RECORD READABILITY, exactly as in `activity-read-visibility.integration.test.ts`:
 * one engine middleware on the owned parent object plays the part the
 * parent's own sharing, RLS and object-level CRUD play in a deployment — a
 * member reads the ledger rows it owns, the admin reads them all. The comment
 * gate asks the engine under the caller's context, so it cannot tell the
 * stand-in from plugin-security.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { mapDataError } from '@objectstack/types';

import { AuditPlugin } from './audit-plugin.js';

const COMMENT = 'sys_comment';
const REACTION = 'sys_comment_reaction';
/** A parent object whose rows each caller reads only when it owns them. */
const OWNED = 'rx_ledger';
/** A parent object every caller reads. */
const OPEN = 'rx_board';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.comment-reaction';

const SYS = { isSystem: true } as const;
const MEMBER = { userId: 'u_member', positions: ['org_member'] };
const OTHER = { userId: 'u_other', positions: ['org_member'] };
const ADMIN = { userId: 'u_admin', positions: ['org_admin'] };
/** A session that names no user: nobody to record as the one reacting. */
const NO_USER = { positions: ['org_member'] };

const ownedObject = {
  name: OWNED,
  label: 'Ledger',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    owner: { name: 'owner', label: 'Owner', type: 'text' as const },
  },
};
const openObject = {
  name: OPEN,
  label: 'Board',
  fields: { name: { name: 'name', label: 'Name', type: 'text' as const } },
};

const READ_OPS = new Set(['find', 'findOne', 'count', 'aggregate']);

/** `sys_comment` reads issued under a caller (non-system) context. */
const commentProbes: Array<{ operation: string; userId?: string }> = [];

type Row = Record<string, any>;
type Caller = typeof MEMBER;

interface Outcome { ok: boolean; code?: string; status?: number; error?: unknown }
const attempt = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try {
    await run();
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; status?: number; statusCode?: number };
    return { ok: false, code: err.code, status: err.status ?? err.statusCode, error: e };
  }
};

describe('sys_comment_reaction — the plugin read and write paths', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  const ids: Record<string, string> = {};
  const comments: Record<string, string> = {};

  const react = (caller: Caller | typeof NO_USER, commentId: unknown, emoji: string, extra: Row = {}) =>
    engine.insert(REACTION, { comment_id: commentId, emoji, ...extra }, { context: caller } as any);
  const readableCommentIds = async (caller: Caller): Promise<string[]> =>
    (await engine.find(COMMENT, { context: caller } as any)).map((r: Row) => String(r.id)).sort();
  const allReactions = async (): Promise<Row[]> => engine.find(REACTION, { context: SYS } as any);

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();

    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    engine.registry.registerObject(ownedObject as any, HARNESS_PACKAGE);
    engine.registry.registerObject(openObject as any, HARNESS_PACKAGE);
    await engine.syncSchemas();

    // Parent readability: a non-admin caller reads the ledger rows it owns.
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      if (READ_OPS.has(op.operation) && op.context && !op.context.isSystem && op.ast) {
        if (op.context.userId !== ADMIN.userId) {
          const mine = { owner: op.context.userId ?? '__nobody__' };
          op.ast.where = op.ast.where ? { $and: [op.ast.where, mine] } : mine;
        }
      }
      return next();
    }, { object: OWNED });
    // Registered after AuditPlugin's gate, so it observes the caller-scoped
    // comment reads the reaction gate issues.
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      if (READ_OPS.has(op.operation) && op.context && !op.context.isSystem) {
        commentProbes.push({ operation: op.operation, userId: op.context.userId });
      }
      return next();
    }, { object: COMMENT });

    ids.mine = (await engine.insert(OWNED, { name: 'mine', owner: MEMBER.userId }, { context: SYS })).id;
    ids.theirs = (await engine.insert(OWNED, { name: 'theirs', owner: OTHER.userId }, { context: SYS })).id;
    ids.board = (await engine.insert(OPEN, { name: 'board' }, { context: SYS })).id;

    const post = async (threadId: string, author: string, body: string) =>
      String((await engine.insert(COMMENT, { thread_id: threadId, author_id: author, body }, { context: SYS })).id);
    // The member's own record, another member's record, and a shared board —
    // the board comment is the OTHER member's, so a reaction on it is a
    // reaction on someone else's comment.
    comments.onMine = await post(`${OWNED}:${ids.mine}`, MEMBER.userId, 'on the member ledger');
    comments.onTheirs = await post(`${OWNED}:${ids.theirs}`, OTHER.userId, 'on the other ledger');
    comments.onBoard = await post(`${OPEN}:${ids.board}`, OTHER.userId, 'on the board');
    comments.unreacted = await post(`${OPEN}:${ids.board}`, OTHER.userId, 'nobody reacts here');

    // Reactions made through the gate, by the members themselves.
    await react(MEMBER, comments.onBoard, '👍');
    await react(MEMBER, comments.onMine, '🎉');
    await react(OTHER, comments.onBoard, '👍');
    await react(OTHER, comments.onTheirs, '❤️');
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 30_000);

  it('control: the comment gate answers each member exactly the comments it can read', async () => {
    expect(await readableCommentIds(MEMBER)).toEqual([comments.onMine, comments.onBoard, comments.unreacted].sort());
    expect(await readableCommentIds(OTHER)).toEqual([comments.onTheirs, comments.onBoard, comments.unreacted].sort());
  });

  describe('create', () => {
    it('a member reacts to ANOTHER member’s comment, and the row is theirs', async () => {
      const rows = (await allReactions()).filter((r) => r.comment_id === comments.onBoard);
      expect(rows.map((r) => r.user_id).sort()).toEqual([MEMBER.userId, OTHER.userId]);
      // The board comment's author is OTHER; MEMBER's row records MEMBER.
      const mine = rows.find((r) => r.user_id === MEMBER.userId)!;
      // `created_by` is the column the platform's own-record delete floor
      // keys on — it carries the same reactor, so the floor sees the
      // reaction as the reactor's own.
      expect(mine.created_by).toBe(MEMBER.userId);
    });

    it('user_id is stamped from the session — a client-supplied value never wins', async () => {
      const created = await react(MEMBER, comments.onBoard, '😂', { user_id: OTHER.userId });
      const row = await engine.findOne(REACTION, { where: { id: created.id }, context: SYS } as any);
      expect(row?.user_id).toBe(MEMBER.userId);
      expect(row?.created_by).toBe(MEMBER.userId);
      await engine.delete(REACTION, { where: { id: created.id }, context: SYS } as any);
    });

    it('a comment the member cannot read is refused, on the envelope, and nothing is written', async () => {
      const before = (await allReactions()).length;
      const outcome = await attempt(() => react(MEMBER, comments.onTheirs, '👍'));
      expect(outcome).toMatchObject({ ok: false, code: 'RECORD_NOT_ACCESSIBLE', status: 403 });
      expect((await allReactions()).length).toBe(before);
    });

    it('a comment that does not exist is refused the same way (existence is not disclosed)', async () => {
      const outcome = await attempt(() => react(MEMBER, 'cmt_does_not_exist', '👍'));
      expect(outcome).toMatchObject({ ok: false, code: 'RECORD_NOT_ACCESSIBLE', status: 403 });
    });

    it('a reaction naming no comment is refused', async () => {
      for (const missing of [undefined, '']) {
        const outcome = await attempt(() => react(MEMBER, missing, '👍'));
        expect(outcome).toMatchObject({ ok: false, code: 'RECORD_NOT_ACCESSIBLE', status: 403 });
      }
    });

    it('a session with no user is refused rather than recorded under a client-supplied id', async () => {
      const outcome = await attempt(() => react(NO_USER, comments.onBoard, '😮', { user_id: OTHER.userId }));
      expect(outcome).toMatchObject({ ok: false, code: 'RECORD_NOT_ACCESSIBLE', status: 403 });
      const forged = (await allReactions()).filter((r) => r.emoji === '😮');
      expect(forged).toEqual([]);
    });
  });

  describe('read: a reaction is readable exactly when its comment is', () => {
    it.each([
      ['MEMBER', MEMBER],
      ['OTHER', OTHER],
      ['ADMIN', ADMIN],
    ] as const)('%s: the comments its reactions point at are the reacted comments it can read', async (_n, caller) => {
      const reacted = new Set((await allReactions()).map((r) => String(r.comment_id)));
      const readable = (await readableCommentIds(caller)).filter((id) => reacted.has(id));
      const seen = [...new Set((await engine.find(REACTION, { context: caller } as any)).map((r: Row) => String(r.comment_id)))];
      expect(seen.sort()).toEqual(readable.sort());
      expect(seen.length).toBeGreaterThan(0);
    });

    it('find: a member reads the reactions on its readable comments, and not on another member’s ledger', async () => {
      const rows = await engine.find(REACTION, { context: MEMBER } as any);
      expect(rows.map((r: Row) => `${r.comment_id}:${r.user_id}:${r.emoji}`).sort()).toEqual(
        [
          `${comments.onBoard}:${MEMBER.userId}:👍`,
          `${comments.onBoard}:${OTHER.userId}:👍`,
          `${comments.onMine}:${MEMBER.userId}:🎉`,
        ].sort(),
      );
    });

    it('count: the total is narrowed identically to the rows', async () => {
      expect(await engine.count(REACTION, {}, { context: MEMBER } as any)).toBe(3);
      expect(await engine.count(REACTION, {}, { context: OTHER } as any)).toBe(3);
    });

    it('findOne: a reaction on an unreadable comment is absent by id', async () => {
      const hidden = (await allReactions()).find((r) => r.comment_id === comments.onTheirs)!;
      const shown = (await allReactions()).find((r) => r.comment_id === comments.onMine)!;
      expect(await engine.findOne(REACTION, { where: { id: hidden.id }, context: MEMBER } as any)).toBeNull();
      expect((await engine.findOne(REACTION, { where: { id: shown.id }, context: MEMBER } as any))?.id).toBe(shown.id);
    });

    it('aggregate: a grouped count sees only the readable rows', async () => {
      const groups = await engine.aggregate(
        REACTION,
        { groupBy: ['comment_id'], aggregations: [{ function: 'count', alias: 'n' }], context: MEMBER } as any,
      );
      const byComment = Object.fromEntries(groups.map((g: Row) => [String(g.comment_id), Number(g.n)]));
      expect(byComment).toEqual({ [comments.onBoard]: 2, [comments.onMine]: 1 });
    });

    it('the reader’s one batched read: comment_id $in the feed, grouped client-side, one comment probe', async () => {
      commentProbes.length = 0;
      const feed = [comments.onMine, comments.onTheirs, comments.onBoard, comments.unreacted];
      const rows = await engine.find(REACTION, { where: { comment_id: { $in: feed } }, context: MEMBER } as any);
      const grouped: Record<string, Record<string, string[]>> = {};
      for (const r of rows) {
        ((grouped[r.comment_id] ??= {})[r.emoji] ??= []).push(r.user_id);
      }
      for (const byEmoji of Object.values(grouped)) for (const users of Object.values(byEmoji)) users.sort();
      expect(grouped).toEqual({
        [comments.onBoard]: { '👍': [MEMBER.userId, OTHER.userId].sort() },
        [comments.onMine]: { '🎉': [MEMBER.userId] },
      });
      // One caller-scoped read of the comments per reaction read — never one
      // per row.
      expect(commentProbes.filter((p) => p.userId === MEMBER.userId)).toEqual([{ operation: 'find', userId: MEMBER.userId }]);
    });

    it('a query scoped to a comment the member cannot read returns nothing', async () => {
      const rows = await engine.find(REACTION, { where: { comment_id: comments.onTheirs }, context: MEMBER } as any);
      expect(rows).toEqual([]);
    });

    it('a system read is not narrowed', async () => {
      const rows = await engine.find(REACTION, { context: SYS } as any);
      expect(rows.map((r: Row) => r.comment_id)).toEqual(expect.arrayContaining([comments.onTheirs, comments.onMine]));
    });
  });

  describe('uniqueness and concurrency', () => {
    it('two members reacting at once keep two rows', async () => {
      await Promise.all([react(MEMBER, comments.unreacted, '🎉'), react(OTHER, comments.unreacted, '🎉')]);
      const rows = (await allReactions()).filter((r) => r.comment_id === comments.unreacted);
      expect(rows.map((r) => `${r.user_id}:${r.emoji}`).sort()).toEqual([`${MEMBER.userId}:🎉`, `${OTHER.userId}:🎉`].sort());
    });

    it('the same (comment, emoji, user) twice is one row; the second is refused as 409 UNIQUE_VIOLATION', async () => {
      const outcome = await attempt(() => react(MEMBER, comments.onBoard, '👍'));
      expect(outcome).toMatchObject({ ok: false, code: 'DUPLICATE_RECORD', status: 409 });
      // …which the data door answers on the wire as the standard conflict.
      const wire = mapDataError(outcome.error, REACTION);
      expect(wire.status).toBe(409);
      expect(wire.body.code).toBe('UNIQUE_VIOLATION');
      const rows = (await allReactions()).filter(
        (r) => r.comment_id === comments.onBoard && r.user_id === MEMBER.userId && r.emoji === '👍',
      );
      expect(rows).toHaveLength(1);
    });

    it('a different emoji from the same member is a second row', async () => {
      const created = await react(MEMBER, comments.onBoard, '❤️');
      expect(created.id).toBeTruthy();
      await engine.delete(REACTION, { where: { id: created.id }, context: SYS } as any);
    });
  });

  describe('a deleted comment', () => {
    it('does not block its author’s delete, and its reactions are read by nobody but the system', async () => {
      const doomed = String(
        (await engine.insert(COMMENT, { thread_id: `${OPEN}:${ids.board}`, author_id: OTHER.userId, body: 'doomed' }, { context: SYS })).id,
      );
      await react(MEMBER, doomed, '👍');
      // The comment's author deletes it: the gate admits its own author, and a
      // reaction is not a reference that restricts or cascades.
      const deleted = await attempt(() => engine.delete(COMMENT, { where: { id: doomed }, context: OTHER } as any));
      expect(deleted).toMatchObject({ ok: true });
      for (const caller of [MEMBER, OTHER, ADMIN]) {
        const rows = await engine.find(REACTION, { where: { comment_id: doomed }, context: caller } as any);
        expect(rows, caller.userId).toEqual([]);
      }
      expect((await engine.find(REACTION, { where: { comment_id: doomed }, context: SYS } as any)).length).toBe(1);
    });
  });
});
