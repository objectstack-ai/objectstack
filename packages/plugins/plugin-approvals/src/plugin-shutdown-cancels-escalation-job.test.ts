// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10371] `await kernel.shutdown()` must actually reach this plugin's teardown.
 *
 * THE DEFECT THIS PINS. The teardown that cancels the SLA escalation job and
 * unbinds this plugin's ObjectQL lifecycle hooks was spelled `stop()`. `Plugin`
 * (`@objectstack/core`'s `types.ts`) declares `init()`, `start?(ctx)` and
 * `destroy?()` — and NO `stop()` — so `ObjectKernel.performShutdown()` and
 * `LiteKernel.destroy()`, which walk the plugins in reverse calling
 * `plugin.destroy()`, walked straight past it. Nothing in the repo ever called
 * `stop()`.
 *
 * THE ASYMMETRY THAT HID IT. `start?(ctx)` IS on the interface and does fire,
 * so a `start`/`stop` pair reads as symmetric in review — which is how the same
 * shape survived in six packages at once (#9371 found the first instance only
 * after it had evicted two fully green PRs from the merge queue).
 *
 * WHY THE ASSERTION IS BEHAVIOURAL. `expect(plugin.destroy).toBeDefined()`
 * would pass on a plugin the kernel still never reaches — the hook merely
 * EXISTING is not the property that was missing, being CALLED BY THE KERNEL is.
 * So this drives a real `ObjectKernel` through a real shutdown and reads what
 * the plugin asked the job service to do.
 *
 * This member owns no timer of its own — the escalation clock belongs to
 * `service-job` — so it never cost an eviction the way `plugin-reports` and
 * `service-messaging` could. The class is the same one either way.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import type { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { ESCALATION_JOB_NAME } from './approval-service.js';

const openKernels: ObjectKernel[] = [];
const openDrivers: Array<{ disconnect?: () => Promise<void> }> = [];

afterEach(async () => {
  while (openKernels.length) {
    try { await openKernels.pop()?.shutdown(); } catch { /* already stopped */ }
  }
  while (openDrivers.length) {
    try { await openDrivers.pop()?.disconnect?.(); } catch { /* noop */ }
  }
});

interface JobLog {
  scheduled: string[];
  cancelled: string[];
}

/**
 * Publishes a minimal `job` service. A plugin rather than a bare
 * `registerService` call because the escalation clock is only wired if the
 * service is resolvable at `kernel:ready`, which is the kernel's business.
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

async function bootApprovalsKernel(log: JobLog) {
  const kernel = new ObjectKernel({ logLevel: 'silent' });
  openKernels.push(kernel);

  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new FakeJobServicePlugin(log));
  const plugin = new ApprovalsServicePlugin({ escalationScanIntervalMs: 60_000 });
  await kernel.use(plugin);
  await kernel.bootstrap();

  // A real table behind the boot catch-up sweep, so its reads resolve instead
  // of erroring their way through the plugin's own logger during teardown.
  // Typed at the lookup (`check:slot-lookup` / #4251): the slot's contract type,
  // not `any`. The two schema-provisioning calls below are engine internals the
  // published contract does not carry, so the cast is at the call and not at the
  // slot.
  const objectql = kernel.getService<ObjectQL>('objectql');
  const driver: any = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await driver.connect();
  (objectql as any).registerDriver(driver, true);
  openDrivers.push(driver);
  await (objectql as any).syncSchemas();

  return { kernel, plugin };
}

describe('#10371 ApprovalsServicePlugin releases its escalation job on kernel shutdown', () => {
  it('cancels the SLA escalation job once shutdown() has resolved', async () => {
    const log: JobLog = { scheduled: [], cancelled: [] };
    const { kernel } = await bootApprovalsKernel(log);

    // POSITIVE CONTROL — the clock really was wired, so the assertion below
    // measures a cancel and not an absence.
    expect(log.scheduled).toContain(ESCALATION_JOB_NAME);
    expect(log.cancelled).toEqual([]);

    await kernel.shutdown();

    // THE PIN. Before the fix the cancel lived in `stop()`, which the kernel
    // never called, so the job outlived the kernel that scheduled it.
    expect(log.cancelled).toContain(ESCALATION_JOB_NAME);
  });

  it('the retained stop() alias still tears down for an embedder that calls it directly', async () => {
    // The alias exists precisely because an embedder may have learned to call
    // it BECAUSE the kernel never did. Pinning only the shutdown direction
    // would go green on an implementation that simply deletes `stop()`.
    const log: JobLog = { scheduled: [], cancelled: [] };
    const { plugin } = await bootApprovalsKernel(log);

    expect(log.scheduled).toContain(ESCALATION_JOB_NAME);
    expect(log.cancelled).toEqual([]);

    await plugin.stop();

    expect(log.cancelled).toContain(ESCALATION_JOB_NAME);
  });

  it('a teardown on a plugin that never started is a no-op rather than a throw', async () => {
    const plugin = new ApprovalsServicePlugin();
    await expect(plugin.destroy()).resolves.toBeUndefined();
    await expect(plugin.stop()).resolves.toBeUndefined();
  });
});
