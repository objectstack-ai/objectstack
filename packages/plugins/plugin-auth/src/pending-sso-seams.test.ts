// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#33181] The seams under the pending-person doors, one module at a time:
// the host notifier (fail-open, never throws), the session admission refusal
// (pending, banned without the admin plugin, a read that fails), the
// engine-backed ban writer, and the ban doors choosing their writer and
// telling the host. The doors end to end are pinned in
// `pending-sso-users.test.ts`.

import { describe, it, expect, vi } from 'vitest';
import { notifyEnvironmentUserHost, type EnvironmentUserEvent } from './environment-user-host';
import {
  BANNED_USER_SESSION_REFUSAL,
  PENDING_SSO_SESSION_REFUSAL,
  refuseInactiveUserSession,
} from './user-session-admission';
import { USER_ROW_READ_FAULT_REFUSAL } from './service-account-identity';
import { engineUserBanWriter } from './user-ban-write';
import { runAdminBanUser, runAdminUnbanUser, type AuthBanContextLike } from './admin-ban-endpoints';
import { isPendingSsoSource, pendingSsoPasswordRefusal, PENDING_SSO_MESSAGES, PENDING_SSO_SOURCE } from './pending-sso-marker';

const EVENT: EnvironmentUserEvent = {
  userId: 'usr_1',
  email: 'one@example.com',
  name: 'One',
  source: PENDING_SSO_SOURCE,
  actorId: 'usr_admin',
  occurredAt: '2026-11-14T00:00:00.000Z',
};

describe('[#33181] the environment-user host notifier', () => {
  it('calls the member for the kind, once, and answers notified', async () => {
    const host = { userAdded: vi.fn(), userDeactivated: vi.fn(), userReactivated: vi.fn() };
    expect(await notifyEnvironmentUserHost(() => host, 'deactivated', EVENT)).toEqual({ notified: true });
    expect(host.userDeactivated).toHaveBeenCalledExactlyOnceWith(EVENT);
    expect(host.userAdded).not.toHaveBeenCalled();
    expect(host.userReactivated).not.toHaveBeenCalled();
  });

  it('a host that throws is answered host_failed and logged, never rethrown', async () => {
    const warn = vi.fn();
    const host = { userAdded: () => Promise.reject(new Error('cloud down')), userDeactivated: vi.fn(), userReactivated: vi.fn() };
    expect(await notifyEnvironmentUserHost(() => host, 'added', EVENT, { warn })).toEqual({ notified: false, reason: 'host_failed' });
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]![0])).toContain('cloud down');
  });

  it('an accessor that throws is answered host_failed too', async () => {
    const outcome = await notifyEnvironmentUserHost(() => {
      throw new Error('not wired yet');
    }, 'reactivated', EVENT);
    expect(outcome).toEqual({ notified: false, reason: 'host_failed' });
  });

  it('no accessor, or one that answers nothing, is answered no_host', async () => {
    expect(await notifyEnvironmentUserHost(undefined, 'added', EVENT)).toEqual({ notified: false, reason: 'no_host' });
    expect(await notifyEnvironmentUserHost(() => undefined, 'added', EVENT)).toEqual({ notified: false, reason: 'no_host' });
  });
});

/** An engine with one `sys_user` row; records updates. */
function rowEngine(
  row: Record<string, unknown> | undefined,
  opts: { readFails?: boolean; accounts?: Array<Record<string, unknown>> } = {},
) {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    find: vi.fn(async (object: string, query?: { where?: Record<string, unknown> }) => {
      if (opts.readFails) throw new Error('store down');
      if (object === 'sys_account') {
        return (opts.accounts ?? []).filter((a) =>
          Object.entries(query?.where ?? {}).every(([k, v]) => a[k] === v),
        );
      }
      return row ? [row] : [];
    }),
    update: vi.fn(async (_object: string, data: Record<string, unknown>) => {
      updates.push(data);
      return data;
    }),
  };
}

