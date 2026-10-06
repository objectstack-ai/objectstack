// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21913] Every engine call `SettingsService` makes on its own `sys_setting`
 * rows, and the `sys_setting_audit` writer the plugin builds, carries the
 * explicit system opt-in (`isSystem: true`).
 *
 * Before this, `loadRows`, `upsertRow`'s existence probe and insert, and the
 * audit insert reached the data engine with NO context at all — no principal
 * and no system opt-in — and passed the security middleware only through its
 * principal-less hand-off (ADR-0096 E1), which D5 closes. `loadRows` sits on
 * every request's execution-context build, so a deny landing before this
 * producer moved would break the platform, not one feature.
 *
 * The double sits BEHIND the production adapter (`wrapEngineAsSettingsEngine`),
 * so the pin also holds the adapter to forwarding the context it is handed on
 * `find` and `insert` as it already must on `update`.
 */

import { describe, it, expect } from 'vitest';
import { SettingsService } from './settings-service.js';
import { buildSettingAuditWriter, wrapEngineAsSettingsEngine } from './settings-service-plugin.js';

type Call = { verb: 'find' | 'insert' | 'update' | 'delete'; object: string; context: unknown };

// `$or` is the one combinator `loadRows` writes; anything else is refused so a
// silently ignored predicate cannot make this double answer too much.
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === '$or') return (v as Array<Record<string, unknown>>).some((b) => matches(row, b));
    if (k.startsWith('$')) throw new Error(`recording engine: unimplemented combinator ${k}`);
    return (row[k] ?? null) === (v ?? null);
  });
}

/**
 * An `IDataEngine`-shaped double that records the context each call carried.
 * It implements only the verbs the moved calls use — `find` and `insert` — so
 * a call this pin does not expect fails loudly instead of being answered.
 */
function recordingEngine() {
  const rows: Array<Record<string, unknown>> = [];
  const calls: Call[] = [];
  // A read's context may arrive in the query bag or the trailing options
  // argument (the contract accepts both; options wins) — record whichever came.
  const readContext = (query: any, options: any) => options?.context ?? query?.context;
  const engine = {
    async find(object: string, query: any, options?: any) {
      calls.push({ verb: 'find', object, context: readContext(query, options) });
      // The user-scope insert first proves its `user_id` names a user (#21913).
      if (object === 'sys_user') return [{ id: query?.where?.id }];
      const hits = rows.filter((r) => matches(r, query?.where ?? {}));
      return typeof query?.limit === 'number' ? hits.slice(0, query.limit) : hits;
    },
    async insert(object: string, data: Record<string, unknown>, options?: any) {
      calls.push({ verb: 'insert', object, context: options?.context });
      if (object === 'sys_setting') rows.push({ ...data });
      return { ...data };
    },
  };
  return { engine, calls, rows };
}

const MANIFEST = {
  namespace: 'localization',
  label: 'Localization',
  specifiers: [{ key: 'timezone', type: 'string', scope: 'user', default: 'UTC' }],
} as any;

describe('[#21913] SettingsService engine calls carry the explicit system opt-in', () => {
  it('loadRows, and upsertRow on its existence probe and insert, pass isSystem on every sys_setting call', async () => {
    const { engine, calls, rows } = recordingEngine();
    const svc = new SettingsService();
    svc.registerManifest(MANIFEST);
    svc.bindEngine(wrapEngineAsSettingsEngine(engine as any));

    // loadRows (read path), then upsertRow's existence probe and insert branch.
    // (Its update branch already carried the opt-in before this change.)
    expect((await svc.get('localization', 'timezone', { userId: 'u1' })).value).toBe('UTC');
    await svc.set('localization', 'timezone', 'Asia/Tokyo', { userId: 'u1' });
    expect(rows).toHaveLength(1);
    expect((await svc.get('localization', 'timezone', { userId: 'u1' })).value).toBe('Asia/Tokyo');

    const onSettings = calls.filter((c) => c.object === 'sys_setting');
    // The pin is about a population, so it first proves the population is there:
    // the reads ran, and the write took the insert branch.
    expect(onSettings.filter((c) => c.verb === 'find').length).toBeGreaterThanOrEqual(3);
    expect(onSettings.filter((c) => c.verb === 'insert')).toHaveLength(1);
    // …and the insert's user-reference probe ran too, under the same opt-in.
    expect(calls.filter((c) => c.object === 'sys_user')).toHaveLength(1);
    expect(onSettings.length + 1).toBe(calls.length);
    for (const call of calls) {
      expect(call.context, `${call.verb} on ${call.object}`).toEqual({ isSystem: true });
    }
  });

  it('the sys_setting_audit writer inserts under isSystem', async () => {
    const { engine, calls } = recordingEngine();
    await buildSettingAuditWriter(engine as any).write({
      namespace: 'localization',
      key: 'timezone',
      scope: 'user',
      action: 'set',
      actorId: 'u1',
      oldHash: null,
      newHash: 'hmac-sha256:x',
      encrypted: false,
    } as any);
    expect(calls).toEqual([{ verb: 'insert', object: 'sys_setting_audit', context: { isSystem: true } }]);
  });
});
