// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 C8 stage 8b; #24582] Binding a datasource credential under a
 * walled posture, through a REAL ObjectQL engine over SQLite.
 *
 * The binder persists the ciphertext as a `sys_secret` row with the system
 * context and no organization: a datasource is deployment-level. `sys_secret`
 * declares no organization column (`systemFields: { tenant: false }`, the
 * steps 5+6 flip; epic ruling record 6270035914 on #15194, item 2), so under
 * `group` / `isolated` that organization-less system insert lands on the
 * engine's own rule: with no tenant field, `Engine.resolveSystemInsertOrganization`
 * has nothing to stamp or refuse. If the table took an organization column
 * back, the admin door's credential bind would be a 500
 * `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED`, and nothing would be written.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysSecret } from '@objectstack/platform-objects/system';
import type { CryptoContext, CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';
import { createDatasourceSecretBinder } from './datasource-secret-binder.js';

/** Reversible stand-in cipher — the subject is the write, not the cipher. */
function fakeCrypto(): ICryptoProvider {
  let n = 0;
  return {
    async encrypt(plain: string, _ctx: CryptoContext): Promise<CryptoHandle> {
      n += 1;
      return { id: `sec_${n}`, kmsKeyId: 'test', alg: 'test-rev', version: 1, ciphertext: [...plain].reverse().join('') };
    },
    async decrypt(handle: CryptoHandle): Promise<string> {
      return [...handle.ciphertext].reverse().join('');
    },
    async rotateKey(handle: CryptoHandle): Promise<CryptoHandle> {
      return { ...handle, version: handle.version + 1 };
    },
    digest: (plain: string) => `d:${plain.length}`,
    keyedDigest: async (plain: string) => `k:${plain.length}`,
  };
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  for (const e of engines.splice(0)) {
    try { await (e as any).destroy?.(); } catch { /* noop */ }
  }
});

async function boot(posture: 'isolated' | 'group'): Promise<ObjectQL> {
  const ql = new ObjectQL();
  engines.push(ql);
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await driver.connect();
  ql.registerDriver(driver, true);
  await ql.init();
  ql.setTenancyPostureProvider(() => posture);
  (ql as any).registry.registerObject(SysSecret as never, 'test');
  await ql.syncSchemas();
  return ql;
}

describe('[C8 stage 8b] a datasource credential bind under a wall, on a real engine', () => {
  it.each(['isolated', 'group'] as const)(
    '%s: the organization-less sys_secret row lands, and the credential resolves back',
    async (posture) => {
      const ql = await boot(posture);
      const binder = createDatasourceSecretBinder({ engine: ql as never, cryptoProvider: fakeCrypto() });

      const ref = await binder.bind({ value: 'pin-ds-password-9c2e' }, { name: 'warehouse' });

      const rows = (await ql.find('sys_secret', { context: { isSystem: true } } as never)) as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ namespace: 'datasource', key: 'warehouse' });
      expect(rows[0].organization_id ?? null).toBeNull();
      expect(await binder.resolve(ref)).toBe('pin-ds-password-9c2e');
    },
  );
});
