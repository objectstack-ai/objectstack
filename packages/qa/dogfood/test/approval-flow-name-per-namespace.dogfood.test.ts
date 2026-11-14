// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0150 D8 row R7, D9, #31696] An approval request reads its flow from
// its own slot once a second namespace installs the flow's name, on a real
// boot: by the package it records when it opens (`process_package`), else by
// its run. Requests opened before and after the install carry alpha, and
// send-back, the read's `flow_route` / `flow_steps` and resubmit answer as
// before; a request naming no package reads through its run; CONTROL: one
// whose run cannot be read either keeps the refusal naming both.
//
// [ADR-0150 D8 row R7, #32647] A request whose stamped package was
// uninstalled never reads another package's flow of that name, on a real
// boot: install, open, uninstall, install another namespace's same-named
// flow. The second package's flow is filed under the bare name the run
// carries, so both the run's key and the bare read would serve it; the
// send-back refuses naming every holder, and the read serves no route or
// steps. CONTROL: with no holder left, the doors answer as for a deleted
// flow, as on `main`.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { defineStack, defineFlow } from '@objectstack/spec';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';

const ALPHA = 'com.qa.appr.alpha';
const IOTA = 'com.qa.appr.iota';
const FLOW = 'qa_appr_ns_flow';
const SHEET = 'qaappr_sheet';
/** The seeded platform administrator: the submitter and the one approver. */
const ADMIN = 'admin@objectos.ai';
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

