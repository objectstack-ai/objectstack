// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The fingerprint the settings audit trail records for a write.
 *
 * Contract (`ICryptoProvider` in `@objectstack/spec/contracts`): a
 * secret-valued setting (an `encryptedKeys` member) is recorded on BOTH
 * ledgers — the generic `sys_audit_log` row (`SettingsAuditSink.valueDigest`)
 * and the per-key `sys_setting_audit` row (`SettingsAuditWriter.newHash`) —
 * with the provider's KEYED digest, never an unkeyed one; with no keyed digest
 * available it records no fingerprint at all. Non-secret settings keep the
 * adapter's unkeyed `digest` of the canonical JSON, unchanged.
 */

import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ICryptoProvider } from '@objectstack/spec/contracts';
import { SettingsService } from './settings-service.js';
import type { CryptoAdapter } from './crypto-adapter.js';
import { NoopCryptoAdapter } from './crypto-adapter.js';
import { LocalCryptoProvider } from './local-crypto-provider.js';
import { mailSettingsManifest } from './manifests/mail.manifest.js';
import type { SettingsSecretStore } from './settings-service.types.js';

const KEYED_SHAPE = /^hmac-sha256:[0-9a-f]{64}$/;
const sha256 = (s: string) => 'sha256:' + createHash('sha256').update(s, 'utf8').digest('hex');

function memorySecretStore(): SettingsSecretStore {
  const rows = new Map<string, any>();
  return {
    async insert(row) { rows.set(row.id, row); return { id: row.id }; },
    async get(id) { return rows.get(id) ?? null; },
    async update(id, patch) { rows.set(id, { ...rows.get(id), ...patch }); },
  };
}

/** A confidential stand-in for an injected KMS adapter (legacy inline path). */
class ConfidentialTestAdapter implements CryptoAdapter {
  readonly confidential = true;
  async encrypt(plaintext: string): Promise<string> {
    return 'kms:' + Buffer.from(plaintext, 'utf8').toString('base64');
  }
  async decrypt(ciphertext: string): Promise<string> {
    return Buffer.from(ciphertext.replace(/^kms:/, ''), 'base64').toString('utf8');
  }
  digest(plaintext: string): string {
    return sha256(plaintext);
  }
}

function boot(opts: {
  cryptoProvider?: ICryptoProvider;
  secretStore?: SettingsSecretStore;
  crypto?: CryptoAdapter;
  logger?: { error: (m: string) => void; warn?: (m: string) => void };
}) {
  const ledger: any[] = [];
  const settingAudit: any[] = [];
  const svc = new SettingsService({
    env: {},
    ...opts,
    audit: { record: (e) => { ledger.push(e); } },
    auditWriter: { write: (e) => { settingAudit.push(e); } },
  });
  svc.registerManifest(mailSettingsManifest);
  const forKey = (k: string) => ({
    ledger: ledger.filter((e) => e.key === k),
    settingAudit: settingAudit.filter((e) => e.key === k),
  });
  return { svc, forKey };
}

const writeSecret = (svc: SettingsService, value: string) =>
  svc.setMany('mail', { provider: 'resend', api_key: value, from_email: 'ops@example.com' });

