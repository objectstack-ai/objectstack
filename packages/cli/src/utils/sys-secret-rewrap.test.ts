// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0128 §4.2 — pins for the at-rest re-wrap planner and executor.
 *
 * Everything that can run against real code does: a real `ObjectQL`, the real
 * `LocalCryptoProvider`, the real reference union, the real datasource
 * credential binder, and the provider's own `ciphertextDerivationStatus`. The
 * store is a minimal driver double whose `updateMany` is the same single
 * conditional statement the real drivers serve; the real SQL driver's answer
 * to that statement is pinned through the command's own boot in
 * `commands/secret/rewrap.driver-contract.test.ts`.
 *
 * The version-1 rows are sealed here the way every release before ADR-0128
 * sealed them, because the provider no longer seals version 1. The provider
 * then opening them IS the check that this file's version-1 sealing matches
 * the provider's version-1 reading.
 *
 * After `--apply`, every re-wrapped row is opened through ITS PRODUCER'S OWN
 * READ PATH: the engine's `resolveSecret` for an object secret field, the
 * binder's `resolve` for a datasource credential, and the settings service's
 * context for a setting. A row re-sealed under the wrong producer's scope
 * would fail exactly there. That is the strongest form of "the scope came
 * from the holder" this file can assert.
 *
 * Every "nothing happened" assertion has a positive control that makes the
 * same thing happen to the same row once the guard's condition is lifted.
 */

import { describe, it, expect } from 'vitest';
import { createCipheriv, randomBytes } from 'node:crypto';
import { ObjectQL } from '@objectstack/objectql';
import { createDatasourceSecretBinder } from '@objectstack/service-datasource';
import { ciphertextDerivationStatus, LocalCryptoProvider } from '@objectstack/service-settings';
import {
  CRYPTO_CONTEXT_SCOPES,
  type CryptoContext,
  type CryptoContextScope,
  type CryptoHandle,
} from '@objectstack/spec/contracts';
import {
  collectSecretReferenceUnion,
  SECRET_REFERENCE_FAMILIES,
  type SecretReferenceEngineLike,
} from './secret-reference-union.js';
import {
  asCompareAndSetWriter,
  attributeRewrapScope,
  buildRewrapReport,
  executeSysSecretRewrap,
  planSysSecretRewrap,
  REWRAP_CLASSES,
  rewrapUnfinished,
  SCOPE_OF_HOLDER_FAMILY,
  type RewrapProviderLike,
  type RewrapSecretRow,
  type RewrapWriterLike,
} from './sys-secret-rewrap.js';

type Row = Record<string, unknown>;

/** The deployment's data key. */
const KEY = Buffer.from('202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f', 'hex');

/**
 * A version-1 ciphertext: AES-256-GCM, AAD the UTF-8 of `namespace|key`, bare
 * base64 of iv || tag || cipher. The shape every handle sealed before ADR-0128
 * has at rest.
 */
function sealVersion1(plain: string, namespace: string, key: string, dataKey: Buffer = KEY): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
  cipher.setAAD(Buffer.from([namespace, key].join('|'), 'utf8'));
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

/**
 * A driver double. `updateMany` filters on EVERY `where` key by equality and
 * answers the count it changed, in one synchronous step: the conditional
 * statement the real drivers serve.
 */
function makeDriver() {
  const stores = new Map<string, Map<string, Row>>();
  const storeFor = (object: string) => {
    let s = stores.get(object);
    if (!s) { s = new Map(); stores.set(object, s); }
    return s;
  };
  const matches = (row: Row, where: unknown): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where as Row)) {
      if (k.startsWith('$')) continue;
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  const copy = (r: Row): Row => ({ ...r });
  const writes: Array<{ object: string; where: Row; data: Row }> = [];

  const driver = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast?: Row) {
      const matched = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      const page = typeof ast?.limit === 'number' ? matched.slice(0, ast.limit) : matched;
      return page.map(copy);
    },
    async create(object: string, data: Row) {
      const row = { ...data, id: String(data.id) };
      storeFor(object).set(String(row.id), row);
      return copy(row);
    },
    async updateMany(object: string, query: Row, data: Row) {
      writes.push({ object, where: { ...(query?.where as Row) }, data: { ...data } });
      let changed = 0;
      for (const [id, row] of storeFor(object)) {
        if (!matches(row, query?.where)) continue;
        storeFor(object).set(id, { ...row, ...data });
        changed += 1;
      }
      return changed;
    },
    async count(object: string, ast?: Row) {
      return (await this.find(object, ast)).length;
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {},
    async rollback() {},
  };

  return {
    driver,
    seed(object: string, row: Row) { storeFor(object).set(String(row.id), { ...row }); },
    get(object: string, id: string): Row | undefined {
      const row = storeFor(object).get(id);
      return row ? copy(row) : undefined;
    },
    rowsOf(object: string) {
      return Array.from(storeFor(object).values()).map(copy).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    },
    writes,
  };
}

