// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #26180 — the approver a step waits on reads the record the request is about,
// through the REST door on a real boot (ruling 6429330267, letter A).
//
// The object is `private`, so the baseline set lets a member read and edit only
// their own rows: neither approver can read the submitter's record by any grant
// the app wrote. The approvals service already resolves the slate; while a step
// is pending, each person on it (and the override holder) may READ the one
// record the request is about — no write, ending when the step resolves.
//
// Real `SecurityPlugin`, real sharing, real flows, real approvals plugin. A
// two-step flow: step one waits on the first approver, step two on the second.
//
//   ⭐ the first approver reads the record while step one is pending (by id and
//      in the list), and `explain` names the grant: "via approval request N";
//   ⭐ a member on no slate does not;
//   ⭐ the approver cannot write it;
//   ⭐ the override holder (a tenant administrator with no record bypass) reads
//      it while a step is pending;
//   ⭐ the step resolves and the read goes with it: approved and advanced (the
//      first approver loses it, the second gains it), approved at the last step
//      (the second loses it, and so does the override holder), rejected (the
//      approver of the rejected step loses it).
//
// The organization wall is pinned at the service (`plugin-approvals`
// `pending-approver-read-grant.integration.test.ts`): this boot is `single`,
// so it has one organization and no wall to cross.

import { describe, it, expect } from 'vitest';
import { bootStack } from '@objectstack/verify';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { defineStack, defineFlow } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { catalogPermissionSet } from './catalog-permission-set.js';

const OBJECT = 'apread_contract';
const SYS = { context: { isSystem: true } } as const;

const SUBMITTER = 'apread-submitter@verify.test';
/** Step one's slate, by email. */
const FIRST = 'apread-first@verify.test';
/** Step two's slate, by email. */
const SECOND = 'apread-second@verify.test';
/** On no slate; the baseline only. */
const STRANGER = 'apread-stranger@verify.test';
/** On no slate; holds the tenant-administrator rung without the record bypass. */
const OVERRIDER = 'apread-overrider@verify.test';

const contract = ObjectSchema.create({
  name: OBJECT,
  label: 'Approval Read Contract',
  pluralLabel: 'Approval Read Contracts',
  sharingModel: 'private',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

const flow = defineFlow({
  name: `${OBJECT}_flow`,
  label: 'Approval read flow',
  description: 'Fires on insert and opens two approval steps in turn, one approver each.',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'On Create', config: { objectName: OBJECT, triggerType: 'record-after-create' } },
    {
      id: 'first',
      type: 'approval',
      label: 'First',
      config: { approvers: [{ type: 'user', value: FIRST }], behavior: 'first_response', lockRecord: false },
    },
    {
      id: 'second',
      type: 'approval',
      label: 'Second',
      config: { approvers: [{ type: 'user', value: SECOND }], behavior: 'first_response', lockRecord: false },
    },
    { id: 'approved', type: 'end', label: 'Approved' },
    { id: 'rejected', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'first' },
    { id: 'e2', source: 'first', target: 'second', label: 'approve' },
    { id: 'e3', source: 'first', target: 'rejected', label: 'reject' },
    { id: 'e4', source: 'second', target: 'approved', label: 'approve' },
    { id: 'e5', source: 'second', target: 'rejected', label: 'reject' },
  ],
});

const stackConfig = defineStack({
  manifest: {
    id: 'com.dogfood.approval-pending-approver-record-read',
    namespace: 'apread',
    version: '0.0.0',
    type: 'app',
    name: 'Approval Pending Approver Record Read Fixture',
    description: 'A two-step approval flow on one private object.',
  },
  // ADR-0097: the `record-after-create` start node needs the trigger capability.
  requires: ['automation', 'triggers'],
  objects: [contract],
  flows: [flow],
});

/** Everyone's baseline: CRUD on the object, which `private` narrows to their own rows. */
const baselineSet: PermissionSet = PermissionSetSchema.parse({
  name: 'apread_baseline',
  label: 'Approval Read Baseline — own rows of the fixture object',
  objects: { [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false } },
});

