// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `showcase_project_escalation` runs to the end on a project with no budget or
 * no owner. Both fields are optional on `showcase_project`, and nothing
 * defaults them.
 *
 * THE DEFECT. The `triage` decision branched on `budget > 200000` (e2) and
 * `budget <= 200000` (e3). A flow's trigger record is TOTAL over the object's
 * declared fields, so a project with no budget carries `budget: null`. CEL has
 * no `null > int` overload, so the run failed terminally at the decision and
 * notified nobody. The owner notifies guarded with
 * `has(record.owner) ? record.owner : null`. `has()` is true on a null column,
 * so the guard answered `null`, and the notify node refused a node left with no
 * recipient.
 *
 * THE FIX, in the reference app alone. e2 tests `record.budget != null` before
 * it compares. e3 is the decision's `isDefault` edge, the "otherwise" that also
 * takes a project with no budget. The normal-path and converge notifies fall
 * back to the organization's owners (`role:owner`, the exec the critical
 * branch already alerts) when the owner is blank (`isBlank`, so `null` and
 * `''` alike). The critical branch's owner alert sits behind its own
 * `decision`, because its sibling branch already alerts the exec.
 *
 * THE HARNESS IS THE PRODUCTION ONE for everything the defect touched: a real
 * kernel with ObjectQL over sqlite, the automation plugin and the app's real
 * `showcase_project` object and real flow. The project is written and turned
 * red through the data engine, and the run is handed the row as stored, the
 * way the record-change trigger hands it (that package is not a dependency of
 * this app). So a project with no budget reads `budget: null`, which each case
 * checks before it runs, rather than a hand-written literal missing the key.
 * Messaging is a recorder: what this file is about is which audience each
 * notify hands over, not inbox fan-out.
 */

import { describe, it, expect, afterEach } from 'vitest';

import { Account, Project } from '../src/data/objects/index.js';
import { ProjectEscalationFlow } from '../src/automation/flows/index.js';
import {
  SYS, OWNER_EMAIL, bootShowcaseFlowKernel, closeShowcaseFlowKernels, insertedId, latestRun, stepStatus,
  type ShowcaseFlowKernel,
} from './showcase-flow-run.testkit.js';

const FLOW = ProjectEscalationFlow.name;

afterEach(closeShowcaseFlowKernels);

interface Booted extends ShowcaseFlowKernel { accountId: string }

async function boot(): Promise<Booted> {
  // The critical branch POSTs to an incident system; the kit stubs `fetch`, so
  // the try/catch takes its success path without leaving the process.
  const kernel = await bootShowcaseFlowKernel([Account, Project], [ProjectEscalationFlow]);
  const account = await kernel.data.insert('showcase_account', { name: 'Escalation Co' }, SYS);
  return { ...kernel, accountId: insertedId(account) };
}

/**
 * Turn a fresh project red, and run the flow on it the way the record-change
 * trigger does: `record` is the row as stored (every declared column, so a
 * project with no budget reads `budget: null`), `previous` is that row before
 * the update.
 */
async function turnRed(booted: Booted, fields: Record<string, unknown>): Promise<{ result: any; run: any; steps: any[] }> {
  const created = await booted.data.insert('showcase_project', {
    name: 'esc', account: booted.accountId, status: 'planned', health: 'yellow', ...fields,
  }, SYS);
  const id = insertedId(created);
  const previous = await booted.data.findOne('showcase_project', { where: { id }, ...SYS });
  await booted.data.update('showcase_project', { id, health: 'red' }, SYS);
  const record = await booted.data.findOne('showcase_project', { where: { id }, ...SYS });
  // The defect's precondition, measured rather than assumed: the stored row
  // carries every optional field the case left out, as `null`.
  for (const field of ['budget', 'owner']) {
    if (!(field in fields)) expect(record).toHaveProperty(field, null);
  }

  const result = await booted.automation.execute(FLOW, {
    record, previous, object: 'showcase_project', event: 'update', organizationId: null,
  } as any);
  return { result, ...(await latestRun(booted, FLOW)) };
}

describe('showcase_project_escalation on a project missing an optional field', () => {
  it('a project with NO budget takes the normal path and notifies its owner', async () => {
    const booted = await boot();
    const { result, steps } = await turnRed(booted, { owner: OWNER_EMAIL });

    expect(result.error ?? null).toBeNull();
    expect(result.success).toBe(true);
    const status = stepStatus(steps);
    expect(status.notify_normal).toBe('success');
    expect(status.alert).toBe('skipped');
    expect(booted.emitted.map((e) => e.audience)).toEqual([[OWNER_EMAIL], [OWNER_EMAIL]]);
  });

  it('a budgeted project with NO owner takes the normal path and notifies the exec instead', async () => {
    const booted = await boot();
    const { result, steps } = await turnRed(booted, { budget: 1000 });

    expect(result.error ?? null).toBeNull();
    expect(result.success).toBe(true);
    expect(stepStatus(steps).notify_normal).toBe('success');
    expect(booted.emitted.map((e) => e.audience)).toEqual([['role:owner'], ['role:owner']]);
  });

  it('a blank owner reads as no owner: the normal path notifies the exec', async () => {
    const booted = await boot();
    const { result } = await turnRed(booted, { budget: 1000, owner: '' });

    expect(result.error ?? null).toBeNull();
    expect(result.success).toBe(true);
    expect(booted.emitted.map((e) => e.audience)).toEqual([['role:owner'], ['role:owner']]);
  });

  it('a project with neither budget nor owner still completes and reaches the exec', async () => {
    const booted = await boot();
    const { result } = await turnRed(booted, {});

    expect(result.error ?? null).toBeNull();
    expect(result.success).toBe(true);
    expect(booted.emitted.map((e) => e.audience)).toEqual([['role:owner'], ['role:owner']]);
  });

  it('control: a budgeted project with an owner still takes e3 to notify_normal', async () => {
    const booted = await boot();
    const { result, steps } = await turnRed(booted, { budget: 1000, owner: OWNER_EMAIL });

    expect(result.success).toBe(true);
    const status = stepStatus(steps);
    expect(status.notify_normal).toBe('success');
    expect(status.alert).toBe('skipped');
    expect(booted.emitted.map((e) => e.audience)).toEqual([[OWNER_EMAIL], [OWNER_EMAIL]]);
  });

  it('a critical project with NO owner skips the owner alert and still alerts the exec once', async () => {
    const booted = await boot();
    const { result, steps } = await turnRed(booted, { budget: 500_000 });

    expect(result.error ?? null).toBeNull();
    expect(result.success).toBe(true);
    const status = stepStatus(steps);
    expect(status.alert_exec).toBe('success');
    expect(status.alert_owner).toBe('skipped');
    expect(status.notify_normal).toBe('skipped');
    const critical = booted.emitted.filter((e) => e.title.startsWith('🔴'));
    expect(critical.map((e) => e.audience)).toEqual([['role:owner']]);
  });

  it('control: a critical project with an owner alerts both the owner and the exec', async () => {
    const booted = await boot();
    const { result, steps } = await turnRed(booted, { budget: 500_000, owner: OWNER_EMAIL });

    expect(result.success).toBe(true);
    const status = stepStatus(steps);
    expect(status.alert_owner).toBe('success');
    expect(status.alert_exec).toBe('success');
    const critical = booted.emitted.filter((e) => e.title.startsWith('🔴'));
    expect(critical.map((e) => e.audience).sort()).toEqual([[OWNER_EMAIL], ['role:owner']]);
  });
});
