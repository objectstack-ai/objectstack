// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Activity summary verb templates (framework#3039).
 *
 * Keys are single-segment on purpose: both i18n implementations (the core
 * memory fallback and service-i18n's FileI18nAdapter) resolve dot-notation
 * keys by walking NESTED objects, so a flat record key containing a dot
 * (`'activity.created'`) would never resolve — `messages.activityCreated`
 * does. Interpolation uses the shared `{{param}}` convention.
 *
 * `activityUpdatedFields` is the update summary that names the changed fields
 * (`{{fields}}` = the locale's list of field labels); `activityMoreFields` is
 * the list's last item when more fields changed than are named (#25787).
 * `activityValueTrue` / `activityValueFalse` word a yes/no field's value inside
 * a field-change summary, for a field that declares no option words of its own.
 *
 * [#36074] `repliedToYourComment` titles the reply notice to a thread's
 * starter, `repliedInYourThread` the one to an earlier replier, and
 * `repliedAnonymous` either when the reply names no author.
 */

import type { TranslationData } from '@objectstack/spec/system';

type Messages = NonNullable<TranslationData['messages']>;

export const enMessages: Messages = {
  activityCreated: 'Created {{object}} "{{label}}"',
  activityUpdated: 'Updated {{object}} "{{label}}"',
  activityUpdatedFields: 'Updated {{object}} "{{label}}": {{fields}}',
  activityMoreFields: '{{count}} more',
  activityDeleted: 'Deleted {{object}} "{{label}}"',
  mentionedYou: '{{actor}} mentioned you',
  mentionedYouAnonymous: 'You were mentioned',
  repliedToYourComment: '{{actor}} replied to your comment',
  repliedInYourThread: '{{actor}} replied in a comment thread you are in',
  repliedAnonymous: 'Someone replied to a comment',
  activityValueTrue: 'Yes',
  activityValueFalse: 'No',
};

export const zhCNMessages: Messages = {
  activityCreated: '创建了 {{object}} "{{label}}"',
  activityUpdated: '更新了 {{object}} "{{label}}"',
  activityUpdatedFields: '更新了 {{object}} "{{label}}"：{{fields}}',
  activityMoreFields: '另外 {{count}} 个字段',
  activityDeleted: '删除了 {{object}} "{{label}}"',
  mentionedYou: '{{actor}} 提到了你',
  mentionedYouAnonymous: '有人提到了你',
  repliedToYourComment: '{{actor}} 回复了你的评论',
  repliedInYourThread: '{{actor}} 回复了你参与的评论',
  repliedAnonymous: '有人回复了评论',
  activityValueTrue: '是',
  activityValueFalse: '否',
};

export const jaJPMessages: Messages = {
  activityCreated: '{{object}}「{{label}}」を作成しました',
  activityUpdated: '{{object}}「{{label}}」を更新しました',
  activityUpdatedFields: '{{object}}「{{label}}」の{{fields}}を更新しました',
  activityMoreFields: 'ほか {{count}} 件',
  activityDeleted: '{{object}}「{{label}}」を削除しました',
  mentionedYou: '{{actor}}さんがあなたをメンションしました',
  mentionedYouAnonymous: 'あなたがメンションされました',
  repliedToYourComment: '{{actor}}さんがあなたのコメントに返信しました',
  repliedInYourThread: '{{actor}}さんがあなたも参加しているコメントに返信しました',
  repliedAnonymous: 'コメントに返信がありました',
  activityValueTrue: 'はい',
  activityValueFalse: 'いいえ',
};

export const esESMessages: Messages = {
  activityCreated: 'Creó {{object}} "{{label}}"',
  activityUpdated: 'Actualizó {{object}} "{{label}}"',
  activityUpdatedFields: 'Actualizó {{object}} "{{label}}": {{fields}}',
  activityMoreFields: '{{count}} más',
  activityDeleted: 'Eliminó {{object}} "{{label}}"',
  mentionedYou: '{{actor}} te mencionó',
  mentionedYouAnonymous: 'Te han mencionado',
  repliedToYourComment: '{{actor}} respondió a tu comentario',
  repliedInYourThread: '{{actor}} respondió en una conversación en la que participas',
  repliedAnonymous: 'Alguien respondió a un comentario',
  activityValueTrue: 'Sí',
  activityValueFalse: 'No',
};

export const zhHantMessages: Messages = {
  activityCreated: '建立了 {{object}}「{{label}}」',
  activityUpdated: '更新了 {{object}}「{{label}}」',
  activityUpdatedFields: '更新了 {{object}}「{{label}}」：{{fields}}',
  activityMoreFields: '另外 {{count}} 個欄位',
  activityDeleted: '刪除了 {{object}}「{{label}}」',
  mentionedYou: '{{actor}} 提及了你',
  mentionedYouAnonymous: '有人提及了你',
  repliedToYourComment: '{{actor}} 回覆了你的留言',
  repliedInYourThread: '{{actor}} 回覆了你參與的留言',
  repliedAnonymous: '有人回覆了留言',
  activityValueTrue: '是',
  activityValueFalse: '否',
};

export const arMessages: Messages = {
  activityCreated: 'أنشأ {{object}} "{{label}}"',
  activityUpdated: 'حدّث {{object}} "{{label}}"',
  activityUpdatedFields: 'حدّث {{object}} "{{label}}": {{fields}}',
  activityMoreFields: '{{count}} أخرى',
  activityDeleted: 'حذف {{object}} "{{label}}"',
  mentionedYou: 'أشار إليك {{actor}}',
  mentionedYouAnonymous: 'تمت الإشارة إليك',
  repliedToYourComment: 'ردّ {{actor}} على تعليقك',
  repliedInYourThread: 'ردّ {{actor}} في محادثة تعليقات تشارك فيها',
  repliedAnonymous: 'ردّ أحدهم على تعليق',
  activityValueTrue: 'نعم',
  activityValueFalse: 'لا',
};

export const frMessages: Messages = {
  activityCreated: 'A créé {{object}} « {{label}} »',
  activityUpdated: 'A modifié {{object}} « {{label}} »',
  activityUpdatedFields: 'A modifié {{object}} « {{label}} » : {{fields}}',
  activityMoreFields: '{{count}} de plus',
  activityDeleted: 'A supprimé {{object}} « {{label}} »',
  mentionedYou: '{{actor}} vous a mentionné',
  mentionedYouAnonymous: 'Vous avez été mentionné',
  repliedToYourComment: '{{actor}} a répondu à votre commentaire',
  repliedInYourThread: '{{actor}} a répondu dans une discussion à laquelle vous participez',
  repliedAnonymous: 'Quelqu\'un a répondu à un commentaire',
  activityValueTrue: 'Oui',
  activityValueFalse: 'Non',
};

export const ptBRMessages: Messages = {
  activityCreated: 'Criou {{object}} "{{label}}"',
  activityUpdated: 'Atualizou {{object}} "{{label}}"',
  activityUpdatedFields: 'Atualizou {{object}} "{{label}}": {{fields}}',
  activityMoreFields: 'mais {{count}}',
  activityDeleted: 'Excluiu {{object}} "{{label}}"',
  mentionedYou: '{{actor}} mencionou você',
  mentionedYouAnonymous: 'Você foi mencionado',
  repliedToYourComment: '{{actor}} respondeu ao seu comentário',
  repliedInYourThread: '{{actor}} respondeu em uma conversa da qual você participa',
  repliedAnonymous: 'Alguém respondeu a um comentário',
  activityValueTrue: 'Sim',
  activityValueFalse: 'Não',
};

export const ruMessages: Messages = {
  activityCreated: 'Создал(а) {{object}} «{{label}}»',
  activityUpdated: 'Изменил(а) {{object}} «{{label}}»',
  activityUpdatedFields: 'Изменил(а) {{object}} «{{label}}»: {{fields}}',
  activityMoreFields: 'ещё {{count}}',
  activityDeleted: 'Удалил(а) {{object}} «{{label}}»',
  mentionedYou: '{{actor}} упомянул(а) вас',
  mentionedYouAnonymous: 'Вас упомянули',
  repliedToYourComment: '{{actor}} ответил(а) на ваш комментарий',
  repliedInYourThread: '{{actor}} ответил(а) в обсуждении, в котором вы участвуете',
  repliedAnonymous: 'Кто-то ответил на комментарий',
  activityValueTrue: 'Да',
  activityValueFalse: 'Нет',
};

export const deMessages: Messages = {
  activityCreated: 'Hat {{object}} „{{label}}“ erstellt',
  activityUpdated: 'Hat {{object}} „{{label}}“ aktualisiert',
  activityUpdatedFields: 'Hat {{object}} „{{label}}“ aktualisiert: {{fields}}',
  activityMoreFields: '{{count}} weitere',
  activityDeleted: 'Hat {{object}} „{{label}}“ gelöscht',
  mentionedYou: '{{actor}} hat Sie erwähnt',
  mentionedYouAnonymous: 'Sie wurden erwähnt',
  repliedToYourComment: '{{actor}} hat auf Ihren Kommentar geantwortet',
  repliedInYourThread: '{{actor}} hat in einer Diskussion geantwortet, an der Sie beteiligt sind',
  repliedAnonymous: 'Jemand hat auf einen Kommentar geantwortet',
  activityValueTrue: 'Ja',
  activityValueFalse: 'Nein',
};

export const koMessages: Messages = {
  activityCreated: '{{object}} "{{label}}"을(를) 만들었습니다',
  activityUpdated: '{{object}} "{{label}}"을(를) 수정했습니다',
  activityUpdatedFields: '{{object}} "{{label}}"의 {{fields}}을(를) 수정했습니다',
  activityMoreFields: '외 {{count}}개',
  activityDeleted: '{{object}} "{{label}}"을(를) 삭제했습니다',
  mentionedYou: '{{actor}}님이 회원님을 멘션했습니다',
  mentionedYouAnonymous: '회원님이 멘션되었습니다',
  repliedToYourComment: '{{actor}}님이 회원님의 댓글에 답글을 남겼습니다',
  repliedInYourThread: '{{actor}}님이 회원님이 참여한 댓글에 답글을 남겼습니다',
  repliedAnonymous: '누군가 댓글에 답글을 남겼습니다',
  activityValueTrue: '예',
  activityValueFalse: '아니요',
};
