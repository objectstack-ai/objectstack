// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8144] The `login` / `logout` emitters, at the composition seam.
 *
 * These cases drive `composeDatabaseHooks` — the real composition better-auth
 * is handed — rather than the mapping functions in isolation, because the whole
 * question this card can get wrong is whether the hooks are WIRED, and a
 * mapping function called directly proves nothing about that. (The end-to-end
 * claim — a real sign-in through better-auth producing a row readable through
 * the data API — is `packages/qa/dogfood/test/auth-session-audit-trail.dogfood.
 * test.ts`.)
 *
 * The negative cases carry as much weight as the positive ones: a session row
 * is deleted by revokes, bans, user erasure and better-auth's own collection of
 * expired rows, and recording any of those as `logout` would be a WRONG audit
 * record — it names an action the subject never took.
 */

import { describe, it, expect, vi } from 'vitest';
import { AuthManager } from './auth-manager';
import { loginEventFor, logoutEventFor, SIGN_OUT_PATH } from './auth-session-audit';

const SECRET = 'test-secret-at-least-32-chars-long';

/** A better-auth session row as the databaseHooks see it (camelCase). */
const SESSION = {
  id: 'ses_1',
  userId: 'usr_1',
  activeOrganizationId: 'org_1',
  ipAddress: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (probe)',
};

function hooksWithSink(config: Record<string, unknown> = {}) {
  const recordAuthEvent = vi.fn(async () => undefined);
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    getAuditSink: () => ({ recordAuthEvent }),
    ...config,
  } as any);
  const hooks = (manager as any).composeDatabaseHooks((config as any).databaseHooks) as any;
  return { hooks, recordAuthEvent };
}

describe('[#8144] session.create.after records a login', () => {
  it('emits the event with subject, tenant, session and client fingerprint', async () => {
    const { hooks, recordAuthEvent } = hooksWithSink();

    await hooks.session.create.after(SESSION, { path: '/sign-in/email' });

    expect(recordAuthEvent).toHaveBeenCalledTimes(1);
    expect(recordAuthEvent.mock.calls[0][0]).toEqual({
      action: 'login',
      userId: 'usr_1',
      sessionId: 'ses_1',
      organizationId: 'org_1',
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (probe)',
      context: { endpoint: '/sign-in/email' },
    });
  });

  it('fires for EVERY session-minting endpoint, not just /sign-in/email', async () => {
    // The reason the seam is the session hook and not the `/sign-in/email`
    // after-middleware where `stampLastLogin` lives: on a real deployment most
    // sign-ins are federated, and a writer wired to one endpoint would audit
    // the minority and silently miss the rest.
    const { hooks, recordAuthEvent } = hooksWithSink();

    for (const path of ['/sign-up/email', '/callback/google', '/sso/callback/acme', '/magic-link/verify']) {
      await hooks.session.create.after({ ...SESSION, id: `ses_${path}` }, { path });
    }

    expect(recordAuthEvent).toHaveBeenCalledTimes(4);
    expect(recordAuthEvent.mock.calls.map((c: any[]) => c[0].action)).toEqual([
      'login',
      'login',
      'login',
      'login',
    ]);
  });

  it('an impersonation session credits the admin as actor, subject stays on userId', async () => {
    const { hooks, recordAuthEvent } = hooksWithSink();

    await hooks.session.create.after(
      { ...SESSION, impersonatedBy: 'usr_admin' },
      { path: '/admin/impersonate-user' },
    );

    const event = recordAuthEvent.mock.calls[0][0];
    expect(event.userId).toBe('usr_1');
    expect(event.actor).toBe('usr_admin');
    expect(event.context).toEqual({
      endpoint: '/admin/impersonate-user',
      impersonated_by: 'usr_admin',
    });
  });

  it('a session with no subject writes nothing — an unattributed auth row is the defect', async () => {
    const { hooks, recordAuthEvent } = hooksWithSink();
    await hooks.session.create.after({ id: 'ses_x' }, { path: '/sign-in/email' });
    expect(recordAuthEvent).not.toHaveBeenCalled();
  });

  it('the HOST session.create.after still runs, and its result is preserved', async () => {
    const hostAfter = vi.fn(async () => 'host-result');
    const { hooks, recordAuthEvent } = hooksWithSink({
      databaseHooks: { session: { create: { after: hostAfter } } },
    });

    const result = await hooks.session.create.after(SESSION, { path: '/sign-in/email' });

    expect(hostAfter).toHaveBeenCalledTimes(1);
    expect(result).toBe('host-result');
    expect(recordAuthEvent).toHaveBeenCalledTimes(1);
  });

  it('is wired even when autoActiveOrganization is off (which removes create.before)', async () => {
    const { hooks, recordAuthEvent } = hooksWithSink({ autoActiveOrganization: false });
    // The pre-#8144 shape omitted the whole `session` block when there was no
    // `before` hook to install — the audit writer must not inherit that gate.
    expect(hooks.session?.create?.before).toBeUndefined();
    await hooks.session.create.after(SESSION, { path: '/sign-in/email' });
    expect(recordAuthEvent).toHaveBeenCalledTimes(1);
  });

  it('no audit plugin installed: the hook is a no-op, not an error', async () => {
    const manager = new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000' } as any);
    const hooks = (manager as any).composeDatabaseHooks(undefined) as any;
    await expect(
      hooks.session.create.after(SESSION, { path: '/sign-in/email' }),
    ).resolves.toBeUndefined();
  });

  it('a throwing sink cannot break the sign-in', async () => {
    const boom = vi.fn(async () => {
      throw new Error('ledger unreachable');
    });
    const manager = new AuthManager({
      secret: SECRET,
      baseUrl: 'http://localhost:3000',
      getAuditSink: () => ({ recordAuthEvent: boom }),
    } as any);
    const hooks = (manager as any).composeDatabaseHooks(undefined) as any;

    await expect(
      hooks.session.create.after(SESSION, { path: '/sign-in/email' }),
    ).resolves.toBeUndefined();
    expect(boom).toHaveBeenCalledTimes(1);
  });
});

