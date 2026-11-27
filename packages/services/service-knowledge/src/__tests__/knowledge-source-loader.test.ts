// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The loader of the governed `knowledge_source` type (#37304; ADR-0161 K4 —
 * the type lands with its reader — and K7, "What starts a rebuild"):
 *
 * - the loader alone: an added item is registered, a changed one reloaded and
 *   built, an unchanged one left alone, a removed one unregistered and its
 *   index dropped; a row that is no source is said once; a listing that cannot
 *   be read changes nothing;
 * - through `KnowledgeServicePlugin`: the items are loaded at boot, again when
 *   the metadata protocol signals a `knowledge_source` change or the kernel
 *   announces a metadata reload, and a composition with no metadata store
 *   serves the sources registered in code.
 */

import { describe, expect, it, vi } from 'vitest';
import type { IKnowledgeAdapter } from '@objectstack/spec/contracts';
import type { KnowledgeSource } from '@objectstack/spec/ai';
import { KnowledgeService } from '../knowledge-service.js';
import { KnowledgeServicePlugin } from '../knowledge-service-plugin.js';
import { KnowledgeSourceLoader } from '../knowledge-source-loader.js';
import { indexKeyOf } from '../knowledge-source-registry.js';

const ACME = 'com.acme.kb';
const GLOBEX = 'com.globex.kb';
const NAMESPACES: Record<string, string> = { [ACME]: 'acme', [GLOBEX]: 'globex' };

/** A stored `knowledge_source` body; `packageId` binds the row to a package. */
function item(name: string, packageId?: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    label: `${name} label`,
    adapter: 'memory',
    source: { kind: 'object', object: 'note', content: ['body'] },
    ...(packageId === undefined ? {} : { _packageId: packageId }),
    ...extra,
  };
}

function droppingAdapter() {
  const dropped: string[] = [];
  const adapter = {
    id: 'memory',
    upsert: async () => undefined,
    delete: async () => undefined,
    search: async () => [],
    dropSource: async (opts: { source: KnowledgeSource }) => {
      dropped.push(opts.source.name);
    },
  } as unknown as IKnowledgeAdapter;
  return { adapter, dropped };
}

/** The loader over a real service, reading whatever `rows.current` holds. */
function setup(opts: { buildOnReload?: boolean } = {}) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const { adapter, dropped } = droppingAdapter();
  const service = new KnowledgeService({ logger });
  service.registerAdapter('memory', adapter);
  const rows: { current: unknown[] | null } = { current: [] };
  const readItems = vi.fn(async () => rows.current);
  const built = vi.spyOn(service, 'buildReloadedSource').mockResolvedValue(undefined);
  const registered = vi.spyOn(service, 'registerMetadataSource');
  const loader = new KnowledgeSourceLoader({
    service,
    logger,
    readItems,
    namespaceOf: (packageId) => NAMESPACES[packageId],
    buildOnReload: opts.buildOnReload ?? true,
  });
  const faces = () => service.describeSources().map((s) => s.id);
  const warnings = () => logger.warn.mock.calls.map((c) => String(c[0]));
  return { loader, service, rows, readItems, built, registered, dropped, logger, faces, warnings };
}

