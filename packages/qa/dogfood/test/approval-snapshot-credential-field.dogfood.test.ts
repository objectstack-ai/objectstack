// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The record snapshot an approval request stores applies the write-response
// non-exposure rules, on a real boot: a credential-class field is stored
// masked and an `internal: true` field is not stored at all, while the
// engine's own write result keeps both values for the privileged in-process
// caller that performed the write.
//
// ## The composition
//
// `bootStack` with the real `SecurityPlugin`, `ObjectQL`, SQL driver, REST and
// auth layers, plus automation, the record-change trigger and the approvals
// plugin. One synthetic object carries a `password` field and an `internal`
// field; a flow routes each new record to a position one approver holds. The
// flow's `$record` is built off the engine's write result, so without the rule
// the snapshot would carry both stored values.
//
// ## What is asserted, by class
//
// - The scene is real: the flow opened a request for each record.
// - At rest, the stored snapshot carries the mask for the credential field and
//   no key for the internal field — for a record created through the HTTP data
//   door and for one written in-process.
// - The approver's inbox item serves the same masked snapshot.
// - Control: the in-process engine write result still carries both stored
//   values.
//
// Fixtures are synthetic. `@objectstack/plugin-approvals` and
// `@objectstack/trigger-record-change` resolve to SOURCE here (this project's
// alias), so the verdict is about the checkout, not the last build.

import { describe, it, expect } from 'vitest';
import { bootStack } from '@objectstack/verify';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { defineStack, defineFlow } from '@objectstack/spec';
import { ObjectSchema, Field, SECRET_MASK } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

const OBJECT = 'credsnap_item';
const POSITION = 'credsnap_reviewer';
const CREDENTIAL_KEY = 'credsnap_pass';
const INTERNAL_KEY = 'credsnap_digest';
/** Synthetic stored values. */
const CREDENTIAL = 'SYNTH-CRED-71B2';
const INTERNAL = 'SYNTH-DIGEST-0C9E';
const SYS = { context: { isSystem: true } } as const;

const CredsnapItem = ObjectSchema.create({
  name: OBJECT,
  label: 'Credential Snapshot Item',
  pluralLabel: 'Credential Snapshot Items',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    [CREDENTIAL_KEY]: Field.password({ label: 'Pass' }),
    [INTERNAL_KEY]: Field.text({ label: 'Digest', internal: true }),
  },
});

