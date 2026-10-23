// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25469] The expense approvals write their decision back onto the report.
 *
 * THE DEFECT. `showcase_expense_signoff` (per-group 会签) and
 * `showcase_committee_quorum` (2-of-3) both ran `start → approval → end`, with
 * bare `end` nodes on the approve and reject arms. The approval request moved
 * to approved / rejected, but nothing told the business record: an expense
 * report both groups had signed off kept reading `status: 'submitted'`.
 *
 * THE FIX is an `update_record` on each outcome arm (approve → `approved`,
 * reject → `draft`), not an `approvalStatusField` mirror — the flows' own
 * docblock says why (the mirror writes the request vocabulary verbatim, and
 * `status` declares neither `pending` nor `rejected`, so a rejected report
 * would still read "Submitted").
 *
 * WHY A REAL DECISION AND NOT A METADATA READ. The write-back happens on
 * RESUME, after a pause, through the approvals service's `decide` →
 * `automation.resume` path, and under the record lock the node takes. Only
 * driving a real request to a real decision on the production stack (real
 * kernel, ObjectQL, automation and approvals plugins over real sqlite, the
 * app's real objects and flows) shows the record actually changes. The
 * CONTROL re-authors the pre-fix shape (bare `end` arms) on the same harness
 * and shows the same decisions leave the report at `submitted` — so the
 * positive assertions can go red.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';

import { ExpenseReport, ExpenseLine } from '../src/data/objects/index.js';
import { ExpenseSignoffFlow, CommitteeQuorumFlow } from '../src/automation/flows/index.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

/** Everything the approvals service treats as an unconditional actor. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as any;
const SYS = { context: SYSTEM_CTX };

const openKernels: Array<{ shutdown?: () => Promise<void> }> = [];
const openDrivers: Array<{ disconnect?: () => Promise<void> }> = [];
afterEach(async () => {
  while (openKernels.length) {
    try { await openKernels.pop()?.shutdown?.(); } catch { /* noop */ }
  }
  while (openDrivers.length) {
    try { await openDrivers.pop()?.disconnect?.(); } catch { /* noop */ }
  }
});

interface Booted {
  automation: AutomationEngine & Record<string, any>;
  approvals: any;
  data: any;
}

async function boot(flow: any): Promise<Booted> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new AutomationServicePlugin());
  await kernel.use(new ApprovalsServicePlugin());
  await kernel.bootstrap();
  openKernels.push(kernel as any);

  const objectql: any = kernel.getService('objectql');
  const data: any = kernel.getService('data');
  const automation = kernel.getService<AutomationEngine>('automation') as AutomationEngine & Record<string, any>;
  const approvals: any = kernel.getService('approvals');

  const driver: any = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await driver.connect();
  objectql.registerDriver(driver, true);
  openDrivers.push(driver);

  for (const obj of [ExpenseReport, ExpenseLine]) {
    objectql.registry.registerObject(obj, 'showcase', 'showcase');
  }
  await objectql.syncSchemas();
  await installDefaultOrganization(objectql);

  // One flow per boot: both start on the same record transition, and the
  // approvals service dedupes pending requests per record.
  automation.registerFlow(flow.name, flow);
  return { automation, approvals, data };
}

function one(res: any): any {
  return Array.isArray(res) ? res[0] : res;
}

function rows(res: any): any[] {
  return Array.isArray(res) ? res : (res?.records ?? []);
}

/** A submitted report, opened into approval the way the seed's `launchSignoff` does. */
async function submitReport(booted: Booted, flowName: string): Promise<{ report: any; request: any }> {
  const report = one(await booted.data.insert('showcase_expense_report', {
    name: 'EXP-TEST',
    employee: 'Mei Phone',
    status: 'submitted',
  }, SYS));
  const launched: any = await booted.automation.execute(flowName, {
    record: report,
    previous: { ...report, status: 'draft' },
    object: 'showcase_expense_report',
    organizationId: null,
    userId: 'mei@example.com',
  } as any);
  expect(launched.status, `launch did not park on the approval node: ${launched.error ?? ''}`).toBe('paused');
  const request = rows(await booted.data.find('sys_approval_request', { where: { status: 'pending' }, ...SYS }))[0];
  expect(request, 'no pending approval request was opened').toBeTruthy();
  return { report, request };
}

async function statusOf(booted: Booted, id: string): Promise<string> {
  const rec = one(await booted.data.findOne('showcase_expense_report', { where: { id }, ...SYS }));
  return rec?.status;
}

