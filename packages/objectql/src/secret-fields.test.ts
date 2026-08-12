// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Secret-field channel — end-to-end against a REAL {@link ObjectQL} engine + a
 * minimal stub driver. Verifies the core encryption chain:
 *  - encrypt-on-write: plaintext → sys_secret ciphertext + opaque ref on the row
 *  - mask-on-read: the generic read path never returns plaintext or the ref
 *  - resolveSecret: privileged dereference round-trips back to plaintext
 *  - fail-closed: no CryptoProvider ⇒ writing a secret field throws
 *  - update semantics: change re-encrypts; echoed mask is a no-op; null clears
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { SECRET_MASK, isSecretRef } from './secret-fields.js';
import { SECRET_MASK as SPEC_SECRET_MASK } from '@objectstack/spec/data';
import type { ICryptoProvider, CryptoHandle, CryptoContext } from '@objectstack/spec/contracts';

// ---- minimal stub driver (equality-only WHERE) ----------------------------
function makeStubDriver() {
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
  // Rows leave the driver as COPIES, like a real driver's do. Handing out the
  // live stored object makes the double lie: `maskSecretFields` mutates the
  // rows it is given, so one `find` would stamp SECRET_MASK over the stored ref
  // and the next `resolveSecret*` would read the mask back as "no secret" — an
  // artefact of the double that reads exactly like an engine bug (#7799).
  const copy = <T,>(r: T): T => (r == null ? r : ({ ...r } as T));
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where)).map(copy);
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return copy(r);
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return copy(row);
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) throw new Error(`not found: ${object}/${id}`);
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return copy(updated);
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
  const { driver, stores } = makeStubDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(sysSecretObject);
  engine.registry.registerObject(dsObject);
  const crypto = makeFakeCrypto();
  if (withCrypto) engine.setCryptoProvider(crypto.provider);
  return { engine, stores, crypto, driver };
}

/**
 * [#7572] This package no longer DECLARES the read mask — it re-exports the one
 * `@objectstack/spec` declares, so the encrypted-field path and the settings
 * REST path cannot serve two different masks.
 *
 * The pin restates the literal on purpose. Every assertion below compares an
 * engine read against the imported `SECRET_MASK`, which stays green whatever
 * that constant says; only a restated copy can catch the mask's bytes changing
 * under this package, and only the identity check can catch the re-export being
 * quietly replaced by a fresh local literal — the exact shape #7572 removed.
 */
