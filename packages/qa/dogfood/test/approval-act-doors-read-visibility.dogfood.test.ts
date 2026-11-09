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
// The same answer, at three more places:
//
//   3. ⭐ the ACTION door (`POST /actions/sys_approval_request/:action`, which
//      forwards the request page's `type: 'api'` approval actions to the
//      routes above with the caller's own credentials) answers the
//      non-participant the same status and body for an existing request as
//      for an id that names none — the forward relays the route's refusal, so
//      the refusal must not tell the two apart either;
//   4. ⭐ a RETURNED (sent back) request, beside the pending and decided ones:
//      every act door answers the non-participant as for no request, and its
//      state is not told;
//   5. ⭐ the walled posture (`isolated`), across organizations: the owner of
//      another organization gets, on every act door, the answer an id that
//      names no request gets, and the request is not touched.
//
// Each has a control: on the action door, the submitter is relayed the
// route's `403 FORBIDDEN` and the approver decides (`200`); on a returned
// request, the approver who sent it back is told `409 INVALID_STATE` and the
// submitter resubmits (`200`); behind the wall, the submitter (a member of
// organization A) is refused `403 FORBIDDEN`, the approver (a member of A)
// decides, and A's own administrator decides through the override.
//
// And one rule on the submitter's own verbs: a request with no submitter (a run
// whose trigger resolved no user) is recalled, reminded or resubmitted only by the
// system or the override actor. A pending approver and a record reader, who read
// it, are refused `403 FORBIDDEN` with the refusal any non-submitter gets; a plain
// member, who does not, gets `404`; the request is unchanged. Controls: a system
// context reminds and resubmits it, the administrator recalls it while pending,
// and a request with a submitter is reminded and recalled by its submitter.
//
// The service-level half — including the tenancy wall, the platform
// administrator's cross-organization override and the system context — is
// pinned in `packages/plugins/plugin-approvals/src/approval-service.test.ts`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
  description: `Fires on insert of ${SHEET} and opens one approval step on one named approver, with a revise window.`,
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
    // ADR-0044 revise window, so a request can be sent back (`returned`) and resubmitted.
    { id: 'rework', type: 'approval_revise', label: 'Awaiting Revision' },
    { id: 'approved', type: 'end', label: 'Approved' },
    { id: 'rejected', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'gate' },
    { id: 'e2', source: 'gate', target: 'approved', label: 'approve' },
    { id: 'e3', source: 'gate', target: 'rejected', label: 'reject' },
    { id: 'e4', source: 'gate', target: 'rework', label: 'revise' },
    { id: 'e5', source: 'rework', target: 'gate', label: 'resubmit', type: 'back' },
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


/**
 * The action door's name for each act door, with the params the request page
 * sends: `POST /actions/sys_approval_request/:action` forwards each to the
 * route of the same verb (`approval_send_back` → `revise`).
 */
const ACTION_DOOR_ACTIONS = (strangerId: string): Array<[string, Record<string, unknown>]> => [
  ['approval_approve', {}],
  ['approval_reject', { comment: 'no' }],
  ['approval_reassign', { to: strangerId }],
  ['approval_send_back', { comment: 'rework' }],
  ['approval_request_info', { comment: 'more?' }],
  ['approval_remind', {}],
  ['approval_recall', {}],
  ['approval_resubmit', {}],
  ['approval_comment', { comment: 'hello' }],
];

type BootOptions = Parameters<typeof bootStack>[1];

