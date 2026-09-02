// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14123] The wiring pin: `ObjectQLPlugin.runGovernanceInventory` hands the
 * router's registry rung to the audit.
 *
 * `action-governance.test.ts` pins what the inventory DOES with the rung.
 * Nothing there can fail if the plugin stops passing it — the audit accepts
 * the argument as optional, and its absence is silent by construction (two of
 * the router's three sources, and a false accusation against a healthy
 * deployment). So the pin that matters lives here, on the real caller: the
 * one call site with `ql` in hand is the only place the rung can join the
 * audit, and this drives that method rather than a copy of it.
 *
 * The shape under test is the card's own probe, reproduced against the real
 * plugin: the registry answers `getItem('action', name)` while the metadata
 * plane holds no `action` rows at all (the in-process boot). Before the fix
 * that boot printed "registered handlers with NO declaration ... REFUSED at
 * dispatch" for exactly the actions the router was dispatching.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQLPlugin } from './plugin.js';
import type { ObjectQL } from './engine.js';

type AnyRecord = Record<string, any>;

/** A PluginContext with no services — the in-process boot's empty plane. */
function makeCtx() {
  return {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    getService: vi.fn((name: string) => {
      throw new Error(`service '${name}' not registered`);
    }),
    hook: vi.fn(),
  } as AnyRecord;
}

function makeQl(opts: {
  registered: Array<{ objectName: string; actionName: string }>;
  objects?: AnyRecord[];
  registryActions?: Record<string, AnyRecord>;
}) {
  return {
    listRegisteredActions: vi.fn(() => opts.registered),
    registry: {
      getAllObjects: vi.fn(() => opts.objects ?? []),
      getItem: vi.fn((type: string, name: string) =>
        (type === 'action' ? opts.registryActions?.[name] : undefined)),
    },
  } as AnyRecord;
}

const makePlugin = (ql: AnyRecord) => new ObjectQLPlugin({ ql: ql as unknown as ObjectQL });

describe('ObjectQLPlugin.runGovernanceInventory — the injected registry rung (#14123)', () => {
  it('probes the registry for a handler the objects and the plane do not declare', async () => {
    const ctx = makeCtx();
    const ql = makeQl({
      registered: [{ objectName: 'global', actionName: 'duly_catalog_apply' }],
      registryActions: {
        duly_catalog_apply: { name: 'duly_catalog_apply', type: 'script', locations: [] },
      },
    });

    await (makePlugin(ql) as any).runGovernanceInventory(ctx);

    expect(ql.registry.getItem).toHaveBeenCalledWith('action', 'duly_catalog_apply');
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });

  it('clears an object-BOUND registry declaration through the same call site', async () => {
    const ctx = makeCtx();
    const ql = makeQl({
      registered: [{ objectName: 'todo_task', actionName: 'archive_task' }],
      objects: [{ name: 'todo_task', actions: [] }],
      registryActions: {
        archive_task: { name: 'archive_task', objectName: 'todo_task', type: 'script' },
      },
    });

    await (makePlugin(ql) as any).runGovernanceInventory(ctx);

    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });

  it('POSITIVE CONTROL — a handler the registry does not know is still reported', async () => {
    const ctx = makeCtx();
    const ql = makeQl({
      registered: [{ objectName: 'global', actionName: 'ghostProbe' }],
      registryActions: {},
    });

    await (makePlugin(ql) as any).runGovernanceInventory(ctx);

    expect(ql.registry.getItem).toHaveBeenCalledWith('action', 'ghostProbe');
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/registered handlers with NO declaration/),
      expect.objectContaining({ count: 1, handlers: ['global:ghostProbe'] }),
    );
  });

  it('does not fail the boot when the registry lookup throws', async () => {
    const ctx = makeCtx();
    const ql = makeQl({ registered: [{ objectName: 'global', actionName: 'duly_catalog_apply' }] });
    ql.registry.getItem = vi.fn(() => { throw new Error('registry unreadable'); });

    await expect((makePlugin(ql) as any).runGovernanceInventory(ctx)).resolves.toBeUndefined();

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/registered handlers with NO declaration/),
      expect.objectContaining({ handlers: ['global:duly_catalog_apply'] }),
    );
  });

  it('survives an engine whose registry has no `getItem` at all', async () => {
    const ctx = makeCtx();
    const ql = makeQl({ registered: [{ objectName: 'global', actionName: 'ghostProbe' }] });
    delete ql.registry.getItem;

    await expect((makePlugin(ql) as any).runGovernanceInventory(ctx)).resolves.toBeUndefined();

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/registered handlers with NO declaration/),
      expect.objectContaining({ handlers: ['global:ghostProbe'] }),
    );
  });
});
