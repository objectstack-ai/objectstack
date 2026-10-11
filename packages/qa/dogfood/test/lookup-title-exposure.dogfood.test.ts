// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22738] A lookup target's TITLE, served by the approvals inbox and by the
// activity timeline, asks the target's own declared exposure (ADR-0049) through
// the spec's one decision, for `get`, on a real boot: the real
// `SecurityPlugin`, `ObjectQL`, SQL driver, REST and auth layers, automation,
// the record-change trigger, the approvals plugin and `AuditPlugin`.
//
// ## The two positions
//
// - The inbox's `payload_display`, which maps a snapshot's lookup keys to the
//   referenced records' titles (`ApprovalService.enrichRows`).
// - The tracked-change summary of an activity row, which names the referenced
//   records by title, composed at write time (`resolveLookupTitles`).
//
// A target the decision does not serve for `get` is not read: the inbox carries
// no display value for that key (the snapshot's stored id stands, the answer a
// deleted target already gets) and the summary names the stored id. The
// exposed target is the control. Both are asserted for an administrator and a
// member, because each read runs under a system context and takes no caller.
//
// Armed before believed: the data door answers each target's `get` as the
// decision does (404 for the off switch, 405 for a whitelist without `get`,
// 200 for the control), and both rows exist at rest.
//
// Fixtures are synthetic. ⚠️ No test title states a value.
// `@objectstack/plugin-approvals` resolves to SOURCE here (this project's
// alias); `@objectstack/plugin-audit` resolves through its BUILT output, so a
// verdict on a change to it is a verdict on its last build.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { defineStack, defineFlow } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { assertArmed, armedWhen } from './armed.js';

const SYS = { context: { isSystem: true } } as const;
const POSITION = 'lte_reviewer';

/** Each lookup: its target, the target's declaration, the data door's `get` answer, a synthetic title. */
const TARGETS = {
  hidden: { object: 'lte_hidden', enable: { apiEnabled: false }, get: 404, title: 'LTEHIDDEN81' },
  listonly: { object: 'lte_listonly', enable: { apiMethods: ['list'] }, get: 405, title: 'LTELISTONLY82' },
  denyall: { object: 'lte_denyall', enable: { apiMethods: [] }, get: 405, title: 'LTEDENYALL83' },
  open: { object: 'lte_open', enable: undefined, get: 200, title: 'LTEOPEN84' },
} as const;
type Rel = keyof typeof TARGETS;
const RELS = Object.keys(TARGETS) as Rel[];
const WITHHELD: Rel[] = ['hidden', 'listonly', 'denyall'];

const object = (name: string, fields: Record<string, unknown>, enable?: unknown) =>
  ObjectSchema.create({
    name, label: name, pluralLabel: name, sharingModel: 'public_read_write',
    ...(enable ? { enable } : {}),
    fields: { name: Field.text({ label: 'Name' }), ...fields },
  } as never);
const lookups = (trackHistory: boolean) =>
  Object.fromEntries(RELS.map((r) => [r, Field.lookup(TARGETS[r].object, { label: r, trackHistory })]));

const flow = defineFlow({
  name: 'lte_flow', label: 'LTE Flow', description: 'Routes each new request to the reviewer position.',
  type: 'autolaunched', status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'On Create', config: { objectName: 'lte_request', triggerType: 'record-after-create' } },
    { id: 'gate', type: 'approval', label: 'Gate', config: { approvers: [{ type: 'position', value: POSITION }], behavior: 'first_response' } },
    { id: 'approved', type: 'end', label: 'Approved' },
    { id: 'rejected', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'gate' },
    { id: 'e2', source: 'gate', target: 'approved', label: 'approve' },
    { id: 'e3', source: 'gate', target: 'rejected', label: 'reject' },
  ],
});

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.lookup-title-exposure', namespace: 'lte', version: '0.0.0', type: 'app',
    name: 'Lookup Title Exposure Fixture',
    description: 'Lookups into targets of every exposure shape, on an approval request and on a tracked record.',
  },
  requires: ['automation', 'triggers'],
  objects: [
    ...RELS.map((r) => object(TARGETS[r].object, {}, TARGETS[r].enable)),
    object('lte_request', lookups(false)),
    object('lte_tracked', lookups(true)),
  ],
  flows: [flow],
});

const crud = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false };
const read = { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false };
const memberSet = PermissionSetSchema.parse({
  name: 'lte_member', label: 'LTE member',
  objects: {
    ...Object.fromEntries([...RELS.map((r) => TARGETS[r].object), 'lte_request', 'lte_tracked'].map((o) => [o, crud])),
    sys_approval_request: read,
    sys_activity: read,
  },
});

type Row = Record<string, any>;
const PERSONAS = ['admin', 'member'] as const;

