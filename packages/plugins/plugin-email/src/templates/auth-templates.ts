// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { EmailTemplateDefinition as EmailTemplate } from '@objectstack/spec/system';

/**
 * Built-in auth email templates seeded into `sys_email_template` on
 * EmailServicePlugin startup. Each template is `isSystem: true` so
 * tenants may overlay subject/body but should not delete the row.
 *
 * Templates use `{{path.to.value}}` placeholders; `{{{...}}}` for
 * unescaped URLs (see template-engine.ts).
 *
 * Authoring conventions:
 * - Subject: plain, max ~80 chars, no markup.
 * - HTML body: single column, ~600px max width, inline styles only
 *   (most clients strip <head>).
 * - Always include a plain-text fallback (good for spam scoring).
 * - Provide an `{{appName}}` variable everywhere for brand override.
 */

const baseStyles = 'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#1f2937';
const buttonStyles = 'display:inline-block;padding:12px 24px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600';
const footerStyles = 'margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px';

const DEFAULT_FOOTER = `You received this email because of activity on your {{appName}} account.<br>
If this wasn't you, you can safely ignore this message.`;

/**
 * `footerHtml` overrides the default footer. Two templates need that: any
 * non-`en-US` row (the default footer is English prose, and a localized body
 * under an English footer is the mixed-language artefact `email-service.ts`'s
 * locale ladder exists to prevent), and the change-email notice — whose whole
 * point is that ignoring it is NOT safe, so "you can safely ignore this
 * message" would contradict the body it sits under.
 */
function wrap(title: string, bodyHtml: string, footerHtml: string = DEFAULT_FOOTER): string {
  return `<!doctype html><html><body style="${baseStyles};margin:0;padding:24px;background:#f9fafb">
<div style="max-width:560px;margin:0 auto;background:#ffffff;padding:32px;border-radius:8px;border:1px solid #e5e7eb">
<h1 style="margin:0 0 16px 0;font-size:20px;font-weight:600">${title}</h1>
${bodyHtml}
<div style="${footerStyles}">
${footerHtml}
</div>
</div></body></html>`;
}

export const AUTH_PASSWORD_RESET_TEMPLATE: EmailTemplate = {
  name: 'auth.password_reset',
  label: 'Password Reset',
  category: 'auth',
  locale: 'en-US',
  subject: 'Reset your {{appName}} password',
  bodyHtml: wrap('Reset your password', `
<p>Hi {{user.name}},</p>
<p>We received a request to reset the password for the account associated with <strong>{{user.email}}</strong>.</p>
<p>Click the button below to choose a new password. This link expires in {{expiresInMinutes}} minutes.</p>
<p style="margin:24px 0"><a href="{{{resetUrl}}}" style="${buttonStyles}">Reset password</a></p>
<p style="font-size:13px;color:#6b7280">Or copy and paste this URL into your browser:<br><span style="word-break:break-all">{{resetUrl}}</span></p>
<p>If you didn't request this, no action is needed — your password stays the same.</p>
`),
  bodyText: `Hi {{user.name}},

We received a request to reset the password for {{user.email}}.

Reset your password (link expires in {{expiresInMinutes}} minutes):
{{resetUrl}}

If you didn't request this, ignore this email.`,
  variables: [
    { name: 'user.name', type: 'string', required: false, description: 'Recipient display name' },
    { name: 'user.email', type: 'string', required: true, description: 'Recipient email' },
    { name: 'resetUrl', type: 'url', required: true, description: 'Password reset URL' },
    { name: 'expiresInMinutes', type: 'number', required: false, description: 'Link TTL in minutes' },
    { name: 'appName', type: 'string', required: false, description: 'Product/app name (brand override)' },
  ],
  active: true,
  isSystem: true,
  description: 'Sent when a user requests a password reset via better-auth.',
};

