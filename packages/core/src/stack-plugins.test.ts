// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22301 — the ONE rule for what an entry of a stack's own `plugins` array
 * becomes, read by `os serve` and by `@objectstack/verify`'s `bootStack`. One
 * case per shape of the rule; the loaders are injected, so each case also
 * proves which loader the shape reaches and that the others are not touched.
 */

import { describe, expect, it } from 'vitest';
import { materializeStackPlugin, type StackPluginLoaders } from './stack-plugins.js';

/** Loaders that record what they were asked, answering fixed values. */
function recordingLoaders(module: unknown): StackPluginLoaders & { imported: string[]; wrapped: unknown[] } {
  const imported: string[] = [];
  const wrapped: unknown[] = [];
  return {
    imported,
    wrapped,
    async importSpecifier(specifier) {
      imported.push(specifier);
      return module;
    },
    wrapBundle(bundle) {
      wrapped.push(bundle);
      return { wrappedBundle: bundle };
    },
  };
}

describe('materializeStackPlugin — the shared rule for one `plugins` entry', () => {
  it('an instance (it has `init`) is the plugin, as written — no loader runs', async () => {
    const instance = { name: 'com.example.instance', init: async () => {} };
    const loaders = recordingLoaders(undefined);
    expect(await materializeStackPlugin(instance, loaders)).toBe(instance);
    expect(loaders.imported).toEqual([]);
    expect(loaders.wrapped).toEqual([]);
  });

  it('a plain bundle (no `init`) is handed to the boot\'s wrap, and the wrap\'s answer is the plugin', async () => {
    const bundle = { manifest: { id: 'com.example.bundle' }, objects: [] };
    const loaders = recordingLoaders(undefined);
    expect(await materializeStackPlugin(bundle, loaders)).toEqual({ wrappedBundle: bundle });
    expect(loaders.wrapped).toEqual([bundle]);
    expect(loaders.imported).toEqual([]);
  });

  it('a string is a specifier: loaded by the boot, and the module\'s default export is the plugin', async () => {
    const plugin = { name: 'com.example.loaded', init: async () => {} };
    const loaders = recordingLoaders({ default: plugin });
    expect(await materializeStackPlugin('@example/plugin', loaders)).toBe(plugin);
    expect(loaders.imported).toEqual(['@example/plugin']);
    expect(loaders.wrapped).toEqual([]);
  });

  it('a loaded module with no default export is itself the plugin — and a bundle-shaped one is wrapped', async () => {
    const module = { manifest: { id: 'com.example.module-bundle' } };
    const loaders = recordingLoaders(module);
    expect(await materializeStackPlugin('@example/bundle', loaders)).toEqual({ wrappedBundle: module });
    expect(loaders.wrapped).toEqual([module]);
  });

  it('a loader that cannot load the specifier fails the call — the boot decides how loud', async () => {
    const loaders: StackPluginLoaders = {
      importSpecifier: async (specifier) => {
        throw new Error(`cannot load ${specifier}`);
      },
      wrapBundle: (bundle) => bundle,
    };
    await expect(materializeStackPlugin('@example/missing', loaders)).rejects.toThrow('@example/missing');
  });
});
