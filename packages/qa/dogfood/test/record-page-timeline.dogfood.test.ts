// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28737] The record page payload's `timeline` part — the size of the
// record's 动态 stream — through the real HTTP + security stack, on an
// org-bound boot with plugin-audit's real writers: the comments, the activity
// mirror and the ledger rows are the ones the member's own writes produce.
//
// The count is of rows the caller could read, and of no other: it equals the
// sum of the separate list reads it stands for, asked as the same member (the
// spec's timeline table), and the activity's `updated` rows step aside once a
// field change is counted. A refused ledger read counting no field change is
// pinned at the route (`record-page-routes.test.ts`): on this boot the
// platform's member floor reads the ledger rows of a record the member reads.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { RECORD_TIMELINE_UNDRAWN_ACTIVITY_TYPES, RecordPageResponseSchema } from '@objectstack/spec/api';
import { commentsFixtureStack, cmtFixtureBaselineSet } from './fixtures/comments-fixture.js';
import { armedWhen, assertArmed } from './armed.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

const SYS = { isSystem: true } as const;
const AUTHOR_EMAIL = 'timeline-author@verify.test';

/** Object-level reads of the activity stream and the ledger. */
const streamReaderSet: PermissionSet = PermissionSetSchema.parse({
  name: 'tl_stream_reader',
  label: 'Timeline fixture — object-level sys_activity and sys_audit_log read',
  objects: { sys_activity: { allowRead: true }, sys_audit_log: { allowRead: true } },
});

const ALL_SOURCES = { discussion: true, activity: true, fieldChanges: true } as const;