/** Fires on insert of the sheet; one approval step with a revise window. */
const approvalFlow = defineFlow({
  name: FLOW, label: 'Alpha approval', type: 'autolaunched', status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'On Create', config: { objectName: SHEET, triggerType: 'record-after-create' } },
    { id: 'gate', type: 'approval', label: 'Alpha gate', config: { approvers: [{ type: 'user', value: ADMIN }], behavior: 'first_response' } },
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

const alphaStack = defineStack({
  manifest: { id: ALPHA, namespace: 'qaappr', name: 'qa_appr_alpha', version: '1.0.0', type: 'app' },
  requires: ['automation', 'triggers'],
  objects: [{ name: SHEET, label: 'Sheet', sharingModel: 'public_read_write', fields: { name: { type: 'text', label: 'Name' } } }],
  flows: [approvalFlow],
} as never);

/** iota's flow of the name: no approval node, so reading it for alpha's request refuses the send-back. */
const iota = {
  manifest: {
    id: IOTA, namespace: 'qaapprio', name: 'qa_appr_iota', version: '1.0.0', type: 'app', scope: 'project',
    engines: { protocol: `^${PROTOCOL_MAJOR}` },
    objects: [{ name: 'qaapprio_item', label: 'Iota item', sharingModel: 'public_read_write', fields: { name: { type: 'text', label: 'Name' } } }],
    flows: [{
      name: FLOW, label: 'Iota flow', type: 'autolaunched', status: 'active',
      nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
    }],
  },
};

describe('an approval request reads its flow from its own slot once a second namespace installs the name (ADR-0150 D8 R7, #31696)', () => {
  let stack: VerifyStack;
  let admin: string;
  let tempDir: string;
  let ql: any;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(admin, method, path, body);
    const json = (await res.json().catch(() => ({}))) as any;
    const error = json?.error && typeof json.error === 'object' ? json.error : json;
    return { status: res.status, body: json, code: error?.code ?? null, message: String(error?.message ?? json?.error ?? '') };
  };
  const act = (id: string, door: string) => call('POST', `/approvals/requests/${id}/${door}`, { comment: door });
  const stored = async (id: string) => (await ql.find('sys_approval_request', { where: { id }, context: SYSTEM_CTX }))[0];
  /** Open one request: a sheet row whose insert starts alpha's flow. */
  const open = async (name: string) => {
    const created = await call('POST', `/data/${SHEET}`, { name });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const recordId = String(created.body?.id ?? created.body?.record?.id ?? created.body?.data?.id ?? '');
    const [request] = await ql.find('sys_approval_request', { where: { object_name: SHEET, record_id: recordId, status: 'pending' }, context: SYSTEM_CTX });
    expect(request, `alpha's flow opened a pending request on ${name}`).toBeTruthy();
    return request as { id: string; flow_run_id: string };
  };

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'dogfood-approval-flow-ns-'));
    stack = await bootStack(alphaStack as never, {
      automation: true,
      extraPlugins: [
        new RecordChangeTriggerPlugin(),
        new ApprovalsServicePlugin(),
        new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: join(tempDir, 'installs') }),
      ],
    });
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 300_000);

  afterAll(async () => {
    await stack?.stop().catch(() => undefined);
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('send-back, the read\'s route and steps, and resubmit answer as before for requests opened before and after the install; CONTROL: no readable package keeps the 409 naming both', async () => {
    const [before, back, byRun, control] = [await open('before'), await open('back'), await open('by-run'), await open('control')];
    expect((await act(back.id, 'revise')).status).toBe(200);

    const installed = await call('POST', '/marketplace/install-local', iota);
    expect(installed.status, JSON.stringify(installed.body)).toBeLessThan(300);
    const automation = (stack.kernel as any).getService('automation');
    expect([automation.getFlowSlot(ALPHA, FLOW)?.label, automation.getFlowSlot(IOTA, FLOW)?.label]).toEqual(['Alpha approval', 'Iota flow']);
    const after = await open('after');
    expect((await Promise.all([before, back, after].map((r) => stored(r.id)))).map((r) => r.process_package)).toEqual([ALPHA, ALPHA, ALPHA]);

    for (const request of [before, after]) {
      const read = await call('GET', `/approvals/requests/${request.id}`);
      const row = read.body?.data ?? read.body;
      expect([read.status, row?.flow_steps?.map((s: any) => s.label)], JSON.stringify(read.body)).toEqual([200, ['Alpha gate']]);
      expect(row?.flow_route, JSON.stringify(row)).toBeTruthy();
      const revised = await act(request.id, 'revise');
      expect([revised.status, (await stored(request.id)).status], JSON.stringify(revised.body)).toEqual([200, 'returned']);
    }
    const resubmitted = await act(back.id, 'resubmit');
    expect(resubmitted.status, JSON.stringify(resubmitted.body)).toBe(200);

    // A request naming no package (as one the boot found ambiguous) reads through its run.
    await ql.update('sys_approval_request', { id: byRun.id, process_package: null }, { context: SYSTEM_CTX });
    expect((await act(byRun.id, 'revise')).status).toBe(200);

    // CONTROL: no package and no run to read: the refusal naming both, and nothing is written.
    await ql.update('sys_approval_request', { id: control.id, process_package: null, flow_run_id: 'run_nobody' }, { context: SYSTEM_CTX });
    const refused = await act(control.id, 'revise');
    expect([refused.status, refused.code], JSON.stringify(refused.body)).toEqual([409, 'RESOURCE_CONFLICT']);
    expect([refused.message.includes(ALPHA), refused.message.includes(IOTA), (await stored(control.id)).status]).toEqual([true, true, 'pending']);
    // Its read is served without the route and steps (row 20): the refusal, never iota's flow.
    const unread = await call('GET', `/approvals/requests/${control.id}`);
    const unreadRow = unread.body?.data ?? unread.body;
    expect([unread.status, unreadRow?.status, unreadRow?.flow_route, unreadRow?.flow_steps], JSON.stringify(unread.body)).toEqual([200, 'pending', undefined, undefined]);
  });
});

const WD_HOST = 'com.qa.appr.wdhost';
const WD_ALPHA = 'com.qa.appr.wdalpha';
const WD_IOTA = 'com.qa.appr.wdiota';
const WD_FLOW = 'qa_appr_wd_flow';
/** The host's object: it outlives the uninstall, so the request's record does too. */
const WD_SHEET = 'qaapprwd_sheet';