export const AUTH_VERIFY_EMAIL_TEMPLATE: EmailTemplate = {
  name: 'auth.verify_email',
  label: 'Verify Email Address',
  category: 'auth',
  locale: 'en-US',
  subject: 'Verify your {{appName}} email address',
  bodyHtml: wrap('Verify your email', `
<p>Hi {{user.name}},</p>
<p>Thanks for signing up for {{appName}}! Please confirm <strong>{{user.email}}</strong> belongs to you.</p>
<p style="margin:24px 0"><a href="{{{verificationUrl}}}" style="${buttonStyles}">Verify email</a></p>
<p style="font-size:13px;color:#6b7280">Or copy and paste this URL into your browser:<br><span style="word-break:break-all">{{verificationUrl}}</span></p>
`),
  bodyText: `Hi {{user.name}},

Please verify your email ({{user.email}}) by opening this link:
{{verificationUrl}}`,
  variables: [
    { name: 'user.name', type: 'string', required: false },
    { name: 'user.email', type: 'string', required: true },
    { name: 'verificationUrl', type: 'url', required: true },
    { name: 'appName', type: 'string', required: false },
  ],
  active: true,
  isSystem: true,
  description: 'Sent when better-auth needs to verify a newly-registered email address.',
};

export const AUTH_MAGIC_LINK_TEMPLATE: EmailTemplate = {
  name: 'auth.magic_link',
  label: 'Magic Link Sign-In',
  category: 'auth',
  locale: 'en-US',
  subject: 'Your {{appName}} sign-in link',
  bodyHtml: wrap('Sign in to {{appName}}', `
<p>Click the button below to sign in. This link expires in {{expiresInMinutes}} minutes and may only be used once.</p>
<p style="margin:24px 0"><a href="{{{magicLinkUrl}}}" style="${buttonStyles}">Sign in</a></p>
<p style="font-size:13px;color:#6b7280">Or paste:<br><span style="word-break:break-all">{{magicLinkUrl}}</span></p>
`),
  bodyText: `Sign in to {{appName}} (expires in {{expiresInMinutes}} min):
{{magicLinkUrl}}`,
  variables: [
    { name: 'magicLinkUrl', type: 'url', required: true },
    { name: 'expiresInMinutes', type: 'number', required: false },
    { name: 'appName', type: 'string', required: false },
  ],
  active: true,
  isSystem: true,
  description: 'Passwordless sign-in link sent by the magic-link plugin.',
};

export const AUTH_INVITATION_TEMPLATE: EmailTemplate = {
  name: 'auth.invitation',
  label: 'Organization Invitation',
  category: 'auth',
  locale: 'en-US',
  subject: '{{inviter.name}} invited you to {{organization.name}}',
  bodyHtml: wrap('You have been invited', `
<p><strong>{{inviter.name}}</strong> ({{inviter.email}}) has invited you to join <strong>{{organization.name}}</strong> on {{appName}} as <em>{{role}}</em>.</p>
<p style="margin:24px 0"><a href="{{{acceptUrl}}}" style="${buttonStyles}">Accept invitation</a></p>
<p style="font-size:13px;color:#6b7280">Or paste:<br><span style="word-break:break-all">{{acceptUrl}}</span></p>
`),
  bodyText: `{{inviter.name}} ({{inviter.email}}) invited you to join {{organization.name}} on {{appName}}.

Accept: {{acceptUrl}}`,
  variables: [
    { name: 'inviter.name', type: 'string', required: false },
    { name: 'inviter.email', type: 'string', required: false },
    { name: 'organization.name', type: 'string', required: true },
    { name: 'role', type: 'string', required: false },
    { name: 'acceptUrl', type: 'url', required: true },
    { name: 'appName', type: 'string', required: false },
  ],
  active: true,
  isSystem: true,
  description: 'Sent by better-auth organization plugin when a user is invited to an org.',
};

