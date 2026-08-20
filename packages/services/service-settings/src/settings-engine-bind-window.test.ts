// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The pre-bind window — **a write that answers "resolved" while nothing
 * reaches `sys_setting`.**
 *
 * ## The defect
 *
 * `SettingsService.upsertRow` picks its store on `if (this.engine)`, and the
 * engine is bound in exactly one place: `SettingsServicePlugin` registers a
 * `kernel:ready` hook from its `start()` and calls `bindEngine` inside it.
 * `kernel:ready` handlers run in REGISTRATION order (`hooks.get(name).push(…)`
 * in `packages/core/src/kernel-base.ts`, dispatched in array order), and every
 * plugin's `init()` runs before any plugin's `start()`. So every `kernel:ready`
 * hook registered from an `init()` fires BEFORE the engine is bound — and a
 * `set()` from there landed in the in-process `memory` array, re-resolved off
 * that same array, and handed the caller a fully resolved value while
 * `sys_setting` received nothing.
 *
 * Nothing said so at any level. The write did not fail; it succeeded against
 * the wrong store. Both audit ledgers were silent for the same reason (`audit`
 * and `auditWriter` bind on the same `bindEngine` call), so the usual evidence
 * that a settings write happened was absent too.
 *
 * The population is ordinarily occupied, not hypothetical:
 * `assembleMetadataProtocol` registers the three platform migrations'
 * `kernel:ready` hook from `ObjectQLPlugin.init()`
 * (`packages/objectql/src/plugin.ts` `init = async` →
 * `packages/metadata-protocol/src/plugin.ts`).
 *
 * ## What the fix is, and what it deliberately is NOT
 *
 * A write in the window now raises `SettingsEngineNotBoundError`
 * (`SETTINGS_ENGINE_NOT_BOUND`, 503) naming `kernel:bootstrapped` as the
 * earliest safe phase. The refusal is scoped to a DECLARED, pending bind —
 * `SettingsServiceOptions.engineBindPending`, which only
 * `SettingsServicePlugin` sets and which both branches of its `kernel:ready`
 * hook clear. Every other engine-less reading of the in-memory fallback ("unit
 * tests, bootstrap, control-plane mock", and the lean kernel the plugin's
 * OPTIONAL `objectql` dependency exists for) is untouched — cases 4 and 5 are
 * that assertion, and they are the reason this change alters nothing a
 * non-window caller observes.
 *
 * ## The direction each case pins
 *
 * The load-bearing assertion is the REFUSAL, not the empty table: on the
 * silent-accept behaviour this replaces, `sys_setting` was empty after the
 * in-window write too. A case asserting only "no row landed" would have passed
 * against the defect. Case 1 therefore records the write's OUTCOME as a
 * string — `resolved:…` on the old behaviour, `threw:SETTINGS_ENGINE_NOT_BOUND:503`
 * on the new one — and asserts the second.
 */

import { describe, expect, it } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SysSecret, SysSetting } from '@objectstack/platform-objects/system';
import type { SettingsManifest } from '@objectstack/spec/system';
import { SettingsService } from './settings-service.js';
import { SettingsServicePlugin, wrapEngineAsSettingsEngine } from './settings-service-plugin.js';
import { SettingsEngineNotBoundError } from './settings-service.types.js';

const OWNER_PACKAGE = 'com.objectstack.test.settings-engine-bind-window';

/** One plain global key. The window is about WHEN a write lands, not what. */
const probeManifest: SettingsManifest = {
  namespace: 'receipt_probe',
  version: 1,
  label: 'Receipt probe',
  scope: 'global',
  specifiers: [
    { type: 'text', key: 'last_run', label: 'Last run', required: false, default: 'never' },
  ],
};

// ---------------------------------------------------------------------------
// A driver over plain Maps — enough of `IDataDriver` for the settings write
// path. Same shape as `settings-secret-rotation.test.ts`'s, and for the same
// reason: the real `ObjectQL` sits on top of it, so what these cases measure is
// the real engine's row state rather than a fake's bookkeeping.
// ---------------------------------------------------------------------------