describe('[#33181] the session admission refusal', () => {
  const admitAll = { enforceBan: () => true };

  it('refuses a pending row 403 PERMISSION_DENIED', async () => {
    const engine = rowEngine({ id: 'u', source: PENDING_SSO_SOURCE });
    await expect(refuseInactiveUserSession(engine, { userId: 'u' }, admitAll)).rejects.toMatchObject({
      statusCode: 403,
      body: expect.objectContaining({ code: 'PERMISSION_DENIED', message: PENDING_SSO_SESSION_REFUSAL.message }),
    });
  });

  it('refuses a banned row 403 BANNED_USER when it enforces bans, asking only for a banned row', async () => {
    const enforceBan = vi.fn(() => true);
    await expect(
      refuseInactiveUserSession(rowEngine({ id: 'u', source: 'env_native', banned: true }), { userId: 'u' }, { enforceBan }),
    ).rejects.toMatchObject({
      statusCode: 403,
      body: expect.objectContaining({ code: 'BANNED_USER', message: BANNED_USER_SESSION_REFUSAL.message }),
    });
    expect(enforceBan).toHaveBeenCalledOnce();

    enforceBan.mockClear();
    await refuseInactiveUserSession(rowEngine({ id: 'u', source: 'env_native', banned: false }), { userId: 'u' }, { enforceBan });
    expect(enforceBan).not.toHaveBeenCalled();
  });

  it('admits a banned row when the admin plugin decides instead', async () => {
    const engine = rowEngine({ id: 'u', source: 'env_native', banned: true });
    await expect(refuseInactiveUserSession(engine, { userId: 'u' }, { enforceBan: () => false })).resolves.toBeUndefined();
    expect(engine.updates).toEqual([]);
  });

  it('lifts a ban whose expiry has passed and admits the session', async () => {
    const engine = rowEngine({ id: 'u', banned: 1, ban_expires: new Date(Date.now() - 1000).toISOString() });
    await expect(refuseInactiveUserSession(engine, { userId: 'u' }, admitAll)).resolves.toBeUndefined();
    expect(engine.updates).toEqual([{ id: 'u', banned: false, ban_reason: null, ban_expires: null, updated_at: expect.any(Date) }]);
  });

  it('a ban whose expiry has not passed still refuses', async () => {
    const engine = rowEngine({ id: 'u', banned: true, ban_expires: new Date(Date.now() + 60_000).toISOString() });
    await expect(refuseInactiveUserSession(engine, { userId: 'u' }, admitAll)).rejects.toMatchObject({ statusCode: 403 });
    expect(engine.updates).toEqual([]);
  });

  it('a read that fails refuses the session 503, never admits it', async () => {
    await expect(
      refuseInactiveUserSession(rowEngine(undefined, { readFails: true }), { userId: 'u' }, admitAll),
    ).rejects.toMatchObject({
      statusCode: 503,
      body: expect.objectContaining({ code: 'SERVICE_UNAVAILABLE', message: USER_ROW_READ_FAULT_REFUSAL.message }),
    });
  });

  it('CONTROL: env_native, idp_provisioned, a missing row and a missing engine are admitted', async () => {
    for (const source of ['env_native', 'idp_provisioned', null]) {
      await expect(refuseInactiveUserSession(rowEngine({ id: 'u', source }), { userId: 'u' }, admitAll)).resolves.toBeUndefined();
    }
    await expect(refuseInactiveUserSession(rowEngine(undefined), { userId: 'u' }, admitAll)).resolves.toBeUndefined();
    await expect(refuseInactiveUserSession(undefined, { userId: 'u' }, admitAll)).resolves.toBeUndefined();
  });
});

describe('[#33181] the engine-backed ban writer', () => {
  it('lands the vendor-shaped ban write on the sys_user columns, as the system', async () => {
    const engine = rowEngine(undefined);
    const expires = new Date('2026-12-01T00:00:00.000Z');
    const updatedAt = new Date('2026-11-14T00:00:00.000Z');
    await engineUserBanWriter(engine).updateUser('u', { banned: true, banReason: 'r', banExpires: expires, updatedAt });
    expect(engine.update).toHaveBeenCalledWith(
      'sys_user',
      { id: 'u', banned: true, ban_reason: 'r', ban_expires: expires, updated_at: updatedAt },
      { context: expect.objectContaining({ isSystem: true }) },
    );
  });

  it('refuses a field that is not part of the ban write instead of guessing its column', async () => {
    const engine = rowEngine(undefined);
    await expect(engineUserBanWriter(engine).updateUser('u', { role: 'admin' })).rejects.toThrow(/not a ban field/);
    expect(engine.update).not.toHaveBeenCalled();
  });
});