describe('the approver a pending step waits on reads its record (#26180)', () => {
  it(
    'grants read of the one record to the pending slate and the override holder, never write, and ends with the step',
    async () => {
      const stack = await bootStack(stackConfig as unknown as Parameters<typeof bootStack>[0], {
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
        const grant = async (email: string, set: string) => {
          expect(await catalogPermissionSet(ql, set), `${set} is served by the catalog`).toBeTruthy();
          await ql.insert('sys_user_permission_set', { user_id: await idOf(email), permission_set: set }, SYS);
        };

        const submitter = await stack.signUp(SUBMITTER);
        const first = await stack.signUp(FIRST);
        const second = await stack.signUp(SECOND);
        const stranger = await stack.signUp(STRANGER);
        const overrider = await stack.signUp(OVERRIDER);
        await grant(OVERRIDER, baselineSet.name);
        // The tenant-administrator rung, wall-less: administers the
        // organization, carries no `viewAllRecords` (ADR-0105 D4) — so it reads
        // no one else's private row by its own grants.
        await grant(OVERRIDER, 'organization_admin_no_bypass');

        const create = async (name: string): Promise<string> => {
          const res = await stack.apiAs(submitter, 'POST', `/data/${OBJECT}`, { name });
          expect(res.status, await res.clone().text()).toBe(201);
          const body = (await res.json()) as { id?: string; record?: { id?: string } };
          return String(body.id ?? body.record?.id ?? '');
        };
        const pendingOn = async (recordId: string): Promise<Array<{ id: string; current_step?: string }>> =>
          ql.find('sys_approval_request', { where: { object_name: OBJECT, record_id: recordId, status: 'pending' }, context: SYS.context });
        const readStatus = async (token: string, recordId: string): Promise<number> =>
          (await stack.apiAs(token, 'GET', `/data/${OBJECT}/${encodeURIComponent(recordId)}`)).status;
        const listIds = async (token: string): Promise<string[]> => {
          const res = await stack.apiAs(token, 'GET', `/data/${OBJECT}`);
          expect(res.status, await res.clone().text()).toBe(200);
          const body = (await res.json()) as { records?: Array<{ id: string }>; data?: Array<{ id: string }> };
          return (body.records ?? body.data ?? []).map((r) => String(r.id)).sort();
        };
        const decide = async (token: string, requestId: string, verb: 'approve' | 'reject') => {
          const res = await stack.apiAs(token, 'POST', `/approvals/requests/${requestId}/${verb}`, {});
          expect(res.status, `${verb} ${requestId}: ${await res.clone().text()}`).toBe(200);
        };

        const ladderId = await create('ladder contract');
        const rejectId = await create('rejected contract');

        // The scene, before any read is believed: each record has one pending
        // request, on step one, and the submitter's private rows are out of
        // reach of every other member by their own grants (the stranger).
        const [ladderStepOne] = await pendingOn(ladderId);
        expect(ladderStepOne, 'the flow opened step one').toBeTruthy();
        const [rejectStepOne] = await pendingOn(rejectId);
        expect(rejectStepOne, 'the flow opened step one').toBeTruthy();
        expect(await readStatus(submitter, ladderId)).toBe(200);
        expect(await readStatus(stranger, ladderId)).toBe(404);
        expect(await listIds(stranger)).toEqual([]);

        // ⭐ 1 — the pending approver reads the record: by id and in the list.
        expect(await readStatus(first, ladderId)).toBe(200);
        expect(await listIds(first)).toEqual([ladderId, rejectId].sort());
        // …and the approver of a step not yet open reads nothing.
        expect(await readStatus(second, ladderId)).toBe(404);

        // ⭐ 2 — a member on no slate does not.
        expect(await readStatus(stranger, ladderId)).toBe(404);

        // ⭐ 3 — read only: the approver's edit is refused, and nothing lands.
        const edit = await stack.apiAs(first, 'PATCH', `/data/${OBJECT}/${ladderId}`, { name: 'edited by the approver' });
        expect(edit.status, await edit.clone().text()).toBe(403);
        const stored = await ql.findOne(OBJECT, { where: { id: ladderId }, context: SYS.context });
        expect(stored?.name).toBe('ladder contract');

        // ⭐ 4 — `explain` names the grant: "via approval request N".
        const explained = await stack.apiAs(first, 'POST', '/security/explain', {
          object: OBJECT, operation: 'read', recordId: ladderId,
        });
        const explainText = await explained.text();
        expect(explained.status, explainText).toBe(200);
        const decision = JSON.parse(explainText)?.data ?? JSON.parse(explainText);
        expect(decision.record).toMatchObject({ recordId: ladderId, visible: true });
        const sharing = (decision.layers ?? []).find((l: any) => l.layer === 'sharing');
        expect(sharing?.record?.outcome).toBe('admitted');
        expect(sharing?.record?.rules).toContainEqual({
          kind: 'record_share',
          name: ladderStepOne.id,
          grants: 'read',
          via: `approval request ${ladderStepOne.id}`,
          effect: 'admits',
        });

        // ⭐ 5 — the override holder reads it while a step is pending.
        expect(await readStatus(overrider, ladderId)).toBe(200);

        // ⭐ 6a — approved and ADVANCED: step one resolves, step two opens. The
        // first approver loses the read at once; the second gains it.
        await decide(first, ladderStepOne.id, 'approve');
        const [ladderStepTwo] = await pendingOn(ladderId);
        expect(ladderStepTwo, 'step two opened').toBeTruthy();
        expect(ladderStepTwo.id).not.toBe(ladderStepOne.id);
        expect(await readStatus(first, ladderId)).toBe(404);
        expect(await listIds(first)).toEqual([rejectId]);
        expect(await readStatus(second, ladderId)).toBe(200);
        expect(await readStatus(overrider, ladderId)).toBe(200);

        // ⭐ 6b — APPROVED at the last step: no pending step is left, so the
        // second approver and the override holder lose the read.
        await decide(second, ladderStepTwo.id, 'approve');
        expect(await pendingOn(ladderId)).toEqual([]);
        expect(await readStatus(second, ladderId)).toBe(404);
        expect(await readStatus(overrider, ladderId)).toBe(404);

        // ⭐ 6c — REJECTED: the approver of the rejected step loses the read.
        expect(await readStatus(first, rejectId)).toBe(200);
        await decide(first, rejectStepOne.id, 'reject');
        expect(await pendingOn(rejectId)).toEqual([]);
        expect(await readStatus(first, rejectId)).toBe(404);
        expect(await listIds(first)).toEqual([]);
        expect(await readStatus(overrider, rejectId)).toBe(404);
      } finally {
        await stack.stop();
      }
    },
    120_000,
  );
});
