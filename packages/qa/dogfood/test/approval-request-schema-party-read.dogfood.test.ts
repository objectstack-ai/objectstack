// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The approval request page needs the definitions of `sys_approval_request`
// and `sys_approval_action`, and their rows reach a member only through the
// approvals door (`/api/v1/approvals/*`): the data side of both objects is
// closed to ordinary members on purpose. Under ADR-0106 as amended by ruling
// record 6787890900, a caller the object read check refuses is answered as if
// the object did not exist, on every schema-serving outlet; so, without an
// exception, a non-admin approver was answered 404 on both definitions and the
// console request page showed "Object Not Found" with no decision actions.
//
// Maintainer decision 6840464379: the two definitions are served to the
// callers the approvals door admits, declared by the owning plugin
// (`schemaReadDelegate: 'approvals'` on both objects), with field security
// still applied, the rows still closed, and every other object's answer
// unchanged. On a real boot, through the REST door:
//
//   ⭐ the pending approver and the submitter are served both definitions, by
//      name and in the object list, projected by their own field security;
//   ⭐ a member who is party to no request is answered as before: 404 on both
//      definitions and neither in the list;
//   ⭐ the approver's object list differs from that member's by exactly the two
//      declared objects, so no other object's answer moved (the undeclared
//      sibling `sys_approval_approver` among them);
//   ⭐ the approver's data reads of both objects are still refused, while the
//      approvals door still serves the request.
//
// The ablation (the declaration removed, the approver answered 404 again) is
// run once by hand and cited in the PR, not kept as a file.
//
// Since #32442 (maintainer ruling 6849636735, 1B) the shipped member baseline
// names `sys_approval_request` read-only, so the request's data side is no
// longer closed to members: the object read check now admits every member, and
// under ADR-0106 the request DEFINITION follows that read to every member,
// projected by their own field security. Its rows stay the approvals request
// read gate's participant set. `sys_approval_action` is unchanged: closed on
// the data side, its definition served only through the delegate. So the
// pins below read, for the request: every member is served the definition; a
// member party to no request reads no row of it; the approver reads their own
// request's row on the data door.

import { describe, it, expect } from 'vitest';
import { bootStack } from '@objectstack/verify';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { defineStack, defineFlow } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { catalogPermissionSet } from './catalog-permission-set.js';

const OBJECT = 'schread_invoice';
const SYS = { context: { isSystem: true } } as const;
const REQUEST = 'sys_approval_request';
const ACTION = 'sys_approval_action';
/** The two objects plugin-approvals declares; nothing else may move. */
const DECLARED = [ACTION, REQUEST];
/** The undeclared sibling: closed on the data side too, and must stay hidden. */
const SIBLING = 'sys_approval_approver';
/** The field the approver's own field security withholds on the request. */
const WITHHELD = 'node_config_json';

const SUBMITTER = 'schread-submitter@verify.test';
const APPROVER = 'schread-approver@verify.test';
/** Party to no request; the baseline only. */
const STRANGER = 'schread-stranger@verify.test';

const invoice = ObjectSchema.create({
  name: OBJECT,
  label: 'Schema Read Invoice',
  pluralLabel: 'Schema Read Invoices',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

const flow = defineFlow({
  name: `${OBJECT}_signoff`,
  label: 'Invoice sign-off',
  description: 'Fires on insert and opens one approval step on the approver.',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'On Create', config: { objectName: OBJECT, triggerType: 'record-after-create' } },
    {
      id: 'signoff',
      type: 'approval',
      label: 'Sign-off',
      config: { approvers: [{ type: 'user', value: APPROVER }], behavior: 'first_response', lockRecord: false },
    },
    { id: 'approved', type: 'end', label: 'Approved' },
    { id: 'rejected', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'signoff' },
    { id: 'e2', source: 'signoff', target: 'approved', label: 'approve' },
    { id: 'e3', source: 'signoff', target: 'rejected', label: 'reject' },
  ],
});

const stackConfig = defineStack({
  manifest: {
    id: 'com.dogfood.approval-request-schema-party-read',
    namespace: 'schread',
    version: '0.0.0',
    type: 'app',
    name: 'Approval Request Schema Party Read Fixture',
    description: 'One approval step on one object, for the request definitions a party is served.',
  },
  // ADR-0097: the `record-after-create` start node needs the trigger capability.
  requires: ['automation', 'triggers'],
  objects: [invoice],
  flows: [flow],
});

/** Everyone's baseline: CRUD on the fixture object, and nothing on `sys_approval_*`. */
const baselineSet: PermissionSet = PermissionSetSchema.parse({
  name: 'schread_baseline',
  label: 'Schema Read Baseline — the fixture object only',
  objects: { [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false } },
});

/** The approver's field security on the request: one field withheld, no object grant. */
const approverFieldSet: PermissionSet = PermissionSetSchema.parse({
  name: 'schread_approver_fls',
  label: 'Schema Read Approver — request field withheld',
  objects: {},
  fields: { [`${REQUEST}.${WITHHELD}`]: { readable: false, editable: false } },
});

type MetaItem = { item?: { name?: string; fields?: Record<string, unknown> } };

