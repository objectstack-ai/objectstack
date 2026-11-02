// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every showcase `notify` whose recipient reads an optional user field still
 * completes its run when that field is empty.
 *
 * THE DEFECT. These slots guarded the field with `has(FIELD) ? FIELD : null`.
 * A flow's trigger record is TOTAL over the object's declared fields, so a task
 * with no assignee carries `assignee: null`, `has(record.assignee)` is true, and
 * the guard answers `null`. A notify left with no recipient refuses the node,
 * and the run fails: nobody is told, and the reference app teaches a guard that
 * guards nothing.
 *
 * THE FIX, flow by flow, in the reference app alone (no engine, CEL or notify
 * change; the notify still refuses a node with no recipient):
 *
 *  - A message about the record that someone should see falls back to the
 *    organization's owners: `isBlank(record.assignee) ? 'role:owner' :
 *    record.assignee`, the recipient `showcase_project_escalation` already uses.
 *  - A message addressed to the assignee alone ("you have been assigned", "your
 *    task is due", "please update it") sits behind a `decision` whose one edge
 *    is `!isBlank(record.assignee)`: with no assignee there is nobody to address,
 *    and the run ends there, completed.
 *  - A loop row is caller data, so its key may be ABSENT as well as null:
 *    `has(task.owner) && !isBlank(task.owner) ? task.owner : 'role:owner'`.
 *
 * THE HARNESS is `showcase-flow-run.testkit.ts`: a real kernel, ObjectQL over
 * sqlite, the automation plugin, the app's real objects and real flows. A
 * record-triggered case writes the row through the data engine and hands the
 * flow the row as stored, so the empty field reads `null`, which each case
 * checks before it runs. Each empty case has a control that still notifies the
 * field's user.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { defineFlow } from '@objectstack/spec';

import stack from '../objectstack.config.js';
import { Account, Project, Task, ExpenseReport, ExpenseLine } from '../src/data/objects/index.js';
import {
  TaskCompletedFlow,
  TaskAssignedNotifyFlow,
  BudgetApprovalFlow,
  TaskFollowUpFlow,
  ProjectClosureFlow,
  BatchRemindersFlow,
  FanOutNotifyFlow,
  NestedFanOutRemindersFlow,
  CommitteeQuorumFlow,
  TaskDueReminderFlow,
  UrgentTaskAlertFlow,
} from '../src/automation/flows/index.js';
import {
  SYS, OWNER_EMAIL, bootShowcaseFlowKernel, closeShowcaseFlowKernels, insertedId, latestRun, stepStatus,
  type ShowcaseFlowKernel,
} from './showcase-flow-run.testkit.js';

afterEach(closeShowcaseFlowKernels);

/**
 * `showcase_project_closure` waits on a manager approval inside its sign-off
 * subflow. What this file reads is the parent's notify after the decision
 * bubbles back, so the subflow is stood in for by one that decides at once,
 * under the same name and the same input/output variables.
 */
const SignoffDecidesAtOnce = defineFlow({
  name: 'showcase_closure_signoff',
  label: 'Closure Sign-off (decides at once, test stand-in)',
  type: 'autolaunched',
  variables: [
    { name: 'reason', type: 'text', isInput: true },
    { name: 'decision', type: 'text', isOutput: true },
  ],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'mark_approved', type: 'assignment', label: 'Record Approval', config: { assignments: { decision: 'approved' } } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'mark_approved' },
    { id: 'e2', source: 'mark_approved', target: 'end' },
  ],
});

interface Booted extends ShowcaseFlowKernel { projectId: string; accountId: string }

async function boot(flows: readonly unknown[]): Promise<Booted> {
  const kernel = await bootShowcaseFlowKernel([Account, Project, Task, ExpenseReport, ExpenseLine], flows);
  // `showcase_task_completed` composes its message in a registered function.
  kernel.objectql.registerFunction('summarizeCompletedTask', (stack as any).functions.summarizeCompletedTask);
  const account = await kernel.data.insert('showcase_account', { name: 'Notify Co' }, SYS);
  const accountId = insertedId(account);
  const project = await kernel.data.insert('showcase_project', { name: 'notify', account: accountId, status: 'planned' }, SYS);
  return { ...kernel, accountId, projectId: insertedId(project) };
}

interface Run { result: any; run: any; steps: any[]; record: any }

/**
 * Write a row, apply `updates` to it in turn, and run `flow` on the row as
 * stored, the way the record-change trigger hands it. `previous` is the row
 * before the last update; with no update the run is the create leg (no
 * `previous`). The trigger runs a flow inside the write, so the run holds a
 * save-notice channel, as the trigger's would.
 */
async function runOnRow(
  booted: Booted,
  flow: { name: string },
  object: string,
  fields: Record<string, unknown>,
  updates: Array<Record<string, unknown>> = [],
  extra: Record<string, unknown> = {},
): Promise<Run> {
  const id = insertedId(await booted.data.insert(object, fields, SYS));
  let before = await booted.data.findOne(object, { where: { id }, ...SYS });
  for (const update of updates) {
    before = await booted.data.findOne(object, { where: { id }, ...SYS });
    await booted.data.update(object, { id, ...update }, SYS);
  }
  const record = await booted.data.findOne(object, { where: { id }, ...SYS });
  const result = await booted.automation.execute(flow.name, {
    record,
    ...(updates.length ? { previous: before } : {}),
    object,
    event: updates.length ? 'update' : 'insert',
    organizationId: null,
    saveNotice: { set() {} },
    ...extra,
  } as any);
  return { result, record, ...(await latestRun(booted, flow.name)) };
}

function task(booted: Booted, fields: Record<string, unknown>): Record<string, unknown> {
  return { title: 'Write the notes', project: booted.projectId, status: 'in_review', ...fields };
}

const audiences = (booted: Booted) => booted.emitted.map((e) => e.audience);

function expectCompleted(result: any): void {
  expect(result.error ?? null).toBeNull();
  expect(result.success).toBe(true);
}

describe('showcase_task_completed (notify the assignee that the task is done)', () => {
  it('a task with NO assignee completes and tells the organization owners', async () => {
    const booted = await boot([TaskCompletedFlow]);
    const { result, record, steps } = await runOnRow(booted, TaskCompletedFlow, 'showcase_task', task(booted, {}), [{ status: 'done' }]);

    expect(record).toHaveProperty('assignee', null);
    expectCompleted(result);
    expect(stepStatus(steps).notify).toBe('success');
    expect(audiences(booted)).toEqual([['role:owner']]);
  });

  it('control: a task with an assignee still tells the assignee', async () => {
    const booted = await boot([TaskCompletedFlow]);
    const { result } = await runOnRow(booted, TaskCompletedFlow, 'showcase_task', task(booted, { assignee: OWNER_EMAIL }), [{ status: 'done' }]);

    expectCompleted(result);
    expect(audiences(booted)).toEqual([[OWNER_EMAIL]]);
  });
});

describe('showcase_task_assigned_notify (tell the new assignee)', () => {
  it('unassigning a task completes without a notify: there is nobody to tell', async () => {
    const booted = await boot([TaskAssignedNotifyFlow]);
    const { result, record, steps } = await runOnRow(
      booted, TaskAssignedNotifyFlow, 'showcase_task', task(booted, { assignee: OWNER_EMAIL }), [{ assignee: null }],
    );

    expect(record).toHaveProperty('assignee', null);
    expectCompleted(result);
    expect(stepStatus(steps).notify_assignee ?? 'not run').not.toBe('success');
    expect(audiences(booted)).toEqual([]);
  });

  it('control: assigning a task still tells the new assignee', async () => {
    const booted = await boot([TaskAssignedNotifyFlow]);
    const { result, steps } = await runOnRow(
      booted, TaskAssignedNotifyFlow, 'showcase_task', task(booted, {}), [{ assignee: OWNER_EMAIL }],
    );

    expectCompleted(result);
    expect(stepStatus(steps).notify_assignee).toBe('success');
    expect(audiences(booted)).toEqual([[OWNER_EMAIL]]);
  });
});

describe('showcase_task_follow_up (remind the assignee after the wait)', () => {
  async function createAndResume(booted: Booted, fields: Record<string, unknown>) {
    const first = await runOnRow(booted, TaskFollowUpFlow, 'showcase_task', task(booted, { status: 'todo', ...fields }));
    const runId = first.result.runId ?? first.run.id;
    expect(runId, 'the run parks at its timer wait').toBeTruthy();
    const result = await booted.automation.resume(runId);
    return { result, record: first.record, ...(await latestRun(booted, TaskFollowUpFlow.name)) };
  }

  it('a task with NO assignee completes without a reminder', async () => {
    const booted = await boot([TaskFollowUpFlow]);
    const { result, record, steps } = await createAndResume(booted, {});

    expect(record).toHaveProperty('assignee', null);
    expectCompleted(result);
    expect(stepStatus(steps).remind ?? 'not run').not.toBe('success');
    expect(audiences(booted)).toEqual([]);
  });

  it('control: a task with an assignee still reminds the assignee', async () => {
    const booted = await boot([TaskFollowUpFlow]);
    const { result } = await createAndResume(booted, { assignee: OWNER_EMAIL });

    expectCompleted(result);
    expect(audiences(booted)).toEqual([[OWNER_EMAIL]]);
  });
});

describe('showcase_project_closure (tell the owner the sign-off decision)', () => {
  async function complete(booted: Booted, fields: Record<string, unknown>) {
    return runOnRow(
      booted, ProjectClosureFlow, 'showcase_project',
      { name: 'closing', account: booted.accountId, status: 'planned', ...fields },
      [{ status: 'active' }, { status: 'completed' }],
    );
  }

  it('a project with NO owner completes and tells the organization owners', async () => {
    const booted = await boot([ProjectClosureFlow, SignoffDecidesAtOnce]);
    const { result, record, steps } = await complete(booted, {});

    expect(record).toHaveProperty('owner', null);
    expectCompleted(result);
    expect(stepStatus(steps).notify_owner).toBe('success');
    expect(audiences(booted)).toEqual([['role:owner']]);
  });

  it('control: a project with an owner still tells the owner', async () => {
    const booted = await boot([ProjectClosureFlow, SignoffDecidesAtOnce]);
    const { result } = await complete(booted, { owner: OWNER_EMAIL });

    expectCompleted(result);
    expect(audiences(booted)).toEqual([[OWNER_EMAIL]]);
  });
});

describe('showcase_fan_out_notify (tell the owner, in parallel with Slack)', () => {
  it('a task with NO assignee completes and tells the organization owners', async () => {
    const booted = await boot([FanOutNotifyFlow]);
    const { result, record, steps } = await runOnRow(booted, FanOutNotifyFlow, 'showcase_task', task(booted, {}), [{ status: 'done' }]);

    expect(record).toHaveProperty('assignee', null);
    expectCompleted(result);
    expect(stepStatus(steps).notify_owner).toBe('success');
    expect(audiences(booted)).toEqual([['role:owner']]);
  });

  it('control: a task with an assignee still tells the assignee', async () => {
    const booted = await boot([FanOutNotifyFlow]);
    const { result } = await runOnRow(booted, FanOutNotifyFlow, 'showcase_task', task(booted, { assignee: OWNER_EMAIL }), [{ status: 'done' }]);

    expectCompleted(result);
    expect(audiences(booted)).toEqual([[OWNER_EMAIL]]);
  });
});

describe('showcase_task_due_reminder (remind the assignee before the due date)', () => {
  it('a task with NO assignee completes without a reminder', async () => {
    const booted = await boot([TaskDueReminderFlow]);
    const { result, record, steps } = await runOnRow(booted, TaskDueReminderFlow, 'showcase_task', task(booted, { status: 'todo' }));

    expect(record).toHaveProperty('assignee', null);
    expectCompleted(result);
    expect(stepStatus(steps).remind_owner ?? 'not run').not.toBe('success');
    expect(audiences(booted)).toEqual([]);
  });

  it('control: a task with an assignee is still reminded', async () => {
    const booted = await boot([TaskDueReminderFlow]);
    const { result } = await runOnRow(booted, TaskDueReminderFlow, 'showcase_task', task(booted, { status: 'todo', assignee: OWNER_EMAIL }));

    expectCompleted(result);
    expect(audiences(booted)).toEqual([[OWNER_EMAIL]]);
  });
});

describe('showcase_urgent_task_alert (the assignee and whoever raised it)', () => {
  it('a user raising an unassigned task to urgent completes and alerts that user', async () => {
    const booted = await boot([UrgentTaskAlertFlow]);
    const { result, record } = await runOnRow(
      booted, UrgentTaskAlertFlow, 'showcase_task', task(booted, {}), [{ priority: 'urgent' }], { userId: 'usr_admin' },
    );

    expect(record).toHaveProperty('assignee', null);
    expectCompleted(result);
    expect(audiences(booted)).toEqual([['usr_admin']]);
  });

  it('a system write raising an unassigned task to urgent completes and alerts the organization owners', async () => {
    const booted = await boot([UrgentTaskAlertFlow]);
    const { result, record } = await runOnRow(booted, UrgentTaskAlertFlow, 'showcase_task', task(booted, {}), [{ priority: 'urgent' }]);

    expect(record).toHaveProperty('assignee', null);
    expectCompleted(result);
    expect(audiences(booted)).toEqual([['role:owner']]);
  });

  it('control: an assigned task alerts the assignee and the user who raised it', async () => {
    const booted = await boot([UrgentTaskAlertFlow]);
    const { result } = await runOnRow(
      booted, UrgentTaskAlertFlow, 'showcase_task', task(booted, { assignee: OWNER_EMAIL }), [{ priority: 'urgent' }], { userId: 'usr_admin' },
    );

    expectCompleted(result);
    expect(audiences(booted)).toEqual([[OWNER_EMAIL, 'usr_admin']]);
  });
});

describe('the loop flows (rows are caller data: a key may be absent or null)', () => {
  const ROWS_MISSING = [
    { id: 't1', title: 'No owner key, no watcher key' },
    { id: 't2', title: 'Null owner, blank watcher', owner: null, watcher: '' },
  ];

  it('showcase_nested_fan_out_reminders: rows missing a recipient complete and reach the organization owners', async () => {
    const booted = await boot([NestedFanOutRemindersFlow]);
    const result = await booted.automation.execute(NestedFanOutRemindersFlow.name, { params: { tasks: ROWS_MISSING } } as any);

    expectCompleted(result);
    expect(audiences(booted)).toEqual([['role:owner'], ['role:owner'], ['role:owner'], ['role:owner']]);
  });

  it('control: showcase_nested_fan_out_reminders still notifies each row\'s owner and watcher', async () => {
    const booted = await boot([NestedFanOutRemindersFlow]);
    const result = await booted.automation.execute(NestedFanOutRemindersFlow.name, {
      params: { tasks: [{ id: 't1', title: 'Both set', owner: OWNER_EMAIL, watcher: 'usr_admin' }] },
    } as any);

    expectCompleted(result);
    expect(audiences(booted).sort()).toEqual([[OWNER_EMAIL], ['usr_admin']]);
  });

  it('showcase_batch_reminders: rows missing an owner complete (each iteration is contained)', async () => {
    const booted = await boot([BatchRemindersFlow]);
    const result = await booted.automation.execute(BatchRemindersFlow.name, { params: { tasks: ROWS_MISSING } } as any);

    expectCompleted(result);
  });
});

describe('start conditions on an empty number', () => {
  it('showcase_budget_approval: clearing a budget completes as not started', async () => {
    const booted = await boot([BudgetApprovalFlow]);
    const { result, record } = await runOnRow(
      booted, BudgetApprovalFlow, 'showcase_project',
      { name: 'budgeted', account: booted.accountId, status: 'planned', budget: 250_000 }, [{ budget: null }],
    );

    expect(record).toHaveProperty('budget', null);
    expectCompleted(result);
    expect(result.output).toMatchObject({ skipped: true });
  });

  it('showcase_committee_quorum: a report with no lines sums to 0, so it completes as not started', async () => {
    // Fine as written: the sum summary reads 0 on a report with no lines, not
    // `null`, so `total_amount >= 5000` never meets a null.
    const booted = await boot([CommitteeQuorumFlow]);
    const { result, record } = await runOnRow(
      booted, CommitteeQuorumFlow, 'showcase_expense_report', { name: 'empty', status: 'draft' }, [{ status: 'submitted' }],
    );

    expect(record).toHaveProperty('total_amount', 0);
    expectCompleted(result);
    expect(result.output).toMatchObject({ skipped: true });
  });
});