describe('[#28737] the timeline part counts the 动态 stream the caller could read', () => {
  let stack: VerifyStack;
  let ql: any;
  let authorTok: string;
  let recordId: string;

  const grant = async (email: string, set: PermissionSet) => {
    const userId = (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;
    const served = await catalogPermissionSet(ql, set.name);
    expect(served, `fixture permission set ${set.name} served by the security catalog`).toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: userId, permission_set: served.name }, { context: { ...SYS } });
  };

  beforeAll(async () => {
    stack = await bootStack(commentsFixtureStack as never, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, cmtFixtureBaselineSet, streamReaderSet],
        fallbackPermissionSet: cmtFixtureBaselineSet.name,
      }),
      extraPlugins: [new AuditPlugin()],
      orgContext: true,
    });
    await stack.signIn();
    authorTok = await stack.signUp(AUTHOR_EMAIL);
    ql = await stack.kernel.getServiceAsync('objectql');
    await grant(AUTHOR_EMAIL, streamReaderSet);

    // The record's stream, from its real producers: a create and two renames
    // (ledger rows and their activity mirror), two comments and a reply.
    const created = await stack.apiAs(authorTok, 'POST', '/data/cmt_open', { name: 'shared board' });
    expect(created.status, await created.clone().text()).toBeLessThan(300);
    const body: any = await created.json();
    recordId = String(body.id ?? body.record?.id ?? body.data?.id);
    for (const name of ['shared board, renamed', 'shared board, renamed again']) {
      expect((await stack.apiAs(authorTok, 'PATCH', `/data/cmt_open/${recordId}`, { name })).status).toBeLessThan(300);
    }
    const thread = `cmt_open:${recordId}`;
    const first = await stack.apiAs(authorTok, 'POST', '/data/sys_comment', { thread_id: thread, body: 'first' });
    expect(first.status, await first.clone().text()).toBe(201);
    const firstId = String(((await first.json()) as any).id ?? '');
    expect((await stack.apiAs(authorTok, 'POST', '/data/sys_comment', { thread_id: thread, body: 'second' })).status).toBe(201);
    expect((await stack.apiAs(authorTok, 'POST', '/data/sys_comment', { thread_id: thread, body: 'a reply', parent_id: firstId })).status).toBe(201);

    await assertArmed([
      armedWhen({
        control: 'the stores at rest hold the stream this file counts, from their real producers',
        disarmedBy: 'a writer that stopped writing would let every count below agree on zero',
        observe: async () => ({
          comments: (await ql.find('sys_comment', { where: { thread_id: thread }, context: SYS })).length,
          ledger: (await ql.find('sys_audit_log', { where: { object_name: 'cmt_open', record_id: recordId }, context: SYS })).length,
          updates: (await ql.find('sys_activity', { where: { object_name: 'cmt_open', record_id: recordId, type: 'updated' }, context: SYS })).length,
        }),
        armed: (o) => o.comments === 3 && o.ledger >= 3 && o.updates === 2,
      }),
      armedWhen({
        control: 'the member reads each source the count stands for',
        disarmedBy: 'a refused source read would leave the sum below a statement about a stream nobody counted',
        observe: async () => ({
          comments: (await stack.apiAs(authorTok, 'GET', '/data/sys_comment?$top=1')).status,
          activity: (await stack.apiAs(authorTok, 'GET', '/data/sys_activity?$top=1')).status,
          ledger: (await stack.apiAs(authorTok, 'GET', '/data/sys_audit_log?$top=1')).status,
        }),
        armed: (o) => o.comments === 200 && o.activity === 200 && o.ledger === 200,
      }),
    ]);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  /** A list read's total as `token` — or `null` when the read is refused. */
  const totalAs = async (token: string, object: string, filter: Record<string, unknown>): Promise<number | null> => {
    const res = await stack.apiAs(token, 'GET', `/data/${object}?$filter=${encodeURIComponent(JSON.stringify(filter))}&$top=1&$count=true`);
    if (res.status >= 400) return null;
    const json: any = await res.json();
    return Number(json?.data?.total ?? json?.total);
  };
  /** The sum the spec's timeline table spells, from the separate list reads as `token`. */
  const expectedAs = async (token: string) => {
    const ofRecord = { object_name: 'cmt_open', record_id: recordId };
    const comments = await totalAs(token, 'sys_comment', { thread_id: `cmt_open:${recordId}` });
    const changes = (await totalAs(token, 'sys_audit_log', { ...ofRecord, action: { $in: ['create', 'update', 'delete'] } })) ?? 0;
    const drawn = await totalAs(token, 'sys_activity', { ...ofRecord, type: { $nin: [...RECORD_TIMELINE_UNDRAWN_ACTIVITY_TYPES] } });
    const updates = await totalAs(token, 'sys_activity', { ...ofRecord, type: 'updated' });
    expect(comments, 'the comment read answers').not.toBeNull();
    expect(drawn, 'the activity read answers').not.toBeNull();
    return { comments: comments!, changes, drawn: drawn!, updates: updates!, total: comments! + changes + drawn! - (changes > 0 ? updates! : 0) };
  };
  const timelineAs = async (token: string) => {
    const res = await stack.apiAs(token, 'POST', `/data/cmt_open/${recordId}/page`, { timeline: ALL_SOURCES });
    const json: any = await res.json();
    expect(res.status, JSON.stringify(json)).toBe(200);
    return RecordPageResponseSchema.parse(json.data).timeline;
  };

  it('counts the stream as the separate reads answer it, and the updates step aside for the field changes', async () => {
    const expected = await expectedAs(authorTok);
    expect(expected.comments).toBe(3);
    expect(expected.changes).toBeGreaterThanOrEqual(3);
    expect(expected.updates).toBe(2);
    expect(await timelineAs(authorTok)).toEqual({ total: expected.total });
  }, 60_000);

  it('without the field changes, the updates stay in the count', async () => {
    const expected = await expectedAs(authorTok);
    const res = await stack.apiAs(authorTok, 'POST', `/data/cmt_open/${recordId}/page`, {
      timeline: { discussion: true, activity: true, fieldChanges: false },
    });
    expect(res.status).toBe(200);
    expect(RecordPageResponseSchema.parse(((await res.json()) as any).data).timeline).toEqual({ total: expected.comments + expected.drawn });
  }, 60_000);

  it('counts only the sources named', async () => {
    const res = await stack.apiAs(authorTok, 'POST', `/data/cmt_open/${recordId}/page`, {
      timeline: { discussion: true, activity: false, fieldChanges: false },
    });
    expect(res.status).toBe(200);
    expect(RecordPageResponseSchema.parse(((await res.json()) as any).data).timeline).toEqual({ total: 3 });
  }, 60_000);
});
