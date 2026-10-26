// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #26314 — the record-anchored approval lock read, through the REST door on a
// real boot (#25934 ruling A, "readers").
//
// A member who can read and edit a record, but is not on its approval, used to
// be offered an edit the server then refused `409 RECORD_LOCKED`: the console's
// only lock source was the record's approval-request read, and that door
// rightly serves a non-participant no rows (#8652). The lock now has its own
// carrier, `GET /approvals/records/:object/:recordId/lock`, answering `{ locked }`
// — and nothing else — to every caller who can read the record.
//
// Real `SecurityPlugin`, real flows, real approvals plugin. Both objects are
// `private`, so the baseline set lets a member read and edit only their own
// rows; the editor and the reader are widened by an extra set each.
//
//   ⭐ a non-participant who can read AND edit the held record is told
//      `{ locked: true }` — and is still served no request row, and their
//      edit is still refused `RECORD_LOCKED`: the read agrees with the lock;
//   ⭐ a read-only reader is told `{ locked: true }`;
//   ⭐ a caller who cannot read the record gets the answer a record id that
//      does not exist gets — the same status and the same body;
//   ⭐ a pending node with `lockRecord: false` answers `{ locked: false }`
//      (and the edit lands), and so does the held record once its approval is
//      decided (no pending approval left).

import { describe, it, expect } from 'vitest';
import { bootStack } from '@objectstack/verify';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { defineStack, defineFlow } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { catalogPermissionSet } from './catalog-permission-set.js';

/** Its approval node locks the record (`lockRecord: true`). */
const HELD = 'lockread_held';
/** Its approval node opts out (`lockRecord: false`). */
const OPEN = 'lockread_open';
const SYS = { context: { isSystem: true } } as const;

const SUBMITTER = 'lockread-submitter@verify.test';
/** On both slates, by email. */
const APPROVER = 'lockread-approver@verify.test';
/** Reads and edits every record; on no slate. */
const EDITOR = 'lockread-editor@verify.test';
/** Reads every record, edits none but their own; on no slate. */
const READER = 'lockread-reader@verify.test';
/** The baseline only: reads their own records, so not the submitter's. */
const STRANGER = 'lockread-stranger@verify.test';

function sheet(name: string, label: string) {
  return ObjectSchema.create({
    name,
    label,
    pluralLabel: label,
    sharingModel: 'private',
    fields: { name: Field.text({ label: 'Name', required: true }) },
  });
}

function approvalFlow(objectName: string, lockRecord: boolean) {
  return defineFlow({
    name: `${objectName}_flow`,
    label: `${objectName} flow`,
    description: `Fires on insert of ${objectName} and opens one approval step (lockRecord: ${lockRecord}).`,
    type: 'autolaunched',
    status: 'active',
    nodes: [
      { id: 'start', type: 'start', label: 'On Create', config: { objectName, triggerType: 'record-after-create' } },
      {
        id: 'gate',
        type: 'approval',
        label: 'Gate',
        config: { approvers: [{ type: 'user', value: APPROVER }], behavior: 'first_response', lockRecord },
      },
      { id: 'approved', type: 'end', label: 'Approved' },
      { id: 'rejected', type: 'end', label: 'Rejected' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'gate' },
      { id: 'e2', source: 'gate', target: 'approved', label: 'approve' },
      { id: 'e3', source: 'gate', target: 'rejected', label: 'reject' },
    ],
  });
}

const lockReadStack = defineStack({
  manifest: {
    id: 'com.dogfood.approval-record-lock-read',
    namespace: 'lockread',
    version: '0.0.0',
    type: 'app',
    name: 'Approval Record Lock Read Fixture',
    description: 'One locking and one non-locking approval flow on two private objects.',
  },
  // ADR-0097: the `record-after-create` start nodes need the trigger capability.
  requires: ['automation', 'triggers'],
  objects: [sheet(HELD, 'Lock Read Held'), sheet(OPEN, 'Lock Read Open')],
  flows: [approvalFlow(HELD, true), approvalFlow(OPEN, false)],
});

const crud = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false };

/** Everyone's baseline: CRUD on both objects, which `private` narrows to their own rows. */
const baselineSet: PermissionSet = PermissionSetSchema.parse({
  name: 'lockread_baseline',
  label: 'Lock Read Baseline — own rows of both fixture objects',
  objects: { [HELD]: crud, [OPEN]: crud },
});

/** The editor's widening: read and edit every row. */
const editAllSet: PermissionSet = PermissionSetSchema.parse({
  name: 'lockread_edit_all',
  label: 'Lock Read Edit All — every row of both fixture objects',
  objects: {
    [HELD]: { ...crud, viewAllRecords: true, modifyAllRecords: true },
    [OPEN]: { ...crud, viewAllRecords: true, modifyAllRecords: true },
  },
});

/** The reader's widening: read every row, edit none it does not own. */
const readAllSet: PermissionSet = PermissionSetSchema.parse({
  name: 'lockread_read_all',
  label: 'Lock Read Read All — every row of both fixture objects, read only',
  objects: {
    [HELD]: { ...crud, viewAllRecords: true },
    [OPEN]: { ...crud, viewAllRecords: true },
  },
});