export const AUTH_TWO_FACTOR_OTP_TEMPLATE: EmailTemplate = {
  name: 'auth.two_factor_otp',
  label: 'Two-Factor Verification Code',
  category: 'auth',
  locale: 'en-US',
  subject: 'Your {{appName}} verification code',
  bodyHtml: wrap('Your verification code', `
<p>Use this code to complete sign-in:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:6px;background:#f3f4f6;padding:16px;text-align:center;border-radius:6px;margin:24px 0">{{otp}}</p>
<p style="color:#6b7280;font-size:13px">This code expires in {{expiresInMinutes}} minutes. If you didn't try to sign in, change your password — your account may be at risk.</p>
`),
  bodyText: `Your {{appName}} verification code: {{otp}}
(expires in {{expiresInMinutes}} minutes)`,
  variables: [
    { name: 'otp', type: 'string', required: true },
    { name: 'expiresInMinutes', type: 'number', required: false },
    { name: 'appName', type: 'string', required: false },
  ],
  active: true,
  isSystem: true,
  description: 'Time-based OTP delivered for two-factor / email-OTP login.',
};

// ───────────────────────────────────────────────────────────────────────────
// auth.email_change_notice — the OLD address's notice (#8019)
// ───────────────────────────────────────────────────────────────────────────
/**
 * Sent to the address an account is being moved AWAY from, the moment
 * `POST /change-email` is accepted. Maintainer ruling 2026-08-12: **notify the
 * old address, do not gate on it** — the change still completes on the NEW
 * address's verification alone, so this mail is a notification and never a
 * step in the flow.
 *
 * Three constraints the wording is bound by, all from that ruling:
 *
 *  - ⛔ **No undo / rollback link.** A one-click revert is a new flow and a new
 *    decision; the notice states the change and hands the reader a support
 *    path, nothing more. The support path is deliberately a *person*
 *    ("contact your administrator"), not a `{{supportUrl}}` hole: no
 *    platform-level support URL exists to fill it, and the template engine has
 *    no conditionals (`template-engine.ts` — no loops, no conditionals, no
 *    partials), so an unfilled optional URL would render as a dangling empty
 *    line in every deployment that never configured one.
 *  - It describes the change as **requested and pending**, because that is
 *    when this mail is sent. The only non-gating seam better-auth 1.7.0-rc.2
 *    offers is request time (see the `changeEmail` config site in
 *    `auth-manager.ts` for the measurement); wording it "your email WAS
 *    changed" would be false for every request nobody ever confirms.
 *  - The footer is overridden: the default one ends "you can safely ignore
 *    this message", which is the opposite of true here.
 *
 * `{{user.email}}` is the RECIPIENT — the old address, still the account's
 * email at send time — and `{{newEmail}}` the address it would move to.
 */
const EMAIL_CHANGE_NOTICE_VARIABLES: EmailTemplate['variables'] = [
  { name: 'user.name', type: 'string', required: false, description: 'Recipient display name' },
  { name: 'user.email', type: 'string', required: true, description: 'The CURRENT (old) account email — the recipient' },
  { name: 'newEmail', type: 'string', required: true, description: 'The address the account would move to' },
  { name: 'appName', type: 'string', required: false, description: 'Product/app name (brand override)' },
];

export const AUTH_EMAIL_CHANGE_NOTICE_TEMPLATE: EmailTemplate = {
  name: 'auth.email_change_notice',
  label: 'Email Change Notice (previous address)',
  category: 'auth',
  locale: 'en-US',
  subject: 'Security notice: the email address on your {{appName}} account is being changed',
  bodyHtml: wrap(
    'Your account email is being changed',
    `
<p>Hi {{user.name}},</p>
<p>A signed-in session on your {{appName}} account requested to change the account email address from <strong>{{user.email}}</strong> to <strong>{{newEmail}}</strong>.</p>
<p>The change takes effect once <strong>{{newEmail}}</strong> is verified. You do not need to do anything to allow it — this message is a notification, not an approval request.</p>
<p style="margin:24px 0;padding:16px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:4px"><strong>If you did not request this, your account may be compromised.</strong> Contact your {{appName}} administrator or support team immediately, and change your password to end other sessions.</p>
`,
    'You received this email because the address on your {{appName}} account is being changed.<br>This notice was sent to the previous address on the account.',
  ),
  bodyText: `Hi {{user.name}},

A signed-in session on your {{appName}} account requested to change the account
email address from {{user.email}} to {{newEmail}}.

The change takes effect once {{newEmail}} is verified. You do not need to do
anything to allow it — this message is a notification, not an approval request.

If you did not request this, your account may be compromised. Contact your
{{appName}} administrator or support team immediately, and change your password
to end other sessions.`,
  variables: EMAIL_CHANGE_NOTICE_VARIABLES,
  active: true,
  isSystem: true,
  description: 'Sent to the PREVIOUS address when a change-email request is accepted (#8019). Notification only — never gates the change.',
};

