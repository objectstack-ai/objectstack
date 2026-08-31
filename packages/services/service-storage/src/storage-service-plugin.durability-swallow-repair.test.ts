// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12981 batch 7] The two silent `catch` blocks at the tail of
 * `StorageServicePlugin.start()`.
 *
 * ## Site A — the settings-namespace binding
 *
 * One `try` wrapped the whole "bind to the `storage` settings namespace" block
 * and ended in `catch { // settings service not present }`. The comment named
 * one outcome; the catch caught two:
 *
 *   - the settings service is ABSENT (a bare kernel) — nothing ever claimed the
 *     admin UI could swap adapters, so silence is correct and reporting it
 *     would put a line on every bare-kernel boot;
 *   - the settings service is PRESENT and the binding FAILED part-way —
 *     `subscribe` or `registerAction` threw. `start()` then completes, the
 *     kernel reports a healthy boot, and the storage settings screen is wired
 *     to nothing: an operator's adapter change is saved and never applied.
 *
 * Resolving `getService('settings')` on its own line splits them, so the
 * remaining catch covers exactly the second.
 *
 * ## Site B — the `storage/test` probe cleanup
 *
 * `try { await proxy.delete(probeKey); } catch { /* ignore *\/ }`. The `return`
 * beside it reports the PROBE's failure — a different failure. The cleanup's
 * own failure reached nobody, so one stray `__objectstack_probe__/…` key
 * accrued per failed test and the only record of its name (minted per call from
 * a timestamp plus a random suffix) died with the frame.
 *
 * ## The level at BOTH sites: `warn`, and decided on the merits
 *
 * Neither is a durability degradation. Site A is textbook FUNCTIONAL under
 * AGENTS.md — "a capability is not enabled… the next person to use the missing
 * thing finds out" — and storage itself keeps serving from the adapter the
 * plugin's own options built. Site B is housekeeping that did not happen; the
 * leaked object is inert probe content no record references. AGENTS.md is
 * explicit that escalating these is what makes `error` unreadable.
 *
 * ⚠️ Two cases below are CONTROLS, not pins: they assert an ABSENCE against
 * seams that logged nothing at all before this repair, so they stay green in
 * both directions by construction and are not ablation evidence.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IStorageService } from '@objectstack/spec/contracts';
import { StorageServicePlugin } from './storage-service-plugin.js';
import type { SwappableStorageService } from './swappable-storage-service.js';

function makeCtx() {
  const services = new Map<string, any>();
  const hooks: Array<() => Promise<void> | void> = [];
  const logs: { info: string[]; warn: string[]; error: string[] } = { info: [], warn: [], error: [] };
  const ctx: any = {
    logger: {
      info: (m: string) => { logs.info.push(String(m)); },
      warn: (m: string) => { logs.warn.push(String(m)); },
      error: (m: string) => { logs.error.push(String(m)); },
    },
    _logs: logs,
    registerService: (name: string, svc: any) => { services.set(name, svc); },
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

/**
 * A settings service whose `registerAction` can be made to throw.
 *
 * `registerAction` and not `getNamespace`, deliberately: `applySettings` has
 * its own inner catch that already warns, so a failure there was never part of
 * this family. `registerAction` is reached only through the OUTER try, which is
 * the seam under test.
 */
function makeFakeSettings(opts: { failRegisterAction?: Error } = {}) {
  const actions = new Map<string, (input: any) => Promise<any>>();
  return {
    createClient: (_ns: string) => ({}),
    getNamespace: async (_ns: string) => ({ values: {} }),
    subscribe: (_ns: string, _fn: () => void) => {},
    registerAction: (ns: string, id: string, fn: (input: any) => Promise<any>) => {
      if (opts.failRegisterAction) throw opts.failRegisterAction;
      actions.set(`${ns}/${id}`, fn);
    },
    _runAction: async (ns: string, id: string, input: any) => {
      const fn = actions.get(`${ns}/${id}`);
      if (!fn) throw new Error(`no action ${ns}/${id}`);
      return await fn(input);
    },
  };
}

/** An adapter that refuses the verbs a test names, and counts what was tried. */
function makeBrokenAdapter(refuse: { upload?: boolean; delete?: boolean }) {
  const tried = { upload: 0, delete: 0 };
  const adapter = {
    async upload(_k: string, _b: Buffer, _o?: unknown) {
      tried.upload += 1;
      if (refuse.upload) throw new Error('upload refused: bucket is read-only');
      return { key: _k } as never;
    },
    async download(_k: string) { return Buffer.from('probe', 'utf-8'); },
    async delete(_k: string) {
      tried.delete += 1;
      if (refuse.delete) throw new Error('delete refused: bucket is read-only');
    },
    async exists(_k: string) { return true; },
    async list() { return { items: [] } as never; },
    async getUrl(k: string) { return `mem://${k}`; },
  };
  return { adapter: adapter as unknown as IStorageService, tried };
}

async function bootedPlugin(settings: unknown) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'oss-b7-'));
  const plugin = new StorageServicePlugin({
    adapter: 'local',
    local: { rootDir: dir },
    registerRoutes: false,
  });
  const ctx = makeCtx();
  if (settings) ctx.registerService('settings', settings);
  await plugin.init(ctx);
  await plugin.start(ctx);
  await ctx._flushReady();
  // Typed HERE rather than at each call site: the fake ctx is `any`, so
  // `ctx.getService<T>(…)` is a type argument on an untyped call (TS2347) and
  // `as any` would be a slot-lookup erasure (#4251). A plain typed assignment
  // is neither.
  const storage: SwappableStorageService = ctx.getService('storage');
  return { plugin, ctx, dir, storage };
}

