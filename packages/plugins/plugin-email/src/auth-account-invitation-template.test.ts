// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23343] `auth.account_invitation` — the invitation an administrator-created
 * account receives (today: Setup › Users › Import), in all four locales.
 *
 * The identity import used to send `auth.password_reset`, so an invited user
 * read "we received a request to reset the password … if you didn't request
 * this, ignore this email". This file owns the template half: the rows exist
 * and are registered, they declare exactly the variables the import holds,
 * each locale renders its own invitation prose with the inviter, the
 * set-password link and its expiry, none of them carries the reset copy, and a
 * send missing any required variable is refused rather than half-rendered.
 * (`plugin-auth`'s `admin-import-users-account-invitation.test.ts` owns the
 * other half: that the import selects this key and nothing else does.)
 *
 * ⚠️ Every expectation below is an independent literal — nothing is derived
 * from the template constants, so an edit that drops a locale, pastes English
 * under a zh-CN tag or loses the link cannot agree with itself.
 */

import { describe, it, expect } from 'vitest';
import { EmailTemplateDefinitionSchema } from '@objectstack/spec/system';
import { EmailService, type EmailTemplateRow, type TemplateLoader } from './email-service.js';
import { BUILTIN_AUTH_TEMPLATES } from './templates/auth-templates.js';
import type {
  IEmailTransport,
  NormalizedEmailMessage,
  TransportSendResult,
} from '@objectstack/spec/contracts';

const NAME = 'auth.account_invitation';
const LOCALES = ['en-US', 'zh-CN', 'ja-JP', 'es-ES'] as const;
type Locale = (typeof LOCALES)[number];

const LINK = 'https://acme.test/api/v1/auth/reset-password/TOK123?callbackURL=https%3A%2F%2Facme.test%2F_console%2Freset-password';

/** Every declared variable, filled. */
const DATA = {
  user: { name: 'Ada', email: 'ada@acme.test' },
  inviter: { name: 'Dana Admin', email: 'dana@acme.test' },
  setPasswordUrl: LINK,
  expiresInMinutes: 45,
  appName: 'Acme',
};

class CaptureTransport implements IEmailTransport {
  public sent: NormalizedEmailMessage[] = [];
  async send(message: NormalizedEmailMessage): Promise<TransportSendResult> {
    this.sent.push(message);
    return { messageId: `msg-${this.sent.length}` };
  }
}

/** Exactly what `EmailServicePlugin` registers, matched on `(name, locale)`, no fallback of its own. */
const seededLoader: TemplateLoader = {
  async load(name: string, locale?: string): Promise<EmailTemplateRow | null> {
    const hit = BUILTIN_AUTH_TEMPLATES.find((t) => t.name === name && (locale === undefined || t.locale === locale));
    if (!hit) return null;
    return {
      name: hit.name,
      locale: hit.locale ?? 'en-US',
      subject: hit.subject,
      body_html: hit.bodyHtml ?? '',
      body_text: hit.bodyText ?? null,
      active: hit.active !== false,
      variables_json: JSON.stringify(hit.variables ?? []),
    };
  },
};

async function send(locale: Locale | undefined, data: Record<string, unknown> = DATA) {
  const transport = new CaptureTransport();
  const svc = new EmailService({ transport, defaultFrom: { address: 'no-reply@acme.test' }, templateLoader: seededLoader });
  await svc.sendTemplate({ template: NAME, to: 'ada@acme.test', ...(locale ? { locale } : {}), data });
  return transport;
}

const EXPECTED_SUBJECT: Record<Locale, string> = {
  'en-US': 'Dana Admin invited you to Acme',
  'zh-CN': 'Dana Admin 邀请您使用 Acme',
  'ja-JP': 'Dana Admin さんから Acme への招待が届いています',
  'es-ES': 'Dana Admin te ha invitado a Acme',
};

/** Who created the account, for which address — the invitation itself. */
const EXPECTED_CREATED: Record<Locale, string> = {
  'en-US': 'has created an account for you on Acme',
  'zh-CN': '已为您创建了 Acme 账号',
  'ja-JP': 'で Acme のアカウントを作成しました',
  'es-ES': 'ha creado una cuenta de Acme para ti',
};