export const AUTH_EMAIL_CHANGE_NOTICE_TEMPLATE_ZH_CN: EmailTemplate = {
  ...AUTH_EMAIL_CHANGE_NOTICE_TEMPLATE,
  locale: 'zh-CN',
  label: '邮箱变更通知（原地址）',
  subject: '安全通知：您的 {{appName}} 账号邮箱正在被变更',
  bodyHtml: wrap(
    '您的账号邮箱正在被变更',
    `
<p>{{user.name}} 您好：</p>
<p>您的 {{appName}} 账号上有一个已登录会话请求将账号邮箱从 <strong>{{user.email}}</strong> 变更为 <strong>{{newEmail}}</strong>。</p>
<p>该变更将在 <strong>{{newEmail}}</strong> 完成验证后生效。您无需做任何操作即可放行——本邮件仅为通知，不是审批请求。</p>
<p style="margin:24px 0;padding:16px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:4px"><strong>如果这不是您本人的操作，您的账号可能已被入侵。</strong>请立即联系您的 {{appName}} 管理员或支持团队，并修改密码以结束其他会话。</p>
`,
    '您收到本邮件，是因为您的 {{appName}} 账号邮箱正在被变更。<br>本通知已发送至账号变更前的邮箱地址。',
  ),
  bodyText: `{{user.name}} 您好：

您的 {{appName}} 账号上有一个已登录会话请求将账号邮箱从 {{user.email}}
变更为 {{newEmail}}。

该变更将在 {{newEmail}} 完成验证后生效。您无需做任何操作即可放行——本邮件仅为
通知，不是审批请求。

如果这不是您本人的操作，您的账号可能已被入侵。请立即联系您的 {{appName}} 管理员
或支持团队，并修改密码以结束其他会话。`,
  description: '在接受变更邮箱请求时发送至原邮箱地址（#8019）。仅为通知，绝不阻断变更流程。',
};

export const AUTH_EMAIL_CHANGE_NOTICE_TEMPLATE_JA_JP: EmailTemplate = {
  ...AUTH_EMAIL_CHANGE_NOTICE_TEMPLATE,
  locale: 'ja-JP',
  label: 'メールアドレス変更のお知らせ（変更前のアドレス）',
  subject: 'セキュリティ通知: {{appName}} アカウントのメールアドレスが変更されようとしています',
  bodyHtml: wrap(
    'アカウントのメールアドレスが変更されようとしています',
    `
<p>{{user.name}} 様</p>
<p>{{appName}} アカウントにログイン中のセッションから、アカウントのメールアドレスを <strong>{{user.email}}</strong> から <strong>{{newEmail}}</strong> へ変更する要求がありました。</p>
<p>この変更は <strong>{{newEmail}}</strong> の確認が完了した時点で有効になります。許可するために必要な操作はありません。本メールは通知であり、承認の依頼ではありません。</p>
<p style="margin:24px 0;padding:16px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:4px"><strong>心当たりがない場合、アカウントが不正利用されている可能性があります。</strong>直ちに {{appName}} の管理者またはサポートへご連絡のうえ、パスワードを変更して他のセッションを終了してください。</p>
`,
    '{{appName}} アカウントのメールアドレスが変更されようとしているため、本メールをお送りしています。<br>この通知は変更前のアドレス宛に送信されました。',
  ),
  bodyText: `{{user.name}} 様

{{appName}} アカウントにログイン中のセッションから、アカウントのメールアドレスを
{{user.email}} から {{newEmail}} へ変更する要求がありました。

この変更は {{newEmail}} の確認が完了した時点で有効になります。許可するために必要な
操作はありません。本メールは通知であり、承認の依頼ではありません。

心当たりがない場合、アカウントが不正利用されている可能性があります。直ちに
{{appName}} の管理者またはサポートへご連絡のうえ、パスワードを変更して他の
セッションを終了してください。`,
  description: '変更メールの要求が受理された際に変更前のアドレスへ送信されます（#8019）。通知のみで、変更を妨げることはありません。',
};