const TEST_PACKAGE_ID = 'com.objectstack.test.rewrap';
const textField = (name: string) => ({ name, label: name, type: 'text' as const });
const objectOf = (name: string, fields: string[], extra: Row = {}) => ({
  name,
  label: name,
  fields: { ...Object.fromEntries(fields.map((f) => [f, textField(f)])), ...extra },
});

const sysSecretObject = objectOf('sys_secret', ['id', 'namespace', 'key', 'kms_key_id', 'alg', 'ciphertext', 'created_at', 'rotated_at'], {
  version: { name: 'version', label: 'version', type: 'number' as const },
});
const sysSettingObject = objectOf('sys_setting', ['id', 'namespace', 'key', 'scope', 'user_id', 'value', 'value_enc']);
const sysMetadataObject = objectOf('sys_metadata', ['id', 'name', 'type', 'scope', 'metadata', 'state']);
/** A business object with a `secret` field: family 2's holder. */
const vaultObject = objectOf('vault_entry', ['id', 'label'], {
  token: { name: 'token', label: 'token', type: 'secret' as const },
});

/** The plaintext each row holds. Never expected in any report. */
const PLAIN = {
  settings: 'smtp-app-password-41',
  objectField: 'vault-token-42',
  datasource: 'pg-password-43',
  orphan: 'retired-value-44',
  conflict: 'shared-value-45',
  multi: 'twice-held-46',
  current: 'already-current-47',
  unknown: 'unknown-derivation-48',
  unreadable: 'other-key-49',
} as const;

const ID = {
  settings: 'sec_rw_settings',
  objectField: 'sec_rw_object_field',
  datasource: 'sec_rw_datasource',
  orphan: 'sec_rw_orphan',
  conflict: 'sec_rw_conflict',
  multi: 'sec_rw_multi',
  current: 'sec_rw_current',
  unknown: 'sec_rw_unknown',
  unreadable: 'sec_rw_unreadable',
} as const;

interface BuildOptions {
  /** Leave the orphan with no holder (default) or give it a settings holder. */
  orphanHeld?: boolean;
  /** Give the conflicting row its second, other-producer holder (default true). */
  conflictSecondHolder?: boolean;
}

