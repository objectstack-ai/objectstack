// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every built-in auth mail renders BYTE-IDENTICAL from the registry to what the
 * seeded `sys_email_template` row rendered (ADR-0131 D6/D10, ruling C on §6 Q1:
 * "byte-identical to today's seeded row" is read against the template as the
 * registry serves it).
 *
 * The built-ins used to be copied into rows at every boot (`seedTemplates`) and
 * resolved from there. They are now code-declared `email_template` items under
 * the email plugin's own package and resolved from the registry, so this pins
 * the rendered subject, HTML and plain-text faces of every built-in template in
 * every locale against `RENDERED` below — captured from the row path (the rows
 * `seedTemplates` wrote through `mapTemplateToRow`, read by the row loader),
 * through the real `EmailService.renderTemplate`, in the commit that ran both
 * paths side by side and found them identical, before the row path was
 * deleted.
 *
 * The registry path is the real one: `EmailServicePlugin` booted to
 * `kernel:ready` over a real ObjectQL, its manifest registered through
 * `registerApp`, and the `email` service it installs rendering each template.
 *
 * The subject is pinned in clear; the two bodies by SHA-256, since each is a few
 * kilobytes of inline-styled markup. A digest still pins every byte.
 */

import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import type { EmailService } from './email-service.js';
import { EmailServicePlugin } from './email-plugin.js';
import { BUILTIN_AUTH_TEMPLATES } from './templates/auth-templates.js';

/** Every hole any built-in names, with values that exercise escaping (`&`, `<`). */
const DATA = {
  appName: 'Acme & <Co>',
  user: { name: 'Ada <Lovelace>', email: 'ada@example.test' },
  resetUrl: 'https://example.test/reset?token=a1&next=/home',
  verificationUrl: 'https://example.test/verify?token=v1&next=/home',
  magicLinkUrl: 'https://example.test/magic?token=m1&next=/home',
  acceptUrl: 'https://example.test/accept?invite=i1&next=/home',
  setPasswordUrl: 'https://example.test/reset-password/s1?callbackURL=%2Fset&next=/home',
  signInUrl: 'https://example.test/_console/login?next=/home&from=signup',
  resetPasswordUrl: 'https://example.test/_console/forgot-password?next=/home&from=signup',
  expiresInMinutes: 30,
  otp: '424242',
  newEmail: 'ada+new@example.test',
  supportUrl: 'https://example.test/support?topic=email&lang=x',
  role: 'admin',
  inviter: { name: 'Grace <Hopper>', email: 'grace@example.test' },
  organization: { name: 'Analytical & Engines' },
  // [#25802] The invitation's expiry instant, rendered by a date formatter in
  // the timezone the render names (UTC below) so the bytes never follow the
  // machine's zone.
  expiresAt: '2031-03-04T05:06:07.000Z',
};

/**
 * The row path's render of every built-in with `DATA`, captured before the
 * row path was deleted: subject in clear, HTML and text faces by SHA-256.
 */
