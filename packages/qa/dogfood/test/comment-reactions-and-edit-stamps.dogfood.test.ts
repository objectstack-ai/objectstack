// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Checklist item `records-forms.comment-reactions-and-edit-stamps` (#26573):
// its three api clauses pinned at the REST data door of a booted stack — the
// layer their oracle names. The plugin-audit / plugin-security pins in the
// item's `automated.ref` drive the engine (or an ObjectKernel with no HTTP
// adapter), so they are evidence of their own layer, never these clauses'
// pass (RUNNER rule 6).
//
//   acceptance[1] — a reaction answers 201 with `user_id` forced to the
//     caller; a duplicate → 409 UNIQUE_VIOLATION; a reaction on a comment the
//     caller cannot read → 403 RECORD_NOT_ACCESSIBLE; update and deleting
//     another member's reaction are refused.
//   acceptance[2] — `sys_comment.reactions` on a write or a filter → 400
//     INVALID_FIELD, and the key is absent from reads.
//   acceptance[3] — a body edit sets `is_edited: true` and a server
//     `edited_at`; the client-sent values are dropped.
//
// ## The fixture
//
// The comments permission-matrix fixture (`fixtures/comments-fixture.ts`) with
// plugin-audit, org-bound: an org-bound sign-up holds `org_member`, which is
// the position the platform's own-record delete floor (`owner_only_deletes`)
// applies to — org-less, a refused foreign delete would measure nothing
// (`armed.ts`, `principalArmed`). The member also holds `rx_reactor`, the
// delete bit on `sys_comment_reaction` an app ships (the every-member baseline
// carries no delete, ADR-0090 D5), so the foreign-delete refusal is the floor
// and not a missing object bit; deleting the member's own reaction is the
// control that proves it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { commentsFixtureStack, cmtFixtureBaselineSet, commentManagerSet } from './fixtures/comments-fixture.js';
import { armedWhen, assertArmed, principalArmed, resolveAuthzFor } from './armed.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

const SYS = { isSystem: true } as const;
const REACTION = 'sys_comment_reaction';

