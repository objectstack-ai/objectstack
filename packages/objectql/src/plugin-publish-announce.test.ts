// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10219 — the per-item publish door announces `metadata:reloaded`.
 *
 * `POST /api/v1/meta/:type/:name/publish` had no re-bind signal at all. The
 * event that makes boot-cached consumers re-read had two announcers — the
 * metadata plugin's dev-artifact watcher, and the runtime dispatcher after
 * `POST /packages/:id/publish-drafts` (#2576) — so publishing item by item, the
 * shape AI authoring and the item-level Studio doors take, told nobody.
 * Measured on a cloud rig: a record-change flow published as `state='active'`
 * produced no bind log and never fired until the kernel was rebuilt.
 *
 * The split of responsibility under test: the protocol NOTIFIES (it holds no
 * kernel hook bus) and this plugin, which holds `ctx`, TRIGGERS — the same
 * division `HttpDispatcher.announceKernelEvent` makes for the batch door. The
 * consumer half is already pinned one package over
 * (`service-automation/src/flow-publish-rebind.test.ts`: a `metadata:reloaded`
 * carrying `changed: ['flow/<name>']` binds the flow with no restart), so these
 * cases close the remaining link in that chain.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQLPlugin } from './plugin.js';
import type { ObjectQL } from './engine.js';

type AnyRecord = Record<string, any>;

/** Boot the plugin's in-house protocol assembly and hand back both halves. */
async function armedPlugin() {
  const ql: AnyRecord = {
    registerAction: vi.fn(),
    removeActionsByPackage: vi.fn(),
    registerApp: vi.fn(),
    setDatasourceMapping: vi.fn(),
    find: vi.fn(async () => []),
    registry: { getArtifactItem: vi.fn(() => undefined) },
    getDefaultActionRunner: () => undefined,
  };
  const plugin = new ObjectQLPlugin({ ql: ql as unknown as ObjectQL, environmentId: 'env_t' });
  const registered = new Map<string, any>();
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ctx = {
    logger,
    trigger: vi.fn(async () => {}),
    registerService: vi.fn((name: string, svc: any) => registered.set(name, svc)),
    getService: vi.fn(() => { throw new Error('none'); }),
  } as AnyRecord;

  await (plugin as any).init(ctx);
  const protocol = registered.get('protocol');
  expect(protocol, 'the in-house assembly registered a protocol').toBeDefined();
  return { plugin, ctx, logger, protocol };
}

describe('ObjectQLPlugin bridges a per-item publish to `metadata:reloaded` (#10219)', () => {
  it('triggers the lifecycle event with the batch door\'s `{type}/{name}` spelling', async () => {
    const { ctx, protocol } = await armedPlugin();

    await (protocol as any).emitMetaItemPublished({
      type: 'flow', name: 'ticket_closed', organizationId: null,
    });

    expect(ctx.trigger).toHaveBeenCalledWith(
      'metadata:reloaded',
      { changed: ['flow/ticket_closed'] },
    );
  });

  it('is AWAITED by the publish, so the announce completes before the caller is answered', async () => {
    const { ctx, protocol } = await armedPlugin();
    const order: string[] = [];
    ctx.trigger.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push('subscribers-resynced');
    });

    await (protocol as any).emitMetaItemPublished({
      type: 'flow', name: 'ticket_closed', organizationId: null,
    });
    order.push('publish-returned');

    expect(order).toEqual(['subscribers-resynced', 'publish-returned']);
  });

  it('a throwing subscriber is reported, never rethrown — the item is already published', async () => {
    const { ctx, logger, protocol } = await armedPlugin();
    ctx.trigger.mockRejectedValue(new Error('resync exploded'));

    await expect(
      (protocol as any).emitMetaItemPublished({
        type: 'flow', name: 'ticket_closed', organizationId: null,
      }),
    ).resolves.toBeUndefined();

    // Degradation log level: `warn`, matching the sibling announcers. Nothing
    // claimed to persist and did not — what is lost is an in-memory re-sync.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, detail] = logger.warn.mock.calls[0]!;
    expect(message).toContain('metadata:reloaded');
    expect(detail).toMatchObject({ item: 'flow/ticket_closed', error: 'resync exploded' });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('a metadata MUTATION does not announce — only the per-item publish door does', async () => {
    const { ctx, protocol } = await armedPlugin();

    // The #2588 seam fires on every save/delete too. Announcing a full reload
    // there would fan a kernel-wide re-sync out of every draft keystroke.
    (protocol as any).emitMetadataMutation({ type: 'flow', name: 'ticket_closed', state: 'active' });
    await new Promise((r) => setTimeout(r, 0));

    expect(ctx.trigger).not.toHaveBeenCalled();
  });
});
