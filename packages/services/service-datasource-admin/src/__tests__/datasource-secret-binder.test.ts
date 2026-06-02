// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { CryptoContext, CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';
import {
  createDatasourceSecretBinder,
  parseCredentialsRef,
  toCredentialsRef,
  type SecretStoreEngineLike,
} from '../datasource-secret-binder.js';

/**
 * Minimal AAD-binding crypto fake: ciphertext = base64(`${ns}|${key}::${plain}`).
 * decrypt() verifies the (namespace,key) AAD matches what encrypt() sealed —
 * mirroring InMemoryCryptoProvider's guarantee without pulling in node:crypto.
 */
function fakeCrypto(): ICryptoProvider {
  return {
    async encrypt(plain: string, ctx: CryptoContext): Promise<CryptoHandle> {
      return {
        id: 'sec_' + ctx.key,
        kmsKeyId: 'local:test:v1',
        alg: 'aes-256-gcm',
        version: 1,
        ciphertext: Buffer.from(`${ctx.namespace}|${ctx.key}::${plain}`, 'utf8').toString('base64'),
      };
    },
    async decrypt(handle: CryptoHandle, ctx: CryptoContext): Promise<string> {
      const raw = Buffer.from(handle.ciphertext, 'base64').toString('utf8');
      const [aad, plain] = raw.split('::');
      if (aad !== `${ctx.namespace}|${ctx.key}`) throw new Error('AAD mismatch');
      return plain;
    },
    async rotateKey(handle: CryptoHandle): Promise<CryptoHandle> {
      return handle;
    },
    digest: (plain: string) => 'sha256:' + plain,
  };
}

/** In-memory `sys_secret` store backing the engine surface. */
function fakeEngine(): SecretStoreEngineLike & { rows: Map<string, any> } {
  const rows = new Map<string, any>();
  return {
    rows,
    async insert(_object, data) {
      rows.set(String(data.id), data);
      return data;
    },
    async delete(_object, options) {
      rows.delete(String(options.where.id));
      return undefined;
    },
    async find(_object, query) {
      const id = String((query.where as any)?.id);
      const row = rows.get(id);
      return row ? [row] : [];
    },
  };
}

describe('createDatasourceSecretBinder', () => {
  it('round-trips: bind → credentialsRef → resolve back to cleartext', async () => {
    const engine = fakeEngine();
    const binder = createDatasourceSecretBinder({ engine, cryptoProvider: fakeCrypto() });

    const ref = await binder.bind({ value: 'super-secret-pw' }, { name: 'reporting' });
    expect(ref).toBe(toCredentialsRef('sec_reporting'));

    // The persisted row holds only ciphertext — never the cleartext.
    const row = engine.rows.get('sec_reporting');
    expect(row.namespace).toBe('datasource');
    expect(row.key).toBe('reporting');
    expect(JSON.stringify(row)).not.toContain('super-secret-pw');

    expect(await binder.resolve(ref)).toBe('super-secret-pw');
  });

  it('resolve() returns undefined after unbind (row gone)', async () => {
    const engine = fakeEngine();
    const binder = createDatasourceSecretBinder({ engine, cryptoProvider: fakeCrypto() });
    const ref = await binder.bind({ value: 'pw' }, { name: 'ds1' });
    await binder.unbind(ref);
    expect(await binder.resolve(ref)).toBeUndefined();
  });

  it('resolve() returns undefined for a foreign / non-sys_secret ref', async () => {
    const engine = fakeEngine();
    const binder = createDatasourceSecretBinder({ engine, cryptoProvider: fakeCrypto() });
    expect(parseCredentialsRef('vault://other/handle')).toBeUndefined();
    expect(await binder.resolve('vault://other/handle')).toBeUndefined();
  });

  it('resolve() degrades to undefined when the engine cannot read', async () => {
    const engine = fakeEngine();
    delete (engine as any).find; // older engine surface without a read path
    const binder = createDatasourceSecretBinder({ engine, cryptoProvider: fakeCrypto() });
    const ref = await binder.bind({ value: 'pw' }, { name: 'ds1' });
    expect(await binder.resolve(ref)).toBeUndefined();
  });
});