async function decide(booted: Booted, requestId: string, decision: 'approve' | 'reject', actorId: string) {
  return booted.approvals.decide(requestId, { decision, actorId }, SYSTEM_CTX);
}

/** The pre-fix shape: the outcome arms go straight to bare `end` nodes. */
function withoutWriteBack(flow: any, approvalNodeId: string): any {
  const writeBack = new Set(['mark_approved', 'return_to_draft']);
  return {
    ...flow,
    nodes: (flow.nodes as any[]).filter((n) => !writeBack.has(n.id)),
    edges: [
      { id: 'e1', source: 'start', target: approvalNodeId },
      { id: 'e2', source: approvalNodeId, target: 'approved', label: 'approve' },
      { id: 'e3', source: approvalNodeId, target: 'rejected', label: 'reject' },
    ],
  };
}

const CASES = [
  {
    flow: ExpenseSignoffFlow,
    node: 'dual_signoff',
    // per_group: one from EACH group finalizes.
    approvers: ['position:manager', 'position:auditor'],
    rejecter: 'position:auditor',
  },
  {
    flow: CommitteeQuorumFlow,
    node: 'committee',
    // quorum: any 2 of 3 finalizes.
    approvers: ['position:manager', 'position:legal'],
    rejecter: 'position:finance',
  },
] as const;

describe.each(CASES)('#25469 — $flow.name writes its decision back onto the report', ({ flow, node, approvers, rejecter }) => {
  it('approve: the report reads `approved` once the approval finalizes, not before', async () => {
    const booted = await boot(flow);
    const { report, request } = await submitReport(booted, flow.name);

    const first = await decide(booted, request.id, 'approve', approvers[0]);
    expect(first.finalized, 'one approval already finalized the request').toBe(false);
    // Still mid-approval: nothing has been decided yet, so nothing is written.
    expect(await statusOf(booted, report.id)).toBe('submitted');

    const second = await decide(booted, request.id, 'approve', approvers[1]);
    expect(second.finalized).toBe(true);
    expect(second.resumed, `the run was not resumed: ${second.error ?? second.resumeError ?? ''}`).toBe(true);

    const run = (await booted.automation.listRuns(flow.name))[0];
    expect(run.status, `run ended ${run.status}: ${run.error ?? ''}`).toBe('completed');
    expect(run.steps.map((s: any) => s.nodeId)).toContain('mark_approved');
    expect(run.steps.map((s: any) => s.nodeId)).not.toContain('return_to_draft');

    expect(await statusOf(booted, report.id)).toBe('approved');
  }, 30_000);

  it('reject: the report goes back to `draft`, a value its status field declares', async () => {
    const booted = await boot(flow);
    const { report, request } = await submitReport(booted, flow.name);

    const res = await decide(booted, request.id, 'reject', rejecter);
    expect(res.finalized).toBe(true);
    expect(res.resumed, `the run was not resumed: ${res.error ?? res.resumeError ?? ''}`).toBe(true);

    const run = (await booted.automation.listRuns(flow.name))[0];
    expect(run.status, `run ended ${run.status}: ${run.error ?? ''}`).toBe('completed');
    expect(run.steps.map((s: any) => s.nodeId)).toContain('return_to_draft');

    expect(await statusOf(booted, report.id)).toBe('draft');
    const declared = ((ExpenseReport as any).fields.status.options as Array<{ value: string }>).map((o) => o.value);
    expect(declared).toEqual(expect.arrayContaining(['approved', 'draft']));
  }, 30_000);

  it('CONTROL — the pre-fix shape (bare `end` arms): the same decisions leave the report `submitted`', async () => {
    const preFix = withoutWriteBack(flow, node);
    // The rollback must actually be a rollback.
    expect((preFix.nodes as any[]).some((n) => n.type === 'update_record')).toBe(false);

    const booted = await boot(preFix);
    const { report, request } = await submitReport(booted, flow.name);
    await decide(booted, request.id, 'approve', approvers[0]);
    const second = await decide(booted, request.id, 'approve', approvers[1]);
    expect(second.finalized).toBe(true);
    expect(second.resumed).toBe(true);

    const run = (await booted.automation.listRuns(flow.name))[0];
    expect(run.status).toBe('completed');
    // The defect as reported: approved request, report still "Submitted".
    expect(await statusOf(booted, report.id)).toBe('submitted');
  }, 30_000);
});
