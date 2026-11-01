// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Every door that ACTS on an approval request answers a caller who may not
// READ the request exactly what it answers an id that names no request — the
// read door's `404 REQUEST_NOT_FOUND` — measured at the HTTP door on a real
// boot (real `SecurityPlugin`, real flow, real approvals plugin).
//
// ── what is pinned ─────────────────────────────────────────────────────────
//
// The read door (`GET /approvals/requests/:id`) serves a request to its
// participants — submitter, pending approvers, past actors — and to the
// override actor, and answers everyone else `404 REQUEST_NOT_FOUND`, the same
// answer an unknown id gets. The doors that act on a request now ask that same
// rule first, before any refusal that depends on the row:
//
//   1. ⭐ for a plain member who is not a participant, `approve`, `reject`,
//      `recall`, `revise`, `resubmit`, `reassign`, `remind`, `request-info`
//      and `comment` answer the SAME status and body for an existing request
//      as for an id that names none: `404 REQUEST_NOT_FOUND` — on a pending
//      request, and on one already decided (its state is not told either);
//   2. a refused caller wrote nothing: the request is unchanged and its
//      action history gained no row.
//
// Controls, so a green run is not "everything is a 404":
//
//   - a caller who CAN read the request but may not take the action keeps the
//     door's own answer: the submitter is refused `403 FORBIDDEN` on the
//     approver's verbs, the approver on the submitter's verbs, and `resubmit`
//     on a pending request is `409 INVALID_STATE`; once the request is
//     decided, the submitter is told `409 INVALID_STATE`;
//   - the pending approver still decides (`200`);
//   - the administrator (the override actor) still decides a request whose
//     slate does not name them (`200`), and is told `404` for an id that
//     names nothing;
//   - the unknown id answers `404 REQUEST_NOT_FOUND` to a participant too.
//
// The service-level half — including the tenancy wall, the platform
// administrator's cross-organization override and the system context — is
// pinned in `packages/plugins/plugin-approvals/src/act-doors-read-visibility.test.ts`.

import { describe, it, expect } from 'vitest';
import { bootStack } from '@objectstack/verify';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { defineStack, defineFlow } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

const SHEET = 'actvis_sheet';
const SYS = { context: { isSystem: true } } as const;
const GHOST = 'areq_00000000-0000-4000-8000-000000000000';

const SUBMITTER = 'actvis-submitter@verify.test';
/** The one approver on the slate, by email. */
const APPROVER = 'actvis-approver@verify.test';
/** The baseline only: no participant of any request, reads only their own rows. */
const STRANGER = 'actvis-stranger@verify.test';