const BINDING_HEADLINE = 'settings namespace binding FAILED';
const CLEANUP_HEADLINE = 'was NOT removed';

describe('StorageServicePlugin site A: settings binding (#12981)', () => {
  // ⚠️ CONTROL, not a pin. The pre-repair code was silent here too, so this
  // stays green in BOTH directions. It exists so the pin below cannot pass on
  // a seam that reports unconditionally — and it pins the DIRECTION of the
  // split: absence must stay silent.
  it('CONTROL: a bare kernel with no settings service stays silent, and still starts', async () => {
    const { ctx } = await bootedPlugin(null);

    expect(ctx._logs.warn.join('\n')).not.toContain(BINDING_HEADLINE);
    expect(ctx._logs.error).toEqual([]);
    // Storage itself is up: the absence really is only functional.
    expect(ctx.getService('storage')).toBeTruthy();
  });

  it('a binding that FAILS with the service PRESENT is reported, and names what stops working', async () => {
    const boom = new Error('settings action registry is sealed');
    const settings = makeFakeSettings({ failRegisterAction: boom });

    const { ctx } = await bootedPlugin(settings);

    const warned = ctx._logs.warn.filter((l: string) => l.includes(BINDING_HEADLINE));
    expect(warned).toHaveLength(1);
    // The driver's own sentence, so the operator is not left guessing.
    expect(warned[0]).toContain('settings action registry is sealed');
    // The consequence, concretely — and that the boot still looks healthy.
    expect(warned[0]).toContain('will be saved but NOT applied');
    // The fix, which is the other half AGENTS.md requires of a degradation line.
    expect(warned[0]).toContain('bindToSettings: false');
    // ⛔ Control flow unchanged: a failed binding must not fail the boot.
    expect(ctx.getService('storage')).toBeTruthy();
    expect(ctx._logs.error).toEqual([]);
  });
});

describe('StorageServicePlugin site B: storage/test probe cleanup (#12981)', () => {
  it('a refused probe cleanup is reported, and names the stray key', async () => {
    const settings = makeFakeSettings();
    const { ctx, storage } = await bootedPlugin(settings);
    const broken = makeBrokenAdapter({ upload: true, delete: true });
    storage.swap(broken.adapter);

    const result = await settings._runAction('storage', 'test', { values: {} });

    // Proof the seam was really reached: the probe upload threw and the
    // cleanup delete was really attempted and really refused.
    expect(broken.tried.upload).toBe(1);
    expect(broken.tried.delete).toBe(1);

    const warned = ctx._logs.warn.filter((l: string) => l.includes(CLEANUP_HEADLINE));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('__objectstack_probe__/');
    expect(warned[0]).toContain('delete refused: bucket is read-only');

    // ⛔ The probe RESULT is untouched — the operator still reads the original
    // failure, not the cleanup's.
    expect(result.ok).toBe(false);
    expect(result.severity).toBe('error');
    expect(result.message).toBe('upload refused: bucket is read-only');
  });

  // ⚠️ CONTROL, not a pin — green in both directions, because the pre-repair
  // code also said nothing when the cleanup succeeded. It is here so the pin
  // above cannot pass on a seam that warns on every failed probe.
  it('CONTROL: a probe failure whose cleanup SUCCEEDS reports nothing on that channel', async () => {
    const settings = makeFakeSettings();
    const { ctx, storage } = await bootedPlugin(settings);
    const broken = makeBrokenAdapter({ upload: true, delete: false });
    storage.swap(broken.adapter);

    const result = await settings._runAction('storage', 'test', { values: {} });

    expect(broken.tried.delete).toBe(1);
    expect(result.ok).toBe(false);
    expect(ctx._logs.warn.join('\n')).not.toContain(CLEANUP_HEADLINE);
  });
});