const reactorSet = PermissionSetSchema.parse({
  name: 'rx_reactor',
  label: 'Reactions fixture — reactor',
  objects: {
    [REACTION]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
});

const FLOOR = "the platform's own-record DELETE floor (`owner_only_deletes`, positions ['org_member'])";
const FLOOR_DISARM =
  'an org-less harness: a sign-up holds only `everyone`, the floor never applies, and a refused ' +
  "foreign delete would be some other refusal. `orgContext: true` arms it.";

type Answer = { status: number; json: any };

describe('records-forms.comment-reactions-and-edit-stamps — over the REST data door', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok = '';
  let memberTok = '';
  let adminId = '';
  let memberId = '';
  let commentId = '';
  let privateCommentId = '';

  const call = async (token: string, method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const uid = async (email: string) => String((await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id);
  const reactionRows = (where: Record<string, unknown>) => ql.find(REACTION, { where, context: SYS });

  beforeAll(async () => {
    stack = await bootStack(commentsFixtureStack as never, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, cmtFixtureBaselineSet, commentManagerSet, reactorSet],
        fallbackPermissionSet: cmtFixtureBaselineSet.name,
      }),
      extraPlugins: [new AuditPlugin()],
      orgContext: true,
    });
    adminTok = await stack.signIn();
    memberTok = await stack.signUp('rx-member@verify.test');
    ql = await stack.kernel.getServiceAsync('objectql');
    adminId = await uid('admin@objectos.ai');
    memberId = await uid('rx-member@verify.test');

    expect(await catalogPermissionSet(ql, reactorSet.name), 'fixture set served by the security catalog').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: memberId, permission_set: reactorSet.name }, { context: SYS });
    await assertArmed([
      principalArmed({
        stack, token: memberTok, who: 'the reacting member', positions: ['org_member'],
        permissions: [reactorSet.name], control: FLOOR, disarmedBy: FLOOR_DISARM,
      }),
    ]);

    // A record both read (public_read_write), with one comment by the admin.
    const open = await call(adminTok, 'POST', '/data/cmt_open', { name: 'reactions record' });
    expect(open.status, JSON.stringify(open.json)).toBeLessThan(300);
    const openId = String(open.json.id ?? open.json.record?.id);
    const posted = await call(adminTok, 'POST', '/data/sys_comment', { thread_id: `cmt_open:${openId}`, body: 'admin comment' });
    expect(posted.status, JSON.stringify(posted.json)).toBeLessThan(300);
    commentId = String((await ql.findOne('sys_comment', { where: { thread_id: `cmt_open:${openId}` }, context: SYS })).id);

    // A comment on a record the member cannot read (cmt_private, owner-only).
    const privateId = String((await ql.insert('cmt_private', { name: 'admin only', owner_id: adminId }, { context: SYS })).id);
    const privatePost = await call(adminTok, 'POST', '/data/sys_comment', { thread_id: `cmt_private:${privateId}`, body: 'private comment' });
    expect(privatePost.status, JSON.stringify(privatePost.json)).toBeLessThan(300);
    privateCommentId = String((await ql.findOne('sys_comment', { where: { thread_id: `cmt_private:${privateId}` }, context: SYS })).id);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[1]: a reaction answers 201 with user_id forced to the caller, and a duplicate is 409 UNIQUE_VIOLATION', async () => {
    const created = await call(memberTok, 'POST', `/data/${REACTION}`, { comment_id: commentId, emoji: '👍', user_id: adminId });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const rows = await reactionRows({ comment_id: commentId, emoji: '👍' });
    expect(rows.map((r: any) => r.user_id)).toEqual([memberId]);

    const again = await call(memberTok, 'POST', `/data/${REACTION}`, { comment_id: commentId, emoji: '👍' });
    expect(again.status, JSON.stringify(again.json)).toBe(409);
    expect(again.json.code).toBe('UNIQUE_VIOLATION');
    expect(await reactionRows({ comment_id: commentId, emoji: '👍' })).toHaveLength(1);
  });

  it('acceptance[1]: a reaction on a comment the caller cannot read is 403 RECORD_NOT_ACCESSIBLE, and nothing is stored', async () => {
    const denied = await call(memberTok, 'POST', `/data/${REACTION}`, { comment_id: privateCommentId, emoji: '🎉' });
    expect(denied.status, JSON.stringify(denied.json)).toBe(403);
    expect(denied.json.code).toBe('RECORD_NOT_ACCESSIBLE');
    expect(await reactionRows({ comment_id: privateCommentId })).toHaveLength(0);
  });

  it('acceptance[1]: a reaction is never updated, and another member\'s reaction is never deleted — the own delete is the control', async () => {
    const mine = await call(memberTok, 'POST', `/data/${REACTION}`, { comment_id: commentId, emoji: '🚀' });
    expect(mine.status, JSON.stringify(mine.json)).toBe(201);
    const mineId = String((await reactionRows({ comment_id: commentId, emoji: '🚀' }))[0].id);
    const theirs = await call(adminTok, 'POST', `/data/${REACTION}`, { comment_id: commentId, emoji: '❤️' });
    expect(theirs.status, JSON.stringify(theirs.json)).toBe(201);
    const theirsId = String((await reactionRows({ comment_id: commentId, emoji: '❤️' }))[0].id);

    const patched = await call(memberTok, 'PATCH', `/data/${REACTION}/${mineId}`, { emoji: '🔥' });
    // The object offers no `update` (apiMethods), so the door refuses before any row is read.
    expect(patched.status, JSON.stringify(patched.json)).toBe(405);
    expect(patched.json.code).toBe('OBJECT_API_METHOD_NOT_ALLOWED');
    expect((await reactionRows({ id: mineId }))[0].emoji).toBe('🚀');

    // The own-record floor, not a missing bit: the member holds delete on the object (rx_reactor).
    const foreign = await call(memberTok, 'DELETE', `/data/${REACTION}/${theirsId}`);
    expect(foreign.status, JSON.stringify(foreign.json)).toBe(403);
    expect(foreign.json.code).toBe('PERMISSION_DENIED');
    expect(await reactionRows({ id: theirsId })).toHaveLength(1);

    const own = await call(memberTok, 'DELETE', `/data/${REACTION}/${mineId}`);
    expect(own.status, JSON.stringify(own.json)).toBeLessThan(300);
    expect(await reactionRows({ id: mineId })).toHaveLength(0);
  });

  it('acceptance[2]: sys_comment.reactions on a write or a filter is 400 INVALID_FIELD, and reads carry no such key', async () => {
    const write = await call(adminTok, 'PATCH', `/data/sys_comment/${commentId}`, { reactions: [{ emoji: '👍', user_id: adminId }] });
    expect(write.status, JSON.stringify(write.json)).toBe(400);
    expect(write.json.code).toBe('INVALID_FIELD');

    const filter = encodeURIComponent(JSON.stringify(['reactions', '=', 'x']));
    const filtered = await call(adminTok, 'GET', `/data/sys_comment?$filter=${filter}`);
    expect(filtered.status, JSON.stringify(filtered.json)).toBe(400);
    expect(filtered.json.code).toBe('INVALID_FIELD');

    const read = await call(adminTok, 'GET', `/data/sys_comment/${commentId}`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    const record = read.json.record ?? read.json;
    expect(record.id).toBe(commentId);
    expect(Object.keys(record)).not.toContain('reactions');
  });

  it('acceptance[3]: a body edit is platform-stamped — is_edited true, a server edited_at — and the client-sent values are dropped', async () => {
    const before = await ql.findOne('sys_comment', { where: { id: commentId }, context: SYS });
    expect(before.is_edited).toBeFalsy();
    const edited = await call(adminTok, 'PATCH', `/data/sys_comment/${commentId}`, {
      body: 'admin comment, edited', is_edited: false, edited_at: '2000-01-01T00:00:00.000Z',
    });
    expect(edited.status, JSON.stringify(edited.json)).toBe(200);
    const after = await ql.findOne('sys_comment', { where: { id: commentId }, context: SYS });
    expect(after.body).toBe('admin comment, edited');
    expect(Boolean(after.is_edited)).toBe(true);
    expect(after.edited_at).toBeTruthy();
    expect(new Date(after.edited_at).getUTCFullYear()).toBeGreaterThan(2000);
  });
});