describe('a party to an approval request is served the request definitions (decision 6840464379)', () => {
  it(
    'serves both definitions to the approver and the submitter, field-masked, and nothing new to anyone else',
    async () => {
      const stack = await bootStack(stackConfig as unknown as Parameters<typeof bootStack>[0], {
        automation: true,
        security: new SecurityPlugin({
          defaultPermissionSets: [...securityDefaultPermissionSets, baselineSet, approverFieldSet],
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

        const admin = await stack.signIn();
        const submitter = await stack.signUp(SUBMITTER);
        const approver = await stack.signUp(APPROVER);
        const stranger = await stack.signUp(STRANGER);
        await grant(APPROVER, approverFieldSet.name);

        const meta = async (token: string, object: string) => {
          const res = await stack.apiAs(token, 'GET', `/meta/object/${object}`);
          const text = await res.text();
          return { status: res.status, text, body: (res.status === 200 ? JSON.parse(text) : undefined) as MetaItem | undefined };
        };
        const listed = async (token: string): Promise<string[]> => {
          const res = await stack.apiAs(token, 'GET', '/meta/object');
          const text = await res.text();
          expect(res.status, text).toBe(200);
          const json = JSON.parse(text) as { data?: unknown; items?: unknown };
          const items = json.items ?? json.data;
          const list = Array.isArray(items) ? items : ((items as { items?: unknown[] } | undefined)?.items ?? []);
          return list.map((i) => String((i as { name?: string }).name)).sort();
        };

        // The scene, before any read is believed: one pending request, waiting
        // on the approver, submitted by the submitter; the stranger is on no
        // slate and submitted nothing.
        const created = await stack.apiAs(submitter, 'POST', `/data/${OBJECT}`, { name: 'INV-1' });
        expect(created.status, await created.clone().text()).toBe(201);
        const [request] = await ql.find(REQUEST, { where: { object_name: OBJECT, status: 'pending' }, context: SYS.context });
        expect(request, 'the flow opened the sign-off step').toBeTruthy();
        const viaDoor = await stack.apiAs(approver, 'GET', `/approvals/requests/${request.id}`);
        expect(viaDoor.status, await viaDoor.clone().text()).toBe(200);
        expect((await stack.apiAs(stranger, 'GET', `/approvals/requests/${request.id}`)).status).toBe(404);

        // The administrator's answer is the control: both definitions, whole.
        for (const object of DECLARED) {
          const read = await meta(admin, object);
          expect(read.status, `admin ${object}: ${read.text}`).toBe(200);
        }
        expect(Object.keys((await meta(admin, REQUEST)).body?.item?.fields ?? {})).toContain(WITHHELD);

        // ⭐ 1 — the pending approver and the submitter are served both.
        for (const token of [approver, submitter]) {
          for (const object of DECLARED) {
            const read = await meta(token, object);
            expect(read.status, `${token === approver ? 'approver' : 'submitter'} ${object}: ${read.text}`).toBe(200);
            expect(read.body?.item?.name).toBe(object);
          }
          expect(await listed(token)).toEqual(expect.arrayContaining(DECLARED));
        }
        // …projected by the approver's own field security.
        const approverFields = Object.keys((await meta(approver, REQUEST)).body?.item?.fields ?? {});
        expect(approverFields).toContain('status');
        expect(approverFields).not.toContain(WITHHELD);
        expect(Object.keys((await meta(submitter, REQUEST)).body?.item?.fields ?? {})).toContain(WITHHELD);

        // ⭐ 2 — a member party to no request learns nothing new through the
        // delegate: 404 on the action log and the undeclared sibling. The
        // request definition reaches them by the member baseline's read
        // (#32442, ruling 6849636735, 1B), projected by their own field
        // security, with no row of it (⭐ 4).
        for (const object of [ACTION, SIBLING]) {
          const read = await meta(stranger, object);
          expect(read.status, `stranger ${object}: ${read.text}`).toBe(404);
        }
        const strangerRequest = await meta(stranger, REQUEST);
        expect(strangerRequest.status, `stranger ${REQUEST}: ${strangerRequest.text}`).toBe(200);
        expect(strangerRequest.body?.item?.name).toBe(REQUEST);
        const strangerList = await listed(stranger);
        expect(strangerList).not.toContain(ACTION);
        expect(strangerList).toContain(REQUEST);

        // ⭐ 3 — no other object moved: the approver's list is the stranger's
        // plus exactly the delegate-served action log, and the undeclared
        // sibling stays absent by name too.
        expect(await listed(approver)).toEqual([...strangerList, ACTION].sort());
        expect((await meta(approver, SIBLING)).status).toBe(404);

        // ⭐ 4 — the action log's rows are still closed to the approver on the
        // data door; the request's rows are the participant set: the approver
        // reads their own request, the stranger reads none.
        {
          const res = await stack.apiAs(approver, 'GET', `/data/${ACTION}`);
          const text = await res.text();
          expect([403, 404], `approver /data/${ACTION}: ${text}`).toContain(res.status);
          expect(text).not.toContain(String(request.id));
        }
        const own = await stack.apiAs(approver, 'GET', `/data/${REQUEST}/${request.id}`);
        expect(own.status, await own.clone().text()).toBe(200);
        const strangerRows = await stack.apiAs(stranger, 'GET', `/data/${REQUEST}`);
        const strangerRowsText = await strangerRows.text();
        expect(strangerRows.status, strangerRowsText).toBe(200);
        expect(strangerRowsText).not.toContain(String(request.id));
        // By id: not found (the refusal names only the id the stranger sent).
        const strangerById = await stack.apiAs(stranger, 'GET', `/data/${REQUEST}/${request.id}`);
        const strangerByIdText = await strangerById.text();
        expect(strangerById.status, strangerByIdText).toBe(404);
        expect(strangerByIdText).not.toContain(String(request.record_id));
      } finally {
        await stack.stop();
      }
    },
    120_000,
  );
});
