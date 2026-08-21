// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10371] `await kernel.shutdown()` must actually reach this plugin's teardown.
 *
 * THE DEFECT THIS PINS. The teardown that releases the `knowledge-event-sync`
 * realtime subscription was spelled `stop()`. `Plugin` (`@objectstack/core`'s
 * `types.ts`) declares `init()`, `start?(ctx)` and `destroy?()` — and NO
 * `stop()` — so `ObjectKernel.performShutdown()` and `LiteKernel.destroy()`,
 * which walk the plugins in reverse calling `plugin.destroy()`, walked straight
 * past it. Nothing in the repo ever called `stop()`, so the subscription
 * outlived the kernel that created it.
 *
 * THE ASYMMETRY THAT HID IT. `start?(ctx)` IS on the interface and does fire,
 * so a `start`/`stop` pair reads as symmetric in review — which is how the same
 * shape survived in six packages at once (#9371 found the first instance only
 * after it had evicted two fully green PRs from the merge queue).
 *
 * WHY THE ASSERTION IS BEHAVIOURAL. `expect(plugin.destroy).toBeDefined()`
 * would pass on a plugin the kernel still never reaches — the hook merely
 * EXISTING is not the property that was missing, being CALLED BY THE KERNEL is.
 * So this drives a real `LiteKernel` through a real shutdown and reads what the
 * realtime service was actually asked to do.
 */

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { RealtimeEventHandler } from '@objectstack/spec/contracts';
import { KnowledgeServicePlugin } from '../knowledge-service-plugin.js';

interface RealtimeLog {
  subscribed: string[];
  unsubscribed: string[];
}

/**
 * Publishes a minimal `realtime` service. A plugin rather than a bare
 * `registerService` call because the subscription is only taken out if the
 * service is resolvable at `kernel:ready`, which is the kernel's business.
 */
class FakeRealtimePlugin implements Plugin {
  name = 'test.fake.realtime';
  version = '1.0.0';
  type = 'standard';

  constructor(private readonly log: RealtimeLog) {}

  async init(ctx: PluginContext): Promise<void> {
    ctx.registerService('realtime', {
      publish: async () => undefined,
      subscribe: async (channel: string, _handler: RealtimeEventHandler) => {
        this.log.subscribed.push(channel);
        return 'sub-1';
      },
      unsubscribe: async (id: string) => { this.log.unsubscribed.push(id); },
    });
  }
}

async function bootKnowledgeKernel(log: RealtimeLog) {
  const kernel = new LiteKernel();
  kernel.use(new FakeRealtimePlugin(log));
  const plugin = new KnowledgeServicePlugin();
  kernel.use(plugin);
  await kernel.bootstrap();
  return { kernel, plugin };
}

describe('#10371 KnowledgeServicePlugin releases its realtime subscription on kernel shutdown', () => {
  it('unsubscribes from knowledge-event-sync once shutdown() has resolved', async () => {
    const log: RealtimeLog = { subscribed: [], unsubscribed: [] };
    const { kernel } = await bootKnowledgeKernel(log);

    // POSITIVE CONTROL — the subscription really was taken out, so the
    // assertion below measures a release and not an absence.
    expect(log.subscribed).toContain('knowledge-event-sync');
    expect(log.unsubscribed).toEqual([]);

    await kernel.shutdown();

    // THE PIN. Before the fix the unsubscribe lived in `stop()`, which the
    // kernel never called.
    expect(log.unsubscribed).toEqual(['sub-1']);
  });

  it('the retained stop() alias still tears down for an embedder that calls it directly', async () => {
    // The alias exists precisely because an embedder may have learned to call
    // it BECAUSE the kernel never did. Pinning only the shutdown direction
    // would go green on an implementation that simply deletes `stop()`.
    const log: RealtimeLog = { subscribed: [], unsubscribed: [] };
    const { plugin } = await bootKnowledgeKernel(log);

    expect(log.subscribed).toContain('knowledge-event-sync');
    expect(log.unsubscribed).toEqual([]);

    await plugin.stop();

    expect(log.unsubscribed).toEqual(['sub-1']);
  });

  it('a teardown on a plugin that never started is a no-op rather than a throw', async () => {
    const plugin = new KnowledgeServicePlugin();
    await expect(plugin.destroy()).resolves.toBeUndefined();
    await expect(plugin.stop()).resolves.toBeUndefined();
  });
});
