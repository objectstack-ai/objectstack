// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Who may restore an API key that an administrator's forced password reset
 * revoked, driven through the real write path: a real `ObjectQL` engine over
 * SQLite, the real `SecurityPlugin` with the shipped permission sets (the owner
 * resolves `member_default` and its `sys_api_key_self` row scope, the platform
 * administrator holds the unscoped `admin_full_access` grant
 * `bootstrapPlatformAdmin` writes), the ADR-0092 D2 identity write guard with
 * the whitelists `auth-plugin.ts` registers, and the restore guard under test.
 *
 * The forced reset's own revocation (`revokeSessionsAndApiKeys`) and the key
 * door (`resolveApiKeyAdmission`) are the real ones too, so a case reads the
 * whole road: the reset stamps the reason, the owner is refused, the
 * administrator restores, and the key works again.
 *
 * Refusals are asserted on the ADR-0112 pair (`code` + `status`) and on the
 * row left unchanged; the message is read only for the restorer and the road
 * it must name.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { hashApiKey, resetPlatformAdminEmailMemo, resolveApiKeyAdmission } from '@objectstack/core';
import { SecurityPlugin, bootstrapPlatformAdmin } from '@objectstack/plugin-security';
import type { PluginContext } from '@objectstack/core';

import { authIdentityObjects } from './manifest.js';
import { registerIdentityWriteGuard, registerManagedUpdateWhitelist } from './identity-write-guard.js';
import { MANAGED_EXTENSION_EDITABLE_FIELDS } from './managed-extension-fields.js';
import { SYS_USER_PROFILE_EDIT_FIELDS } from './sys-user-writable-fields.js';
import { FORCED_RESET_REVOKE_REASON, revokeSessionsAndApiKeys } from './forced-reset-revocation.js';
import { API_KEY_RESTORE_GUARD_PRIORITY, registerApiKeyRestoreGuard } from './api-key-restore-guard.js';
import { AuthPlugin } from './auth-plugin.js';

const SYS = { context: { isSystem: true } } as any;
const ADMIN = 'usr_admin';
const OWNER = 'usr_owner';
/** How the transports hand a member to the engine: no grants, the baseline resolves from the user id. */
const asOwner = { context: { userId: OWNER, positions: [], permissions: [] } } as any;
/** The platform administrator: the unscoped `admin_full_access` grant, as `resolveAuthzContext` resolves it. */
const asAdmin = { context: { userId: ADMIN, positions: [], permissions: ['admin_full_access'] } } as any;

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  resetPlatformAdminEmailMemo();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/** Engine + shipped permission sets + the hook chain `auth-plugin.ts` registers for `sys_api_key`. */
async function rig(): Promise<ObjectQL> {
  resetPlatformAdminEmailMemo();
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engines.push(engine);
  let manifest: { objects?: unknown[]; permissions?: unknown[] } = {};
  const services: Record<string, unknown> = {
    manifest: { register: (m: any) => { manifest = m; } },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission'
          ? ((manifest.permissions as any[]) ?? []).find((p) => p?.name === name) ?? null
          : engine.getSchema(name) ?? null,
      list: async (type?: string) =>
        type === undefined || type === 'permission' ? [...((manifest.permissions as unknown[]) ?? [])] : [],
    },
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    hook: vi.fn(),
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const security = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await security.init(ctx);
  engine.registerApp({
    id: 'com.objectstack.qa.api-key-restore-guard',
    name: 'API key restore guard',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      ...authIdentityObjects,
      ...((manifest.objects ?? []) as any[]).filter((o) =>
        ['sys_position', 'sys_user_position', 'sys_position_permission_set', 'sys_user_permission_set'].includes(o?.name)),
    ],
  } as any);
  await engine.syncSchemas();
  // [ADR-0131 D3/D5] The Default Organization a `single` boot creates before
  // `kernel:ready` (AuthPlugin's invariant); it owns the promotion's grant.
  await engine.insert('sys_organization', { id: 'org_default', name: 'Default Organization', slug: 'default' }, SYS);
  await security.start(ctx);
  vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);

  // The `kernel:ready` registrations of `auth-plugin.ts`, in its order.
  registerManagedUpdateWhitelist('sys_user', SYS_USER_PROFILE_EDIT_FIELDS);
  for (const [object, fields] of Object.entries(MANAGED_EXTENSION_EDITABLE_FIELDS)) {
    if (object !== 'sys_user') registerManagedUpdateWhitelist(object, fields);
  }
  registerIdentityWriteGuard(engine, { packageId: 'test.identity-write-guard' });
  registerApiKeyRestoreGuard(engine, { packageId: 'test.api-key-restore-guard' });

  for (const [id, createdAt] of [[ADMIN, '2025-01-01T00:00:00.000Z'], [OWNER, '2025-03-01T00:00:00.000Z']]) {
    await engine.insert(
      'sys_user', { id, email: `${id}@keys.example`, name: id, created_at: createdAt, email_verified: true, banned: false }, SYS,
    );
    await engine.insert(
      'sys_account', { id: `acc_${id}`, user_id: id, account_id: `${id}@keys.example`, provider_id: 'credential' }, SYS,
    );
  }
  const boot = await bootstrapPlatformAdmin(engine, (manifest.permissions ?? []) as any[]);
  expect(boot).toMatchObject({ adminPromoted: true, adminUserId: ADMIN });
  return engine;
}

