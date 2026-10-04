// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20964] A snapshot field the reading approver is served MASKED on the data
// plane is not served as stored through the approvals inbox, on a real boot.
//
// ## The composition
//
// `bootStack` with the real `SecurityPlugin`, `ObjectQL`, SQL driver, REST and
// auth layers, plus automation, the record-change trigger and the approvals
// plugin. One synthetic object carries one field with a `maskingRule` gated on
// a capability; a flow routes each new record to a position two approvers hold:
//
//   - a member, for whom the rule applies (the data plane serves the field
//     masked to them); and
//   - an unmasker, who holds the capability that lifts it (the data plane
//     serves the stored value): the control.
//
// The submitter holds the capability too, because a field gated on a
// capability is not writable without it.
//
// ## What is asserted, by class
//
// - The scene is real before anything is read off it: the request exists, its
//   stored snapshot carries the stored value, and the data plane serves the
//   field masked to the member (the reference) and stored to the unmasker.
// - For the member, the inbox list, the inbox item and the generic data door on
//   the request object do not carry the key at all. The redaction drops a
//   masked-for-this-caller field rather than reproducing the mask: the
//   contract publishes which fields are masked for a caller, not the masked
//   value.
// - For the unmasker, the same three reads carry the stored value.
//
// Fixtures are synthetic. `@objectstack/plugin-approvals` and
// `@objectstack/trigger-record-change` resolve to SOURCE here (this project's
// alias), so the verdict is about the checkout, not the last build.

import { describe, it, expect } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { defineStack, defineFlow } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

const OBJECT = 'snapmask_item';
const POSITION = 'snapmask_reviewer';
const CAPABILITY = 'snapmask_unmask';
const KEY = 'snapmask_code';
/** Synthetic stored value. */
const STORED = 'SYNTH4421VALUE';
const SYS = { context: { isSystem: true } } as const;

const SnapmaskItem = ObjectSchema.create({
  name: OBJECT,
  label: 'Snapshot Mask Item',
  pluralLabel: 'Snapshot Mask Items',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    [KEY]: Field.text({ label: 'Code', maskingRule: { keepHead: 1, keepTail: 1 }, requiredPermissions: [CAPABILITY] }),
  },
});

