// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0142 D1] `composeOwnershipQueueProvider`: what a one-shot
 * `bootSchemaStack` boot adds for a stack declaring `queues` /
 * `assignmentRules`, and when it adds nothing.
 *
 * The boot itself is pinned in
 * `../commands/migrate/summary-nulls.ownership-queue.integration.test.ts`.
 * Pinned here: the plugin's `init()` registers the ownership-queue service and
 * NOTHING else — no manifest (so no sharing object), no lifecycle hook, no
 * `start()` — and a composition that already holds the provider gets none.
 * The declaration-composed provider `plan` / `apply` mount is the
 * served-platform case of the integration pin, where a second registration
 * would throw.
 */

import { describe, it, expect, vi } from 'vitest';
import { OwnershipQueueService, SharingServicePlugin } from '@objectstack/plugin-sharing';
import { OWNERSHIP_QUEUE_SERVICE } from '@objectstack/spec/contracts';
import { composeOwnershipQueueProvider } from './migrate-ownership-queue.js';
// The source reaches `@objectstack/core` through a dynamic `import()`: its first
// load is paid at collection, not inside a clocked case (`scripts/check-test-source-alias.mjs`).
import '@objectstack/core';

describe('composeOwnershipQueueProvider', () => {
  it('registers the ownership-queue service and nothing else when the composition holds no provider', async () => {
    const plugin = (await composeOwnershipQueueProvider([{ name: 'com.objectstack.engine.objectql' }])) as {
      name: string; dependencies?: string[]; start?: unknown; init(ctx: unknown): Promise<void>;
    } | null;
    expect(plugin).not.toBeNull();
    expect(plugin!.dependencies).toEqual(['com.objectstack.engine.objectql']);
    expect(plugin!.start).toBeUndefined();

    const registered = new Map<string, unknown>();
    const hook = vi.fn();
    const engine = { find: vi.fn() };
    const getService = vi.fn((name: string) => {
      if (name === 'objectql') return engine;
      throw new Error(`service '${name}' not found`);
    });
    await plugin!.init({
      getService,
      registerService: (name: string, service: unknown) => { registered.set(name, service); },
      hook,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    });
    expect([...registered.keys()]).toEqual([OWNERSHIP_QUEUE_SERVICE]);
    expect(registered.get(OWNERSHIP_QUEUE_SERVICE)).toBeInstanceOf(OwnershipQueueService);
    expect(hook).not.toHaveBeenCalled();
    // No manifest is read, so no sharing object is declared; the engine is resolved at use, never at init.
    expect(getService).not.toHaveBeenCalled();
  });

  it('adds nothing when the composition already holds the provider (a host config\'s own instance)', async () => {
    expect(await composeOwnershipQueueProvider([new SharingServicePlugin()])).toBeNull();
  });
});
