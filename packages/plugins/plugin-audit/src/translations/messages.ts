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
};

export const zhCNMessages: Messages = {
  activityCreated: '创建了 {{object}} "{{label}}"',
  activityUpdated: '更新了 {{object}} "{{label}}"',
  activityUpdatedFields: '更新了 {{object}} "{{label}}"：{{fields}}',
  activityMoreFields: '另外 {{count}} 个字段',
  activityDeleted: '删除了 {{object}} "{{label}}"',
  mentionedYou: '{{actor}} 提到了你',
  mentionedYouAnonymous: '有人提到了你',
};

export const jaJPMessages: Messages = {
  activityCreated: '{{object}}「{{label}}」を作成しました',
  activityUpdated: '{{object}}「{{label}}」を更新しました',
  activityUpdatedFields: '{{object}}「{{label}}」の{{fields}}を更新しました',
  activityMoreFields: 'ほか {{count}} 件',
  activityDeleted: '{{object}}「{{label}}」を削除しました',
  mentionedYou: '{{actor}}さんがあなたをメンションしました',
  mentionedYouAnonymous: 'あなたがメンションされました',
};

export const esESMessages: Messages = {
  activityCreated: 'Creó {{object}} "{{label}}"',
  activityUpdated: 'Actualizó {{object}} "{{label}}"',
  activityUpdatedFields: 'Actualizó {{object}} "{{label}}": {{fields}}',
  activityMoreFields: '{{count}} más',
  activityDeleted: 'Eliminó {{object}} "{{label}}"',
  mentionedYou: '{{actor}} te mencionó',
  mentionedYouAnonymous: 'Te han mencionado',
};
