// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13726] The `storage/test` probe cleans up in the store it WROTE to.
 *
 * The handler exists so an operator can validate credentials that are typed
 * into the form but not yet saved, so when the form posts values it builds a
 * TEMPORARY adapter and probes that instead of the persisted one. Two paths
 * left the probe object behind:
 *
 *   1. the failure cleanup deleted from `proxy` — the PERSISTED adapter —
 *      while the probe had written to the temporary one. Deleting an absent
 *      key is a no-op on both shipped adapters, so the wrong-store delete
 *      "succeeded" and nothing looked wrong;
 *   2. the content-mismatch `return` walked straight past the delete on the
 *      next line, after an upload that by definition had already succeeded —
 *      a guaranteed leak rather than a best-effort one.
 *
 * ⚠️ Both credential cases are pinned SEPARATELY, and only one of the two
 * directions can catch defect 1: with no overrides `target === proxy`, so the
 * old code deleted from the right store by accident and a single-direction pin
 * passes on the defect. The case that matters is a failed probe WITH edited
 * credentials.
 *
 * ## How a failure is induced
 *
 * Every store below is a REAL `LocalStorageAdapter` on its own directory, with
 * exactly one verb overridden (`Object.create`, so every other member stays the
 * real one). PUT allowed / GET refused is the ordinary shape of a half-right
 * credential, and it is what makes the leak observable: the bytes really land
 * on disk, and then the probe really fails. The assertions are therefore about
 * the FILESYSTEM — what is left under `__objectstack_probe__/` when the handler
 * returns — not about a call counter that could agree with a store nobody
 * wrote to.
 *
 * ⚠️ Two cases below are CONTROLS, not pins, and are labelled: they are green
 * in both directions by construction (the pre-repair code already deleted from
 * the right store when there were no overrides, and already attempted no
 * cleanup when the adapter failed to build). They are here so the pins cannot
 * pass on a handler that deletes from everything, or on one that cleans up
 * after a store it never wrote to. ⛔ Not ablation evidence.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IStorageService } from '@objectstack/spec/contracts';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { StorageServicePlugin } from './storage-service-plugin.js';
import type { SwappableStorageService } from './swappable-storage-service.js';

const PROBE_PREFIX = '__objectstack_probe__';
const CLEANUP_HEADLINE = 'was NOT removed';
const MISMATCH_MESSAGE = 'Probe download did not match upload.';

function makeCtx() {
  const services = new Map<string, unknown>();
  const hooks: Array<() => Promise<void> | void> = [];
  const logs: { info: string[]; warn: string[]; error: string[] } = { info: [], warn: [], error: [] };
  const ctx: any = {
    logger: {
      info: (m: string) => { logs.info.push(String(m)); },
      warn: (m: string) => { logs.warn.push(String(m)); },
      error: (m: string) => { logs.error.push(String(m)); },
    },
    _logs: logs,
    registerService: (name: string, svc: unknown) => { services.set(name, svc); },
    getService: <T>(name: string): T => {
      const s = services.get(name);
      if (!s) throw new Error(`service '${name}' not registered`);
      return s as T;
    },
    hook: (event: string, fn: () => Promise<void> | void) => {
      if (event === 'kernel:ready') hooks.push(fn);
    },
    _flushReady: async () => { for (const h of hooks) await h(); },
  };
  return ctx;
}

/** A settings service that keeps the registered action so a test can run it. */
function makeFakeSettings() {
  const actions = new Map<string, (input: unknown) => Promise<any>>();
  return {
    createClient: (_ns: string) => ({}),
    getNamespace: async (_ns: string) => ({ values: {} }),
    subscribe: (_ns: string, _fn: () => void) => {},
    registerAction: (ns: string, id: string, fn: (input: unknown) => Promise<any>) => {
      actions.set(`${ns}/${id}`, fn);
    },
    _runAction: async (ns: string, id: string, input: unknown) => {
      const fn = actions.get(`${ns}/${id}`);
      if (!fn) throw new Error(`no action ${ns}/${id}`);
      return await fn(input);
    },
  };
}

async function tmpRoot(prefix: string): Promise<string> {
  return await fs.mkdtemp(join(tmpdir(), prefix));
}

/** A real local adapter rooted at `rootDir` — the store, not a stand-in. */
function localAdapterAt(rootDir: string): IStorageService {
  return new LocalStorageAdapter({ rootDir, basePath: '/api/v1/storage' });
}

/**
 * The real store with ONE verb replaced. `Object.create` rather than a
 * hand-written stand-in, deliberately: every member this test does not name
 * stays the adapter's own, so a probe object written through the wrapper is a
 * real file and the assertions can read the filesystem.
 */
function withRefusedDownload(real: IStorageService, message: string): IStorageService {
  const store: IStorageService = Object.create(real);
  store.download = async () => { throw new Error(message); };
  return store;
}

function withMangledDownload(real: IStorageService): IStorageService {
  const store: IStorageService = Object.create(real);
  store.download = async () => Buffer.from('not-what-was-uploaded', 'utf-8');
  return store;
}

