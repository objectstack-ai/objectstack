// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D7, ruling of record 6257510973, letter Q2 A] The auth mails
 * AuthManager sends about a PERSON — verification, password reset, magic link,
 * the email-change notice — are identity mail: each send says
 * `identityMail: true` and names no organization, in every posture, so the
 * mail service records it in `sys_identity_email`, the deployment-level
 * sibling of `sys_email` with no organization column.
 *
 * The organization invitation is not identity mail: it holds its
 * organization, which it threads, and its row stays tenant mail in
 * `sys_email` (#11303 decision 2).
 *
 * Before this stage the identity sends carried the Default Organization under
 * `single` (ADR-0131 D9's derivation) and nothing under a wall — an
 * organization-less `sys_email` row. Neither shape is written any more.
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

const IDENTITY_TEMPLATES = ['auth.password_reset', 'auth.verify_email', 'auth.magic_link', 'auth.email_change_notice'];

/** Boot an AuthManager with a recording email service, drive the five auth sends, return what was sent. */
async function driveAuthMail(tenancy: Tenancy) {
  const { betterAuth } = await import('better-auth');
  let config: any;
  (betterAuth as any).mockImplementation((captured: any) => {
    config = captured;
    return { handler: vi.fn(), api: {} };
  });
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const manager = new AuthManager({
    secret: 'test-secret-at-least-32-chars-long',
    baseUrl: 'http://localhost:3000',
    emailAndPassword: { enabled: true },
    emailVerification: { sendOnSignUp: true },
    plugins: { magicLink: true },
    ...(tenancy ? { getTenancy: () => tenancy } : {}),
  } as never);
  const sent: any[] = [];
  manager.setEmailService({
    async send() { return { id: 'e', status: 'sent' }; },
    async sendTemplate(input: any) { sent.push(input); return { id: `e${sent.length}`, status: 'sent' }; },
  } as never);
  await manager.getAuthInstance();
  warnSpy.mockRestore();

  await config.emailAndPassword.sendResetPassword(
    { user: USER, url: 'http://x/reset', token: 't' },
    new Request('http://x/api/v1/auth/request-password-reset'),
  );
  await config.emailVerification.sendVerificationEmail({ user: USER, url: 'http://x/verify', token: 't' });
  await config.plugins.find((p: any) => p.id === 'magic-link')._opts.sendMagicLink({
    email: USER.email, url: 'http://x/magic', token: 't',
  });
  await config.hooks.after({
    path: '/change-email',
    body: { newEmail: 'new@example.com' },
    context: { __osChangeEmailFrom: { email: USER.email, name: USER.name, id: USER.id }, returned: { status: true } },
  });
  await config.plugins.find((p: any) => p.id === 'organization')._opts.sendInvitationEmail({
    email: 'invitee@example.com',
    invitation: { id: 'inv1', organizationId: 'org_northwind', role: 'member' },
    organization: { name: 'Northwind' },
    inviter: { user: { email: 'dana@example.com', name: 'Dana' } },
  });
  return sent;
}

describe('[ADR-0131 D7, Q2 A] mail about a person is identity mail, in every posture', () => {
  for (const [posture, tenancy] of [['single', SINGLE], ['walled', WALLED], ['no tenancy service', undefined]] as const) {
    it(`${posture}: the four identity sends say identityMail and name no organization`, async () => {
      const sent = await driveAuthMail(tenancy);
      const identity = sent.filter((s) => IDENTITY_TEMPLATES.includes(s.template));
      expect(identity.map((s) => s.template).sort()).toEqual([...IDENTITY_TEMPLATES].sort());
      for (const s of identity) {
        expect(s.identityMail, s.template).toBe(true);
        expect('organizationId' in s, s.template).toBe(false);
      }
    });

    it(`${posture}: the organization invitation stays tenant mail, stamped with its organization`, async () => {
      const sent = await driveAuthMail(tenancy);
      const invitation = sent.find((s) => s.template === 'auth.invitation');
      expect(invitation).toMatchObject({ relatedObject: 'sys_invitation', organizationId: 'org_northwind' });
      expect('identityMail' in invitation).toBe(false);
    });
  }
});
