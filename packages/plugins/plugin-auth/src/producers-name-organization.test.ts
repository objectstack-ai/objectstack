// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D9] The writes AuthManager makes on tenant-column objects for a
 * USER — the self-registration grant (`sys_user_permission_set`) and the auth
 * mails about that user (`sys_email`, through `IEmailService.sendTemplate`) —
 * name the one organization they can derive: the Default Organization under
 * `single`, which `tenancy.defaultOrgId()` answers, and none under a wall,
 * where it answers `null` (the registrant belongs to no organization yet).
 *
 * Under `single` this is the owner the engine derives for an org-less system
 * insert, so the stamp moves no reader; under a wall the row stays org-less
 * and its fate is the engine's. Both halves are pinned per writer.
 */

import { describe, it, expect, vi } from 'vitest';
import { AuthManager } from './auth-manager';

vi.mock('better-auth', () => ({
  betterAuth: vi.fn(() => ({ handler: vi.fn(), api: {} })),
}));
vi.mock('better-auth/plugins/organization', () => ({
  organization: vi.fn((opts: any) => ({ id: 'organization', _opts: opts })),
}));
vi.mock('better-auth/plugins/magic-link', () => ({
  magicLink: vi.fn((opts: any) => ({ id: 'magic-link', _opts: opts })),
}));
vi.mock('better-auth/plugins/two-factor', () => ({
  twoFactor: vi.fn((opts: any) => ({ id: 'two-factor', _opts: opts })),
}));
vi.mock('better-auth/plugins/custom-session', () => ({
  customSession: vi.fn((fn: any) => ({ id: 'custom-session', _fn: fn })),
}));
vi.mock('better-auth/plugins/haveibeenpwned', () => ({
  haveIBeenPwned: vi.fn((opts: any) => ({ id: 'have-i-been-pwned', _opts: opts })),
}));

const USER = { id: 'u1', email: 'ada@example.com', name: 'Ada' };
const DEFAULT_ORG = 'org_default';

type Tenancy = { defaultOrgId(): Promise<string | null> } | undefined;

/** `single`: the Default Organization. A wall: `null`. */
const SINGLE: Tenancy = { defaultOrgId: async () => DEFAULT_ORG };
const WALLED: Tenancy = { defaultOrgId: async () => null };

/** Boot an AuthManager with a recording email service; returns the better-auth config and the sends. */
async function bootMail(tenancy: Tenancy) {
  const { betterAuth } = await import('better-auth');
  let capturedConfig: any;
  (betterAuth as any).mockImplementation((config: any) => {
    capturedConfig = config;
    return { handler: vi.fn(), api: {} };
  });
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const manager = new AuthManager({
    secret: 'test-secret-at-least-32-chars-long',
    baseUrl: 'http://localhost:3000',
    emailAndPassword: { enabled: true },
    emailVerification: { sendOnSignUp: true },
    ...(tenancy ? { getTenancy: () => tenancy } : {}),
  } as never);
  const sent: any[] = [];
  manager.setEmailService({
    async send() { return { id: 'e', status: 'sent' }; },
    async sendTemplate(input: any) { sent.push(input); return { id: 'e1', status: 'sent' }; },
  } as never);
  await manager.getAuthInstance();
  warnSpy.mockRestore();
  return { config: capturedConfig, sent };
}

async function sendVerification(tenancy: Tenancy) {
  const { config, sent } = await bootMail(tenancy);
  await config.emailVerification.sendVerificationEmail({ user: USER, url: 'http://x/verify', token: 't' });
  return sent;
}

async function sendReset(tenancy: Tenancy) {
  const { config, sent } = await bootMail(tenancy);
  await config.emailAndPassword.sendResetPassword(
    { user: USER, url: 'http://x/reset', token: 't' },
    new Request('http://x/api/v1/auth/request-password-reset'),
  );
  return sent;
}

describe('[ADR-0131 D9] the auth mails about a user name the derivable organization', () => {
  it('the verification mail carries the Default Organization under single', async () => {
    const sent = await sendVerification(SINGLE);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ template: 'auth.verify_email', relatedObject: 'sys_user', organizationId: DEFAULT_ORG });
  });

  it('the verification mail names no organization under a wall, nor with no tenancy service', async () => {
    for (const tenancy of [WALLED, undefined]) {
      const sent = await sendVerification(tenancy);
      expect(sent).toHaveLength(1);
      expect(sent[0].template).toBe('auth.verify_email');
      expect('organizationId' in sent[0]).toBe(false);
    }
  });

  it('the password-reset mail carries the Default Organization under single and none under a wall', async () => {
    const single = await sendReset(SINGLE);
    expect(single[0]).toMatchObject({ template: 'auth.password_reset', organizationId: DEFAULT_ORG });
    const walled = await sendReset(WALLED);
    expect(walled[0].template).toBe('auth.password_reset');
    expect('organizationId' in walled[0]).toBe(false);
  });
});

/** An engine double recording the grant insert; `find` answers no existing grant. */
function grantEngine() {
  const inserts: Array<[string, Record<string, unknown>]> = [];
  return {
    inserts,
    async find() { return []; },
    async findOne() { return null; },
    async count() { return 0; },
    async insert(object: string, data: Record<string, unknown>) {
      inserts.push([object, { ...data }]);
      return { ...data };
    },
  };
}

async function settleGrant(tenancy: Tenancy) {
  const engine = grantEngine();
  const errors: string[] = [];
  const manager = new AuthManager({
    secret: 'test-secret-at-least-32-chars-long',
    baseUrl: 'http://localhost:3000',
    dataEngine: engine as never,
    getTenancy: () => tenancy,
    logger: { error: (m: string) => errors.push(String(m)), warn: () => {}, info: () => {} },
  } as never);
  (manager as never as { stageSelfRegistrationGrant: Function }).stageSelfRegistrationGrant(USER.email, 'portal_user');
  await (manager as never as { settleSelfRegistrationGrant: Function }).settleSelfRegistrationGrant(USER);
  return { inserts: engine.inserts, errors };
}

describe('[ADR-0131 D9] the self-registration grant names the derivable organization', () => {
  it('is owned by the Default Organization under single', async () => {
    const { inserts, errors } = await settleGrant(SINGLE);
    expect(errors).toEqual([]);
    expect(inserts).toHaveLength(1);
    expect(inserts[0][0]).toBe('sys_user_permission_set');
    expect(inserts[0][1]).toMatchObject({ user_id: USER.id, permission_set: 'portal_user', organization_id: DEFAULT_ORG });
  });

  it('names none under a wall, where the registrant belongs to no organization yet', async () => {
    const { inserts, errors } = await settleGrant(WALLED);
    expect(errors).toEqual([]);
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]).toMatchObject({ user_id: USER.id, permission_set: 'portal_user' });
    expect('organization_id' in inserts[0][1]).toBe(false);
  });
});
