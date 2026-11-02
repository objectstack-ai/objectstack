// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28737] The record page payload's `timeline` part — the size of the
// record's 动态 stream — through the real HTTP + security stack, on an
// org-bound boot with plugin-audit's real writers: the comments, the activity
// mirror and the ledger rows are the ones the member's own writes produce.
//
// The count is of rows the caller could read, and of no other: for each
// member it equals the sum of the separate list reads it stands for, asked as
// that member (the spec's timeline table). A member who may read the ledger
// counts its field changes, and the activity's `updated` rows step aside; a
// member refused the ledger counts no field change, and the updates stay.

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
const PEER_EMAIL = 'timeline-peer@verify.test';

/** Object-level reads of the activity stream and the ledger — the author holds both. */
const streamReaderSet: PermissionSet = PermissionSetSchema.parse({
  name: 'tl_stream_reader',
  label: 'Timeline fixture — object-level sys_activity and sys_audit_log read',
  objects: { sys_activity: { allowRead: true }, sys_audit_log: { allowRead: true } },
});
/** The activity stream alone — the peer holds this, and no ledger read. */
const activityReaderSet: PermissionSet = PermissionSetSchema.parse({
  name: 'tl_activity_reader',
  label: 'Timeline fixture — object-level sys_activity read',
  objects: { sys_activity: { allowRead: true } },
});

const ALL_SOURCES = { discussion: true, activity: true, fieldChanges: true } as const;

describe('[#28737] the timeline part counts the 动态 stream the caller could read', () => {
  let stack: VerifyStack;
  let ql: any;
  let authorTok: string;
  let peerTok: string;
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
        defaultPermissionSets: [...securityDefaultPermissionSets, cmtFixtureBaselineSet, streamReaderSet, activityReaderSet],
        fallbackPermissionSet: cmtFixtureBaselineSet.name,
      }),
      extraPlugins: [new AuditPlugin()],
      orgContext: true,
    });
    await stack.signIn();
    authorTok = await stack.signUp(AUTHOR_EMAIL);
    peerTok = await stack.signUp(PEER_EMAIL);
    ql = await stack.kernel.getServiceAsync('objectql');
    await grant(AUTHOR_EMAIL, streamReaderSet);
    await grant(PEER_EMAIL, activityReaderSet);

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
        control: 'the author reads the ledger and the peer is refused it',
        disarmedBy: 'a peer who could read the ledger would make the refused-ledger case a statement about nothing',
        observe: async () => ({
          author: (await stack.apiAs(authorTok, 'GET', `/data/sys_audit_log?$top=1`)).status,
          peer: (await stack.apiAs(peerTok, 'GET', `/data/sys_audit_log?$top=1`)).status,
        }),
        armed: (o) => o.author === 200 && o.peer >= 400,
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

  it('a member who reads the ledger counts its field changes, and the updates step aside', async () => {
    const expected = await expectedAs(authorTok);
    expect(expected.comments).toBe(3);
    expect(expected.changes).toBeGreaterThanOrEqual(3);
    expect(expected.updates).toBe(2);
    expect(await timelineAs(authorTok)).toEqual({ total: expected.total });
  }, 60_000);

  it('a member refused the ledger counts no field change, and the updates stay', async () => {
    const expected = await expectedAs(peerTok);
    expect(expected.changes).toBe(0);
    expect(await timelineAs(peerTok)).toEqual({ total: expected.total });
    expect(expected.total).toBe(expected.comments + expected.drawn);
  }, 60_000);

  it('counts only the sources named', async () => {
    const res = await stack.apiAs(authorTok, 'POST', `/data/cmt_open/${recordId}/page`, {
      timeline: { discussion: true, activity: false, fieldChanges: false },
    });
    expect(res.status).toBe(200);
    expect(RecordPageResponseSchema.parse(((await res.json()) as any).data).timeline).toEqual({ total: 3 });
  }, 60_000);
});
