// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D9] The two rows a settings write lands BESIDE its `sys_setting`
 * row — the `sys_secret` ciphertext of an encrypted value and the per-key
 * `sys_setting_audit` history row — belong to the organization the setting
 * row does: the caller's, for a `tenant` or `user` value. A `global` value is
 * deployment-level (its row lives in `sys_platform_setting`, which has no
 * organization), so neither row names one; whether such rows may stay in
 * these two tenant-column objects is a question this file does not answer.
 */

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SettingsManifest } from '@objectstack/spec/system';
import { SettingsService } from './settings-service.js';
import { LocalCryptoProvider } from './local-crypto-provider.js';
import { mailSettingsManifest } from './manifests/mail.manifest.js';
import { buildSettingAuditWriter } from './settings-service-plugin.js';
import type { SettingsSecretStore } from './settings-service.types.js';

/** A tenant-scoped namespace carrying one encrypted value. */
const tenantSecretManifest: SettingsManifest = {
  namespace: 'tenant_vault',
  version: 1,
  label: 'Tenant vault',
  scope: 'tenant',
  specifiers: [
    { type: 'password', key: 'token', label: 'Token', required: false, encrypted: true },
  ],
};

function boot() {
  const secrets: any[] = [];
  const history: any[] = [];
  const secretStore: SettingsSecretStore = {
    async insert(row) { secrets.push({ ...row }); return { id: row.id }; },
    async get(id) { return secrets.find((r) => r.id === id) ?? null; },
    async update() {},
  };
  const svc = new SettingsService({
    env: {},
    cryptoProvider: new LocalCryptoProvider({ key: randomBytes(32) }),
    secretStore,
    auditWriter: { write: (e) => { history.push({ ...e }); } },
  });
  svc.registerManifest(tenantSecretManifest);
  svc.registerManifest(mailSettingsManifest);
  return { svc, secrets, history };
}

describe('[ADR-0131 D3/D9] settings secret and history rows name their setting\'s organization', () => {
  it('a tenant value: the ciphertext and the history row carry the caller\'s organization', async () => {
    const { svc, secrets, history } = boot();
    await svc.setMany('tenant_vault', { token: 's3cret' }, { tenantId: 'org-1', userId: 'usr-1' });

    expect(secrets).toHaveLength(1);
    expect(secrets[0]).toMatchObject({ namespace: 'tenant_vault', key: 'token', organization_id: 'org-1' });
    expect(history.filter((e) => e.key === 'token')).toEqual([
      expect.objectContaining({ scope: 'tenant', encrypted: true, organizationId: 'org-1' }),
    ]);
  });

  it('a global value: deployment-level, so neither row names an organization — even from a caller who has one', async () => {
    const { svc, secrets, history } = boot();
    await svc.setMany(
      'mail',
      { provider: 'resend', api_key: 're_123', from_email: 'ops@example.com' },
      { tenantId: 'org-1', userId: 'usr-1' },
    );

    expect(secrets).toHaveLength(1);
    expect('organization_id' in secrets[0]).toBe(false);
    const rows = history.filter((e) => e.namespace === 'mail');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect('organizationId' in row).toBe(false);
  });
});

describe('[ADR-0131 D3/D9] the sys_setting_audit writer stamps the entry\'s organization', () => {
  function engine() {
    const inserted: Array<Record<string, unknown>> = [];
    return {
      inserted,
      async findOne() { return { id: 'usr-1' }; },
      async insert(_object: string, row: Record<string, unknown>) { inserted.push({ ...row }); return row; },
    };
  }
  const entry = {
    namespace: 'tenant_vault', key: 'token', scope: 'tenant' as const, action: 'set' as const,
    actorId: 'usr-1', oldHash: null, newHash: 'hmac-sha256:x', encrypted: true,
  };

  it('writes organization_id when the entry names one, and no organization_id when it does not', async () => {
    const eng = engine();
    const writer = buildSettingAuditWriter(eng as any, { error: (m) => { throw new Error(m); }, warn: (m) => { throw new Error(m); } });
    await writer.write({ ...entry, organizationId: 'org-1' });
    await writer.write({ ...entry, scope: 'global' });

    expect(eng.inserted[0]).toMatchObject({ key: 'token', organization_id: 'org-1' });
    expect('organization_id' in eng.inserted[1]).toBe(false);
  });

  it('reports a lost history row at error once with the consequence, and on a reduced sink through warn', async () => {
    const refusing = { async findOne() { return { id: 'usr-1' }; }, async insert() { throw new Error('refused'); } };
    const errors: string[] = [];
    const full = buildSettingAuditWriter(refusing as any, { error: (m) => errors.push(m), warn: () => { throw new Error('warn used'); } });
    await full.write(entry);
    await full.write(entry);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('NOT persisted');
    expect(errors[1]).not.toContain('NOT persisted');

    const warned: string[] = [];
    await buildSettingAuditWriter(refusing as any, { warn: (m) => warned.push(m) }).write(entry);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('refused');
  });

  it('keeps the accept set it had: no sink, an empty sink, and an error-only sink are all taken', async () => {
    const refusing = { async findOne() { return { id: 'usr-1' }; }, async insert() { throw new Error('refused'); } };
    await expect(buildSettingAuditWriter(refusing as any).write(entry)).resolves.toBeUndefined();
    await expect(buildSettingAuditWriter(refusing as any, {}).write(entry)).resolves.toBeUndefined();
    const errors: string[] = [];
    await buildSettingAuditWriter(refusing as any, { error: (m) => errors.push(m) }).write(entry);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('NOT persisted');
  });
});
