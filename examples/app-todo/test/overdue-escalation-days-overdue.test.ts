// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18584] The `overdue_escalation` notice renders a real number.
 *
 * The defect this pins was silent: `flows/task.flow.ts` interpolated
 * `{currentTask.days_overdue}` into the notification body while `todo_task`
 * declared no such field, so every escalation went out as
 * `Due 2026-09-30,  day(s) overdue.` — a blank where the count belongs. No
 * error, no refusal; the widened `validate-flow-template-paths` rule (PR
 * #18583) reported it as an advisory warning and no CI job runs
 * `objectstack validate` over `examples/`, so nothing red.
 *
 * ⭐ WHY THIS IS A RUNTIME SUITE AND NOT A METADATA ASSERTION. "A formula
 * field exists on the object" and "the projection the flow's `loop` iterates
 * carries its COMPUTED value" are different questions, and only the second one
 * decides whether the template can promise a day count at all. A formula field
 * is VIRTUAL — no driver materialises a column for it (see the `is_completed`
 * / `is_overdue` paragraph in `src/objects/task.object.ts`, where that same
 * virtuality is the reason those two are NOT formulas). So the value has to be
 * observed where it is consumed: off the rendered notification body, after a
 * real `get_record` → `loop` → `notify` run over a real driver.
 *
 * The chain is real end to end — a real kernel, real ObjectQL over
 * sqlite-wasm, the real automation engine, the app's own `Task` object and its
 * own `OverdueEscalationFlow`. The only double is the `messaging` service, and
 * it is a RECORDER, not a stand-in for behaviour under test: `notify` hands
 * the rendered title/body to whatever is registered under `messaging`, so
 * capturing that call is how the rendered text becomes observable. Without it
 * `notify` degrades to a no-op success and the body is never produced.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';

import { OverdueEscalationFlow } from '../src/flows/index.js';
import { Task } from '../src/objects/task.object.js';

/** One `messaging.emit()` call, as the `notify` node made it. */
interface EmitCall {
  topic: string;
  audience: string[];
  payload?: Record<string, unknown>;
  severity?: string;
}

const openDrivers: Array<{ disconnect?: () => Promise<void> }> = [];
afterEach(async () => {
  while (openDrivers.length) {
    try { await openDrivers.pop()?.disconnect?.(); } catch { /* noop */ }
  }
});

/** `n` whole days before this instant, as a `Field.date` string (UTC). */
function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function bootTodoKernel(): Promise<{
  automation: AutomationEngine & Record<string, any>;
  data: any;
  emits: EmitCall[];
}> {
  const emits: EmitCall[] = [];

  const kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new AutomationServicePlugin());
  // Recorder for the one seam that makes the rendered body observable.
  await kernel.use({
    name: 'test-messaging-recorder',
    version: '1.0.0',
    async setup(ctx: any) {
      ctx.registerService('messaging', {
        async emit(input: EmitCall) {
          emits.push(input);
          return { notificationId: `ntf-${emits.length}`, delivered: input.audience.length, failed: 0 };
        },
      });
    },
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
  return { automation, data, emits };
}

describe('#18584 — the overdue escalation notice carries a day count', () => {
  it('the `loop` projection carries the COMPUTED formula value, so the body renders a number', async () => {
    const { automation, data, emits } = await bootTodoKernel();

    const due = daysAgoIso(5);
    await data.insert('todo_task', {
      subject: 'Renew the domain',
      status: 'not_started',
      priority: 'normal',
      due_date: due,
      owner: 'usr_test_owner',
    }, { context: { isSystem: true } });

    const result = await automation.execute(OverdueEscalationFlow.name, { tenantId: 'org_test' } as any);
    expect(result.success, JSON.stringify(result)).toBe(true);

    expect(emits).toHaveLength(1);
    const body = String((emits[0].payload as Record<string, unknown>).body);

    // The defect, stated as the assertion that fails on the old metadata: the
    // template's day-count slot must not render empty.
    expect(body).not.toMatch(/,\s+day\(s\) overdue\./);
    // And the value is the real span, not merely "something".
    expect(body).toBe(`Due ${due}, 5 day(s) overdue.`);
  });

  it('0 when the task is not overdue, and 0 when `due_date` is empty', async () => {
    const { data } = await bootTodoKernel();

    // Read the field the way the flow's `get_record` does — no explicit
    // projection, which is what makes `planFormulaProjection` evaluate every
    // formula on the schema.
    await data.insert('todo_task', {
      subject: 'Future task', status: 'not_started', priority: 'normal',
      due_date: daysAgoIso(-3), owner: 'usr_test_owner',
    }, { context: { isSystem: true } });
    await data.insert('todo_task', {
      subject: 'No due date', status: 'not_started', priority: 'normal',
      owner: 'usr_test_owner',
    }, { context: { isSystem: true } });

    const rows: Array<Record<string, unknown>> = await data.find('todo_task', {
      where: {}, limit: 200, context: { isSystem: true },
    });
    const bySubject = new Map(rows.map((r) => [String(r.subject), r]));

    expect(Number(bySubject.get('Future task')?.days_overdue)).toBe(0);
    expect(Number(bySubject.get('No due date')?.days_overdue)).toBe(0);
  });
});