describe('KnowledgeSourceLoader — one pass makes the sources agree with the published items', () => {
  it("an added item is registered: a package's under its face, an environment's under its bare name", async () => {
    const h = setup();
    h.rows.current = [item('notes', ACME), item('faq')];
    const result = await h.loader.reconcile('boot');
    expect(result).toEqual({ read: true, added: ['acme-notes', 'faq'], changed: [], removed: [] });
    expect(h.service.describeSources().map((s) => ({ id: s.id, door: s.door, packageId: s.packageId }))).toEqual([
      { id: 'acme-notes', door: 'metadata', packageId: ACME },
      { id: 'faq', door: 'metadata', packageId: undefined },
    ]);
    // The boot's own build pass builds these; the loader starts none at boot.
    expect(h.built).not.toHaveBeenCalled();
  });

  it('two packages may each ship a source of one name: two sources, each loaded', async () => {
    const h = setup();
    h.rows.current = [item('notes', ACME), item('notes', GLOBEX)];
    await h.loader.reconcile('boot');
    expect(h.faces()).toEqual(['acme-notes', 'globex-notes']);
  });

  it('an item that did not change is left alone: nothing is registered or built again', async () => {
    const h = setup();
    h.rows.current = [item('notes', ACME)];
    await h.loader.reconcile('boot');
    h.registered.mockClear();
    // The same item, its keys in another order.
    h.rows.current = [{ _packageId: ACME, source: { content: ['body'], object: 'note', kind: 'object' }, adapter: 'memory', label: 'notes label', name: 'notes' }];
    expect(await h.loader.reconcile('reload')).toEqual({ read: true, added: [], changed: [], removed: [] });
    expect(h.registered).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(h.built).not.toHaveBeenCalled();
  });

  it('a changed item is registered again in its own slot, and built on reload', async () => {
    const h = setup();
    h.rows.current = [item('notes', ACME)];
    await h.loader.reconcile('boot');
    h.rows.current = [item('notes', ACME, { source: { kind: 'object', object: 'note', content: ['body', 'title'] } })];
    const result = await h.loader.reconcile('reload');
    expect(result).toEqual({ read: true, added: [], changed: ['acme-notes'], removed: [] });
    expect(h.service.getSource('acme-notes')?.source.content).toEqual(['body', 'title']);
    expect(h.faces()).toEqual(['acme-notes']);
    await vi.waitFor(() => expect(h.built).toHaveBeenCalledWith(indexKeyOf(ACME, 'notes')));
    expect(h.built).toHaveBeenCalledTimes(1);
  });

  it('an item added while the process runs is built; with buildOnReload off, it is registered and not built', async () => {
    const on = setup();
    on.rows.current = [item('faq')];
    expect((await on.loader.reconcile('reload')).added).toEqual(['faq']);
    await vi.waitFor(() => expect(on.built).toHaveBeenCalledWith('faq'));

    const off = setup({ buildOnReload: false });
    off.rows.current = [item('faq')];
    expect((await off.loader.reconcile('reload')).added).toEqual(['faq']);
    await Promise.resolve();
    expect(off.built).not.toHaveBeenCalled();
    expect(off.faces()).toEqual(['faq']);
  });

  it('a removed item is unregistered and its index dropped; a source registered in code is never touched', async () => {
    const h = setup();
    h.service.registerSource(item('coded') as unknown as KnowledgeSource);
    h.rows.current = [item('notes', ACME), item('faq')];
    await h.loader.reconcile('boot');
    h.rows.current = [item('faq')];
    const result = await h.loader.reconcile('reload');
    expect(result).toEqual({ read: true, added: [], changed: [], removed: ['acme-notes'] });
    expect(h.dropped).toEqual([indexKeyOf(ACME, 'notes')]);
    expect(h.faces()).toEqual(['coded', 'faq']);
    // Every item gone: the code source still stands.
    h.rows.current = [];
    await h.loader.reconcile('reload');
    expect(h.faces()).toEqual(['coded']);
    expect(h.dropped).toEqual([indexKeyOf(ACME, 'notes'), 'faq']);
  });

  it('a listing that cannot be read changes nothing: no source is unregistered, no index dropped', async () => {
    const h = setup();
    h.rows.current = [item('notes', ACME)];
    await h.loader.reconcile('boot');
    h.rows.current = null;
    expect(await h.loader.reconcile('reload')).toEqual({ read: false, added: [], changed: [], removed: [] });
    expect(h.faces()).toEqual(['acme-notes']);
    expect(h.dropped).toEqual([]);
  });
});

