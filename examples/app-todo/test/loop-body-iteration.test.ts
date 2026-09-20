// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19206] Both `loop` nodes own a `config.body`, so `currentTask` is bound and
 * the per-item steps actually run.
 *
 * The defect this pins was a shipped example app whose scheduled sweep died one
 * node in. Both loops declared `collection` + `iteratorVariable` and NO
 * `config.body`, which is the LEGACY flat-graph form — `loop-node.ts` opens with
 * `if (raw.body == null)`, sets `$loopItems` / `$loopIndex` and returns WITHOUT
 * binding `iteratorVariable`. The per-item steps were wired as ordinary nodes
 * AFTER the container, so every `{currentTask.X}` token in them resolved to
 * nothing: `update_priority` refused to run (its filter had been erased), and
 * `notify_owner` — one node BEHIND that refusal — was never reached. No
 * escalation notice was sent at all.
 *
 * ⭐ WHY THIS SUITE DRIVES THE ENGINE INSTEAD OF ASSERTING ON METADATA.
 * "the flow declares a `config.body`" and "the loop body executes with the
 * iterator bound" are different questions, and only the second one decides
 * whether a notice is sent. A suite that asserts the shape would have stayed
 * green through the entire defect had the shape merely been spelled
 * differently; so the flow is registered on a real `AutomationEngine`, over a
 * real sqlite-wasm database holding the app's real `todo_task`, and the run's
 * EFFECTS are read back: the row the loop escalated, and the notification the
 * messaging service was handed.
 *
 * The `messaging` service is the one double here, and it is a capture, not a
 * simulation: `notify` resolves whatever object is registered under that
 * service and calls `emit()` (`notify-node.ts`), so capturing the call is how
 * the RENDERED notice — title and body, after interpolation — becomes readable
 * at all. Everything else in the chain is the real thing.
 *
 * The last test is the positive control: the pre-fix shape, rebuilt from the
 * real flow by deleting `config.body` and re-wiring the flat edges, still dies
 * at `update_priority`. Without it a green suite could not distinguish "the
 * loop body ran" from "nothing in this harness can fail".
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';

import { OverdueEscalationFlow, TaskReminderFlow } from '../src/flows/index.js';
import { Task } from '../src/objects/task.object.js';

/** One captured `messaging.emit()` call — the notice as the service received it. */
interface CapturedEmit {
  topic: string;
  audience: string[];
  payload: Record<string, unknown>;
  severity?: string;
  source?: { object: string; id: string };
}

const openDrivers: Array<{ disconnect?: () => Promise<void> }> = [];
afterEach(async () => {
  while (openDrivers.length) {
    try { await openDrivers.pop()?.disconnect?.(); } catch { /* noop */ }
  }
});

/** `n` whole days before today, as a `Field.date` string (UTC); negative = future. */
function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * A real kernel with the app's real `todo_task` over in-process sqlite-wasm,
 * the real automation engine, and a capturing `messaging` service.
 */
async function bootTodoKernel(): Promise<{
  automation: AutomationEngine & Record<string, any>;
  data: any;
  emits: CapturedEmit[];
}> {
  const emits: CapturedEmit[] = [];
  const messaging = {
    async emit(input: CapturedEmit) {
      emits.push(input);
      return { notificationId: `ntf_${emits.length}`, delivered: input.audience.length, failed: 0 };
    },
  };

  const kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new AutomationServicePlugin());
  await kernel.use({
    name: 'test.messaging-capture',
    type: 'standard' as const,
    version: '1.0.0',
    dependencies: [] as string[],
    async init(ctx: any) { ctx.registerService('messaging', messaging); },
    async start() { /* noop */ },
  } as any);
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

  automation.registerFlow(OverdueEscalationFlow.name, OverdueEscalationFlow);
  automation.registerFlow(TaskReminderFlow.name, TaskReminderFlow);
  return { automation, data, emits };
}

const SYSTEM = { context: { isSystem: true } };

/** Seed one task `days` days past due, and return its id. */
async function seedOverdueTask(data: any, subject: string, days: number, owner = 'usr_test_owner'): Promise<string> {
  const row = await data.insert('todo_task', {
    subject, status: 'not_started', priority: 'normal',
    due_date: daysAgoIso(days), owner,
  }, SYSTEM);
  return String(row.id ?? row);
}

