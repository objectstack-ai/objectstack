// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Secret-field channel — end-to-end against a REAL {@link ObjectQL} engine + a
 * minimal in-memory driver. Verifies the core encryption chain:
 *  - encrypt-on-write: plaintext → sys_secret ciphertext + opaque ref on the row
 *  - mask-on-read: the generic read path never returns plaintext or the ref
 *  - resolveSecret: privileged dereference round-trips back to plaintext
 *  - fail-closed: no CryptoProvider ⇒ writing a secret field throws
 *  - update semantics: change re-encrypts; echoed mask is a no-op; null clears
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { SECRET_MASK, isSecretRef } from './secret-fields.js';
import type { ICryptoProvider, CryptoHandle, CryptoContext } from '@objectstack/spec/contracts';

// ---- minimal in-memory driver (equality-only WHERE) -----------------------
function makeMemoryDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
    },
    findStream() { throw new Error('not implemented'); },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) throw new Error(`not found: ${object}/${id}`);
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return updated;
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      if (id && storeFor(object).has(id)) return this.update(object, id, data);
      return this.create(object, data);
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, stores };
}

// ---- fake reversible crypto provider (base64 wrap) ------------------------
function makeFakeCrypto() {
  let n = 0;
  const calls: { encrypt: number; decrypt: number } = { encrypt: 0, decrypt: 0 };
  const provider: ICryptoProvider = {
    async encrypt(plain: string, _ctx: CryptoContext): Promise<CryptoHandle> {
      calls.encrypt += 1;
      n += 1;
      return {
        id: `sec_${n}`,
        kmsKeyId: 'local',
        alg: 'test-b64',
        version: 1,
        ciphertext: Buffer.from(plain, 'utf8').toString('base64'),
      };
    },
    async decrypt(handle: CryptoHandle, _ctx: CryptoContext): Promise<string> {
      calls.decrypt += 1;
      return Buffer.from(handle.ciphertext, 'base64').toString('utf8');
    },
    async rotateKey(handle: CryptoHandle): Promise<CryptoHandle> {
      return { ...handle, version: handle.version + 1 };
    },
    digest(plain: string): string { return `d:${plain.length}`; },
  };
  return { provider, calls };
}

const sysSecretObject = {
  name: 'sys_secret', label: 'Secret',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const },
    namespace: { name: 'namespace', label: 'Namespace', type: 'text' as const },
    key: { name: 'key', label: 'Key', type: 'text' as const },
    kms_key_id: { name: 'kms_key_id', label: 'KMS', type: 'text' as const },
    alg: { name: 'alg', label: 'Alg', type: 'text' as const },
    version: { name: 'version', label: 'Version', type: 'number' as const },
    ciphertext: { name: 'ciphertext', label: 'Ciphertext', type: 'text' as const },
    created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
  },
};

const dsObject = {
  name: 'ext_datasource', label: 'Datasource',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    db_password: { name: 'db_password', label: 'DB Password', type: 'secret' as const },
  },
};

async function buildEngine(withCrypto: boolean) {
  const engine = new ObjectQL();
  const { driver, stores } = makeMemoryDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(sysSecretObject as any);
  engine.registry.registerObject(dsObject as any);
  const crypto = makeFakeCrypto();
  if (withCrypto) engine.setCryptoProvider(crypto.provider);
  return { engine, stores, crypto };
}

