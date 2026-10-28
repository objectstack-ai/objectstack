// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26596, #26698] The metadata-change subscription contract: which signals
 * drop the security plugin's metadata-derived caches, and which do not.
 *
 * The HTTP-level proof that a member's verdict follows a runtime change is
 * `packages/qa/dogfood/test/security-verdict-follows-runtime-metadata-change.dogfood.test.ts`;
 * this file pins the seam it rests on.
 */

import { describe, it, expect, vi } from 'vitest';
import { subscribeMetadataChangeInvalidation } from './metadata-change-invalidation.js';
import { SecurityPlugin } from './security-plugin.js';

type MutationEvent = { type: string; name: string; state: string };

/** A protocol double carrying the one member the module subscribes through. */
function fakeProtocol() {
  const listeners = new Set<(evt: MutationEvent) => void>();
  return {
    listeners,
    onMetadataMutation(listener: (evt: MutationEvent) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    emit(evt: MutationEvent) {
      for (const l of [...listeners]) l(evt);
    },
  };
}

function fakeCtx(services: Record<string, unknown>) {
  const hooks = new Map<string, Array<() => void>>();
  return {
    hooks,
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
    hook: (name: string, handler: () => void) => {
      hooks.set(name, [...(hooks.get(name) ?? []), handler]);
    },
    fire(name: string) {
      for (const h of hooks.get(name) ?? []) h();
    },
  };
}

describe('subscribeMetadataChangeInvalidation', () => {
  it('a landed (non-draft) metadata mutation invalidates; a draft does not', () => {
    const protocol = fakeProtocol();
    const ctx = fakeCtx({ protocol });
    const invalidate = vi.fn();
    subscribeMetadataChangeInvalidation(ctx, invalidate);

    protocol.emit({ type: 'object', name: 'crm_account', state: 'draft' });
    expect(invalidate, 'a draft never enters the registry').not.toHaveBeenCalled();

    protocol.emit({ type: 'object', name: 'crm_account', state: 'active' });
    protocol.emit({ type: 'permission', name: 'crm_rep', state: 'deleted' });
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('the `metadata:reloaded` announcement invalidates', () => {
    const ctx = fakeCtx({ protocol: fakeProtocol() });
    const invalidate = vi.fn();
    subscribeMetadataChangeInvalidation(ctx, invalidate);

    ctx.fire('metadata:reloaded');
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('returns the protocol subscription disposer, which stops delivery', () => {
    const protocol = fakeProtocol();
    const invalidate = vi.fn();
    const disposers = subscribeMetadataChangeInvalidation(fakeCtx({ protocol }), invalidate);
    expect(disposers).toHaveLength(1);

    disposers[0]!();
    protocol.emit({ type: 'object', name: 'crm_account', state: 'active' });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('a protocol older than the seam is reported once, at `warn`; the reload hook is still wired', () => {
    const ctx = fakeCtx({ protocol: {} });
    const invalidate = vi.fn();
    const disposers = subscribeMetadataChangeInvalidation(ctx, invalidate);

    expect(disposers).toEqual([]);
    expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
    expect(String(ctx.logger.warn.mock.calls[0]![0])).toContain('onMetadataMutation');

    ctx.fire('metadata:reloaded');
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('a kernel with no protocol has no authoring door to hear from: nothing to report', () => {
    const ctx = fakeCtx({});
    const disposers = subscribeMetadataChangeInvalidation(ctx, vi.fn());
    expect(disposers).toEqual([]);
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });
});

describe('SecurityPlugin — metadata-change invalidation through its own lifecycle', () => {
  /**
   * The metadata service here carries exactly the watch API `MetadataManager`
   * exposes (`subscribe`, `watchService`) and no `watch` member: the
   * invalidation must not depend on the metadata service's watchers at all,
   * because the runtime authoring path never announces to them.
   */
  async function boot() {
    const protocol = fakeProtocol();
    const metadata = { subscribe: vi.fn(() => () => {}), watchService: vi.fn(() => ({ unsubscribe() {} })) };
    const ctx = fakeCtx({
      protocol,
      metadata,
      manifest: { register: vi.fn() },
      objectql: { registerMiddleware: vi.fn(), getSchema: () => undefined },
    });
    const plugin = new SecurityPlugin();
    await plugin.init(ctx as any);
    await plugin.start(ctx as any);
    return { plugin: plugin as any, protocol, ctx, metadata };
  }

  const seed = (plugin: any) => {
    plugin.fieldNamesCache.set('crm_account', new Set(['name']));
    plugin.datetimeFieldNamesCache.set('crm_account', new Set());
    plugin.numberComparandFieldsCache.set('crm_account', new Map());
    plugin.tenancyDisabledCache.set('crm_account', false);
    plugin.cbpRelCache.set('crm_account', null);
    plugin.objectSecurityMetaCache.set('crm_account', { owdOpensRowWrites: false });
  };
  const sizes = (plugin: any) => [
    plugin.fieldNamesCache.size,
    plugin.datetimeFieldNamesCache.size,
    plugin.numberComparandFieldsCache.size,
    plugin.tenancyDisabledCache.size,
    plugin.cbpRelCache.size,
    plugin.objectSecurityMetaCache.size,
  ];

  it('a mutation clears every metadata-derived cache and advances the epoch', async () => {
    const { plugin, protocol, metadata } = await boot();
    seed(plugin);
    const epochBefore = plugin.epoch.current;

    protocol.emit({ type: 'object', name: 'crm_account', state: 'active' });

    expect(sizes(plugin)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(plugin.epoch.current, 'the per-context permission-set memo is retired too').toBeGreaterThan(epochBefore);
    expect(metadata.subscribe, 'not the metadata service watchers').not.toHaveBeenCalled();
    expect(metadata.watchService).not.toHaveBeenCalled();
  });

  it('`metadata:reloaded` clears them as well', async () => {
    const { plugin, ctx } = await boot();
    seed(plugin);
    ctx.fire('metadata:reloaded');
    expect(sizes(plugin)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('destroy() releases the protocol subscription', async () => {
    const { plugin, protocol } = await boot();
    const subscribed = protocol.listeners.size;
    expect(subscribed).toBeGreaterThan(0);
    await plugin.destroy();
    seed(plugin);
    protocol.emit({ type: 'object', name: 'crm_account', state: 'active' });
    expect(sizes(plugin), 'a destroyed plugin no longer listens').toEqual([1, 1, 1, 1, 1, 1]);
  });
});
