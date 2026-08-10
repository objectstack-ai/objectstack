// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6882] `task_completion` is a LIVE record-change flow — binding, gate, and
 * the silence that hid it.
 *
 * The defect this pins was not a wrong answer; it was **no answer anywhere**.
 * `TaskCompletionFlow` declared `type: 'record_change'` and then declared
 * neither key that arms one:
 *
 *   1. no `config.triggerType`. `AutomationEngine.resolveTriggerBinding` claims
 *      a record-change flow only for a token starting with `record-`; absent,
 *      every later branch missed too and it returned `undefined`, so
 *      `activateFlowTrigger` returned without binding.
 *   2. the predicate was written to `config.triggerCondition`, a key nothing
 *      reads. The gate is `config.condition`. A node `config` is an open slot
 *      by design (ADR-0018), so the misspelling parsed silently — and arming
 *      (1) without fixing (2) would have been WORSE than dead: the flow would
 *      have fired on every single update.
 *
 * Why nothing caught it, and why the reverse check below asserts an ABSENCE:
 * `getTriggerBindingAudit` — the platform's own silent-miss channel, and the
 * source for both the automation plugin's `kernel:bootstrapped` warn loop and
 * the CLI startup summary's `unbound` list — opens with
 * `if (!resolved) continue`, reading "no binding" as "manual/screen flow,
 * nothing to bind". So removing `triggerType` does not ADD a diagnostic; it
 * REMOVES the flow from every diagnostic channel there is. That inverted
 * direction is the whole reason this needs a test rather than a lint rule
 * reading a warning nobody emits.
 *
 * The suite drives the app's REAL metadata (`allFlows`, the real `Task`
 * object) through a real kernel and real writes, so it fails if any link is
 * re-broken: the trigger token, the condition key, the predicate's dialect, or
 * the engine's resolver.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';

import { allFlows, TaskCompletionFlow } from '../src/flows/index.js';
import { Task } from '../src/objects/task.object.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every driver a test opened, closed when that test ends. */
const openDrivers: Array<{ disconnect?: () => Promise<void> }> = [];
afterEach(async () => {
  while (openDrivers.length) {
    try { await openDrivers.pop()?.disconnect?.(); } catch { /* noop */ }
  }
});

/**
 * A real kernel with the app's real `todo_task` object: ObjectQL over an
 * in-process sqlite-wasm database (the same driver `test/mcp-actions.e2e.ts`
 * boots), the automation engine, and the record-change trigger. No test double
 * anywhere in the chain — #6882 was precisely a chain that looked correct in
 * the metadata and bound to nothing at runtime.
 */
async function bootTodoKernel(): Promise<{
  automation: AutomationEngine & Record<string, any>;
  data: any;
}> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new AutomationServicePlugin());
  await kernel.use(new RecordChangeTriggerPlugin());
  await kernel.bootstrap();

  const objectql: any = kernel.getService('objectql');
  const data: any = kernel.getService('data');
  const automation = kernel.getService<AutomationEngine>('automation') as AutomationEngine & Record<string, any>;

  const driver: any = new SqliteWasmDriver({ filename: ':memory:' });
  await driver.connect();
  objectql.registerDriver(driver, true);
  openDrivers.push(driver);
  objectql.registry.registerObject(Task, 'todo', 'todo');
  await objectql.syncSchemas();

  for (const flow of allFlows) automation.registerFlow(flow.name, flow);
  return { automation, data };
}

/** The `start` node config of a flow, as authored. */
function startConfig(flow: unknown): Record<string, unknown> {
  const nodes = (flow as { nodes?: Array<{ type?: string; config?: Record<string, unknown> }> }).nodes ?? [];
  return nodes.find((n) => n?.type === 'start')?.config ?? {};
}

