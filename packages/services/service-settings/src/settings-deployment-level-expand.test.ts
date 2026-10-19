// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D7 · ruling record 6257510973, Q4 A] The 18.x expand step for the
 * settings producer: `sys_secret` is deployment-level, and the settings audit
 * trail's global rung is `sys_platform_setting_audit`.
 *
 * Pinned over a real `ObjectQL` engine and the real platform objects, under the
 * `single` posture with one organization — the posture an 18.0 install runs —
 * so the engine's ADR-0131 D9 stamp is live in this rig. The control below
 * shows it stamping an organization-less system insert into
 * `sys_setting_audit`; the same engine leaves a `sys_secret` row unstamped, so
 * the absence is the object's declaration, not a rig that stamps nothing.
 *
 * Two halves, as the 18.x line's expand rule asks:
 *
 *  - **The new write shape.** A secret names no organization, at any rung. A
 *    global-rung audit row goes to `sys_platform_setting_audit`, with no
 *    organization; a tenant-rung row stays in `sys_setting_audit`, stamped.
 *  - **The dual read, on 18.0-shaped rows.** An 18.0 install stamped its
 *    secrets with the Default Organization and wrote its global-rung audit
 *    rows into `sys_setting_audit`. Those rows are read as they are: the
 *    stamped secret opens by id, and the 18.0 global audit row is still served
 *    beside the new one. Nothing re-stamps, clears or moves them — that is the
 *    upgrade ceremony's.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import {
  SysPlatformSetting,
  SysPlatformSettingAudit,
  SysSecret,
  SysSetting,
  SysSettingAudit,
} from '@objectstack/platform-objects/system';
import type { SettingsManifest } from '@objectstack/spec/system';
import { SettingsService } from './settings-service.js';
import { SettingsServicePlugin, buildSettingAuditWriter, wrapEngineAsSettingsEngine } from './settings-service-plugin.js';
import { LocalCryptoProvider } from './local-crypto-provider.js';

const OWNER_PACKAGE = 'com.objectstack.test.settings-deployment-level-expand';
const DEFAULT_ORG = 'org_default';
const SYS = { context: { isSystem: true } } as const;

const GLOBAL_MANIFEST: SettingsManifest = {
  namespace: 'relay_probe',
  version: 1,
  label: 'Relay (global)',
  scope: 'global',
  readPermission: 'manage_platform_settings',
  writePermission: 'manage_platform_settings',
  specifiers: [{ type: 'password', key: 'api_key', label: 'API key', required: false, encrypted: true }],
};

const TENANT_MANIFEST: SettingsManifest = {
  namespace: 'tenant_vault',
  version: 1,
  label: 'Tenant vault',
  scope: 'tenant',
  specifiers: [{ type: 'password', key: 'token', label: 'Token', required: false, encrypted: true }],
};

/** The minimal organization object the engine's D9 probe asks for. */
const ORG_OBJECT = { name: 'sys_organization', fields: { name: { type: 'text' } } } as any;

interface Write {
  object: string;
  data: Record<string, unknown>;
  options: Record<string, unknown> | undefined;
}

