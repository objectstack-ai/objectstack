// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10371] `await kernel.shutdown()` must leave NOTHING of this plugin still
 * running.
 *
 * THE DEFECT. `ReportsServicePlugin` arms its schedule dispatcher at
 * `kernel:ready` — either a `setInterval` over `sys_report_schedule`, or, when
 * `service-job` is installed, a scheduled `reports.dispatch` job. The teardown
 * that released both was spelled `stop()`. The kernel's plugin teardown hook is
 * `destroy()` (`Plugin.destroy?()` in `@objectstack/core`'s `types.ts` — the
 * only teardown `ObjectKernel.performShutdown()` and `LiteKernel.destroy()`
 * invoke), and `stop()` is not part of that interface, so nothing in the repo
 * ever called it and the dispatcher went on ticking after shutdown resolved.
 *
 * THE ASYMMETRY THAT HID IT. `start?(ctx)` IS on the interface and does fire.
 * A `start`/`stop` pair where only one half is wired reads as symmetric in
 * review — which is why the identical shape survived in six packages at once,
 * and why #9371 found it in `service-messaging` only after it had already cost
 * something.
 *
 * WHY IT WENT UNNOTICED, AND WHERE THE BILL LANDED. `start()` `unref()`s the
 * interval, so a long-lived host process still exits and the leak is silent in
 * production. Under vitest the worker is alive throughout teardown, so a tick
 * fires AFTER the test file is over, reads through a driver the suite has
 * already disconnected, and the driver's console fallback warns. `console.*`
 * inside a worker is an RPC to the main process (`onUserConsoleLog`); one
 * issued after `rpcDone()` has snapshotted the pending set is rejected by
 * `$rejectPendingCalls` as `EnvironmentTeardownError: [vitest-worker]: Closing
 * rpc while "onUserConsoleLog" was pending`. Nothing awaits that promise, so it
 * surfaces as an unhandled rejection and fails a run in which every test
 * passed — twice measured on `examples/app-showcase` (334/334 and 337/337
 * green, exit 1, a merge-queue eviction each time).
 *
 * WHAT THIS PINS, AND WHY IN THIS SHAPE. The assertions are behavioural —
 * "after shutdown the plugin issues no further schedule reads", "after shutdown
 * the scheduled job has been cancelled" — and not
 * `expect(plugin.destroy).toBeDefined()`, because the hook merely EXISTING is
 * not the property that was missing; being REACHED BY THE KERNEL is.
 *
 * Every pre-shutdown leg is a POSITIVE CONTROL and load-bearing: without it a
 * dispatcher that never started would satisfy the post-shutdown assertion
 * vacuously, and this file would pass on a plugin that does nothing at all.
 *
 * The `stop()` legs are the other direction, and they are not decoration: the
 * repair keeps `stop()` as a delegating alias because it is public API of an
 * exported class and an embedder may have learned to call it directly PRECISELY
 * BECAUSE the kernel never did. Pinning only the shutdown direction would go
 * green on an implementation that simply deletes `stop()`, which breaks them.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel, LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import type { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { ReportsServicePlugin } from './reports-plugin.js';

/**
 * The plugin floors its own interval at 5s (`Math.max(5_000, …)`), so this is
 * the fastest REAL clock the dispatcher can be driven at. Windows below are
 * sized off it rather than off a wish.
 */
const DISPATCH_INTERVAL_MS = 5_000;
/** Comfortably past one tick boundary, so a window that sees zero is silence. */
const OBSERVE_MS = 5_600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const openKernels: Array<{ shutdown(): Promise<void> }> = [];
const openDrivers: Array<{ disconnect?: () => Promise<void> }> = [];

afterEach(async () => {
  // Kernels first, drivers second: the kernel's own teardown still wants a live
  // driver to drain against.
  while (openKernels.length) {
    try { await openKernels.pop()?.shutdown(); } catch { /* already stopped */ }
  }
  while (openDrivers.length) {
    try { await openDrivers.pop()?.disconnect?.(); } catch { /* noop */ }
  }
});

/** Records what the plugin asked the platform job service to run and cancel. */
interface JobLog {
  scheduled: string[];
  cancelled: string[];
}

/**
 * Publishes a minimal `job` service so the plugin takes its job-service branch
 * instead of the `setInterval` fallback. A plugin rather than a bare
 * `registerService` call because the branch is only taken if the service is
 * resolvable at `kernel:ready`, which is the kernel's business, not ours.
 */
class FakeJobServicePlugin implements Plugin {
  name = 'test.fake.job';
  version = '1.0.0';
  type = 'standard';

  constructor(private readonly log: JobLog) {}

  async init(ctx: PluginContext): Promise<void> {
    ctx.registerService('job', {
      schedule: async (name: string) => { this.log.scheduled.push(name); },
      cancel: async (name: string) => { this.log.cancelled.push(name); },
    });
  }
}

interface Booted {
  kernel: { shutdown(): Promise<void> };
  plugin: ReportsServicePlugin;
  /** Reads the dispatcher has made against `sys_report_schedule`. */
  scheduleReads: () => number;
}

/**
 * Installs the read counter on the engine instance the dispatcher captured at
 * `kernel:ready` (`ctx.getService('objectql')` resolves to this same object), so
 * the tally is of real `ReportService.dispatchDue()` traffic and not of a
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

/**
 * The `setInterval` branch, and why it needs `LiteKernel` — MEASURED, not
 * assumed. `ReportsServicePlugin.start()` prefers the platform job service and
 * only falls through to `setInterval` when `ctx.getService('job')` yields
 * nothing with a `schedule` method. `ObjectKernel.preInjectCoreFallbacks()`
 * registers `createMemoryJob()` for every unprovided `core` service before
 * Phase 2, so on an `ObjectKernel` a `job` service ALWAYS resolves and this
 * branch is unreachable. `LiteKernel` injects no fallbacks, which is exactly
 * the "single-kernel deployment without `service-job`" the plugin's own
 * docblock names as the reason the `setInterval` path exists.
 */
async function bootReportsLiteKernel(): Promise<Booted> {
  const kernel = new LiteKernel({ logLevel: 'silent' } as any);
  openKernels.push(kernel);

  kernel.use(new ObjectQLPlugin());
  const plugin = new ReportsServicePlugin({ dispatchIntervalMs: DISPATCH_INTERVAL_MS });
  kernel.use(plugin);
  await kernel.bootstrap();

  await attachSqlite(kernel.getService<ObjectQL>('objectql'));
  return { kernel, plugin, scheduleReads: countScheduleReads(kernel as any) };
}

async function bootReportsKernel(extra?: Plugin): Promise<Booted> {
  const kernel = new ObjectKernel({ logLevel: 'silent' });
  openKernels.push(kernel);

  await kernel.use(new ObjectQLPlugin());
  if (extra) await kernel.use(extra);
  const plugin = new ReportsServicePlugin({ dispatchIntervalMs: DISPATCH_INTERVAL_MS });
  await kernel.use(plugin);
  await kernel.bootstrap();

  await attachSqlite(kernel.getService<ObjectQL>('objectql'));
  return { kernel, plugin, scheduleReads: countScheduleReads(kernel as any) };
}

describe('#10371 ReportsServicePlugin releases its dispatcher on kernel shutdown', () => {
  it(
    'stops reading sys_report_schedule once shutdown() has resolved',
    { timeout: 60_000 },
    async () => {
      const { kernel, scheduleReads } = await bootReportsLiteKernel();

      // POSITIVE CONTROL — the setInterval dispatcher really is ticking, so the
      // post-shutdown assertion below measures silence and not absence.
      await sleep(OBSERVE_MS);
      expect(scheduleReads()).toBeGreaterThan(0);

      await kernel.shutdown();

      const atShutdown = scheduleReads();
      await sleep(OBSERVE_MS);

      // THE PIN. shutdown() resolving means the plugin is done with the
      // database. Before the fix this count kept climbing.
      expect(scheduleReads()).toBe(atShutdown);
    },
  );

  it('cancels its scheduled job once shutdown() has resolved', async () => {
    const log: JobLog = { scheduled: [], cancelled: [] };
    const { kernel } = await bootReportsKernel(new FakeJobServicePlugin(log));

    // POSITIVE CONTROL — the job branch was taken and nothing has cancelled it.
    expect(log.scheduled).toContain('reports.dispatch');
    expect(log.cancelled).toEqual([]);

    await kernel.shutdown();

    // THE PIN. Before the fix the cancel lived in `stop()`, which the kernel
    // never called, so the job outlived the kernel that scheduled it.
    expect(log.cancelled).toContain('reports.dispatch');
  });

  it('the retained stop() alias still tears down for an embedder that calls it directly', async () => {
    const log: JobLog = { scheduled: [], cancelled: [] };
    const { plugin } = await bootReportsKernel(new FakeJobServicePlugin(log));

    expect(log.scheduled).toContain('reports.dispatch');
    expect(log.cancelled).toEqual([]);

    // No argument — the shape an embedder writes today against a method whose
    // parameter the repair made optional.
    await plugin.stop();

    expect(log.cancelled).toContain('reports.dispatch');
  });

  it('the stop() alias still accepts the PluginContext argument it used to require', async () => {
    const log: JobLog = { scheduled: [], cancelled: [] };
    const { plugin } = await bootReportsKernel(new FakeJobServicePlugin(log));

    expect(log.scheduled).toContain('reports.dispatch');

    // The pre-repair signature was `stop(ctx: PluginContext)`. An embedder
    // holding that call shape must keep compiling AND keep working, which is
    // the entire reason the alias was retained rather than deleted.
    const ctx = {
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    } as unknown as PluginContext;
    await plugin.stop(ctx);

    expect(log.cancelled).toContain('reports.dispatch');
  });

  it('a teardown on a plugin that never started is a no-op rather than a throw', async () => {
    // Idempotence matters because `destroy()` clears the handles it released; a
    // teardown that only works once is a teardown that fails inside a suite,
    // and the kernel calls it on every plugin it walks.
    const plugin = new ReportsServicePlugin();
    await expect(plugin.destroy()).resolves.toBeUndefined();
    await expect(plugin.destroy()).resolves.toBeUndefined();
    await expect(plugin.stop()).resolves.toBeUndefined();
  });
});
