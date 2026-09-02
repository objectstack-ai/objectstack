// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14318 — the `sendVerificationEmail` callback must hand a send failure back
 * to whoever called it.
 *
 * Why this is pinned rather than assumed. The reported symptom was a sign-up
 * that answered 200 while the verification mail was never sent, and the
 * obvious reading is "the auth layer swallows the failure". It does not: both
 * failure shapes `IEmailService` can produce — a THROW (template resolution,
 * or `normalizeMessage` refusing an unsendable `from`) and a returned
 * `status:'failed'` (transport error) — leave this callback as a rejection.
 *
 * What swallows it is one layer further out, and it is not ours:
 * better-auth's sign-up route invokes the callback through
 * `runInBackgroundOrAwait`, which awaits the promise inside a `try/catch` that
 * logs `Failed to run background task` and returns normally
 * (`better-auth/dist/context/create-context.mjs`). The `/send-verification-email`
 * route does NOT — it awaits `sendVerificationEmailFn` directly and rethrows —
 * so the resend path is honest today and must stay that way.
 *
 * Hence these assertions: they are the contract the cloud verify-email screen
 * reads through the resend endpoint, and the reason the *first* half of #14318
 * is a configuration-time refusal in plugin-email rather than another layer of
 * error plumbing here.
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

/** Boot an AuthManager whose `sendTemplate` behaves as `sendTemplate` says. */
async function boot(sendTemplate: (input: any) => Promise<any>) {
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
  } as never);
  manager.setEmailService({
    async send() { return { id: 'e', status: 'sent' }; },
    sendTemplate,
  } as never);
  await manager.getAuthInstance();
  warnSpy.mockRestore();
  return capturedConfig;
}

const drive = (config: any) => config.emailVerification.sendVerificationEmail({
  user: USER,
  url: 'http://x/verify',
  token: 't',
});

describe('sendVerificationEmail — failure reaches the caller', () => {
  it('rejects when the send THROWS (the unsendable-from shape)', async () => {
    // Exactly what `EmailService.send` does with
    // OS_EMAIL_FROM="ObjectOS Local <noreply@localhost>": `normalizeMessage`
    // refuses the sender and the throw travels out of `sendTemplate`.
    const config = await boot(async () => {
      throw new Error('Invalid email address: noreply@localhost');
    });
    await expect(drive(config)).rejects.toThrow(/Invalid email address: noreply@localhost/);
  });

  it('rejects when the send RETURNS status:failed, naming the recipient and the cause', async () => {
    const config = await boot(async () => ({ id: 'e1', status: 'failed', error: 'smtp 421' }));
    // Both facts matter to whoever reads the resend response: which address
    // was not reached, and why.
    await expect(drive(config)).rejects.toThrow(/ada@example\.com/);
    await expect(drive(config)).rejects.toThrow(/smtp 421/);
  });

  it('resolves on a successful send — the control', async () => {
    const sent: any[] = [];
    const config = await boot(async (input: any) => {
      sent.push(input);
      return { id: 'e1', status: 'sent' };
    });
    await expect(drive(config)).resolves.toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ template: 'auth.verify_email' });
  });
});