async function buildRuntime(opts: BuildOptions = {}) {
  const store = makeDriver();
  const engine = new ObjectQL();
  engine.registerDriver(store.driver as never, true);
  await engine.init();
  for (const object of [sysSecretObject, sysSettingObject, sysMetadataObject, vaultObject]) {
    engine.registry.registerObject(object as never, TEST_PACKAGE_ID);
  }
  const provider = new LocalCryptoProvider({ key: KEY });
  engine.setCryptoProvider(provider as never);

  const seedV1 = (id: string, namespace: string, key: string, plain: string, dataKey?: Buffer) =>
    store.seed('sys_secret', {
      id, namespace, key, kms_key_id: 'local:v1', alg: 'aes-256-gcm', version: 1,
      ciphertext: sealVersion1(plain, namespace, key, dataKey), created_at: '2026-01-01T00:00:00.000Z',
    });
  const setting = (id: string, namespace: string, key: string, handleId: string, extra: Row = {}) =>
    store.seed('sys_setting', { id, namespace, key, scope: 'tenant', user_id: null, value_enc: handleId, ...extra });
  const datasource = (id: string, name: string, handleId: string) =>
    store.seed('sys_metadata', {
      id, name, type: 'datasource', scope: 'platform', state: 'active',
      metadata: JSON.stringify({ name, driver: 'postgres', external: { credentialsRef: `sys_secret:${handleId}` } }),
    });

  // Family 1 — a setting.
  seedV1(ID.settings, 'smtp', 'password', PLAIN.settings);
  setting('set_1', 'smtp', 'password', ID.settings);

  // Family 2 — a `secret:` ref on a business row, under the engine's coordinate.
  seedV1(ID.objectField, 'vault_entry', 'token', PLAIN.objectField);
  store.seed('vault_entry', { id: 'rec_1', label: 'primary', token: `secret:${ID.objectField}` });

  // Family 3 — a datasource credentialsRef, under the binder's coordinate.
  seedV1(ID.datasource, 'datasource', 'reporting', PLAIN.datasource);
  datasource('meta_1', 'reporting', ID.datasource);

  // No holder: an orphan (unless a test gives it one, as its positive control).
  seedV1(ID.orphan, 'smtp', 'retired_token', PLAIN.orphan);
  if (opts.orphanHeld) setting('set_orphan_control', 'smtp', 'retired_token', ID.orphan);

  // Two holders of different producers.
  seedV1(ID.conflict, 'smtp', 'shared_secret', PLAIN.conflict);
  setting('set_conflict', 'smtp', 'shared_secret', ID.conflict);
  if (opts.conflictSecondHolder !== false) datasource('meta_conflict', 'shared', ID.conflict);

  // Two holders of ONE producer: one attribution.
  seedV1(ID.multi, 'mail', 'api_key', PLAIN.multi);
  setting('set_multi_tenant', 'mail', 'api_key', ID.multi);
  setting('set_multi_user', 'mail', 'api_key', ID.multi, { scope: 'user', user_id: 'usr_1' });

  // Already sealed under the current derivation.
  const current = await provider.encrypt(PLAIN.current, { scope: 'settings', namespace: 'mail', key: 'host_token' });
  store.seed('sys_secret', {
    id: ID.current, namespace: 'mail', key: 'host_token', kms_key_id: current.kmsKeyId, alg: current.alg,
    version: current.version, ciphertext: current.ciphertext,
  });
  setting('set_current', 'mail', 'host_token', ID.current);

  // A derivation the provider does not know.
  store.seed('sys_secret', {
    id: ID.unknown, namespace: 'mail', key: 'future_token', kms_key_id: 'local:v1', alg: 'aes-256-gcm',
    version: 1, ciphertext: 'v9:' + sealVersion1(PLAIN.unknown, 'mail', 'future_token'),
  });
  setting('set_unknown', 'mail', 'future_token', ID.unknown);

  // Version 1, but sealed under a key this deployment does not hold.
  seedV1(ID.unreadable, 'mail', 'lost_token', PLAIN.unreadable, randomBytes(32));
  setting('set_unreadable', 'mail', 'lost_token', ID.unreadable);

  const binder = createDatasourceSecretBinder({ engine: engine as never, cryptoProvider: provider as never });
  return { store, engine, provider, binder };
}

type Runtime = Awaited<ReturnType<typeof buildRuntime>>;

const secretRowsOf = (rt: Runtime): RewrapSecretRow[] =>
  rt.store.rowsOf('sys_secret').map((r) => ({
    id: String(r.id), namespace: String(r.namespace), key: String(r.key),
    kms_key_id: r.kms_key_id, alg: r.alg, version: r.version, ciphertext: r.ciphertext,
  }));

/**
 * Plan from the store as it stands now, as the command does on every run.
 * `undefined` is the host NOT answering for its code-declared datasources, so
 * it is passed through as it is, never defaulted to `[]`.
 */
async function planNow(rt: Runtime, declaredDatasources: readonly Row[] | undefined) {
  const union = await collectSecretReferenceUnion({
    engine: rt.engine as unknown as SecretReferenceEngineLike,
    declaredDatasources,
  });
  return planSysSecretRewrap({ secrets: secretRowsOf(rt), union, derivationOf: ciphertextDerivationStatus });
}

async function runNow(
  rt: Runtime,
  opts: { apply: boolean; provider?: RewrapProviderLike; writer?: RewrapWriterLike | null; declared?: readonly Row[] | undefined } = { apply: true },
) {
  const plan = await planNow(rt, 'declared' in opts ? opts.declared : []);
  const writer = opts.apply
    ? (opts.writer !== undefined ? opts.writer : asCompareAndSetWriter(rt.store.driver))
    : null;
  const result = await executeSysSecretRewrap({
    plan,
    provider: opts.provider ?? rt.provider,
    derivationOf: ciphertextDerivationStatus,
    writer,
  });
  return { plan, result };
}