// ── A stock member reacts by default (#33584) ───────────────────────────────
//
// Maintainer decision on #33584, option A ("members may react by default"):
// `member_default` names `sys_comment_reaction` read + create. Pinned here at
// the REST doors a stock member reaches, on the same fixture app, with NO
// reaction grant from the app: the app's own baseline (`rxs_app_member`, its
// `isDefault` posture) reads its records and nothing else, so every reaction
// bit the members hold is the platform baseline's. The suite above holds an app
// grant with the delete bit (`rx_reactor`) and measures the floor; this one
// holds none and measures the default.
//
//   - a member reacts to a comment they can read (201) and lists its reactions;
//   - they unreact their own (the own-row door, `DELETE
//     /api/v1/comments/reactions/:id`: the baseline carries no delete bit);
//   - they cannot remove another member's reaction, on that door (403) or the
//     data door (no delete bit), and the row stays;
//   - CONTROL: an unfiltered list carries the readable comment's reactions and
//     not the unreadable comment's;
//   - CONTROL: on a comment they cannot read, a reaction is neither listed,
//     read by id, removed, nor inserted (403 RECORD_NOT_ACCESSIBLE).

/** The app's every-member baseline: its own records, read-only — no comment or reaction bit. */
const appMemberSet = PermissionSetSchema.parse({
  name: 'rxs_app_member',
  label: 'Reactions fixture — app member baseline',
  objects: {
    cmt_open: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    cmt_private: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
  },
});

