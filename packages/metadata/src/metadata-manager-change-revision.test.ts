// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34206, ADR-0156 D2 and D5] The two readings a shared compile cache keys on
 * this manager with:
 *
 *  - `MetadataManager#revision`, moved by every in-process path that changes
 *    what `get` / `getDiagnosed` / `list` answer (a register, an unregister, a
 *    new loader, a new type registry), and left alone by a read;
 *  - `MetadataManager#loaderChangeMark()`, the confirmation's reading of what
 *    another process can change: each non-memory loader's own `changeMark()`,
 *    or `undefined` when a loader keeps none;
 *  - `FilesystemLoader#changeMark()`, which moves on a file created in a type
 *    directory a read probed (a remembered miss would now hit) and on an edit
 *    of a file a read resolved, and not on a directory no read looked in.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { MetadataManager } from './metadata-manager.js';
import { FilesystemLoader } from './loaders/filesystem-loader.js';
import { JSONSerializer } from './serializers/json-serializer.js';
import type { MetadataLoader } from './loaders/loader-interface.js';

vi.mock('@objectstack/core', async (orig) => ({
  ...((await orig()) as object),
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

function readOnlyLoader(name: string, protocol: string, changeMark?: () => Promise<string>): MetadataLoader {
  return {
    contract: { name, protocol, capabilities: { read: true, write: false, watch: false, list: true } },
    load: async () => ({ data: null }),
    loadMany: async () => [],
    list: async () => [],
    exists: async () => false,
    stat: async () => null,
    ...(changeMark ? { changeMark } : {}),
  } as unknown as MetadataLoader;
}

describe('[#34206] MetadataManager#revision', () => {
  it('moves on register, unregister, a new loader and a new type registry', async () => {
    const mgr = new MetadataManager({});
    const steps: Array<[string, () => unknown]> = [
      ['register', () => mgr.register('view', 'rv_all', { name: 'rv_all', label: 'All' })],
      ['register again', () => mgr.register('view', 'rv_all', { name: 'rv_all', label: 'All, renamed' })],
      ['unregister', () => mgr.unregister('view', 'rv_all')],
      ['registerLoader', () => mgr.registerLoader(readOnlyLoader('extra', 'extra:'))],
      ['setTypeRegistry', () => mgr.setTypeRegistry([])],
    ];
    for (const [label, step] of steps) {
      const before = mgr.revision;
      await step();
      expect(mgr.revision, label).toBeGreaterThan(before);
    }
  });

  it('the store funnel counts on its own: a write that no list-cache drop or announcement follows (a rollback\'s) still moves it', () => {
    const mgr = new MetadataManager({});
    const before = mgr.revision;
    (mgr as unknown as { writeRegistryEntry(t: string, n: string, d: unknown): boolean }).writeRegistryEntry('view', 'rv_all', { name: 'rv_all' });
    expect(mgr.revision).toBeGreaterThan(before);
    const afterWrite = mgr.revision;
    (mgr as unknown as { deleteRegistryEntries(t: string, n: string): void }).deleteRegistryEntries('view', 'rv_all');
    expect(mgr.revision).toBeGreaterThan(afterWrite);
  });

  it('control: a read leaves it alone', async () => {
    const mgr = new MetadataManager({});
    await mgr.register('view', 'rv_all', { name: 'rv_all', label: 'All' });
    const before = mgr.revision;
    expect(await mgr.get('view', 'rv_all')).toMatchObject({ label: 'All' });
    expect((await mgr.getDiagnosed('view', 'rv_all')).data).toMatchObject({ label: 'All' });
    expect(await mgr.get('view', 'rv_none')).toBeUndefined();
    expect(mgr.revision).toBe(before);
  });
});

describe('[#34206] MetadataManager#loaderChangeMark', () => {
  it('a memory loader contributes nothing; a loader with a mark contributes it', async () => {
    const mgr = new MetadataManager({});
    mgr.registerLoader(readOnlyLoader('mem', 'memory:'));
    let mark = 'a';
    mgr.registerLoader(readOnlyLoader('disk', 'file:', async () => mark));
    const first = await mgr.loaderChangeMark();
    expect(first).toBe(JSON.stringify(['disk=a']));
    expect(await mgr.loaderChangeMark()).toBe(first);
    mark = 'b';
    expect(await mgr.loaderChangeMark()).not.toBe(first);
  });

  it('a non-memory loader without a mark, or whose mark throws, makes the answer undefined', async () => {
    const without = new MetadataManager({});
    without.registerLoader(readOnlyLoader('remote', 'https:'));
    expect(await without.loaderChangeMark()).toBeUndefined();

    const throwing = new MetadataManager({});
    throwing.registerLoader(readOnlyLoader('disk', 'file:', async () => { throw new Error('EACCES'); }));
    expect(await throwing.loaderChangeMark()).toBeUndefined();
  });
});

describe('[#34206] FilesystemLoader#changeMark', () => {
  let rootDir: string;
  let loader: FilesystemLoader;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'os-34206-'));
    await fs.mkdir(path.join(rootDir, 'view'), { recursive: true });
    await fs.mkdir(path.join(rootDir, 'app'), { recursive: true });
    await fs.writeFile(path.join(rootDir, 'view', 'rv_all.json'), JSON.stringify({ name: 'rv_all', label: 'All' }));
    loader = new FilesystemLoader(rootDir, new Map([['json', new JSONSerializer()]]) as never);
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  /** Directory mtimes have a coarse grain on some filesystems: step past it. */
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it('moves when a file appears where a read remembered a miss', async () => {
    expect((await loader.load('view', 'rv_later')).data).toBeNull();
    const before = await loader.changeMark();
    expect(await loader.changeMark()).toBe(before);
    await settle();
    await fs.writeFile(path.join(rootDir, 'view', 'rv_later.json'), JSON.stringify({ name: 'rv_later' }));
    expect(await loader.changeMark()).not.toBe(before);
  });

  it('moves when a file a read resolved is edited in place', async () => {
    expect((await loader.load('view', 'rv_all')).data).toMatchObject({ label: 'All' });
    const before = await loader.changeMark();
    await settle();
    await fs.writeFile(path.join(rootDir, 'view', 'rv_all.json'), JSON.stringify({ name: 'rv_all', label: 'All of them' }));
    expect(await loader.changeMark()).not.toBe(before);
  });

  it('moves when a file a read resolved is removed', async () => {
    await loader.load('view', 'rv_all');
    const before = await loader.changeMark();
    await fs.rm(path.join(rootDir, 'view', 'rv_all.json'));
    expect(await loader.changeMark()).not.toBe(before);
  });

  it('the probed type directories are bounded: past the cap the set starts over and the mark moves', async () => {
    await loader.load('view', 'rv_all');
    const before = await loader.changeMark();
    const probed = (loader as unknown as { probedTypeDirs: Set<string> }).probedTypeDirs;
    for (let i = 0; i < 1_000; i += 1) await loader.load(`t${i}`, 'x');
    expect(probed.size).toBeLessThanOrEqual(1_000);
    expect(probed.has(path.join(rootDir, 'view'))).toBe(false);
    expect(await loader.changeMark()).not.toBe(before);
  });

  it('control: a change in a type directory no read probed leaves it alone', async () => {
    await loader.load('view', 'rv_all');
    const before = await loader.changeMark();
    await settle();
    await fs.writeFile(path.join(rootDir, 'app', 'rv_app.json'), JSON.stringify({ name: 'rv_app' }));
    expect(await loader.changeMark()).toBe(before);
  });
});