describe('the record-anchored approval lock read, through the REST door (#26314)', () => {
  it(
    'tells every reader of the record whether it is locked, and nothing else, and a non-reader what a missing id gets',
    async () => {
      const stack = await bootStack(lockReadStack as unknown as Parameters<typeof bootStack>[0], {
        automation: true,
        security: new SecurityPlugin({
          defaultPermissionSets: [...securityDefaultPermissionSets, baselineSet, editAllSet, readAllSet],
          fallbackPermissionSet: baselineSet.name,
        }),
        extraPlugins: [new RecordChangeTriggerPlugin(), new ApprovalsServicePlugin()],
      });
      try {
        const ql: any = await stack.kernel.getServiceAsync('objectql');
        const idOf = async (email: string): Promise<string> =>
          String((await ql.findOne('sys_user', { where: { email }, context: SYS.context }))?.id ?? '');
        const grant = async (email: string, set: PermissionSet) => {
          expect(await catalogPermissionSet(ql, set.name), `${set.name} is served by the catalog`).toBeTruthy();
          await ql.insert('sys_user_permission_set', { user_id: await idOf(email), permission_set: set.name }, SYS);
        };

        const submitterToken = await stack.signUp(SUBMITTER);
        const approverToken = await stack.signUp(APPROVER);
        const editorToken = await stack.signUp(EDITOR);
        const readerToken = await stack.signUp(READER);
        const strangerToken = await stack.signUp(STRANGER);
        await grant(EDITOR, editAllSet);
        await grant(READER, readAllSet);

        const create = async (object: string): Promise<string> => {
          const res = await stack.apiAs(submitterToken, 'POST', `/data/${object}`, { name: `${object} one` });
          expect(res.status, await res.clone().text()).toBe(201);
          const body = (await res.json()) as { id?: string; record?: { id?: string } };
          return String(body.id ?? body.record?.id ?? '');
        };
        const heldId = await create(HELD);
        const openId = await create(OPEN);
        const pendingOn = async (object: string, recordId: string) =>
          ql.find('sys_approval_request', { where: { object_name: object, record_id: recordId, status: 'pending' }, context: SYS.context });

        // The scene, before any answer is believed: both records carry a
        // pending request, on slates that name neither the editor nor the reader.
        const [heldRequest] = await pendingOn(HELD, heldId);
        expect(heldRequest, 'the locking flow opened a request').toBeTruthy();
        expect(await pendingOn(OPEN, openId)).toHaveLength(1);

        const lockOf = async (token: string, object: string, recordId: string) => {
          const res = await stack.apiAs(token, 'GET', `/approvals/records/${object}/${encodeURIComponent(recordId)}/lock`);
          return { status: res.status, body: (await res.json()) as unknown };
        };
        const LOCKED = { status: 200, body: { success: true, data: { locked: true } } };
        const UNLOCKED = { status: 200, body: { success: true, data: { locked: false } } };

        // ⭐ 1 — the non-participant reader-editor: told it is locked, in
        // exactly `{ locked }`, while still served no request row (#8652's
        // ruling untouched) and still refused the edit (the read agrees with
        // the lock it reports).
        expect(await lockOf(editorToken, HELD, heldId)).toEqual(LOCKED);
        const editorRows = await stack.apiAs(editorToken, 'GET', `/approvals/requests?object=${HELD}&recordId=${heldId}`);
        expect(editorRows.status).toBe(200);
        expect(((await editorRows.json()) as { data: unknown[] }).data).toEqual([]);
        const refused = await stack.apiAs(editorToken, 'PATCH', `/data/${HELD}/${heldId}`, { name: 'edited' });
        const refusedText = await refused.text();
        expect(refused.status, refusedText).toBe(409);
        expect(refusedText).toContain('RECORD_LOCKED');

        // ⭐ 2 — the read-only reader: told it is locked.
        expect(await lockOf(readerToken, HELD, heldId)).toEqual(LOCKED);

        // ⭐ 3 — a caller who cannot read the record: precondition, the data
        // door does not serve it to them; then the lock read answers exactly
        // what a record id that does not exist answers — status AND body.
        expect((await stack.apiAs(strangerToken, 'GET', `/data/${HELD}/${heldId}`)).status).toBe(404);
        const unreadable = await lockOf(strangerToken, HELD, heldId);
        const missing = await lockOf(strangerToken, HELD, 'lockread-no-such-record');
        expect(unreadable.status).toBe(404);
        expect((unreadable.body as { error?: { code?: string } }).error?.code).toBe('RECORD_NOT_FOUND');
        expect(unreadable).toEqual(missing);
        // …and a reader asking for the missing id gets that same answer too.
        expect(await lockOf(readerToken, HELD, 'lockread-no-such-record')).toEqual(missing);

        // ⭐ 4a — a pending node with `lockRecord: false`: not locked, and the
        // server agrees (the editor's edit lands).
        expect(await lockOf(editorToken, OPEN, openId)).toEqual(UNLOCKED);
        expect(await lockOf(readerToken, OPEN, openId)).toEqual(UNLOCKED);
        const openEdit = await stack.apiAs(editorToken, 'PATCH', `/data/${OPEN}/${openId}`, { name: 'edited' });
        expect(openEdit.status, await openEdit.text()).toBe(200);

        // ⭐ 4b — no pending approval left: decided, the held record unlocks,
        // the read says so, and the edit lands.
        const decided = await stack.apiAs(approverToken, 'POST', `/approvals/requests/${heldRequest.id}/approve`, {});
        expect(decided.status, await decided.clone().text()).toBe(200);
        expect(await pendingOn(HELD, heldId)).toEqual([]);
        expect(await lockOf(editorToken, HELD, heldId)).toEqual(UNLOCKED);
        expect(await lockOf(readerToken, HELD, heldId)).toEqual(UNLOCKED);
        const heldEdit = await stack.apiAs(editorToken, 'PATCH', `/data/${HELD}/${heldId}`, { name: 'edited' });
        expect(heldEdit.status, await heldEdit.text()).toBe(200);
      } finally {
        await stack.stop();
      }
    },
    120_000,
  );
});