function withRefusedDelete(real: IStorageService, message: string): IStorageService {
  const store: IStorageService = Object.create(real);
  store.delete = async () => { throw new Error(message); };
  return store;
}

/** The real store, recording every key it is ASKED to delete. */
function withCountedDeletes(real: IStorageService): { store: IStorageService; deleted: string[] } {
  const deleted: string[] = [];
  const store: IStorageService = Object.create(real);
  store.delete = async (key: string) => { deleted.push(key); await real.delete(key); };
  return { store, deleted };
}

/** Probe objects currently on disk under `rootDir`. */
async function probeObjectsIn(rootDir: string): Promise<string[]> {
  try {
    return (await fs.readdir(join(rootDir, PROBE_PREFIX))).sort();
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * The factory the handler calls when the form posts values, substituted so a
 * test can hand it a store whose behaviour it controls.
 *
 * Named as a seam rather than reached for with `as any`: `buildAdapterFromValues`
 * itself is covered by its own tests (`storage-service-plugin.metrics.test.ts`
 * and the S3-misconfiguration case in `storage-service-plugin.test.ts`), and
 * what is under test HERE is which store the handler cleans up in — not how the
 * temporary one is constructed.
 */
interface AdapterFactorySeam {
  buildAdapterFromValues(values: Record<string, unknown>): Promise<IStorageService>;
}

function substituteAdapterFactory(
  plugin: StorageServicePlugin,
  temporary: IStorageService,
): Array<Record<string, unknown>> {
  const calls: Array<Record<string, unknown>> = [];
  const seam = plugin as unknown as AdapterFactorySeam;
  seam.buildAdapterFromValues = async (values: Record<string, unknown>) => {
    calls.push(values);
    return temporary;
  };
  return calls;
}

async function bootedPlugin(persistedRoot: string) {
  const plugin = new StorageServicePlugin({
    adapter: 'local',
    local: { rootDir: persistedRoot },
    registerRoutes: false,
  });
  const ctx = makeCtx();
  const settings = makeFakeSettings();
  ctx.registerService('settings', settings);
  await plugin.init(ctx);
  await plugin.start(ctx);
  await ctx._flushReady();
  // Typed here rather than at the call site: the fake ctx is `any`, so
  // `ctx.getService<T>(…)` would be a type argument on an untyped call.
  const storage: SwappableStorageService = ctx.getService('storage');
  return { plugin, ctx, settings, storage };
}

/** The shape the settings form posts when the operator edited the fields. */
function editedCredentials(localRoot: string) {
  return { values: {}, payload: { values: { adapter: 'local', local_root: localRoot } } };
}

describe('#13726 defect 1 — the failure cleanup names the store the probe wrote to', () => {
  it('a failed probe with EDITED credentials leaves nothing behind in the TEMPORARY store', async () => {
    const persistedRoot = await tmpRoot('oss-13726-persisted-');
    const temporaryRoot = await tmpRoot('oss-13726-temporary-');
    const { plugin, ctx, settings, storage } = await bootedPlugin(persistedRoot);

    // The persisted store, watching for deletes it should never be asked for.
    const persisted = withCountedDeletes(localAdapterAt(persistedRoot));
    storage.swap(persisted.store);

    // The store the edited credentials build: a different directory, and a GET
    // that is refused after the PUT has already landed the bytes.
    const temporary = withRefusedDownload(
      localAdapterAt(temporaryRoot),
      'download refused: GET denied for this key',
    );
    const calls = substituteAdapterFactory(plugin, temporary);

    const result = await settings._runAction('storage', 'test', editedCredentials(temporaryRoot));

    // The temporary-adapter branch really ran — without it this pin would be
    // measuring the no-overrides case under an overrides-shaped name.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ adapter: 'local', local_root: temporaryRoot });

    // THE PIN: the store the probe wrote to holds nothing afterwards.
    expect(await probeObjectsIn(temporaryRoot)).toEqual([]);

    // …and the persisted store was neither written to nor asked to delete: the
    // old cleanup issued a delete here, against a key this store never held.
    expect(await probeObjectsIn(persistedRoot)).toEqual([]);
    expect(persisted.deleted).toEqual([]);

    // ⛔ What the operator is told is unchanged by the repair.
    expect(result.ok).toBe(false);
    expect(result.severity).toBe('error');
    expect(result.message).toBe('download refused: GET denied for this key');
    // The cleanup succeeded, so #12981's refusal line stays quiet.
    expect(ctx._logs.warn.join('\n')).not.toContain(CLEANUP_HEADLINE);
  });

  // ⚠️ CONTROL, not a pin — green in BOTH directions. With no overrides
  // `target === proxy`, so the pre-repair `proxy.delete` was already the right
  // store. It is here so the pin above cannot pass on a handler that stopped
  // cleaning up the persisted store when it repaired the temporary one.
  it('CONTROL: a failed probe with NO edited credentials leaves nothing behind in the PERSISTED store', async () => {
    const persistedRoot = await tmpRoot('oss-13726-persisted-only-');
    const { ctx, settings, storage } = await bootedPlugin(persistedRoot);

    storage.swap(withRefusedDownload(localAdapterAt(persistedRoot), 'download refused: GET denied'));

    const result = await settings._runAction('storage', 'test', { values: {} });

    expect(await probeObjectsIn(persistedRoot)).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.message).toBe('download refused: GET denied');
    expect(ctx._logs.warn.join('\n')).not.toContain(CLEANUP_HEADLINE);
  });

  // ⚠️ CONTROL, not a pin — green in both directions. It pins the judgement
  // this card turns on: `target` is resolved BEFORE the try whose catch cleans
  // up, so the catch can never see a half-built adapter or the adapter whose
  // construction threw. A build failure returns before anything is written, and
  // the handler must therefore attempt NO cleanup — not against the persisted
  // store (nothing was written there) and not against the adapter that failed
  // to construct (there is none). Uses the REAL factory, which rejects an S3
  // configuration with no bucket or region.
  it('CONTROL: an adapter that fails to BUILD is reported, and no cleanup is attempted anywhere', async () => {
    const persistedRoot = await tmpRoot('oss-13726-nobuild-');
    const { ctx, settings, storage } = await bootedPlugin(persistedRoot);

    const persisted = withCountedDeletes(localAdapterAt(persistedRoot));
    storage.swap(persisted.store);

    const result = await settings._runAction('storage', 'test', {
      values: {},
      payload: { values: { adapter: 's3', s3_bucket: '', s3_region: '' } },
    });

    expect(result.ok).toBe(false);
    expect(result.severity).toBe('error');
    expect(result.message).toContain('S3 adapter requires s3_bucket and s3_region');
    expect(persisted.deleted).toEqual([]);
    expect(await probeObjectsIn(persistedRoot)).toEqual([]);
    expect(ctx._logs.warn.join('\n')).not.toContain(CLEANUP_HEADLINE);
  });
});

describe('#13726 defect 2 — the content-mismatch path cleans up', () => {
  it('a mismatch on EDITED credentials leaves nothing behind in the TEMPORARY store', async () => {
    const persistedRoot = await tmpRoot('oss-13726-mismatch-persisted-');
    const temporaryRoot = await tmpRoot('oss-13726-mismatch-temporary-');
    const { plugin, settings, storage } = await bootedPlugin(persistedRoot);

    const persisted = withCountedDeletes(localAdapterAt(persistedRoot));
    storage.swap(persisted.store);

    // The upload SUCCEEDS here — that is the precondition for reaching the
    // comparison at all — and the download answers other bytes.
    const temporary = withMangledDownload(localAdapterAt(temporaryRoot));
    substituteAdapterFactory(plugin, temporary);

    const result = await settings._runAction('storage', 'test', editedCredentials(temporaryRoot));

    // THE PIN: the upload landed, and nothing is left of it.
    expect(await probeObjectsIn(temporaryRoot)).toEqual([]);
    expect(persisted.deleted).toEqual([]);

    // ⛔ The message the operator reads is unchanged.
    expect(result.ok).toBe(false);
    expect(result.severity).toBe('error');
    expect(result.message).toBe(MISMATCH_MESSAGE);
  });

  it('a mismatch with NO edited credentials leaves nothing behind in the PERSISTED store', async () => {
    const persistedRoot = await tmpRoot('oss-13726-mismatch-only-');
    const { settings, storage } = await bootedPlugin(persistedRoot);

    const counted = withCountedDeletes(localAdapterAt(persistedRoot));
    storage.swap(withMangledDownload(counted.store));

    const result = await settings._runAction('storage', 'test', { values: {} });

    expect(await probeObjectsIn(persistedRoot)).toEqual([]);
    expect(counted.deleted).toHaveLength(1);
    expect(counted.deleted[0]).toContain(`${PROBE_PREFIX}/`);
    expect(result.ok).toBe(false);
    expect(result.message).toBe(MISMATCH_MESSAGE);
  });

  // #12981 batch 7 made a REFUSED cleanup name the key it left behind. That
  // repair could not reach this path, because no cleanup was attempted on it.
  // Now that one is, the refusal is reported here too — the same line, from the
  // same helper — and the probe's own verdict is still the one returned.
  it('a mismatch whose cleanup is REFUSED names the stray key, and still reports the mismatch', async () => {
    const persistedRoot = await tmpRoot('oss-13726-mismatch-refused-');
    const { ctx, settings, storage } = await bootedPlugin(persistedRoot);

    storage.swap(
      withRefusedDelete(
        withMangledDownload(localAdapterAt(persistedRoot)),
        'delete refused: bucket is read-only',
      ),
    );

    const result = await settings._runAction('storage', 'test', { values: {} });

    const warned = ctx._logs.warn.filter((l: string) => l.includes(CLEANUP_HEADLINE));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(`${PROBE_PREFIX}/`);
    expect(warned[0]).toContain('delete refused: bucket is read-only');

    // The object really is still there — the warning is not decorative.
    expect(await probeObjectsIn(persistedRoot)).toHaveLength(1);

    // ⛔ The probe's own result is untouched by the cleanup's failure.
    expect(result.ok).toBe(false);
    expect(result.severity).toBe('error');
    expect(result.message).toBe(MISMATCH_MESSAGE);
  });
});
