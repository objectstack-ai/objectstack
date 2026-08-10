// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7037] `task_completion`'s recurrence branch computes a real next due date.
 *
 * The defect: `create_next_task` wrote
 * `DATEADD({completedTask.due_date}, {completedTask.recurrence_interval}, "…")`
 * into `due_date`. Two independent faults stacked:
 *
 *   1. `DATEADD` exists nowhere in the platform — not a CEL builtin, not
 *      registered by `packages/formula` under any casing.
 *   2. a `create_record` node's `fields` are TEMPLATE-interpolated, never
 *      evaluated: the `{…}` holes are filled and the surrounding text passes
 *      through verbatim. So the engine received the literal string
 *      `DATEADD(2026-08-10, 1, "daily")` and the field's own coercion refused it
 *      with `Due Date must be a valid date (ISO-8601)`, failing the run.
 *
 * Reachability, not the defect, changed with #6882: while the flow was unbound
 * the node never executed. Armed, every completion of a RECURRING task produced
 * a failed run, so the recurrence feature the node exists for had never worked.
 *
 * Why a `script` node is the repair and not a stylistic choice: no flow node
 * evaluates a value-producing expression. The builtin vocabulary's only
 * expression slots are PREDICATES (`config.condition`, `edge.condition`,
 * `decision.conditions[].expression`, `screen.fields[].visibleWhen`) and
 * `flow-template` REFERENCES (`loop.collection`, `map.collection`) — the ledger
 * is `FLOW_NODE_EXPRESSION_PATHS` in `@objectstack/spec/automation` — and an
 * `assignment` node interpolates rather than evaluates. The value therefore has
 * to be computed BEFORE the create node, which is what a registered function
 * invoked by a `script` node is for (#1870, pure per #4396).
 *
 * The suite drives the app's REAL metadata (`allFlows`, the real `Task` object,
 * the real `todoFunctions` registry) through a real kernel over sqlite, so it
 * fails if any link is re-broken: the function name, the node wiring, the
 * arithmetic, or the interpolation shape of the `due_date` slot.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';

import { allFlows, TaskCompletionFlow } from '../src/flows/index.js';
import { todoFunctions, computeNextTaskDueDate } from '../src/functions/index.js';
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
 * A real kernel with the app's real `todo_task` object and real flows — the
 * same harness `test/task-completion-trigger.test.ts` boots, plus the one wire
 * that card did not need: the function resolver.
 *
 * `defineStack({ functions })` is bridged to `AutomationEngine.resolveFunction`
 * by the automation plugin when an app bundle is loaded through `AppPlugin`.
 * This suite registers the app's metadata directly (no bundle), so it wires the
 * app's OWN `todoFunctions` map here. That keeps the test honest about what it
 * proves: the arithmetic and the flow wiring, with the same registry the app
 * ships — not a stand-in the app does not contain.
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

  automation.setFunctionResolver(
    (name: string) => (todoFunctions as Record<string, unknown>)[name] as any,
  );
  for (const flow of allFlows) automation.registerFlow(flow.name, flow);
  return { automation, data };
}

/** Find a node of `TaskCompletionFlow` by id. */
function node(id: string): any {
  return (TaskCompletionFlow.nodes as any[]).find((n) => n.id === id);
}

