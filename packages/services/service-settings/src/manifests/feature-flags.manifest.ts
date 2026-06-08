// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { SettingsManifest } from '@objectstack/spec/system';

/** Feature Flags — opt into experimental capabilities. */
export const featureFlagsSettingsManifest: SettingsManifest = {
  namespace: 'feature_flags',
  version: 1,
  label: 'Feature Flags',
  icon: 'FlaskConical',
  description: 'Toggle experimental and beta features for this workspace.',
  scope: 'tenant',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  category: 'Beta',
  order: 100,
  beta: true,
  specifiers: [
    { type: 'info_banner', id: 'beta_notice', label: 'Heads up', required: false,
      bannerText:
        'Beta features may change without notice. Pin via env vars (e.g. `OS_FEATURE_FLAGS_AI_ENABLED=true`) to lock for the whole deployment.',
      bannerSeverity: 'warning' },

    { type: 'group', id: 'productivity', label: 'Productivity', required: false },
    { type: 'toggle', key: 'ai_enabled', label: 'AI Assistant', required: false, default: false,
      description: 'Enables the in-app AI assistant panel.' },
    { type: 'toggle', key: 'kanban_swimlanes', label: 'Kanban swimlanes', required: false, default: false },

    { type: 'group', id: 'collaboration', label: 'Collaboration', required: false },
    { type: 'toggle', key: 'realtime_cursors', label: 'Realtime cursors', required: false, default: false },
    { type: 'toggle', key: 'inline_comments', label: 'Inline comments', required: false, default: true },
  ],
};