describe('a stock member reacts to the comments they can read — member_default only (#33584)', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok = '';
  let aliceTok = '';
  let bobTok = '';
  let aliceId = '';
  let bobId = '';
  let commentId = '';
  let privateCommentId = '';
  let privateReactionId = '';

  const call = async (token: string, method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const uid = async (email: string) => String((await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id);
  const reactionRows = (where: Record<string, unknown>) => ql.find(REACTION, { where, context: SYS });
  /** A list answer's rows — the shape asserted, so an empty CONTROL never reads an unrecognised answer as no rows. */
  const listed = (json: any): any[] => {
    expect(Array.isArray(json?.records), `a list answer carries records[]: ${JSON.stringify(json)}`).toBe(true);
    return json.records;
  };
  const react = (token: string, comment: string, emoji: string) => call(token, 'POST', `/data/${REACTION}`, { comment_id: comment, emoji });
  const reactionId = async (where: Record<string, unknown>) => String((await reactionRows(where))[0]?.id);

  beforeAll(async () => {
    stack = await bootStack(commentsFixtureStack as never, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, appMemberSet],
        // The app's `isDefault` posture: its baseline COMPOSED with the
        // platform's `member_default` (ADR-0090 D5), as a showcase member holds.
        fallbackPermissionSet: appMemberSet.name,
      }),
      extraPlugins: [new AuditPlugin()],
      orgContext: true,
    });
    adminTok = await stack.signIn();
    aliceTok = await stack.signUp('rxs-alice@verify.test');
    bobTok = await stack.signUp('rxs-bob@verify.test');
    ql = await stack.kernel.getServiceAsync('objectql');
    const adminId = await uid('admin@objectos.ai');
    aliceId = await uid('rxs-alice@verify.test');
    bobId = await uid('rxs-bob@verify.test');

    // Stock: each member holds `member_default`, and no other set they hold —
    // the app's baseline, or a set another package composes in — names
    // reactions or a wildcard, so no reaction bit comes from anywhere else.
    const otherReactionGrants = async (token: string) => {
      const held = (await resolveAuthzFor(stack, token)).permissions;
      const named: string[] = [];
      for (const name of held) {
        if (name === 'member_default') continue;
        // A set the catalog cannot serve is unread, so it counts against arming.
        const definition = await catalogPermissionSet(ql, name);
        const objects = definition?.objects ?? {};
        if (!definition || REACTION in objects || '*' in objects) named.push(name);
      }
      return { held, named };
    };
    await assertArmed(
      [['alice', aliceTok], ['bob', bobTok]].map(([who, token]) =>
        armedWhen({
          control: `${who} holds member_default, and no other set they hold names ${REACTION} or a wildcard`,
          disarmedBy: 'another set naming reactions (an app or fixture grant) would make a 201 its answer, not the default\u2019s',
          observe: () => otherReactionGrants(token),
          armed: ({ held, named }) => held.includes('member_default') && named.length === 0,
        }),
      ),
    );

    // A record both members read (public_read_write), with one comment by the admin.
    const open = await call(adminTok, 'POST', '/data/cmt_open', { name: 'stock reactions record' });
    expect(open.status, JSON.stringify(open.json)).toBeLessThan(300);
    const openId = String(open.json.id ?? open.json.record?.id);
    const posted = await call(adminTok, 'POST', '/data/sys_comment', { thread_id: `cmt_open:${openId}`, body: 'admin comment' });
    expect(posted.status, JSON.stringify(posted.json)).toBeLessThan(300);
    commentId = String((await ql.findOne('sys_comment', { where: { thread_id: `cmt_open:${openId}` }, context: SYS })).id);

    // A comment on a record no member reads (cmt_private, owner-only), with the admin's reaction on it.
    const privateId = String((await ql.insert('cmt_private', { name: 'admin only', owner_id: adminId }, { context: SYS })).id);
    const privatePost = await call(adminTok, 'POST', '/data/sys_comment', { thread_id: `cmt_private:${privateId}`, body: 'private comment' });
    expect(privatePost.status, JSON.stringify(privatePost.json)).toBeLessThan(300);
    privateCommentId = String((await ql.findOne('sys_comment', { where: { thread_id: `cmt_private:${privateId}` }, context: SYS })).id);
    const adminReaction = await react(adminTok, privateCommentId, '👀');
    expect(adminReaction.status, JSON.stringify(adminReaction.json)).toBe(201);
    privateReactionId = await reactionId({ comment_id: privateCommentId });
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('a member reacts to a comment they can read (201, user_id is the caller) and lists its reactions', async () => {
    const created = await react(aliceTok, commentId, '👍');
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    expect((await reactionRows({ comment_id: commentId, emoji: '👍' })).map((r: any) => r.user_id)).toEqual([aliceId]);

    const bobs = await react(bobTok, commentId, '🎉');
    expect(bobs.status, JSON.stringify(bobs.json)).toBe(201);

    const filter = encodeURIComponent(JSON.stringify(['comment_id', '=', commentId]));
    const list = await call(aliceTok, 'GET', `/data/${REACTION}?$filter=${filter}`);
    expect(list.status, JSON.stringify(list.json)).toBe(200);
    expect(listed(list.json).map((r: any) => r.user_id).sort()).toEqual([aliceId, bobId].sort());
  });

  it('a member unreacts their own reaction through the own-row door', async () => {
    const created = await react(aliceTok, commentId, '🚀');
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const mineId = await reactionId({ comment_id: commentId, emoji: '🚀' });

    const removed = await call(aliceTok, 'DELETE', `/comments/reactions/${mineId}`);
    expect(removed.status, JSON.stringify(removed.json)).toBe(200);
    expect(await reactionRows({ id: mineId })).toHaveLength(0);
  });

  it('a member cannot remove another member’s reaction — on the own-row door or the data door — and the row stays', async () => {
    const theirs = await react(bobTok, commentId, '❤️');
    expect(theirs.status, JSON.stringify(theirs.json)).toBe(201);
    const theirsId = await reactionId({ comment_id: commentId, emoji: '❤️' });

    const door = await call(aliceTok, 'DELETE', `/comments/reactions/${theirsId}`);
    expect(door.status, JSON.stringify(door.json)).toBe(403);
    expect(door.json.error?.code).toBe('PERMISSION_DENIED');

    // The baseline carries no delete bit, so the data door refuses before the floor.
    const data = await call(aliceTok, 'DELETE', `/data/${REACTION}/${theirsId}`);
    expect(data.status, JSON.stringify(data.json)).toBe(403);
    expect(data.json.code).toBe('PERMISSION_DENIED');

    expect(await reactionRows({ id: theirsId })).toHaveLength(1);
  });

  it('CONTROL: an unfiltered list answers the readable comment\u2019s reactions and omits the unreadable comment\u2019s', async () => {
    const visible = await react(aliceTok, commentId, '👏');
    expect(visible.status, JSON.stringify(visible.json)).toBe(201);
    const visibleId = await reactionId({ comment_id: commentId, emoji: '👏' });

    const list = await call(aliceTok, 'GET', `/data/${REACTION}`);
    expect(list.status, JSON.stringify(list.json)).toBe(200);
    const ids = listed(list.json).map((r: any) => String(r.id));
    // The readable side is the witness that the answer carries rows at all.
    expect(ids).toContain(visibleId);
    expect(ids).not.toContain(privateReactionId);
    // Ground truth past every scope: the hidden row exists.
    expect(await reactionRows({ id: privateReactionId })).toHaveLength(1);
  });

  it('CONTROL: on a comment the member cannot read, a reaction is neither listed, read, removed nor inserted', async () => {
    const filter = encodeURIComponent(JSON.stringify(['comment_id', '=', privateCommentId]));
    const list = await call(aliceTok, 'GET', `/data/${REACTION}?$filter=${filter}`);
    expect(list.status, JSON.stringify(list.json)).toBe(200);
    expect(listed(list.json)).toEqual([]);

    const byId = await call(aliceTok, 'GET', `/data/${REACTION}/${privateReactionId}`);
    expect(byId.status, JSON.stringify(byId.json)).toBe(404);

    const door = await call(aliceTok, 'DELETE', `/comments/reactions/${privateReactionId}`);
    expect(door.status, JSON.stringify(door.json)).toBe(404);
    expect(await reactionRows({ id: privateReactionId })).toHaveLength(1);

    const denied = await react(aliceTok, privateCommentId, '🎉');
    expect(denied.status, JSON.stringify(denied.json)).toBe(403);
    expect(denied.json.code).toBe('RECORD_NOT_ACCESSIBLE');
    expect(await reactionRows({ comment_id: privateCommentId, user_id: aliceId })).toHaveLength(0);
  });
});