/** `YYYY-MM-DD` for whatever shape the driver returned a `Field.date` in. */
function calendarDate(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * Complete one recurring task through the real write path and return the task
 * the flow spawned, plus the run that spawned it.
 *
 * `completed_date` is seeded on CREATE for the same reason
 * `test/task-completion-trigger.test.ts` seeds it: the object's
 * `completed_date_required` rule refuses a completion write without it, and the
 * ordinary-user completion path is a separate card's subject (#7036). This card
 * is about what the flow does once it fires, so the completion is driven the way
 * the #6882 suite already drives it.
 */
async function completeRecurringTask(opts: {
  subject: string;
  dueDate: string;
  recurrenceType: string;
  interval?: number;
}): Promise<{ spawned: any; run: any; data: any }> {
  const { automation, data } = await bootTodoKernel();
  const ctx = { context: { userId: 'u_todo' } };

  const created = await data.insert('todo_task', {
    subject: opts.subject,
    status: 'not_started',
    priority: 'normal',
    owner: 'u_todo',
    due_date: opts.dueDate,
    is_recurring: true,
    recurrence_type: opts.recurrenceType,
    recurrence_interval: opts.interval ?? 1,
    completed_date: '2026-08-09T10:00:00.000Z',
  }, ctx);
  const id = Array.isArray(created) ? created[0].id : created.id;

  await data.update('todo_task', { status: 'completed' }, { where: { id }, ...ctx });
  await sleep(600);

  const runs = await automation.listRuns('task_completion');
  const all = await data.find('todo_task', { where: { subject: opts.subject }, ...ctx });
  const spawned = (Array.isArray(all) ? all : []).find((r: any) => r.id !== id);
  return { spawned, run: runs[0], data };
}

describe('#7037 — the recurrence branch computes a real next due date', () => {
  describe('computeNextTaskDueDate — the arithmetic', () => {
    it('shifts by the cadence the recurrence_type names', () => {
      const at = (recurrenceType: string, interval: number) =>
        computeNextTaskDueDate({ input: { dueDate: '2026-08-10', recurrenceType, interval } });

      expect(at('daily', 1)).toBe('2026-08-11');
      expect(at('daily', 3)).toBe('2026-08-13');
      expect(at('weekly', 1)).toBe('2026-08-17');
      expect(at('weekly', 2)).toBe('2026-08-24');
      expect(at('monthly', 1)).toBe('2026-09-10');
      expect(at('monthly', 4)).toBe('2026-12-10');
      expect(at('yearly', 1)).toBe('2027-08-10');
    });

    it('clamps a monthly shift to the target month, like the platform addMonths does', () => {
      // `@objectstack/formula`'s `addMonths` clamps Jan 31 + 1mo to Feb 28
      // rather than overflowing into March. An example app that answered
      // differently from the platform's own formula function would be teaching
      // two incompatible recurrence semantics inside one product.
      expect(
        computeNextTaskDueDate({ input: { dueDate: '2026-01-31', recurrenceType: 'monthly', interval: 1 } }),
      ).toBe('2026-02-28');
      expect(
        computeNextTaskDueDate({ input: { dueDate: '2024-01-31', recurrenceType: 'monthly', interval: 1 } }),
      ).toBe('2024-02-29');
      expect(
        computeNextTaskDueDate({ input: { dueDate: '2026-02-28', recurrenceType: 'yearly', interval: 1 } }),
      ).toBe('2027-02-28');
    });

    it('accepts every shape a Field.date reaches a flow in', () => {
      const expected = '2026-08-11';
      for (const dueDate of [
        '2026-08-10',
        '2026-08-10T00:00:00.000Z',
        new Date('2026-08-10T00:00:00.000Z'),
        Date.parse('2026-08-10T00:00:00.000Z'),
      ]) {
        expect(
          computeNextTaskDueDate({ input: { dueDate, recurrenceType: 'daily', interval: 1 } }),
          `due date shape ${String(dueDate)}`,
        ).toBe(expected);
      }
    });

    it('takes the field default when the interval is absent, and refuses a value min:1 forbids', () => {
      // `recurrence_interval` declares `defaultValue: 1, min: 1`. An absent
      // interval takes that declared default — not a lenient fallback, the same
      // number the schema itself would have written. A PRESENT value the schema
      // forbids refuses instead of being quietly coerced.
      expect(
        computeNextTaskDueDate({ input: { dueDate: '2026-08-10', recurrenceType: 'daily' } }),
      ).toBe('2026-08-11');
      for (const interval of [0, -2, 'soon']) {
        expect(
          () => computeNextTaskDueDate({ input: { dueDate: '2026-08-10', recurrenceType: 'daily', interval } }),
          `interval ${String(interval)}`,
        ).toThrow(/recurrence_interval must be a number >= 1/);
      }
    });

    it('refuses an unknown recurrence_type instead of guessing a cadence', () => {
      expect(
        () => computeNextTaskDueDate({ input: { dueDate: '2026-08-10', recurrenceType: 'fortnightly', interval: 1 } }),
      ).toThrow(/unknown recurrence_type 'fortnightly'/);
    });

    it('returns null when there is no previous due date to shift', () => {
      // Nothing to add to: the spawned task starts undated rather than on an
      // invented day derived from "now".
      for (const dueDate of [null, undefined, '']) {
        expect(
          computeNextTaskDueDate({ input: { dueDate, recurrenceType: 'daily', interval: 1 } }),
        ).toBeNull();
      }
    });
  });

  describe('the flow wiring', () => {
    it('the script node names a function the app actually registers', () => {
      const script = node('compute_next_due_date');
      expect(script?.type).toBe('script');
      // The failure this pins is a RUNTIME one: the executor resolves
      // `config.function` against the host registry and fails the step with
      // "no function named 'x' is registered" — invisible to build.
      expect(Object.keys(todoFunctions)).toContain(script.config.function);
      expect(script.config.outputVariable).toBe('nextDueDate');
    });

    it('create_next_task reads the computed variable as a WHOLE-STRING token', () => {
      // A whole-string `{token}` is the one form `interpolateString` returns the
      // raw value for. Any surrounding text turns the slot back into
      // text-with-holes — which is precisely the shape that shipped `DATEADD`.
      const fields = node('create_next_task').config.fields;
      expect(fields.due_date).toBe('{nextDueDate}');
    });

    it('the recurring branch runs the computation BEFORE the create', () => {
      const edges = TaskCompletionFlow.edges as any[];
      const yes = edges.find((e) => e.source === 'check_recurring' && e.condition?.includes('== true'));
      expect(yes.target).toBe('compute_next_due_date');
      expect(edges.some((e) => e.source === 'compute_next_due_date' && e.target === 'create_next_task')).toBe(true);
      // The non-recurring leg is untouched: it still skips both nodes.
      const no = edges.find((e) => e.source === 'check_recurring' && e.condition?.includes('!= true'));
      expect(no.target).toBe('end');
    });

    it('GUARD: no write node in any app flow puts function-call text in a field value', () => {
      // The class, not the instance. `fields` values are interpolated, never
      // evaluated, so ANY `NAME(...)` text in one reaches the driver verbatim —
      // whatever the invented function is called. This is the check that would
      // have caught the original defect at authoring time.
      const callShaped = /^[A-Za-z_][A-Za-z0-9_]*\s*\(/;
      for (const flow of allFlows) {
        for (const n of (flow.nodes ?? []) as any[]) {
          if (n.type !== 'create_record' && n.type !== 'update_record') continue;
          for (const [field, value] of Object.entries((n.config?.fields ?? {}) as Record<string, unknown>)) {
            if (typeof value !== 'string') continue;
            expect(
              callShaped.test(value.trim()),
              `flow '${flow.name}' node '${n.id}' field '${field}' = ${value} — ` +
              `a create/update field value is template-interpolated, not evaluated`,
            ).toBe(false);
          }
        }
      }
    });
  });

  describe('end to end, on a real kernel over sqlite', () => {
    it.each([
      { recurrenceType: 'daily', interval: 1, dueDate: '2026-08-10', expected: '2026-08-11' },
      { recurrenceType: 'weekly', interval: 1, dueDate: '2026-08-10', expected: '2026-08-17' },
      { recurrenceType: 'monthly', interval: 1, dueDate: '2026-01-31', expected: '2026-02-28' },
    ])(
      'completing a $recurrenceType task spawns the next one due $expected',
      async ({ recurrenceType, interval, dueDate, expected }) => {
        const subject = `Recurring ${recurrenceType} task`;
        const { spawned, run } = await completeRecurringTask({ subject, dueDate, recurrenceType, interval });

        // The run this card is about used to end `failed` on
        // `create_record(todo_task) failed: Due Date must be a valid date
        // (ISO-8601)`. It completes now, through every node.
        expect(run?.status, `run error: ${JSON.stringify((run as any)?.error ?? null)}`).toBe('completed');
        const nodeIds = (run.steps ?? []).map((s: any) => s.nodeId);
        expect(nodeIds).toContain('compute_next_due_date');
        expect(nodeIds).toContain('create_next_task');

        // And the write it was refused for actually landed, on the right day.
        expect(spawned, 'the recurrence spawned a next task').toBeDefined();
        expect(calendarDate(spawned.due_date)).toBe(expected);
        expect(spawned.status).toBe('not_started');
        expect(spawned.is_recurring).toBeTruthy();
        expect(spawned.recurrence_type).toBe(recurrenceType);
      },
      30000,
    );

    it('a NON-recurring completion still spawns nothing', async () => {
      const { automation, data } = await bootTodoKernel();
      const ctx = { context: { userId: 'u_todo' } };

      const created = await data.insert('todo_task', {
        subject: 'One-off task', status: 'not_started', priority: 'normal', owner: 'u_todo',
        due_date: '2026-08-10', is_recurring: false,
        completed_date: '2026-08-09T10:00:00.000Z',
      }, ctx);
      const id = Array.isArray(created) ? created[0].id : created.id;

      await data.update('todo_task', { status: 'completed' }, { where: { id }, ...ctx });
      await sleep(600);

      const runs = await automation.listRuns('task_completion');
      expect(runs[0].status).toBe('completed');
      // The gate still routes past BOTH nodes — adding the script node did not
      // put date arithmetic on the non-recurring path.
      const executed = (runs[0].steps ?? []).filter((s: any) => s.status !== 'skipped').map((s: any) => s.nodeId);
      expect(executed).not.toContain('compute_next_due_date');
      expect(executed).not.toContain('create_next_task');

      const all = await data.find('todo_task', { where: { subject: 'One-off task' }, ...ctx });
      expect((Array.isArray(all) ? all : []).length).toBe(1);
    }, 30000);

    it('REVERSE: the pre-fix shape — a function call left in the field value — is refused by the driver', async () => {
      // The pre-#7037 defect, rebuilt from the REAL flow so it cannot drift: the
      // computation node removed, the recurring edge pointed straight at the
      // create, and `due_date` written as text-with-holes wrapping a call to a
      // function that does not exist.
      //
      // The invented name is deliberately NOT the historical one. What failed
      // was never specific to `DATEADD`: a `create_record` field value is
      // interpolated and passed through verbatim, so ANY function-call text
      // reaches the driver as a literal string. Pinning the class keeps the
      // dead name out of the repo entirely, which is the other half of this
      // card — an invented function name in a shipped example is exactly the
      // shape an AI author copies.
      const { automation, data } = await bootTodoKernel();
      const ctx = { context: { userId: 'u_todo' } };

      const broken = JSON.parse(JSON.stringify(TaskCompletionFlow)) as any;
      broken.name = 'task_completion_uncomputed_fixture';
      broken.nodes = broken.nodes.filter((n: any) => n.id !== 'compute_next_due_date');
      broken.edges = broken.edges.filter((e: any) => e.source !== 'compute_next_due_date');
      broken.edges.find((e: any) => e.source === 'check_recurring' && e.condition?.includes('== true')).target =
        'create_next_task';
      broken.nodes.find((n: any) => n.id === 'create_next_task').config.fields.due_date =
        'SHIFT_DATE({completedTask.due_date}, {completedTask.recurrence_interval}, "{completedTask.recurrence_type}")';
      // The fixture is a manual flow: it must not race the real one on the same
      // record-change hook.
      delete broken.nodes.find((n: any) => n.type === 'start').config.triggerType;
      broken.type = 'autolaunched';
      automation.registerFlow(broken.name, broken);

      const created = await data.insert('todo_task', {
        subject: 'Reverse fixture task', status: 'completed', priority: 'normal', owner: 'u_todo',
        due_date: '2026-08-10', is_recurring: true, recurrence_type: 'daily', recurrence_interval: 1,
        completed_date: '2026-08-09T10:00:00.000Z',
      }, ctx);
      const id = Array.isArray(created) ? created[0].id : created.id;

      // Driven directly rather than through the record-change hook, so the
      // context has to supply what the hook would: the triggering record AND the
      // `previous` row the start predicate transitions from. Without `previous`
      // the CEL gate aborts with `No such key: status` — the same totality trap
      // #6882 documented on the insert leg — and the run would fail for a reason
      // that has nothing to do with this card.
      const record = { ...(Array.isArray(created) ? created[0] : created), id };
      const trigger = { record, previous: { ...record, status: 'in_progress' }, userId: 'u_todo' };

      const result: any = await automation.execute(broken.name, trigger);

      // The direction that matters: the run FAILS, and it fails inside the
      // create with the field's own date refusal — NOT with "no function named
      // 'SHIFT_DATE' is registered", because nothing ever tried to CALL one.
      // The value was never a call; it was always just text.
      expect(result?.success, `unexpected result: ${JSON.stringify(result)}`).toBe(false);
      const text = String(result?.error ?? '') + JSON.stringify(result?.output ?? null);
      expect(text).toContain('create_next_task');
      expect(text).toMatch(/valid date|ISO-8601|invalid_date/);
      expect(text).not.toMatch(/no function named/);

      // Non-vacuous: the REAL flow, on the very same kernel and record, computes
      // the date and completes. So the failure above is the missing computation,
      // not a broken fixture or an unusable harness.
      const good: any = await automation.execute('task_completion', trigger);
      expect(good?.success, `unexpected result: ${JSON.stringify(good)}`).toBe(true);
      const spawned = (await data.find('todo_task', { where: { subject: 'Reverse fixture task' }, ...ctx }))
        .find((r: any) => r.id !== id);
      expect(calendarDate(spawned.due_date)).toBe('2026-08-11');
    }, 30000);
  });
});