/** The link's real lifetime — a reset token expires, and the reader must know. */
const EXPECTED_EXPIRY: Record<Locale, string> = {
  'en-US': 'This link expires in 45 minutes',
  'zh-CN': '该链接将在 45 分钟后失效',
  'ja-JP': 'このリンクは 45 分後に無効になります',
  'es-ES': 'Este enlace caduca en 45 minutos',
};

const EXPECTED_BUTTON: Record<Locale, string> = {
  'en-US': 'Set your password',
  'zh-CN': '设置密码',
  'ja-JP': 'パスワードを設定',
  'es-ES': 'Establecer contraseña',
};

/** The template's own footer: "if this wasn't you" fits no invitation. */
const EXPECTED_FOOTER: Record<Locale, string> = {
  'en-US': 'You received this email because Dana Admin created an account on Acme for this address.',
  'zh-CN': '您收到本邮件，是因为 Dana Admin 为此邮箱地址创建了 Acme 账号。',
  'ja-JP': 'Dana Admin さんがこのメールアドレスで Acme のアカウントを作成したため、本メールをお送りしています。',
  'es-ES': 'Recibes este correo porque Dana Admin ha creado una cuenta de Acme para esta dirección.',
};

/** The reset copy the import used to send — it must be absent from every locale. */
const RESET_COPY: Record<Locale, string[]> = {
  'en-US': ['received a request to reset', "didn't request", 'ignore this email'],
  'zh-CN': ['我们收到了重置', '如果这不是您本人的操作'],
  'ja-JP': ['再設定するリクエストを受け付けました', '心当たりがない場合'],
  'es-ES': ['Hemos recibido una solicitud para restablecer', 'Si no has solicitado'],
};

describe('[#23343] auth.account_invitation is a registered built-in in all four locales', () => {
  it('has exactly one row per supported locale, each a valid EmailTemplateDefinition', () => {
    const rows = BUILTIN_AUTH_TEMPLATES.filter((t) => t.name === NAME);
    // Registered, not merely exported: `EmailServicePlugin` declares exactly
    // this list in its manifest, so a row missing here is unreachable.
    expect(rows.map((t) => t.locale).sort()).toEqual([...LOCALES].sort());
    for (const t of rows) {
      const parsed = EmailTemplateDefinitionSchema.safeParse(t);
      expect(parsed.success, `${t.locale}: ${parsed.error?.message}`).toBe(true);
    }
  });

  it('declares exactly what the import holds — no organization, no role', () => {
    for (const t of BUILTIN_AUTH_TEMPLATES.filter((r) => r.name === NAME)) {
      expect(
        (t.variables ?? []).map((v) => [v.name, v.type, v.required === true]),
        t.locale,
      ).toEqual([
        ['user.name', 'string', false],
        ['user.email', 'string', true],
        ['inviter.name', 'string', true],
        ['inviter.email', 'string', true],
        ['setPasswordUrl', 'url', true],
        ['expiresInMinutes', 'number', true],
        ['appName', 'string', false],
      ]);
    }
  });
});

describe('[#23343] auth.account_invitation renders its own invitation in each locale', () => {
  for (const locale of LOCALES) {
    it(`${locale}: subject, inviter, set-password link, expiry and footer — and none of the reset copy`, async () => {
      const transport = await send(locale);
      const sent = transport.sent[0]!;
      expect(sent.subject).toBe(EXPECTED_SUBJECT[locale]);
      const html = String(sent.html);
      const text = String(sent.text);
      const prose = [sent.subject, html, text].join('\n');

      expect(prose).toContain(EXPECTED_CREATED[locale]);
      expect(prose).toContain('dana@acme.test');
      expect(prose).toContain('ada@acme.test');
      expect(html).toContain(EXPECTED_EXPIRY[locale]);
      expect(html).toContain(EXPECTED_BUTTON[locale]);
      expect(html).toContain(EXPECTED_FOOTER[locale]);
      expect(html).toContain(`href="${LINK}"`);
      expect(text).toContain(LINK);
      expect(text).toContain('45');
      // Every hole filled.
      expect(prose).not.toContain('{{');
      for (const phrase of RESET_COPY[locale]) expect(prose, phrase).not.toContain(phrase);
    });
  }

  it('a send naming no locale resolves en-US — the documented default', async () => {
    const transport = await send(undefined);
    expect(transport.sent[0]!.subject).toBe(EXPECTED_SUBJECT['en-US']);
  });
});