describe('settings audit trail — secret-valued settings', () => {
  it('records the provider keyed digest on both ledgers, not the unkeyed hash of the value', async () => {
    const provider = new LocalCryptoProvider({ key: randomBytes(32) });
    const { svc, forKey } = boot({ cryptoProvider: provider, secretStore: memorySecretStore() });

    await writeSecret(svc, 'pw-123456');

    const { ledger, settingAudit } = forKey('api_key');
    const keyed = await provider.keyedDigest('pw-123456');
    expect(keyed).toMatch(KEYED_SHAPE);

    expect(settingAudit).toHaveLength(1);
    expect(settingAudit[0]).toMatchObject({ encrypted: true, newHash: keyed });
    expect(settingAudit[0].newHash).not.toBe(provider.digest('pw-123456'));
    expect(settingAudit[0].newHash).not.toBe(sha256('pw-123456'));

    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ encrypted: true, valueDigest: '<encrypted:' + keyed + '>' });
    expect(JSON.stringify([ledger, settingAudit])).not.toContain(sha256('pw-123456'));
    expect(JSON.stringify([ledger, settingAudit])).not.toContain('pw-123456');
  });

  it('is stable for equal values and distinct for different ones', async () => {
    const provider = new LocalCryptoProvider({ key: randomBytes(32) });
    const { svc, forKey } = boot({ cryptoProvider: provider, secretStore: memorySecretStore() });

    await writeSecret(svc, 'same-value');
    await writeSecret(svc, 'other-value');
    await writeSecret(svc, 'same-value');

    const hashes = forKey('api_key').settingAudit.map((e) => e.newHash);
    expect(hashes).toHaveLength(3);
    expect(hashes[0]).toBe(hashes[2]);
    expect(hashes[1]).not.toBe(hashes[0]);
    const digests = forKey('api_key').ledger.map((e) => e.valueDigest);
    expect(digests[0]).toBe(digests[2]);
    expect(digests[1]).not.toBe(digests[0]);
  });

  it('records no fingerprint on a reset', async () => {
    const provider = new LocalCryptoProvider({ key: randomBytes(32) });
    const { svc, forKey } = boot({ cryptoProvider: provider, secretStore: memorySecretStore() });

    await writeSecret(svc, 'pw-1');
    await svc.set('mail', 'api_key', null);

    const reset = forKey('api_key').settingAudit[1];
    expect(reset).toMatchObject({ action: 'reset', newHash: null });
  });

  it('legacy inline-adapter path with a provider wired records the keyed digest, not the adapter digest', async () => {
    const provider = new LocalCryptoProvider({ key: randomBytes(32) });
    // No secret store: the write takes the inline `crypto.encrypt` branch.
    const { svc, forKey } = boot({ cryptoProvider: provider, crypto: new ConfidentialTestAdapter() });

    await writeSecret(svc, 'pw-legacy');

    const { ledger, settingAudit } = forKey('api_key');
    const keyed = await provider.keyedDigest('pw-legacy');
    expect(settingAudit[0].newHash).toBe(keyed);
    expect(ledger[0].valueDigest).toBe('<encrypted:' + keyed + '>');
    expect(JSON.stringify([ledger, settingAudit])).not.toContain(sha256('pw-legacy'));
  });

  it('legacy inline-adapter path with no provider records no fingerprint and reports it once', async () => {
    const warn = vi.fn();
    const { svc, forKey } = boot({ crypto: new ConfidentialTestAdapter(), logger: { error: vi.fn(), warn } });

    await writeSecret(svc, 'pw-a');
    await writeSecret(svc, 'pw-b');

    const { ledger, settingAudit } = forKey('api_key');
    expect(settingAudit.map((e) => e.newHash)).toEqual([null, null]);
    expect(settingAudit.map((e) => e.action)).toEqual(['set', 'set']);
    expect(ledger.map((e) => e.valueDigest)).toEqual(['<encrypted>', '<encrypted>']);
    expect(JSON.stringify([ledger, settingAudit])).not.toContain(sha256('pw-a'));
    // The write itself still landed.
    expect((await svc.get<string>('mail', 'api_key')).value).toBe('pw-b');
    expect(warn.mock.calls.filter(([m]) => String(m).includes('mail.api_key'))).toHaveLength(1);
  });

  it('a provider that refuses a keyed digest leaves the write intact and records no fingerprint', async () => {
    const real = new LocalCryptoProvider({ key: randomBytes(32) });
    const refusing: ICryptoProvider = {
      encrypt: real.encrypt.bind(real),
      decrypt: real.decrypt.bind(real),
      rotateKey: real.rotateKey.bind(real),
      digest: real.digest.bind(real),
      keyedDigest: async () => { throw new Error('no key material'); },
    };
    const { svc, forKey } = boot({
      cryptoProvider: refusing,
      secretStore: memorySecretStore(),
      logger: { error: vi.fn(), warn: vi.fn() },
    });

    await writeSecret(svc, 'pw-x');

    expect(forKey('api_key').settingAudit[0].newHash).toBeNull();
    expect(forKey('api_key').ledger[0].valueDigest).toBe('<encrypted>');
    expect((await svc.get<string>('mail', 'api_key')).value).toBe('pw-x');
  });
});

describe('settings audit trail — non-secret settings', () => {
  it('keep the unkeyed adapter digest of the canonical JSON, unchanged', async () => {
    const provider = new LocalCryptoProvider({ key: randomBytes(32) });
    const { svc, forKey } = boot({ cryptoProvider: provider, secretStore: memorySecretStore() });

    await writeSecret(svc, 'pw-1');

    const expected = new NoopCryptoAdapter().digest(JSON.stringify('ops@example.com'));
    const { ledger, settingAudit } = forKey('from_email');
    expect(settingAudit[0]).toMatchObject({ encrypted: false, newHash: expected });
    expect(ledger[0]).toMatchObject({ encrypted: false, valueDigest: expected });
  });
});
