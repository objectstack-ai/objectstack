// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18584] The record projection the `overdue_escalation` loop iterates carries
 * every field its notification template names — `days_overdue` included.
 *
 * The defect this pins was silent: `flows/task.flow.ts` interpolates
 * `{currentTask.days_overdue}` into the escalation body while `todo_task`
 * declared no such field. The widened `validate-flow-template-paths` rule
 * (PR #18583) reported it as its first true positive, advisory — and no CI job
 * runs `objectstack validate` over `examples/`, so nothing was red.
 *
 * ⭐ WHY THIS SUITE DRIVES A REAL READ INSTEAD OF ASSERTING ON METADATA.
 * "A formula field exists on the object" and "the projection the flow iterates
 * carries its COMPUTED value" are different questions, and only the second one
 * decides whether the template can promise a day count at all. A formula field
 * is VIRTUAL — no driver materialises a column for it, which is exactly why
 * `is_completed` / `is_overdue` are NOT formulas (see the long paragraph in
 * `src/objects/task.object.ts`). So the value is observed where it is
 * consumed: off rows returned by a real `ObjectQL.find` over a real driver,
 * called the way the flow's `get_record` step calls it.
 *
 * The one condition that decides the answer is the PROJECTION: `find` runs
 * `planFormulaProjection(schema, ast.fields)`, which evaluates every formula on
 * the schema when `fields` is absent and only the named ones when it is not.
 * `get_overdue_tasks` declares no `fields`, so the rows carry the value — and
 * the first test below asserts that precondition off the app's own flow rather
 * than trusting it, because adding a `fields` list to that step is precisely
 * the edit that would silently empty the day count again.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { OverdueEscalationFlow } from '../src/flows/index.js';
import { Task } from '../src/objects/task.object.js';

const openDrivers: Array<{ disconnect?: () => Promise<void> }> = [];
afterEach(async () => {
  while (openDrivers.length) {
    try { await openDrivers.pop()?.disconnect?.(); } catch { /* noop */ }
  }
});

/**
 * A node of the app's real flow, by id — searched at EVERY depth.
 *
 * [#19206] `notify_owner` and `update_priority` now live inside the `loop`
 * container's `config.body` region (that is what binds `currentTask` at all),
 * so a search of the top-level `nodes[]` alone reports them as gone. The walk
 * below descends the ADR-0031 region slots — `loop.config.body`,
 * `try_catch.config.try` / `.catch`, `parallel.config.branches[]` — because the
 * question this suite asks is about the node's CONFIG, which is unchanged by
 * where the node is nested.
 */
function node(id: string): { type?: string; config?: Record<string, unknown> } {
  type AnyNode = { id?: string; type?: string; config?: Record<string, unknown> };
  const regionsOf = (cfg: Record<string, unknown> | undefined): AnyNode[][] => {
    const out: AnyNode[][] = [];
    for (const slot of ['body', 'try', 'catch']) {
      const region = cfg?.[slot] as { nodes?: AnyNode[] } | undefined;
      if (Array.isArray(region?.nodes)) out.push(region!.nodes!);
    }
    const branches = cfg?.branches as Array<{ nodes?: AnyNode[] }> | undefined;
    if (Array.isArray(branches)) {
      for (const branch of branches) if (Array.isArray(branch?.nodes)) out.push(branch.nodes!);
    }
    return out;
  };
  const walk = (nodes: AnyNode[] | undefined): AnyNode | undefined => {
    for (const n of nodes ?? []) {
      if (n?.id === id) return n;
      for (const region of regionsOf(n?.config)) {
        const hit = walk(region);
        if (hit) return hit;
      }
    }
    return undefined;
  };

  const found = walk(OverdueEscalationFlow.nodes as AnyNode[] | undefined);
  if (!found) throw new Error(`#18584 harness: node '${id}' is gone from overdue_escalation`);
  return found as { type?: string; config?: Record<string, unknown> };
}

/** `n` whole days before today, as a `Field.date` string (UTC). */
function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** A real kernel with the app's real `todo_task` over in-process sqlite-wasm. */
async function bootTodoData(): Promise<any> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
  await kernel.use(new ObjectQLPlugin());
  await kernel.bootstrap();

  const objectql: any = kernel.getService('objectql');
  const driver: any = new SqliteWasmDriver({ filename: ':memory:' });
  await driver.connect();
  objectql.registerDriver(driver, true);
  openDrivers.push(driver);
  objectql.registry.registerObject(Task, 'todo', 'todo');
  await objectql.syncSchemas();

  return kernel.getService('data');
}

const SYSTEM = { context: { isSystem: true } };

describe('#18584 — the overdue escalation projection carries a day count', () => {
  it('the `get_record` step declares no projection, which is what makes formulas evaluate', () => {
    // `planFormulaProjection(schema, undefined)` evaluates EVERY formula on the
    // schema; a `fields` list narrows it to the named ones. Adding one here
    // without adding `days_overdue` would blank the notice again, silently.
    const cfg = node('get_overdue_tasks').config ?? {};
    expect(cfg.fields).toBeUndefined();
    expect(cfg.objectName).toBe('todo_task');
  });

  it('every `{currentTask.…}` token in the escalation body names a key the row carries', async () => {
    const data = await bootTodoData();
    const due = daysAgoIso(5);
    await data.insert('todo_task', {
      subject: 'Renew the domain',
      status: 'not_started',
      priority: 'normal',
      due_date: due,
      owner: 'usr_test_owner',
    }, SYSTEM);

    // Read exactly as `get_overdue_tasks` does: list read, NO `fields`.
    const rows: Array<Record<string, unknown>> = await data.find('todo_task', {
      where: { status: { $ne: 'completed' } },
      limit: node('get_overdue_tasks').config?.limit,
      context: { isSystem: true },
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];

    // The card's defect, stated as an assertion over the real template: the
    // notify body's tokens are resolved against this row, so a token naming a
    // key the row does not carry renders as a blank — no error, no refusal.
    const message = String(node('notify_owner').config?.message ?? '');
    const tokens = [...message.matchAll(/\{currentTask\.([a-z_]+)\}/g)].map((m) => m[1]);
    expect(tokens).toContain('days_overdue');
    for (const token of tokens) {
      expect(row, `notify body names {currentTask.${token}}`).toHaveProperty(token);
      expect(String(row[token] ?? ''), `{currentTask.${token}} renders blank`).not.toBe('');
    }

    // And the value is the real span, not merely "something present".
    expect(Number(row.days_overdue)).toBe(5);
  });

  it('0 when the task is not overdue, and 0 when `due_date` is empty', async () => {
    const data = await bootTodoData();
    await data.insert('todo_task', {
      subject: 'Future task', status: 'not_started', priority: 'normal',
      due_date: daysAgoIso(-3), owner: 'usr_test_owner',
    }, SYSTEM);
    await data.insert('todo_task', {
      subject: 'No due date', status: 'not_started', priority: 'normal',
      owner: 'usr_test_owner',
    }, SYSTEM);

    const rows: Array<Record<string, unknown>> = await data.find('todo_task', {
      where: {}, limit: 200, context: { isSystem: true },
    });
    const bySubject = new Map(rows.map((r) => [String(r.subject), r]));

    // Ruled semantics: `0` when not overdue, `0` when `due_date` is empty —
    // never a negative "days remaining", never null.
    expect(Number(bySubject.get('Future task')?.days_overdue)).toBe(0);
    expect(Number(bySubject.get('No due date')?.days_overdue)).toBe(0);
  });
});
