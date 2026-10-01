// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A field naming a picklist no package declares is a LOAD-TIME error that
 * names the field and the package — never a select served with no options.
 *
 * Judged at `kernel:ready`, when every package has registered: a list another
 * package declares later in the same boot must not read as missing (AGENTS.md,
 * startup registry reads). After that the vocabulary is sealed, and an
 * artifact registered through the `manifest` service is judged before any of
 * it registers.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';

const kernels: ObjectKernel[] = [];
afterEach(async () => {
  while (kernels.length) {
    const kernel = kernels.pop()!;
    try { if (kernel.getState() === 'running') await kernel.shutdown(); } catch { /* noop */ }
  }
});

/** A plugin that registers each artifact through the `manifest` service during init. */
function registering(name: string, artifacts: unknown[]) {
  return {
    name,
    dependencies: ['com.objectstack.engine.objectql'],
    init: async (ctx: PluginContext) => {
      const manifest = ctx.getService<{ register(a: unknown): unknown }>('manifest');
      for (const artifact of artifacts) await manifest.register(artifact);
    },
  };
}

function kernelWith(...plugins: any[]) {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  kernels.push(kernel);
  return { kernel, use: async () => { for (const p of plugins) await kernel.use(p); } };
}

const INDUSTRY = { name: 'industry', label: 'Industry', options: [{ label: 'Technology', value: 'technology' }] };
const ACCOUNT = {
  name: 'pb_account',
  fields: { industry: { name: 'industry', type: 'select', picklist: 'industry' } },
};

describe('the picklist boot audit', () => {
  it('fails the boot naming the field and the package', async () => {
    const { kernel, use } = kernelWith(new ObjectQLPlugin(), registering('app', [{ id: 'com.test.boot.app', name: 'app', objects: [ACCOUNT] }]));
    await use();
    const err: any = await kernel.bootstrap().then(() => undefined, (e) => e);
    expect(err).toBeDefined();
    expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
    expect(err.message).toContain("field 'pb_account.industry' (package 'com.test.boot.app') references picklist 'industry'");
  });

  it('boots when the list arrives from a package registered LATER in the same boot', async () => {
    const { kernel, use } = kernelWith(
      new ObjectQLPlugin(),
      registering('app', [{ id: 'com.test.boot.app', name: 'app', objects: [ACCOUNT] }]),
      registering('lists', [{ id: 'com.test.boot.lists', name: 'lists', picklists: [INDUSTRY] }]),
    );
    await use();
    await kernel.bootstrap();
    const ql: any = kernel.getService('objectql');
    expect(ql.registry.getObject('pb_account').fields.industry.options.map((o: any) => o.value)).toEqual(['technology']);
  });

  it('after the boot, an artifact naming an unknown list is refused before ANY of it registers', async () => {
    const { kernel, use } = kernelWith(new ObjectQLPlugin());
    await use();
    await kernel.bootstrap();
    const manifest: any = kernel.getService('manifest');
    expect(() => manifest.register({ id: 'com.test.late', name: 'late', objects: [ACCOUNT] }))
      .toThrow(/field 'pb_account\.industry' \(package 'com\.test\.late'\) references picklist 'industry'/);
    const ql: any = kernel.getService('objectql');
    expect(ql.registry.getObject('pb_account')).toBeUndefined();
  });

  it('after the boot, an artifact that brings its own list — or names a registered one — registers', async () => {
    const { kernel, use } = kernelWith(new ObjectQLPlugin(), registering('lists', [{ id: 'com.test.boot.lists', name: 'lists', picklists: [INDUSTRY] }]));
    await use();
    await kernel.bootstrap();
    const manifest: any = kernel.getService('manifest');
    await manifest.register({ id: 'com.test.late', name: 'late', objects: [ACCOUNT] });
    await manifest.register({
      id: 'com.test.late2', name: 'late2',
      picklists: [{ name: 'tier', label: 'Tier', options: [{ label: 'Gold', value: 'gold' }] }],
      objects: [{ name: 'pb_member', fields: { tier: { name: 'tier', type: 'select', picklist: 'tier' } } }],
    });
    const ql: any = kernel.getService('objectql');
    expect(ql.registry.getObject('pb_account').fields.industry.options.map((o: any) => o.value)).toEqual(['technology']);
    expect(ql.registry.getObject('pb_member').fields.tier.options.map((o: any) => o.value)).toEqual(['gold']);
  });
});
