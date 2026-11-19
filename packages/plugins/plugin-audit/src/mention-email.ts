// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An `@mention` also reaches the mentioned person by e-mail, beside the
 * in-app inbox (maintainer order, cloud seat 5 thread, 2026-11-17; the
 * approval e-mail is the precedent: `plugin-approvals/src/approval-email-templates.ts`).
 *
 * ## Which channels, and who can turn the e-mail off
 *
 * The mention writer (`audit-writers.ts`) emits `collab.mention` twice per
 * mentioned person, both through the ADR-0030 single ingress
 * (`messaging.emit`, ADR-0030 Decision §5 — never a side send):
 *
 *  1. the inbox notice, exactly as before: no `channels` (messaging's
 *     `['inbox']` default), deduplicated per comment and person;
 *  2. the e-mail: `channels: ['email']`, deduplicated per person and
 *     {@link MENTION_EMAIL_WINDOW_MS} window ({@link mentionEmailDedupKey}).
 *
 * Both name the topic `collab.mention`, so `sys_notification_preference`
 * filters the e-mail like any channel: a person's `(collab.mention, email,
 * enabled: false)` row — or `(*, email)` — mutes the e-mail and leaves the
 * inbox notice. The e-mail is on by default because the preference matrix is
 * on by default.
 *
 * ## The burst bound — why two emits and not one
 *
 * A comment thread can mention one person many times in a few minutes, and
 * on hosted deployments platform-sent mail counts against a daily cap. The
 * bound reuses the one durable, cluster-safe claim messaging already has: an
 * event's `dedup_key` (unique on `sys_notification`; a repeat `emit` with the
 * same key is a no-op). The inbox must stay one notice per comment and the
 * e-mail one per window, so they need two keys, and one event holds one key —
 * hence a second, e-mail-only emit. The first mention of a person in a window
 * sends the e-mail; every later one in the same window is inbox-only.
 *
 * The window is a fixed, clock-aligned bucket of {@link MENTION_EMAIL_WINDOW_MS}
 * (10 minutes: :00, :10, :20 …, UTC epoch), per person and organization. So a
 * person receives at most one mention e-mail per bucket — at most two in any
 * ten minutes when a burst straddles a bucket edge, at most 144 a day.
 *
 * ## What the e-mail says
 *
 * A code-declared template per catalog locale, registered with the messaging
 * service (`registerBuiltinTemplates`) and rendered beneath an organization's
 * own `sys_notification_template` row, so an organization that authors one
 * overrides it. Nothing is stored (ADR-0131 §1.4).
 *
 *  - subject: the notification's title (`messages.mentionedYou`, already in
 *    the mentioned person's language); body: the comment's preview, then one
 *    line that opens the record, in each language the plugin-audit message
 *    catalog carries (`translations/messages.ts`).
 *  - the link is the payload's `mentionUrl`: the record the comment is on,
 *    `/{object}/{id}` (the inbox notice's own link, ADR-0030 L5) as a Console
 *    page under the deployment's address — composed by the auth service's
 *    `getConsoleUrl`, the one composer of Console page links in mail. With no
 *    auth service the link stays relative.
 *  - ⛔ No token in the link: it opens the record for a signed-in reader, and
 *    a notification payload is kept at rest.
 *  - plain text: a mail client turns the bare URL into a link, and a text body
 *    has no markup for a comment's text to break.
 */

/** The mention topic both emits name. */
export const MENTION_TOPIC = 'collab.mention';

/** The channel the second emit requests. */
export const MENTION_EMAIL_CHANNEL = 'email';

/** The burst window: at most one mention e-mail per person per bucket of this length. */
export const MENTION_EMAIL_WINDOW_MS = 10 * 60_000;

/**
 * The e-mail emit's dedup key: one per (organization, person, window bucket).
 * `nowMs` is the emit's clock reading.
 */
export function mentionEmailDedupKey(organizationId: string | null | undefined, userId: string, nowMs: number): string {
  const bucket = Math.floor(nowMs / MENTION_EMAIL_WINDOW_MS);
  return `${MENTION_TOPIC}.email:${organizationId ?? '-'}:${userId}:${bucket}`;
}

/**
 * The line that opens the record, per locale the plugin-audit message catalog
 * carries (`translations/messages.ts`). `{{mentionUrl}}` is the payload member.
 */
export const MENTION_EMAIL_LINK_LINES: Readonly<Record<'en' | 'zh-CN' | 'ja-JP' | 'es-ES' | 'zh-Hant' | 'ar' | 'fr' | 'pt-BR' | 'ru' | 'de' | 'ko', string>> = {
  en: 'Open the comment: {{mentionUrl}}',
  'zh-CN': '查看评论：{{mentionUrl}}',
  'ja-JP': 'コメントを開く: {{mentionUrl}}',
  'es-ES': 'Abrir el comentario: {{mentionUrl}}',
  'zh-Hant': '查看留言：{{mentionUrl}}',
  ar: 'افتح التعليق: {{mentionUrl}}',
  fr: 'Ouvrir le commentaire : {{mentionUrl}}',
  'pt-BR': 'Abrir o comentário: {{mentionUrl}}',
  ru: 'Открыть комментарий: {{mentionUrl}}',
  de: 'Kommentar öffnen: {{mentionUrl}}',
  ko: '댓글 열기: {{mentionUrl}}',
};

/**
 * Structural view of `BuiltinNotificationTemplate` (service-messaging),
 * declared locally so plugin-audit takes no runtime dependency on it — the
 * same rationale as `MessagingEmitSurface`.
 */
export interface MentionBuiltinTemplate {
  readonly topic: string;
  readonly channel: string;
  readonly locale: string;
  readonly subject?: string;
  readonly body?: string;
  readonly format?: 'markdown' | 'html' | 'text' | 'mjml';
}

/** The mention e-mail templates: one per catalog locale. */
export const MENTION_EMAIL_TEMPLATES: readonly MentionBuiltinTemplate[] = Object.freeze(
  Object.entries(MENTION_EMAIL_LINK_LINES).map(([locale, line]) => ({
    topic: MENTION_TOPIC,
    channel: MENTION_EMAIL_CHANNEL,
    locale,
    subject: '{{title}}',
    body: `{{body}}\n\n${line}`,
    format: 'text' as const,
  })),
);