/** A package shipping `WD_FLOW` with one approval step and a revise window, each labelled `label`. */
const wdPackage = (id: string, namespace: string, label: string) => ({
  manifest: {
    id, namespace, name: namespace, version: '1.0.0', type: 'app', scope: 'project',
    engines: { protocol: `^${PROTOCOL_MAJOR}` },
    flows: [{
      name: WD_FLOW, label: `${label} approval`, type: 'autolaunched', status: 'active',
      nodes: [
        { id: 'start', type: 'start', label: 'On Create', config: { objectName: WD_SHEET, triggerType: 'record-after-create' } },
        { id: 'gate', type: 'approval', label: `${label} gate`, config: { approvers: [{ type: 'user', value: ADMIN }], behavior: 'first_response' } },
        { id: 'rework', type: 'approval_revise', label: `${label} revision` },
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
    }],
  },
});

describe('a request whose stamped package was uninstalled never reads another namespace\'s flow of that name (ADR-0150 D8 R7, #32647)', () => {
  let stack: VerifyStack;
  let admin: string;
  let tempDir: string;
  let ql: any;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(admin, method, path, body);
    const json = (await res.json().catch(() => ({}))) as any;
    const error = json?.error && typeof json.error === 'object' ? json.error : json;
    return { status: res.status, body: json, code: error?.code ?? null, message: String(error?.message ?? json?.error ?? '') };
  };
  const stored = async (id: string) => (await ql.find('sys_approval_request', { where: { id }, context: SYSTEM_CTX }))[0];
  /** The read's route and steps, and the send-back's answer, with the row's status after it. */
  const doors = async (id: string) => {
    const read = await call('GET', `/approvals/requests/${id}`);
    const row = read.body?.data ?? read.body;
    const revised = await call('POST', `/approvals/requests/${id}/revise`, { comment: 'revise' });
    return {
      read: [read.status, row?.flow_route === undefined ? undefined : 'route', row?.flow_steps?.map((s: any) => s.label)],
      revise: [revised.status, revised.code],
      message: revised.message,
      status: (await stored(id)).status,
    };
  };

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'dogfood-approval-flow-withdrawn-'));
    const host = defineStack({
      manifest: { id: WD_HOST, namespace: 'qaapprwd', name: 'qa_appr_wd_host', version: '1.0.0', type: 'app' },
      requires: ['automation', 'triggers'],
      objects: [{ name: WD_SHEET, label: 'Sheet', sharingModel: 'public_read_write', fields: { name: { type: 'text', label: 'Name' } } }],
    } as never);
    stack = await bootStack(host as never, {
      automation: true,
      extraPlugins: [
        new RecordChangeTriggerPlugin(),
        new ApprovalsServicePlugin(),
        new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: join(tempDir, 'installs') }),
      ],
    });
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 300_000);

  afterAll(async () => {
    await stack?.stop().catch(() => undefined);
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('install, open, uninstall, install another namespace\'s flow of the name: the send-back refuses naming every holder and the read serves no route or steps; CONTROL: no holder answers as a deleted flow', async () => {
    const automation = (stack.kernel as any).getService('automation');
    const installed = await call('POST', '/marketplace/install-local', wdPackage(WD_ALPHA, 'qaapprwda', 'Alpha'));
    expect(installed.status, JSON.stringify(installed.body)).toBeLessThan(300);

    const created = await call('POST', `/data/${WD_SHEET}`, { name: 'withdrawn' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const recordId = String(created.body?.id ?? created.body?.record?.id ?? created.body?.data?.id ?? '');
    const [request] = await ql.find('sys_approval_request', { where: { object_name: WD_SHEET, record_id: recordId, status: 'pending' }, context: SYSTEM_CTX });
    expect([request?.process_package, automation.flowSlotKey(WD_ALPHA, WD_FLOW)], 'alpha\'s flow opened a request stamped with alpha, under the bare key').toEqual([WD_ALPHA, WD_FLOW]);

    const uninstalled = await call('DELETE', `/marketplace/install-local/${WD_ALPHA}`);
    expect(uninstalled.status, JSON.stringify(uninstalled.body)).toBe(200);
    expect(automation.getFlowSlots(WD_FLOW)).toEqual([]);

    // CONTROL: no package holds the name: the doors answer as for a deleted flow, as on `main`.
    const gone = await doors(request.id);
    expect([gone.read, gone.revise[1], gone.status], JSON.stringify(gone)).toEqual([[200, undefined, undefined], 'VALIDATION_FAILED', 'pending']);

    const iota = await call('POST', '/marketplace/install-local', wdPackage(WD_IOTA, 'qaapprwdi', 'Iota'));
    expect(iota.status, JSON.stringify(iota.body)).toBeLessThan(300);
    // Iota's flow is filed under the bare name the request's run carries.
    expect([automation.flowSlotKey(WD_IOTA, WD_FLOW), (await automation.getFlow(WD_FLOW))?.label]).toEqual([WD_FLOW, 'Iota approval']);

    const moved = await doors(request.id);
    expect([moved.read, moved.revise, moved.status], JSON.stringify(moved)).toEqual([[200, undefined, undefined], [409, 'RESOURCE_CONFLICT'], 'pending']);
    expect([moved.message.includes(WD_ALPHA), moved.message.includes(WD_IOTA)], moved.message).toEqual([true, true]);
  });
});
