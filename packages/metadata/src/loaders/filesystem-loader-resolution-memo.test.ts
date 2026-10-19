// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24537 — `FilesystemLoader.findFile` remembers what it resolved, so a
 * request stops probing the filesystem.
 *
 * ---------------------------------------------------------------------------
 * The cost (measured on `origin/main` @ 2667e2402, the first case below)
 * ---------------------------------------------------------------------------
 * `plugin-security`'s catalog read (`createSecurityCatalogReader().resolve`)
 * asks the metadata service for every held permission set the engine registry
 * does not serve, on every authenticated request. That falls through
 * `MetadataManager.getDiagnosed` to `FilesystemLoader.load`, and `findFile`
 * probed one `fs.access` per resolvable extension, every time:
 *
 *   a name no file holds   5 probes per resolution, every resolution
 *   a name a file holds    2 probes per resolution (`load` and `stat` each
 *                          resolved it), every resolution
 *
 * The miss is the common case: an artifact-mode runtime has no
 * `ROOT/permission/*.json` at all.
 *
 * ---------------------------------------------------------------------------
 * What retires a remembered answer, and the case that pins each
 * ---------------------------------------------------------------------------
 *   the loader's own write (`save`)            "a save through the loader …"
 *   the watcher's re-read (`added` event,      "an `added` file event …"
 *     `useCache: false`)
 *   a remembered path found gone on read       "an `unlink` event …",
 *     (`unlink` event, or no event at all)     "a deletion nothing reported …"
 *   the loader's own walk of the type          "RECORD: a file created with no
 *                                                watcher …"
 *   a probe already on disk when it retires    "a probe that was on disk …"
 *
 * `RECORD:` pins the one change no event reaches — a file another process
 * creates under the root while no watcher runs (`watch: false`, every shipped
 * composition) — so the gap is visible in a diff rather than implicit. It is
 * closed by the next walk of that type, which is also what keeps a name
 * `list()` reports from being answered `null` by `get()`.
 *
 * Writing a permission set never reaches this memo at all: a definition saved
 * through the metadata protocol lands in the engine registry, which the catalog
 * read asks first, and `register()` lands in the manager's registry, which
 * `getDiagnosed` asks before any loader. The two "writing a permission set"
 * cases pin that a remembered miss cannot hide either.
 *
 * Probes are counted at `node:fs/promises.access`, the call `findFile` makes,
 * for paths under this test's root only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';

const { probes, logger } = vi.hoisted(() => ({
  probes: {
    paths: [] as string[],
    /** Holds ONE probe of `path` after it has read the disk, until released. */
    hold: undefined as undefined | { path: string; reached: () => void; release: Promise<void> },
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    access: async (target: Parameters<typeof actual.access>[0], mode?: number) => {
      const probed = String(target);
      probes.paths.push(probed);

      let failure: unknown;
      let failed = false;
      try {
        await actual.access(target, mode);
      } catch (error) {
        failed = true;
        failure = error;
      }

      const hold = probes.hold;
      if (hold && probed === hold.path) {
        probes.hold = undefined;
        hold.reached();
        await hold.release;
      }

      if (failed) throw failure;
    },
  };
});

vi.mock('@objectstack/core', async (orig) => ({
  // Spread the REAL module: the catalog reader under test comes from it.
  ...((await orig()) as object),
  createLogger: () => logger,
}));

import * as fs from 'node:fs/promises';
import type { MetadataFormat } from '@objectstack/spec/system';
import { createSecurityCatalogReader, type SecurityCatalogReader } from '@objectstack/core';
import { NodeMetadataManager } from '../node-metadata-manager.js';
import { FilesystemLoader } from './filesystem-loader.js';
import { JSONSerializer } from '../serializers/json-serializer.js';
import type { MetadataSerializer } from '../serializers/serializer-interface.js';

/** The format set `MetadataPlugin` constructs its manager with. */
const PLUGIN_FORMATS: MetadataFormat[] = ['yaml', 'json', 'typescript', 'javascript'];
/** …and the extensions `findFile` probes under it, in precedence order. */
const PLUGIN_EXTENSIONS = ['.json', '.yaml', '.yml', '.ts', '.js'];

let rootDir: string;
const managers: NodeMetadataManager[] = [];

beforeEach(async () => {
  vi.clearAllMocks();
  probes.paths.length = 0;
  probes.hold = undefined;
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'os-24537-'));
});

