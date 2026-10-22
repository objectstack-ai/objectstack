// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25015] The sentences this service itself writes into a notification — the
 * catalog entries its renderer (`NotificationTextRenderer`, the
 * `EmitInput.keyedText` path) reads, per recipient and at delivery, in that
 * recipient's language.
 *
 * HAND-AUTHORED, in the shape `@objectstack/plugin-approvals` and
 * `@objectstack/plugin-audit` give their notification sentences: this bundle's
 * `messages` face, loaded into the `i18n` service with the rest of
 * `MessagingTranslations` (ADR-0029 D8), and read by
 * `t('messages.<id>', locale, params)`.
 *
 * Today that is one sentence: the heading of a digest of two or more items
 * (`digest-render.ts`). A one-item digest carries that item's own title, so
 * this heading is never rendered for fewer than two.
 *
 * ## Keeping the copy honest
 *
 * - Ids are single-segment: both `II18nService` implementations resolve a key
 *   by walking NESTED objects, so an id holding a dot would never resolve. The
 *   `messages` face is shared by every bundle loaded into the service, so an id
 *   names its subject (`notificationDigest…`), never a bare `title`.
 * - `en` IS the literal text. `digest-render.ts` builds the heading a recipient
 *   reads whenever the key cannot be rendered — no `i18n` service, no renderer
 *   composed, no entry in any locale it consults — by interpolating the `en`
 *   entry, so the English is one string whichever path delivered it, and it is
 *   byte for byte the heading every digest carried before it was keyed.
 * - Every locale carries every id with the same `{{holes}}`:
 *   `keyed-notification-text.integration.test.ts` pins both.
 *
 * ## The holes, and why there is no plural form
 *
 *  - `{{count}}` — the number of notifications the digest collapses, two or
 *    more.
 *
 * Neither `II18nService` implementation selects a plural form: `t()`
 * interpolates `{{name}}` holes and nothing else. None is needed for the
 * locales shipped here, because the count is always two or more, and in each
 * of them every count from two up takes ONE form (en and es-ES: the plural;
 * zh-CN and ja-JP: no plural inflection). A locale whose form varies above two
 * (Polish, Russian, Arabic) would need plural selection in the catalog, which
 * is the `i18n` service's to add, not this bundle's.
 */

import type { TranslationData } from '@objectstack/spec/system';

type Messages = NonNullable<TranslationData['messages']>;

/** The ids, as `en` spells them — every other locale carries exactly these. */
export const enMessages = {
    notificationDigestTitle: 'You have {{count}} notifications',
} as const satisfies Messages;

/** One messaging sentence's id. */
export type MessagingMessageId = keyof typeof enMessages;

type MessagingMessages = Readonly<Record<MessagingMessageId, string>>;

export const zhCNMessages: MessagingMessages = {
    notificationDigestTitle: '您有 {{count}} 条通知',
};

export const jaJPMessages: MessagingMessages = {
    notificationDigestTitle: '{{count}} 件の通知があります',
};

export const esESMessages: MessagingMessages = {
    notificationDigestTitle: 'Tiene {{count}} notificaciones',
};

/** The four shipped locales, keyed as the bundle beside this file keys them. */
export const messagingMessages: Readonly<Record<'en' | 'zh-CN' | 'ja-JP' | 'es-ES', MessagingMessages>> = {
    en: enMessages,
    'zh-CN': zhCNMessages,
    'ja-JP': jaJPMessages,
    'es-ES': esESMessages,
};
