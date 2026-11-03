// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28470] The record page payload's stream parts (`POST /data/:object/:id/page`
// with `discussion`, `activity` and `attachments`) answer a member who is not
// an admin exactly what the separate reads they replace answer that member,
// through the real HTTP + security stack:
//
//  - `discussion` is `GET /data/sys_comment` for the record's thread (no page
//    size, oldest first), plus `GET /data/sys_comment_reaction` for those
//    comments (oldest first);
//  - `activity` is `GET /data/sys_activity` for the record, newest first, with
//    `$top`, `$count` and the actor expanded;
//  - `attachments` is `GET /data/sys_attachment` for the record, newest first,
//    with `$top` and `$count` — the count inherits the parent's row-level
//    security, so another record's attachments are neither counted nor listed;
//  - a related list's `expand` is its read's own `$expand`.
//
// The stream comparisons are byte-for-byte against the member's own reads, so
// whatever the comment, activity and attachment read gates do to a row, the
// part does the same.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { RecordPageResponseSchema } from '@objectstack/spec/api';
import { commentsFixtureStack, commentsFixtureSecurity } from './fixtures/comments-fixture.js';
import {
  bootAttachmentsHarness,
  stopAttachmentsHarness,
  uploadFile,
  FILE_BYTES,
  type AttachmentsHarness,
} from './fixtures/attachments-authz-harness.js';

const SYS = { isSystem: true } as const;

type Answer = { status: number; body: any };
const rowsOf = (body: any) => body?.data?.records ?? body?.records ?? body?.data ?? [];
const totalOf = (body: any) => body?.data?.total ?? body?.total;
const q = (value: unknown) => encodeURIComponent(JSON.stringify(value));