describe('KnowledgeSourceLoader — rows that are no source', () => {
  it('a row that does not parse is not served, said once with the schema\'s prescription; the rows beside it load', async () => {
    const h = setup();
    h.rows.current = [
      { id: 'legacy', label: 'Legacy', adapter: 'memory', source: { kind: 'object', object: 'note', content: ['body'] } },
      { ...item('wild'), source: { kind: 'object', object: 'note', content: ['*'] } },
      item('faq'),
    ];
    await h.loader.reconcile('boot');
    await h.loader.reconcile('reload');
    expect(h.faces()).toEqual(['faq']);
    const lines = h.warnings().filter((l) => l.includes('is not a valid source and is not served'));
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.includes('"wild"') && l.includes('content'))).toBe(true);
    expect(lines.some((l) => l.includes('`id`'))).toBe(true);
  });

  it('an environment row under a name a package holds is not served: unregistered, its index dropped, said once', async () => {
    const h = setup();
    // Before the package arrives, the environment's row is a source.
    h.rows.current = [item('notes')];
    await h.loader.reconcile('boot');
    expect(h.faces()).toEqual(['notes']);

    h.rows.current = [item('notes'), item('notes', ACME)];
    const arrived = await h.loader.reconcile('reload');
    expect(arrived).toEqual({ read: true, added: ['acme-notes'], changed: [], removed: ['notes'] });
    expect(h.faces()).toEqual(['acme-notes']);
    expect(h.dropped).toEqual(['notes']);
    await h.loader.reconcile('reload');
    const lines = h.warnings().filter((l) => l.includes('authored in this environment is not served'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("'notes'");
    expect(lines[0]).toContain(`"${ACME}"`);
    expect(lines[0]).toContain('Rename');

    // The package leaves: the environment's row is a source again.
    h.rows.current = [item('notes')];
    expect(await h.loader.reconcile('reload')).toEqual({ read: true, added: ['notes'], changed: [], removed: ['acme-notes'] });
    expect(h.faces()).toEqual(['notes']);
  });

  it('an environment row under a name registered in code is refused, said once naming both doors; the code source stays', async () => {
    const h = setup();
    h.service.registerSource(item('notes', undefined, { label: 'Coded' }) as unknown as KnowledgeSource);
    h.rows.current = [item('notes'), item('notes', ACME)];
    // A package's source of the name is unaffected by the code registration,
    // and with a package holding the name the environment's row is unserved
    // before it ever meets the code door.
    await h.loader.reconcile('boot');
    expect(h.faces()).toEqual(['notes', 'acme-notes']);
    expect(h.service.getSource('notes')?.label).toBe('Coded');

    const alone = setup();
    alone.service.registerSource(item('notes', undefined, { label: 'Coded' }) as unknown as KnowledgeSource);
    alone.rows.current = [item('notes')];
    await alone.loader.reconcile('boot');
    await alone.loader.reconcile('reload');
    expect(alone.service.describeSources().map((s) => [s.id, s.door, s.source.label])).toEqual([['notes', 'code', 'Coded']]);
    const lines = alone.warnings().filter((l) => l.includes('The item is not served.'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Held by: a registration in code');
    expect(lines[0]).toContain('Refused: a knowledge_source metadata item authored in this environment');
  });
});

describe('KnowledgeSourceLoader — passes run one after another', () => {
  it('a reload asked for while one is waiting to start is answered by that one', async () => {
    const h = setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    h.readItems.mockImplementationOnce(async () => { await gate; return [item('faq')]; });
    const first = h.loader.reconcile('boot');
    const second = h.loader.reconcile('reload');
    const third = h.loader.reconcile('reload');
    expect(third).toBe(second);
    h.rows.current = [item('faq'), item('notes', ACME)];
    release();
    expect((await first).added).toEqual(['faq']);
    expect((await second).added).toEqual(['acme-notes']);
    expect(h.readItems).toHaveBeenCalledTimes(2);
    // Once it ran, the next reload is a new pass.
    await h.loader.reconcile('reload');
    expect(h.readItems).toHaveBeenCalledTimes(3);
  });
});

// ── Through the plugin ──────────────────────────────────────────────

type Hook = (...args: unknown[]) => Promise<void> | void;

/** Boot the plugin over a fake kernel context; `services` are what `getService` answers. */
async function bootPlugin(
  options: ConstructorParameters<typeof KnowledgeServicePlugin>[0],
  services: Record<string, unknown>,
) {
  const hooks = new Map<string, Hook[]>();
  let service: KnowledgeService | undefined;
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    hook: (name: string, fn: Hook) => {
      hooks.set(name, [...(hooks.get(name) ?? []), fn]);
    },
    registerService: (_name: string, svc: KnowledgeService) => {
      service = svc;
    },
    getService: (name: string) => {
      if (name in services) return services[name];
      throw new Error(`no service ${name}`);
    },
  };
  const fire = async (name: string) => {
    for (const fn of hooks.get(name) ?? []) await fn();
  };
  const plugin = new KnowledgeServicePlugin({ buildAtBoot: false, ...options });
  await plugin.init(ctx);
  service!.registerAdapter('memory', droppingAdapter().adapter);
  await plugin.start(ctx);
  await fire('kernel:ready');
  await fire('kernel:bootstrapped');
  const faces = () => service!.describeSources().map((s) => s.id);
  return { ctx, plugin, service: service!, fire, faces };
}

/** A metadata protocol double: the execution read of the type, and the mutation signal. */
function fakeProtocol(initial: unknown[]) {
  const store = { items: initial, fail: undefined as Error | undefined };
  const listeners = new Set<(evt: { type?: string; name?: string; state?: string }) => void>();
  const protocol = {
    getMetaItemsForExecution: vi.fn(async (request: { type: string }) => {
      if (store.fail) throw store.fail;
      return { type: request.type, items: store.items };
    }),
    onMetadataMutation: (listener: (evt: { type?: string; name?: string; state?: string }) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const signal = (evt: { type?: string; name?: string; state?: string }) => {
    for (const listener of listeners) listener(evt);
  };
  return { protocol, store, signal, listeners };
}

/** The engine slice the plugin reads a package's namespace from. */
const objectql = {
  registry: { getPackage: (id: string) => (NAMESPACES[id] ? { manifest: { namespace: NAMESPACES[id] } } : undefined) },
};

describe('KnowledgeServicePlugin — the published items are loaded', () => {
  it('at boot: every published item is a source, beside the ones registered in code', async () => {
    const { protocol } = fakeProtocol([item('notes', ACME), item('faq')]);
    const h = await bootPlugin({ sources: [item('coded') as unknown as KnowledgeSource] }, { protocol, objectql });
    expect(h.faces()).toEqual(['coded', 'acme-notes', 'faq']);
    expect(protocol.getMetaItemsForExecution).toHaveBeenCalledWith({ type: 'knowledge_source' });
  });

  it('a read decoration on a listed item is not part of the source', async () => {
    const { protocol } = fakeProtocol([{ ...item('faq'), _lock: 'none', _diagnostics: [{ code: 'x' }], _withheldFields: [] }]);
    const h = await bootPlugin({}, { protocol, objectql });
    expect(h.faces()).toEqual(['faq']);
    expect(h.ctx.logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('is not a valid source'));
  });

  it('a published change to a knowledge_source reloads the sources; a draft or another type does not', async () => {
    const { protocol, store, signal } = fakeProtocol([item('faq')]);
    const h = await bootPlugin({}, { protocol, objectql });
    const reads = () => protocol.getMetaItemsForExecution.mock.calls.length;
    const before = reads();

    store.items = [item('faq'), item('notes', ACME)];
    signal({ type: 'knowledge_source', name: 'notes', state: 'draft' });
    signal({ type: 'object', name: 'note', state: 'active' });
    await Promise.resolve();
    expect(reads()).toBe(before);
    expect(h.faces()).toEqual(['faq']);

    signal({ type: 'knowledge_source', name: 'notes', state: 'active' });
    await vi.waitFor(() => expect(h.faces()).toEqual(['faq', 'acme-notes']));

    store.items = [item('notes', ACME)];
    signal({ type: 'knowledge_source', name: 'faq', state: 'deleted' });
    await vi.waitFor(() => expect(h.faces()).toEqual(['acme-notes']));
  });

  it('a metadata reload the kernel announces reloads the sources', async () => {
    const { protocol, store } = fakeProtocol([]);
    const h = await bootPlugin({}, { protocol, objectql });
    expect(h.faces()).toEqual([]);
    store.items = [item('notes', GLOBEX)];
    await h.fire('metadata:reloaded');
    expect(h.faces()).toEqual(['globex-notes']);
  });

  it('a source added after boot is guarded by the lifecycle reap guard from then on', async () => {
    const { protocol, store, signal } = fakeProtocol([]);
    const guarded: string[] = [];
    const lifecycle = { registerReapGuard: (object: string) => guarded.push(object) };
    const h = await bootPlugin({}, { protocol, objectql, lifecycle });
    expect(guarded).toEqual([]);
    store.items = [item('notes', ACME)];
    signal({ type: 'knowledge_source', name: 'notes', state: 'active' });
    await vi.waitFor(() => expect(h.faces()).toEqual(['acme-notes']));
    expect(guarded).toEqual(['note']);
  });

  it('a listing that cannot be read is said at warn, and the sources stay as they were', async () => {
    const { protocol, store } = fakeProtocol([item('faq')]);
    const h = await bootPlugin({}, { protocol, objectql });
    store.fail = new Error('metadata store offline');
    await h.fire('metadata:reloaded');
    expect(h.faces()).toEqual(['faq']);
    expect(h.ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('metadata store offline'));
  });

  it('a package whose namespace the host cannot answer keeps its source, under its bare name', async () => {
    const { protocol } = fakeProtocol([item('notes', 'com.unknown.pkg')]);
    const h = await bootPlugin({}, { protocol });
    expect(h.service.describeSources().map((s) => ({ id: s.id, packageId: s.packageId }))).toEqual([
      { id: 'notes', packageId: 'com.unknown.pkg' },
    ]);
  });

  it('with no metadata protocol, the sources are the ones registered in code and nothing is reported', async () => {
    const h = await bootPlugin({ sources: [item('coded') as unknown as KnowledgeSource] }, {});
    await h.fire('metadata:reloaded');
    expect(h.faces()).toEqual(['coded']);
    expect(h.ctx.logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('knowledge_source'));
  });

  it('after destroy, a signal loads nothing', async () => {
    const { protocol, store, signal, listeners } = fakeProtocol([]);
    const h = await bootPlugin({}, { protocol, objectql });
    expect(listeners.size).toBe(1);
    await h.plugin.destroy();
    expect(listeners.size).toBe(0);
    store.items = [item('faq')];
    signal({ type: 'knowledge_source', name: 'faq', state: 'active' });
    await Promise.resolve();
    expect(h.faces()).toEqual([]);
  });
});