describe('#19206 — the loop body runs and binds `currentTask`', () => {
  it('ESCALATION: the run reaches `notify_owner` and the notice renders the real day count', async () => {
    const { automation, data, emits } = await bootTodoKernel();
    const id = await seedOverdueTask(data, 'Renew the domain', 5);

    const result: any = await automation.execute('overdue_escalation');
    expect(result.success, result.error).toBe(true);

    // 1. The loop body's FIRST node ran against the right row. `update_priority`
    //    filters on `{currentTask.id}`; unbound, that condition is erased and
    //    the node refuses (which is how the defect surfaced at all).
    const row: any = await data.findOne('todo_task', { where: { id }, context: { isSystem: true } });
    expect(row.priority, 'the escalated row').toBe('urgent');

    // 2. The node BEHIND that one was reached: exactly one notice, for this row.
    expect(emits).toHaveLength(1);
    expect(emits[0].source).toEqual({ object: 'todo_task', id });
    expect(emits[0].severity).toBe('critical');
    expect(emits[0].audience).toEqual(['usr_test_owner']);

    // 3. And what it RENDERS — the reading the card is unblocking. Every
    //    `{currentTask.X}` hole is filled, `days_overdue` (#18584) included.
    expect(emits[0].payload.title).toBe('URGENT: task overdue — Renew the domain');
    expect(emits[0].payload.body).toBe(`Due ${daysAgoIso(5)}, 5 day(s) overdue.`);
    expect(String(emits[0].payload.body)).not.toContain('{');
  });

  it('EVERY item is processed, and each one carries its own values', async () => {
    const { automation, data, emits } = await bootTodoKernel();
    await seedOverdueTask(data, 'Alpha', 4, 'usr_a');
    await seedOverdueTask(data, 'Bravo', 9, 'usr_b');
    await seedOverdueTask(data, 'Charlie', 12, 'usr_c');

    const result: any = await automation.execute('overdue_escalation');
    expect(result.success, result.error).toBe(true);

    // A binding that leaked across iterations (one item reused for all three)
    // would show up here as three identical notices. Compared SORTED: the
    // sweep's `get_record` step declares no `orderBy`, so the row order is the
    // driver's and asserting it would pin something this card does not own.
    const rendered = emits
      .map((e) => [e.audience[0], e.payload.title, e.payload.body])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(rendered).toEqual([
      ['usr_a', 'URGENT: task overdue — Alpha', `Due ${daysAgoIso(4)}, 4 day(s) overdue.`],
      ['usr_b', 'URGENT: task overdue — Bravo', `Due ${daysAgoIso(9)}, 9 day(s) overdue.`],
      ['usr_c', 'URGENT: task overdue — Charlie', `Due ${daysAgoIso(12)}, 12 day(s) overdue.`],
    ]);

    const rows: any[] = await data.find('todo_task', { where: {}, context: { isSystem: true } });
    expect(rows.map((r) => r.priority)).toEqual(['urgent', 'urgent', 'urgent']);
  });

  it('CONTAINMENT: one un-notifiable row does not end the sweep', async () => {
    const { automation, data, emits } = await bootTodoKernel();
    await seedOverdueTask(data, 'Alpha', 4, 'usr_a');
    // `notify` refuses an empty resolved recipient set (`notify-node.ts`), so
    // this row's iteration fails INSIDE the body's `try_catch`.
    await seedOverdueTask(data, 'Orphan', 6, '');
    await seedOverdueTask(data, 'Charlie', 12, 'usr_c');

    const result: any = await automation.execute('overdue_escalation');
    expect(result.success, result.error).toBe(true);

    // The two notifiable rows were both reached — the failure between them was
    // contained per iteration rather than ending the run.
    expect(emits.map((e) => e.audience[0]).sort()).toEqual(['usr_a', 'usr_c']);
  });

  it('REMINDER: the second loop in the file binds its iterator too', async () => {
    const { automation, data, emits } = await bootTodoKernel();
    await data.insert('todo_task', {
      subject: 'Pay the invoice', status: 'not_started', priority: 'high',
      due_date: daysAgoIso(-1), owner: 'usr_test_owner',
    }, SYSTEM);

    const result: any = await automation.execute('task_reminder');
    expect(result.success, result.error).toBe(true);

    expect(emits).toHaveLength(1);
    expect(emits[0].payload.title).toBe('Task due tomorrow: Pay the invoice');
    expect(emits[0].payload.body).toBe(`Due ${daysAgoIso(-1)} · priority high.`);
    expect(String(emits[0].payload.body)).not.toContain('{');
  });

  it('CONTROL: the pre-fix body-less shape still dies at `update_priority`', async () => {
    const { automation, data, emits } = await bootTodoKernel();
    await seedOverdueTask(data, 'Renew the domain', 5);

    // The pre-#19206 shape, rebuilt from the real flow so it cannot drift: the
    // body region hoisted back out into flat nodes wired after the container.
    const legacy = JSON.parse(JSON.stringify(OverdueEscalationFlow)) as any;
    legacy.name = 'overdue_escalation_bodyless_fixture';
    const loop = legacy.nodes.find((n: any) => n.id === 'loop_overdue');
    const guard = loop.config.body.nodes[0];
    delete loop.config.body;
    delete loop.config.maxIterations;
    legacy.nodes.splice(legacy.nodes.indexOf(loop) + 1, 0, ...guard.config.try.nodes);
    legacy.edges = [
      { id: 'e1', source: 'start', target: 'get_overdue_tasks', type: 'default' },
      { id: 'e2', source: 'get_overdue_tasks', target: 'loop_overdue', type: 'default' },
      { id: 'e3', source: 'loop_overdue', target: 'update_priority', type: 'default' },
      { id: 'e4', source: 'update_priority', target: 'notify_owner', type: 'default' },
      { id: 'e5', source: 'notify_owner', target: 'end', type: 'default' },
    ];
    automation.registerFlow(legacy.name, legacy);

    const result: any = await automation.execute(legacy.name);
    expect(result.success).toBe(false);
    // The exact refusal the card reports, and the reason it is loud rather than
    // catastrophic: an erased filter condition is refused, not widened.
    expect(String(result.error)).toContain('update_record: refusing to run');
    expect(String(result.error)).toContain('{currentTask.id}');

    // And the observable the card is about: nothing was notified, because the
    // run never reached the node that notifies.
    expect(emits).toHaveLength(0);
  });
});
