// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0092 D2/D6 — identity write guard.
 *
 * The guard is exercised through a fake engine that records registerHook
 * calls, so each registered handler is driven directly with synthetic
 * HookContext shapes matching what ObjectQLEngine builds (session from
 * buildSession, input.{id,data,options}).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerIdentityWriteGuard,
  registerManagedUpdateWhitelist,
  getManagedUpdateWhitelist,
} from './identity-write-guard.js';
import {
  SYS_USER_PROFILE_EDIT_FIELDS,
  SYS_USER_IMPORT_UPDATE_FIELDS,
} from './sys-user-writable-fields.js';

type Handler = (ctx: any) => Promise<void>;

/** Fake engine capturing hook registrations, with a static schema registry. */
function makeEngine(schemas: Record<string, any>) {
  const handlers: Record<string, Array<{ handler: Handler; options: any }>> = {};
  return {
    handlers,
    getSchema: (name: string) => schemas[name],
    registerHook: (event: string, handler: Handler, options: any) => {
      (handlers[event] ??= []).push({ handler, options });
    },
  };
}

const SCHEMAS = {
  sys_user: { name: 'sys_user', managedBy: 'better-auth' },
  sys_member: { name: 'sys_member', managedBy: 'better-auth' },
  sys_session: { name: 'sys_session', managedBy: 'better-auth' },
  crm_lead: { name: 'crm_lead' },
  sys_automation_run: { name: 'sys_automation_run', managedBy: 'engine-owned' },
};

/** Session shapes as ObjectQLEngine.buildSession produces them. */
const USER_SESSION = { userId: 'usr_1', positions: [] };
const SYSTEM_SESSION = { userId: 'usr_1', isSystem: true };

function guardOn(engine: ReturnType<typeof makeEngine>, event: string): Handler {
  const entry = engine.handlers[event]?.find(
    (h) => h.options?.packageId?.includes('identity-write-guard'),
  );
  if (!entry) throw new Error(`no guard handler registered for ${event}`);
  return entry.handler;
}

function freshEngine() {
  const engine = makeEngine(SCHEMAS);
  registerManagedUpdateWhitelist('sys_user', SYS_USER_PROFILE_EDIT_FIELDS);
  registerIdentityWriteGuard(engine, { packageId: 'test.identity-write-guard' });
  return engine;
}

describe('identity write guard — insert/delete (ADR-0092 D2)', () => {
  let engine: ReturnType<typeof makeEngine>;
  beforeEach(() => {
    engine = freshEngine();
  });

  it('rejects a user-context insert on every managedBy:better-auth table', async () => {
    for (const object of ['sys_user', 'sys_member', 'sys_session']) {
      await expect(
        guardOn(engine, 'beforeInsert')({ object, session: USER_SESSION, input: { data: {} } }),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403, object });
    }
  });

  it('rejects a user-context delete, with a message pointing at the dedicated surfaces', async () => {
    await expect(
      guardOn(engine, 'beforeDelete')({ object: 'sys_member', session: USER_SESSION, input: { id: 'm1' } }),
    ).rejects.toThrow(/managed by better-auth.*dedicated auth surface/s);
  });

  it('bypasses system-context and context-less (better-auth adapter) writes', async () => {
    for (const event of ['beforeInsert', 'beforeDelete']) {
      await expect(
        guardOn(engine, event)({ object: 'sys_user', session: SYSTEM_SESSION, input: {} }),
      ).resolves.toBeUndefined();
      await expect(
        guardOn(engine, event)({ object: 'sys_user', session: undefined, input: {} }),
      ).resolves.toBeUndefined();
    }
  });

  // NOTE: `system`/`append-only` buckets are guarded by plugin-security's
  // engine-owned write guard (ADR-0103), NOT by THIS identity guard — which
  // stays scoped to `better-auth`. So `sys_automation_run` is correctly ignored
  // here even though it is guarded elsewhere.
  it('ignores objects that are not managed by better-auth (incl. other managedBy buckets)', async () => {
    for (const object of ['crm_lead', 'sys_automation_run', 'not_registered']) {
      await expect(
        guardOn(engine, 'beforeInsert')({ object, session: USER_SESSION, input: { data: {} } }),
      ).resolves.toBeUndefined();
    }
  });
});

