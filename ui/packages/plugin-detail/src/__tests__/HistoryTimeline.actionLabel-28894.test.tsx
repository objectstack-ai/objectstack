/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * The action badge shows the declared option label of the field its entries
 * come from (objectstack#28894).
 *
 * The badge printed the stored value and upper-cased it with CSS, so a zh
 * reader saw "UPDATED" beside a Chinese summary although the option's zh label
 * was already served. With `actionField` named, the badge reads the label the
 * served translations give that option; a value with no label, and every value
 * when no field is named, shows as stored. Only a stored value is upper-cased.
 *
 * The bundle is built with `transformSpecTranslations`, the transform the
 * console applies to `/api/v1/i18n/translations/:locale`, so the keys are the
 * ones the console really holds.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider, transformSpecTranslations } from '@object-ui/i18n';
import { HistoryTimeline, type HistoryEntry } from '../HistoryTimeline';

const SOURCE = { object: 'sys_activity', field: 'type' } as const;

const spec = (options: Record<string, string>) =>
  transformSpecTranslations({
    objects: { sys_activity: { label: 'Activity', fields: { type: { label: 'Type', options } } } },
  });

const RESOURCES = {
  // The zh-CN labels plugin-audit serves for these two options.
  zh: spec({ created: '已创建', updated: '已更新' }),
  // The en bundle spells each option as its value.
  en: spec({ created: 'created', updated: 'updated' }),
};

const entries: HistoryEntry[] = [
  { id: 1, action: 'updated', user_name: 'Ada Lovelace', created_at: '2026-01-02T00:00:00.000Z' },
  { id: 2, action: 'created', user_name: 'Ada Lovelace', created_at: '2026-01-01T00:00:00.000Z' },
  { id: 3, action: 'assigned', user_name: 'Ada Lovelace', created_at: '2025-12-31T00:00:00.000Z' },
];

function mount(language: 'zh' | 'en', actionField?: typeof SOURCE) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: RESOURCES }}>
      <HistoryTimeline entries={entries} actionField={actionField} />
    </I18nProvider>,
  );
}

afterEach(() => cleanup());

describe('HistoryTimeline action badge label (objectstack#28894)', () => {
  it('shows the option label in zh, not the stored value, and does not upper-case it', () => {
    mount('zh', SOURCE);
    const updated = screen.getByText('已更新');
    const created = screen.getByText('已创建');
    expect(updated.className).not.toContain('uppercase');
    expect(created.className).not.toContain('uppercase');
    expect(screen.queryByText('updated')).toBeNull();
    expect(screen.queryByText('created')).toBeNull();
  });

  it('shows a value with no option label as stored, upper-cased', () => {
    mount('zh', SOURCE);
    const assigned = screen.getByText('assigned');
    expect(assigned.className).toContain('uppercase');
  });

  it('keeps the English look where the label is the stored word', () => {
    mount('en', SOURCE);
    expect(screen.getByText('updated').className).toContain('uppercase');
    expect(screen.getByText('created').className).toContain('uppercase');
  });

  it('shows every value as stored when no source field is named', () => {
    mount('zh');
    expect(screen.queryByText('已更新')).toBeNull();
    expect(screen.getByText('updated').className).toContain('uppercase');
    expect(screen.getByText('created').className).toContain('uppercase');
  });
});
