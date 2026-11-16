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
  activityValueTrue: '예',
  activityValueFalse: '아니요',
};