describe('#6882 — app-todo `task_completion` is armed, not dead', () => {
  it('declares the two keys the engine actually reads', () => {
    const config = startConfig(TaskCompletionFlow);

    // The token has to be one the record-change trigger maps to a hook, not
    // merely `record-`-prefixed: the engine routes ANY `record-` string to the
    // trigger, which then maps an unknown token to no hook at all.
    expect(config.triggerType).toBe('record-after-update');
    expect(config.objectName).toBe('todo_task');

    // `condition` is the gate; `triggerCondition` is the misspelling that made
    // the predicate inert. Assert BOTH, so re-introducing the typo alongside a
    // correct `condition` is still caught.
    expect(typeof config.condition).toBe('string');
    expect(config).not.toHaveProperty('triggerCondition');
  });

  it('no start node in the app writes its predicate to an unread key', () => {
    // The class, not just the instance: a node `config` is an open slot
    // (ADR-0018), so any misspelling here parses silently and gates nothing.
    for (const flow of allFlows) {
      const config = startConfig(flow);
      for (const key of ['triggerCondition', 'trigger_condition', 'startCondition']) {
        expect(config, `flow '${flow.name}' start node`).not.toHaveProperty(key);
      }
    }
  });

  it('BINDS: the flow is wired to afterUpdate on todo_task at runtime', async () => {
    const { automation } = await bootTodoKernel();

    const state = automation.getFlowRuntimeStates().find((s: any) => s.name === 'task_completion');
    expect(state).toBeDefined();
    expect(state!.bound, 'the flow resolved a binding and the trigger accepted it').toBe(true);
    expect(state!.triggerType).toBe('record_change');
    expect(state!.object).toBe('todo_task');

    // And the silent-miss audit has nothing to say about it, because there is
    // nothing left unbound.
    const audit = automation.getTriggerBindingAudit();
    expect(audit.find((a: any) => a.flowName === 'task_completion')).toBeUndefined();
  });

  it('REVERSE: drop `triggerType` and the flow vanishes from every audit channel', async () => {
    const { automation } = await bootTodoKernel();

    // The pre-#6882 shape, rebuilt from the real flow so it cannot drift: the
    // authored trigger token removed, everything else identical.
    const dead = JSON.parse(JSON.stringify(TaskCompletionFlow)) as any;
    dead.name = 'task_completion_unarmed_fixture';
    delete dead.nodes.find((n: any) => n.type === 'start').config.triggerType;
    automation.registerFlow(dead.name, dead);

    const state = automation.getFlowRuntimeStates().find((s: any) => s.name === dead.name);
    expect(state!.bound).toBe(false);
    // `triggerType` undefined is the resolver having given up entirely — the
    // flow reads as manual/screen, which is why nothing downstream reports it.
    expect(state!.triggerType).toBeUndefined();

    // The direction that makes this a test and not a lint rule: the audit gains
    // NOTHING. An unbound-but-resolvable flow appears here; this one does not,
    // so no warn loop and no CLI `unbound` line ever names it.
    const audit = automation.getTriggerBindingAudit();
    expect(audit.find((a: any) => a.flowName === dead.name)).toBeUndefined();

    // Non-vacuous: the same fixture WITH the key is bound and audited-clean —
    // so the assertions above are about the missing key, not about the fixture
    // failing to register.
    expect(
      automation.getFlowRuntimeStates().find((s: any) => s.name === 'task_completion')!.bound,
    ).toBe(true);
  });

  it('GATES: only a transition INTO completed fires the flow', async () => {
    const { automation, data } = await bootTodoKernel();
    const ctx = { context: { userId: 'u_todo' } };
    const runCount = async () => (await automation.listRuns('task_completion')).length;

    // `completed_date` is seeded on CREATE (the engine allows a read-only field
    // to be seeded by an insert, and the object's `completed_date_required`
    // rule refuses the completion write otherwise — see the note on that rule).
    const created = await data.insert('todo_task', {
      subject: 'Water the plants',
      status: 'not_started',
      priority: 'normal',
      is_recurring: false,
      completed_date: '2026-08-09T10:00:00.000Z',
    }, ctx);
    const id = Array.isArray(created) ? created[0].id : created.id;
    await sleep(150);
    expect(await runCount(), 'an INSERT must not reach an after-update flow').toBe(0);

    // A write that should NOT fire it: the record changes, the status does not.
    await data.update('todo_task', { priority: 'high' }, { where: { id }, ...ctx });
    await sleep(150);
    expect(await runCount(), 'the start condition must gate on the status transition').toBe(0);

    // A write that SHOULD fire it.
    await data.update('todo_task', { status: 'completed' }, { where: { id }, ...ctx });
    await sleep(400);
    const afterTransition = await automation.listRuns('task_completion');
    expect(afterTransition.length, 'the completion transition must launch the flow').toBe(1);
    // It RAN, rather than merely being dispatched: the whole flow reached `end`.
    expect(afterTransition[0].status).toBe('completed');
    expect((afterTransition[0].steps ?? []).map((s: any) => s.nodeId)).toContain('get_task');

    // And it does not re-fire on every later save of an already-completed task —
    // the half of the predicate that `previous` exists for.
    await data.update('todo_task', { progress_percent: 100 }, { where: { id }, ...ctx });
    await sleep(300);
    expect(await runCount(), 're-saving a completed task must not re-fire it').toBe(1);
  }, 30000);
});