/** A provider wrapper that records which handles were opened or re-sealed. */
function recordingProvider(inner: RewrapProviderLike) {
  const rotated: string[] = [];
  const opened: string[] = [];
  const provider: RewrapProviderLike = {
    async decrypt(handle, ctx) { opened.push(handle.id); return inner.decrypt(handle, ctx); },
    async rotateKey(handle, ctx) { rotated.push(handle.id); return inner.rotateKey(handle, ctx); },
  };
  return { provider, rotated, opened };
}

const settingsCtx = (namespace: string, key: string): CryptoContext => ({ scope: 'settings', namespace, key });

describe('ADR-0128 §4.2 — the scope comes from the holder', () => {
  it('maps each holder family to its own producer scope, one to one, onto the closed scope set', () => {
    expect(SCOPE_OF_HOLDER_FAMILY).toEqual({
      settings: 'settings',
      'object-field': 'object_secret_field',
      datasource: 'datasource_credential',
    });
    expect(Object.keys(SCOPE_OF_HOLDER_FAMILY).sort()).toEqual([...SECRET_REFERENCE_FAMILIES].sort());
    expect(Object.values(SCOPE_OF_HOLDER_FAMILY).sort()).toEqual([...CRYPTO_CONTEXT_SCOPES].sort());
  });

  it('re-wraps every attributable version-1 row, and each producer then opens its own row through its own read path', async () => {
    const rt = await buildRuntime();
    const { plan, result } = await runNow(rt, { apply: true });

    expect(plan.refusal).toBeNull();
    expect(result.byClass).toMatchObject({
      rewrap: 4, done: 1, left_orphan: 1, left_conflicting_scope: 1, left_union_incomplete: 0,
      refused_unreadable: 1, refused_unknown_derivation: 1, refused_verify_failed: 0,
      write_conflict: 0, write_failed: 0,
    });
    expect(result.rewrapByScope).toEqual({ settings: 2, object_secret_field: 1, datasource_credential: 1 });
    expect(result.total).toBe(9);

    for (const id of [ID.settings, ID.objectField, ID.datasource, ID.multi]) {
      const row = rt.store.get('sys_secret', id)!;
      expect(ciphertextDerivationStatus(row.ciphertext), id).toBe('current');
      expect(row.version, id).toBe(2);
      expect(typeof row.rotated_at, id).toBe('string');
    }

    // The engine's secret-field read path, under its own scope.
    expect(await rt.engine.resolveSecret(`secret:${ID.objectField}`)).toBe(PLAIN.objectField);
    // The datasource binder's read path, under its own scope.
    expect(await rt.binder.resolve(`sys_secret:${ID.datasource}`)).toBe(PLAIN.datasource);
    // The settings service's context: the setting row's own coordinate, scope `settings`.
    const opened = (id: string, ctx: CryptoContext) => {
      const r = rt.store.get('sys_secret', id)!;
      const handle: CryptoHandle = {
        id, kmsKeyId: String(r.kms_key_id), alg: String(r.alg), version: Number(r.version), ciphertext: String(r.ciphertext),
      };
      return rt.provider.decrypt(handle, ctx);
    };
    expect(await opened(ID.settings, settingsCtx('smtp', 'password'))).toBe(PLAIN.settings);
    expect(await opened(ID.multi, settingsCtx('mail', 'api_key'))).toBe(PLAIN.multi);

    // And now bound: no OTHER producer's context opens any of them.
    const sealedAs: Array<[string, CryptoContext]> = [
      [ID.settings, settingsCtx('smtp', 'password')],
      [ID.objectField, { scope: 'object_secret_field', namespace: 'vault_entry', key: 'token' }],
      [ID.datasource, { scope: 'datasource_credential', namespace: 'datasource', key: 'reporting' }],
    ];
    for (const [id, ctx] of sealedAs) {
      for (const scope of CRYPTO_CONTEXT_SCOPES) {
        if (scope === ctx.scope) continue;
        await expect(opened(id, { ...ctx, scope }), `${id} under ${scope}`).rejects.toThrow();
      }
    }
  });

  it('an ORPHAN is left exactly as it is — never re-sealed under a guessed scope', async () => {
    const rt = await buildRuntime();
    const before = rt.store.get('sys_secret', ID.orphan);
    const rec = recordingProvider(rt.provider);

    const { result } = await runNow(rt, { apply: true, provider: rec.provider });

    expect(result.byClass.left_orphan).toBe(1);
    expect(rt.store.get('sys_secret', ID.orphan)).toEqual(before);
    expect(rec.rotated).not.toContain(ID.orphan);
    expect(rec.opened).not.toContain(ID.orphan);
    expect(rt.store.writes.map((w) => w.where.id)).not.toContain(ID.orphan);

    // POSITIVE CONTROL: the same row, once a holder references it, IS re-wrapped.
    const held = await buildRuntime({ orphanHeld: true });
    const control = await runNow(held, { apply: true });
    expect(control.result.byClass.left_orphan).toBe(0);
    expect(ciphertextDerivationStatus(held.store.get('sys_secret', ID.orphan)!.ciphertext)).toBe('current');
  });

  it('holders of DIFFERENT producers leave the row as it is', async () => {
    const rt = await buildRuntime();
    const before = rt.store.get('sys_secret', ID.conflict);
    const rec = recordingProvider(rt.provider);

    const { result } = await runNow(rt, { apply: true, provider: rec.provider });

    expect(result.byClass.left_conflicting_scope).toBe(1);
    expect(rt.store.get('sys_secret', ID.conflict)).toEqual(before);
    expect(rec.rotated).not.toContain(ID.conflict);

    // POSITIVE CONTROL: with only its settings holder, the same row is re-wrapped.
    const single = await buildRuntime({ conflictSecondHolder: false });
    await runNow(single, { apply: true });
    expect(ciphertextDerivationStatus(single.store.get('sys_secret', ID.conflict)!.ciphertext)).toBe('current');
  });

  it('several holders of ONE producer are one attribution: the row is re-wrapped once', async () => {
    const rt = await buildRuntime();
    await runNow(rt, { apply: true });
    expect(rt.store.writes.filter((w) => w.where.id === ID.multi)).toHaveLength(1);
    expect(rt.store.get('sys_secret', ID.multi)!.version).toBe(2);
  });

  it('an INCOMPLETE union attributes nothing: every version-1 row is left, and nothing is opened or written', async () => {
    const rt = await buildRuntime();
    const before = rt.store.rowsOf('sys_secret');
    const rec = recordingProvider(rt.provider);

    // The host did not answer for its code-declared datasources: a declared gap.
    const { plan, result } = await runNow(rt, { apply: true, provider: rec.provider, declared: undefined });

    expect(plan.refusal?.gaps.map((g) => g.family)).toEqual(['datasource']);
    expect(plan.attempts).toBe(0);
    // The conflict is still a conflict (a missing family adds holders, never removes one).
    expect(result.byClass).toMatchObject({
      rewrap: 0, left_union_incomplete: 6, left_conflicting_scope: 1, done: 1, refused_unknown_derivation: 1,
    });
    expect(rec.opened).toEqual([]);
    expect(rt.store.writes).toEqual([]);
    expect(rt.store.rowsOf('sys_secret')).toEqual(before);

    // The single-row decision, read directly.
    const one = new Set<CryptoContextScope>(['settings']);
    expect(attributeRewrapScope(one, false)).toEqual({ left: 'left_union_incomplete' });
    expect(attributeRewrapScope(one, true)).toEqual({ scope: 'settings' });
  });
});