describe('[#33181] the ban doors choose their writer and tell the host', () => {
  const ADMIN = { id: 'usr_admin', email: 'admin@example.com' };
  const post = (body: unknown) =>
    new Request('http://local/api/v1/auth/admin/ban-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const context = () => {
    const vendorWrites: Array<Record<string, unknown>> = [];
    const ctx: AuthBanContextLike = {
      internalAdapter: {
        findUserById: async (id) => ({ id, email: 'target@example.com', name: 'Target' }),
        updateUser: async (_id, data) => void vendorWrites.push(data),
        deleteUserSessions: async () => true,
      },
      adapter: { findOne: async () => null, findMany: async () => [] },
    };
    return { ctx, vendorWrites };
  };

  it('with a writer handed in, the ban and the unban land through it and not through the vendor adapter', async () => {
    const { ctx, vendorWrites } = context();
    const writes: Array<Record<string, unknown>> = [];
    const deps = {
      getAuthContext: async () => ctx,
      getBanWriter: async () => ({ updateUser: async (_id: string, data: Record<string, unknown>) => void writes.push(data) }),
    };
    expect((await runAdminBanUser(deps, ADMIN, post({ userId: 'usr_t' }))).status).toBe(200);
    expect((await runAdminUnbanUser(deps, ADMIN, post({ userId: 'usr_t' }))).status).toBe(200);
    expect(writes.map((w) => w.banned)).toEqual([true, false]);
    expect(vendorWrites).toEqual([]);
  });

  it('CONTROL: a writer answering undefined (the admin plugin mounted) leaves the vendor adapter writing, and no host keeps the answer as it was', async () => {
    const { ctx, vendorWrites } = context();
    const res = await runAdminBanUser({ getAuthContext: async () => ctx, getBanWriter: async () => undefined }, ADMIN, post({ userId: 'usr_t' }));
    expect(res.status).toBe(200);
    expect(vendorWrites.map((w) => w.banned)).toEqual([true]);
    expect(res.body.data).not.toHaveProperty('host');
  });

  it('with a host wired, a ban tells it deactivated and an unban reactivated, with the row\'s source', async () => {
    const { ctx } = context();
    const host = { userAdded: vi.fn(), userDeactivated: vi.fn(), userReactivated: vi.fn() };
    const deps = {
      getAuthContext: async () => ctx,
      host: () => host,
      getDataEngine: () => rowEngine({ id: 'usr_t', source: 'idp_provisioned' }),
    };
    const banned = await runAdminBanUser(deps, ADMIN, post({ userId: 'usr_t' }));
    const unbanned = await runAdminUnbanUser(deps, ADMIN, post({ userId: 'usr_t' }));
    expect(banned.body.data).toMatchObject({ host: { notified: true } });
    expect(unbanned.body.data).toMatchObject({ host: { notified: true } });
    expect(host.userDeactivated).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'usr_t', email: 'target@example.com', source: 'idp_provisioned', actorId: ADMIN.id }),
    );
    expect(host.userReactivated).toHaveBeenCalledOnce();
  });
});

describe('[#33181] the pending marker', () => {
  it('reads only its own value as pending', () => {
    expect(isPendingSsoSource('idp_pending')).toBe(true);
    for (const other of ['idp_provisioned', 'env_native', null, undefined, '']) expect(isPendingSsoSource(other)).toBe(false);
  });

  it('each password door answers 409 RESOURCE_CONFLICT with its own sentence', () => {
    for (const door of ['setUserPassword', 'setInitialPassword', 'resetPassword'] as const) {
      expect(pendingSsoPasswordRefusal(door)).toEqual({
        status: 409,
        body: { success: false, error: { code: 'RESOURCE_CONFLICT', message: PENDING_SSO_MESSAGES[door] } },
      });
    }
  });

  it('the package entry exports the doors, the marker and the host seam', async () => {
    const entry = await import('./index');
    expect(entry.PENDING_SSO_SOURCE).toBe('idp_pending');
    expect(typeof entry.runAddSsoUser).toBe('function');
    expect(typeof entry.runImportSsoUsers).toBe('function');
    expect(typeof entry.notifyEnvironmentUserHost).toBe('function');
  });
});
