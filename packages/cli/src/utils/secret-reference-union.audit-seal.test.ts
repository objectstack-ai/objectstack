// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0154 D2, D6 — family 4 of the `sys_secret` reference union: the audit
 * ledger sealer's handles (a checkpoint's seed, a signing key's private half).
 *
 * A handle this family missed is one `os secret rewrap` leaves behind, and
 * after a master-key change every checkpoint whose seed it holds stops
 * verifying. So each side of the family is pinned separately:
 *
 *  - holders REGISTERED: every handle arrives, with the `(namespace, key)` the
 *    producer seals it under, so a holder report judges it in place;
 *  - holders NOT registered and no `audit_seal` row in `sys_secret`: the family
 *    is enumerated and EMPTY — a deployment that never sealed anything still
 *    gets a complete union;
 *  - holders NOT registered but an `audit_seal` row exists: a GAP, so no
 *    reader takes that row for unreferenced.
 *
 * The `sys_secret` rows are minted by the REAL `LocalCryptoProvider` under the
 * producer's own contexts (`checkpointSeedContext`, `signingKeyContext`); the
 * holder objects are registered under the producer's own names, with the
 * columns the family reads.
 */

import { randomBytes } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { LocalCryptoProvider } from '@objectstack/service-settings';
import {
  AUDIT_SEAL_SECRET_HOLDERS,
  checkpointSeedContext,
  signingKeyContext,
} from '@objectstack/plugin-audit';
import type { CryptoContext } from '@objectstack/spec/contracts';
import {
  assertSecretReferenceUnionComplete,
  collectAuditSealSecretReferences,
  collectSecretReferenceUnion,
  IncompleteSecretReferenceUnionError,
  type SecretReferenceEngineLike,
} from './secret-reference-union.js';

type Row = Record<string, unknown>;

/** Read verbs only, plus the bound the `check:objectql-double-limit` gate asks of a `find` double. */
function makeDriver() {
  const stores = new Map<string, Map<string, Row>>();
  const storeFor = (object: string) => {
    let s = stores.get(object);
    if (!s) { s = new Map(); stores.set(object, s); }
    return s;
  };
  let throwOnFind: string | undefined;
  const driver = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast?: Row) {
      if (throwOnFind === object) throw new Error('table is locked');
      const matched = Array.from(storeFor(object).values());
      const page = typeof ast?.limit === 'number' ? matched.slice(0, ast.limit) : matched;
      return page.map((r) => ({ ...r }));
    },
    async count(object: string) { return storeFor(object).size; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {},
    async rollback() {},
  };
  return {
    driver,
    seed(object: string, row: Row) { storeFor(object).set(String(row.id), { ...row }); },
    failReadsOf(object: string) { throwOnFind = object; },
  };
}

const textField = (name: string) => ({ name, label: name, type: 'text' as const });
const sysSecretObject = {
  name: 'sys_secret',
  label: 'Secret',
  fields: {
    ...Object.fromEntries(['id', 'namespace', 'key', 'kms_key_id', 'alg', 'ciphertext'].map((f) => [f, textField(f)])),
    version: { name: 'version', label: 'version', type: 'number' as const },
  },
};

/** The holder objects, named by the producer's own list rather than restated here. */
const [CHECKPOINT_HOLDER, SIGNING_KEY_HOLDER] = AUDIT_SEAL_SECRET_HOLDERS;

const checkpointObject = {
  name: CHECKPOINT_HOLDER.object,
  label: 'Audit Checkpoint',
  fields: {
    ...Object.fromEntries(['id', 'sealed_object', 'tenant_id', 'seed_handle'].map((f) => [f, textField(f)])),
    sequence: { name: 'sequence', label: 'sequence', type: 'number' as const },
  },
};
const signingKeyObject = {
  name: SIGNING_KEY_HOLDER.object,
  label: 'Audit Signing Key',
  fields: Object.fromEntries(['id', 'fingerprint', 'private_handle'].map((f) => [f, textField(f)])),
};

const PACKAGE_ID = 'com.objectstack.test.audit-seal-family';