describe('ADR-0128 §4.2 — resumable, live-safe, fail-closed', () => {
  it('RESUMABLE: a run stopped part-way is re-run and finishes the rest; a finished run writes nothing', async () => {
    const rt = await buildRuntime();
    const real = asCompareAndSetWriter(rt.store.driver)!;
    let calls = 0;
    let stoppedAt = '';
    // The run dies at its second write: that row, and only that row, is not written.
    const dying: RewrapWriterLike = {
      async updateMany(object, query, data) {
        calls += 1;
        if (calls === 2) {
          stoppedAt = String((query.where as Row).id);
          throw new Error('the process was stopped here');
        }
        return real.updateMany(object, query, data);
      },
    };
    const first = await runNow(rt, { apply: true, writer: dying });
    expect(first.result.byClass.rewrap).toBe(3);
    expect(first.result.byClass.write_failed).toBe(1);
    expect(rewrapUnfinished(first.result)).toBe(true);
    expect([ID.settings, ID.objectField, ID.datasource, ID.multi]).toContain(stoppedAt);
    expect(ciphertextDerivationStatus(rt.store.get('sys_secret', stoppedAt)!.ciphertext)).toBe('superseded');

    // Re-run: the three already done are skipped, the one left behind is finished.
    const second = await runNow(rt, { apply: true });
    expect(second.result.byClass.rewrap).toBe(1);
    expect(second.result.byClass.done).toBe(1 + 3);
    expect(ciphertextDerivationStatus(rt.store.get('sys_secret', stoppedAt)!.ciphertext)).toBe('current');

    // Idempotent: a third run re-wraps nothing and writes nothing.
    const writesBefore = rt.store.writes.length;
    const third = await runNow(rt, { apply: true });
    expect(third.result.byClass.rewrap).toBe(0);
    expect(third.result.byClass.done).toBe(5);
    expect(rt.store.writes.length).toBe(writesBefore);
  });

  it('LIVE-SAFE: a row a producer changed between the read and the write is not overwritten', async () => {
    const rt = await buildRuntime();
    const real = asCompareAndSetWriter(rt.store.driver)!;
    const concurrent = 'v2:written-by-a-producer-during-the-run';
    // A producer writes the row while this run holds its re-seal, just before the write lands.
    const racing: RewrapWriterLike = {
      async updateMany(object, query, data) {
        const where = query.where as Row;
        if (where.id === ID.settings) {
          const row = rt.store.get('sys_secret', ID.settings)!;
          rt.store.seed('sys_secret', { ...row, ciphertext: concurrent, version: 7 });
        }
        return real.updateMany(object, query, data);
      },
    };

    const { result } = await runNow(rt, { apply: true, writer: racing });

    expect(result.byClass.write_conflict).toBe(1);
    expect(rt.store.get('sys_secret', ID.settings)).toMatchObject({ ciphertext: concurrent, version: 7 });
    expect(rewrapUnfinished(result)).toBe(true);
    // POSITIVE CONTROL: the other rows in the same run were written.
    expect(result.byClass.rewrap).toBe(3);
    // The write was conditional on the exact ciphertext this run read.
    const write = rt.store.writes.find((w) => w.where.id === ID.settings)!;
    expect(Object.keys(write.where).sort()).toEqual(['ciphertext', 'id']);
    expect(ciphertextDerivationStatus(write.where.ciphertext)).toBe('superseded');
  });

  it('FAILS CLOSED: a row that does not open is not written, and the run finishes the rest', async () => {
    const rt = await buildRuntime();
    const before = rt.store.get('sys_secret', ID.unreadable);

    const { result } = await runNow(rt, { apply: true });

    expect(result.byClass.refused_unreadable).toBe(1);
    expect(rt.store.get('sys_secret', ID.unreadable)).toEqual(before);
    expect(rt.store.writes.map((w) => w.where.id)).not.toContain(ID.unreadable);
    expect(rewrapUnfinished(result)).toBe(true);
    // The rest of the run still happened.
    expect(result.byClass.rewrap).toBe(4);
  });

  it('FAILS CLOSED: an unknown derivation is refused, not opened and not written', async () => {
    const rt = await buildRuntime();
    const before = rt.store.get('sys_secret', ID.unknown);
    const rec = recordingProvider(rt.provider);

    const { result } = await runNow(rt, { apply: true, provider: rec.provider });

    expect(result.byClass.refused_unknown_derivation).toBe(1);
    expect(rec.opened).not.toContain(ID.unknown);
    expect(rt.store.get('sys_secret', ID.unknown)).toEqual(before);
  });

  it('VERIFY BEFORE WRITE: a re-seal that does not open to the same plaintext is never written', async () => {
    const rt = await buildRuntime();
    const before = rt.store.get('sys_secret', ID.settings);
    // A re-seal that is well-formed, current, keeps the id and opens under
    // the same scope — but to a DIFFERENT value.
    const drifting: RewrapProviderLike = {
      decrypt: (h, c) => rt.provider.decrypt(h, c),
      async rotateKey(handle, ctx) {
        if (handle.id !== ID.settings) return rt.provider.rotateKey(handle, ctx);
        const next = await rt.provider.encrypt('not-the-stored-value', ctx);
        return { ...next, id: handle.id, version: handle.version + 1 };
      },
    };

    const { result } = await runNow(rt, { apply: true, provider: drifting });

    expect(result.byClass.refused_verify_failed).toBe(1);
    expect(rt.store.get('sys_secret', ID.settings)).toEqual(before);
    expect(rt.store.writes.map((w) => w.where.id)).not.toContain(ID.settings);
    expect(rewrapUnfinished(result)).toBe(true);

    // A re-seal that does not open at all is refused the same way.
    const rt2 = await buildRuntime();
    const before2 = rt2.store.get('sys_secret', ID.settings);
    const broken: RewrapProviderLike = {
      decrypt: (h, c) => rt2.provider.decrypt(h, c),
      async rotateKey(handle, ctx) {
        const next = await rt2.provider.rotateKey(handle, ctx);
        return handle.id === ID.settings ? { ...next, ciphertext: next.ciphertext.slice(0, -6) + 'AAAAAA' } : next;
      },
    };
    const second = await runNow(rt2, { apply: true, provider: broken });
    expect(second.result.byClass.refused_verify_failed).toBe(1);
    expect(rt2.store.get('sys_secret', ID.settings)).toEqual(before2);

    // POSITIVE CONTROL: the honest provider re-wraps the same row.
    const rt3 = await buildRuntime();
    await runNow(rt3, { apply: true });
    expect(ciphertextDerivationStatus(rt3.store.get('sys_secret', ID.settings)!.ciphertext)).toBe('current');
  });

  it('DRY RUN: the same classes as --apply, and nothing is written', async () => {
    const rt = await buildRuntime();
    const before = rt.store.rowsOf('sys_secret');

    const dry = await runNow(rt, { apply: false });

    expect(rt.store.writes).toEqual([]);
    expect(rt.store.rowsOf('sys_secret')).toEqual(before);
    expect(rewrapUnfinished(dry.result)).toBe(true); // the refused rows read the same as under --apply

    // POSITIVE CONTROL: --apply over the same store lands exactly what the dry run counted.
    const applied = await runNow(rt, { apply: true });
    expect(applied.result.byClass).toEqual(dry.result.byClass);
    expect(rt.store.writes).toHaveLength(dry.result.byClass.rewrap);
  });

  it('refuses a driver that cannot write conditionally', () => {
    expect(asCompareAndSetWriter({ async find() { return []; } })).toBeNull();
    expect(asCompareAndSetWriter({ updateMany: 'yes' })).toBeNull();
    expect(asCompareAndSetWriter(undefined)).toBeNull();
    const able = { async updateMany() { return 1; } };
    expect(asCompareAndSetWriter(able)).toBe(able);
  });
});

