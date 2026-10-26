// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24154 — the organization invitation mail names the invitee's membership
 * role by its option LABEL in the mail's own locale, never by the stored value.
 *
 * Measured on the real cloud sign-up chain: a zh-CN invitation printed
 * 「邀请您以 member 的身份加入」 — every localized body interpolates `{{role}}`,
 * and the sender handed it `invitation.role`, the stored enum. This file owns
 * the SENDING half: what `sendInvitationEmail` puts in `data.role`. The
 * template half (both bodies interpolate it, and name the same facts) is
 * `plugin-email/src/auth-templates-locales.test.ts`.
 *
 * The i18n service here is the kernel's in-memory provider loaded with the
 * REAL platform bundles, exactly as `PlatformObjectsPlugin` loads them, so the
 * labels below are the ones the console shows for `sys_member.role`. Every
 * expected label is an independent literal: deriving it from the bundle would
 * agree with any edit, including the raw value coming back.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMemoryI18n } from '@objectstack/core';
import { SetupAppTranslations } from '@objectstack/platform-objects/apps';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { invitationRoleLabel } from './invitation-role-label';

vi.mock('better-auth', () => ({
  betterAuth: vi.fn(() => ({ handler: vi.fn(), api: {} })),
}));

vi.mock('better-auth/plugins/organization', () => ({
  organization: vi.fn((opts: any) => ({ id: 'organization', _opts: opts })),
}));

// ── harness ────────────────────────────────────────────────────────────────

/** The kernel's in-memory i18n, holding the platform bundles. */
function platformI18n() {
  const i18n = createMemoryI18n();
  for (const [locale, data] of Object.entries(SetupAppTranslations)) {
    i18n.loadTranslations(locale, data as Record<string, unknown>);
  }
  return i18n;
}

/** A `sys_user` table keyed by address — the invitee's stored language. */
function storedLocaleEngine(byEmail: Record<string, string>) {
  return {
    async findOne(object: string, query: any) {
      if (object !== 'sys_user') return null;
      const email = (query?.where ?? {}).email as string;
      return Object.prototype.hasOwnProperty.call(byEmail, email) ? { locale: byEmail[email] } : null;
    },
  };
}

/**
 * Drive one invitation through `sendInvitationEmail` and return the recorded
 * `sendTemplate` input plus every `warn` the manager logged.
 */