const RENDERED: Record<string, { subject: string; html: string; text: string }> = {
  'auth.password_reset@en-US': {
    subject: 'Reset your Acme & <Co> password',
    html: '1393acb01d4e1b6c63c7d5515ab54d917df824ad7dd1a79e38b2bb8a8cd7f0a2',
    text: 'ec97c967505e9160dac896c7c6bc3ada3cabf16ee910f723b8788b9adb391c26',
  },
  'auth.password_reset@zh-CN': {
    subject: '重置您的 Acme & <Co> 密码',
    html: 'adc34b5840cfd0424fe911014caf6a1ebbfe33a25b88f1c9f5e79d602578b36d',
    text: '85b84c74c87e504dcb789431f4be041b80d42068c59ece97ac38c970fac27bcd',
  },
  'auth.password_reset@ja-JP': {
    subject: 'Acme & <Co> のパスワードを再設定してください',
    html: '3b2279570b55fe5f3ca8f29737d9283014b52b0085cf0c2bfa898f0b9432a2b3',
    text: '90ac51ed4af2fc147f5f34d4e2c38b970022fc931eac473c029770d7d29c22a7',
  },
  'auth.password_reset@es-ES': {
    subject: 'Restablece tu contraseña de Acme & <Co>',
    html: '6d037485fc10a5dd96ff347d2e963eb16e56f9b405a2b7a4cd17c92cdff046d8',
    text: 'f876214c50d2c5af9a3927ca9b92373389264c1d225675ac556652bc35d09eab',
  },
  'auth.verify_email@en-US': {
    subject: 'Verify your Acme & <Co> email address',
    html: '6762966601763f062f4d94fd4ce92fefc5e70f3c633dfb36192e0b49fe6435da',
    text: 'c092293bd22ebe603584b17313fe69630ef7e02afd902c9afcfccf3926606615',
  },
  'auth.verify_email@zh-CN': {
    subject: '验证您的 Acme & <Co> 邮箱地址',
    html: '0ebe7296b2561b3e668f22224a956980ed7544d1471f09fe2c0c2275500681af',
    text: '3f671f4982e6c2b6f921a4bc3bebd628f43f01f9eef9442c237673938b6c9cbf',
  },
  'auth.verify_email@ja-JP': {
    subject: 'Acme & <Co> のメールアドレスを確認してください',
    html: '2e67b8f21d18a649b423bdd5de14fa5ed03c3c07a14e3d630da4b589f4855c1c',
    text: 'cd091abab8124673ab214481086c0ca5d1cd06c876fa1c015b68e5f75f9e7326',
  },
  'auth.verify_email@es-ES': {
    subject: 'Verifica tu dirección de correo de Acme & <Co>',
    html: '663f7eeff9a5f300e7603b5f83301565b1c09e278525e351dd4cd89ddcd01b85',
    text: '13ec3fae02bbf5ec0a984705d290f5a1c86d5516736cb82a42887f5be235be11',
  },
  'auth.magic_link@en-US': {
    subject: 'Your Acme & <Co> sign-in link',
    html: 'cc0adefd59a0230a2eabe638e7af9fa949f4e565bc57daf1590d05c25d89a50c',
    text: '106425fb86676265c6896b5a104a7c63ab61b35b4eee7de38528dc8f25737d79',
  },
  'auth.magic_link@zh-CN': {
    subject: '您的 Acme & <Co> 登录链接',
    html: '9882dfb84ee66942a2dc99c09bf2277e6dc31a2b0c5e2548f83b97be3aeba53f',
    text: '3abdea870d8a84989ab009aa1a136a61fed9125741501cdf497df1ca1c20db94',
  },
  'auth.magic_link@ja-JP': {
    subject: 'Acme & <Co> のサインインリンク',
    html: 'bccceb1c4149a70cbb25ad7e3bced6a620ebe9ad7b600a0e771476466ec9dcac',
    text: 'b70d1c38d70da880572da6031375a9b0f6a78375d1a125a835c4e063bc1835e4',
  },
  'auth.magic_link@es-ES': {
    subject: 'Tu enlace de acceso a Acme & <Co>',
    html: '0367cfe001dbc9aedb210b2d14af3de8b623be6d2b0c9ca62910da405ad5678f',
    text: '0e8fe995b762d65a08152d727bfd393877783b86bb90d30f0d6a5f1b7ab76dac',
  },
  // #24154 — the four invitation TEXT digests were re-captured when the text
  // bodies gained the role clause their HTML bodies carry (each recomputed
  // from its expected string by hand, not copied from a run); the subject and
  // HTML pins are the row path's, unchanged.
  // [#25802] The four invitation rows gained the expiry sentence; their bodies
  // are re-pinned from the registry render in that commit, with the formatted
  // instant cut to EXPIRY_HOLE (every other row's bytes were unchanged by it).
  'auth.invitation@en-US': {
    subject: 'Grace <Hopper> invited you to Analytical & Engines',
    html: '3e211033743dc60b2cdefc3ebc75496f92521e6928d39aa5a8b7f4ae939b6522',
    text: '9ad810e17f17ec421a549070c88d8c41c99eb2018c0f3211ec5142c3a85a6120',
  },
  'auth.invitation@zh-CN': {
    subject: 'Grace <Hopper> 邀请您加入 Analytical & Engines',
    html: '0481419a8f4983cec604f915466ae22f263705945a93c1f389d591591f047044',
    text: '847c2c5dca77944ec27125d8f24ce2c89a75fd0629edecd0193a72947f4b84fb',
  },
  'auth.invitation@ja-JP': {
    subject: 'Grace <Hopper> さんが Analytical & Engines に招待しています',
    html: 'faee1bc20d4b0e4d42bbf4ed0b3838e3c49c6d63f540a33d12f1d427aa3d0954',
    text: '79fd55bb6aad81c1e6f59d8c4bd4d387827c4d6b988a4f2887f996da9aba9dd3',
  },
  'auth.invitation@es-ES': {
    subject: 'Grace <Hopper> te ha invitado a Analytical & Engines',
    html: '58f4b3f845eb870fc6cc494e8e4b95e102d988ba7e97cbc384267275fddc70ae',
    text: 'fb576ed4a00198bd02ac3e54aa1d27239b2f1025562fa5be7a8da15ff3d78388',
  },
  // [#23343] Declared after the row path was deleted, so these four never had
  // a seeded row: they are pinned against their first registry render, in the
  // commit that added them. Every byte is still pinned from here on.
  'auth.account_invitation@en-US': {
    subject: 'Grace <Hopper> invited you to Acme & <Co>',
    html: 'baa6c29af47c46bf06368450cbb16ecd5c79053143409abef1cdbf58533866f4',
    text: '7c2019d448f34c6d851eb3d35b76462d68932162473987300e2b0aef11c9cff6',
  },
  'auth.account_invitation@zh-CN': {
    subject: 'Grace <Hopper> 邀请您使用 Acme & <Co>',
    html: '9c93150a86230d4270a6758c4944214be62625b5a63e195be0649d3f0f1a9511',
    text: '31a9c79bd0278bec9dbc89835716ea7f0014608e74a7e38d99206cc73f652561',
  },
  'auth.account_invitation@ja-JP': {
    subject: 'Grace <Hopper> さんから Acme & <Co> への招待が届いています',
    html: 'af385b49931a8420788849426c932e340ae3c3b32a21942eae231ea2f6667405',
    text: '85fad1dda634370822d8a36f1278e41939179870a405d264d09ffa84be01e0dd',
  },
  'auth.account_invitation@es-ES': {
    subject: 'Grace <Hopper> te ha invitado a Acme & <Co>',
    html: '5429cef2368584d991992021d2d309593ccdffad75bf1dd00dcee0cc555bd16f',
    text: '8f9882fab386469509598af8a41f6f00aeb59ce75184c1060d13b895c4b32722',
  },
  'auth.two_factor_otp@en-US': {
    subject: 'Your Acme & <Co> verification code',
    html: '3ff1c9565d4c5b9fb98964395062a0f702bb14fb290ccb17e24a0538d3353b5e',
    text: 'd767281d14b56a17369784ad05a7883af41cdf798406a74ef76817e1daa16161',
  },
  'auth.two_factor_otp@zh-CN': {
    subject: '您的 Acme & <Co> 验证码',
    html: '7b2efd6150ec4e576edb5583dcb260abf0e6b555295f078d6896d6a940c644a0',
    text: '3224e85b7d5075b13d0e610ee847b8bf63be0ad4588e65fc22da0a02f80cd57f',
  },
  'auth.two_factor_otp@ja-JP': {
    subject: 'Acme & <Co> の確認コード',
    html: 'c6cd4f5c44f24498db487162f4dde713f1e3b2c25a19cdf560fb18e88f72073f',
    text: 'b659bcff1065e45441afb9f70ae6d026c2fabf8495fca7d5147204344b4101e4',
  },
  'auth.two_factor_otp@es-ES': {
    subject: 'Tu código de verificación de Acme & <Co>',
    html: 'a6bc07041a34a40a2e4933c77587c97975bb73181643ea8d5c970fb8282560b5',
    text: 'd7ad07b890ab2749209cf4e6333c7ad818f9b8a85c0e8f43dbc8050d5cec4293',
  },
  'auth.email_change_notice@en-US': {
    subject: 'Security notice: the email address on your Acme & <Co> account is being changed',
    html: '9e24ed352d228f4f23023a40840fbb23591b5e828298aa107bdd106706f901e5',
    text: 'f9971cbe4ee8fe31fac97c7fe9157801fc3523ed33c42d96848e8146c10937eb',
  },
  'auth.email_change_notice@zh-CN': {
    subject: '安全通知：您的 Acme & <Co> 账号邮箱正在被变更',
    html: '5d9d29c6dae4807a025b1442ca6b138b7e94da11c1a7567248ed6c6ff8aa1c4e',
    text: '88fa5df276274f93028d3ce5e573c410b7160f86bc934c4dbd3876a2bd07b2f1',
  },
  'auth.email_change_notice@ja-JP': {
    subject: 'セキュリティ通知: Acme & <Co> アカウントのメールアドレスが変更されようとしています',
    html: '92dc4cad3dda75ad9a0bc8b79d8a6263577ed164aa8875429c341896220376a7',
    text: 'aab5fa1256173e5c245e90510722a53ef38e1a7ab4cb316926054e47148998d1',
  },
  'auth.email_change_notice@es-ES': {
    subject: 'Aviso de seguridad: se está cambiando el correo de tu cuenta de Acme & <Co>',
    html: 'cc817fe06bbf628a98b1ad06d34ad51fcfc4749b3ee0d2536cad94632cb6edbb',
    text: '13e8e63f4df3367b410fa2ca7a0acdf47eb3b8b060d1e5e96119f17cfbfd03bd',
  },
  // Added after the row path was deleted (#25060), so these four were never
  // seeded rows: they are captured from this same registry render in the
  // commit that added the template, and pin its bytes from then on.
  'auth.existing_account_sign_up@en-US': {
    subject: 'You already have an account on Acme & <Co>',
    html: 'a202e07c920824c43614981036741ca4928a118ac8b6def0e280110c27447796',
    text: '2134c939c462278030be798c4d08289885016e69b2a90ddb67ae5c02e680a585',
  },
  'auth.existing_account_sign_up@zh-CN': {
    subject: '您已拥有 Acme & <Co> 账号',
    html: '6a77dae95e1993b95cc91f4bb371e1889c918e43ab05cd29f3af1074693f1f1d',
    text: 'd869d97a3f1febc0a0657d7b462d7a8df0b0706f1a9c50f1226392c03cc0cdc6',
  },
  'auth.existing_account_sign_up@ja-JP': {
    subject: 'Acme & <Co> のアカウントはすでにお持ちです',
    html: '1909c0c2d9a0e6d35923444af81e7f184e7359b4aa9cb276516223d7ca3ec334',
    text: 'a75aba0b49bbbe5ccaec0253be1faf5b0b757580457b16fd4e9f4f15a3e06e39',
  },
  'auth.existing_account_sign_up@es-ES': {
    subject: 'Ya tienes una cuenta de Acme & <Co>',
    html: 'c6abe9c3fc761d1dc88b0517ee65bce3dcedb01a425e6cdd3daebdd77aff1a00',
    text: '7d65c60ed0e8b415fe7aae7aff5c544318f81e3ab6c87525067af112a30d238b',
  },
};