describe('[#28470] the record page discussion and activity parts, as a non-admin member', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok = '';
  let memberTok = '';
  let openId = '';
  let privateId = '';

  const call = async (token: string, method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    return { status: res.status, body: await res.json().catch(() => undefined) };
  };
  const idOf = (answer: Answer) => String(answer.body?.id ?? answer.body?.record?.id ?? answer.body?.data?.id);

  beforeAll(async () => {
    stack = await bootStack(commentsFixtureStack as never, {
      security: commentsFixtureSecurity(),
      extraPlugins: [new AuditPlugin()],
      orgContext: true,
    });
    adminTok = await stack.signIn();
    memberTok = await stack.signUp('rp-streams-member@verify.test');
    ql = await stack.kernel.getServiceAsync('objectql');

    // A record both read, with a thread of three comments (one a reply) and
    // reactions; an update so its activity holds more than its creation.
    const open = await call(adminTok, 'POST', '/data/cmt_open', { name: 'streams record' });
    expect(open.status, JSON.stringify(open.body)).toBeLessThan(300);
    openId = idOf(open);
    const renamed = await call(adminTok, 'PATCH', `/data/cmt_open/${openId}`, { name: 'streams record, renamed' });
    expect(renamed.status, JSON.stringify(renamed.body)).toBeLessThan(300);
    const thread = `cmt_open:${openId}`;
    for (const [token, body] of [[adminTok, 'first'], [memberTok, 'second']] as const) {
      const posted = await call(token, 'POST', '/data/sys_comment', { thread_id: thread, body });
      expect(posted.status, JSON.stringify(posted.body)).toBeLessThan(300);
    }
    const comments: any[] = await ql.find('sys_comment', { where: { thread_id: thread }, orderBy: [{ field: 'created_at', order: 'asc' }], context: SYS });
    expect(comments).toHaveLength(2);
    const reply = await call(adminTok, 'POST', '/data/sys_comment', { thread_id: thread, body: 'a reply', parent_id: String(comments[0].id) });
    expect(reply.status, JSON.stringify(reply.body)).toBeLessThan(300);
    for (const emoji of ['👍', '🎉']) {
      const reacted = await call(adminTok, 'POST', '/data/sys_comment_reaction', { comment_id: String(comments[0].id), emoji });
      expect(reacted.status, JSON.stringify(reacted.body)).toBeLessThan(300);
    }

    // A record the member cannot read, with a comment of its own.
    const priv = await call(adminTok, 'POST', '/data/cmt_private', { name: 'not yours' });
    expect(priv.status, JSON.stringify(priv.body)).toBeLessThan(300);
    privateId = idOf(priv);
    const hidden = await call(adminTok, 'POST', '/data/sys_comment', { thread_id: `cmt_private:${privateId}`, body: 'hidden' });
    expect(hidden.status, JSON.stringify(hidden.body)).toBeLessThan(300);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('answers the discussion and the activity as the member\'s own reads of them answer', async () => {
    const page = await call(memberTok, 'POST', `/data/cmt_open/${openId}/page`, { discussion: true, activity: { top: 200 } });
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    const data = RecordPageResponseSchema.parse(page.body.data);
    if (!data.discussion || 'error' in data.discussion) throw new Error(`discussion refused: ${JSON.stringify(data.discussion)}`);
    if (!data.activity || 'error' in data.activity) throw new Error(`activity refused: ${JSON.stringify(data.activity)}`);

    // The thread, as the record feed's comment read answers it.
    const thread = await call(memberTok, 'GET', `/data/sys_comment?$filter=${q({ thread_id: `cmt_open:${openId}` })}&sort=created_at`);
    expect(thread.status).toBe(200);
    expect(data.discussion.comments).toEqual(rowsOf(thread.body));
    expect(data.discussion.comments.map((c: any) => c.body)).toEqual(['first', 'second', 'a reply']);

    // Their reactions, as the feed's reaction read answers it.
    const ids = data.discussion.comments.map((c: any) => String(c.id));
    const reactions = await call(memberTok, 'GET', `/data/sys_comment_reaction?$filter=${q({ comment_id: { $in: ids } })}&sort=created_at`);
    expect(reactions.status).toBe(200);
    expect(data.discussion.reactions).toEqual({ records: rowsOf(reactions.body) });
    expect(rowsOf(reactions.body).map((r: any) => r.emoji)).toEqual(['👍', '🎉']);

    // The activity, newest first, the actor expanded, with its count.
    const activity = await call(
      memberTok,
      'GET',
      `/data/sys_activity?$filter=${q({ object_name: 'cmt_open', record_id: openId })}&sort=-timestamp&$top=200&$count=true&$expand=actor_id`,
    );
    expect(activity.status).toBe(200);
    expect(data.activity).toEqual({ total: totalOf(activity.body), records: rowsOf(activity.body) });
    expect(data.activity.total).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('a smaller activity window answers the newest rows of the same read, and the whole count', async () => {
    const page = await call(memberTok, 'POST', `/data/cmt_open/${openId}/page`, { activity: { top: 1 } });
    const data = RecordPageResponseSchema.parse(page.body.data);
    const activity = await call(
      memberTok,
      'GET',
      `/data/sys_activity?$filter=${q({ object_name: 'cmt_open', record_id: openId })}&sort=-timestamp&$top=1&$count=true&$expand=actor_id`,
    );
    expect(data.activity).toEqual({ total: totalOf(activity.body), records: rowsOf(activity.body) });
    expect(rowsOf(activity.body)).toHaveLength(1);
    expect(data).not.toHaveProperty('discussion');
  }, 60_000);

  it('a record the member cannot read refuses the whole request, its thread with it', async () => {
    const read = await call(memberTok, 'GET', `/data/cmt_private/${privateId}`);
    const page = await call(memberTok, 'POST', `/data/cmt_private/${privateId}/page`, { discussion: true, activity: { top: 5 } });
    expect(read.status).toBe(404);
    expect(page).toEqual(read);
  }, 60_000);
});

describe('[#28470] the record page attachments part, as a non-admin member', () => {
  let harness: AttachmentsHarness;
  let stack: VerifyStack;
  let ql: any;
  let adminTok = '';
  let memberTok = '';
  let caseId = '';

  const attach = async (parentObject: string, parentId: string) => {
    const fileId = await uploadFile(stack, adminTok);
    const res = await stack.apiAs(adminTok, 'POST', '/data/sys_attachment', {
      parent_object: parentObject,
      parent_id: parentId,
      file_id: fileId,
      file_name: 'hello.txt',
      mime_type: 'text/plain',
      size: FILE_BYTES.length,
    });
    expect(res.status, `attach to ${parentObject}`).toBeLessThan(300);
  };

  beforeAll(async () => {
    harness = await bootAttachmentsHarness();
    stack = harness.stack;
    adminTok = await stack.signIn();
    memberTok = await stack.signUp('rp-attachments-member@verify.test');
    ql = await stack.kernel.getServiceAsync('objectql');
    const adminId = String((await ql.findOne('sys_user', { where: { email: 'admin@objectos.ai' }, context: SYS }))?.id);

    const caseRes = await stack.apiAs(adminTok, 'POST', '/data/att_case', { name: 'page case' });
    expect(caseRes.status).toBeLessThan(300);
    const caseBody = (await caseRes.json()) as any;
    caseId = String(caseBody.id ?? caseBody.record?.id ?? caseBody.data?.id);
    const secretId = String((await ql.insert('att_secret', { name: 'page secret', owner_id: adminId }, { context: SYS })).id);
    for (let i = 0; i < 3; i++) await attach('att_case', caseId);
    for (let i = 0; i < 2; i++) await attach('att_secret', secretId);
  }, 180_000);

  afterAll(async () => {
    await stopAttachmentsHarness(harness);
  });

  it('answers the newest attachments and their count as the member\'s own attachment read does', async () => {
    const page = await stack.apiAs(memberTok, 'POST', `/data/att_case/${caseId}/page`, { attachments: { top: 2 } });
    const pageBody: any = await page.json();
    expect(page.status, JSON.stringify(pageBody)).toBe(200);
    const data = RecordPageResponseSchema.parse(pageBody.data);
    const list = await stack.apiAs(
      memberTok,
      'GET',
      `/data/sys_attachment?$filter=${q({ parent_object: 'att_case', parent_id: caseId })}&sort=-created_at&$top=2&$count=true`,
    );
    expect(list.status).toBe(200);
    const listBody: any = await list.json();
    expect(data.attachments).toEqual({ total: totalOf(listBody), records: rowsOf(listBody) });
    // The case's three, never the secret's two; two rows on the page.
    expect(totalOf(listBody)).toBe(3);
    expect(rowsOf(listBody)).toHaveLength(2);
  }, 60_000);
});
