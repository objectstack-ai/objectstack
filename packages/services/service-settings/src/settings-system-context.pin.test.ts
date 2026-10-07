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
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { SettingsService } from './settings-service.js';
import { SettingsServicePlugin, buildSettingAuditWriter, wrapEngineAsSettingsEngine } from './settings-service-plugin.js';
import { LocalCryptoProvider } from './local-crypto-provider.js';

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
 * It implements only the verbs the moved calls use — `find` and `insert`, and
 * [#21908] the `update` / `delete` a rotation and the `sys_secret` store issue,
 * each routed through the engine's own dispatch predicate — so a call this pin
 * does not expect fails loudly instead of being answered.
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
      const hits = rows.filter((r) => (r.__object ?? 'sys_setting') === object && matches(r, query?.where ?? {}));
      return typeof query?.limit === 'number' ? hits.slice(0, query.limit) : hits;
    },
    async insert(object: string, data: Record<string, unknown>, options?: any) {
      calls.push({ verb: 'insert', object, context: options?.context });
      if (object === 'sys_setting' || object === 'sys_secret') rows.push({ __object: object, ...data });
      return { ...data };
    },
    async update(object: string, data: Record<string, unknown>, options?: any) {
      assertEngineUpdateDispatch(data, options);
      calls.push({ verb: 'update', object, context: options?.context });
      const where = options?.where ?? { id: data.id };
      for (const row of rows.filter((r) => r.__object === object && matches(r, where))) Object.assign(row, data);
      return 1;
    },
    async delete(object: string, options?: any) {
      assertEngineDeleteDispatch(options);
      calls.push({ verb: 'delete', object, context: options?.context });
      return 1;
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

// ---------------------------------------------------------------------------
// [#21908] Stage 1 of the closure: the `sys_secret` store and the rotation's
// verification read.
// ---------------------------------------------------------------------------

const SECRET_MANIFEST = {
  namespace: 'sms',
  version: 1,
  label: 'SMS',
  scope: 'tenant',
  specifiers: [{ type: 'password', key: 'twilio_auth_token', label: 'Auth token', required: false, encrypted: true }],
} as any;

describe('[#21908] the sys_secret store and readStoredHandle carry the explicit system opt-in', () => {
  it('the store the plugin builds: insert, get, update and delete each pass isSystem', async () => {
    const { engine, calls } = recordingEngine();
    const store = (new SettingsServicePlugin() as any).buildSecretStore(engine);
    const row = { id: 'sec_1', namespace: 'sms', key: 'k', kms_key_id: 'local', alg: 'aes-256-gcm', version: 1, ciphertext: 'c1' };

    await store.insert(row);
    expect(await store.get('sec_1')).toMatchObject({ id: 'sec_1', ciphertext: 'c1' });
    await store.update('sec_1', { ciphertext: 'c2', version: 2 });
    await store.delete('sec_1');

    expect(calls.map((c) => `${c.verb}:${c.object}`)).toEqual([
      'insert:sys_secret', 'find:sys_secret', 'update:sys_secret', 'delete:sys_secret',
    ]);
    for (const call of calls) {
      expect(call.context, `${call.verb} on ${call.object}`).toEqual({ isSystem: true });
    }
  });

  it('a rotation: the secret writes, the row update and the verification read after it all pass isSystem', async () => {
    const { engine, calls } = recordingEngine();
    const svc = new SettingsService({
      env: {},
      engine: wrapEngineAsSettingsEngine(engine as any),
      cryptoProvider: new LocalCryptoProvider(),
      secretStore: (new SettingsServicePlugin() as any).buildSecretStore(engine),
    } as any);
    svc.registerManifest(SECRET_MANIFEST);

    await svc.set('sms', 'twilio_auth_token', 'alpha');
    await svc.set('sms', 'twilio_auth_token', 'beta');
    expect((await svc.get<string>('sms', 'twilio_auth_token')).value).toBe('beta');

    // The population: the second write updated the row, then re-read it
    // (`readStoredHandle`) before it reaped the rotated-away secret.
    const verbs = calls.map((c) => `${c.verb}:${c.object}`);
    const updateAt = verbs.indexOf('update:sys_setting');
    expect(updateAt).toBeGreaterThan(-1);
    expect(verbs.slice(updateAt + 1)).toEqual(expect.arrayContaining(['find:sys_setting', 'delete:sys_secret']));
    expect(verbs.filter((v) => v === 'insert:sys_secret')).toHaveLength(2);
    for (const call of calls) {
      expect(call.context, `${call.verb} on ${call.object}`).toEqual({ isSystem: true });
    }
  });
});