/** What the expiry instant is replaced with before a face is digested. */
const EXPIRY_HOLE = '{{EXPIRES_AT_LONG}}';

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Boot the plugin over a real ObjectQL and hand back the `email` service it installs. */
async function bootEmailService(): Promise<EmailService> {
  const ql = new ObjectQL();
  const services: Record<string, unknown> = {
    manifest: { register: (m: unknown) => ql.registerApp(m) },
    objectql: ql,
  };
  const hooks: Record<string, Array<() => Promise<void> | void>> = {};
  const ctx = {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getService: <T,>(name: string): T => {
      if (!(name in services)) throw new Error(`service '${name}' not registered`);
      return services[name] as T;
    },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    hook: (name: string, fn: () => Promise<void> | void) => { (hooks[name] ??= []).push(fn); },
  };
  const plugin = new EmailServicePlugin({ persist: false, transport: { send: async () => ({ messageId: 'x' }) } as never });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  for (const fn of hooks['kernel:ready'] ?? []) await fn();
  return services.email as EmailService;
}

describe('every built-in auth mail renders byte-identical from the registry', () => {
  it('renders every built-in template, in every locale, to the seeded row\'s bytes', async () => {
    const svc = await bootEmailService();
    const rendered: Record<string, { subject: string; html: string; text: string }> = {};
    for (const tpl of BUILTIN_AUTH_TEMPLATES) {
      const r = await svc.renderTemplate({ template: tpl.name, locale: tpl.locale, data: DATA, timezone: 'UTC' });
      // [#25802] The one hole whose bytes are ICU locale data, not template
      // text: the long-formatted expiry. Its wording moves between ICU
      // releases (es-ES `2031, 5:06:07` on ICU 77, `2031 a las 5:06:07` on
      // ICU 78), so it is cut out at its exact position and the digest pins
      // every other byte; that the template renders exactly that instant is
      // asserted here, against this Node's own `Intl`.
      const instant = new Intl.DateTimeFormat(tpl.locale, {
        dateStyle: 'long',
        timeStyle: 'long',
        timeZone: 'UTC',
      }).format(new Date(DATA.expiresAt));
      const cut = (face: string) => face.split(instant);
      const html = cut(r.html);
      const text = cut(r.text);
      const expected = tpl.name === 'auth.invitation' ? 2 : 1;
      expect(html, `${tpl.name}@${tpl.locale} HTML expiry holes`).toHaveLength(expected);
      expect(text, `${tpl.name}@${tpl.locale} text expiry holes`).toHaveLength(expected);
      rendered[`${tpl.name}@${tpl.locale}`] = {
        subject: r.subject,
        html: sha256(html.join(EXPIRY_HOLE)),
        text: sha256(text.join(EXPIRY_HOLE)),
      };
    }

    expect(Object.keys(rendered)).toHaveLength(32);
    expect(rendered).toEqual(RENDERED);
  });
});