describe('ADR-0128 §4.2 — what leaves the run', () => {
  it('the report carries classes and counts only: no plaintext, no ciphertext, no row id, no holder coordinate', async () => {
    const rt = await buildRuntime();
    const rowsBefore = rt.store.rowsOf('sys_secret');
    const { plan, result } = await runNow(rt, { apply: true });
    const report = buildRewrapReport({ mode: 'apply', plan, result, keySource: rt.provider.keySource });
    const text = JSON.stringify(report);

    for (const plain of Object.values(PLAIN)) expect(text).not.toContain(plain);
    for (const id of Object.values(ID)) expect(text).not.toContain(id);
    for (const row of [...rowsBefore, ...rt.store.rowsOf('sys_secret')]) {
      expect(text).not.toContain(String(row.ciphertext));
    }
    for (const holder of ['set_1', 'rec_1', 'meta_1', 'vault_entry', 'reporting', 'smtp']) {
      expect(text).not.toContain(holder);
    }
    // Not vacuous: the report does carry the counts.
    expect(report.counts).toEqual({ total: 9, rewrap: 4, done: 1, left: 2, refused: 2, notWritten: 0 });
    expect(Object.keys(report.byClass)).toEqual([...REWRAP_CLASSES]);
    expect(report.keySource).toBe('explicit');
  });
});
