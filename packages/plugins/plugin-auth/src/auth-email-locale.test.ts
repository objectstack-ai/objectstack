// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8195 — every auth email names the deployment-default locale.
 *
 * Maintainer ruling 2026-08-13: the recipient locale is the **deployment
 * default**, read from `II18nService.getDefaultLocale()` and resolved at the
 * plugin layer; `Accept-Language` is rejected; no `sys_user.locale` column.
 *
 * Before this, no `sendTemplate` call in `auth-manager.ts` passed a `locale`,
 * so `EmailService`'s ladder always resolved `en-US` and the localized rows
 * were unreachable through the platform's own send path — a zh-CN deployment
 * received English credential mail while its UI spoke Chinese.
 *
 * This file owns the SENDING half: that all five sites name the locale, that
 * an unconfigured deployment still names nothing, and that the catalog spelling
 * (`en`) is mapped onto the row spelling (`en-US`). The template half — that a
 * row actually exists in each locale and reads naturally — is
 * `plugin-email/src/auth-templates-locales.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthManager, normalizeAuthEmailLocale } from './auth-manager';

vi.mock('better-auth', () => ({
  betterAuth: vi.fn(() => ({ handler: vi.fn(), api: {} })),
}));

vi.mock('better-auth/plugins/organization', () => ({
  organization: vi.fn((opts: any) => ({ id: 'organization', _opts: opts })),
}));

// Unlike the shared mock in `auth-manager.test.ts`, this one EXPOSES the
// options — `sendMagicLink` is one of the five call sites and has to be
// invocable rather than merely present.
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

// ── harness ────────────────────────────────────────────────────────────────

/**
 * Boot an AuthManager with the better-auth config captured, so each of the
 * send callbacks can be invoked directly. Same shape as the placeholder-email
 * suite in `auth-manager.test.ts`.
 */
async function boot(locale: string | undefined, extra: Record<string, unknown> = {}) {
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
    plugins: { magicLink: true },
    ...extra,
  } as never);
  const sent: any[] = [];
  manager.setEmailService({
    async send() {
      return { id: 'e', status: 'sent' };
    },
    async sendTemplate(input: any) {
      sent.push(input);
      return { id: `e${sent.length}`, status: 'sent' };
    },
  } as never);
  manager.setDefaultEmailLocale(locale);
  await manager.getAuthInstance();
  warnSpy.mockRestore();
  return { manager, capturedConfig, sent };
}

const USER = { id: 'u1', email: 'ada@example.com', name: 'Ada' };

/**
 * Drive all five auth sends and return the recorded `sendTemplate` inputs.
 *
 * The change-email notice fires from the global after-hook rather than a named
 * callback — that placement is itself the #8019 "does not gate" guarantee — so
 * it is driven through that hook with a synthetic success context.
 */
async function driveAllFive(locale: string | undefined) {
  const { capturedConfig, sent } = await boot(locale);

  await capturedConfig.emailAndPassword.sendResetPassword({
    user: USER,
    url: 'http://x/reset',
    token: 't',
  });

  await capturedConfig.emailVerification.sendVerificationEmail({
    user: USER,
    url: 'http://x/verify',
    token: 't',
  });

  const org = capturedConfig.plugins.find((p: any) => p.id === 'organization');
  await org._opts.sendInvitationEmail({
    email: 'invitee@example.com',
    invitation: { id: 'inv1', organizationId: 'o1', role: 'member' },
    organization: { name: 'Northwind' },
    inviter: { user: { email: 'dana@example.com', name: 'Dana' } },
  });

  const magic = capturedConfig.plugins.find((p: any) => p.id === 'magic-link');
  await magic._opts.sendMagicLink({
    email: 'ada@example.com',
    url: 'http://x/magic',
    token: 't',
  });

  await capturedConfig.hooks.after({
    path: '/change-email',
    body: { newEmail: 'new@example.com' },
    context: {
      __osChangeEmailFrom: { email: 'ada@example.com', name: 'Ada', id: 'u1' },
      returned: { status: true },
    },
  });

  return sent;
}

const TEMPLATES = [
  'auth.password_reset',
  'auth.verify_email',
  'auth.invitation',
  'auth.magic_link',
  'auth.email_change_notice',
] as const;

describe('#8195 — all five auth sends name the deployment locale', () => {
  const prevMcpEnv = process.env.OS_MCP_SERVER_ENABLED;
  beforeEach(() => {
    vi.clearAllMocks();
    // Keep the plugin list to what this file drives; the MCP surface is
    // default-ON and would append jwt + oauth-provider everywhere.
    process.env.OS_MCP_SERVER_ENABLED = 'false';
  });
  afterEach(() => {
    if (prevMcpEnv === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
    else process.env.OS_MCP_SERVER_ENABLED = prevMcpEnv;
  });

  it('a zh-CN deployment stamps zh-CN on every one of the five sends', async () => {
    const sent = await driveAllFive('zh-CN');
    // All five reached the transport — a send that never happened would make
    // the locale assertion below vacuously true.
    expect(sent.map((s) => s.template)).toEqual([...TEMPLATES]);
    for (const input of sent) {
      expect(input.locale, `${input.template} did not name a locale`).toBe('zh-CN');
    }
  });

  it.each(['ja-JP', 'es-ES'])('and the same for a %s deployment', async (locale) => {
    const sent = await driveAllFive(locale);
    expect(sent).toHaveLength(5);
    for (const input of sent) expect(input.locale).toBe(locale);
  });

  it('an unconfigured deployment names NO locale — the pre-#8195 behaviour', async () => {
    // Not `locale: undefined`: the ladder's contract is written against an
    // ABSENT key ("no locale means the DOCUMENTED default"), so the key must
    // not be present at all.
    const sent = await driveAllFive(undefined);
    expect(sent).toHaveLength(5);
    for (const input of sent) {
      expect(input.locale).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(input, 'locale')).toBe(false);
    }
  });

  it('naming a locale does not disturb the rest of the send payload', async () => {
    // Guards against the spread landing in the wrong place and shadowing a key.
    const sent = await driveAllFive('zh-CN');
    const reset = sent.find((s) => s.template === 'auth.password_reset')!;
    expect(reset.data.resetUrl).toBe('http://x/reset');
    expect(reset.data.user.email).toBe('ada@example.com');
    expect(reset.relatedObject).toBe('sys_user');
    expect(reset.relatedId).toBe('u1');
    const invite = sent.find((s) => s.template === 'auth.invitation')!;
    expect(invite.data.organization.name).toBe('Northwind');
    expect(invite.data.acceptUrl).toContain('/accept-invitation/inv1');
  });
});

// ── the catalog-vs-row spelling gap ────────────────────────────────────────

describe('#8195 — normalizeAuthEmailLocale', () => {
  it('promotes the bare catalog language to the row it ships', () => {
    // The load-bearing case: `FileI18nAdapter` defaults to the BARE `en`
    // (`options.defaultLocale ?? 'en'`) while `sys_email_template` rows are
    // keyed `en-US`, and `SendTemplateInput.locale` is documented as matched
    // exactly, with "no language-only prefix matching". Passed through raw,
    // the commonest deployment of all would miss every row.
    expect(normalizeAuthEmailLocale('en')).toBe('en-US');
    expect(normalizeAuthEmailLocale('zh')).toBe('zh-CN');
    expect(normalizeAuthEmailLocale('ja')).toBe('ja-JP');
    expect(normalizeAuthEmailLocale('es')).toBe('es-ES');
  });

  it('returns a shipped tag canonically, whatever its case', () => {
    expect(normalizeAuthEmailLocale('en-US')).toBe('en-US');
    expect(normalizeAuthEmailLocale('zh-cn')).toBe('zh-CN');
    expect(normalizeAuthEmailLocale('JA-JP')).toBe('ja-JP');
    expect(normalizeAuthEmailLocale('  es-ES  ')).toBe('es-ES');
  });

  it('passes an unshipped REGIONAL tag through untouched', () => {
    // `en-GB` and `fr-FR` may well be a tenant's own overlay rows. Swallowing
    // them here would re-create, for the fifth locale onward, exactly the bug
    // this card closes — a locale row the platform cannot ask for.
    expect(normalizeAuthEmailLocale('en-GB')).toBe('en-GB');
    expect(normalizeAuthEmailLocale('fr-FR')).toBe('fr-FR');
    expect(normalizeAuthEmailLocale('pt-BR')).toBe('pt-BR');
  });

  it('passes an unshipped bare language through rather than inventing a region', () => {
    expect(normalizeAuthEmailLocale('fr')).toBe('fr');
    expect(normalizeAuthEmailLocale('de')).toBe('de');
  });

  it('treats blank and absent as "name nothing"', () => {
    expect(normalizeAuthEmailLocale(undefined)).toBeUndefined();
    expect(normalizeAuthEmailLocale('')).toBeUndefined();
    expect(normalizeAuthEmailLocale('   ')).toBeUndefined();
  });

  it('is what setDefaultEmailLocale applies, not merely an exported helper', async () => {
    // A normalizer nothing calls is the dormant-surface shape this whole card
    // is about.
    const sent = await driveAllFive('en');
    expect(sent).toHaveLength(5);
    for (const input of sent) expect(input.locale).toBe('en-US');
  });
});