/** A Map-backed driver that also records each create, with the options the engine handed it. */
function makeRecordingDriver() {
  const store = new Map<string, Map<string, Record<string, unknown>>>();
  const writes: Write[] = [];
  let nextId = 0;
  const copy = (r: Record<string, unknown>) => ({ ...r });
  const rowsOf = (object: string) => {
    let s = store.get(object);
    if (!s) { s = new Map(); store.set(object, s); }
    return s;
  };
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => {
      if (k === '$or') return (v as any[]).some((b) => matches(row, b));
      if (k === '$and') return (v as any[]).every((b) => matches(row, b));
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return (row[k] ?? null) === (v ?? null);
    });
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      const hits = [...rowsOf(object).values()].filter((r) => matches(r, ast?.where));
      const page = typeof ast?.limit === 'number' ? hits.slice(0, ast.limit) : hits;
      return page.map(copy);
    },
    async findOne(object: string, ast: any) {
      for (const r of rowsOf(object).values()) if (matches(r, ast?.where)) return copy(r);
      return null;
    },
    async create(object: string, data: Record<string, unknown>, options?: Record<string, unknown>) {
      writes.push({ object, data: { ...data }, options });
      nextId += 1;
      const id = (data.id as string) ?? `row_${nextId}`;
      // What a SQL driver persists: the engine's tenant stamp lands in the
      // organization column when the record does not already carry one.
      const tenantId = options?.tenantId;
      const row = { ...data, id, ...(tenantId && data.organization_id === undefined ? { organization_id: tenantId } : {}) };
      rowsOf(object).set(id, row);
      return copy(row);
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = rowsOf(object);
      const cur = s.get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id };
      s.set(id, next);
      return copy(next);
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      return id && rowsOf(object).has(id) ? this.update(object, id, data) : this.create(object, data);
    },
    async delete(object: string, id: string) { return rowsOf(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[], options?: Record<string, unknown>) {
      return Promise.all(rows.map((r) => this.create(object, r, options)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany() { return 0; },
    async deleteMany() { return 0; },
    async syncSchema() {}, async dropTable() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, rowsOf, writes };
}

async function boot() {
  const engine = new ObjectQL();
  const { driver, rowsOf, writes } = makeRecordingDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of [SysSetting, SysPlatformSetting, SysSettingAudit, SysPlatformSettingAudit, SysSecret, ORG_OBJECT]) {
    engine.registry.registerObject(o as any, OWNER_PACKAGE);
  }
  engine.setTenancyPostureProvider(() => 'single');
  rowsOf('sys_organization').set(DEFAULT_ORG, { id: DEFAULT_ORG, name: 'Default Organization' });

  const cryptoProvider = new LocalCryptoProvider();
  const svc = new SettingsService({
    env: {},
    engine: wrapEngineAsSettingsEngine(engine as any),
    cryptoProvider,
    secretStore: (new SettingsServicePlugin() as any).buildSecretStore(engine),
    auditWriter: buildSettingAuditWriter(engine as any, { error: (m) => { throw new Error(m); } }),
  });
  svc.registerManifest(GLOBAL_MANIFEST);
  svc.registerManifest(TENANT_MANIFEST);
  const rows = (object: string) => [...rowsOf(object).values()];
  const seed = (object: string, row: Record<string, unknown>) => rowsOf(object).set(String(row.id), { ...row });
  const writesTo = (object: string) => writes.filter((w) => w.object === object);
  return { engine, svc, cryptoProvider, rows, seed, writesTo };
}

describe('[18.x expand · Q4 A] the new write shape, under single with the Default Organization', () => {
  it('control: the rig stamps an organization-less system insert into a tenant-column object', async () => {
    const { engine, rows } = await boot();
    await engine.insert('sys_setting_audit', {
      namespace: 'n', key: 'k', scope: 'tenant', action: 'set', source: 'api', encrypted: false,
      created_at: new Date().toISOString(),
    }, SYS);
    expect(rows('sys_setting_audit')).toEqual([expect.objectContaining({ organization_id: DEFAULT_ORG })]);
  });

  it('a tenant value: the secret names no organization; the audit row is stamped in sys_setting_audit', async () => {
    const { svc, rows, writesTo } = await boot();
    await svc.setMany('tenant_vault', { token: 's3cret' }, { tenantId: DEFAULT_ORG, userId: undefined });

    const [secretWrite] = writesTo('sys_secret');
    expect(secretWrite?.data).toMatchObject({ namespace: 'tenant_vault', key: 'token' });
    expect(secretWrite?.data).not.toHaveProperty('organization_id');
    expect(secretWrite?.options?.tenantId).toBeUndefined();
    expect(rows('sys_secret')).toHaveLength(1);
    expect(rows('sys_secret')[0]!.organization_id ?? null).toBeNull();

    expect(rows('sys_setting_audit')).toEqual([
      expect.objectContaining({ namespace: 'tenant_vault', key: 'token', scope: 'tenant', organization_id: DEFAULT_ORG }),
    ]);
    expect(rows('sys_platform_setting_audit')).toEqual([]);
  });

  it('a global value: the secret names no organization; the audit row goes to sys_platform_setting_audit, unstamped', async () => {
    const { svc, rows, writesTo } = await boot();
    await svc.setMany('relay_probe', { api_key: 're_123' }, { tenantId: DEFAULT_ORG, userId: undefined });

    expect(rows('sys_secret')).toHaveLength(1);
    expect(rows('sys_secret')[0]!.organization_id ?? null).toBeNull();
    expect(writesTo('sys_secret')[0]?.options?.tenantId).toBeUndefined();

    const platformAudit = rows('sys_platform_setting_audit');
    expect(platformAudit).toEqual([
      expect.objectContaining({ namespace: 'relay_probe', key: 'api_key', scope: 'global', action: 'set', encrypted: true }),
    ]);
    expect(platformAudit[0]!.organization_id ?? null).toBeNull();
    expect(writesTo('sys_platform_setting_audit')[0]?.options?.tenantId).toBeUndefined();
    expect(rows('sys_setting_audit')).toEqual([]);
  });
});

describe('[18.x expand · Q4 A] the dual read, on 18.0-shaped rows', () => {
  it('an 18.0 secret stamped with the Default Organization opens by id, and keeps its stamp', async () => {
    const { svc, cryptoProvider, seed, rows } = await boot();
    // The 18.0 shape: the ciphertext row carries the organization its
    // `sys_setting` row did, and the setting holds the handle.
    const handle = await cryptoProvider.encrypt('legacy-token', {
      scope: 'settings', namespace: 'tenant_vault', key: 'token', tenantId: DEFAULT_ORG,
    });
    seed('sys_secret', {
      id: handle.id, organization_id: DEFAULT_ORG, namespace: 'tenant_vault', key: 'token',
      kms_key_id: handle.kmsKeyId, alg: handle.alg, version: handle.version, ciphertext: handle.ciphertext,
    });
    seed('sys_setting', {
      id: 'set_18', organization_id: DEFAULT_ORG, namespace: 'tenant_vault', key: 'token', scope: 'tenant',
      user_id: null, value: null, value_enc: handle.id, encrypted: true, locked: false,
    });

    const got = await svc.get('tenant_vault', 'token', { tenantId: DEFAULT_ORG, userId: undefined });
    expect(got.value).toBe('legacy-token');
    expect(got.source).toBe('tenant');
    // Read, not rewritten: the 18.0 stamp is the ceremony's to drop.
    expect(rows('sys_secret')).toEqual([expect.objectContaining({ id: handle.id, organization_id: DEFAULT_ORG })]);
  });

  it('the global rung\'s history reads both tables: the 18.0 row in sys_setting_audit and the new one in the sibling', async () => {
    const { engine, svc, seed } = await boot();
    // The 18.0 shape: a global-rung audit row in sys_setting_audit, stamped
    // with the Default Organization by the 18.0 engine.
    seed('sys_setting_audit', {
      id: 'aud_18', organization_id: DEFAULT_ORG, namespace: 'relay_probe', key: 'api_key', scope: 'global',
      action: 'set', source: 'api', actor_id: null, encrypted: true, new_hash: 'hmac-sha256:18',
      created_at: '2026-10-19T00:00:00.000Z',
    });
    await svc.setMany('relay_probe', { api_key: 're_456' }, { tenantId: DEFAULT_ORG, userId: undefined });

    const where = { namespace: 'relay_probe', key: 'api_key', scope: 'global' };
    const legacy = (await engine.find('sys_setting_audit', { where }, SYS)) as any[];
    const current = (await engine.find('sys_platform_setting_audit', { where }, SYS)) as any[];
    expect(legacy).toEqual([expect.objectContaining({ id: 'aud_18', organization_id: DEFAULT_ORG, new_hash: 'hmac-sha256:18' })]);
    expect(current).toHaveLength(1);
    expect(current[0]!.organization_id ?? null).toBeNull();
    expect(current[0]!.new_hash).not.toBe('hmac-sha256:18');
  });
});
