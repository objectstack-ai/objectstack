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
 * Three kinds today: the heading of a digest of two or more items
 * (`digest-render.ts`; a one-item digest carries that item's own title, so
 * this heading is never rendered for fewer than two), the notice a person
 * gets when an administrator removes their Slack link (`slack-links.ts`,
 * holes `{{workspace}}`: the Slack workspace's name), and the refusal a person
 * gets when they confirm a Slack link proposal that no longer holds
 * (`slackLinkProposalOutdated`, answered by the Slack link doors as the
 * envelope's `userMessage` in the caller's language; `en` is its `message`).
 * [#35402] A fourth, produced outside this service: the title a new owner
 * reads when a record (`recordOwnerChangedTitle`) or several
 * (`recordsOwnerChangedTitle`) are handed to them with Change Owner, topic
 * `record.owner_changed` (holes `{{object}}`, the object's label in the
 * recipient's language, and `{{count}}`, two or more). Russian and Arabic word
 * the plural count-neutrally, as a tally after a colon, for the reason below.
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
 * interpolates `{{name}}` holes and nothing else. The count is always two or
 * more, and in most shipped locales every count from two up takes ONE form
 * (en, es-ES, fr, pt-BR, de: the plural; zh-CN, zh-Hant, ja-JP, ko: no plural
 * inflection). Russian and Arabic do vary above two (ru: 2–4 vs 5+; ar: 3–10
 * vs 11+), so their sentences are worded count-neutrally — the number stands
 * after a colon as a tally (`Уведомлений: {{count}}`, `عدد الإشعارات لديك:
 * {{count}}`), which reads correctly for every count without choosing a noun
 * form (#30512). A sentence that cannot be phrased that way needs plural
 * selection in the catalog, which is the `i18n` service's to add, not this
 * bundle's.
 */

import type { TranslationData } from '@objectstack/spec/system';
import { CHANGE_OWNER_NOTIFICATION_TEXT } from '@objectstack/core';

type Messages = NonNullable<TranslationData['messages']>;

/** The ids, as `en` spells them — every other locale carries exactly these. */
export const enMessages = {
    notificationDigestTitle: 'You have {{count}} notifications',
    slackLinkRemovedTitle: 'Your Slack link was removed',
    slackLinkRemovedBody: 'An administrator removed the link between your account and your Slack user in {{workspace}}. Notifications no longer reach you on Slack; you can connect again from your notification settings.',
    slackLinkProposalOutdated: 'Your email is no longer verified, or is not the email this Slack link was proposed for: ask for a new proposal. Nothing was changed.',
    // [#35402] The Change Owner notice's title, produced by `@objectstack/core`
    // (`changeRecordOwner` / `changeRecordsOwner`), which loads no bundle of
    // its own: the English is core's own literal, so the two cannot drift.
    ...CHANGE_OWNER_NOTIFICATION_TEXT,
} as const satisfies Messages;

/** One messaging sentence's id. */
export type MessagingMessageId = keyof typeof enMessages;

type MessagingMessages = Readonly<Record<MessagingMessageId, string>>;

export const zhCNMessages: MessagingMessages = {
    notificationDigestTitle: '您有 {{count}} 条通知',
    slackLinkRemovedTitle: '您的 Slack 关联已被移除',
    slackLinkRemovedBody: '管理员移除了您的账户与 {{workspace}} 中您的 Slack 用户之间的关联。通知将不再通过 Slack 发送给您；您可以在通知设置中重新关联。',
    slackLinkProposalOutdated: '您的邮箱已不再经过验证，或已不是提议此 Slack 关联时使用的邮箱：请重新获取提议。未作任何更改。',
    recordOwnerChangedTitle: '您现在是这条{{object}}记录的负责人',
    recordsOwnerChangedTitle: '您现在是 {{count}} 条{{object}}记录的负责人',
};

export const jaJPMessages: MessagingMessages = {
    notificationDigestTitle: '{{count}} 件の通知があります',
    slackLinkRemovedTitle: 'Slack の連携が解除されました',
    slackLinkRemovedBody: '管理者が、あなたのアカウントと {{workspace}} のあなたの Slack ユーザーとの連携を解除しました。今後、通知は Slack に届きません。通知設定から再度連携できます。',
    slackLinkProposalOutdated: 'メールアドレスが確認済みではなくなったか、この Slack 連携が提案されたときのメールアドレスではありません。新しい提案を取得してください。変更は行われていません。',
    recordOwnerChangedTitle: 'この{{object}}レコードの所有者になりました',
    recordsOwnerChangedTitle: '{{count}} 件の{{object}}レコードの所有者になりました',
};

export const esESMessages: MessagingMessages = {
    notificationDigestTitle: 'Tiene {{count}} notificaciones',
    slackLinkRemovedTitle: 'Se ha eliminado su vínculo con Slack',
    slackLinkRemovedBody: 'Un administrador ha eliminado el vínculo entre su cuenta y su usuario de Slack en {{workspace}}. Las notificaciones ya no le llegarán por Slack; puede volver a conectarse desde la configuración de notificaciones.',
    slackLinkProposalOutdated: 'Su correo electrónico ya no está verificado o no es el correo para el que se propuso este vínculo con Slack: solicite una nueva propuesta. No se ha cambiado nada.',
    recordOwnerChangedTitle: 'Ahora es el propietario de este registro de {{object}}',
    recordsOwnerChangedTitle: 'Ahora es el propietario de {{count}} registros de {{object}}',
};

export const zhHantMessages: MessagingMessages = {
    notificationDigestTitle: '您有 {{count}} 則通知',
    slackLinkRemovedTitle: '您的 Slack 連結已被移除',
    slackLinkRemovedBody: '管理員移除了您的帳戶與 {{workspace}} 中您的 Slack 使用者之間的連結。通知將不再透過 Slack 傳送給您；您可以在通知設定中重新連結。',
    slackLinkProposalOutdated: '您的電子郵件已不再經過驗證，或已不是提議此 Slack 連結時使用的電子郵件：請重新取得提議。未進行任何變更。',
    recordOwnerChangedTitle: '您現在是這筆{{object}}記錄的負責人',
    recordsOwnerChangedTitle: '您現在是 {{count}} 筆{{object}}記錄的負責人',
};

export const arMessages: MessagingMessages = {
    notificationDigestTitle: 'عدد الإشعارات لديك: {{count}}',
    slackLinkRemovedTitle: 'تمت إزالة ربط Slack الخاص بك',
    slackLinkRemovedBody: 'أزال أحد المسؤولين الربط بين حسابك ومستخدم Slack الخاص بك في {{workspace}}. لن تصلك الإشعارات بعد الآن على Slack؛ ويمكنك الربط مرة أخرى من إعدادات الإشعارات.',
    slackLinkProposalOutdated: 'لم يعد بريدك الإلكتروني موثَّقًا، أو لم يعد البريد الذي اقتُرح له ربط Slack هذا: اطلب اقتراحًا جديدًا. لم يتم تغيير أي شيء.',
    recordOwnerChangedTitle: 'أصبحت الآن مالك هذا السجل ({{object}})',
    recordsOwnerChangedTitle: 'السجلات التي أصبحت مالكها ({{object}}): {{count}}',
};

export const frMessages: MessagingMessages = {
    notificationDigestTitle: 'Vous avez {{count}} notifications',
    slackLinkRemovedTitle: 'Votre lien Slack a été supprimé',
    slackLinkRemovedBody: 'Un administrateur a supprimé le lien entre votre compte et votre utilisateur Slack dans {{workspace}}. Les notifications ne vous parviennent plus sur Slack ; vous pouvez vous reconnecter depuis vos paramètres de notification.',
    slackLinkProposalOutdated: 'Votre adresse e-mail n’est plus vérifiée, ou n’est pas celle pour laquelle ce lien Slack a été proposé : demandez une nouvelle proposition. Rien n’a été modifié.',
    recordOwnerChangedTitle: 'Vous êtes désormais propriétaire de cet enregistrement {{object}}',
    recordsOwnerChangedTitle: 'Vous êtes désormais propriétaire de {{count}} enregistrements {{object}}',
};

export const ptBRMessages: MessagingMessages = {
    notificationDigestTitle: 'Você tem {{count}} notificações',
    slackLinkRemovedTitle: 'Seu vínculo com o Slack foi removido',
    slackLinkRemovedBody: 'Um administrador removeu o vínculo entre sua conta e seu usuário do Slack em {{workspace}}. As notificações não chegarão mais a você pelo Slack; você pode se conectar novamente nas configurações de notificação.',
    slackLinkProposalOutdated: 'Seu e-mail não está mais verificado ou não é o e-mail para o qual este vínculo com o Slack foi proposto: solicite uma nova proposta. Nada foi alterado.',
    recordOwnerChangedTitle: 'Agora você é o proprietário deste registro de {{object}}',
    recordsOwnerChangedTitle: 'Agora você é o proprietário de {{count}} registros de {{object}}',
};

export const ruMessages: MessagingMessages = {
    notificationDigestTitle: 'Уведомлений: {{count}}',
    slackLinkRemovedTitle: 'Ваша привязка к Slack удалена',
    slackLinkRemovedBody: 'Администратор удалил привязку вашей учётной записи к вашему пользователю Slack в {{workspace}}. Уведомления больше не приходят вам в Slack; вы можете подключиться снова в настройках уведомлений.',
    slackLinkProposalOutdated: 'Ваш адрес электронной почты больше не подтверждён или это не тот адрес, для которого была предложена эта привязка к Slack: запросите новое предложение. Ничего не изменено.',
    recordOwnerChangedTitle: 'Теперь вы владелец этой записи ({{object}})',
    recordsOwnerChangedTitle: 'Записи, владельцем которых вы стали ({{object}}): {{count}}',
};

export const deMessages: MessagingMessages = {
    notificationDigestTitle: 'Sie haben {{count}} Benachrichtigungen',
    slackLinkRemovedTitle: 'Ihre Slack-Verknüpfung wurde entfernt',
    slackLinkRemovedBody: 'Ein Administrator hat die Verknüpfung zwischen Ihrem Konto und Ihrem Slack-Benutzer in {{workspace}} entfernt. Benachrichtigungen erreichen Sie nicht mehr über Slack; Sie können sich in Ihren Benachrichtigungseinstellungen erneut verbinden.',
    slackLinkProposalOutdated: 'Ihre E-Mail-Adresse ist nicht mehr bestätigt oder nicht die Adresse, für die diese Slack-Verknüpfung vorgeschlagen wurde: Fordern Sie einen neuen Vorschlag an. Es wurde nichts geändert.',
    recordOwnerChangedTitle: 'Sie sind jetzt Besitzer dieses Datensatzes vom Typ {{object}}',
    recordsOwnerChangedTitle: 'Sie sind jetzt Besitzer von {{count}} Datensätzen vom Typ {{object}}',
};

export const koMessages: MessagingMessages = {
    notificationDigestTitle: '알림이 {{count}}개 있습니다',
    slackLinkRemovedTitle: 'Slack 연결이 해제되었습니다',
    slackLinkRemovedBody: '관리자가 {{workspace}}에서 회원님의 계정과 Slack 사용자 간의 연결을 해제했습니다. 이제 알림이 Slack으로 전송되지 않으며, 알림 설정에서 다시 연결할 수 있습니다.',
    slackLinkProposalOutdated: '이메일이 더 이상 인증된 상태가 아니거나 이 Slack 연결이 제안된 이메일이 아닙니다. 새 제안을 요청하세요. 변경된 내용은 없습니다.',
    recordOwnerChangedTitle: '이제 이 {{object}} 레코드의 소유자입니다',
    recordsOwnerChangedTitle: '이제 {{count}}개의 {{object}} 레코드의 소유자입니다',
};

/** The shipped locales, keyed as the bundle beside this file keys them. */
export type MessagingLocale =
    | 'en' | 'zh-CN' | 'ja-JP' | 'es-ES'
    | 'zh-Hant' | 'ar' | 'fr' | 'pt-BR' | 'ru' | 'de' | 'ko';

export const messagingMessages: Readonly<Record<MessagingLocale, MessagingMessages>> = {
    en: enMessages,
    'zh-CN': zhCNMessages,
    'ja-JP': jaJPMessages,
    'es-ES': esESMessages,
    'zh-Hant': zhHantMessages,
    'ar': arMessages,
    'fr': frMessages,
    'pt-BR': ptBRMessages,
    'ru': ruMessages,
    'de': deMessages,
    'ko': koMessages,
};