export const AUTH_EMAIL_CHANGE_NOTICE_TEMPLATE_ES_ES: EmailTemplate = {
  ...AUTH_EMAIL_CHANGE_NOTICE_TEMPLATE,
  locale: 'es-ES',
  label: 'Aviso de cambio de correo (dirección anterior)',
  subject: 'Aviso de seguridad: se está cambiando el correo de tu cuenta de {{appName}}',
  bodyHtml: wrap(
    'Se está cambiando el correo de tu cuenta',
    `
<p>Hola {{user.name}}:</p>
<p>Una sesión iniciada en tu cuenta de {{appName}} ha solicitado cambiar la dirección de correo de la cuenta de <strong>{{user.email}}</strong> a <strong>{{newEmail}}</strong>.</p>
<p>El cambio se aplicará cuando se verifique <strong>{{newEmail}}</strong>. No necesitas hacer nada para permitirlo: este mensaje es una notificación, no una solicitud de aprobación.</p>
<p style="margin:24px 0;padding:16px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:4px"><strong>Si no has solicitado este cambio, tu cuenta podría estar comprometida.</strong> Ponte en contacto de inmediato con el administrador o el equipo de soporte de {{appName}} y cambia tu contraseña para cerrar las demás sesiones.</p>
`,
    'Recibes este correo porque se está cambiando la dirección de tu cuenta de {{appName}}.<br>Este aviso se ha enviado a la dirección anterior de la cuenta.',
  ),
  bodyText: `Hola {{user.name}}:

Una sesión iniciada en tu cuenta de {{appName}} ha solicitado cambiar la
dirección de correo de la cuenta de {{user.email}} a {{newEmail}}.

El cambio se aplicará cuando se verifique {{newEmail}}. No necesitas hacer nada
para permitirlo: este mensaje es una notificación, no una solicitud de
aprobación.

Si no has solicitado este cambio, tu cuenta podría estar comprometida. Ponte en
contacto de inmediato con el administrador o el equipo de soporte de {{appName}}
y cambia tu contraseña para cerrar las demás sesiones.`,
  description: 'Se envía a la dirección ANTERIOR cuando se acepta una solicitud de cambio de correo (#8019). Solo notificación; nunca bloquea el cambio.',
};

/**
 * Every locale row of the change-email notice, in one list so the
 * `(name, locale)` set is enumerable rather than re-derived per call site.
 */
export const AUTH_EMAIL_CHANGE_NOTICE_TEMPLATES: EmailTemplate[] = [
  AUTH_EMAIL_CHANGE_NOTICE_TEMPLATE,
  AUTH_EMAIL_CHANGE_NOTICE_TEMPLATE_ZH_CN,
  AUTH_EMAIL_CHANGE_NOTICE_TEMPLATE_JA_JP,
  AUTH_EMAIL_CHANGE_NOTICE_TEMPLATE_ES_ES,
];

export const BUILTIN_AUTH_TEMPLATES: EmailTemplate[] = [
  AUTH_PASSWORD_RESET_TEMPLATE,
  AUTH_VERIFY_EMAIL_TEMPLATE,
  AUTH_MAGIC_LINK_TEMPLATE,
  AUTH_INVITATION_TEMPLATE,
  AUTH_TWO_FACTOR_OTP_TEMPLATE,
  ...AUTH_EMAIL_CHANGE_NOTICE_TEMPLATES,
];
