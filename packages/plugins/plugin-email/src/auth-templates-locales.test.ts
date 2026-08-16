// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8195 — every built-in auth template, in every supported locale.
 *
 * Before this, `auth.email_change_notice` was the only auth template with
 * non-`en-US` rows (#8019) and nothing named a locale on the way out, so a
 * zh-CN deployment received English credential mail. Localizing the *resolution*
 * without localizing the *templates* was measured to be worse than the English
 * status quo: the ladder in `email-service.ts` falls back to the **en-US row
 * body** on a miss while still handing the caller's locale to the render
 * filters, i.e. English prose carrying zh-CN dates and numbers inside one
 * message. Both halves land together; this file owns the template half.
 *
 * ⚠️ Every expectation below is an **independent literal**. Deriving the
 * expected subject or body from the same constants the templates are built from
 * would make this file agree with any edit — including deleting three locales,
 * or pasting the English body under a zh-CN tag. The literals are the point.
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

/** The four locales this platform supports, spelled out — not imported. */
const SUPPORTED_LOCALES = ['en-US', 'zh-CN', 'ja-JP', 'es-ES'] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * The five templates this card localizes. `auth.email_change_notice` already
 * shipped four locales with #8019 and is covered by its own file.
 */
const NEWLY_LOCALIZED = [
  'auth.password_reset',
  'auth.verify_email',
  'auth.magic_link',
  'auth.invitation',
  'auth.two_factor_otp',
] as const;
type TemplateName = (typeof NEWLY_LOCALIZED)[number];

// ── harness: the real EmailService over the real seeded rows ───────────────

class CaptureTransport implements IEmailTransport {
  public sent: NormalizedEmailMessage[] = [];
  async send(message: NormalizedEmailMessage): Promise<TransportSendResult> {
    this.sent.push(message);
    return { messageId: `msg-${this.sent.length}` };
  }
}

/**
 * A loader over exactly what `EmailServicePlugin` seeds, matching `(name,
 * locale)` exactly and with no fallback of its own — so the fallback observed
 * in these tests is the SERVICE's ladder, which is the thing under test.
 */
const seededLoader: TemplateLoader = {
  async load(name: string, locale?: string): Promise<EmailTemplateRow | null> {
    const hit = BUILTIN_AUTH_TEMPLATES.find(
      (t) => t.name === name && (locale === undefined || t.locale === locale),
    );
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

/** Render one template in one locale through the real send path. */
async function render(template: TemplateName, locale: Locale | undefined) {
  const transport = new CaptureTransport();
  const svc = new EmailService({
    transport,
    defaultFrom: { address: 'no-reply@acme.test' },
    templateLoader: seededLoader,
  });
  await svc.sendTemplate({
    template,
    to: 'recipient@acme.test',
    ...(locale ? { locale } : {}),
    data: DATA[template],
  });
  const sent = transport.sent[0];
  expect(sent, `${template} @ ${locale ?? '(none)'} was never handed to the transport`).toBeDefined();
  return {
    subject: sent!.subject ?? '',
    // Subject + both bodies: everything a recipient can actually read.
    prose: [sent!.subject ?? '', sent!.html ?? '', sent!.text ?? ''].join('\n'),
  };
}

/** Required variables per template, so every render reaches the transport. */
const DATA: Record<TemplateName, Record<string, unknown>> = {
  'auth.password_reset': {
    user: { name: 'Ada', email: 'ada@acme.test', id: 'u1' },
    resetUrl: 'https://acme.test/reset?t=TOKEN123',
    expiresInMinutes: 60,
    appName: 'Acme',
  },
  'auth.verify_email': {
    user: { name: 'Ada', email: 'ada@acme.test', id: 'u1' },
    verificationUrl: 'https://acme.test/verify?t=TOKEN123',
    expiresInMinutes: 60,
    appName: 'Acme',
  },
  'auth.magic_link': {
    magicLinkUrl: 'https://acme.test/magic?t=TOKEN123',
    expiresInMinutes: 10,
    appName: 'Acme',
  },
  'auth.invitation': {
    inviter: { name: 'Dana', email: 'dana@acme.test' },
    organization: { name: 'Northwind' },
    role: 'admin',
    acceptUrl: 'https://acme.test/accept/INV1',
    appName: 'Acme',
  },
  'auth.two_factor_otp': {
    otp: '482915',
    expiresInMinutes: 5,
    appName: 'Acme',
  },
};

/**
 * The rendered subject of every (template, locale) pair, written out by hand.
 * `{{appName}}` is filled with `Acme` and the invitation's holes with
 * `Dana` / `Northwind` per {@link DATA}.
 */
const EXPECTED_SUBJECT: Record<TemplateName, Record<Locale, string>> = {
  'auth.password_reset': {
    'en-US': 'Reset your Acme password',
    'zh-CN': '重置您的 Acme 密码',
    'ja-JP': 'Acme のパスワードを再設定してください',
    'es-ES': 'Restablece tu contraseña de Acme',
  },
  'auth.verify_email': {
    'en-US': 'Verify your Acme email address',
    'zh-CN': '验证您的 Acme 邮箱地址',
    'ja-JP': 'Acme のメールアドレスを確認してください',
    'es-ES': 'Verifica tu dirección de correo de Acme',
  },
  'auth.magic_link': {
    'en-US': 'Your Acme sign-in link',
    'zh-CN': '您的 Acme 登录链接',
    'ja-JP': 'Acme のサインインリンク',
    'es-ES': 'Tu enlace de acceso a Acme',
  },
  'auth.invitation': {
    'en-US': 'Dana invited you to Northwind',
    'zh-CN': 'Dana 邀请您加入 Northwind',
    'ja-JP': 'Dana さんが Northwind に招待しています',
    'es-ES': 'Dana te ha invitado a Northwind',
  },
  'auth.two_factor_otp': {
    'en-US': 'Your Acme verification code',
    'zh-CN': '您的 Acme 验证码',
    'ja-JP': 'Acme の確認コード',
    'es-ES': 'Tu código de verificación de Acme',
  },
};

/** A distinctive body phrase per pair — the prose, not just the subject line. */
const EXPECTED_BODY_PHRASE: Record<TemplateName, Record<Locale, string>> = {
  'auth.password_reset': {
    'en-US': 'We received a request to reset the password',
    'zh-CN': '我们收到了重置',
    'ja-JP': 'パスワードを再設定するリクエストを受け付けました',
    'es-ES': 'Hemos recibido una solicitud para restablecer la contraseña',
  },
  'auth.verify_email': {
    'en-US': 'Thanks for signing up for Acme',
    'zh-CN': '感谢您注册 Acme',
    'ja-JP': 'ご登録いただきありがとうございます',
    'es-ES': 'Gracias por registrarte en Acme',
  },
  'auth.magic_link': {
    'en-US': 'may only be used once',
    'zh-CN': '只能使用一次',
    'ja-JP': '一度しか使用できません',
    'es-ES': 'solo puede usarse una vez',
  },
  'auth.invitation': {
    'en-US': 'has invited you to join',
    'zh-CN': '邀请您以',
    'ja-JP': '参加するようあなたを招待しました',
    'es-ES': 'te ha invitado a unirte a',
  },
  'auth.two_factor_otp': {
    'en-US': 'Use this code to complete sign-in',
    'zh-CN': '请使用以下验证码完成登录',
    'ja-JP': 'サインインを完了してください',
    'es-ES': 'Usa este código para completar el inicio de sesión',
  },
};

/**
 * The boilerplate footer, per locale. It gets its own pin because it is the
 * likeliest half of a message to be left in English by accident — `wrap()`
 * supplies the English one by DEFAULT, so a localized row that simply forgets
 * to pass a footer still renders, still passes a subject assertion, and still
 * ships English prose to a zh-CN reader.
 */
const EXPECTED_FOOTER: Record<Locale, string> = {
  'en-US': 'you can safely ignore this message',
  'zh-CN': '可以放心忽略本邮件',
  'ja-JP': '本メールを破棄していただいて問題ありません',
  'es-ES': 'puedes ignorar este mensaje con tranquilidad',
};

/** The credential/link hole each template must still carry after translation. */
const REQUIRED_HOLE: Record<TemplateName, string> = {
  'auth.password_reset': 'https://acme.test/reset?t=TOKEN123',
  'auth.verify_email': 'https://acme.test/verify?t=TOKEN123',
  'auth.magic_link': 'https://acme.test/magic?t=TOKEN123',
  'auth.invitation': 'https://acme.test/accept/INV1',
  'auth.two_factor_otp': '482915',
};

// ── the authoring half: rows exist, are valid, and are SEEDED ──────────────

describe('#8195 — the five remaining auth templates ship in all four locales', () => {
  it.each(NEWLY_LOCALIZED)('%s has exactly one row per supported locale', (name) => {
    const rows = BUILTIN_AUTH_TEMPLATES.filter((t) => t.name === name);
    // Seeded, not merely exported: `EmailServicePlugin` upserts exactly this
    // list, so a row missing here is unreachable however it is declared.
    expect(rows.map((t) => t.locale).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it('every seeded auth row is a valid EmailTemplateDefinition', () => {
    for (const t of BUILTIN_AUTH_TEMPLATES) {
      const parsed = EmailTemplateDefinitionSchema.safeParse(t);
      expect(parsed.success, `${t.name} @ ${t.locale}: ${parsed.error?.message}`).toBe(true);
    }
  });

  it('adds exactly 15 rows and leaves the #8019 notice at its four', () => {
    // 5 newly-localized templates x 3 new locales. Stated as a number so that
    // silently dropping a locale fails here rather than passing quietly.
    const newly = BUILTIN_AUTH_TEMPLATES.filter(
      (t) => (NEWLY_LOCALIZED as readonly string[]).includes(t.name) && t.locale !== 'en-US',
    );
    expect(newly).toHaveLength(15);
    expect(
      BUILTIN_AUTH_TEMPLATES.filter((t) => t.name === 'auth.email_change_notice'),
    ).toHaveLength(4);
  });
});

// ── the rendered half: what a recipient actually reads ─────────────────────

describe('#8195 — per-locale rendered text', () => {
  for (const name of NEWLY_LOCALIZED) {
    for (const locale of SUPPORTED_LOCALES) {
      it(`${name} @ ${locale} renders its own subject, prose and footer`, async () => {
        const { subject, prose } = await render(name, locale);
        expect(subject).toBe(EXPECTED_SUBJECT[name][locale]);
        expect(prose).toContain(EXPECTED_BODY_PHRASE[name][locale]);
        expect(prose).toContain(EXPECTED_FOOTER[locale]);
        // A translation that dropped the link/code would still read fluently
        // and be completely useless.
        expect(prose).toContain(REQUIRED_HOLE[name]);
      });
    }
  }
});

// ── the negative half: the mixed-language artefact must be absent ──────────

describe('#8195 — a zh-CN send renders NO en-US text', () => {
  for (const name of NEWLY_LOCALIZED) {
    it(`${name} @ zh-CN carries none of the en-US subject or footer`, async () => {
      const { subject, prose } = await render(name, 'zh-CN');
      // The exact failure this card exists to prevent: an en-US body reaching a
      // zh-CN reader because the row was missing and the ladder fell back.
      expect(subject).not.toContain(EXPECTED_SUBJECT[name]['en-US']);
      expect(prose).not.toContain(EXPECTED_SUBJECT[name]['en-US']);
      expect(prose).not.toContain(EXPECTED_BODY_PHRASE[name]['en-US']);
      expect(prose).not.toContain(EXPECTED_FOOTER['en-US']);
    });
  }

  it('and the same holds for ja-JP and es-ES', async () => {
    for (const name of NEWLY_LOCALIZED) {
      for (const locale of ['ja-JP', 'es-ES'] as const) {
        const { prose } = await render(name, locale);
        expect(prose, `${name} @ ${locale}`).not.toContain(EXPECTED_SUBJECT[name]['en-US']);
        expect(prose, `${name} @ ${locale}`).not.toContain(EXPECTED_FOOTER['en-US']);
      }
    }
  });

  it('a send naming NO locale still resolves en-US — the documented default', async () => {
    // The other direction: this card must not change what an unconfigured
    // deployment receives.
    for (const name of NEWLY_LOCALIZED) {
      const { subject } = await render(name, undefined);
      expect(subject).toBe(EXPECTED_SUBJECT[name]['en-US']);
    }
  });
});
