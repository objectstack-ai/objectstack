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
 * every locale against `RENDERED` below — captured from the row path, through
 * the real `EmailService.renderTemplate`, before that path was deleted.
 *
 * The subject is pinned in clear; the two bodies by SHA-256, since each is a few
 * kilobytes of inline-styled markup. A digest still pins every byte.
 */

import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { EmailService, type TemplateLoader } from './email-service.js';
import {
  BUILTIN_EMAIL_TEMPLATES_PACKAGE_ID,
  createRegistryEmailTemplateLoader,
  createSysEmailTemplateLoader,
} from './template-loader.js';
import { mapTemplateToRow } from './bootstrap-declared-email-templates.js';
import { BUILTIN_AUTH_TEMPLATES } from './templates/auth-templates.js';

/** Every hole any built-in names, with values that exercise escaping (`&`, `<`). */
const DATA = {
  appName: 'Acme & <Co>',
  user: { name: 'Ada <Lovelace>', email: 'ada@example.test' },
  resetUrl: 'https://example.test/reset?token=a1&next=/home',
  verificationUrl: 'https://example.test/verify?token=v1&next=/home',
  magicLinkUrl: 'https://example.test/magic?token=m1&next=/home',
  acceptUrl: 'https://example.test/accept?invite=i1&next=/home',
  expiresInMinutes: 30,
  otp: '424242',
  newEmail: 'ada+new@example.test',
  supportUrl: 'https://example.test/support?topic=email&lang=x',
  role: 'admin',
  inviter: { name: 'Grace <Hopper>', email: 'grace@example.test' },
  organization: { name: 'Analytical & Engines' },
};

/**
 * The row path's render of every built-in, captured through this file's own
 * `renderAll` before the row path was deleted: subject in clear, HTML and text
 * faces by SHA-256.
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
  'auth.invitation@en-US': {
    subject: 'Grace <Hopper> invited you to Analytical & Engines',
    html: '58aa661450e6d836a02267bede0e644f2f6cfcce2f125e63e4a4cc661d424069',
    text: '51133e10b09e812ef7c26e6f3ecef8b4e3af2d631d11b03ab35b868bf3838dc7',
  },
  'auth.invitation@zh-CN': {
    subject: 'Grace <Hopper> 邀请您加入 Analytical & Engines',
    html: '6789d8a1f8fe77ae9dac42694c4512df93be52edac56bfe91bbfad0a453e63fe',
    text: '6594a2e35834be88ba7cab9d1337a74cb6f066adf507afddc72606e21f71d752',
  },
  'auth.invitation@ja-JP': {
    subject: 'Grace <Hopper> さんが Analytical & Engines に招待しています',
    html: '6f5123d67393d721038b50292106bf83676d946f1950bf45869f16c2e977ef0f',
    text: 'bbfd601ea83dab70d6d9bf48da887d7a1890c69efaf3bcc69958c1a4971ac7fe',
  },
  'auth.invitation@es-ES': {
    subject: 'Grace <Hopper> te ha invitado a Analytical & Engines',
    html: '9f49cf12933faf499b1000b8895d29c4dbfba9b051e695bd845e885b22e7db02',
    text: 'f7acc0d60a7fdcb68611e6d69b905a1260b104b9c947e9ae74b595fe25b7330e',
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
};

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

async function renderAll(loader: TemplateLoader): Promise<Record<string, { subject: string; html: string; text: string }>> {
  const svc = new EmailService({ transport: { send: async () => ({ messageId: 'x' }) } as never, templateLoader: loader });
  const out: Record<string, { subject: string; html: string; text: string }> = {};
  for (const tpl of BUILTIN_AUTH_TEMPLATES) {
    const r = await svc.renderTemplate({ template: tpl.name, locale: tpl.locale, data: DATA });
    out[`${tpl.name}@${tpl.locale}`] = { subject: r.subject, html: sha256(r.html), text: sha256(r.text) };
  }
  return out;
}

/** The seeded-row path: the rows `seedTemplates` wrote, read by the row loader. */
function rowPathLoader(): TemplateLoader {
  const rows = BUILTIN_AUTH_TEMPLATES.map((tpl, i) => ({ id: `etpl_${String(i).padStart(3, '0')}`, ...mapTemplateToRow(tpl) }));
  return createSysEmailTemplateLoader({
    async find(_object: string, query: Record<string, unknown>) {
      const where = (query.where ?? {}) as Record<string, unknown>;
      const hit = rows.filter((r: Record<string, unknown>) => Object.entries(where).every(([k, v]) => r[k] === v));
      return typeof query.limit === 'number' ? hit.slice(0, query.limit) : hit;
    },
  });
}

/** The registry path: the built-ins registered through a manifest, as the plugin registers them. */
function registryPathLoader(): TemplateLoader {
  const ql = new ObjectQL();
  ql.registerApp({
    id: BUILTIN_EMAIL_TEMPLATES_PACKAGE_ID,
    name: 'Email Service',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    namespace: 'sys',
    emailTemplates: BUILTIN_AUTH_TEMPLATES,
  });
  return createRegistryEmailTemplateLoader({ registry: ql.registry as never });
}

describe('every built-in auth mail renders byte-identical from the registry', () => {
  it('the row path and the registry path render the same bytes', async () => {
    const rowPath = await renderAll(rowPathLoader());
    const registryPath = await renderAll(registryPathLoader());
    expect(Object.keys(registryPath)).toHaveLength(BUILTIN_AUTH_TEMPLATES.length);
    expect(rowPath).toEqual(RENDERED);
    expect(registryPath).toEqual(rowPath);
  });
});
