// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// System Overview "Events by User": the rows the platform writes itself carry
// no `user_id`, and they were the board's largest bar, drawn under the
// renderer's default "(None)". The dataset dimension names that bucket with
// `nullLabel`, which the analytics service carries to the chart on the column
// descriptor (`fields[].nullLabel`).
//
// The label is an inline locale map because the translation bundles have no
// slot for a dimension's null label, so the map must name every locale the
// board is translated into; a missing one would show that viewer the English.

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import { SysAuditLogDataset } from './system.datasets.js';
import { SystemOverviewDashboard } from './system_overview.dashboard.js';
import { SetupAppTranslations } from '../translations/index.js';

const userDimension = () => SysAuditLogDataset.dimensions?.find((d) => d.name === 'user_id');

describe('System Overview: the null-user bucket reads "System"', () => {
  it('"Events by User" groups the audit dataset by user_id', () => {
    const widget = SystemOverviewDashboard.widgets?.find((w) => w.id === 'widget_events_by_user');
    expect(widget).toMatchObject({ dataset: SysAuditLogDataset.name, dimensions: ['user_id'] });
  });

  it('declares the user_id null label as an inline locale map', () => {
    expect(userDimension()?.nullLabel).toEqual({
      en: 'System',
      'zh-CN': '系统',
      'ja-JP': 'システム',
      'es-ES': 'Sistema',
    });
  });

  it('names the bucket in every locale the platform bundles translate the board into', () => {
    const map = userDimension()?.nullLabel as Record<string, string>;
    for (const locale of Object.keys(SetupAppTranslations)) {
      expect(SetupAppTranslations[locale]?.dashboards?.system_overview, locale).toBeDefined();
      expect(typeof map[locale], locale).toBe('string');
    }
  });

  it('survives a strict parse of the dataset', () => {
    const parsed = DatasetSchema.parse(SysAuditLogDataset);
    expect(parsed.dimensions?.find((d) => d.name === 'user_id')?.nullLabel).toEqual(userDimension()?.nullLabel);
  });
});