describe('identity write guard — update whitelist (ADR-0092 D2)', () => {
  let engine: ReturnType<typeof makeEngine>;
  beforeEach(() => {
    engine = freshEngine();
  });

  it('strips non-whitelisted fields in place and lets whitelisted ones through', async () => {
    const data: any = { id: 'u1', name: 'New Name', image: 'https://x/a.png', email: 'evil@x', role: 'admin' };
    await guardOn(engine, 'beforeUpdate')({
      object: 'sys_user',
      session: USER_SESSION,
      input: { id: 'u1', data },
    });
    expect(data).toEqual({ id: 'u1', name: 'New Name', image: 'https://x/a.png' });
  });

  it('throws when every submitted field is non-whitelisted (loud failure, not a silent no-op)', async () => {
    const data: any = { id: 'u1', email: 'evil@x', must_change_password: false };
    await expect(
      guardOn(engine, 'beforeUpdate')({ object: 'sys_user', session: USER_SESSION, input: { id: 'u1', data } }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    // The error names what IS editable so the caller can fix the payload.
    await expect(
      guardOn(engine, 'beforeUpdate')({ object: 'sys_user', session: USER_SESSION, input: { id: 'u1', data: { email: 'e@x' } } }),
    ).rejects.toThrow(/Editable fields: name, image, locale/);
  });

  it('passes engine-stamped lifecycle columns through, but they never satisfy the whitelist alone', async () => {
    // The REST data routes stamp updated_at on every update — a legit
    // profile edit must keep it (audit freshness)…
    const ok: any = { id: 'u1', name: 'N', updated_at: '2026-07-11T00:00:00Z' };
    await guardOn(engine, 'beforeUpdate')({ object: 'sys_user', session: USER_SESSION, input: { id: 'u1', data: ok } });
    expect(ok).toEqual({ id: 'u1', name: 'N', updated_at: '2026-07-11T00:00:00Z' });
    // …but an email-only PATCH must still fail loudly, not degrade into a
    // timestamp touch.
    await expect(
      guardOn(engine, 'beforeUpdate')({
        object: 'sys_user',
        session: USER_SESSION,
        input: { id: 'u1', data: { email: 'evil@x', updated_at: '2026-07-11T00:00:00Z' } },
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects updates to managed tables with NO registered whitelist (default-deny)', async () => {
    await expect(
      guardOn(engine, 'beforeUpdate')({
        object: 'sys_member',
        session: USER_SESSION,
        input: { id: 'm1', data: { role: 'owner' } },
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', object: 'sys_member' });
  });

  it('filters the payload of multi-row updates too (input.id undefined)', async () => {
    const data: any = { banned: true, name: 'Bulk Rename' };
    await guardOn(engine, 'beforeUpdate')({
      object: 'sys_user',
      session: USER_SESSION,
      input: { id: undefined, data, options: { multi: true } },
    });
    expect(data).toEqual({ name: 'Bulk Rename' });
  });

  it('bypasses system-context and context-less updates entirely (no stripping)', async () => {
    const data: any = { id: 'u1', must_change_password: true };
    await guardOn(engine, 'beforeUpdate')({ object: 'sys_user', session: SYSTEM_SESSION, input: { id: 'u1', data } });
    expect(data).toEqual({ id: 'u1', must_change_password: true });
    await guardOn(engine, 'beforeUpdate')({ object: 'sys_user', session: undefined, input: { id: 'u1', data } });
    expect(data).toEqual({ id: 'u1', must_change_password: true });
  });

  it('exposes the registered whitelist for introspection', () => {
    // FLIPPED, not deleted (maintainer ruling 2026-09-03, option B — adopted
    // 「同意」): this pin recorded `{name, image}` from ADR-0092 until the
    // ruling grew the identity table's user-writable set to three fields. The
    // old reading was a real decision that a later decision overturned, so it
    // is reversed here with the reversal named rather than removed.
    expect(getManagedUpdateWhitelist('sys_user')).toEqual(new Set(['name', 'image', 'locale']));
    expect(getManagedUpdateWhitelist('sys_session')).toBeUndefined();
  });

  // ── The security boundary the widening moved, pinned from both sides ──
  //
  // The first pin says the ruling shipped. The SECOND is the one that catches
  // a widening that widened too far, and it is the reason this block exists:
  // "the whitelist grew" and "the whitelist grew by exactly one name" are
  // different claims, and only the second is what was ruled.

  it('lets a user set their own locale — the write the 2026-09-03 ruling opened', async () => {
    const data: any = { id: 'u1', locale: 'zh-CN' };
    await guardOn(engine, 'beforeUpdate')({
      object: 'sys_user',
      session: USER_SESSION,
      input: { id: 'u1', data },
    });
    // Survived the guard untouched — no strip, no throw.
    expect(data).toEqual({ id: 'u1', locale: 'zh-CN' });
  });

  it('still refuses EVERY other sys_user column — the widening is one name wide', async () => {
    // One entry per ADR-0092 D1 tier-2/tier-3 family, so a whitelist that
    // widened past `locale` fails here rather than in production: authorization
    // state, the sign-in identifier, the credential stamps, the org-structure
    // projections, the AI seat, and the identity provenance.
    const forbiddenColumns = [
      'role', 'banned', 'ban_reason', 'ban_expires',
      'email', 'email_verified', 'phone_number',
      'must_change_password', 'password_changed_at',
      'manager_id', 'primary_business_unit_id',
      'ai_access', 'source', 'two_factor_enabled',
    ];
    for (const column of forbiddenColumns) {
      // Alone: refused loudly, never a silent no-op.
      await expect(
        guardOn(engine, 'beforeUpdate')({
          object: 'sys_user',
          session: USER_SESSION,
          input: { id: 'u1', data: { [column]: 'x' } },
        }),
        `${column} must not be user-writable`,
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
      // Smuggled beside the one column that IS writable: stripped in place,
      // and the legitimate half still commits. This is the shape a form
      // round-trip actually produces, and the one a "the payload was accepted"
      // check would miss.
      const smuggled: any = { id: 'u1', locale: 'ja-JP', [column]: 'x' };
      await guardOn(engine, 'beforeUpdate')({
        object: 'sys_user',
        session: USER_SESSION,
        input: { id: 'u1', data: smuggled },
      });
      expect(smuggled, `${column} must be stripped, not committed`).toEqual({ id: 'u1', locale: 'ja-JP' });
    }
  });
});

describe('identity write guard — session snapshot refresh (ADR-0092 D6)', () => {
  const NOW = Date.now();
  const EXPIRES = new Date(NOW + 3600_000).toISOString();

  function makeStorage(userId: string, tokens: string[]) {
    const store = new Map<string, string>();
    store.set(
      `active-sessions-${userId}`,
      JSON.stringify(tokens.map((token) => ({ token, expiresAt: NOW + 3600_000 }))),
    );
    for (const token of tokens) {
      store.set(
        token,
        JSON.stringify({
          session: { token, userId, expiresAt: EXPIRES },
          user: { id: userId, name: 'Old Name', image: null, email: 'a@b.c' },
        }),
      );
    }
    const ttls: Record<string, number | undefined> = {};
    return {
      store,
      ttls,
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string, ttl?: number) => {
        store.set(k, v);
        ttls[k] = ttl;
      }),
      delete: vi.fn(async (k: string) => void store.delete(k)),
    };
  }

  function engineWithStorage(storage: any) {
    const engine = makeEngine(SCHEMAS);
    registerManagedUpdateWhitelist('sys_user', SYS_USER_PROFILE_EDIT_FIELDS);
    registerIdentityWriteGuard(engine, {
      packageId: 'test.identity-write-guard',
      getSecondaryStorage: () => storage,
    });
    return engine;
  }

  it('re-writes every live cached session with the changed profile fields (same user, keeps TTL, never deletes)', async () => {
    const storage = makeStorage('u1', ['tok-a', 'tok-b']);
    const engine = engineWithStorage(storage);
    await guardOn(engine, 'afterUpdate')({
      object: 'sys_user',
      session: USER_SESSION,
      input: { id: 'u1', data: { name: 'New Name' } },
    });
    for (const token of ['tok-a', 'tok-b']) {
      const entry = JSON.parse(storage.store.get(token)!);
      expect(entry.user).toMatchObject({ id: 'u1', name: 'New Name', email: 'a@b.c' });
      expect(entry.session.token).toBe(token);
      expect(storage.ttls[token]).toBeGreaterThan(0);
    }
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('does NOT mirror `locale` into the snapshot — better-auth has no such user field', async () => {
    // The whitelist grew on 2026-09-03; this mirror deliberately did not.
    // better-auth neither reads nor writes `locale` (not on its user model, not
    // an `additionalFields` entry), so there is no cached copy to keep
    // coherent — and writing one would invent a `user.locale` that exists only
    // on sessions that happen to be cached, only after a profile edit. That is
    // the opposite of what D6 is for.
    const storage = makeStorage('u1', ['tok-a']);
    const engine = engineWithStorage(storage);
    await guardOn(engine, 'afterUpdate')({
      object: 'sys_user',
      session: USER_SESSION,
      input: { id: 'u1', data: { locale: 'zh-CN' } },
    });
    expect(storage.set).not.toHaveBeenCalled();
    expect(JSON.parse(storage.store.get('tok-a')!).user).not.toHaveProperty('locale');

    // …and a locale change riding along with a mirrored one refreshes ONLY the
    // mirrored half, rather than dragging `locale` in behind it.
    await guardOn(engine, 'afterUpdate')({
      object: 'sys_user',
      session: USER_SESSION,
      input: { id: 'u1', data: { name: 'New Name', locale: 'ja-JP' } },
    });
    const entry = JSON.parse(storage.store.get('tok-a')!);
    expect(entry.user).toMatchObject({ id: 'u1', name: 'New Name' });
    expect(entry.user).not.toHaveProperty('locale');
  });

  it('no-ops without secondary storage, without a whitelisted change, or for system writes', async () => {
    const storage = makeStorage('u1', ['tok-a']);
    // System write — better-auth's own paths already refresh.
    let engine = engineWithStorage(storage);
    await guardOn(engine, 'afterUpdate')({
      object: 'sys_user',
      session: SYSTEM_SESSION,
      input: { id: 'u1', data: { name: 'X' } },
    });
    expect(storage.set).not.toHaveBeenCalled();
    // Non-whitelisted change only (nothing survived the guard anyway).
    await guardOn(engine, 'afterUpdate')({
      object: 'sys_user',
      session: USER_SESSION,
      input: { id: 'u1', data: { last_login_ip: '1.2.3.4' } },
    });
    expect(storage.set).not.toHaveBeenCalled();
    // No storage wired.
    engine = engineWithStorage(undefined);
    await expect(
      guardOn(engine, 'afterUpdate')({
        object: 'sys_user',
        session: USER_SESSION,
        input: { id: 'u1', data: { name: 'X' } },
      }),
    ).resolves.toBeUndefined();
  });

  it('survives storage failures without breaking the write', async () => {
    const storage = {
      get: vi.fn(async () => {
        throw new Error('redis down');
      }),
      set: vi.fn(),
      delete: vi.fn(),
    };
    const engine = engineWithStorage(storage);
    await expect(
      guardOn(engine, 'afterUpdate')({
        object: 'sys_user',
        session: USER_SESSION,
        input: { id: 'u1', data: { name: 'X' } },
      }),
    ).resolves.toBeUndefined();
  });
});

describe('sys-user writable-field tiers (ADR-0092 D3)', () => {
  it('import whitelist is a strict superset of the profile whitelist', () => {
    for (const f of SYS_USER_PROFILE_EDIT_FIELDS) {
      expect(SYS_USER_IMPORT_UPDATE_FIELDS.has(f)).toBe(true);
    }
    expect(SYS_USER_IMPORT_UPDATE_FIELDS.has('phone_number')).toBe(true);
    expect(SYS_USER_IMPORT_UPDATE_FIELDS.has('role')).toBe(true);
    // The profile tier stays profile-only.
    expect(SYS_USER_PROFILE_EDIT_FIELDS.has('role')).toBe(false);
    expect(SYS_USER_PROFILE_EDIT_FIELDS.has('email')).toBe(false);
  });

  it('the profile tier is exactly {name, image, locale} (2026-09-03 ruling)', () => {
    // The set literal, pinned as a whole rather than by membership probes: a
    // `has()` pin per name cannot see a FOURTH name arriving, which is the
    // direction a security-boundary widening drifts. The old two-name reading
    // is not deleted — it is this assertion, reversed by the ruling that
    // reversed the decision.
    expect([...SYS_USER_PROFILE_EDIT_FIELDS].sort()).toEqual(['image', 'locale', 'name']);
    // Import inherits the widening by construction (a spread, not a second
    // list) and adds its own two — so this stays a strict superset of exactly
    // five, and a hand-edit that de-linked the two lists shows up here.
    expect([...SYS_USER_IMPORT_UPDATE_FIELDS].sort()).toEqual([
      'image', 'locale', 'name', 'phone_number', 'role',
    ]);
  });
});