async function buildRuntime(opts: { registerHolders: boolean }) {
  const store = makeDriver();
  const engine = new ObjectQL();
  engine.registerDriver(store.driver as never, true);
  await engine.init();
  const objects: unknown[] = [sysSecretObject];
  if (opts.registerHolders) objects.push(checkpointObject, signingKeyObject);
  for (const object of objects) engine.registry.registerObject(object as never, PACKAGE_ID);
  const crypto = new LocalCryptoProvider({ mode: 'test' });

  /** Mint a `sys_secret` row the way the producer does: the real provider, the producer's own context. */
  const mint = async (plaintext: string, ctx: CryptoContext) => {
    const handle = await crypto.encrypt(plaintext, ctx);
    store.seed('sys_secret', {
      id: handle.id, namespace: ctx.namespace, key: ctx.key,
      kms_key_id: handle.kmsKeyId, alg: handle.alg, version: handle.version, ciphertext: handle.ciphertext,
    });
    return handle.id;
  };

  return { engine: engine as unknown as SecretReferenceEngineLike, store, mint };
}

/** One checkpoint's seed and one signing key, each held by its row. */
async function sealSomething(rt: Awaited<ReturnType<typeof buildRuntime>>, holders: boolean) {
  const seedCtx = checkpointSeedContext('sys_audit_log', 'org_1', 0);
  const seedHandle = await rt.mint(randomBytes(32).toString('base64'), seedCtx);
  const fingerprint = 'ab'.repeat(32);
  const keyCtx = signingKeyContext(fingerprint);
  const privateHandle = await rt.mint('private-half-placeholder', keyCtx);
  if (holders) {
    rt.store.seed('sys_audit_checkpoint', { id: 'cp_1', sealed_object: 'sys_audit_log', tenant_id: 'org_1', sequence: 0, seed_handle: seedHandle });
    rt.store.seed('sys_audit_signing_key', { id: 'key_1', fingerprint, private_handle: privateHandle });
  }
  return { seedHandle, privateHandle, seedCtx, keyCtx };
}

describe('family 4 (audit-seal) — holders registered', () => {
  it('returns both handles, each with the pair the producer sealed it under', async () => {
    const rt = await buildRuntime({ registerHolders: true });
    const { seedHandle, privateHandle, seedCtx, keyCtx } = await sealSomething(rt, true);

    const result = await collectAuditSealSecretReferences(rt.engine);
    expect(result.status).toBe('enumerated');
    const byHandle = new Map(result.references.map((r) => [r.handleId, r]));
    expect([...byHandle.keys()].sort()).toEqual([seedHandle, privateHandle].sort());
    expect(byHandle.get(seedHandle)?.column).toEqual({
      object: 'sys_audit_checkpoint', field: 'seed_handle', record: 'cp_1',
      mintedPair: { namespace: seedCtx.namespace, key: seedCtx.key },
    });
    expect(byHandle.get(privateHandle)?.column).toEqual({
      object: 'sys_audit_signing_key', field: 'private_handle', record: 'key_1',
      mintedPair: { namespace: keyCtx.namespace, key: keyCtx.key },
    });
  });

  it('arrives in the full union, so a sweep never reads a live seed as unreferenced', async () => {
    const rt = await buildRuntime({ registerHolders: true });
    const { seedHandle, privateHandle } = await sealSomething(rt, true);

    const union = await collectSecretReferenceUnion({ engine: rt.engine, declaredDatasources: [] });
    expect(union.families['audit-seal'].status).toBe('enumerated');
    expect(union.handleIds.has(seedHandle)).toBe(true);
    expect(union.handleIds.has(privateHandle)).toBe(true);
  });

  it.each([
    ['an empty text', ''],
    ['a blank text', ' '],
  ] as const)('names no minted pair for a checkpoint whose sequence is %s, never the pair of sequence 0', async (_label, sequence) => {
    const rt = await buildRuntime({ registerHolders: true });
    const seedHandle = await rt.mint('seed', checkpointSeedContext('sys_audit_log', null, 0));
    rt.store.seed('sys_audit_checkpoint', { id: 'cp_bad', sealed_object: 'sys_audit_log', tenant_id: null, sequence, seed_handle: seedHandle });

    const result = await collectAuditSealSecretReferences(rt.engine);
    expect(result.status).toBe('enumerated');
    const ref = result.references.find((r) => r.handleId === seedHandle);
    expect(ref?.column).toMatchObject({ object: 'sys_audit_checkpoint', record: 'cp_bad', mintedPair: null });
  });

  it('reads a sequence a driver hands back as decimal text', async () => {
    const rt = await buildRuntime({ registerHolders: true });
    const ctx = checkpointSeedContext('sys_audit_log', 'org_1', 3);
    const seedHandle = await rt.mint('seed', ctx);
    rt.store.seed('sys_audit_checkpoint', { id: 'cp_3', sealed_object: 'sys_audit_log', tenant_id: 'org_1', sequence: '3', seed_handle: seedHandle });

    const result = await collectAuditSealSecretReferences(rt.engine);
    expect(result.references.find((r) => r.handleId === seedHandle)?.column).toMatchObject({
      mintedPair: { namespace: ctx.namespace, key: ctx.key },
    });
  });

  it('is a gap when a holder cannot be read', async () => {
    const rt = await buildRuntime({ registerHolders: true });
    await sealSomething(rt, true);
    rt.store.failReadsOf('sys_audit_checkpoint');

    const result = await collectAuditSealSecretReferences(rt.engine);
    expect(result.status).toBe('gap');
    expect(result.status === 'gap' && result.reason).toContain('sys_audit_checkpoint');
  });
});

