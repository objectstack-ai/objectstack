// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10826] `getMany` — one grouped row load instead of one per key.
 *
 * `resolveLocalizationContext` called `get()` three times for one namespace,
 * and each call ran `loadRows` over the whole namespace: three identical
 * `sys_setting` reads inside one request (queries 16–18 of 24 on a live rig,
 * PR #10824). `getMany` resolves N same-namespace keys with AT MOST two row
 * loads (one per required `loadRows` argument — `user`-scoped keys read
 * `(ns, userId)`, everything else `(ns, null)`).
 *
 * The contract pinned here is EQUIVALENCE: for every key, `getMany`'s answer
 * deep-equals what per-key `get()` returns — same value, same source, same
 * lock, same cascadeChain — across env overrides, scope mixes, and the
 * unknown-key refusal. Plus the read-count contract itself, measured at the
 * engine: same-scope keys collapse to ONE find, mixed scopes to TWO, and a
 * fully env-overridden set to ZERO.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsService } from './settings-service.js';

function makeEngine(rows: Array<Record<string, unknown>>) {
  const find = vi.fn(async (_obj: string, opts: any) => {
    const w = opts?.where ?? {};
    return rows.filter((r) =>
      Object.entries(w).every(([k, v]) => (r as any)[k] === v),
    );
  });
  return {
    find,
    insert: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn(),
  };
}

const MANIFEST = {
  namespace: 'localization',
  label: 'Localization',
  specifiers: [
    { key: 'timezone', type: 'string', scope: 'user', default: 'UTC' },
    { key: 'locale', type: 'string', scope: 'user', default: 'en' },
    { key: 'currency', type: 'string', scope: 'tenant', default: null },
  ],
} as any;

const ROWS = [
  { namespace: 'localization', key: 'timezone', scope: 'global', value: '"America/New_York"', user_id: null },
  { namespace: 'localization', key: 'locale', scope: 'user', value: '"zh-CN"', user_id: 'u1' },
  { namespace: 'localization', key: 'currency', scope: 'tenant', value: '"USD"', user_id: null },
];

async function makeService(rows = ROWS) {
  const engine = makeEngine(rows);
  const svc = new SettingsService();
  svc.registerManifest(MANIFEST);
  svc.bindEngine(engine as any);
  return { svc, engine };
}

const prevEnv: Record<string, string | undefined> = {};
beforeEach(() => { prevEnv.OS_LOCALIZATION_TIMEZONE = process.env.OS_LOCALIZATION_TIMEZONE; });
afterEach(() => {
  if (prevEnv.OS_LOCALIZATION_TIMEZONE === undefined) delete process.env.OS_LOCALIZATION_TIMEZONE;
  else process.env.OS_LOCALIZATION_TIMEZONE = prevEnv.OS_LOCALIZATION_TIMEZONE;
});

describe('[#10826] SettingsService.getMany', () => {
  it('answers each key exactly as per-key get() does (value/source/lock/cascade)', async () => {
    const { svc } = await makeService();
    const ctx = { userId: 'u1', tenantId: 't1' };
    const many = await svc.getMany('localization', ['timezone', 'locale', 'currency'], ctx);
    for (const key of ['timezone', 'locale', 'currency']) {
      expect(many[key]).toEqual(await svc.get('localization', key, ctx));
    }
  });

  it('collapses same-namespace reads: mixed scopes → TWO engine finds, not one per key', async () => {
    const { svc, engine } = await makeService();
    engine.find.mockClear();
    await svc.getMany('localization', ['timezone', 'locale', 'currency'], { userId: 'u1' });
    // user-scoped keys share one load, the tenant-scoped key the other.
    expect(engine.find).toHaveBeenCalledTimes(2);
  });

  it('same-scope keys → ONE engine find', async () => {
    const { svc, engine } = await makeService();
    engine.find.mockClear();
    await svc.getMany('localization', ['timezone', 'locale'], { userId: 'u1' });
    expect(engine.find).toHaveBeenCalledTimes(1);
  });

  it('an env-overridden key answers without any row load, exactly like get()', async () => {
    process.env.OS_LOCALIZATION_TIMEZONE = 'Asia/Tokyo';
    const { svc, engine } = await makeService();
    const ctx = { userId: 'u1' };
    engine.find.mockClear();
    const many = await svc.getMany('localization', ['timezone'], ctx);
    expect(engine.find).toHaveBeenCalledTimes(0);
    expect(many.timezone).toEqual(await svc.get('localization', 'timezone', ctx));
    expect(many.timezone.source).toBe('env');
    expect(many.timezone.locked).toBe(true);
  });

  it('refuses an unknown key up front, same error class as get()', async () => {
    const { svc } = await makeService();
    await expect(svc.getMany('localization', ['timezone', 'nope'])).rejects.toThrow(/nope/);
    await expect(svc.get('localization', 'nope')).rejects.toThrow(/nope/);
  });

  it('getNamespace resolves through the grouped path with unchanged answers', async () => {
    const { svc, engine } = await makeService();
    const ctx = { userId: 'u1' };
    const ns = await svc.getNamespace('localization', ctx);
    expect(ns.values.timezone).toEqual(await svc.get('localization', 'timezone', ctx));
    expect(ns.values.currency).toEqual(await svc.get('localization', 'currency', ctx));
    // and it no longer costs one load per key
    engine.find.mockClear();
    await svc.getNamespace('localization', ctx);
    expect(engine.find.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