afterEach(async () => {
  for (const mgr of managers.splice(0)) await mgr.stopWatching();
  await fs.rm(rootDir, { recursive: true, force: true });
});

const permissionSet = (name: string, label = name) => ({ name, label, objects: {} });

async function writeSetFile(name: string, body: object = permissionSet(name), ext = '.json'): Promise<string> {
  const dir = path.join(rootDir, 'permission');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${name}${ext}`);
  await fs.writeFile(filePath, ext === '.json' ? JSON.stringify(body) : `name: ${name}\nlabel: ${(body as { label?: string }).label ?? name}\n`, 'utf-8');
  return filePath;
}

/** The plugin's manager over `rootDir`: no loaders given, so the default FilesystemLoader. */
function makeManager(): NodeMetadataManager {
  const mgr = new NodeMetadataManager({ rootDir, watch: false, formats: PLUGIN_FORMATS });
  managers.push(mgr);
  return mgr;
}

/** An engine registry that serves `held` only — empty unless a case writes to it. */
function makeRegistry(held: Map<string, Record<string, unknown>> = new Map()) {
  return {
    getItem: (_type: string, name: string) => held.get(name),
    listItems: () => [...held.values()],
    isPackageDisabled: () => false,
  };
}

function makeCatalog(mgr: NodeMetadataManager, held?: Map<string, Record<string, unknown>>): SecurityCatalogReader {
  return createSecurityCatalogReader({ registry: makeRegistry(held), metadata: mgr as never });
}

/** `fs.access` probes made under this test's root since the last call. */
function probesSince(mark: { at: number }): number {
  const count = probes.paths.slice(mark.at).filter((p) => p.startsWith(rootDir)).length;
  mark.at = probes.paths.length;
  return count;
}

/** Probes per resolution, over `times` resolutions of `name` by the catalog read. */
async function probesPerResolution(catalog: SecurityCatalogReader, name: string, times = 5): Promise<number[]> {
  const mark = { at: probes.paths.length };
  const counts: number[] = [];
  for (let i = 0; i < times; i++) {
    await catalog.resolve('permission', name);
    counts.push(probesSince(mark));
  }
  return counts;
}

function fireFileEvent(mgr: NodeMetadataManager, eventType: 'added' | 'changed' | 'deleted', filePath: string): Promise<void> {
  return (
    mgr as unknown as { handleFileEvent(t: 'added' | 'changed' | 'deleted', p: string): Promise<void> }
  ).handleFileEvent(eventType, filePath);
}

const statFailureLogs = () => logger.error.mock.calls.filter((call) => call[0] === 'Failed to stat file');

describe('#24537 — repeated resolutions of one name probe the filesystem once', () => {
  it('a name no file holds: one probe per extension on the first resolution, none after', async () => {
    const catalog = makeCatalog(makeManager());

    // On main @ 2667e2402 this read [5, 5, 5, 5, 5].
    expect(await probesPerResolution(catalog, 'miss_set')).toEqual([PLUGIN_EXTENSIONS.length, 0, 0, 0, 0]);
    expect(await catalog.resolve('permission', 'miss_set')).toBeUndefined();
  });

  it('a name a file holds: one probe on the first resolution, none after — and the body is still served', async () => {
    await writeSetFile('hit_set');
    const catalog = makeCatalog(makeManager());

    // On main @ 2667e2402 this read [2, 2, 2, 2, 2].
    expect(await probesPerResolution(catalog, 'hit_set')).toEqual([1, 0, 0, 0, 0]);
    expect(await catalog.resolve('permission', 'hit_set')).toMatchObject({
      name: 'hit_set',
      source: 'metadata',
    });
  });

  it('CONTROL: a remembered path is not remembered CONTENT — an edit to the file is read on the next resolution', async () => {
    const filePath = await writeSetFile('edited_set', permissionSet('edited_set', 'before'));
    const catalog = makeCatalog(makeManager());
    expect((await catalog.resolve('permission', 'edited_set'))?.definition).toMatchObject({ label: 'before' });

    await fs.writeFile(filePath, JSON.stringify(permissionSet('edited_set', 'after')), 'utf-8');

    expect((await catalog.resolve('permission', 'edited_set'))?.definition).toMatchObject({ label: 'after' });
  });

  it('two managers do not share what they remember', async () => {
    const first = makeCatalog(makeManager());
    const second = makeCatalog(makeManager());

    await first.resolve('permission', 'per_kernel_set');
    expect(await probesPerResolution(second, 'per_kernel_set', 1)).toEqual([PLUGIN_EXTENSIONS.length]);
  });
});

describe('#24537 — writing a permission set is seen on the next resolution', () => {
  it('a set written to the engine registry: the registry answers before any loader', async () => {
    const held = new Map<string, Record<string, unknown>>();
    const catalog = makeCatalog(makeManager(), held);
    expect(await catalog.resolve('permission', 'authored_set')).toBeUndefined();

    held.set('authored_set', permissionSet('authored_set'));

    expect(await catalog.resolve('permission', 'authored_set')).toMatchObject({ name: 'authored_set', source: 'registry' });
  });

  it('a set registered with the metadata service: its registry answers before any loader', async () => {
    const mgr = makeManager();
    const catalog = makeCatalog(mgr);
    expect(await catalog.resolve('permission', 'registered_set')).toBeUndefined();

    await mgr.register('permission', 'registered_set', permissionSet('registered_set'));

    expect(await catalog.resolve('permission', 'registered_set')).toMatchObject({
      name: 'registered_set',
      source: 'metadata',
    });
  });

  it('a save through the loader retires a remembered miss', async () => {
    const mgr = makeManager();
    const catalog = makeCatalog(mgr);
    expect(await catalog.resolve('permission', 'saved_set')).toBeUndefined();

    await mgr.save('permission', 'saved_set', permissionSet('saved_set'), { format: 'json' });

    expect(await catalog.resolve('permission', 'saved_set')).toMatchObject({ name: 'saved_set', source: 'metadata' });
  });
});

describe('#24537 — the file watcher retires what it reports', () => {
  it('an `added` file event: its re-read resolves from disk, announces the body, and the next resolution sees it', async () => {
    const mgr = makeManager();
    const catalog = makeCatalog(mgr);
    const announced: unknown[] = [];
    mgr.subscribe('permission', (evt) => { announced.push(evt.data); });
    expect(await catalog.resolve('permission', 'watched_set')).toBeUndefined();

    const filePath = await writeSetFile('watched_set');
    await fireFileEvent(mgr, 'added', filePath);

    // Without the fresh re-read the event would announce `null` for a file
    // that was just added, and the remembered miss would stand.
    expect(announced).toEqual([permissionSet('watched_set')]);
    expect(await catalog.resolve('permission', 'watched_set')).toMatchObject({ name: 'watched_set' });
  });

  it('an `unlink` event: the next resolution finds the remembered path gone and answers the miss — no stat failure logged', async () => {
    const filePath = await writeSetFile('unlinked_set');
    const mgr = makeManager();
    const catalog = makeCatalog(mgr);
    expect(await catalog.resolve('permission', 'unlinked_set')).toMatchObject({ name: 'unlinked_set' });

    await fs.rm(filePath);
    await fireFileEvent(mgr, 'deleted', filePath);

    expect(await catalog.resolve('permission', 'unlinked_set')).toBeUndefined();
    expect(await catalog.resolve('permission', 'unlinked_set')).toBeUndefined();
    expect(await mgr.exists('permission', 'unlinked_set')).toBe(false);
    expect(statFailureLogs()).toEqual([]);
  });
});

describe('#24537 — changes no event reports', () => {
  it('a deletion nothing reported: the remembered path is re-resolved from disk, whatever it holds now', async () => {
    const jsonPath = await writeSetFile('moved_set', permissionSet('moved_set', 'from json'));
    const mgr = makeManager();
    const catalog = makeCatalog(mgr);
    expect((await catalog.resolve('permission', 'moved_set'))?.definition).toMatchObject({ label: 'from json' });

    await fs.rm(jsonPath);
    await writeSetFile('moved_set', permissionSet('moved_set', 'from yaml'), '.yaml');

    expect((await catalog.resolve('permission', 'moved_set'))?.definition).toMatchObject({ label: 'from yaml' });
    expect(await mgr.exists('permission', 'moved_set')).toBe(true);
    expect(statFailureLogs()).toEqual([]);
  });

  it('RECORD: a file created with no watcher is unseen by a remembered miss until the next walk of its type', async () => {
    const mgr = makeManager();
    const catalog = makeCatalog(mgr);
    expect(await catalog.resolve('permission', 'dropped_set')).toBeUndefined();

    await writeSetFile('dropped_set');

    // The named gap: nothing reported the file, so the remembered miss stands.
    expect(await catalog.resolve('permission', 'dropped_set')).toBeUndefined();

    // The walk behind `list()` sees the file — and retires the type, so the
    // name it lists is not answered `null` by the door.
    expect((await mgr.list('permission')).map((item) => (item as { name: string }).name)).toEqual(['dropped_set']);
    expect(await catalog.resolve('permission', 'dropped_set')).toMatchObject({ name: 'dropped_set' });
  });
});

describe('#24537 — what the memo holds', () => {
  const jsonOnly = () =>
    new FilesystemLoader(rootDir, new Map<MetadataFormat, MetadataSerializer>([['json', new JSONSerializer()]]), logger as never);

  it('a probe that was on disk when a save retired the memo does not write its older miss back', async () => {
    const loader = jsonOnly();
    const target = path.join(rootDir, 'permission', 'late_set.json');
    let reached!: () => void;
    let release!: () => void;
    const onDisk = new Promise<void>((resolve) => { reached = resolve; });
    probes.hold = { path: target, reached, release: new Promise<void>((resolve) => { release = resolve; }) };

    // This load's probe has already read "absent" when the save lands.
    const pending = loader.load('permission', 'late_set');
    await onDisk;
    await loader.save('permission', 'late_set', permissionSet('late_set'), { format: 'json' });
    release();
    expect((await pending).data).toBeNull();

    expect((await loader.load('permission', 'late_set')).data).toEqual(permissionSet('late_set'));
  });

  it('is bounded: past the cap it starts over rather than growing with every name a caller asks for', async () => {
    const loader = jsonOnly();
    const cap = 'RESOLUTION_MEMO_CAP';
    const original = Reflect.get(FilesystemLoader, cap);
    Reflect.set(FilesystemLoader, cap, 3);
    try {
      const mark = { at: probes.paths.length };
      for (const name of ['a', 'b', 'c']) await loader.exists('permission', name);
      probesSince(mark);

      await loader.exists('permission', 'a');
      expect(probesSince(mark)).toBe(0);           // three remembered, `a` among them

      await loader.exists('permission', 'd');      // the fourth: starts over
      probesSince(mark);
      await loader.exists('permission', 'a');
      expect(probesSince(mark)).toBe(1);           // `a` was dropped with the rest
    } finally {
      Reflect.set(FilesystemLoader, cap, original);
    }
  });
});
