// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27123 slice 2] `os serve`'s half of the installed-plugin boot, against a
 * stand-in loader and kernel: what the loader verifies is pinned in
 * `@objectstack/runtime`'s own suite, and the real boot in
 * `test/serve-installed-plugins.integration.test.ts`.
 *
 * Pinned: a loader that throws outright, whatever it throws, is one
 * `loader_failed` refusal and the boot goes on with no installed plugin; a
 * plugin whose name cannot be read, or that `kernel.use` refuses, is refused by
 * name whatever was thrown (`undefined` and `null` included), and the next
 * plugin is still registered; a name the boot already holds is not replaced.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const stub = vi.hoisted(() => ({
  installationsFile: '',
  load: null as null | (() => Promise<unknown>),
}));

vi.mock('@objectstack/runtime', () => ({
  pluginInstallationsFile: () => stub.installationsFile,
  loadInstalledPlugins: () => (stub.load as () => Promise<unknown>)(),
  AppPlugin: class {},
}));
vi.mock('./plugin-install.js', () => ({ pluginEnvironmentId: () => 'env_local' }));
vi.mock('./plugin-trust-read.js', () => ({ readTrustedKeys: async () => ({ ok: true, keys: new Map() }) }));
vi.mock('./format.js', () => ({ isExitSignal: () => false }));

import { registerInstalledPlugins } from './installed-plugins-boot.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-installed-plugins-boot-'));
  stub.installationsFile = join(dir, 'installations.json');
  writeFileSync(stub.installationsFile, '{"installations":[]}');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  stub.load = null;
  rmSync(dir, { recursive: true, force: true });
});

function record(id: string) {
  return { id, version: '1.0.0', trustUnsigned: false };
}

function kernel(opts: { use?: (plugin: unknown) => Promise<unknown>; taken?: string[] } = {}) {
  const used: unknown[] = [];
  return {
    used,
    use: async (plugin: unknown) => {
      if (opts.use) await opts.use(plugin);
      used.push(plugin);
    },
    hasPlugin: (name: string) => (opts.taken ?? []).includes(name),
  };
}

const boot = (k: ReturnType<typeof kernel>) => registerInstalledPlugins({ kernel: k as never, track: () => {} });

describe('the serve wiring of installed plugins', () => {
  it.each([
    ['an Error', new Error('the records walk broke'), 'the records walk broke'],
    ['undefined', undefined, 'undefined'],
    ['null', null, 'null'],
  ])('a loader that throws %s is one loader_failed refusal, and nothing is registered', async (_label, thrown, said) => {
    stub.load = async () => { throw thrown; };
    const k = kernel();
    const out = await boot(k);
    expect(out).toEqual({
      loaded: [],
      refused: [{ id: '*', version: '*', error: 'loader_failed', message: expect.stringContaining(`(${said})`) }],
    });
    expect(k.used).toEqual([]);
  });

  it('a plugin whose name cannot be read, or that kernel.use refuses with null, is refused by name; the next one is registered', async () => {
    const nameless = { init() {}, get name(): string { throw undefined; } };
    const refusedByKernel = { name: 'refused-by-kernel', init() {} };
    const fine = { name: 'fine', init() {} };
    stub.load = async () => ({
      loaded: [
        { record: record('com.acme.nameless'), plugin: nameless },
        { record: record('com.acme.refused'), plugin: refusedByKernel },
        { record: record('com.acme.fine'), plugin: fine },
      ],
      refused: [],
      disabled: [],
      removed: [],
    });
    const k = kernel({ use: async (plugin) => { if (plugin === refusedByKernel) throw null; } });
    const out = await boot(k);
    expect(out?.refused).toEqual([
      { id: 'com.acme.nameless', version: '1.0.0', error: 'kernel_refused', message: 'its plugin name cannot be read: undefined' },
      { id: 'com.acme.refused', version: '1.0.0', error: 'kernel_refused', message: 'null' },
    ]);
    expect(out?.loaded).toEqual(['com.acme.fine@1.0.0']);
    expect(k.used).toEqual([fine]);
  });

  it('an installed plugin never replaces one the boot already registered under its name', async () => {
    stub.load = async () => ({
      loaded: [{ record: record('com.acme.dup'), plugin: { name: 'host-plugin', init() {} } }],
      refused: [],
      disabled: [],
      removed: [],
    });
    const k = kernel({ taken: ['host-plugin'] });
    const out = await boot(k);
    expect(out?.refused).toEqual([expect.objectContaining({ id: 'com.acme.dup', error: 'plugin_name_taken' })]);
    expect(k.used).toEqual([]);
  });

  it('reads nothing when this project has no installations file', async () => {
    rmSync(stub.installationsFile);
    stub.load = async () => { throw new Error('the loader ran'); };
    expect(await boot(kernel())).toBeNull();
  });
});