/** One boot of the fixture, and the calls every case below makes on it. */
async function bootScene(extra: Partial<NonNullable<BootOptions>> = {}) {
  const stack = await bootStack(actVisStack as unknown as Parameters<typeof bootStack>[0], {
    automation: true,
    security: new SecurityPlugin({
      defaultPermissionSets: [...securityDefaultPermissionSets, baselineSet],
      fallbackPermissionSet: baselineSet.name,
    }),
    extraPlugins: [new RecordChangeTriggerPlugin(), new ApprovalsServicePlugin()],
    ...extra,
  });
  const ql: any = await stack.kernel.getServiceAsync('objectql');
  const idOf = async (email: string): Promise<string> =>
    String((await ql.findOne('sys_user', { where: { email }, context: SYS.context }))?.id ?? '');
  const call = async (token: string, method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    let parsed: unknown;
    try { parsed = await res.json(); } catch { parsed = undefined; }
    return { status: res.status, body: parsed };
  };
  const act = (token: string, id: string, door: string, body: Record<string, unknown>) =>
    call(token, 'POST', `/approvals/requests/${encodeURIComponent(id)}/${door}`, body);
  const read = (token: string, id: string) => call(token, 'GET', `/approvals/requests/${encodeURIComponent(id)}`);
  /** Open one request: the submitter creates a sheet row, the flow opens its approval. */
  const open = async (submitterToken: string, name: string) => {
    const created = await stack.apiAs(submitterToken, 'POST', `/data/${SHEET}`, { name });
    expect(created.status, await created.clone().text()).toBe(201);
    const body = (await created.json()) as { id?: string; record?: { id?: string } };
    const recordId = String(body.id ?? body.record?.id ?? '');
    const [request] = await ql.find('sys_approval_request', {
      where: { object_name: SHEET, record_id: recordId, status: 'pending' }, context: SYS.context,
    });
    expect(request, `the flow opened a pending request on ${name}`).toBeTruthy();
    return request as { id: string; status: string; organization_id?: string | null };
  };
  const stored = async (id: string) =>
    ql.findOne('sys_approval_request', { where: { id }, context: SYS.context });
  const historyOf = async (id: string) =>
    ql.find('sys_approval_action', { where: { request_id: id }, context: SYS.context });
  /** The request row and its action history, to show a refused caller wrote nothing. */
  const snapshot = async (id: string) => ({ row: await stored(id), history: (await historyOf(id)).length });
  /**
   * ⭐ Every act door, for a caller who may not read `id`: the answer an id
   * that names no request gets — status AND body — and nothing written.
   */
  const expectAnsweredAsMissing = async (token: string, id: string, doors: Array<[string, Record<string, unknown>]>, state: string) => {
    const before = await snapshot(id);
    for (const [door, body] of doors) {
      const existing = await act(token, id, door, body);
      const missing = await act(token, GHOST, door, body);
      const label = `${state} · ${door} ${JSON.stringify(body)} → ${JSON.stringify(existing.body)}`;
      expect(existing.status, label).toBe(404);
      expect(codeOf(existing), label).toBe('REQUEST_NOT_FOUND');
      expect(withoutId(existing, id), label).toEqual(withoutId(missing, GHOST));
    }
    expect(await snapshot(id), `${state} · nothing was written`).toEqual(before);
  };
  /** The read door serves `id` to `readers` and answers `outsider` what it answers an id that names nothing. */
  const expectReadScene = async (readers: string[], outsider: string, id: string) => {
    for (const token of readers) expect((await read(token, id)).status).toBe(200);
    const outsiderRead = await read(outsider, id);
    expect(outsiderRead.status).toBe(404);
    expect(codeOf(outsiderRead)).toBe('REQUEST_NOT_FOUND');
    expect(withoutId(outsiderRead, id)).toEqual(withoutId(await read(outsider, GHOST), GHOST));
  };
  return { stack, ql, idOf, call, act, read, open, stored, historyOf, snapshot, expectAnsweredAsMissing, expectReadScene };
}

