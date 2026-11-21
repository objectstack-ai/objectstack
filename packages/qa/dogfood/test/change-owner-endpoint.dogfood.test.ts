// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#35402] The Change Owner doors, on the REAL showcase app end to end:
//
//   POST /data/:object/:id/change-owner   — one record
//   POST /data/:object/change-owner       — a list, with a per-row report
//
// Driven through the real HTTP stack, the real security plugin (the owner
// guard at step 3.5 of the authz middleware), the real sharing service and the
// real `private` OWD of `showcase_private_note`. What this file MEASURES, as
// the card asks ("read it, do not assume"): after a transfer the new owner can
// edit the record, and the previous owner's access follows the sharing rules —
// the `owner_only_writes` floor is keyed on `created_by`, which a transfer does
// not move, so the previous owner (still the creator) is the case to read.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { catalogPermissionSet } from './catalog-permission-set.js';

const OBJECT = 'showcase_private_note';
const OBJ = `/data/${OBJECT}`;
const SYS = { isSystem: true } as const;
const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id ?? b?.recordId;

// The transfer grant on the private note, bound directly to one member — never
// to the anchor, so every other member keeps edit without transfer.
const noteTransferSet = PermissionSetSchema.parse({
  name: 'change_owner_note_transfer',
  label: 'Change Owner proof — note transfer',
  objects: {
    showcase_private_note: { allowRead: true, allowCreate: true, allowEdit: true, allowTransfer: true },
  },
});