/**
 * [#30212 row 2, ruling E] The link keeps its lifetime, so the mail's last
 * line must tell a reader whose link lapsed how to get a new one on their own:
 * the sign-in page's forgot-password entry, named as the console labels it in
 * each locale (`auth.login.forgotPasswordText`), for the account's own address,
 * and only then the administrator. The old line sent them straight to the
 * administrator.
 */
const EXPECTED_SELF_SERVE: Record<Locale, string> = {
  'en-US': 'If the link has expired, get a new one from the sign-in page: choose "Forgot password?" and enter ada@acme.test. If that does not work, contact Dana Admin.',
  'zh-CN': '如果链接已失效，请在登录页点击「忘记密码？」并输入 ada@acme.test，获取新的链接；如仍无法设置，请联系 Dana Admin。',
  'ja-JP': 'リンクの有効期限が切れた場合は、サインイン画面の「パスワードをお忘れですか？」から ada@acme.test を入力して、新しいリンクを受け取ってください。それでも設定できない場合は、Dana Admin さんにお問い合わせください。',
  'es-ES': 'Si el enlace ha caducado, solicita uno nuevo desde la página de inicio de sesión: elige «¿Olvidaste tu contraseña?» e introduce ada@acme.test. Si así no puedes, ponte en contacto con Dana Admin.',
};

/** The line it replaces: the administrator as the only way out. */
const OLD_ADMIN_ONLY: Record<Locale, string> = {
  'en-US': 'If the link has expired, contact Dana Admin.',
  'zh-CN': '如果链接已失效，请联系 Dana Admin。',
  'ja-JP': 'リンクの有効期限が切れた場合は、Dana Admin さんにお問い合わせください。',
  'es-ES': 'Si el enlace ha caducado, ponte en contacto con Dana Admin.',
};

describe('[#30212] auth.account_invitation points an expired link at a new one first', () => {
  for (const locale of LOCALES) {
    it(`${locale}: the HTML and text bodies end on the self-serve line, administrator second`, async () => {
      const sent = (await send(locale)).sent[0]!;
      const html = String(sent.html);
      const text = String(sent.text);
      // The HTML body escapes the quotes it renders; read it as a reader would.
      const htmlProse = html.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      expect(htmlProse).toContain(`<p>${EXPECTED_SELF_SERVE[locale]}</p>`);
      expect(text.trimEnd().endsWith(EXPECTED_SELF_SERVE[locale]), text).toBe(true);
      for (const body of [htmlProse, text]) {
        expect(body).not.toContain(OLD_ADMIN_ONLY[locale]);
        // Self-serve before the administrator, inside the one line.
        const line = body.slice(body.indexOf(EXPECTED_SELF_SERVE[locale]));
        expect(line.indexOf('ada@acme.test')).toBeLessThan(line.indexOf('Dana Admin'));
      }
    });
  }
});

describe('[#23343] auth.account_invitation refuses a send missing a required variable', () => {
  const REQUIRED: Array<[string, (d: any) => void]> = [
    ['user.email', (d) => { delete d.user.email; }],
    ['inviter.name', (d) => { delete d.inviter.name; }],
    ['inviter.email', (d) => { delete d.inviter.email; }],
    ['setPasswordUrl', (d) => { delete d.setPasswordUrl; }],
    ['expiresInMinutes', (d) => { delete d.expiresInMinutes; }],
  ];
  for (const locale of LOCALES) {
    for (const [name, drop] of REQUIRED) {
      it(`${locale}: without ${name}, MISSING_VARIABLES and nothing reaches the transport`, async () => {
        const data = structuredClone(DATA) as Record<string, unknown>;
        drop(data);
        const transport = new CaptureTransport();
        const svc = new EmailService({ transport, defaultFrom: { address: 'no-reply@acme.test' }, templateLoader: seededLoader });
        await expect(svc.sendTemplate({ template: NAME, to: 'ada@acme.test', locale, data }))
          .rejects.toThrow(new RegExp(`^MISSING_VARIABLES: ${name.replace('.', '\\.')}$`));
        expect(transport.sent).toHaveLength(0);
      });
    }
  }

  it('control: with every variable present, each locale reaches the transport', async () => {
    for (const locale of LOCALES) {
      const transport = await send(locale);
      expect(transport.sent, locale).toHaveLength(1);
    }
  });
});
