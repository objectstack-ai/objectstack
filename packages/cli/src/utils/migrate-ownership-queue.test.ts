// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0142 D1] `composeOwnershipQueueProvider`: which provider a one-shot
 * `bootSchemaStack` boot adds, and when it adds none.
 *
 * The boot itself, on a stack declaring `queues` and `assignmentRules`, is
 * pinned in `../commands/migrate/summary-nulls.ownership-queue.integration.test.ts`.
 * What a boot cannot show is pinned here: the kernel keeps the LAST plugin of
 * a name, so a provider added to a composition that already holds one would
 * displace that instance and the service would still be registered.
 */

import { describe, it, expect, vi } from 'vitest';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { OWNERSHIP_QUEUE_SERVICE } from '@objectstack/spec/contracts';
import { composeOwnershipQueueProvider } from './migrate-ownership-queue.js';
import { composeProviderForDeclarations } from './schema-migration-plugins.js';

describe('composeOwnershipQueueProvider', () => {
  it('adds the provider os serve mounts when the composition holds none, composed for its declarations only', async () => {
    const provider = await composeOwnershipQueueProvider([{ name: 'com.objectstack.engine.objectql' }]);
    expect(provider).not.toBeNull();
    const plugin = provider as SharingServicePlugin;
    expect(plugin.name).toBe('com.objectstack.service.sharing');
    expect(plugin).toBeInstanceOf(SharingServicePlugin);

    // `init()` registers the ownership-queue service and registers no lifecycle hook.
    const registered = new Map<string, unknown>();
    const hook = vi.fn();
    const ctx = {
      getService: (name: string) => {
        if (name === 'manifest') return { register: () => {} };
        throw new Error(`service '${name}' not found`);
      },
      registerService: (name: string, service: unknown) => { registered.set(name, service); },
      hook,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    };
    await plugin.init(ctx as any);
    expect(registered.has(OWNERSHIP_QUEUE_SERVICE)).toBe(true);
    expect(hook).not.toHaveBeenCalled();
    // `start()` — where the sharing runtime binds its hooks — is suppressed.
    await plugin.start(ctx as any);
    expect(hook).not.toHaveBeenCalled();
    expect(registered.has('sharing')).toBe(false);
  });

  it('adds none when the composition already holds the provider: a plain instance (a host config)', async () => {
    expect(await composeOwnershipQueueProvider([new SharingServicePlugin()])).toBeNull();
  });

  it('adds none when the composition already holds the provider: the declaration-composed one plan / apply mount', async () => {
    expect(await composeOwnershipQueueProvider([composeProviderForDeclarations(new SharingServicePlugin())])).toBeNull();
  });
});