describe('the doors that act on an approval request answer an unreadable request as a missing one', () => {
  let scene: Awaited<ReturnType<typeof bootScene>>;
  let adminToken: string;
  let submitterToken: string;
  let approverToken: string;
  let strangerToken: string;
  let strangerId: string;

  beforeAll(async () => {
    scene = await bootScene();
    adminToken = await scene.stack.signIn();
    submitterToken = await scene.stack.signUp(SUBMITTER);
    approverToken = await scene.stack.signUp(APPROVER);
    strangerToken = await scene.stack.signUp(STRANGER);
    strangerId = await scene.idOf(STRANGER);
    expect(strangerId, 'the stranger is provisioned').toBeTruthy();
  }, 180_000);

  afterAll(async () => {
    await scene?.stack.stop();
  });

  it(
    'answers a non-participant 404 REQUEST_NOT_FOUND on every act door, the same as for no request, and leaves the readers, the approver and the override as they were',
    async () => {
      const { act, open, stored, expectAnsweredAsMissing, expectReadScene } = scene;
      const first = await open(submitterToken, 'first');
      const second = await open(submitterToken, 'second');

      // The scene, before any answer is believed: the read door serves the
      // request to its submitter and its approver, and answers the stranger
      // exactly what it answers an id that names nothing.
      await expectReadScene([submitterToken, approverToken], strangerToken, first.id);

      // ⭐ 1 + 2 — every act door, pending request: the stranger gets the
      // answer an id that names no request gets, and nothing was written.
      await expectAnsweredAsMissing(strangerToken, first.id, ACT_DOORS(strangerId), 'pending');

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
      await expectAnsweredAsMissing(strangerToken, first.id, ACT_DOORS(strangerId), 'decided');
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
    },
    180_000,
  );

  it(
    'the action door answers a non-participant the same status and body for an existing request as for an id that names none, and still relays a reader\'s refusal and the approver\'s decision',
    async () => {
      const { call, open, stored, snapshot } = scene;
      const request = await open(submitterToken, 'action-door');
      const viaDoor = (token: string, action: string, recordId: string, params: Record<string, unknown>) =>
        call(token, 'POST', `/actions/sys_approval_request/${action}`, { recordId, params });

      // ⭐ 3 — every approval action the request page offers, through the door.
      const before = await snapshot(request.id);
      for (const [action, params] of ACTION_DOOR_ACTIONS(strangerId)) {
        const existing = await viaDoor(strangerToken, action, request.id, params);
        const missing = await viaDoor(strangerToken, action, GHOST, params);
        const label = `${action} ${JSON.stringify(params)} → ${JSON.stringify(existing.body)}`;
        expect(existing.status, label).toBe(404);
        expect(codeOf(existing), label).toBe('REQUEST_NOT_FOUND');
        expect(withoutId(existing, request.id), label).toEqual(withoutId(missing, GHOST));
      }
      expect(await snapshot(request.id), 'nothing was written').toEqual(before);

      // Control — a reader who may not decide is relayed the route's own refusal…
      const submitterApprove = await viaDoor(submitterToken, 'approval_approve', request.id, {});
      expect(submitterApprove.status, JSON.stringify(submitterApprove.body)).toBe(403);
      expect(codeOf(submitterApprove)).toBe('FORBIDDEN');
      // …and the pending approver decides through the door.
      const decided = await viaDoor(approverToken, 'approval_approve', request.id, {});
      expect(decided.status, JSON.stringify(decided.body)).toBe(200);
      expect((await stored(request.id))?.status).toBe('approved');
    },
    180_000,
  );

  it(
    'a returned (sent back) request answers a non-participant as no request on every act door, while its approver is told its state and its submitter resubmits',
    async () => {
      const { act, open, stored, ql, expectAnsweredAsMissing, expectReadScene } = scene;
      const request = await open(submitterToken, 'returned');

      const sentBack = await act(approverToken, request.id, 'revise', { comment: 'rework' });
      expect(sentBack.status, JSON.stringify(sentBack.body)).toBe(200);
      expect((await stored(request.id))?.status).toBe('returned');

      // The scene: the submitter and the approver who sent it back still read it; the stranger does not.
      await expectReadScene([submitterToken, approverToken], strangerToken, request.id);

      // ⭐ 4 — every act door, returned request.
      await expectAnsweredAsMissing(strangerToken, request.id, ACT_DOORS(strangerId), 'returned');

      // Control — the approver who sent it back reads it, and is told its state.
      const approveReturned = await act(approverToken, request.id, 'approve', {});
      expect(approveReturned.status, JSON.stringify(approveReturned.body)).toBe(409);
      expect(codeOf(approveReturned)).toBe('INVALID_STATE');
      // Control — the submitter resubmits: round 2 opens a fresh pending request.
      const resubmitted = await act(submitterToken, request.id, 'resubmit', {});
      expect(resubmitted.status, JSON.stringify(resubmitted.body)).toBe(200);
      const round2 = await ql.find('sys_approval_request', {
        where: { object_name: SHEET, record_id: (await stored(request.id))?.record_id, status: 'pending' }, context: SYS.context,
      });
      expect(round2, 'the resubmit opened round 2').toHaveLength(1);
      expect(round2[0].id).not.toBe(request.id);
    },
    180_000,
  );
});

