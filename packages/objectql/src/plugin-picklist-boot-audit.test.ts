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
import type { ObjectQL } from './engine.js';

/** The slice of the `manifest` service these cases call. */
interface ManifestService {
  register(artifact: unknown): Promise<void> | void;
}

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
      const manifest = ctx.getService<ManifestService>('manifest');
      for (const artifact of artifacts) await manifest.register(artifact);
    },
  };
}

function kernelWith(...plugins: any[]) {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  kernels.push(kernel);
  return { kernel, use: async () => { for (const p of plugins) await kernel.use(p); } };
}

/** The option values a registered object's field is served with. */
const servedValues = (ql: ObjectQL, object: string, field: string): unknown[] =>
  ((ql.registry.getObject(object)?.fields?.[field] as { options?: Array<{ value: unknown }> } | undefined)?.options ?? [])
    .map((o) => o.value);

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

  it('fails the boot on an extension of a list nothing declares', async () => {
    const { kernel, use } = kernelWith(
      new ObjectQLPlugin(),
      registering('ext', [{ id: 'com.test.boot.ext', name: 'ext', picklistExtensions: [{ extend: 'industy', options: [{ label: 'X', value: 'x' }] }] }]),
    );
    await use();
    const err: any = await kernel.bootstrap().then(() => undefined, (e) => e);
    expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
    expect(err.message).toContain("a `picklistExtensions` entry (package 'com.test.boot.ext') extends picklist 'industy'");
  });

  it('boots when the list arrives from a package registered LATER in the same boot', async () => {
    const { kernel, use } = kernelWith(
      new ObjectQLPlugin(),
      registering('app', [{ id: 'com.test.boot.app', name: 'app', objects: [ACCOUNT] }]),
      registering('lists', [{ id: 'com.test.boot.lists', name: 'lists', picklists: [INDUSTRY] }]),
    );
    await use();
    await kernel.bootstrap();
    const ql = kernel.getService<ObjectQL>('objectql');
    expect(servedValues(ql, 'pb_account', 'industry')).toEqual(['technology']);
  });

  it('after the boot, an artifact naming an unknown list is refused before ANY of it registers', async () => {
    const { kernel, use } = kernelWith(new ObjectQLPlugin());
    await use();
    await kernel.bootstrap();
    const manifest = kernel.getService<ManifestService>('manifest');
    expect(() => manifest.register({ id: 'com.test.late', name: 'late', objects: [ACCOUNT] }))
      .toThrow(/field 'pb_account\.industry' \(package 'com\.test\.late'\) references picklist 'industry'/);
    const ql = kernel.getService<ObjectQL>('objectql');
    expect(ql.registry.getObject('pb_account')).toBeUndefined();
  });

  it('after the boot, an artifact extending an unknown list is refused before ANY of it registers', async () => {
    const { kernel, use } = kernelWith(new ObjectQLPlugin());
    await use();
    await kernel.bootstrap();
    const manifest = kernel.getService<ManifestService>('manifest');
    expect(() => manifest.register({ id: 'com.test.late', name: 'late', picklistExtensions: [{ extend: 'industy', options: [{ label: 'X', value: 'x' }] }] }))
      .toThrow(/extends picklist 'industy'/);
    const ql = kernel.getService<ObjectQL>('objectql');
    expect(ql.registry.findOrphanPicklistExtensions()).toEqual([]);
  });

  it('after the boot, an artifact that brings its own list — or names a registered one — registers', async () => {
    const { kernel, use } = kernelWith(new ObjectQLPlugin(), registering('lists', [{ id: 'com.test.boot.lists', name: 'lists', picklists: [INDUSTRY] }]));
    await use();
    await kernel.bootstrap();
    const manifest = kernel.getService<ManifestService>('manifest');
    await manifest.register({ id: 'com.test.late', name: 'late', objects: [ACCOUNT] });
    await manifest.register({
      id: 'com.test.late2', name: 'late2',
      picklists: [{ name: 'tier', label: 'Tier', options: [{ label: 'Gold', value: 'gold' }] }],
      objects: [{ name: 'pb_member', fields: { tier: { name: 'tier', type: 'select', picklist: 'tier' } } }],
    });
    const ql = kernel.getService<ObjectQL>('objectql');
    expect(servedValues(ql, 'pb_account', 'industry')).toEqual(['technology']);
    expect(servedValues(ql, 'pb_member', 'tier')).toEqual(['gold']);
  });
});