describe('[#35402] Change Owner doors on the showcase', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminToken: string;
  let aliceToken: string;
  let bobToken: string;
  let carolToken: string;
  let aliceId: string;
  let bobId: string;
  let carolId: string;

  const ownerOf = async (id: string) =>
    (await ql.findOne(OBJECT, { where: { id }, context: SYS }))?.owner_id;
  const create = async (token: string, title: string) => {
    const r = await stack.apiAs(token, 'POST', OBJ, { title, body: title });
    expect(r.status, `create ${title}`).toBeLessThan(300);
    return String(idOf(await r.json()));
  };

  beforeAll(async () => {
    stack = await bootShowcase({
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, noteTransferSet],
      }),
    });
    adminToken = await stack.signIn();
    aliceToken = await stack.signUp('change-owner-alice@verify.test');
    bobToken = await stack.signUp('change-owner-bob@verify.test');
    carolToken = await stack.signUp('change-owner-carol@verify.test');
    ql = await stack.kernel.getServiceAsync('objectql');
    const uid = async (email: string) => String((await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id);
    aliceId = await uid('change-owner-alice@verify.test');
    bobId = await uid('change-owner-bob@verify.test');
    carolId = await uid('change-owner-carol@verify.test');

    const set = await catalogPermissionSet(ql, 'change_owner_note_transfer');
    expect(set, 'the transfer set is served by the security catalog').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: aliceId, permission_set: set.name }, { context: { ...SYS } });
  }, 120_000);

  afterAll(async () => { await stack?.stop(); });

  it('edit without the transfer grant is refused 403 PERMISSION_DENIED, and the owner stays', async () => {
    const note = await create(carolToken, 'carol keeps this');
    const r = await stack.apiAs(carolToken, 'POST', `${OBJ}/${note}/change-owner`, { ownerId: bobId });
    const body: any = await r.json();
    expect(r.status, JSON.stringify(body)).toBe(403);
    expect(body.error?.code).toBe('PERMISSION_DENIED');
    expect(await ownerOf(note)).toBe(carolId);
  });

  it('a controlled_by_parent detail is off by default: refused 403 CHANGE_OWNER_DISABLED even for a modifyAllRecords holder', async () => {
    const line = await ql.findOne('showcase_invoice_line', { context: SYS });
    const id = line?.id ?? 'no-line';
    const r = await stack.apiAs(adminToken, 'POST', `/data/showcase_invoice_line/${id}/change-owner`, { ownerId: bobId });
    const body: any = await r.json();
    expect(r.status, JSON.stringify(body)).toBe(403);
    expect(body.error?.code).toBe('CHANGE_OWNER_DISABLED');
    const bulk = await stack.apiAs(adminToken, 'POST', '/data/showcase_invoice_line/change-owner', { ids: [id], ownerId: bobId });
    expect(bulk.status).toBe(403);
    expect(((await bulk.json()) as any).error?.code).toBe('CHANGE_OWNER_DISABLED');
    if (line) expect((await ql.findOne('showcase_invoice_line', { where: { id }, context: SYS }))?.owner_id).toBe(line.owner_id);
  });

  it('MEASURED: after a transfer the new owner reads and edits the record; the previous owner, still its creator, reads and edits nothing', async () => {
    const note = await create(aliceToken, 'alice hands this to bob');
    const moved = await stack.apiAs(aliceToken, 'POST', `${OBJ}/${note}/change-owner`, { ownerId: bobId });
    const movedBody: any = await moved.json();
    expect(moved.status, JSON.stringify(movedBody)).toBe(200);
    expect(movedBody.data).toMatchObject({ object: OBJECT, id: note, ownerId: bobId, notified: false });
    expect(await ownerOf(note)).toBe(bobId);
    const row = await ql.findOne(OBJECT, { where: { id: note }, context: SYS });
    expect(row?.created_by, 'the transfer does not move created_by').toBe(aliceId);

    // The new owner.
    expect((await stack.apiAs(bobToken, 'GET', `${OBJ}/${note}`)).status).toBe(200);
    const bobEdit = await stack.apiAs(bobToken, 'PATCH', `${OBJ}/${note}`, { body: 'bob edits' });
    expect(bobEdit.status, JSON.stringify(await bobEdit.clone().json())).toBe(200);

    // The previous owner: `private` OWD, no share — the sharing rules give no
    // access, and being the creator (the floor's key) does not give it back.
    const aliceRead = await stack.apiAs(aliceToken, 'GET', `${OBJ}/${note}`);
    expect(aliceRead.status, 'previous owner read').toBe(404);
    const aliceEdit = await stack.apiAs(aliceToken, 'PATCH', `${OBJ}/${note}`, { body: 'alice edits' });
    expect(aliceEdit.status, 'previous owner edit').toBe(404);
    expect((await ql.findOne(OBJECT, { where: { id: note }, context: SYS }))?.body).toBe('bob edits');
  });

  it('bulk: a mixed batch moves what it may and lists every row that did not move, with the door\'s code', async () => {
    const a1 = await create(aliceToken, 'alice bulk 1');
    const a2 = await create(aliceToken, 'alice bulk 2');
    const carols = await create(carolToken, 'carol bulk');
    const r = await stack.apiAs(aliceToken, 'POST', `${OBJ}/change-owner`, { ids: [a1, carols, a2], ownerId: bobId });
    const body: any = await r.json();
    expect(r.status, JSON.stringify(body)).toBe(200);
    expect(body.data).toMatchObject({ object: OBJECT, field: 'owner_id', ownerId: bobId, updated: 2, failed: 1 });
    expect(body.data.failures.map((f: any) => [f.id, f.code])).toEqual([[carols, 'RECORD_NOT_FOUND']]);
    expect(await ownerOf(a1)).toBe(bobId);
    expect(await ownerOf(a2)).toBe(bobId);
    expect(await ownerOf(carols)).toBe(carolId);

    // Without the grant every row the caller can edit is the owner guard's refusal.
    const own = await create(carolToken, 'carol bulk own');
    const refused = await stack.apiAs(carolToken, 'POST', `${OBJ}/change-owner`, { ids: [own], ownerId: bobId });
    const refusedBody: any = await refused.json();
    expect(refused.status, JSON.stringify(refusedBody)).toBe(200);
    expect(refusedBody.data).toMatchObject({ updated: 0, failed: 1 });
    expect(refusedBody.data.failures[0]).toMatchObject({ id: own, code: 'PERMISSION_DENIED' });
    expect(await ownerOf(own)).toBe(carolId);
  });

  it('[ADR-0142] a queue target: the record sits in the queue, and moving it there needs the transfer grant', async () => {
    const note = await create(aliceToken, 'alice queues this');
    const organizationId = (await ql.findOne(OBJECT, { where: { id: note }, context: SYS }))?.organization_id;
    await ql.insert('sys_queue', { name: 'note_triage', label: 'Note triage', organization_id: organizationId },
      { context: { ...SYS, tenantId: organizationId } });

    const own = await create(carolToken, 'carol cannot queue this');
    const refused = await stack.apiAs(carolToken, 'POST', `${OBJ}/${own}/change-owner`, { queue: 'note_triage' });
    expect(refused.status, JSON.stringify(await refused.clone().json())).toBe(403);
    expect((await ql.findOne(OBJECT, { where: { id: own }, context: SYS }))?.owner_id).toBe(carolId);

    const r = await stack.apiAs(aliceToken, 'POST', `${OBJ}/${note}/change-owner`, { queue: 'note_triage' });
    const body: any = await r.json();
    expect(r.status, JSON.stringify(body)).toBe(200);
    expect(body.data).toMatchObject({ ownerId: null, queue: 'note_triage' });
    const row = await ql.findOne(OBJECT, { where: { id: note }, context: SYS });
    expect({ owner: row?.owner_id ?? null, queue: row?.queue }).toEqual({ owner: null, queue: 'note_triage' });
  });

  it('notify: the new owner gets one inbox notification naming the record', async () => {
    const note = await create(aliceToken, 'alice tells bob');
    const r = await stack.apiAs(aliceToken, 'POST', `${OBJ}/${note}/change-owner`, { ownerId: bobId, notify: true });
    const body: any = await r.json();
    expect(r.status, JSON.stringify(body)).toBe(200);
    expect(body.data.notified).toBe(true);
    const events = await ql.find('sys_notification', { where: { topic: 'record.owner_changed' }, context: SYS });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});
