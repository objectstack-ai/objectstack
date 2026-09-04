// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8195 — every auth email names the deployment-default locale.
 *
 * Maintainer ruling 2026-09-02 (#14319), which SUPERSEDED the 2026-08-13 one
 * this file was written against: a request-triggered auth email takes the
 * caller's own `Accept-Language` first (only when it names a locale in
 * `AUTH_EMAIL_TEMPLATE_LOCALES`), and the deployment default second. The
 * 2026-08-13 ruling had made the deployment default the whole answer and
 * rejected `Accept-Language` outright. #14762 then added the rung ABOVE both,
 * per the #14788 option-D ruling of 2026-09-03: the recipient's own
 * `sys_user.locale` (#13881) when the account holds one. Invitations keep the
 * deployment rung — an invitee has no row until acceptance (#14641) — and
 * this file pins that abstention too. The ruling text of record lives on
 * `AuthManager.setDefaultEmailLocale` / `authEmailLocaleFromRequest` /
 * `emailLocaleArg`; the request rung's own cases and the stored rung's are the
 * last two describe blocks in this file.
 *
 * Before this, no `sendTemplate` call in `auth-manager.ts` passed a `locale`,
 * so `EmailService`'s ladder always resolved `en-US` and the localized rows
 * were unreachable through the platform's own send path — a zh-CN deployment
 * received English credential mail while its UI spoke Chinese.
 *
 * This file owns the SENDING half: that all five sites name a locale, that
 * an unconfigured deployment still names nothing, and that the catalog spelling
 * (`en`) is mapped onto the row spelling (`en-US`). The template half — that a
 * row actually exists in each locale and reads naturally — is
 * `plugin-email/src/auth-templates-locales.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthManager, normalizeAuthEmailLocale, authEmailLocaleFromRequest } from './auth-manager';

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

// ── #14319 — the request rung ──────────────────────────────────────────────

/**
 * Maintainer ruling 2026-09-02, quoted verbatim and untranslated:
 *
 * > 注册 / 登录 / 重置密码等由请求触发的 auth 邮件，语言优先取请求的
 * > `Accept-Language`（命中 `AUTH_EMAIL_TEMPLATE_LOCALES` 才生效），其次才是
 * > 部署默认（`localization.locale` → `i18n.defaultLocale`）。
 *
 * Asserted at the LOCALE named on the send, which is this layer's whole output.
 * That a `zh-CN` row then renders a Chinese subject and no en-US text is
 * `plugin-email/src/auth-templates-locales.test.ts`, which owns the row half;
 * the two together are the card's acceptance criterion.
 *
 * The four sends driven here are the ones where the requester IS the recipient.
 * The invitation is asserted to ABSTAIN in its own case below — better-auth
 * hands it a request too, but it is the inviter's.
 */
async function driveWithHeader(
  deploymentLocale: string | undefined,
  header: string | undefined,
) {
  const { capturedConfig, sent } = await boot(deploymentLocale);
  const request =
    header === undefined
      ? undefined
      : new Request('http://x/any', { headers: { 'accept-language': header } });

  // Measured better-auth 1.7.x shapes, NOT assumed: reset / verify / invitation
  // receive `ctx.request`, magic-link receives the endpoint `ctx`, and the
  // change-email notice fires from the global after-hook's `ctx`.
  await capturedConfig.emailAndPassword.sendResetPassword(
    { user: USER, url: 'http://x/reset', token: 't' },
    request,
  );
  await capturedConfig.emailVerification.sendVerificationEmail(
    { user: USER, url: 'http://x/verify', token: 't' },
    request,
  );

  const org = capturedConfig.plugins.find((p: any) => p.id === 'organization');
  await org._opts.sendInvitationEmail(
    {
      email: 'invitee@example.com',
      invitation: { id: 'inv1', organizationId: 'o1', role: 'member' },
      organization: { name: 'Northwind' },
      inviter: { user: { email: 'dana@example.com', name: 'Dana' } },
    },
    request,
  );

  const magic = capturedConfig.plugins.find((p: any) => p.id === 'magic-link');
  await magic._opts.sendMagicLink(
    { email: 'ada@example.com', url: 'http://x/magic', token: 't' },
    request ? { request } : undefined,
  );

  await capturedConfig.hooks.after({
    path: '/change-email',
    body: { newEmail: 'new@example.com' },
    request,
    context: {
      __osChangeEmailFrom: { email: 'ada@example.com', name: 'Ada', id: 'u1' },
      returned: { status: true },
    },
  });

  const byTemplate = (name: string) => sent.find((x: any) => x.template === name);
  return {
    sent,
    /** The four sends whose recipient is the requester. */
    requesterIsRecipient: [
      'auth.password_reset',
      'auth.verify_email',
      'auth.magic_link',
      'auth.email_change_notice',
    ].map((t) => byTemplate(t)!),
    invitation: byTemplate('auth.invitation')!,
  };
}

describe('#14319 — Accept-Language outranks the deployment default', () => {
  const prevMcpEnv = process.env.OS_MCP_SERVER_ENABLED;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OS_MCP_SERVER_ENABLED = 'false';
  });
  afterEach(() => {
    if (prevMcpEnv === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
    else process.env.OS_MCP_SERVER_ENABLED = prevMcpEnv;
  });

  it('a zh-CN caller gets zh-CN even though the deployment speaks English', async () => {
    // The card's repro: Chinese browser, English deployment default. Before
    // this ruling every one of these read `en-US`.
    const { sent, requesterIsRecipient } = await driveWithHeader('en', 'zh-CN,zh;q=0.9,en;q=0.8');
    // A send that never happened would make the locale assertion vacuous.
    expect(sent).toHaveLength(5);
    for (const input of requesterIsRecipient) {
      expect(input.locale, `${input.template} did not follow the request`).toBe('zh-CN');
    }
  });

  it.each(['ja-JP', 'es-ES', 'en-US'])('and the same for a %s caller', async (tag) => {
    const { requesterIsRecipient } = await driveWithHeader('zh-CN', tag);
    for (const input of requesterIsRecipient) expect(input.locale).toBe(tag);
  });

  it('a caller who asked for nothing falls back to the deployment default', async () => {
    const { sent, requesterIsRecipient } = await driveWithHeader('zh-CN', undefined);
    expect(sent).toHaveLength(5);
    for (const input of requesterIsRecipient) expect(input.locale).toBe('zh-CN');
  });

  it.each(['fr-FR', 'de', 'pt-BR', '*'])(
    'a caller asking for %s — a locale we ship no auth row for — falls back to the deployment default',
    async (tag) => {
      // The ruling's "命中 AUTH_EMAIL_TEMPLATE_LOCALES 才生效" half. Honouring
      // an unshipped tag would name a row that does not exist, which is the
      // row-locale vs filter-locale split all over again.
      const { requesterIsRecipient } = await driveWithHeader('zh-CN', tag);
      for (const input of requesterIsRecipient) expect(input.locale).toBe('zh-CN');
    },
  );

  it('with NO deployment default and an unshipped request, nothing is named at all', async () => {
    // Both rungs silent ⇒ absent key, which is what EmailService's ladder
    // contract ("no locale means the DOCUMENTED default") is written against.
    const { requesterIsRecipient } = await driveWithHeader(undefined, 'fr-FR');
    for (const input of requesterIsRecipient) {
      expect(input.locale).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(input, 'locale')).toBe(false);
    }
  });

  it('the INVITATION abstains — the request belongs to the inviter, not the invitee', async () => {
    const { invitation } = await driveWithHeader('zh-CN', 'en-US');
    // An English-speaking admin must not force English on their Chinese
    // workspace's invitees; this send keeps the deployment rung.
    expect(invitation.locale).toBe('zh-CN');
  });

  it('naming a request locale does not disturb the rest of the payload', async () => {
    const { requesterIsRecipient } = await driveWithHeader('en', 'zh-CN');
    const reset = requesterIsRecipient.find((x: any) => x.template === 'auth.password_reset')!;
    expect(reset.data.resetUrl).toBe('http://x/reset');
    expect(reset.relatedObject).toBe('sys_user');
    expect(reset.relatedId).toBe('u1');
  });
});

describe('#14319 — authEmailLocaleFromRequest', () => {
  it('reads a Web Request and strips the quality weights', () => {
    const req = new Request('http://x/', { headers: { 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' } });
    expect(authEmailLocaleFromRequest(req)).toBe('zh-CN');
  });

  it('reads a better-auth endpoint ctx too — the shape sendMagicLink is handed', () => {
    // Measured, not assumed: magic-link/index.mjs calls `sendMagicLink({...}, ctx)`.
    const req = new Request('http://x/', { headers: { 'accept-language': 'ja-JP' } });
    expect(authEmailLocaleFromRequest({ request: req })).toBe('ja-JP');
  });

  it('reads a plain header bag, either spelling', () => {
    expect(authEmailLocaleFromRequest({ headers: { 'accept-language': 'es-ES' } })).toBe('es-ES');
    expect(authEmailLocaleFromRequest({ headers: { 'Accept-Language': 'es-ES' } })).toBe('es-ES');
  });

  it('promotes a bare language to the row we ship for it', () => {
    expect(authEmailLocaleFromRequest({ headers: { 'accept-language': 'zh' } })).toBe('zh-CN');
    expect(authEmailLocaleFromRequest({ headers: { 'accept-language': 'en' } })).toBe('en-US');
  });

  it('refuses a locale we ship no auth row for, rather than naming a missing row', () => {
    for (const tag of ['fr-FR', 'de', 'pt-BR', 'en-GB']) {
      expect(authEmailLocaleFromRequest({ headers: { 'accept-language': tag } })).toBeUndefined();
    }
  });

  it('treats an absent, empty or wildcard header as no preference', () => {
    expect(authEmailLocaleFromRequest(undefined)).toBeUndefined();
    expect(authEmailLocaleFromRequest(null)).toBeUndefined();
    expect(authEmailLocaleFromRequest({})).toBeUndefined();
    expect(authEmailLocaleFromRequest({ headers: {} })).toBeUndefined();
    expect(authEmailLocaleFromRequest({ headers: { 'accept-language': '' } })).toBeUndefined();
    expect(authEmailLocaleFromRequest({ headers: { 'accept-language': '*' } })).toBeUndefined();
  });

  it('never throws when the header bag itself is hostile', () => {
    // A vendor changing the shape it hands a callback must degrade to the
    // deployment default, never fail the send.
    const hostile = { headers: { get() { throw new Error('boom'); } } };
    expect(() => authEmailLocaleFromRequest(hostile)).not.toThrow();
    expect(authEmailLocaleFromRequest(hostile)).toBeUndefined();
  });
});

// ── #14762 — the stored rung ───────────────────────────────────────────────

/**
 * #14788 was ruled option D on 2026-09-03 (maintainer verbatim 「同意」):
 *
 *   `sys_user.locale` when set → the request's `Accept-Language` → the
 *   deployment default.
 *
 * The recorded reasoning: a value the user chose is stronger evidence of
 * intent than the `Accept-Language` the browser just sent. The case that
 * forces the order is the send where the requester is NOT the recipient — an
 * admin-initiated password reset (`admin-import-users.ts` calls
 * `requestPasswordReset`), where the request rung would otherwise stamp the
 * ADMIN's browser language onto the USER's mail.
 *
 * ⚠️ Every rung below is given a DIFFERENT locale, so each assertion names
 * exactly one rung. A pin that set two rungs to the same tag would pass
 * whichever produced the value.
 */
async function driveResetWith(opts: {
  stored?: unknown;
  header?: string;
  deployment?: string;
  engine?: unknown;
}) {
  const reads: any[] = [];
  const dataEngine =
    opts.engine ??
    {
      async findOne(object: string, query: any) {
        reads.push({ object, query });
        return object === 'sys_user' ? { locale: opts.stored } : null;
      },
    };
  const { capturedConfig, sent } = await boot(opts.deployment, { dataEngine } as never);
  const request =
    opts.header === undefined
      ? undefined
      : new Request('http://x/any', { headers: { 'accept-language': opts.header } });
  await capturedConfig.emailAndPassword.sendResetPassword(
    { user: USER, url: 'http://x/reset', token: 't' },
    request,
  );
  return { sent, reads };
}

describe('#14762 — sys_user.locale is the top rung of the auth-mail ladder', () => {
  const prevMcpEnv = process.env.OS_MCP_SERVER_ENABLED;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OS_MCP_SERVER_ENABLED = 'false';
  });
  afterEach(() => {
    if (prevMcpEnv === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
    else process.env.OS_MCP_SERVER_ENABLED = prevMcpEnv;
  });

  it('the stored column outranks BOTH the request header and the deployment default', async () => {
    // Three rungs, three distinct locales — the pin the card names.
    const { sent } = await driveResetWith({
      stored: 'ja-JP',
      header: 'zh-CN',
      deployment: 'es-ES',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].locale).toBe('ja-JP');
  });

  it('with no stored column the request rung answers — #14319 intact', async () => {
    const { sent } = await driveResetWith({ stored: null, header: 'zh-CN', deployment: 'es-ES' });
    expect(sent[0].locale).toBe('zh-CN');
  });

  it('with neither stored nor request, the deployment rung answers — #8195 intact', async () => {
    const { sent } = await driveResetWith({ stored: null, deployment: 'es-ES' });
    expect(sent[0].locale).toBe('es-ES');
  });

  it('with nothing at all, NO locale is named and the documented en-US floor applies', async () => {
    const { sent } = await driveResetWith({ stored: null });
    expect(sent[0].locale).toBeUndefined();
    // The ladder's contract is written against an ABSENT key, not an explicit
    // `undefined` — see the #8195 case above.
    expect(Object.prototype.hasOwnProperty.call(sent[0], 'locale')).toBe(false);
  });

  it('reads the column off the recipient row by id, projected, under a system context', async () => {
    // Establishes which rung produced the value above.
    const { reads } = await driveResetWith({ stored: 'ja-JP', header: 'zh-CN' });
    const userRead = reads.find((r) => r.object === 'sys_user');
    expect(userRead, 'no sys_user read happened').toBeTruthy();
    expect(userRead.query.where).toEqual({ id: 'u1' });
    expect(userRead.query.fields).toEqual(['locale']);
    expect(userRead.query.context?.isSystem).toBe(true);
  });

  it('maps a stored catalog language onto the row spelling', async () => {
    // `zh` is a legal BCP-47 tag and a legal value of the column; auth rows
    // are keyed `zh-CN` and matched exactly.
    const { sent } = await driveResetWith({ stored: 'zh', deployment: 'es-ES' });
    expect(sent[0].locale).toBe('zh-CN');
  });

  it('passes a stored tag we ship no row for through, unlike the request rung', async () => {
    // The asymmetry is deliberate: the request rung REQUIRES a hit in
    // AUTH_EMAIL_TEMPLATE_LOCALES because "a per-request header is a weaker
    // claim than a deployment's declaration". A column the user set for
    // themselves is not that weak claim — a tenant overlaying en-GB rows must
    // be able to ask for them.
    const { sent } = await driveResetWith({ stored: 'en-GB', header: 'zh-CN', deployment: 'es-ES' });
    expect(sent[0].locale).toBe('en-GB');
    // Same tag through the request rung is refused, unchanged.
    expect(authEmailLocaleFromRequest({ headers: { 'accept-language': 'en-GB' } })).toBeUndefined();
  });

  it('refuses the stringified-nothing literals a lossy producer leaves at rest', async () => {
    // hotcrm's measured dead-letter shape. `normalizeRecipientLocale` — the
    // messaging seam's normalizer, reused rather than re-written — refuses it.
    for (const junk of ['undefined', 'null', '', '   ', 42, {}]) {
      const { sent } = await driveResetWith({ stored: junk, deployment: 'es-ES' });
      expect(sent[0].locale, `stored ${JSON.stringify(junk)} named a locale`).toBe('es-ES');
    }
  });

  it('a failing recipient read never blocks the mail', async () => {
    const { sent } = await driveResetWith({
      engine: { async findOne() { throw new Error('sys_user unavailable'); } },
      header: 'zh-CN',
      deployment: 'es-ES',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].locale).toBe('zh-CN');
  });

  it('an auth manager with no data engine keeps exactly the two-rung behaviour', async () => {
    const { capturedConfig, sent } = await boot('es-ES');
    await capturedConfig.emailAndPassword.sendResetPassword(
      { user: USER, url: 'http://x/reset', token: 't' },
      new Request('http://x/any', { headers: { 'accept-language': 'zh-CN' } }),
    );
    expect(sent[0].locale).toBe('zh-CN');
  });

  it('the INVITATION send is untouched — its rung is #14641\'s', async () => {
    // Scope fence, asserted rather than described: an invitee has no sys_user
    // row until acceptance, so this send still names the deployment rung even
    // when a row for that address would have carried a locale.
    const dataEngine = { async findOne() { return { locale: 'ja-JP' }; } };
    const { capturedConfig, sent } = await boot('es-ES', { dataEngine } as never);
    const org = capturedConfig.plugins.find((p: any) => p.id === 'organization');
    await org._opts.sendInvitationEmail({
      email: 'invitee@example.com',
      invitation: { id: 'inv1', organizationId: 'o1', role: 'member' },
      organization: { name: 'Northwind' },
      inviter: { user: { email: 'dana@example.com', name: 'Dana' } },
    });
    expect(sent[0].template).toBe('auth.invitation');
    expect(sent[0].locale).toBe('es-ES');
  });
});