const sheet = ObjectSchema.create({
  name: SHEET,
  label: 'Act Visibility Sheet',
  pluralLabel: 'Act Visibility Sheets',
  sharingModel: 'private',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

const flow = defineFlow({
  name: `${SHEET}_flow`,
  label: 'Act visibility flow',
  description: `Fires on insert of ${SHEET} and opens one approval step on one named approver.`,
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'On Create', config: { objectName: SHEET, triggerType: 'record-after-create' } },
    {
      id: 'gate',
      type: 'approval',
      label: 'Gate',
      config: { approvers: [{ type: 'user', value: APPROVER }], behavior: 'first_response' },
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

const actVisStack = defineStack({
  manifest: {
    id: 'com.dogfood.approval-act-doors-read-visibility',
    namespace: 'actvis',
    version: '0.0.0',
    type: 'app',
    name: 'Approval Act Doors Read Visibility Fixture',
    description: 'One approval flow on one private object, for the doors that act on a request.',
  },
  // ADR-0097: the `record-after-create` start node needs the trigger capability.
  requires: ['automation', 'triggers'],
  objects: [sheet],
  flows: [flow],
});

/** Everyone's baseline: CRUD on the sheet, which `private` narrows to their own rows. */
const baselineSet: PermissionSet = PermissionSetSchema.parse({
  name: 'actvis_baseline',
  label: 'Act Visibility Baseline — own rows of the fixture object',
  objects: { [SHEET]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false } },
});

interface Answer { status: number; body: unknown }

/** The `code` of a flat (`{ code }`) or nested (`{ error: { code } }`) envelope. */
const codeOf = (a: Answer): unknown => (a.body as any)?.code ?? (a.body as any)?.error?.code;

/** The answer with the caller-supplied id written out, so the answers for two ids compare. */
const withoutId = (a: Answer, id: string): Answer =>
  JSON.parse(JSON.stringify(a).split(id).join('ID')) as Answer;

/** Every door that acts on one request, with a body each would accept from a caller it admits. */
const ACT_DOORS = (strangerId: string): Array<[string, Record<string, unknown>]> => [
  ['approve', {}],
  ['approve', { outputs: { next_reviewers: [strangerId] } }],
  ['reject', { comment: 'no' }],
  ['recall', {}],
  ['revise', { comment: 'rework' }],
  ['resubmit', {}],
  ['reassign', { to: strangerId }],
  ['remind', {}],
  ['request-info', { comment: 'more?' }],
  ['comment', { comment: 'hello' }],
];

describe('the doors that act on an approval request answer an unreadable request as a missing one', () => {
  it(
    'answers a non-participant 404 REQUEST_NOT_FOUND on every act door, the same as for no request, and leaves the readers, the approver and the override as they were',
    async () => {
      const stack = await bootStack(actVisStack as unknown as Parameters<typeof bootStack>[0], {
        automation: true,
        security: new SecurityPlugin({
          defaultPermissionSets: [...securityDefaultPermissionSets, baselineSet],
          fallbackPermissionSet: baselineSet.name,
        }),
        extraPlugins: [new RecordChangeTriggerPlugin(), new ApprovalsServicePlugin()],
      });
      try {
        const ql: any = await stack.kernel.getServiceAsync('objectql');
        const idOf = async (email: string): Promise<string> =>
          String((await ql.findOne('sys_user', { where: { email }, context: SYS.context }))?.id ?? '');

        const adminToken = await stack.signIn();
        const submitterToken = await stack.signUp(SUBMITTER);
        const approverToken = await stack.signUp(APPROVER);
        const strangerToken = await stack.signUp(STRANGER);
        const strangerId = await idOf(STRANGER);
        expect(strangerId, 'the stranger is provisioned').toBeTruthy();

        const call = async (token: string, method: string, path: string, body?: unknown): Promise<Answer> => {
          const res = await stack.apiAs(token, method, path, body);
          let parsed: unknown;
          try { parsed = await res.json(); } catch { parsed = undefined; }
          return { status: res.status, body: parsed };
        };
        const act = (token: string, id: string, door: string, body: Record<string, unknown>) =>
          call(token, 'POST', `/approvals/requests/${encodeURIComponent(id)}/${door}`, body);

        /** Open one request: the submitter creates a sheet row, the flow opens its approval. */
        const open = async (name: string) => {
          const created = await stack.apiAs(submitterToken, 'POST', `/data/${SHEET}`, { name });
          expect(created.status, await created.clone().text()).toBe(201);
          const body = (await created.json()) as { id?: string; record?: { id?: string } };
          const recordId = String(body.id ?? body.record?.id ?? '');
          const [request] = await ql.find('sys_approval_request', {
            where: { object_name: SHEET, record_id: recordId, status: 'pending' }, context: SYS.context,
          });
          expect(request, `the flow opened a pending request on ${name}`).toBeTruthy();
          return request as { id: string; status: string };
        };
        const stored = async (id: string) =>
          ql.findOne('sys_approval_request', { where: { id }, context: SYS.context });
        const historyOf = async (id: string) =>
          ql.find('sys_approval_action', { where: { request_id: id }, context: SYS.context });

        const first = await open('first');
        const second = await open('second');

        // The scene, before any answer is believed: the read door serves the
        // request to its submitter and its approver, and answers the stranger
        // exactly what it answers an id that names nothing.
        const read = (token: string, id: string) => call(token, 'GET', `/approvals/requests/${encodeURIComponent(id)}`);
        expect((await read(submitterToken, first.id)).status).toBe(200);
        expect((await read(approverToken, first.id)).status).toBe(200);
        const strangerRead = await read(strangerToken, first.id);
        expect(strangerRead.status).toBe(404);
        expect(codeOf(strangerRead)).toBe('REQUEST_NOT_FOUND');
        expect(withoutId(strangerRead, first.id)).toEqual(withoutId(await read(strangerToken, GHOST), GHOST));

        const before = { row: await stored(first.id), history: (await historyOf(first.id)).length };

        // ⭐ 1 — every act door, pending request: the stranger gets the answer
        // an id that names no request gets — status AND body.
        for (const [door, body] of ACT_DOORS(strangerId)) {
          const existing = await act(strangerToken, first.id, door, body);
          const missing = await act(strangerToken, GHOST, door, body);
          const label = `${door} ${JSON.stringify(body)}`;
          expect(existing.status, label).toBe(404);
          expect(codeOf(existing), label).toBe('REQUEST_NOT_FOUND');
          expect(withoutId(existing, first.id), label).toEqual(withoutId(missing, GHOST));
        }

        // ⭐ 2 — and nothing was written: the row and its history are as they were.
        expect(await stored(first.id)).toEqual(before.row);
        expect(await historyOf(first.id)).toHaveLength(before.history);

        // Control — a caller who CAN read the request keeps the door's own refusal.
        const forbidden = async (token: string, door: string, body: Record<string, unknown>) => {
          const answer = await act(token, first.id, door, body);
          expect(answer.status, `${door}: ${JSON.stringify(answer.body)}`).toBe(403);
          expect(codeOf(answer), door).toBe('FORBIDDEN');
        };
        // The submitter, on the approver's verbs.
        await forbidden(submitterToken, 'approve', {});
        await forbidden(submitterToken, 'reject', { comment: 'no' });
        await forbidden(submitterToken, 'revise', { comment: 'rework' });
        await forbidden(submitterToken, 'reassign', { to: strangerId });
        await forbidden(submitterToken, 'request-info', { comment: 'more?' });
        // The approver, on the submitter's verbs.
        await forbidden(approverToken, 'recall', {});
        await forbidden(approverToken, 'remind', {});
        // `resubmit` applies to a returned request; on a pending one a reader is told its state.
        const resubmitPending = await act(submitterToken, first.id, 'resubmit', {});
        expect(resubmitPending.status).toBe(409);
        expect(codeOf(resubmitPending)).toBe('INVALID_STATE');
        // The unknown id is a 404 for a participant too.
        expect(codeOf(await act(submitterToken, GHOST, 'approve', {}))).toBe('REQUEST_NOT_FOUND');

        // Control — the pending approver still decides.
        const decided = await act(approverToken, first.id, 'approve', {});
        expect(decided.status, JSON.stringify(decided.body)).toBe(200);
        expect((await stored(first.id))?.status).toBe('approved');

        // ⭐ 1, decided request — its state is not told to the stranger either…
        for (const [door, body] of ACT_DOORS(strangerId)) {
          const existing = await act(strangerToken, first.id, door, body);
          const missing = await act(strangerToken, GHOST, door, body);
          const label = `decided · ${door} ${JSON.stringify(body)}`;
          expect(existing.status, label).toBe(404);
          expect(withoutId(existing, first.id), label).toEqual(withoutId(missing, GHOST));
        }
        // …while a reader of it is.
        const decidedForReader = await act(submitterToken, first.id, 'approve', {});
        expect(decidedForReader.status).toBe(409);
        expect(codeOf(decidedForReader)).toBe('INVALID_STATE');

        // Control — the administrator, on no slate, decides through the override,
        // and is told 404 for an id that names nothing.
        expect(codeOf(await act(adminToken, GHOST, 'approve', {}))).toBe('REQUEST_NOT_FOUND');
        const overridden = await act(adminToken, second.id, 'approve', {});
        expect(overridden.status, JSON.stringify(overridden.body)).toBe(200);
        expect((await stored(second.id))?.status).toBe('approved');
      } finally {
        await stack.stop();
      }
    },
    180_000,
  );
});