/** Mint a key the way `POST /api/v1/keys` writes the row (system context, hash only). */
async function mint(engine: ObjectQL, id: string, owner = OWNER): Promise<string> {
  const raw = `osk_${id}_${'x'.repeat(24)}`;
  await engine.insert(
    'sys_api_key',
    { id, name: id, key: hashApiKey(raw), prefix: raw.slice(0, 12), user_id: owner, revoked: false },
    SYS,
  );
  return raw;
}

const row = async (engine: ObjectQL, id: string): Promise<{ revoked: boolean; revoked_reason: string | null }> => {
  const found = ((await engine.find('sys_api_key', { where: { id }, ...SYS })) as any[])[0];
  return { revoked: found.revoked === true || found.revoked === 1, revoked_reason: found.revoked_reason ?? null };
};

const refusalOf = async (write: Promise<unknown>): Promise<any> => write.then(() => undefined, (e: unknown) => e);

/** The key door's verdict for a raw key: `admitted`, or the lifecycle refusal's code and message. */
async function door(engine: ObjectQL, raw: string): Promise<{ outcome: string; code?: string; message?: string }> {
  const admission = await resolveApiKeyAdmission(engine, { 'x-api-key': raw }, Date.now(), undefined, undefined, undefined);
  if (admission.outcome === 'lifecycle') {
    return { outcome: 'lifecycle', code: admission.refusal.code, message: admission.refusal.message };
  }
  return { outcome: admission.outcome };
}

