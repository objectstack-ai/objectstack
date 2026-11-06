// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { ApprovalBuiltinTemplate } from './approval-service.js';

/**
 * [#30509] Which approval notices also go by e-mail, and what that e-mail
 * says (objectstack-ai/cloud#2549 ruling B, item ②; the template's location
 * is the ruling recorded on #30509).
 *
 * ## Which notices
 *
 * The request's own lifecycle: a step opened on an approver
 * (`approval.requested`), the submitter's reminder (`approval.reminder`), and
 * the outcome (`approval.approved` / `approval.rejected`). Each requests the
 * `inbox` and `email` channels in ONE emit, so the in-app inbox is what it
 * always was and a recipient's delivery preferences filter the e-mail like
 * any channel. Every other `approval.*` topic stays inbox-only.
 *
 * ## What the e-mail says
 *
 * A code-declared notification template per topic and locale, registered with
 * the messaging service (`registerBuiltinTemplates`) and rendered beneath an
 * organization's own `sys_notification_template` row, so an organization that
 * authors one overrides it. Nothing is stored (ADR-0131 §1.4).
 *
 *  - subject: the notification's title; body: its body, then one line that
 *    opens the request. Title and body are the text the recipient reads in
 *    the inbox, rendered in their language (#24978) — this file adds only the
 *    link line, in each language the approval catalog carries.
 *  - the link is the payload's `approvalUrl`: the request page under the
 *    deployment's public origin (`publicBaseUrl`, else `OS_AUTH_URL` /
 *    `OS_BASE_URL`; relative when none resolves — `public-base-url.ts`).
 *  - ⛔ No ADR-0043 action link and no token: the link opens the request page
 *    for a signed-in reader and decides nothing (#24564: a notification
 *    payload is kept at rest, so it carries no bearer credential).
 *  - plain text: a mail client turns the bare URL into a link, and a text
 *    body has no markup for a record title to break.
 */

/** The topics whose notices also go by e-mail. */
export const EMAILED_APPROVAL_TOPICS: ReadonlySet<string> = new Set([
  'approval.requested',
  'approval.reminder',
  'approval.approved',
  'approval.rejected',
]);

/** The channels those notices request. */
export const APPROVAL_EMAIL_CHANNELS: readonly string[] = Object.freeze(['inbox', 'email']);

/**
 * The line that opens the request, per locale the approval catalog carries
 * (`translations/messages.ts`). `{{approvalUrl}}` is the payload member.
 */
export const APPROVAL_EMAIL_LINK_LINES: Readonly<Record<'en' | 'zh-CN' | 'ja-JP' | 'es-ES' | 'zh-Hant' | 'ar' | 'fr' | 'pt-BR' | 'ru' | 'de' | 'ko', string>> = {
  en: 'Open the approval: {{approvalUrl}}',
  'zh-CN': '打开审批：{{approvalUrl}}',
  'ja-JP': '承認を開く: {{approvalUrl}}',
  'es-ES': 'Abrir la aprobación: {{approvalUrl}}',
  'zh-Hant': '開啟核准：{{approvalUrl}}',
  ar: 'افتح الموافقة: {{approvalUrl}}',
  fr: 'Ouvrir l’approbation : {{approvalUrl}}',
  'pt-BR': 'Abrir a aprovação: {{approvalUrl}}',
  ru: 'Открыть согласование: {{approvalUrl}}',
  de: 'Genehmigung öffnen: {{approvalUrl}}',
  ko: '승인 열기: {{approvalUrl}}',
};

/** The e-mail templates: every emailed topic in every catalog locale. */
export const APPROVAL_EMAIL_TEMPLATES: readonly ApprovalBuiltinTemplate[] = Object.freeze(
  [...EMAILED_APPROVAL_TOPICS].flatMap((topic) =>
    Object.entries(APPROVAL_EMAIL_LINK_LINES).map(([locale, line]) => ({
      topic,
      channel: 'email',
      locale,
      subject: '{{title}}',
      body: `{{body}}\n\n${line}`,
      format: 'text' as const,
    })),
  ),
);
