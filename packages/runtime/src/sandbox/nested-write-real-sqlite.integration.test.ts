// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Real-SQLite regression for #1867 — a nested cross-object write from a hook.
 *
 * This is the exact automation the `objectstack-ai/templates` CHARTERs say
 * authors could not write ("when a child changes, update the parent"), modeled
 * on the expense template: an `expense_line` hook recomputes and writes
 * `expense_report.total_amount`. The in-memory mock can hide driver/transaction
 * behavior (cf. bulk-write-real-driver.integration.test.ts), so this wires the
 * REAL {@link ObjectQL} engine to the REAL {@link SqlDriver} (better-sqlite3,
 * on-disk) and drives the whole hook → sandbox → nested-write path — insert,
 * update, and delete of a line — asserting the parent rollup lands each time
 * and the process never crashes with `memory access out of bounds`.
 *
 * SCOPE: this exercises the insert/update rollup — the cases a hook can resolve,
 * where the child's FK is in the payload. Delete-inclusive AGGREGATE rollups are
 * better served by the engine's native `summary` field: an `afterDelete` hook
 * receives only `{ id, options }` (no pre-image of the deleted row's FK), so it
 * cannot know which parent to recompute, whereas the engine captures that
 * pre-image itself and recomputes summaries on delete (proven under real SQL in
 * `bulk-write-real-driver.integration.test.ts`). The nested-write hook is the
 * GENERAL mechanism #1867 unblocks (conditional / non-aggregate cross-object
 * writes); the `summary` field is the declarative tool for delete-safe sums.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { hookBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';

const EXPENSE_REPORT = {
  name: 'expense_report',
  fields: {
    title: { type: 'text' },
    total_amount: { type: 'number' },
    line_count: { type: 'number' },
  },
};
const EXPENSE_LINE = {
  name: 'expense_line',
  fields: {
    amount: { type: 'number' },
    // The owning report id. Kept a plain text column so this test isolates the
    // nested-write behavior from FK/cascade machinery.
    expense_report: { type: 'text' },
  },
};

const ROLLUP_HOOK = {
  name: 'expense_line_rollup',
  object: 'expense_line',
  events: ['afterInsert', 'afterUpdate'],
  body: {
    language: 'js',
    source: `
      const rid = ctx.input.expense_report;
      if (!rid) return;
      const lines = await ctx.api.object('expense_line').find({ where: { expense_report: rid } });
      const total = lines.reduce((s, l) => s + (l.amount || 0), 0);
      await ctx.api.object('expense_report').update({ id: rid, total_amount: total, line_count: lines.length });
    `,
    capabilities: ['api.read', 'api.write'],
  },
};

describe('#1867 nested cross-object write — REAL SqlDriver (better-sqlite3, on-disk)', () => {
  let engine: ObjectQL | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  });

  async function boot() {
    dir = mkdtempSync(join(tmpdir(), 'os-nested-1867-'));
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
    await driver.initObjects([EXPENSE_REPORT, EXPENSE_LINE]); // create real tables
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    for (const o of [EXPENSE_REPORT, EXPENSE_LINE]) engine.registry.registerObject(o as any);
    // Generous hook budget — the subject is the nested-write path on a real
    // driver, not the 250ms default (see nested-write.integration.test.ts).
    engine.setDefaultBodyRunner(hookBodyRunnerFactory(new QuickJSScriptRunner({ hookTimeoutMs: 10_000 }), { ql: engine, appId: 'expense' }));
    bindHooksToEngine(engine, [ROLLUP_HOOK as any], { packageId: 'expense' });
    return engine;
  }

  it('rolls the child line total up to the parent on insert / update — no crash, correct total', async () => {
    const e = await boot();
    const report = await e.insert('expense_report', { title: 'Q3 travel', total_amount: 0, line_count: 0 });

    // Insert two lines — each afterInsert nested-writes the parent.
    await e.insert('expense_line', { amount: 100, expense_report: report.id });
    const line2 = await e.insert('expense_line', { amount: 50, expense_report: report.id });
    let parent: any = (await e.find('expense_report', { where: { id: report.id } }))[0];
    expect(parent.total_amount).toBe(150);
    expect(parent.line_count).toBe(2);

    // Update a line — afterUpdate re-rolls up.
    await e.update('expense_line', { id: line2.id, amount: 75, expense_report: report.id });
    parent = (await e.find('expense_report', { where: { id: report.id } }))[0];
    expect(parent.total_amount).toBe(175);
  }, 30000);
});