const CredsnapFlow = defineFlow({
  name: 'credsnap_flow',
  label: 'Credential Snapshot Flow',
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

const credsnapStack = defineStack({
  manifest: {
    id: 'com.dogfood.credential-snapshot',
    namespace: 'credsnap',
    version: '0.0.0',
    type: 'app',
    name: 'Credential Snapshot Fixture',
    description: 'One object with a credential field and an internal field, one approval flow.',
  },
  // ADR-0097: the flow's record-change start node needs both capabilities.
  requires: ['automation', 'triggers'],
  objects: [CredsnapItem],
  flows: [CredsnapFlow],
});

/** Every fresh member: read and create on the object, read on the request object. */
const baselineSet = PermissionSetSchema.parse({
  name: 'credsnap_baseline',
  label: 'Credential snapshot baseline',
  objects: {
    [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false },
    sys_approval_request: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
  },
});

async function snapshotAtRest(ql: any, recordId: string): Promise<Record<string, unknown>> {
  const row = await ql.findOne('sys_approval_request', {
    where: { object_name: OBJECT, record_id: recordId },
    context: { isSystem: true },
  });
  expect(row, `the flow opened an approval request for ${recordId}`).toBeTruthy();
  const raw = String(row.payload_json);
  expect(raw).not.toContain(CREDENTIAL);
  expect(raw).not.toContain(INTERNAL);
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('approval snapshot of a record with credential-class and internal fields', () => {
  it(
    'stores the credential masked and the internal field omitted, while the engine write result keeps both',
    async () => {
      const stack = await bootStack(credsnapStack as unknown as Parameters<typeof bootStack>[0], {
        automation: true,
        security: new SecurityPlugin({
          defaultPermissionSets: [...securityDefaultPermissionSets, baselineSet],
          fallbackPermissionSet: baselineSet.name,
        }),
        extraPlugins: [new RecordChangeTriggerPlugin(), new ApprovalsServicePlugin()],
      });
      try {
        const ql = (await stack.kernel.getServiceAsync('objectql')) as any;
        const idOf = async (email: string) =>
          String((await ql.findOne('sys_user', { where: { email }, context: { isSystem: true } }))?.id ?? '');

        const submitterToken = await stack.signUp('credsnap-submitter@verify.test');
        const approverToken = await stack.signUp('credsnap-approver@verify.test');
        const approverId = await idOf('credsnap-approver@verify.test');
        expect(approverId).toBeTruthy();

        // Staff the position BEFORE the records exist: the slate resolves at
        // request creation.
        await ql.insert('sys_position', { id: 'pos_credsnap', name: POSITION, label: 'Reviewer', active: true }, SYS);
        await ql.insert('sys_user_position', { id: 'hold_credsnap', user_id: approverId, position: POSITION }, SYS);

        // 1) Through the HTTP data door.
        const createRes = await stack.apiAs(submitterToken, 'POST', `/data/${OBJECT}`, {
          name: 'Item one', [CREDENTIAL_KEY]: CREDENTIAL, [INTERNAL_KEY]: INTERNAL,
        });
        expect(createRes.status).toBe(201);
        const created = (await createRes.json()) as { id?: string; record?: { id?: string } };
        const viaHttp = String(created.id ?? created.record?.id ?? '');
        expect(viaHttp).toBeTruthy();

        const httpSnapshot = await snapshotAtRest(ql, viaHttp);
        expect(httpSnapshot).toHaveProperty('name', 'Item one');
        expect(httpSnapshot[CREDENTIAL_KEY]).toBe(SECRET_MASK);
        expect(httpSnapshot).not.toHaveProperty(INTERNAL_KEY);

        // 2) In-process, as a privileged server-side writer. Control: the
        // engine's write result still carries both stored values.
        const written = await ql.insert(OBJECT, {
          name: 'Item two', [CREDENTIAL_KEY]: CREDENTIAL, [INTERNAL_KEY]: INTERNAL,
        }, SYS);
        expect(written[CREDENTIAL_KEY]).toBe(CREDENTIAL);
        expect(written[INTERNAL_KEY]).toBe(INTERNAL);

        const engineSnapshot = await snapshotAtRest(ql, String(written.id));
        expect(engineSnapshot).toHaveProperty('name', 'Item two');
        expect(engineSnapshot[CREDENTIAL_KEY]).toBe(SECRET_MASK);
        expect(engineSnapshot).not.toHaveProperty(INTERNAL_KEY);

        // 3) The approver's inbox serves the same masked snapshot.
        const listRes = await stack.apiAs(approverToken, 'GET', '/approvals/requests?status=pending');
        expect(listRes.status).toBe(200);
        const listBody = (await listRes.json()) as { data: Array<Record<string, unknown>> };
        const rows = listBody.data.filter((r) => r.object_name === OBJECT);
        expect(rows).toHaveLength(2);
        for (const row of rows) {
          const itemRes = await stack.apiAs(approverToken, 'GET', `/approvals/requests/${String(row.id)}`);
          expect(itemRes.status).toBe(200);
          const item = (await itemRes.json()) as Record<string, unknown>;
          expect(JSON.stringify(item)).not.toContain(CREDENTIAL);
          expect(JSON.stringify(item)).not.toContain(INTERNAL);
          expect((item.payload as Record<string, unknown>)[CREDENTIAL_KEY]).toBe(SECRET_MASK);
        }
      } finally {
        await stack.stop();
      }
    },
    120_000,
  );
});