function makeMemoryDriver() {
  const store = new Map<string, Map<string, Record<string, unknown>>>();
  let nextId = 0;
  const copy = (r: Record<string, unknown>) => ({ ...r });
  const rowsOf = (object: string) => {
    let s = store.get(object);
    if (!s) { s = new Map(); store.set(object, s); }
    return s;
  };
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return (row[k] ?? null) === (v ?? null);
    });
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(o: string, ast: any) {
      return [...rowsOf(o).values()].filter((r) => matches(r, ast?.where)).map(copy);
    },
    async findOne(o: string, ast: any) {
      for (const r of rowsOf(o).values()) if (matches(r, ast?.where)) return copy(r);
      return null;
    },
    async create(o: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `row_${nextId}`;
      const row = { ...data, id };
      rowsOf(o).set(id, row);
      return copy(row);
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const s = rowsOf(o);
      const cur = s.get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id };
      s.set(id, next);
      return copy(next);
    },
    async upsert(o: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      return id && rowsOf(o).has(id) ? this.update(o, id, data) : this.create(o, data);
    },
    async delete(o: string, id: string) { return rowsOf(o).delete(id); },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(o, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany(o: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(o, ast);
      const s = rowsOf(o);
      for (const r of rows) s.set(r.id as string, { ...s.get(r.id as string), ...data, id: r.id });
      return rows.length;
    },
    async deleteMany(o: string, ast: any) {
      const rows = await this.find(o, ast);
      for (const r of rows) rowsOf(o).delete(r.id as string);
      return rows.length;
    },
    async syncSchema() {}, async dropTable() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, rowsOf };
}

/**
 * Stands in for `ObjectQLPlugin` in the one respect this file is about: it
 * publishes the `objectql` service from `init()`, which is where the real one
 * publishes it too (`providesServices` + `init = async` in
 * `packages/objectql/src/plugin.ts`).
 */
class EnginePlugin implements Plugin {
  name = 'com.objectstack.engine.objectql';
  version = '0.0.0';
  type = 'standard' as const;
  providesServices = ['objectql'];
  constructor(private readonly engine: ObjectQL) {}
  init = async (ctx: PluginContext) => {
    ctx.registerService('objectql', this.engine);
  };
}

/** What one in-window attempt observed. Strings, so the two behaviours are
 *  distinguishable in a single assertion rather than by absence. */
interface WindowObservation {
  serviceResolvableAtReady?: boolean;
  engineBoundAtReady?: boolean;
  /** `resolved:<json>` (the defect) or `threw:<code>:<status>` (the fix). */
  writeAtReady?: string;
  /** `resolved:<json>` — reads are deliberately NOT gated. */
  readAtReady?: string;
}

/**
 * The named population: a plugin registering its `kernel:ready` hook from
 * `init()`. It writes AND reads from inside that hook.
 */
class ReadyHookFromInitPlugin implements Plugin {
  name = 'com.objectstack.test.ready-hook-from-init';
  version = '0.0.0';
  type = 'standard' as const;
  readonly observed: WindowObservation = {};
  init = async (ctx: PluginContext) => {
    ctx.hook('kernel:ready', async () => {
      let svc: SettingsService | undefined;
      try { svc = ctx.getService<SettingsService>('settings'); } catch { /* not registered */ }
      this.observed.serviceResolvableAtReady = Boolean(svc);
      // Reaching into the private field on purpose: "was the engine bound at
      // this instant" is the fact the whole window is defined by, and there is
      // no public spelling of it.
      this.observed.engineBoundAtReady = Boolean((svc as unknown as { engine?: unknown })?.engine);
      if (!svc) return;
      svc.registerManifest(probeManifest);
      try {
        const r = await svc.set('receipt_probe', 'last_run', 'written-at-kernel-ready');
        this.observed.writeAtReady = `resolved:${JSON.stringify(r.value)}`;
      } catch (e: unknown) {
        const err = e as { code?: string; status?: number };
        this.observed.writeAtReady = `threw:${err?.code}:${err?.status}`;
      }
      try {
        const r = await svc.get<string>('receipt_probe', 'last_run');
        this.observed.readAtReady = `resolved:${JSON.stringify(r.value)}`;
      } catch (e: unknown) {
        const err = e as { code?: string; status?: number };
        this.observed.readAtReady = `threw:${err?.code}:${err?.status}`;
      }
    });
  };
}