describe('family 4 (audit-seal) — holders not registered', () => {
  it('with no audit_seal row in sys_secret, is enumerated and empty: the union stays complete', async () => {
    const rt = await buildRuntime({ registerHolders: false });
    // Another producer's row, which must not read as audit-seal evidence.
    await rt.mint('smtp-password', { scope: 'settings', namespace: 'smtp', key: 'password' });

    const result = await collectAuditSealSecretReferences(rt.engine);
    expect(result).toEqual({ family: 'audit-seal', status: 'enumerated', references: [] });

    const union = await collectSecretReferenceUnion({ engine: rt.engine, declaredDatasources: [] });
    expect(union.families['audit-seal'].status).toBe('enumerated');
  });

  it.each([
    ['a checkpoint seed', 'seed'],
    ['a signing key private half', 'key'],
  ] as const)('with %s in sys_secret, is a GAP and the union refuses', async (_label, which) => {
    const rt = await buildRuntime({ registerHolders: false });
    if (which === 'seed') await rt.mint('seed', checkpointSeedContext('sys_audit_log', null, 3));
    else await rt.mint('private', signingKeyContext('cd'.repeat(32)));

    const result = await collectAuditSealSecretReferences(rt.engine);
    expect(result.status).toBe('gap');
    expect(result.status === 'gap' && result.reason).toContain('1 sys_secret row(s) carry an audit-seal coordinate');

    const union = await collectSecretReferenceUnion({ engine: rt.engine, declaredDatasources: [] });
    expect(union.complete).toBe(false);
    expect(union.gaps.map((g) => g.family)).toContain('audit-seal');
    expect(() => assertSecretReferenceUnionComplete(union)).toThrow(IncompleteSecretReferenceUnionError);
  });

  it('reaches a verdict, instead of throwing, over a sys_secret key with no canonical form', async () => {
    const rt = await buildRuntime({ registerHolders: false });
    // A row whose key parses to ["<unpaired surrogate>", 0]: no producer
    // context can build it, so it is no audit-seal evidence, and the family
    // must still answer rather than abort the command.
    rt.store.seed('sys_secret', { id: 'sec_odd', namespace: 'sys_audit_log', key: '["\\ud800",0]', ciphertext: 'x' });

    await expect(collectAuditSealSecretReferences(rt.engine)).resolves.toEqual({
      family: 'audit-seal', status: 'enumerated', references: [],
    });
  });

  it('is a gap when sys_secret itself cannot be read to look for evidence', async () => {
    const rt = await buildRuntime({ registerHolders: false });
    rt.store.failReadsOf('sys_secret');

    const result = await collectAuditSealSecretReferences(rt.engine);
    expect(result.status).toBe('gap');
    expect(result.status === 'gap' && result.reason).toContain('sys_secret');
  });
});