describe('the forced reset stamps the reason, and only a platform administrator restores such a key', () => {
  it('the forced reset revokes the key and stamps admin_password_reset; a key already revoked keeps no reason', async () => {
    const engine = await rig();
    await mint(engine, 'key_live');
    await mint(engine, 'key_owner_revoked');
    await engine.update('sys_api_key', { id: 'key_owner_revoked', revoked: true }, asOwner);

    const outcome = await revokeSessionsAndApiKeys(engine as any, OWNER);

    expect(outcome).toMatchObject({ apiKeys: 1, failed: 0 });
    expect(await row(engine, 'key_live')).toEqual({ revoked: true, revoked_reason: FORCED_RESET_REVOKE_REASON });
    // Not written by the reset, so its reason stays the truthful one: none.
    expect(await row(engine, 'key_owner_revoked')).toEqual({ revoked: true, revoked_reason: null });
  });

  it('the owner\'s restore of a reset-revoked key is refused 403 PERMISSION_DENIED, naming the restorer and the new-key road', async () => {
    const engine = await rig();
    const raw = await mint(engine, 'key_reset');
    await revokeSessionsAndApiKeys(engine as any, OWNER);

    const err = await refusalOf(engine.update('sys_api_key', { id: 'key_reset', revoked: false }, asOwner));

    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(String(err.message)).toContain('forced password reset');
    expect(String(err.message)).toContain('platform administrator');
    expect(String(err.message)).toContain('POST /api/v1/keys');
    // Refused, not merely reported: the row and the key are as the reset left them.
    expect(await row(engine, 'key_reset')).toEqual({ revoked: true, revoked_reason: FORCED_RESET_REVOKE_REASON });
    expect((await door(engine, raw)).code).toBe('API_KEY_REVOKED');
  });

  it('a platform administrator restores it: the write lands, the reason clears, and the key works again', async () => {
    const engine = await rig();
    const raw = await mint(engine, 'key_reset');
    await revokeSessionsAndApiKeys(engine as any, OWNER);

    await engine.update('sys_api_key', { id: 'key_reset', revoked: false }, asAdmin);

    expect(await row(engine, 'key_reset')).toEqual({ revoked: false, revoked_reason: null });
    expect((await door(engine, raw)).outcome).toBe('admitted');
  });

  it('CONTROL: the owner revokes and restores a plain key as before, and no reason is ever recorded', async () => {
    const engine = await rig();
    const raw = await mint(engine, 'key_plain');

    await engine.update('sys_api_key', { id: 'key_plain', revoked: true }, asOwner);
    expect(await row(engine, 'key_plain')).toEqual({ revoked: true, revoked_reason: null });
    expect((await door(engine, raw)).code).toBe('API_KEY_REVOKED');

    await engine.update('sys_api_key', { id: 'key_plain', revoked: false }, asOwner);
    expect(await row(engine, 'key_plain')).toEqual({ revoked: false, revoked_reason: null });
    expect((await door(engine, raw)).outcome).toBe('admitted');
  });

  it('the owner re-revoking a reset-revoked key keeps the reason, so the restore after it is still refused', async () => {
    const engine = await rig();
    await mint(engine, 'key_reset');
    await revokeSessionsAndApiKeys(engine as any, OWNER);

    await engine.update('sys_api_key', { id: 'key_reset', revoked: true }, asOwner);
    expect(await row(engine, 'key_reset')).toEqual({ revoked: true, revoked_reason: FORCED_RESET_REVOKE_REASON });

    // The reason sent by the caller is not a write it may make (readonly, not on the D2 whitelist).
    await engine.update('sys_api_key', { id: 'key_reset', revoked: true, revoked_reason: null }, asOwner);
    expect(await row(engine, 'key_reset')).toEqual({ revoked: true, revoked_reason: FORCED_RESET_REVOKE_REASON });

    const err = await refusalOf(engine.update('sys_api_key', { id: 'key_reset', revoked: false }, asOwner));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(await row(engine, 'key_reset')).toEqual({ revoked: true, revoked_reason: FORCED_RESET_REVOKE_REASON });
  });

  it('the key door names the restorer per reason: a platform administrator only after a forced reset', async () => {
    const engine = await rig();
    const resetRaw = await mint(engine, 'key_reset');
    await revokeSessionsAndApiKeys(engine as any, OWNER);
    const plainRaw = await mint(engine, 'key_plain');
    await engine.update('sys_api_key', { id: 'key_plain', revoked: true }, asOwner);

    const reset = await door(engine, resetRaw);
    const plain = await door(engine, plainRaw);

    expect([reset.code, plain.code]).toEqual(['API_KEY_REVOKED', 'API_KEY_REVOKED']);
    expect(reset.message).toMatch(/Only a platform administrator can restore it/);
    expect(reset.message).not.toMatch(/owner/i);
    expect(plain.message).toMatch(/Its owner or a platform administrator can restore it/);
  });
});

