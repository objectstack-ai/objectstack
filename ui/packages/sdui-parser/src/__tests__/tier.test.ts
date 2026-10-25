import { describe, expect, it } from 'vitest';
import { assertFullyLoaded, generateBlockList, generateDts, manifestFromConfigs } from '../index.js';

const configs = [
  { type: 'object-table', namespace: 'plugin-grid', tier: 'public' as const, inputs: [
    { name: 'object', type: 'string', required: true, binding: 'object' as const }, { name: 'pageSize', type: 'number' } ] },
  { type: 'flex', namespace: 'ui', tier: 'public' as const, isContainer: true, inputs: [{ name: 'gap', type: 'number' }] },
  { type: 'studio-metadata-admin', namespace: 'app-shell', tier: 'internal' as const, inputs: [] },
  { type: 'debug-overlay', namespace: 'app-shell', inputs: [] },
];

describe('M4: capability vs contract (tier)', () => {
  it('publicOnly keeps only the curated tier', () => {
    expect(Object.keys(manifestFromConfigs(configs, { publicOnly: true }).components).sort())
      .toEqual(['flex', 'object-table']);
  });
  it('unfiltered keeps the full capability', () => {
    expect(Object.keys(manifestFromConfigs(configs).components)).toHaveLength(4);
  });
  it('generates the block list 清单 with bindings', () => {
    const list = generateBlockList(manifestFromConfigs(configs, { publicOnly: true }));
    expect(list).toContain('# SDUI public blocks (2)');
    expect(list).toContain('object:object');
  });
  it('codegen stays consistent with the public manifest', () => {
    expect(generateDts(manifestFromConfigs(configs, { publicOnly: true })))
      .toContain('"object-table": ObjectTableProps;');
  });
});

describe('assertFullyLoaded — generators must not emit lazy stubs (objectui#2953)', () => {
  it('passes when every config is a loaded registration', () => {
    expect(() => assertFullyLoaded(configs)).not.toThrow();
  });

  it('names every stub, so the fix is "import these plugins"', () => {
    const withStubs = [
      ...configs,
      { type: 'object-kanban', namespace: 'plugin-kanban', lazy: true },
      { type: 'object-map', namespace: 'plugin-map', lazy: true },
    ];
    // The silent alternative is what this exists to prevent: both blocks reach
    // the manifest with `inputs: []`, which reads as "takes no props" and turns
    // every prop an author writes into an unknown-prop diagnostic.
    expect(manifestFromConfigs(withStubs).components['object-kanban'].inputs).toEqual([]);
    expect(() => assertFullyLoaded(withStubs)).toThrow(/object-kanban, object-map/);
    expect(() => assertFullyLoaded(withStubs)).toThrow(/2 not-yet-loaded lazy block/);
  });
});