describe('behind the organization wall (isolated posture), the act doors answer another organization\'s request as a missing one', () => {
  /** The owner of organization A: its administrator, so the override actor on A's requests. */
  const OWNER_A = 'actvis-wall-owner-a@verify.test';
  /** A plain member of A, who submits. */
  const SUBMITTER_A = 'actvis-wall-submitter@verify.test';
  /** A plain member of A, and the flow's one approver (the flow names the approver by this email). */
  const APPROVER_A = APPROVER;
  /** The owner of organization B: an administrator, but of another organization. */
  const OWNER_B = 'actvis-wall-owner-b@verify.test';

  it(
    'answers the other organization\'s owner 404 REQUEST_NOT_FOUND on every act door, the same as for no request, while organization A\'s readers and administrator keep the doors\' own answers',
    async () => {
      const scene = await bootScene({ multiTenant: 'posture-only' });
      const { stack, ql, idOf, act, open, stored, expectAnsweredAsMissing, expectReadScene } = scene;
      try {
        const ownerAToken = await stack.signUp(OWNER_A);
        const submitterToken = await stack.signUp(SUBMITTER_A);
        const approverToken = await stack.signUp(APPROVER_A);
        const ownerBToken = await stack.signUp(OWNER_B);
        const ownerBId = await idOf(OWNER_B);
        expect(ownerBId, 'the owner of B is provisioned').toBeTruthy();

        const setActive = async (token: string, organizationId: string) => {
          const active = await stack.apiAs(token, 'POST', '/auth/organization/set-active', { organizationId });
          expect(active.status, await active.clone().text()).toBe(200);
        };
        /** `token` creates an organization, owns it, and makes it active. */
        const createOrg = async (token: string, slug: string): Promise<string> => {
          const created = await stack.apiAs(token, 'POST', '/auth/organization/create', { name: slug, slug });
          expect(created.status, await created.clone().text()).toBe(200);
          const id = String(((await created.json()) as { id?: string }).id ?? '');
          await setActive(token, id);
          return id;
        };
        const orgA = await createOrg(ownerAToken, 'actvis-wall-a');
        const orgB = await createOrg(ownerBToken, 'actvis-wall-b');
        // The submitter and the approver are plain members of A.
        for (const [email, token] of [[SUBMITTER_A, submitterToken], [APPROVER_A, approverToken]] as const) {
          await ql.insert('sys_member', { user_id: await idOf(email), organization_id: orgA, role: 'member' }, { context: SYS.context });
          await setActive(token, orgA);
        }

        const request = await open(submitterToken, 'walled');
        const overrideOnly = await open(submitterToken, 'walled-override');

        // PRECONDITION: a real wall, two organizations, the request in A.
        const tenancy = await stack.kernel.getServiceAsync<{ posture: string; degraded: boolean }>('tenancy');
        expect(tenancy.posture).toBe('isolated');
        expect(tenancy.degraded).toBe(false);
        expect(orgA).not.toBe(orgB);
        expect((await stored(request.id))?.organization_id).toBe(orgA);
        await expectReadScene([submitterToken, approverToken], ownerBToken, request.id);

        // ⭐ 5 — every act door, across the wall.
        await expectAnsweredAsMissing(ownerBToken, request.id, ACT_DOORS(ownerBId), 'walled · pending');

        // Control — organization A's readers keep the doors' own answers: the
        // submitter is refused the approver's verb, and the approver decides.
        const submitterApprove = await act(submitterToken, request.id, 'approve', {});
        expect(submitterApprove.status, JSON.stringify(submitterApprove.body)).toBe(403);
        expect(codeOf(submitterApprove)).toBe('FORBIDDEN');
        const decided = await act(approverToken, request.id, 'approve', {});
        expect(decided.status, JSON.stringify(decided.body)).toBe(200);
        expect((await stored(request.id))?.status).toBe('approved');
        // Control — A's own administrator, on no slate, decides through the
        // override: the administrator of B above was refused as a stranger, not
        // as an administrator.
        const overridden = await act(ownerAToken, overrideOnly.id, 'approve', {});
        expect(overridden.status, JSON.stringify(overridden.body)).toBe(200);
        expect((await stored(overrideOnly.id))?.status).toBe('approved');
      } finally {
        await stack.stop();
      }
    },
    180_000,
  );
});