/**
 * A real kernel booting the real plugin, with the probe above registered
 * alongside. `withEngine: false` boots the lean kernel the plugin's OPTIONAL
 * `objectql` dependency exists for.
 */
async function bootKernel(opts: { withEngine?: boolean } = {}) {
  const withEngine = opts.withEngine !== false;
  const { driver, rowsOf } = makeMemoryDriver();
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of [SysSetting, SysSecret]) engine.registry.registerObject(o as any, OWNER_PACKAGE);

  const probe = new ReadyHookFromInitPlugin();
  const kernel = new LiteKernel({ logger: { level: 'error' } as never });
  if (withEngine) kernel.use(new EnginePlugin(engine));
  // `manifests: []` + `actionHandlers: {}` — the shipped bundles are irrelevant
  // here and registering an action against an unregistered namespace throws in
  // `init()`.
  kernel.use(new SettingsServicePlugin({ registerRoutes: false, manifests: [], actionHandlers: {} }));
  kernel.use(probe);
  await kernel.bootstrap();

  const svc = kernel.getService<SettingsService>('settings');
  return {
    kernel, engine, svc, probe, rowsOf,
    settingRows: () => [...rowsOf('sys_setting').values()],
    auditRows: () => [...rowsOf('sys_setting_audit').values()],
  };
}

// ---------------------------------------------------------------------------
// 1. The window refuses — loudly
// ---------------------------------------------------------------------------

describe('the pre-bind window refuses a write instead of resolving it', () => {
  it('a `kernel:ready` hook registered from `init()` is inside the window, and its write is refused', async () => {
    const { probe, settingRows, auditRows } = await bootKernel();

    // The window, measured: the service is already reachable, the engine is not
    // yet bound. Both halves matter — a service that were NOT resolvable would
    // not be a silent-loss window, just a missing dependency.
    expect(probe.observed.serviceResolvableAtReady).toBe(true);
    expect(probe.observed.engineBoundAtReady).toBe(false);

    // THE DIRECTION PIN. On the silent-accept behaviour this replaces the same
    // probe recorded `resolved:"written-at-kernel-ready"` — measured on
    // `origin/main` before the fix, alongside the identical empty table below.
    // So the table being empty is NOT what this case tests; the refusal is.
    expect(probe.observed.writeAtReady).toBe('threw:SETTINGS_ENGINE_NOT_BOUND:503');

    // ADR-0112: `code` AND `status`, never one alone — asserted here on the
    // class rather than off a wire envelope, because no HTTP door can reach
    // this error (the window closes at `kernel:ready`; sockets open at
    // `kernel:listening`).
    const err = new SettingsEngineNotBoundError('receipt_probe', ['last_run']);
    expect(err.code).toBe('SETTINGS_ENGINE_NOT_BOUND');
    expect(err.status).toBe(503);
    // The refusal has to tell the caller what to do instead, or it is just a
    // different way to lose the write.
    expect(err.message).toContain('kernel:bootstrapped');

    // And nothing was written anywhere — no row, and no audit row either.
    expect(settingRows()).toEqual([]);
    expect(auditRows()).toEqual([]);
  });

  it('reads in the window are NOT gated — the ordinary startup sequence still works', async () => {
    const { probe } = await bootKernel();
    // The property under test: the read RESOLVED rather than raising. Refusing
    // reads too would turn a correct, ordinary boot-time read into an error,
    // which is a regression dressed as a fix.
    expect(probe.observed.readAtReady).toMatch(/^resolved:/);
    // And the value is the manifest DEFAULT. This half is deliberately coupled
    // to the refusal in the same hook, and it is a second silent-loss witness:
    // on the behaviour this replaces the write above landed in the memory
    // fallback, so this read answered `resolved:"written-at-kernel-ready"` —
    // the phantom value, read straight back out of the store that no longer
    // exists after restart. Measured: neutering the guard turns this assertion
    // red with exactly that string.
    expect(probe.observed.readAtReady).toBe('resolved:"never"');
  });
});