describe('objectql secret-field channel', () => {
  let ctx: Awaited<ReturnType<typeof buildEngine>>;
  beforeEach(async () => { ctx = await buildEngine(true); });

  it('encrypts on write: row stores a ref, sys_secret holds ciphertext, no cleartext on the row', async () => {
    const created = await ctx.engine.insert('ext_datasource', { name: 'pg', db_password: 's3cr3t' });

    // Returned/persisted business row holds a ref, never the plaintext.
    const stored = ctx.stores.get('ext_datasource')!.get(created.id) as any;
    expect(isSecretRef(stored.db_password)).toBe(true);
    expect(stored.db_password).not.toContain('s3cr3t');

    // sys_secret got exactly one ciphertext row, keyed by object/field.
    const secrets = Array.from(ctx.stores.get('sys_secret')!.values()) as any[];
    expect(secrets).toHaveLength(1);
    expect(secrets[0].namespace).toBe('ext_datasource');
    expect(secrets[0].key).toBe('db_password');
    expect(secrets[0].ciphertext).not.toContain('s3cr3t');
    expect(ctx.crypto.calls.encrypt).toBe(1);
  });

  it('masks on read: find / findOne never return plaintext or the ref', async () => {
    const created = await ctx.engine.insert('ext_datasource', { name: 'pg', db_password: 's3cr3t' });

    const viaFind = (await ctx.engine.find('ext_datasource', { where: { id: created.id } }))[0] as any;
    expect(viaFind.db_password).toBe(SECRET_MASK);

    const viaOne = await ctx.engine.findOne('ext_datasource', { where: { id: created.id } }) as any;
    expect(viaOne.db_password).toBe(SECRET_MASK);
  });

  it('resolveSecret round-trips a stored ref back to plaintext', async () => {
    const created = await ctx.engine.insert('ext_datasource', { name: 'pg', db_password: 's3cr3t' });
    const stored = ctx.stores.get('ext_datasource')!.get(created.id) as any;

    const plain = await ctx.engine.resolveSecret(stored.db_password);
    expect(plain).toBe('s3cr3t');
    expect(ctx.crypto.calls.decrypt).toBe(1);
  });

  it('fail-closed: writing a secret field with no CryptoProvider throws', async () => {
    const bare = await buildEngine(false);
    await expect(
      bare.engine.insert('ext_datasource', { name: 'pg', db_password: 'nope' }),
    ).rejects.toThrow(/no CryptoProvider/i);
    // Nothing leaked into either store.
    expect(bare.stores.get('ext_datasource')?.size ?? 0).toBe(0);
    expect(bare.stores.get('sys_secret')?.size ?? 0).toBe(0);
  });

  it('update: changing the secret re-encrypts into a new sys_secret row', async () => {
    const created = await ctx.engine.insert('ext_datasource', { name: 'pg', db_password: 'old' });
    await ctx.engine.update('ext_datasource', { id: created.id, db_password: 'new' });

    expect(ctx.crypto.calls.encrypt).toBe(2);
    const stored = ctx.stores.get('ext_datasource')!.get(created.id) as any;
    const plain = await ctx.engine.resolveSecret(stored.db_password);
    expect(plain).toBe('new');
  });

  it('update: echoing the read mask back does NOT overwrite the stored secret', async () => {
    const created = await ctx.engine.insert('ext_datasource', { name: 'pg', db_password: 'keep' });
    const refBefore = (ctx.stores.get('ext_datasource')!.get(created.id) as any).db_password;

    // Simulate a form round-trip: user changes name, secret field still shows the mask.
    await ctx.engine.update('ext_datasource', { id: created.id, name: 'renamed', db_password: SECRET_MASK });

    const after = ctx.stores.get('ext_datasource')!.get(created.id) as any;
    expect(after.name).toBe('renamed');
    expect(after.db_password).toBe(refBefore); // unchanged
    expect(ctx.crypto.calls.encrypt).toBe(1);   // no re-encrypt
  });

  it('non-secret objects are untouched (no crypto cost)', async () => {
    engineWithoutSecretField: {
      const engine = new ObjectQL();
      const { driver, stores } = makeMemoryDriver();
      engine.registerDriver(driver, true);
      await engine.init();
      engine.registry.registerObject({
        name: 'plain', label: 'Plain',
        fields: { id: { name: 'id', type: 'text' as const }, title: { name: 'title', type: 'text' as const } },
      } as any);
      // No crypto provider, but no secret field ⇒ must not throw.
      const row = await engine.insert('plain', { title: 'hello' });
      const back = await engine.findOne('plain', { where: { id: row.id } }) as any;
      expect(back.title).toBe('hello');
      void stores;
    }
  });
});
