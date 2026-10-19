// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two rows a settings write lands BESIDE its settings row — the
 * `sys_secret` ciphertext of an encrypted value and the per-key audit history
 * row.
 *
 *  - The ciphertext is deployment-level (ADR-0131 D7, ruling record
 *    6257510973 · Q4 A): a secret is owned by the row that holds its handle, so
 *    it names no organization, whatever the setting's rung.
 *  - The history row belongs to the organization the setting row does: the
 *    caller's, for a `tenant` or `user` value (ADR-0131 D3/D9), in
 *    `sys_setting_audit`. A `global` value is deployment-level, so its row
 *    names none and goes to `sys_platform_setting_audit`, which has no
 *    organization column (Q4 A) — the split `sys_setting` /
 *    `sys_platform_setting` makes for the values.
 */

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SettingsManifest } from '@objectstack/spec/system';
import { SettingsService } from './settings-service.js';
import { LocalCryptoProvider } from './local-crypto-provider.js';
import { mailSettingsManifest } from './manifests/mail.manifest.js';
import {
  buildSettingAuditWriter,
  PLATFORM_SETTING_AUDIT_OBJECT,
  SETTING_AUDIT_OBJECT,
  settingAuditObjectFor,
} from './settings-service-plugin.js';
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

describe('[ADR-0131 D7/D9] a settings secret names no organization; its history row names the setting\'s', () => {
  it('a tenant value: the ciphertext names no organization, the history row carries the caller\'s', async () => {
    const { svc, secrets, history } = boot();
    await svc.setMany('tenant_vault', { token: 's3cret' }, { tenantId: 'org-1', userId: 'usr-1' });

    expect(secrets).toHaveLength(1);
    expect(secrets[0]).toMatchObject({ namespace: 'tenant_vault', key: 'token' });
    expect('organization_id' in secrets[0]).toBe(false);
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

describe('[ADR-0131 D3/D7] the settings audit writer: tenant rows stamped in sys_setting_audit, global rows to the sibling', () => {
  function engine() {
    const inserted: Array<Record<string, unknown>> = [];
    const objects: string[] = [];
    return {
      inserted,
      objects,
      async findOne() { return { id: 'usr-1' }; },
      async insert(object: string, row: Record<string, unknown>) { objects.push(object); inserted.push({ ...row }); return row; },
    };
  }
  const entry = {
    namespace: 'tenant_vault', key: 'token', scope: 'tenant' as const, action: 'set' as const,
    actorId: 'usr-1', oldHash: null, newHash: 'hmac-sha256:x', encrypted: true,
  };

  it('a tenant or user row goes to sys_setting_audit with its organization; a global row to sys_platform_setting_audit with none', async () => {
    const eng = engine();
    const writer = buildSettingAuditWriter(eng as any, { error: (m) => { throw new Error(m); }, warn: (m) => { throw new Error(m); } });
    await writer.write({ ...entry, organizationId: 'org-1' });
    await writer.write({ ...entry, scope: 'user', organizationId: 'org-1' });
    await writer.write({ ...entry, scope: 'global' });
    // An entry that names an organization at the global rung still writes none:
    // the sibling has no organization column to hold it.
    await writer.write({ ...entry, scope: 'global', organizationId: 'org-1' });

    expect(eng.objects).toEqual(['sys_setting_audit', 'sys_setting_audit', 'sys_platform_setting_audit', 'sys_platform_setting_audit']);
    expect(eng.inserted[0]).toMatchObject({ key: 'token', scope: 'tenant', organization_id: 'org-1' });
    expect(eng.inserted[1]).toMatchObject({ key: 'token', scope: 'user', organization_id: 'org-1' });
    expect(eng.inserted[2]).toMatchObject({ key: 'token', scope: 'global' });
    expect('organization_id' in eng.inserted[2]).toBe(false);
    expect('organization_id' in eng.inserted[3]).toBe(false);
  });

  it('routes by rung through one predicate: global to the sibling, tenant and user to sys_setting_audit', () => {
    expect(settingAuditObjectFor('global')).toBe(PLATFORM_SETTING_AUDIT_OBJECT);
    expect(settingAuditObjectFor('tenant')).toBe(SETTING_AUDIT_OBJECT);
    expect(settingAuditObjectFor('user')).toBe(SETTING_AUDIT_OBJECT);
    expect([PLATFORM_SETTING_AUDIT_OBJECT, SETTING_AUDIT_OBJECT]).toEqual(['sys_platform_setting_audit', 'sys_setting_audit']);
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