async function invite(opts: {
  role: string;
  /** The invitee's stored `sys_user.locale`; omitted = a new invitee. */
  inviteeLocale?: string;
  deployment?: string;
  getI18n?: () => unknown;
  /** The INVITER's browser language — better-auth hands this callback its request. */
  header?: string;
  /** better-auth's `invitation.expiresAt`; omitted = the row carries none. */
  expiresAt?: unknown;
}) {
  const { betterAuth } = await import('better-auth');
  let captured: any;
  (betterAuth as any).mockImplementation((config: any) => {
    captured = config;
    return { handler: vi.fn(), api: {} };
  });
  const warns: Array<{ msg: string; meta?: unknown }> = [];
  const manager = new AuthManager({
    secret: 'test-secret-at-least-32-chars-long',
    baseUrl: 'http://localhost:3000',
    dataEngine: storedLocaleEngine(
      opts.inviteeLocale ? { 'invitee@example.com': opts.inviteeLocale } : {},
    ),
    logger: { info: () => {}, warn: (msg: string, meta?: unknown) => warns.push({ msg, meta }) },
    ...(opts.getI18n ? { getI18n: opts.getI18n } : {}),
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
  manager.setDefaultEmailLocale(opts.deployment);
  await manager.getAuthInstance();
  const org = captured.plugins.find((p: any) => p.id === 'organization');
  await org._opts.sendInvitationEmail(
    {
      email: 'invitee@example.com',
      invitation: {
        id: 'inv1',
        organizationId: 'o1',
        role: opts.role,
        ...(opts.expiresAt !== undefined ? { expiresAt: opts.expiresAt } : {}),
      },
      organization: { name: 'Northwind' },
      inviter: { user: { email: 'dana@example.com', name: 'Dana' } },
    },
    opts.header === undefined
      ? undefined
      : new Request('http://x/invite', { headers: { 'accept-language': opts.header } }),
  );
  expect(sent, 'the invitation never reached the transport').toHaveLength(1);
  expect(sent[0].template).toBe('auth.invitation');
  return { input: sent[0], warns };
}

const prevMcpEnv = process.env.OS_MCP_SERVER_ENABLED;
beforeEach(() => {
  vi.clearAllMocks();
  // Keep the plugin list to what this file drives.
  process.env.OS_MCP_SERVER_ENABLED = 'false';
});
afterEach(() => {
  if (prevMcpEnv === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
  else process.env.OS_MCP_SERVER_ENABLED = prevMcpEnv;
});

// ── the label, in the mail's locale ────────────────────────────────────────

describe('#24154 — the invitation names the role by its label in the mail locale', () => {
  it('a zh-CN invitation names 成员, never the stored member', async () => {
    const { input } = await invite({ role: 'member', deployment: 'zh-CN', getI18n: platformI18n });
    expect(input.locale).toBe('zh-CN');
    expect(input.data.role).toBe('成员');
  });

  it.each([
    ['ja-JP', 'メンバー'],
    ['es-ES', 'Miembro'],
    // `en-US` is the row spelling; the bundle is keyed `en`. The label is read
    // through the same negotiation the console's object read runs.
    ['en-US', 'Member'],
  ])('a %s invitation names %s', async (locale, label) => {
    const { input } = await invite({ role: 'member', deployment: locale, getI18n: platformI18n });
    expect(input.locale).toBe(locale);
    expect(input.data.role).toBe(label);
  });

  it("the label follows the INVITEE's language, never the inviter's request", async () => {
    // The locale rule itself is #14641's and unchanged: the stored language
    // first, the deployment default second, the inviter's header never.
    const { input } = await invite({
      role: 'admin',
      inviteeLocale: 'zh-CN',
      deployment: 'es-ES',
      header: 'ja-JP',
      getI18n: platformI18n,
    });
    expect(input.locale).toBe('zh-CN');
    expect(input.data.role).toBe('管理员');
  });

  it("a tenant's authored translation of the option reaches the mail, as it reaches the console", async () => {
    // What separates reading the runtime's i18n service from reading a copy of
    // the platform bundle: a Studio translation of the same key.
    const i18n = platformI18n();
    i18n.replaceAuthoredTranslations({
      'zh-CN': { objects: { sys_member: { fields: { role: { options: { member: '协作成员' } } } } } },
    });
    const { input } = await invite({ role: 'member', deployment: 'zh-CN', getI18n: () => i18n });
    expect(input.data.role).toBe('协作成员');
  });

  it('a multi-role value is named role by role, as a list in the mail locale', async () => {
    // better-auth joins an array of roles with `,` before it stores them.
    const zh = await invite({ role: 'admin,member', deployment: 'zh-CN', getI18n: platformI18n });
    expect(zh.input.data.role).toBe('管理员和成员');
    const en = await invite({ role: 'admin,member', deployment: 'en-US', getI18n: platformI18n });
    expect(en.input.data.role).toBe('Admin and Member');
  });
});

// ── the stated fallbacks ───────────────────────────────────────────────────

describe('#24154 — a value with no label, or no i18n service, falls back as stated', () => {
  it('a value outside the option list is named as stored, with one warn naming it', async () => {
    const { input, warns } = await invite({ role: 'auditor', deployment: 'zh-CN', getI18n: platformI18n });
    expect(input.data.role).toBe('auditor');
    const named = warns.filter((w) => w.msg.includes("'auditor'"));
    expect(named).toHaveLength(1);
    expect(named[0]!.msg).toContain('have no sys_member.role option label');
  });

  it('and inside a list, only that token falls back', async () => {
    const { input } = await invite({ role: 'admin,auditor', deployment: 'zh-CN', getI18n: platformI18n });
    expect(input.data.role).toBe('管理员和auditor');
  });

  it('no i18n service names the authored label, never the stored value', async () => {
    const { input, warns } = await invite({ role: 'member', deployment: 'zh-CN' });
    expect(input.data.role).toBe('Member');
    // #25802 — and says once that the zh-CN mail carries an English label.
    expect(warns.filter((w) => w.msg.includes('invitation mail'))).toHaveLength(1);
    expect(untranslatedWarns(warns)).toHaveLength(1);
  });

  it('a throwing i18n service still delivers the mail, with the authored label and one warn', async () => {
    const { input, warns } = await invite({
      role: 'member',
      deployment: 'zh-CN',
      getI18n: () => {
        throw new Error('i18n down');
      },
    });
    expect(input.data.role).toBe('Member');
    const degraded = warns.filter((w) => w.msg.includes('could not be read from the i18n service'));
    expect(degraded).toHaveLength(1);
    // One warn for one degradation: the thrown read already said why the
    // label is English, so the untranslated-label warn does not repeat it.
    expect(warns.filter((w) => w.msg.includes('invitation mail'))).toHaveLength(1);
  });

  it('an empty value stays empty — there is no role to name', async () => {
    await expect(invitationRoleLabel('', 'zh-CN', { getI18n: platformI18n })).resolves.toBe('');
  });
});

// ── #25802 — a label with no translation in the mail locale is said once ──

/** The warns that name an untranslated role label. */
function untranslatedWarns(warns: Array<{ msg: string; meta?: unknown }>) {
  return warns.filter((w) => w.msg.includes('label was found for the membership role'));
}

/**
 * The platform bundles loaded, and the deployment's declared
 * `i18n.supportedLocales` set on the service — the read
 * `translateMetaList` takes its bundle from (`getLocales()`).
 */
function declaringI18n(supportedLocales: string[]) {
  const i18n = platformI18n();
  i18n.setSupportedLocales(supportedLocales);
  return i18n;
}

describe('#25802 — a zh-CN mail whose role label stayed English says so, once', () => {
  it('the platform bundles reach the zh-CN mail: 成员, and no warn', async () => {
    const { input, warns } = await invite({ role: 'member', deployment: 'zh-CN', getI18n: platformI18n });
    expect(input.data.role).toBe('成员');
    expect(warns.filter((w) => w.msg.includes('invitation mail'))).toHaveLength(0);
  });

  it('a service whose locales omit zh-CN names Member, with one warn naming the role and the locale', async () => {
    // The reported shape: the label read answers without throwing, holds no
    // zh-CN entry, and the authored English label lands in a Chinese sentence.
    const i18n = declaringI18n(['en']);
    const { input, warns } = await invite({ role: 'member', deployment: 'zh-CN', getI18n: () => i18n });
    expect(input.data.role).toBe('Member');
    const named = untranslatedWarns(warns);
    expect(named).toHaveLength(1);
    expect(named[0]!.msg).toContain("no 'zh-CN' label");
    expect(named[0]!.msg).toContain("'member'");
    expect(named[0]!.meta).toMatchObject({ role: 'member', locale: 'zh-CN', i18nService: true });
  });

  it('a list warns once, naming every token that stayed English', async () => {
    const i18n = declaringI18n(['en']);
    const { input, warns } = await invite({ role: 'admin,member', deployment: 'ja-JP', getI18n: () => i18n });
    expect(input.data.role).toContain('Admin');
    expect(input.data.role).toContain('Member');
    const named = untranslatedWarns(warns);
    expect(named).toHaveLength(1);
    expect(named[0]!.msg).toContain("'admin', 'member'");
  });

  it('a value outside the option list is not counted twice', async () => {
    const i18n = declaringI18n(['en']);
    const { warns } = await invite({ role: 'auditor', deployment: 'zh-CN', getI18n: () => i18n });
    expect(warns.filter((w) => w.msg.includes("'auditor'"))).toHaveLength(1);
    expect(untranslatedWarns(warns)).toHaveLength(0);
  });

  it.each(['en-US', 'en-GB'])('an %s mail reads the authored label as its own text: no warn', async (locale) => {
    const { input, warns } = await invite({ role: 'member', deployment: locale });
    expect(input.data.role).toBe('Member');
    expect(warns.filter((w) => w.msg.includes('invitation mail'))).toHaveLength(0);
  });
});

// ── #25802 — the mail states when the invitation expires ───────────────────

describe('#25802 — the sender hands the template the invitation expiry', () => {
  it('a Date expiry reaches the template as its ISO-8601 instant', async () => {
    const { input } = await invite({
      role: 'member',
      deployment: 'zh-CN',
      getI18n: platformI18n,
      expiresAt: new Date('2031-03-04T05:06:07.000Z'),
    });
    expect(input.data.expiresAt).toBe('2031-03-04T05:06:07.000Z');
  });

  it('a string expiry is read the same way', async () => {
    const { input } = await invite({ role: 'member', deployment: 'en-US', expiresAt: '2031-03-04T05:06:07Z' });
    expect(input.data.expiresAt).toBe('2031-03-04T05:06:07.000Z');
  });

  it.each([
    ['no expiry', undefined],
    ['an unreadable one', 'not-a-date'],
  ])('%s is left out rather than invented, and the mail still goes', async (_label, expiresAt) => {
    const { input } = await invite({ role: 'member', deployment: 'en-US', expiresAt });
    expect(Object.prototype.hasOwnProperty.call(input.data, 'expiresAt')).toBe(false);
  });
});

// ── the composition: AuthPlugin hands the manager the kernel's i18n ────────

describe('#24154 — AuthPlugin wires the i18n accessor lazily', () => {
  async function initPlugin(getService: (name: string) => unknown) {
    const registerService = vi.fn();
    const ctx: any = {
      registerService,
      getService: vi.fn(getService),
      getServices: vi.fn(() => new Map()),
      hook: vi.fn(),
      trigger: vi.fn(),
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      getKernel: vi.fn(),
    };
    const plugin = new AuthPlugin({ secret: 'test-secret-at-least-32-chars-long', baseUrl: 'http://localhost:3000' });
    await plugin.init(ctx);
    const manager = registerService.mock.calls.find((call) => call[0] === 'auth')?.[1] as AuthManager;
    expect(manager, 'AuthPlugin registered no auth service').toBeDefined();
    return (manager as any).config.getI18n as () => unknown;
  }

  it("resolves the kernel's i18n service at call time", async () => {
    const i18n = platformI18n();
    let registered = false;
    const getI18n = await initPlugin((name) => {
      if (name === 'manifest') return { register: vi.fn() };
      if (name === 'i18n') {
        if (!registered) throw new Error('[Kernel] Service i18n not found');
        return i18n;
      }
      return undefined;
    });
    // Registered after the plugin's init — the accessor still finds it.
    registered = true;
    expect(getI18n()).toBe(i18n);
  });

  it('answers undefined when no i18n service is registered', async () => {
    const getI18n = await initPlugin((name) => {
      if (name === 'manifest') return { register: vi.fn() };
      if (name === 'i18n') throw new Error('[Kernel] Service i18n not found');
      return undefined;
    });
    expect(getI18n()).toBeUndefined();
  });
});