// ---------------------------------------------------------------------------
// 2. The window ENDS at bind — non-window callers are unchanged
// ---------------------------------------------------------------------------

describe('after bind, writes behave exactly as before', () => {
  it('the identical write lands a real `sys_setting` row and a real audit row', async () => {
    const { svc, settingRows, auditRows } = await bootKernel();

    svc.registerManifest(probeManifest);
    const resolved = await svc.set('receipt_probe', 'last_run', 'written-after-boot');
    expect(resolved.value).toBe('written-after-boot');

    const rows = settingRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      namespace: 'receipt_probe',
      key: 'last_run',
      scope: 'global',
      value: 'written-after-boot',
    });
    expect(auditRows()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Clause-② pins — the two engine-less populations that are NOT the window
// ---------------------------------------------------------------------------

describe('engine-less callers outside the window observe nothing new', () => {
  it('a directly constructed SettingsService still resolves writes into the memory fallback', async () => {
    // "unit tests, bootstrap, control-plane mock" — the documented second
    // reading of the in-memory fallback. It declares no pending bind, so the
    // guard never arms and this is byte-for-byte the pre-fix behaviour.
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(probeManifest);

    const resolved = await svc.set('receipt_probe', 'last_run', 'memory-is-the-store');
    expect(resolved.value).toBe('memory-is-the-store');
    expect((await svc.get<string>('receipt_probe', 'last_run')).value).toBe('memory-is-the-store');
  });

  it('a kernel with NO objectql settles the window and keeps its deliberate degradation', async () => {
    // The plugin declares `objectql` an OPTIONAL dependency and degrades on
    // purpose when it is absent. On such a kernel the answer to "is an engine
    // coming?" is legitimately NO, and it becomes knowable exactly once — in
    // the plugin's own `kernel:ready` hook. From there on writes resolve again.
    const { svc, probe } = await bootKernel({ withEngine: false });

    // Inside the window the answer is not yet known, so the write is still
    // refused — the guard is temporal, not a judgement about this kernel.
    expect(probe.observed.writeAtReady).toBe('threw:SETTINGS_ENGINE_NOT_BOUND:503');

    svc.registerManifest(probeManifest);
    const resolved = await svc.set('receipt_probe', 'last_run', 'lean-kernel');
    expect(resolved.value).toBe('lean-kernel');
    expect((await svc.get<string>('receipt_probe', 'last_run')).value).toBe('lean-kernel');
  });

  it('`bindEngine` closes a declared window even without the plugin', async () => {
    const { driver } = makeMemoryDriver();
    const engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    for (const o of [SysSetting, SysSecret]) engine.registry.registerObject(o as any, OWNER_PACKAGE);

    const svc = new SettingsService({ env: {}, engineBindPending: true });
    svc.registerManifest(probeManifest);

    await expect(svc.set('receipt_probe', 'last_run', 'too-early')).rejects.toMatchObject({
      code: 'SETTINGS_ENGINE_NOT_BOUND',
      status: 503,
    });

    svc.bindEngine(wrapEngineAsSettingsEngine(engine as never));
    const resolved = await svc.set('receipt_probe', 'last_run', 'now-fine');
    expect(resolved.value).toBe('now-fine');
  });
});
