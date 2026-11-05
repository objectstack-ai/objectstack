// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IEmailTransport } from '@objectstack/spec/contracts';
import { resolveLocale } from '@objectstack/core';
import { SmtpTransport } from './transports/smtp.js';
import { ResendTransport } from './transports/resend.js';
import { PostmarkTransport } from './transports/postmark.js';

/**
 * The statement Setup → Email makes about the LIVE transport. The page's form
 * shows what is stored, and that can differ from what is live: the out-of-the-box
 * `mail` namespace stores provider `smtp` with an empty host while every message
 * goes to the development log and is recorded as sent. The settings service
 * places this statement at the top of the page (`registerLiveStatus`).
 *
 * Same shape as service-settings' `SettingsLiveStatus`. It is restated here
 * because this plugin reaches the settings service through a structural surface
 * and takes no package dependency on it.
 */
export interface LiveMailTransportStatus {
  label: string;
  bannerText: string;
  bannerSeverity: 'info' | 'warning';
}

/** The part of `EmailService` the statement reads. */
export interface LiveMailTransportSource {
  /** `IEmailService.isConfigured`: does mail sent through the service get delivered? */
  isConfigured(): boolean;
  options: { transport: IEmailTransport };
}

/**
 * The words Setup → Email uses for the live transport and the "Send test
 * email" answer, one entry per language this plugin ships copy for.
 *
 * Kept here and not in a translation bundle: the sentences are composed per
 * request with the transport's name, the recipient and the message id, and the
 * console's banner lookup would replace a computed live-status text with a
 * fixed one (service-settings' `SETTINGS_LIVE_STATUS_BANNER_ID`). The settings
 * routes pass the caller's display language (`Accept-Language`, else
 * `?locale`); a language with no entry here is answered in English.
 */
export interface MailDeliveryCopy {
  hostTransport: string;
  noMailLabel: string;
  noMailText: string;
  deliveredLabel(name: string): string;
  deliveredText(name: string): string;
  /** "Send test email" succeeded; `via` names the form's transport when the test used it. */
  testSent(to: string, via: string | undefined, id: string): string;
  /** The transport refused or failed the test message, in its own words (`error`). */
  testFailed(via: string | undefined, error: string): string;
  /** The live transport is the development log, and the test used it. */
  testLoggedLive: string;
  /** The form's unsaved "None (log only)" was tested while `liveLabel` is live. */
  testLoggedForm(liveLabel: string): string;
}

export const MAIL_DELIVERY_COPY: Record<'en' | 'zh-CN', MailDeliveryCopy> = {
  en: {
    hostTransport: 'a transport supplied by the host application',
    noMailLabel: 'No mail leaves this machine',
    noMailText: 'The live transport is the development log. Every message this server sends '
      + '(invitations, password resets, notifications) is recorded in `sys_email` as sent, '
      + 'but none is delivered to anyone. To deliver mail, choose a provider below, complete '
      + 'its settings and save.',
    deliveredLabel: (name) => `Mail is delivered through ${name}`,
    deliveredText: (name) => `The live transport is ${name}. Messages this server sends are handed to it for `
      + 'delivery. A single send can still fail; "Send test email" below reports the provider\'s own answer.',
    testSent: (to, via, id) => `Sent test email to ${to}${via ? ` via ${via}` : ''} (id=${id}).`,
    testFailed: (via, error) => `Test send failed${via ? ` via ${via}` : ''}: ${error}`,
    testLoggedLive: 'No delivery transport is active — the message was only logged and kept in the email log. '
      + 'Configure an SMTP host (or an API provider) and save before testing.',
    testLoggedForm: (liveLabel) => 'Nothing was delivered — the provider on the form is "None (log only)", so the test '
      + 'message was only logged and kept in the email log; no mail left this machine. The live transport was '
      + `not used (${liveLabel}); save the form to stop delivery.`,
  },
  'zh-CN': {
    hostTransport: '宿主应用提供的投递方式',
    noMailLabel: '当前不会发出任何邮件',
    noMailText: '当前的投递方式是开发日志：服务器发出的每封邮件（邀请、密码重置、通知）都会记入邮件日志并标记为已发送，'
      + '但不会送达任何人。要真正投递邮件，请在下方选择服务商，填好其设置并保存。',
    deliveredLabel: (name) => `邮件通过 ${name} 投递`,
    deliveredText: (name) => `当前的投递方式是 ${name}，服务器发出的邮件会交给它投递。`
      + '单次发送仍可能失败；下方的「发送测试邮件」会显示服务商自己的答复。',
    testSent: (to, via, id) => `测试邮件已发送至 ${to}${via ? `，经由 ${via}` : ''}（id=${id}）。`,
    testFailed: (via, error) => `测试发送失败${via ? `（经由 ${via}）` : ''}：${error}`,
    testLoggedLive: '当前没有可用的投递方式：测试邮件只记入了日志，并保存在邮件日志中。'
      + '请先配置 SMTP 主机（或 API 服务商）并保存，再进行测试。',
    testLoggedForm: (liveLabel) => '没有投递任何邮件：表单上的服务商是「不发送(仅记录日志,不真正投递)」，'
      + '测试邮件只记入了日志并保存在邮件日志中，没有邮件发出本机。'
      + `本次测试没有使用当前的投递方式（${liveLabel}）；保存表单后将停止投递。`,
  },
};

const COPY_LOCALES = Object.keys(MAIL_DELIVERY_COPY);

/** The copy for a caller's display language: exact, then by language, else English. */
export function mailDeliveryCopy(locale: string | undefined): MailDeliveryCopy {
  const picked = locale ? resolveLocale(locale, COPY_LOCALES) : undefined;
  return MAIL_DELIVERY_COPY[(picked ?? 'en') as keyof typeof MAIL_DELIVERY_COPY];
}

/** A name an administrator recognises for the live transport. */
function transportName(transport: IEmailTransport, copy: MailDeliveryCopy): string {
  if (transport instanceof SmtpTransport) {
    const { host, port } = transport.describe() as { host?: unknown; port?: unknown };
    return `SMTP (${String(host)}:${String(port)})`;
  }
  if (transport instanceof ResendTransport) return 'Resend';
  if (transport instanceof PostmarkTransport) return 'Postmark';
  return copy.hostTransport;
}

/**
 * Describe the live transport from `isConfigured()`, read at call time, so the
 * statement follows a transport rebuilt from the `mail` namespace, in the
 * caller's display `locale` ({@link mailDeliveryCopy}).
 *
 * `isConfigured()` decides the branch: `false` means no mail leaves this machine,
 * whatever the form says. The transport is read only to name it.
 */
export function describeLiveMailTransport(
  source: LiveMailTransportSource,
  locale?: string,
): LiveMailTransportStatus {
  const copy = mailDeliveryCopy(locale);
  if (!source.isConfigured()) {
    return { label: copy.noMailLabel, bannerSeverity: 'warning', bannerText: copy.noMailText };
  }
  const name = transportName(source.options.transport, copy);
  return { label: copy.deliveredLabel(name), bannerSeverity: 'info', bannerText: copy.deliveredText(name) };
}