const SnapmaskFlow = defineFlow({
  name: 'snapmask_flow',
  label: 'Snapshot Mask Flow',
  description: 'Routes each new item to the reviewer position.',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'On Create', config: { objectName: OBJECT, triggerType: 'record-after-create' } },
    {
      id: 'gate',
      type: 'approval',
      label: 'Gate',
      config: { approvers: [{ type: 'position', value: POSITION }], behavior: 'first_response' },
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

const snapmaskStack = defineStack({
  manifest: {
    id: 'com.dogfood.snapshot-mask',
    namespace: 'snapmask',
    version: '0.0.0',
    type: 'app',
    name: 'Snapshot Mask Fixture',
    description: 'One object with one capability-gated masked field, one approval flow.',
  },
  // ADR-0097: the flow's record-change start node needs both capabilities.
  requires: ['automation', 'triggers'],
  objects: [SnapmaskItem],
  flows: [SnapmaskFlow],
});

/** Every fresh member: read and create on the object, read on the request object. */
const baselineSet = PermissionSetSchema.parse({
  name: 'snapmask_baseline',
  label: 'Snapshot mask baseline',
  objects: {
    [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false },
    sys_approval_request: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
  },
});
/** The same grants plus the capability the masking rule names as its unmask gate. */
const unmaskSet = PermissionSetSchema.parse({
  name: 'snapmask_unmasker',
  label: 'Snapshot mask unmasker',
  objects: {
    [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false },
    sys_approval_request: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
  },
  systemPermissions: [CAPABILITY],
});

interface Reads {
  list: Record<string, unknown>;
  /** The inbox list row's label map, built from the served snapshot's keys. */
  listLabels: Record<string, unknown>;
  item: Record<string, unknown>;
  generic: Record<string, unknown>;
  dataPlane: Record<string, unknown>;
}

/** The three approval reads and the data-plane reference, as one caller. */
async function readAs(stack: VerifyStack, token: string, recordId: string): Promise<Reads> {
  const listRes = await stack.apiAs(token, 'GET', '/approvals/requests?status=pending');
  expect(listRes.status).toBe(200);
  const listBody = (await listRes.json()) as { data: Array<Record<string, unknown>> };
  const rows = listBody.data.filter((r) => r.object_name === OBJECT);
  expect(rows).toHaveLength(1);
  const requestId = String(rows[0].id);

  const itemRes = await stack.apiAs(token, 'GET', `/approvals/requests/${requestId}`);
  expect(itemRes.status).toBe(200);
  const item = (await itemRes.json()) as Record<string, unknown>;

  const genericRes = await stack.apiAs(token, 'GET', `/data/sys_approval_request/${requestId}`);
  expect(genericRes.status).toBe(200);
  const genericBody = (await genericRes.json()) as { record?: Record<string, unknown> };
  const genericRow = genericBody.record ?? (genericBody as Record<string, unknown>);

  const dataRes = await stack.apiAs(token, 'GET', `/data/${OBJECT}/${recordId}`);
  expect(dataRes.status).toBe(200);
  const dataBody = (await dataRes.json()) as { record?: Record<string, unknown> };

  return {
    list: (rows[0].payload ?? {}) as Record<string, unknown>,
    listLabels: (rows[0].payload_labels ?? {}) as Record<string, unknown>,
    item: (item.payload ?? {}) as Record<string, unknown>,
    generic: JSON.parse(String(genericRow.payload_json ?? '{}')) as Record<string, unknown>,
    dataPlane: dataBody.record ?? (dataBody as Record<string, unknown>),
  };
}

describe('[#20964] approval snapshot field served masked on the data plane', () => {
  it(
    'is not served as stored to an approver the masking rule applies to, and is served stored to one who lifts it',
    async () => {
      const stack = await bootStack(snapmaskStack as unknown as Parameters<typeof bootStack>[0], {
        automation: true,
        security: new SecurityPlugin({
          defaultPermissionSets: [...securityDefaultPermissionSets, baselineSet, unmaskSet],
          fallbackPermissionSet: baselineSet.name,
        }),
        extraPlugins: [new RecordChangeTriggerPlugin(), new ApprovalsServicePlugin()],
      });
      try {
        const ql = (await stack.kernel.getServiceAsync('objectql')) as any;
        const idOf = async (email: string) =>
          String((await ql.findOne('sys_user', { where: { email }, context: { isSystem: true } }))?.id ?? '');

        const submitterToken = await stack.signUp('snapmask-submitter@verify.test');
        const memberToken = await stack.signUp('snapmask-member@verify.test');
        const unmaskerToken = await stack.signUp('snapmask-unmasker@verify.test');
        const submitterId = await idOf('snapmask-submitter@verify.test');
        const memberId = await idOf('snapmask-member@verify.test');
        const unmaskerId = await idOf('snapmask-unmasker@verify.test');
        expect(submitterId && memberId && unmaskerId).toBeTruthy();

        // Staff the position BEFORE the record exists: the slate resolves at
        // request creation.
        await ql.insert('sys_position', { id: 'pos_snapmask', name: POSITION, label: 'Reviewer', active: true }, SYS);
        await ql.insert('sys_user_position', { id: 'hold_snapmask_m', user_id: memberId, position: POSITION }, SYS);
        await ql.insert('sys_user_position', { id: 'hold_snapmask_u', user_id: unmaskerId, position: POSITION }, SYS);
        const unmask = await ql.findOne('sys_permission_set', { where: { name: unmaskSet.name }, context: { isSystem: true } });
        expect(unmask?.id, 'fixture permission set seeded').toBeTruthy();
        for (const userId of [unmaskerId, submitterId]) {
          await ql.insert('sys_user_permission_set', { user_id: userId, permission_set_id: unmask.id }, SYS);
        }

        const createRes = await stack.apiAs(submitterToken, 'POST', `/data/${OBJECT}`, { name: 'Item one', [KEY]: STORED });
        expect(createRes.status).toBe(201);
        const created = (await createRes.json()) as { id?: string; record?: { id?: string } };
        const recordId = String(created.id ?? created.record?.id ?? '');
        expect(recordId).toBeTruthy();

        // The scene, before any served read is believed: the snapshot at rest
        // carries the stored value.
        const atRest = await ql.findOne('sys_approval_request', { where: { object_name: OBJECT }, context: { isSystem: true } });
        expect(atRest, 'the flow opened an approval request').toBeTruthy();
        expect(JSON.parse(String(atRest.payload_json))[KEY]).toBe(STORED);

        const member = await readAs(stack, memberToken, recordId);
        // Reference: the data plane serves the field to this caller, masked.
        expect(member.dataPlane).toHaveProperty(KEY);
        expect(member.dataPlane[KEY]).not.toBe(STORED);
        // Every approval read: the key is not served.
        expect(member.list).not.toHaveProperty(KEY);
        expect(member.item).not.toHaveProperty(KEY);
        expect(member.generic).not.toHaveProperty(KEY);
        expect(member.listLabels).not.toHaveProperty(KEY);
        // ...while the field the rule does not touch still is.
        expect(member.list).toHaveProperty('name', 'Item one');
        expect(member.item).toHaveProperty('name', 'Item one');
        expect(member.generic).toHaveProperty('name', 'Item one');

        const unmasker = await readAs(stack, unmaskerToken, recordId);
        // Control: the reader who lifts the rule sees the stored value everywhere.
        expect(unmasker.dataPlane[KEY]).toBe(STORED);
        expect(unmasker.list[KEY]).toBe(STORED);
        expect(unmasker.item[KEY]).toBe(STORED);
        expect(unmasker.generic[KEY]).toBe(STORED);
        expect(unmasker.listLabels).toHaveProperty(KEY);
      } finally {
        await stack.stop();
      }
    },
    120_000,
  );
});