describe('[#8144] session.delete.after records a logout — and ONLY for /sign-out', () => {
  it('emits logout under /sign-out', async () => {
    const { hooks, recordAuthEvent } = hooksWithSink();

    await hooks.session.delete.after(SESSION, { path: SIGN_OUT_PATH });

    expect(recordAuthEvent).toHaveBeenCalledTimes(1);
    expect(recordAuthEvent.mock.calls[0][0]).toEqual({
      action: 'logout',
      userId: 'usr_1',
      sessionId: 'ses_1',
      organizationId: 'org_1',
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (probe)',
      context: { endpoint: '/sign-out' },
    });
  });

  it.each([
    ['/revoke-session'],
    ['/revoke-sessions'],
    ['/revoke-other-sessions'],
    ['/admin/revoke-user-session'],
    ['/admin/revoke-user-sessions'],
    ['/admin/remove-user'],
    ['/delete-user'],
    ['/get-session'],
  ])('writes NOTHING when the delete came from %s', async (path) => {
    // Each of these deletes a session row without the subject signing out —
    // a revoke, an erasure, or better-auth's own collection of an expired row
    // inside `GET /get-session`. `logout` there would name an action the
    // subject never took, which is worse for an auditor than no row: the
    // revoke families already carry their cause on the ADR-0069 D4 tombstone.
    const { hooks, recordAuthEvent } = hooksWithSink();
    await hooks.session.delete.after(SESSION, { path });
    expect(recordAuthEvent).not.toHaveBeenCalled();
  });

  it('writes nothing when the endpoint context is unknown (null ctx)', async () => {
    // `delete.after` runs inside `queueAfterTransactionHook`, so the ambient
    // auth context may be gone; the captured argument is the only reliable
    // answer, and no answer means no row.
    const { hooks, recordAuthEvent } = hooksWithSink();
    await hooks.session.delete.after(SESSION, null);
    expect(recordAuthEvent).not.toHaveBeenCalled();
  });

  it('the HOST session.delete.after still runs (back-channel logout must not be lost)', async () => {
    const hostAfter = vi.fn(async () => 'host-result');
    const { hooks, recordAuthEvent } = hooksWithSink({
      databaseHooks: { session: { delete: { after: hostAfter } } },
    });

    const result = await hooks.session.delete.after(SESSION, { path: SIGN_OUT_PATH });

    expect(hostAfter).toHaveBeenCalledTimes(1);
    expect(result).toBe('host-result');
    expect(recordAuthEvent).toHaveBeenCalledTimes(1);
  });

  it('a host session.delete.before survives composition untouched', async () => {
    // @better-auth/oauth-provider registers `session.delete.before`/`after` to
    // prepare and dispatch OIDC back-channel logout. Dropping either would
    // trade an audit row for a security hole (`session-tombstone.ts`).
    const before = vi.fn(async () => undefined);
    const { hooks } = hooksWithSink({
      databaseHooks: { session: { delete: { before } } },
    });
    expect(hooks.session.delete.before).toBe(before);
  });
});

describe('[#8144] the mapping refuses to invent an actor', () => {
  it('loginEventFor: no subject → null', () => {
    expect(loginEventFor({ id: 'ses_1' })).toBeNull();
    expect(loginEventFor(null)).toBeNull();
    expect(loginEventFor({ userId: '' })).toBeNull();
  });

  it('logoutEventFor: right path, no subject → null', () => {
    expect(logoutEventFor({ id: 'ses_1' }, SIGN_OUT_PATH)).toBeNull();
  });

  it('logoutEventFor: right subject, wrong path → null', () => {
    expect(logoutEventFor(SESSION, '/revoke-session')).toBeNull();
    expect(logoutEventFor(SESSION, undefined)).toBeNull();
  });

  it('omits absent optional fields rather than writing empty strings', () => {
    // ADR-0118 D1: absence records as absence. An `ipAddress: ''` would read as
    // a client fingerprint that was captured and was blank.
    const event = loginEventFor({ userId: 'usr_1', ipAddress: '', userAgent: null as any });
    expect(event).toEqual({ action: 'login', userId: 'usr_1' });
  });
});