describe('objectql SECRET_MASK re-export (#7572)', () => {
  it('is the spec declaration, not a copy', () => {
    expect(SECRET_MASK).toBe(SPEC_SECRET_MASK);
  });

  it('is the eight-bullet mask ADR-0100 pins', () => {
    expect(SECRET_MASK).toBe('••••••••');
  });
});

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

  // [#6231] `resolveSecret` reads `sys_secret` straight off the driver. That
  // call used to spell `{ object: 'sys_secret', where: { id } } as QueryAST`,
  // where the cast existed only to satisfy the AST's then-required `object`.
  // With `DriverQuery` (`Omit<QueryAST, 'object'>`) the key is gone and so is
  // the cast — so `where` is type-checked at this call site again.
  it('resolveSecret reads sys_secret by argument one — the AST never restates the object name', async () => {
    const created = await ctx.engine.insert('ext_datasource', { name: 'pg', db_password: 's3cr3t' });
    const stored = ctx.stores.get('ext_datasource')!.get(created.id) as any;

    const seen: Array<{ object: string; ast: any }> = [];
    const realFind = ctx.driver.find.bind(ctx.driver);
    ctx.driver.find = async (object: string, ast: any) => {
      seen.push({ object, ast });
      return realFind(object, ast);
    };

    expect(await ctx.engine.resolveSecret(stored.db_password)).toBe('s3cr3t');

    const secretReads = seen.filter((c) => c.object === 'sys_secret');
    expect(secretReads).toHaveLength(1);
    expect(secretReads[0].ast).not.toHaveProperty('object');
    expect(secretReads[0].ast.where).toEqual({ id: expect.any(String) });
  });

  // [#7799] `resolveSecret` is documented for privileged consumers "against the
  // stored ref" — but the read mask means no consumer can OBTAIN that ref, so
  // the only ways to reach a stored credential were to keep a cleartext copy
  // somewhere unmasked (the defect #7799 reports on `sys_webhook`) or to reach
  // past the engine into the driver. This is the supported third way.
  it("resolveSecretField recovers one row's plaintext without the caller ever seeing the ref", async () => {
    const created = await ctx.engine.insert('ext_datasource', { name: 'pg', db_password: 's3cr3t' });

    // The caller has ONLY what the generic read path gives it — the mask.
    const viaFind = (await ctx.engine.find('ext_datasource', { where: { id: created.id } }))[0] as any;
    expect(viaFind.db_password).toBe(SECRET_MASK);

    expect(await ctx.engine.resolveSecretField('ext_datasource', created.id, 'db_password')).toBe('s3cr3t');
  });

  it('resolveSecretField returns null for an unset secret and for a row that is gone', async () => {
    const created = await ctx.engine.insert('ext_datasource', { name: 'pg' });
    expect(await ctx.engine.resolveSecretField('ext_datasource', created.id, 'db_password')).toBeNull();
    expect(await ctx.engine.resolveSecretField('ext_datasource', 'nope', 'db_password')).toBeNull();
  });

  it('resolveSecretField refuses a non-secret field — it is a decrypt, not a mask bypass', async () => {
    const created = await ctx.engine.insert('ext_datasource', { name: 'pg', db_password: 's3cr3t' });
    // A plain column is not dereferenceable…
    await expect(
      ctx.engine.resolveSecretField('ext_datasource', created.id, 'name'),
    ).rejects.toThrow(/not declared as type 'secret'/i);

    // …and neither is a `password` field, which is PLAINTEXT at rest and masked
    // for exactly that reason (ADR-0100). Allowing it here would hand back the
    // very value the mask exists to withhold.
    const pw = await buildPasswordEngine();
    const device = await pw.engine.insert('device', { name: 'router', admin_password: 'hunter2' });
    await expect(
      pw.engine.resolveSecretField('device', device.id, 'admin_password'),
    ).rejects.toThrow(/not declared as type 'secret'/i);
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
      const { driver, stores } = makeStubDriver();
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

// A generic (non-better-auth) object with a `password` field. Unlike `secret`,
// it is plaintext at rest but masked on read — no crypto involved (ADR-0100).
const deviceObject = {
  name: 'device', label: 'Device',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    admin_password: { name: 'admin_password', label: 'Admin Password', type: 'password' as const },
  },
};

// An identity table the auth subsystem owns: `managedBy: 'better-auth'` exempts
// its `password` field from masking so better-auth's own reads see the value.
const authUserObject = {
  name: 'authy_user', label: 'Auth User', managedBy: 'better-auth' as const,
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const },
    password: { name: 'password', label: 'Password', type: 'password' as const },
  },
};

async function buildPasswordEngine() {
  // Deliberately NO CryptoProvider — a password field must not require one.
  const engine = new ObjectQL();
  const { driver, stores } = makeStubDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(deviceObject);
  engine.registry.registerObject(authUserObject);
  return { engine, stores };
}