describe('a multi-row update is judged row by row, on each row\'s own pre-image', () => {
  it('the owner\'s batch restore that includes a reset-revoked key is refused whole: neither row moves', async () => {
    const engine = await rig();
    await mint(engine, 'key_reset');
    await revokeSessionsAndApiKeys(engine as any, OWNER);
    await mint(engine, 'key_plain');
    await engine.update('sys_api_key', { id: 'key_plain', revoked: true }, asOwner);

    const err = await refusalOf(engine.update(
      'sys_api_key', { revoked: false }, { where: { user_id: OWNER, revoked: true }, multi: true, ...asOwner },
    ));

    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(await row(engine, 'key_reset')).toEqual({ revoked: true, revoked_reason: FORCED_RESET_REVOKE_REASON });
    expect(await row(engine, 'key_plain')).toEqual({ revoked: true, revoked_reason: null });
  });

  it('the owner\'s batch restore of plain keys only is admitted (each row read by its own previous)', async () => {
    const engine = await rig();
    await mint(engine, 'key_a');
    await mint(engine, 'key_b');
    await engine.update('sys_api_key', { id: 'key_a', revoked: true }, asOwner);
    await engine.update('sys_api_key', { id: 'key_b', revoked: true }, asOwner);

    await engine.update('sys_api_key', { revoked: false }, { where: { user_id: OWNER, revoked: true }, multi: true, ...asOwner });

    expect([await row(engine, 'key_a'), await row(engine, 'key_b')]).toEqual([
      { revoked: false, revoked_reason: null },
      { revoked: false, revoked_reason: null },
    ]);
  });

  it('a platform administrator\'s batch restore clears the reason on every row it restores', async () => {
    const engine = await rig();
    await mint(engine, 'key_a');
    await mint(engine, 'key_b');
    await revokeSessionsAndApiKeys(engine as any, OWNER);

    await engine.update('sys_api_key', { revoked: false }, { where: { user_id: OWNER, revoked: true }, multi: true, ...asAdmin });

    expect([await row(engine, 'key_a'), await row(engine, 'key_b')]).toEqual([
      { revoked: false, revoked_reason: null },
      { revoked: false, revoked_reason: null },
    ]);
  });
});

describe('system-context writes are never refused', () => {
  it('a system un-revoke of a reset-revoked key lands and clears the reason; a system stamp leaves it', async () => {
    const engine = await rig();
    await mint(engine, 'key_reset');
    await revokeSessionsAndApiKeys(engine as any, OWNER);

    // The key door's `last_used_at` stamp shape: a system write that does not touch `revoked`.
    await engine.update('sys_api_key', { id: 'key_reset', last_used_at: new Date().toISOString() }, SYS);
    expect(await row(engine, 'key_reset')).toEqual({ revoked: true, revoked_reason: FORCED_RESET_REVOKE_REASON });

    await engine.update('sys_api_key', { id: 'key_reset', revoked: false }, SYS);
    expect(await row(engine, 'key_reset')).toEqual({ revoked: false, revoked_reason: null });
  });
});

describe('auth-plugin registers the guard on `kernel:ready`, after the ADR-0092 D2 guard', () => {
  it('one beforeUpdate hook on sys_api_key, at a priority after the identity write guard', async () => {
    const registered: Array<{ event: string; options: any }> = [];
    const engine = {
      registerHook: (event: string, _handler: unknown, options: any) => { registered.push({ event, options }); },
      getSchema: () => undefined,
    };
    const ready: Array<() => Promise<void>> = [];
    const ctx = {
      registerService: vi.fn(),
      getService: vi.fn((name: string): any => {
        if (name === 'manifest') return { register: vi.fn() };
        if (name === 'objectql') return engine;
        return undefined;
      }),
      getServices: vi.fn(() => new Map()),
      hook: vi.fn((name: string, handler: () => Promise<void>) => { if (name === 'kernel:ready') ready.push(handler); }),
      trigger: vi.fn(),
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      getKernel: vi.fn(),
    } as unknown as PluginContext;
    const plugin = new AuthPlugin({ secret: 'test-secret-at-least-32-chars-long', baseUrl: 'http://localhost:3000' });
    await plugin.init(ctx);
    await plugin.start(ctx);
    for (const handler of ready) {
      try { await handler(); } catch { /* other kernel:ready work needs services this double does not offer */ }
    }

    const restore = registered.filter((r) => r.options?.packageId === 'com.objectstack.plugin-auth.api-key-restore-guard');
    const d2 = registered.find(
      (r) => r.event === 'beforeUpdate' && r.options?.packageId === 'com.objectstack.plugin-auth.identity-write-guard',
    );
    expect(restore.map((r) => [r.event, r.options.object, r.options.priority])).toEqual([
      ['beforeUpdate', 'sys_api_key', API_KEY_RESTORE_GUARD_PRIORITY],
    ]);
    expect(d2?.options.priority).toBe(10);
    expect(API_KEY_RESTORE_GUARD_PRIORITY).toBeGreaterThan(d2!.options.priority);
  });
});
