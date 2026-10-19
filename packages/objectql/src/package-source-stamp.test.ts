// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every installed-package row carries `source` — where the package came from —
 * stamped by the door that registered it (`InstalledPackageSchema.source`,
 * #23972; the closed set is ruling B on #23892: code / marketplace / authored).
 *
 * This file holds the engine's two doors onto the package table:
 *
 *  - the `manifest` service → `ObjectQL.registerApp`: the deployment's own code
 *    registers through it, so a caller that says nothing records `'code'`; the
 *    marketplace install-local plugin states `{ source: 'marketplace' }`, and
 *    every package of a multi-package artifact it hands over carries it;
 *  - `SchemaRegistry.installPackage`, the record seam itself: it takes the
 *    origin as a required argument and refuses a call without one, or with a
 *    value outside the set, before anything is recorded.
 *
 * The authored door (`installPackage` in `@objectstack/metadata-protocol`) is
 * pinned beside it, in `protocol-install-package-enable-on-install.test.ts`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import type { ObjectQL } from './engine.js';
import { SchemaRegistry } from './registry.js';

type ManifestService = { register(m: unknown, options?: { source?: 'code' | 'marketplace' }): void | Promise<void> };

const CODE_ID = 'com.example.source.code';
const MARKET_ID = 'com.example.source.market';
const BUNDLE_A = 'com.example.source.bundle';
const BUNDLE_B = 'com.example.source.bundle.extra';

const body = (id: string, namespace: string) => ({ id, name: namespace, namespace, version: '1.0.0', type: 'app' });

const kernels: ObjectKernel[] = [];

/** Boot a kernel whose one plugin registers `steps` through the `manifest` service in `init()`. */
async function boot(steps: Array<[unknown, { source?: 'code' | 'marketplace' } | undefined]>): Promise<ObjectQL> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  kernels.push(kernel);
  await kernel.use(new ObjectQLPlugin());
  await kernel.use({
    name: 'test.package-source.registrar',
    dependencies: ['com.objectstack.engine.objectql'],
    init: async (ctx: PluginContext) => {
      const manifest = ctx.getService<ManifestService>('manifest');
      for (const [artifact, options] of steps) await manifest.register(artifact, options);
    },
  } as Plugin);
  await kernel.bootstrap();
  return kernel.getService<ObjectQL>('objectql');
}

const sourceOf = (ql: ObjectQL, id: string) => (ql.registry.getPackage(id) as { source?: unknown } | undefined)?.source;

afterEach(async () => {
  while (kernels.length) {
    const kernel = kernels.pop()!;
    if (kernel.getState() === 'running') await kernel.shutdown();
  }
});

describe('the manifest service stamps the registering caller\'s source (#23972)', () => {
  it('a package registered by code, with no source stated, records source code', async () => {
    const ql = await boot([[body(CODE_ID, 'srccode'), undefined]]);
    expect(sourceOf(ql, CODE_ID)).toBe('code');
  });

  it('a package the marketplace registers records source marketplace', async () => {
    const ql = await boot([
      [body(CODE_ID, 'srccode'), undefined],
      [body(MARKET_ID, 'srcmarket'), { source: 'marketplace' }],
    ]);
    expect(sourceOf(ql, MARKET_ID)).toBe('marketplace');
    // CONTROL: the code package registered beside it keeps its own origin.
    expect(sourceOf(ql, CODE_ID)).toBe('code');
  });

  it('every package of a multi-package marketplace artifact records source marketplace', async () => {
    const artifact = {
      ...body(BUNDLE_A, 'srcbundle'),
      packages: [{ manifest: body(BUNDLE_A, 'srcbundle') }, { manifest: body(BUNDLE_B, 'srcbundlex') }],
    };
    const ql = await boot([[artifact, { source: 'marketplace' }]]);
    expect([sourceOf(ql, BUNDLE_A), sourceOf(ql, BUNDLE_B)]).toEqual(['marketplace', 'marketplace']);
  });

  it('registerApp refuses `authored` — an authored package is installed, not registered here — and records nothing', async () => {
    const ql = await boot([]);
    expect(() => ql.registerApp(body(MARKET_ID, 'srcmarket'), undefined, 'authored' as never)).toThrow(TypeError);
    expect(ql.registry.getPackage(MARKET_ID)).toBeUndefined();
  });
});

describe('SchemaRegistry.installPackage requires the origin and refuses an unknown one (#23972)', () => {
  it('records the source it is handed on the row', () => {
    const registry = new SchemaRegistry({ logLevel: 'silent' } as never);
    for (const [id, source] of [['com.a.one', 'code'], ['com.a.two', 'marketplace'], ['com.a.three', 'authored']] as const) {
      expect(registry.installPackage({ id, name: id, version: '1.0.0', type: 'app' } as never, source).source).toBe(source);
    }
  });

  it('refuses a call that states no source, or a value outside the closed set, and records no row', () => {
    const registry = new SchemaRegistry({ logLevel: 'silent' } as never);
    const manifest = { id: 'com.a.refused', name: 'refused', namespace: 'refused', version: '1.0.0', type: 'app' };
    expect(() => registry.installPackage(manifest as never, undefined as never)).toThrow(TypeError);
    expect(() => registry.installPackage(manifest as never, 'cloud' as never)).toThrow(TypeError);
    expect(registry.getPackage('com.a.refused')).toBeUndefined();
    // Refused ahead of every mutation: the namespace was not claimed either.
    expect(registry.getNamespaceOwners('refused')).toEqual([]);
  });
});