describe('objectql password-field masking (ADR-0100)', () => {
  let ctx: Awaited<ReturnType<typeof buildPasswordEngine>>;
  beforeEach(async () => { ctx = await buildPasswordEngine(); });

  it('stores plaintext at rest (no crypto), but masks on find / findOne', async () => {
    const created = await ctx.engine.insert('device', { name: 'router', admin_password: 'hunter2' });

    // At rest: the driver row holds the verbatim plaintext, and nothing was
    // written to sys_secret (no encryption channel for password).
    const stored = ctx.stores.get('device')!.get(created.id) as any;
    expect(stored.admin_password).toBe('hunter2');
    expect(ctx.stores.get('sys_secret')?.size ?? 0).toBe(0);

    // On read: the generic path never echoes the plaintext.
    const viaFind = (await ctx.engine.find('device', { where: { id: created.id } }))[0] as any;
    expect(viaFind.admin_password).toBe(SECRET_MASK);
    const viaOne = await ctx.engine.findOne('device', { where: { id: created.id } }) as any;
    expect(viaOne.admin_password).toBe(SECRET_MASK);
  });

  it('an unset password reads back as null, not the mask', async () => {
    const created = await ctx.engine.insert('device', { name: 'router', admin_password: null });
    const viaOne = await ctx.engine.findOne('device', { where: { id: created.id } }) as any;
    expect(viaOne.admin_password).toBeNull();
  });

  it('echoing the read mask back does NOT overwrite the stored password', async () => {
    const created = await ctx.engine.insert('device', { name: 'router', admin_password: 'keep-me' });

    // Form round-trip: user renames the device, the masked field echoes back.
    await ctx.engine.update('device', { id: created.id, name: 'gateway', admin_password: SECRET_MASK });

    const stored = ctx.stores.get('device')!.get(created.id) as any;
    expect(stored.name).toBe('gateway');
    expect(stored.admin_password).toBe('keep-me'); // unchanged plaintext
  });

  it('updating with a real new value replaces the stored plaintext', async () => {
    const created = await ctx.engine.insert('device', { name: 'router', admin_password: 'old-pw' });
    await ctx.engine.update('device', { id: created.id, admin_password: 'new-pw' });

    const stored = ctx.stores.get('device')!.get(created.id) as any;
    expect(stored.admin_password).toBe('new-pw');
    // And a read still masks it.
    const viaOne = await ctx.engine.findOne('device', { where: { id: created.id } }) as any;
    expect(viaOne.admin_password).toBe(SECRET_MASK);
  });

  it('better-auth identity tables are exempt: their password field is NOT masked on read', async () => {
    const created = await ctx.engine.insert('authy_user', { password: 'hashed-by-auth' });
    const viaOne = await ctx.engine.findOne('authy_user', { where: { id: created.id } }) as any;
    // Masking here would break login — the auth subsystem must read its own value.
    expect(viaOne.password).toBe('hashed-by-auth');
  });
});

describe('objectql aggregate() rejects credential fields (ADR-0100 / #3171)', () => {
  it('rejects a `secret` field used as an aggregation measure', async () => {
    const { engine } = await buildEngine(true);
    await expect(
      engine.aggregate('ext_datasource', { aggregations: [{ function: 'max', field: 'db_password', alias: 'x' }] as any }),
    ).rejects.toThrow(/credential field.*db_password/i);
  });

  it('rejects a `secret` field used as a string groupBy dimension', async () => {
    const { engine } = await buildEngine(true);
    await expect(
      engine.aggregate('ext_datasource', { aggregations: [{ function: 'count', alias: 'n' }], groupBy: ['db_password'] } as any),
    ).rejects.toThrow(/db_password/);
  });

  it('rejects a `secret` field used as a structured {field} groupBy bucket', async () => {
    const { engine } = await buildEngine(true);
    await expect(
      engine.aggregate('ext_datasource', { aggregations: [{ function: 'count', alias: 'n' }], groupBy: [{ field: 'db_password' }] } as any),
    ).rejects.toThrow(/db_password/);
  });

  it('does NOT reject when the credential field is not referenced (no false positive)', async () => {
    const { engine } = await buildEngine(true);
    await engine.insert('ext_datasource', { name: 'pg', db_password: 's3cr3t' });
    // COUNT(*) touches no credential column — the object merely *has* one.
    await expect(
      engine.aggregate('ext_datasource', { aggregations: [{ function: 'count', alias: 'n' }] } as any),
    ).resolves.toBeDefined();
  });

  it('rejects a generic `password` field used as a groupBy dimension', async () => {
    const { engine } = await buildPasswordEngine();
    await expect(
      engine.aggregate('device', { aggregations: [{ function: 'count', alias: 'n' }], groupBy: ['admin_password'] } as any),
    ).rejects.toThrow(/admin_password/);
  });

  it('rejects even on a better-auth object — read-masking is exempt there, aggregation is NOT', async () => {
    const { engine } = await buildPasswordEngine();
    // authy_user is managedBy:'better-auth' (password NOT masked on read), but
    // aggregating the credential is still refused (unconditional collector).
    await expect(
      engine.aggregate('authy_user', { aggregations: [{ function: 'max', field: 'password', alias: 'x' }] as any }),
    ).rejects.toThrow(/password/);
  });
});