describe('[#22738] a lookup title is served only for a target whose declared exposure serves `get`', () => {
  let stack: VerifyStack;
  const token: Record<string, string> = {};
  const ids = {} as Record<Rel, string>;
  let requestRecord = '';
  let trackedRecord = '';

  beforeAll(async () => {
    stack = await bootStack(fixtureStack as unknown as Parameters<typeof bootStack>[0], {
      automation: true,
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, memberSet],
        fallbackPermissionSet: memberSet.name,
      }),
      extraPlugins: [new RecordChangeTriggerPlugin(), new ApprovalsServicePlugin(), new AuditPlugin()],
    });
    const ql = (await stack.kernel.getServiceAsync('objectql')) as any;
    const userId = async (email: string) => String((await ql.findOne('sys_user', { where: { email }, ...SYS }))?.id ?? '');
    token.admin = await stack.signIn();
    token.member = await stack.signUp('lte-member@verify.test');
    token.submitter = await stack.signUp('lte-submitter@verify.test');

    // Both personas approve, in the organization the request opens in: the
    // slate resolves when the request opens.
    const memberId = await userId('lte-member@verify.test');
    const org = (await ql.findOne('sys_member', { where: { user_id: memberId }, ...SYS }))?.organization_id;
    expect(org, 'the member belongs to an organization').toBeTruthy();
    await ql.insert('sys_position', { id: 'pos_lte', name: POSITION, label: 'Reviewer', active: true, organization_id: org }, SYS);
    for (const id of [await userId('admin@objectos.ai'), memberId]) {
      await ql.insert('sys_user_position', { user_id: id, position: POSITION, organization_id: org }, SYS);
    }
    for (const r of RELS) ids[r] = String((await ql.insert(TARGETS[r].object, { name: TARGETS[r].title }, SYS)).id);
    const refs = Object.fromEntries(RELS.map((r) => [r, ids[r]]));

    const created = await stack.apiAs(token.submitter, 'POST', '/data/lte_request', { name: 'Request', ...refs });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as Row;
    requestRecord = String(createdBody.id ?? createdBody.record?.id ?? '');

    const tracked = await stack.apiAs(token.admin, 'POST', '/data/lte_tracked', { name: 'Tracked' });
    expect(tracked.status).toBe(201);
    const trackedBody = (await tracked.json()) as Row;
    trackedRecord = String(trackedBody.id ?? trackedBody.record?.id ?? '');
    const moved = await stack.apiAs(token.admin, 'PATCH', `/data/lte_tracked/${trackedRecord}`, refs);
    expect(moved.status).toBe(200);

    await assertArmed([
      armedWhen({
        control: "the data door answers each target's `get` as the decision does",
        disarmedBy: 'a declaration that did not reach the registry would make every withheld case measure an exposed target',
        observe: async () =>
          Object.fromEntries(await Promise.all(RELS.map(async (r) =>
            [r, (await stack.apiAs(token.admin, 'GET', `/data/${TARGETS[r].object}/${ids[r]}`)).status] as const))),
        armed: (o) => RELS.every((r) => o[r] === TARGETS[r].get),
        describe: (o) => JSON.stringify(o),
      }),
      armedWhen({
        control: 'the flow opened a request for the record, and the tracked update wrote an updated activity row',
        disarmedBy: 'a scene with no request or no row would let every case below read nothing',
        observe: async () => ({
          request: Boolean(await ql.findOne('sys_approval_request', { where: { object_name: 'lte_request', record_id: requestRecord }, ...SYS })),
          updated: Boolean(await ql.findOne('sys_activity', { where: { object_name: 'lte_tracked', record_id: trackedRecord, type: 'updated' }, ...SYS })),
        }),
        armed: (o) => o.request && o.updated,
        describe: (o) => JSON.stringify(o),
      }),
    ]);
  }, 180_000);

  afterAll(async () => {
    if (stack) await stack.stop();
  });

  /** The inbox list row and the inbox item for the fixture request, as one persona. */
  const inbox = async (who: (typeof PERSONAS)[number]): Promise<Row[]> => {
    const list = await stack.apiAs(token[who], 'GET', '/approvals/requests?status=pending');
    expect(list.status).toBe(200);
    const row = ((await list.json()) as { data: Row[] }).data.find((r) => r.record_id === requestRecord);
    expect(row, 'the request is in the inbox').toBeTruthy();
    const item = await stack.apiAs(token[who], 'GET', `/approvals/requests/${row!.id}`);
    expect(item.status).toBe(200);
    return [row!, (await item.json()) as Row];
  };

  for (const who of PERSONAS) {
    it(`inbox (${who}): a withheld target has no display value, its stored id stands, and the control keeps its title`, async () => {
      for (const row of await inbox(who)) {
        expect(row.payload_display?.open).toBe(TARGETS.open.title);
        for (const r of WITHHELD) {
          expect(row.payload_display ?? {}).not.toHaveProperty(r);
          expect(row.payload?.[r]).toBe(ids[r]);
          expect(JSON.stringify(row)).not.toContain(TARGETS[r].title);
        }
      }
    });

    it(`activity (${who}): the summary names a withheld target by its stored id, and the control by its title`, async () => {
      const filter = encodeURIComponent(JSON.stringify({ object_name: 'lte_tracked', record_id: trackedRecord }));
      const res = await stack.apiAs(token[who], 'GET', `/data/sys_activity?$filter=${filter}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Row;
      const updated = ((body.records ?? body.data ?? []) as Row[]).find((r) => r.type === 'updated');
      const summary = String(updated?.summary ?? '');
      expect(summary).toContain(TARGETS.open.title);
      for (const r of WITHHELD) {
        expect(summary).toContain(ids[r]);
        expect(summary).not.toContain(TARGETS[r].title);
      }
    });
  }
});
