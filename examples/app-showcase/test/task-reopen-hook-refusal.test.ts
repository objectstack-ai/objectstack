// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The showcase's hook-REFUSAL fixture: `showcase_guard_task_reopen` refuses the
 * write that reopens a finished task, with a sentence addressed to the user,
 * and `showcase_reopen_task` is the script action whose write reaches it.
 *
 * Platform checklist item `records-forms.script-action-hook-refusal-toast`
 * drives this pair in the console (4xx on the action route, exactly one error
 * toast carrying the sentence, record unchanged). This file pins the two halves
 * the item stands on, so a run that FAILS is about the console and the action
 * route, never about a fixture that quietly stopped refusing:
 *
 *   1. on the real engine with the app's real hooks, the reopening write is
 *      refused with the sentence and the stored row is unchanged — while an
 *      edit of the same finished task that leaves `done` alone still lands;
 *   2. the action's body writes exactly the reopening shape (`done: false` on
 *      its own record), so a click reaches the hook's condition.
 *
 * The action route's own 4xx for a nested sandboxed refusal is pinned in
 * `packages/runtime/src/sandbox/nested-hook-refusal-is-a-rejection.test.ts`;
 * it is not restated here.
 *
 * Harness: the production one `hook-body-persisted-writes.test.ts` uses — real
 * `ObjectQL`, real `SqlDriver` (better-sqlite3), real `QuickJSScriptRunner`
 * behind `hookBodyRunnerFactory`, the app's real objects and hooks.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  QuickJSScriptRunner,
  actionBodyRunnerFactory,
  hookBodyRunnerFactory,
} from '@objectstack/runtime';

import { Account, Project, Task } from '../src/data/objects/index.js';
import { allHooks, TASK_REOPEN_REFUSAL } from '../src/data/hooks/index.js';
import { ReopenTaskAction } from '../src/ui/actions/index.js';

const APP_ID = 'com.objectstack.showcase';
const PACKAGE_ID = `app:${APP_ID}`;

const openEngines: ObjectQL[] = [];
afterEach(async () => {
  while (openEngines.length) {
    try { await openEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function bootShowcase(hooks: unknown[] = allHooks): Promise<ObjectQL> {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await driver.connect();

  const engine = new ObjectQL();
  openEngines.push(engine);
  engine.registerDriver(driver as never, true);
  await engine.init();
  for (const def of [Account, Project, Task]) {
    engine.registry.registerObject(def as never, PACKAGE_ID, 'showcase');
  }
  await engine.syncSchemas();
  engine.bindHooks(hooks as never[], {
    packageId: PACKAGE_ID,
    bodyRunner: hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: APP_ID }),
  });
  return engine;
}

const ctx = { context: { userId: 'u_showcase', isSystem: true } };

const readBack = async (engine: ObjectQL, id: string) =>
  (await engine.find('showcase_task', { where: { id } }, ctx as never))[0] as any;

/** A finished task on a real project chain: done = true, progress = 100. */
async function finishedTask(engine: ObjectQL): Promise<string> {
  const account: any = await engine.insert('showcase_account', { name: 'Initech', status: 'active' }, ctx as never);
  const project: any = await engine.insert(
    'showcase_project',
    { name: 'Platform', account: String(account.id), status: 'planned' },
    ctx as never,
  );
  const task: any = await engine.insert(
    'showcase_task',
    { title: 'Audit current IA', project: String(project.id), status: 'backlog' },
    ctx as never,
  );
  const id = String(task.id);
  await engine.update('showcase_task', { id, done: true, progress: 100 }, ctx as never);
  expect((await readBack(engine, id)).done).toBeTruthy();
  return id;
}

/** Every string an error carries that a client could be shown. */
function textOf(err: any): string {
  return [err?.message, err?.innerMessage, err?.cause?.message].filter(Boolean).join(' | ');
}

describe('showcase_guard_task_reopen — the hook refuses reopening a finished task', () => {
  it('the reopening write is refused with the sentence, and the stored row is unchanged', async () => {
    const engine = await bootShowcase();
    const id = await finishedTask(engine);

    const err = await engine
      .update('showcase_task', { id, done: false }, ctx as never)
      .then(() => null, (e: unknown) => e);

    expect(err, 'expected the reopening write to be refused, but it resolved').not.toBeNull();
    expect(textOf(err)).toContain(TASK_REOPEN_REFUSAL);
    // The refusal is a business sentence, not a script fault: no native
    // error-class name leads it (`TypeError: …` is the fault shape #7543 keeps
    // off the wire).
    expect(String((err as any).innerMessage ?? '')).not.toMatch(/^(TypeError|ReferenceError|SyntaxError):/);

    const stored = await readBack(engine, id);
    expect(stored.done).toBeTruthy();
    expect(stored.progress).toBe(100);
  }, 30000);

  it('an edit of the finished task that leaves `done` alone still lands', async () => {
    // The two-root condition: `previous.done == true && record.done != true`.
    // A guard collapsed to `previous.done == true` would refuse this too and
    // make every finished task read-only.
    const engine = await bootShowcase();
    const id = await finishedTask(engine);

    await engine.update('showcase_task', { id, priority: 'high' }, ctx as never);

    const stored = await readBack(engine, id);
    expect(stored.priority).toBe('high');
    expect(stored.done).toBeTruthy();
  }, 30000);

  it('REVERSE: with the hooks unbound the same write lands — the refusal is the hook', async () => {
    const engine = await bootShowcase([]);
    const id = await finishedTask(engine);

    await engine.update('showcase_task', { id, done: false }, ctx as never);

    expect((await readBack(engine, id)).done).toBeFalsy();
  }, 30000);
});

describe('showcase_reopen_task — the script action writes the shape the hook refuses', () => {
  it("the body updates its own record with done: false and nothing else", async () => {
    let written: { object: string; data: Record<string, unknown> } | undefined;
    const ql = {
      object: (object: string) => ({
        update: async (data: Record<string, unknown>) => {
          written = { object, data };
          return { id: data.id };
        },
      }),
    };

    const handler = actionBodyRunnerFactory(new QuickJSScriptRunner(), { ql, appId: 'showcase' })(
      ReopenTaskAction as never,
    );
    expect(typeof handler).toBe('function');

    await handler!({
      recordId: 'task_1',
      record: { id: 'task_1', done: true, progress: 100 },
      params: {},
      user: { id: 'u1' },
    });

    expect(written).toEqual({ object: 'showcase_task', data: { id: 'task_1', done: false } });
  });

  it('is offered only on finished tasks', () => {
    expect(ReopenTaskAction.type).toBe('script');
    expect(ReopenTaskAction.execution).toBe('perRecord');
    const visible = ReopenTaskAction.visible as unknown;
    const source = typeof visible === 'string' ? visible : (visible as { source?: string }).source;
    expect(source).toBe('has(record.done) && record.done == true');
  });
});
