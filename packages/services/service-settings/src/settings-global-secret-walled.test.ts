// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 C8 stage 8b, BRIDGE] A global-scope encrypted setting under a
 * walled posture, through a REAL ObjectQL engine.
 *
 * A global value is deployment-level, so its `sys_secret` ciphertext names no
 * organization (`settings-secret-organization.test.ts` pins the row shape,
 * over a fake engine). `sys_secret` keeps its organization column until the
 * steps 5+6 landing flips it (epic ruling record 6270035914 on #15194, item
 * 2), so under `group` / `isolated` that organization-less system insert must
 * keep landing: the walled organization-less bridge in
 * `Engine.resolveSystemInsertOrganization` holds it. Without the bridge the
 * operator's global encrypted setting is a 500
 * `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED`, and nothing is written.
 *
 * The writer is the production pair: `SettingsService` building the row and
 * the plugin's own secret store (`SettingsServicePlugin` → `buildSecretStore`)
 * inserting it with `{ context: { isSystem: true } }`.
 */

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SysSecret } from '@objectstack/platform-objects/system';
import { SettingsService } from './settings-service.js';
import { SettingsServicePlugin } from './settings-service-plugin.js';
import { LocalCryptoProvider } from './local-crypto-provider.js';
import { mailSettingsManifest } from './manifests/mail.manifest.js';
import type { SettingsSecretStore } from './settings-service.types.js';

/** A driver over plain Maps — enough of `IDataDriver` for a secret insert and its read. */
function makeMemoryDriver() {
  const rows = new Map<string, Map<string, Record<string, unknown>>>();
  const rowsOf = (object: string) => {
    let s = rows.get(object);
    if (!s) { s = new Map(); rows.set(object, s); }
    return s;
  };
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return (row[k] ?? null) === (v ?? null);
    });
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      const found = [...rowsOf(object).values()].filter((r) => matches(r, ast?.where));
      const page = typeof ast?.limit === 'number' ? found.slice(0, ast.limit) : found;
      return page.map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: any) {
      for (const r of rowsOf(object).values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      const row = { ...data, id: (data.id as string) ?? `row_${rowsOf(object).size + 1}` };
      rowsOf(object).set(row.id as string, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const cur = rowsOf(object).get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id };
      rowsOf(object).set(id, next);
      return { ...next };
    },
    async delete(object: string, id: string) { return rowsOf(object).delete(id); },
    async count(object: string, ast: any) {
      return [...rowsOf(object).values()].filter((r) => matches(r, ast?.where)).length;
    },
    async bulkCreate(object: string, list: Record<string, unknown>[]) {
      return Promise.all(list.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async syncSchema() {}, async dropTable() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, rowsOf };
}

async function boot(posture: 'isolated' | 'group') {
  const engine = new ObjectQL();
  const { driver, rowsOf } = makeMemoryDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.setTenancyPostureProvider(() => posture);
  engine.registry.registerObject(SysSecret as any, 'test');
  const secretStore = (new SettingsServicePlugin() as any).buildSecretStore(engine) as SettingsSecretStore;
  const svc = new SettingsService({
    env: {},
    cryptoProvider: new LocalCryptoProvider({ key: randomBytes(32) }),
    secretStore,
  });
  svc.registerManifest(mailSettingsManifest);
  return { svc, secrets: () => [...rowsOf('sys_secret').values()] };
}

describe('[C8 stage 8b] a global encrypted setting under a wall, on a real engine', () => {
  it.each(['isolated', 'group'] as const)(
    '%s: the platform operator sets one, and its organization-less sys_secret row lands',
    async (posture) => {
      const { svc, secrets } = await boot(posture);
      await svc.setMany('mail', { provider: 'resend', api_key: 're_bridge_pin', from_email: 'ops@example.com' }, { userId: 'usr-op' });

      const stored = secrets();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ namespace: 'mail', key: 'api_key' });
      expect(stored[0].organization_id ?? null).toBeNull();
      expect((await svc.get('mail', 'api_key', {}))?.value).toBe('re_bridge_pin');
    },
  );
});
