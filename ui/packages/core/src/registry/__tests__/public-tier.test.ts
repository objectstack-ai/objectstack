import { describe, expect, it } from 'vitest';
import { Registry } from '../Registry.js';
import { PUBLIC_BLOCKS, PUBLIC_BLOCK_SET } from '../public-blocks.js';

const C = () => null;

describe('getPublicConfigs — ADR-0080 curated public tier (capability ≠ contract)', () => {
  it('returns registered curated blocks + tier:public opt-ins, keyed by bare tag, deduped', () => {
    const r = new Registry();
    r.register('flex', C, { namespace: 'ui' });                  // curated
    r.register('object-grid', C, { namespace: 'plugin-grid' });  // curated, dual-key
    r.register('studio-admin', C, { namespace: 'app-shell' });   // capability only
    r.register('my-widget', C, { namespace: 'x', tier: 'public' }); // explicit opt-in

    const types = r.getPublicConfigs().map((c) => c.type).sort();
    expect(types).toContain('flex');
    expect(types).toContain('object-grid');
    expect(types).toContain('my-widget');        // opt-in surfaces
    expect(types).not.toContain('studio-admin'); // capability, not contract
    // bare tag, not namespaced; no duplicates from dual-key registration
    expect(types.filter((t) => t === 'object-grid')).toHaveLength(1);
    expect(types.some((t) => t.includes(':'))).toBe(false);
  });

  it('skips curated tags that are not registered (aspirational-safe list)', () => {
    const r = new Registry();
    r.register('card', C, { namespace: 'ui' });
    expect(r.getPublicConfigs().map((c) => c.type)).toEqual(['card']);
  });

  it('PUBLIC_BLOCKS is duplicate-free and matches its set', () => {
    expect(new Set(PUBLIC_BLOCKS).size).toBe(PUBLIC_BLOCKS.length);
    expect(PUBLIC_BLOCK_SET.size).toBe(PUBLIC_BLOCKS.length);
  });
});

// ---------------------------------------------------------------------------
// Lazy registrations are contract members too (objectui#2953)
// ---------------------------------------------------------------------------

describe('getPublicConfigs — lazy registrations (objectui#2953)', () => {
  const loader = () => Promise.resolve();

  it('includes a curated block that is only lazily registered', () => {
    const r = new Registry();
    r.registerLazy('object-kanban', loader, { namespace: 'plugin-kanban', category: 'view' });

    const cfg = r.getPublicConfigs().find((c) => c.type === 'object-kanban');
    // Before the fix this was `undefined`, because getPublicConfigs() resolved
    // each curated tag through getConfig(), which only reads loaded
    // registrations — so every lazily-registered public block silently fell
    // out of the contract (and out of every kind:'react' page's scope).
    expect(cfg).toBeTruthy();
    expect(cfg!.lazy).toBe(true);
    expect(cfg!.component).toBeUndefined();
    // Metadata comes from the stub, so consumers can still filter on it.
    expect(cfg!.namespace).toBe('plugin-kanban');
    expect(cfg!.isContainer).toBeFalsy();
  });

  it('does not depend on load order — same entry before and after the load', () => {
    const r = new Registry();
    r.registerLazy('object-map', loader, { namespace: 'plugin-map' });
    const before = r.getPublicConfigs().map((c) => c.type);

    // The plugin chunk lands: its module registers the real component.
    r.register('object-map', C, { namespace: 'plugin-map' });
    const after = r.getPublicConfigs();

    expect(before).toEqual(['object-map']);
    expect(after.map((c) => c.type)).toEqual(['object-map']);
    // …and now it is a fully loaded entry, not a stub.
    expect(after[0].lazy).toBeFalsy();
    expect(after[0].component).toBe(C);
  });

  it('emits one entry per component when a stub is registered under both keys', () => {
    const r = new Registry();
    // registerLazy stores the entry under BOTH `plugin-kanban:object-kanban`
    // and the bare `object-kanban`; the contract wants one row, keyed bare.
    r.registerLazy('object-kanban', loader, { namespace: 'plugin-kanban' });
    r.registerLazy('kanban', loader, { namespace: 'view' }); // not curated

    const types = r.getPublicConfigs().map((c) => c.type);
    expect(types).toEqual(['object-kanban']);
  });

  it('honours a colon-shaped curated tag without double-prefixing its namespace', () => {
    const r = new Registry();
    r.registerLazy('record:details', loader, { namespace: 'record' });

    const types = r.getPublicConfigs().map((c) => c.type);
    expect(types).toEqual(['record:details']);
  });

  it('surfaces a lazy `tier:public` opt-in outside the curated list', () => {
    const r = new Registry();
    r.registerLazy('my-widget', loader, { namespace: 'x', tier: 'public' });
    r.registerLazy('my-internal', loader, { namespace: 'x' });

    const types = r.getPublicConfigs().map((c) => c.type);
    expect(types).toEqual(['my-widget']);
  });

  it('leaves getConfig() loaded-only — a stub is not a renderable config', () => {
    const r = new Registry();
    r.registerLazy('object-gantt', loader, { namespace: 'plugin-gantt' });

    // Callers of getConfig() read `.component`; handing them a stub would give
    // them `undefined` to render. They go through hasLazy()/loadLazy() instead.
    expect(r.getConfig('object-gantt')).toBeUndefined();
    expect(r.hasLazy('object-gantt')).toBe(true);
  });
});
