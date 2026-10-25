/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import {
  ConfigPanelRenderer,
  useConfigDraft,
} from '@object-ui/components';
import type { ConfigPanelSchema } from '@object-ui/components';
import {
  useConfigPanelTranslation,
  type ConfigPanelTranslate,
} from './useConfigPanelTranslation';

/**
 * Auto-refresh intervals, in the order the picker offers them. The stored value
 * is seconds-as-string (`'0'` = off); the label is translated, because
 * `Every 30s` and `Every 1 hour` abbreviate differently per locale and are not
 * one sentence with a number in it.
 *
 * Keys are literal arguments of `t()` rather than rows of a `{ value, key }`
 * table: a key that only ever reaches `t()` through a variable is invisible to
 * `check-i18n-call-site-keys` (dynamic-key, skipped) and to
 * `check-i18n-dead-keys` (no reader) — same reasoning as
 * `WidgetConfigPanel`'s option builders.
 */
function refreshOptions(t: ConfigPanelTranslate): Array<{ value: string; label: string }> {
  return [
    { value: '0', label: t('dashboard.config.refresh.off') },
    { value: '30', label: t('dashboard.config.refresh.every30s') },
    { value: '60', label: t('dashboard.config.refresh.every1m') },
    { value: '300', label: t('dashboard.config.refresh.every5m') },
    { value: '900', label: t('dashboard.config.refresh.every15m') },
    { value: '1800', label: t('dashboard.config.refresh.every30m') },
    { value: '3600', label: t('dashboard.config.refresh.every1h') },
  ];
}

/** Theme choices, stored value → translated label. */
function themeOptions(t: ConfigPanelTranslate): Array<{ value: string; label: string }> {
  return [
    { value: 'light', label: t('dashboard.config.themeOption.light') },
    { value: 'dark', label: t('dashboard.config.themeOption.dark') },
    { value: 'auto', label: t('dashboard.config.themeOption.auto') },
  ];
}

// ---------------------------------------------------------------------------
// Schema — describes the full DashboardConfigPanel structure
//
// Built per render rather than declared as a module constant (objectui#4748):
// every user-visible string in it is a translation, so the schema depends on
// the active language and cannot be frozen at import time.
// ---------------------------------------------------------------------------

export function buildDashboardSchema(t: ConfigPanelTranslate): ConfigPanelSchema {
  return {
    breadcrumb: [
      t('dashboard.config.breadcrumb.dashboard'),
      t('dashboard.config.breadcrumb.configuration'),
    ],
    sections: [
      {
        key: 'layout',
        title: t('dashboard.config.section.layout'),
        collapsible: true,
        fields: [
          {
            key: 'columns',
            label: t('dashboard.config.field.columns'),
            type: 'slider',
            defaultValue: 3,
            min: 1,
            max: 12,
            step: 1,
          },
          {
            key: 'gap',
            label: t('dashboard.config.field.gap'),
            type: 'slider',
            defaultValue: 4,
            min: 0,
            max: 16,
            step: 1,
          },
          {
            key: 'rowHeight',
            label: t('dashboard.config.field.rowHeight'),
            type: 'slider',
            defaultValue: 120,
            min: 40,
            max: 320,
            step: 10,
          },
        ],
      },
      {
        key: 'data',
        title: t('dashboard.config.section.data'),
        collapsible: true,
        fields: [
          {
            key: 'refreshIntervalSeconds',
            label: t('dashboard.config.field.autoRefresh'),
            type: 'select',
            defaultValue: '0',
            options: refreshOptions(t),
          },
        ],
      },
      {
        key: 'appearance',
        title: t('dashboard.config.section.appearance'),
        collapsible: true,
        defaultCollapsed: true,
        fields: [
          {
            key: 'title',
            label: t('dashboard.config.field.title'),
            type: 'input',
            placeholder: t('dashboard.config.placeholder.dashboardTitle'),
          },
          {
            key: 'description',
            label: t('dashboard.config.field.description'),
            type: 'textarea',
            placeholder: t('dashboard.config.placeholder.dashboardDescription'),
          },
          {
            key: 'showDescription',
            label: t('dashboard.config.field.showDescription'),
            type: 'switch',
            defaultValue: true,
          },
          {
            key: 'theme',
            label: t('dashboard.config.field.theme'),
            type: 'select',
            defaultValue: 'auto',
            options: themeOptions(t),
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DashboardConfigPanelProps {
  /** Whether the panel is open */
  open: boolean;
  /** Close handler */
  onClose: () => void;
  /** Initial / committed dashboard configuration */
  config: Record<string, any>;
  /** Persist the updated config */
  onSave: (config: Record<string, any>) => void;
  /** Optional live-update callback */
  onFieldChange?: (field: string, value: any) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * DashboardConfigPanel — Schema-driven configuration panel for dashboards.
 *
 * Built entirely on the generic ConfigPanelRenderer + useConfigDraft,
 * demonstrating that a full config panel can be expressed in ~60 lines
 * of declarative schema rather than 1500+ lines of imperative code.
 */
export function DashboardConfigPanel({
  open,
  onClose,
  config,
  onSave,
  onFieldChange,
}: DashboardConfigPanelProps) {
  const { t } = useConfigPanelTranslation();
  const { draft, isDirty, updateField, discard } = useConfigDraft(config, {
    onUpdate: onFieldChange,
  });

  const schema = React.useMemo(() => buildDashboardSchema(t), [t]);

  return (
    <ConfigPanelRenderer
      open={open}
      onClose={onClose}
      schema={schema}
      draft={draft}
      isDirty={isDirty}
      onFieldChange={updateField}
      onSave={() => onSave(draft)}
      onDiscard={discard}
    />
  );
}
