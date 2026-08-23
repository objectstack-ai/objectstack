// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10746] Scheduled reports must actually RUN on `ObjectKernel` — the kernel
 * real deployments use — when no job plugin is installed.
 *
 * THE DEFECT THIS PINS. `ReportsServicePlugin.start()` prefers the platform
 * job service and only falls through to its own `setInterval` when
 * `ctx.getService('job')` yields nothing with a `schedule` method.
 * `ObjectKernel.preInjectCoreFallbacks()` used to register `createMemoryJob()`
 * for every unprovided `core` service before Phase 2 — and `createMemoryJob()`
 * is honest in its own docblock that a `schedule()`d job NEVER fires on its
 * own (its `schedule()` is `jobs.set(...)` and nothing else). So on an
 * `ObjectKernel` without `@objectstack/service-job` the plugin logged
 * `dispatcher registered with job service` and then dispatched nothing, ever:
 * measured as 0 reads of `sys_report_schedule` in 5600 ms with the success
 * line present. The `setInterval` branch the plugin's docblock offers as the
 * single-kernel answer was dead code on the kernel real deployments use.
 *
 * THE REPAIR (maintainer ruling 2026-08-22, Option A — a fallback must not
 * fake capability). `job` came off the kernel's pre-injection list
 * (`CORE_FALLBACK_FACTORIES` in `@objectstack/core`), so `getService('job')`
 * now throws when no job plugin is installed, the plugin's existing catch
 * falls through to `setInterval`, and single-kernel deployments actually
 * dispatch scheduled reports.
 *
 * WHY THIS FILE EXISTS BESIDE `plugin-shutdown-releases-dispatcher.test.ts`.
 * That file pins RELEASE at shutdown, and its running-dispatcher leg runs on
 * `LiteKernel` — which injects no fallbacks, so it could never see this
 * defect. Nothing pinned that the dispatcher RUNS on `ObjectKernel`; that gap
 * is exactly why the defect shipped invisibly. This pin is the acceptance
 * evidence for the fix: same composition a real single-kernel deployment
 * boots, no job plugin anywhere, and the poll traffic itself is the assertion.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import type { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { ReportsServicePlugin } from './reports-plugin.js';

/**
 * The plugin floors its own interval at 5s (`Math.max(5_000, …)`), so this is
 * the fastest REAL clock the dispatcher can be driven at.
 */
const DISPATCH_INTERVAL_MS = 5_000;
/** Comfortably past one tick boundary, so a window that sees zero is silence. */
const OBSERVE_MS = 5_600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const openKernels: Array<{ shutdown(): Promise<void> }> = [];
const openDrivers: Array<{ disconnect?: () => Promise<void> }> = [];

afterEach(async () => {
  // Kernels first, drivers second: the kernel's own teardown still wants a
  // live driver to drain against.
  while (openKernels.length) {
    try { await openKernels.pop()?.shutdown(); } catch { /* already stopped */ }
  }
  while (openDrivers.length) {
    try { await openDrivers.pop()?.disconnect?.(); } catch { /* noop */ }
  }
});

/**
 * Installs the read counter on the engine instance the dispatcher captured at
 * `kernel:ready` (`ctx.getService('objectql')` resolves to this same object),
 * so the tally is of real `ReportService.dispatchDue()` traffic, not a
 * stand-in.
 */
function countScheduleReads(engineHolder: { getService: <T>(n: string) => T }): () => number {
  type EngineCall = (name: string, ...rest: unknown[]) => unknown;
  const engine = engineHolder.getService<IDataEngine>('objectql') as unknown as
    Record<'find', EngineCall>;
  let reads = 0;
  const orig = engine.find.bind(engine);
  engine.find = (name: string, ...rest: unknown[]) => {
    if (String(name) === 'sys_report_schedule') reads++;
    return orig(name, ...rest);
  };
  return () => reads;
}

/** A real in-memory SQL driver, connected and registered on `engine`. */
async function attachSqlite(objectql: any): Promise<void> {
  const driver: any = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await driver.connect();
  objectql.registerDriver(driver, true);
  openDrivers.push(driver);
  await objectql.syncSchemas();
}

describe('#10746 the dispatcher RUNS on ObjectKernel with no job plugin', () => {
  it(
    'polls sys_report_schedule — the setInterval fallback is reachable on the production kernel',
    { timeout: 60_000 },
    async () => {
      // The composition a real single-kernel deployment boots: ObjectKernel
      // (NOT LiteKernel), the engine, the reports plugin — and no job plugin.
      const kernel = new ObjectKernel({ logger: { level: 'silent' } });
      openKernels.push(kernel);

      await kernel.use(new ObjectQLPlugin());
      await kernel.use(new ReportsServicePlugin({ dispatchIntervalMs: DISPATCH_INTERVAL_MS }));
      await kernel.bootstrap();

      await attachSqlite(kernel.getService<ObjectQL>('objectql'));
      const scheduleReads = countScheduleReads(kernel as any);

      await sleep(OBSERVE_MS);

      // THE PIN. Before the fix this was 0 — the kernel pre-injected a `job`
      // fallback whose `schedule()` recorded the dispatcher and never fired
      // it, while the plugin logged success. One tick boundary has passed, so
      // silence here is the defect, not timing.
      expect(scheduleReads()).toBeGreaterThan(0);
    },
  );
});