describe('a request with no submitter is recalled, reminded or resubmitted only by the system or the override actor, at the HTTP door', () => {
  /** Reads every row of the fixture object, so the record-reader tier serves them its requests. */
  const READER = 'actvis-nosub-reader@verify.test';
  /** A plain member: the baseline only, on no slate. */
  const MEMBER = 'actvis-nosub-member@verify.test';
  const NOSUB_SUBMITTER = 'actvis-nosub-submitter@verify.test';

  /** The reader's widening: read every row of the fixture object, edit none it does not own. */
  const readAllSet: PermissionSet = PermissionSetSchema.parse({
    name: 'actvis_read_all',
    label: 'Act Visibility Read All — every row of the fixture object, read only',
    objects: { [SHEET]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false, viewAllRecords: true } },
  });

  it(
    'refuses a pending approver, a record reader and a plain member on recall, remind and resubmit and leaves the request as it was, while the system, the override actor and a submitted request act as before',
    async () => {
      const scene = await bootScene({
        security: new SecurityPlugin({
          defaultPermissionSets: [...securityDefaultPermissionSets, baselineSet, readAllSet],
          fallbackPermissionSet: baselineSet.name,
        }),
        // The opt-in record-reader tier, on for the fixture object: a reader of the record reads its requests.
        extraPlugins: [new RecordChangeTriggerPlugin(), new ApprovalsServicePlugin({ recordReaderVisibleObjects: [SHEET] })],
      });
      const { stack, ql, idOf, act, read, open, stored, snapshot } = scene;
      try {
        const adminToken = await stack.signIn();
        const submitterToken = await stack.signUp(NOSUB_SUBMITTER);
        const approverToken = await stack.signUp(APPROVER);
        const readerToken = await stack.signUp(READER);
        const memberToken = await stack.signUp(MEMBER);
        await ql.insert('sys_user_permission_set', { user_id: await idOf(READER), permission_set: readAllSet.name }, SYS);
        const memberId = await idOf(MEMBER);

        // The organization the members act in: the one a member's own request lands in.
        const submitted = await open(submitterToken, 'nosub-yardstick');
        const org = (await stored(submitted.id))?.organization_id ?? null;

        /**
         * Open one request the way a run whose trigger resolved no user does: the
         * record is written by a system context (in the members' organization),
         * so the flow it starts has no user, and its approval no submitter.
         */
        const openWithoutSubmitter = async (name: string) => {
          const record = await ql.insert(SHEET, { name }, { context: { isSystem: true, ...(org ? { tenantId: org } : {}) } });
          const recordId = String((record as { id?: string })?.id ?? '');
          const [request] = await ql.find('sys_approval_request', {
            where: { object_name: SHEET, record_id: recordId, status: 'pending' }, context: SYS.context,
          });
          expect(request, `the flow opened a pending request on ${name}`).toBeTruthy();
          expect(request.submitter_id ?? null, `${name}: nobody submitted it`).toBeNull();
          expect(request.organization_id ?? null, `${name}: it is in the members' organization`).toBe(org);
          return request as { id: string };
        };
        const sendBack = async (id: string) => {
          const sent = await act(approverToken, id, 'revise', { comment: 'rework' });
          expect(sent.status, JSON.stringify(sent.body)).toBe(200);
          expect((await stored(id))?.status).toBe('returned');
        };

        const pending = await openWithoutSubmitter('nosub-pending');
        const returned = await openWithoutSubmitter('nosub-returned');
        await sendBack(returned.id);

        // The scene: the approver and the reader read both requests; the plain member reads neither.
        for (const id of [pending.id, returned.id]) {
          expect((await read(approverToken, id)).status, 'the approver reads it').toBe(200);
          expect((await read(readerToken, id)).status, 'the record reader reads it').toBe(200);
          expect((await read(memberToken, id)).status, 'the plain member does not').toBe(404);
        }

        // ⭐ Every caller who is not the system or the override actor is refused
        // all three verbs, and nothing is written.
        const before = { pending: await snapshot(pending.id), returned: await snapshot(returned.id) };
        const verbs: Array<[string, string]> = [
          ['recall', pending.id], ['recall', returned.id], ['remind', pending.id], ['resubmit', returned.id],
        ];
        for (const [who, token, expected] of [
          ['the pending approver', approverToken, 403],
          ['a record reader', readerToken, 403],
          ['a plain member', memberToken, 404],
        ] as const) {
          for (const [verb, id] of verbs) {
            const answer = await act(token, id, verb, {});
            const label = `${who} · ${verb} · ${id === pending.id ? 'pending' : 'returned'} → ${JSON.stringify(answer.body)}`;
            expect(answer.status, label).toBe(expected);
            expect(codeOf(answer), label).toBe(expected === 403 ? 'FORBIDDEN' : 'REQUEST_NOT_FOUND');
          }
        }
        expect(await snapshot(pending.id), 'nothing was written on the pending request').toEqual(before.pending);
        expect(await snapshot(returned.id), 'nothing was written on the returned request').toEqual(before.returned);
        // The refusal is the one a non-submitter gets on a request that has a submitter.
        const yardstick = await act(approverToken, submitted.id, 'remind', {});
        const refused = await act(approverToken, pending.id, 'remind', {});
        expect(withoutId(refused, pending.id)).toEqual(withoutId(yardstick, submitted.id));

        // Control — a system context still reminds and resubmits it…
        const svc: any = await stack.kernel.getServiceAsync('approvals');
        await svc.remind(pending.id, { actorId: 'sys_job' }, { isSystem: true, ...(org ? { tenantId: org } : {}) });
        expect((await scene.historyOf(pending.id)).some((a: any) => a.action === 'remind')).toBe(true);
        await svc.resubmit(returned.id, { actorId: 'sys_job' }, { isSystem: true, ...(org ? { tenantId: org } : {}) });
        expect((await scene.historyOf(returned.id)).some((a: any) => a.action === 'resubmit')).toBe(true);
        // …and the override actor (the administrator, on no slate) recalls it while pending.
        const recalled = await act(adminToken, pending.id, 'recall', {});
        expect(recalled.status, JSON.stringify(recalled.body)).toBe(200);
        expect((await stored(pending.id))?.status).toBe('recalled');

        // Control — a request that has a submitter: the submitter reminds and recalls it.
        const reminded = await act(submitterToken, submitted.id, 'remind', {});
        expect(reminded.status, JSON.stringify(reminded.body)).toBe(200);
        const ownRecall = await act(submitterToken, submitted.id, 'recall', {});
        expect(ownRecall.status, JSON.stringify(ownRecall.body)).toBe(200);
        expect((await stored(submitted.id))?.status).toBe('recalled');
        expect(memberId, 'the plain member is provisioned').toBeTruthy();
      } finally {
        await stack.stop();
      }
    },
    180_000,
  );
});
