// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A comment's display name and avatar are stamped from the caller's session,
// like its author id — pinned at the REST data door of a booted stack, the
// door the console's Discussion panel writes and reads through.
//
// The rule (`@objectstack/plugin-audit`, `comment-access-hooks.ts` and
// `objects/sys-comment.object.ts`): on create, `author_name` and
// `author_avatar_url` are the session user's own `sys_user` display name and
// `image`, whatever the client sent; on update both are read-only, so the
// door strips a client's value and reports it in `droppedFields`.
//
// The control is the caller's ordinary comment: it still shows the caller's
// own name, so the pins below measure the stamp, not a blanked column.
//
// Fixture: the comments permission-matrix stack (`fixtures/comments-fixture.ts`)
// with plugin-audit, org-bound like its sibling suites. Both users read and
// edit `cmt_open` (public_read_write).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { commentsFixtureStack, commentsFixtureSecurity } from './fixtures/comments-fixture.js';

const SYS = { isSystem: true } as const;
const MEMBER_EMAIL = 'cad-member@verify.test';
const MEMBER_NAME = 'Cad Member';
const MEMBER_IMAGE = 'https://cdn.verify.test/cad-member.png';
const ADMIN_IMAGE = 'https://cdn.verify.test/admin.png';

type Answer = { status: number; json: any };
type Identity = { author_id: unknown; author_name: unknown; author_avatar_url: unknown };

describe('sys_comment display identity over the REST data door — stamped from the caller\'s session, like the author id', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok = '';
  let memberTok = '';
  let adminId = '';
  let memberId = '';
  let adminName = '';
  let threadId = '';

  const call = async (token: string, method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const userRow = async (email: string) => ql.findOne('sys_user', { where: { email }, context: SYS });
  const post = async (token: string, extra: Record<string, unknown>): Promise<string> => {
    const created = await call(token, 'POST', '/data/sys_comment', { thread_id: threadId, body: 'a comment', ...extra });
    expect(created.status, JSON.stringify(created.json)).toBeLessThan(300);
    const id = created.json.id ?? created.json.record?.id;
    expect(id, JSON.stringify(created.json)).toBeTruthy();
    return String(id);
  };
  /** What a reader is served for the comment at the door. */
  const served = async (token: string, id: string): Promise<Identity> => {
    const read = await call(token, 'GET', `/data/sys_comment/${id}`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    const record = read.json.record ?? read.json;
    return { author_id: record.author_id, author_name: record.author_name ?? null, author_avatar_url: record.author_avatar_url ?? null };
  };

  beforeAll(async () => {
    stack = await bootStack(commentsFixtureStack as never, {
      security: commentsFixtureSecurity(),
      extraPlugins: [new AuditPlugin()],
      orgContext: true,
    });
    ql = await stack.kernel.getServiceAsync('objectql');
    // Each avatar is set before its user's first write: the platform reads a
    // user's display identity once per snapshot window (the record history's
    // actor snapshot), so a later change shows on later writes only.
    const admin = await userRow('admin@objectos.ai');
    adminId = String(admin.id);
    adminName = String(admin.name);
    await ql.update('sys_user', { image: ADMIN_IMAGE }, { where: { id: adminId }, context: SYS });
    adminTok = await stack.signIn();
    memberTok = await stack.signUp(MEMBER_EMAIL, undefined, MEMBER_NAME);
    memberId = String((await userRow(MEMBER_EMAIL)).id);
    await ql.update('sys_user', { image: MEMBER_IMAGE }, { where: { id: memberId }, context: SYS });
    // Two distinct, non-empty names, or the pins below could not tell them apart.
    expect(adminName).toBeTruthy();
    expect(adminName).not.toBe(MEMBER_NAME);

    const record = await call(adminTok, 'POST', '/data/cmt_open', { name: 'display identity record' });
    expect(record.status, JSON.stringify(record.json)).toBeLessThan(300);
    threadId = `cmt_open:${String(record.json.id ?? record.json.record?.id)}`;
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('a comment shows the caller\'s own name and avatar, whatever display identity the request carries', async () => {
    const id = await post(memberTok, { author_id: adminId, author_name: adminName, author_avatar_url: ADMIN_IMAGE });
    const expected = { author_id: memberId, author_name: MEMBER_NAME, author_avatar_url: MEMBER_IMAGE };
    expect(await served(memberTok, id)).toEqual(expected);
    expect(await served(adminTok, id)).toEqual(expected);
  });

  it('control: an ordinary comment shows its caller\'s own name, for each caller', async () => {
    const mine = await post(memberTok, { author_name: MEMBER_NAME });
    expect(await served(adminTok, mine)).toEqual({ author_id: memberId, author_name: MEMBER_NAME, author_avatar_url: MEMBER_IMAGE });

    const theirs = await post(adminTok, {});
    expect(await served(memberTok, theirs)).toEqual({ author_id: adminId, author_name: adminName, author_avatar_url: ADMIN_IMAGE });
  });

  it('an edit never changes the display identity: the door strips the value and reports it in droppedFields', async () => {
    const id = await post(memberTok, {});
    const edited = await call(memberTok, 'PATCH', `/data/sys_comment/${id}`, {
      body: 'a comment, edited',
      author_name: adminName,
      author_avatar_url: ADMIN_IMAGE,
    });
    expect(edited.status, JSON.stringify(edited.json)).toBe(200);
    const dropped = (edited.json.droppedFields ?? []) as Array<{ fields: string[]; reason: string }>;
    expect(
      dropped.some((d) => d.reason === 'readonly' && d.fields.includes('author_name') && d.fields.includes('author_avatar_url')),
      `droppedFields names both display fields with reason readonly — got ${JSON.stringify(dropped)}`,
    ).toBe(true);

    expect(await served(adminTok, id)).toEqual({ author_id: memberId, author_name: MEMBER_NAME, author_avatar_url: MEMBER_IMAGE });
    const stored = await ql.findOne('sys_comment', { where: { id }, context: SYS });
    expect(stored.body, 'the editable field in the same request still lands').toBe('a comment, edited');
  });
});
