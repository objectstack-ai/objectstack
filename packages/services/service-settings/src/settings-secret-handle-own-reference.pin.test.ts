// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27722 — the settings write door against the #27582 own-reference rule:
 * **a write may only seal a new value or keep its own record's stored
 * reference.**
 *
 * Measured, not changed: this door never takes a reference from its caller at
 * all. For a declared-encrypted key, `setMany` seals whatever value it is
 * handed and stores the handle that seal minted; the submitted value is never
 * the stored handle, whatever shape it has. These pins hold that answer, so a
 * later change that let a caller-supplied value stand in for the stored handle
 * reds here.
 *
 * Each case names a live handle another organization's write minted, so the
 * pin measures a real stored handle rather than one that names nothing.
 *
 * The writer is an enforced caller (the settings routes' context) holding the
 * namespace's write capability. The in-process caller takes the same path:
 * the door has no reference-bearing branch for any caller.
 */

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SettingsManifest } from '@objectstack/spec/system';
import { SettingsService } from './settings-service.js';
import { LocalCryptoProvider } from './local-crypto-provider.js';
import type { SettingsContext, SettingsSecretStore } from './settings-service.types.js';

const manifest: SettingsManifest = {
  namespace: 'sms',
  version: 1,
  label: 'SMS',
  scope: 'tenant',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  specifiers: [
    { type: 'password', key: 'auth_token', label: 'Auth token', required: false, encrypted: true },
  ],
};

const asOrg = (tenantId: string): SettingsContext => ({
  tenantId,
  userId: `admin_${tenantId}`,
  enforced: true,
  permissions: ['setup.access', 'setup.write'],
});

function boot() {
  const rows = new Map<string, Record<string, unknown>>();
  const secretStore: SettingsSecretStore = {
    async insert(row) { rows.set(row.id, { ...row }); return { id: row.id }; },
    async get(id) { return (rows.get(id) as any) ?? null; },
    async update(id, patch) { rows.set(id, { ...rows.get(id), ...patch }); },
  };
  const svc = new SettingsService({
    env: {},
    cryptoProvider: new LocalCryptoProvider({ key: randomBytes(32) }),
    secretStore,
  });
  svc.registerManifest(manifest);
  return { svc, rows };
}

/** Org A holds a live secret; returns the handle its write minted. */
async function seedOtherOrganization(svc: SettingsService, rows: Map<string, unknown>) {
  const before = new Set(rows.keys());
  await svc.set('sms', 'auth_token', 'org-a-credential', asOrg('org_a'));
  const minted = [...rows.keys()].filter((id) => !before.has(id));
  expect(minted).toHaveLength(1);
  return minted[0];
}

describe('#27722 — the settings write door stores only a handle its own write minted', () => {
  it.each([
    ['the bare handle', (h: string) => h],
    ['a `secret:` reference to it', (h: string) => `secret:${h}`],
  ])('seals %s as a new value rather than storing it as the handle', async (_label, spell) => {
    const { svc, rows } = boot();
    const foreign = await seedOtherOrganization(svc, rows);
    const foreignRow = { ...(rows.get(foreign) as Record<string, unknown>) };
    const submitted = spell(foreign);

    const before = new Set(rows.keys());
    await svc.set('sms', 'auth_token', submitted, asOrg('org_b'));
    const minted = [...rows.keys()].filter((id) => !before.has(id));

    // One new seal, under a handle that is not the submitted one.
    expect(minted).toHaveLength(1);
    expect(minted[0]).not.toBe(foreign);
    // Org B reads back exactly what it wrote — never the credential the
    // named handle holds.
    expect((await svc.get<string>('sms', 'auth_token', asOrg('org_b'))).value).toBe(submitted);
    // The other organization's handle and its value are untouched.
    expect(rows.get(foreign)).toEqual(foreignRow);
    expect((await svc.get<string>('sms', 'auth_token', asOrg('org_a'))).value).toBe('org-a-credential');
  });
});
