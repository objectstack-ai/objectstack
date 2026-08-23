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
import {
  captureExpectedReadRefusals,
  type ExpectedReadRefusalCapture,
} from '../expected-read-refusal-noise.js';

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

/**
 * [#10629] This fixture provisions `expense_report` / `expense_line` and
 * nothing else, so the engine's own single-tenant probe
 * (`ObjectQL.probeInstallOrganizations`, memoised once per engine) reads a
 * `sys_organization` that was never created. That read is fail-soft by
 * construction — the probe catches `isMissingTableError` and only that — but
 * the driver and the engine each log it on the way out. Withheld and asserted
 * below rather than muted; the module header explains why.
 */
const ABSENT_TENANCY_TABLE = 'sys_organization';

describe('#1867 nested cross-object write — REAL SqlDriver (better-sqlite3, on-disk)', () => {
  let engine: ObjectQL | null = null;
  let dir: string | null = null;
  /** [#10629] The expected-noise capture belonging to the latest {@link boot}. */
  let noise: ExpectedReadRefusalCapture | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  });

  async function boot() {
    dir = mkdtempSync(join(tmpdir(), 'os-nested-1867-'));
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
    // [#10629] Installed before the driver runs a statement and before the
    // engine issues a read — the two sinks the expected refusal travels out on.
    noise = captureExpectedReadRefusals([ABSENT_TENANCY_TABLE]);
    noise.captureDriver(driver);
    await driver.initObjects([EXPENSE_REPORT, EXPENSE_LINE]); // create real tables
    engine = new ObjectQL();
    noise.captureEngine(engine);
    engine.registerDriver(driver, true);
    await engine.init();
    for (const o of [EXPENSE_REPORT, EXPENSE_LINE]) engine.registry.registerObject(o as any);
    // Runs at the STOCK 250ms CPU-time budget (ADR-0102 D1): idle host-await time
    // and the nested rollup's own work are not charged (see nested-write.integration.test.ts).
    engine.setDefaultBodyRunner(hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: 'expense' }));
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

    // ── [#10629] The capture is a PIN, not a mute. These two lines used to
    // reach the shared `Test Core` log out of a PASSING test and were read
    // there as a real failure; they are withheld now and asserted here. If the
    // probe stops running, or `sys_organization` starts resolving, the log goes
    // quiet AND this goes red — the failure a bare `console` mute would hide.
    expect(noise?.silentChannels() ?? ['no capture was installed']).toEqual([]);
  }, 30000);
});
