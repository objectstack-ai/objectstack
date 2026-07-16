// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Activity summary verb templates (framework#3039).
 *
 * Keys are single-segment on purpose: both i18n implementations (the core
 * memory fallback and service-i18n's FileI18nAdapter) resolve dot-notation
 * keys by walking NESTED objects, so a flat record key containing a dot
 * (`'activity.created'`) would never resolve — `messages.activityCreated`
 * does. Interpolation uses the shared `{{param}}` convention.
 */

import type { TranslationData } from '@objectstack/spec/system';

type Messages = NonNullable<TranslationData['messages']>;

export const enMessages: Messages = {
  activityCreated: 'Created {{object}} "{{label}}"',
  activityUpdated: 'Updated {{object}} "{{label}}"',
  activityDeleted: 'Deleted {{object}} "{{label}}"',
};

export const zhCNMessages: Messages = {
  activityCreated: '创建了 {{object}} "{{label}}"',
  activityUpdated: '更新了 {{object}} "{{label}}"',
  activityDeleted: '删除了 {{object}} "{{label}}"',
};

export const jaJPMessages: Messages = {
  activityCreated: '{{object}}「{{label}}」を作成しました',
  activityUpdated: '{{object}}「{{label}}」を更新しました',
  activityDeleted: '{{object}}「{{label}}」を削除しました',
};

export const esESMessages: Messages = {
  activityCreated: 'Creó {{object}} "{{label}}"',
  activityUpdated: 'Actualizó {{object}} "{{label}}"',
  activityDeleted: 'Eliminó {{object}} "{{label}}"',
};
