/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11733 — a recent `object` entry is named with the object's PLURAL
 * label, and an unlabelled navigation entry still inherits the singular.
 *
 * A recent object entry opens the object's LIST (`useTrackRouteAsRecent`
 * records `href: …/<object>`), so it is named as that list page is titled
 * since objectui#11696: `objectPluralLabel` over the object's cached metadata.
 * It used to ask `useNavTargetLabel`, whose object rung is the spec's step 3
 * for an unlabelled nav entry — "the object's label", the singular. That rung
 * is a ruling this card does not reopen (objectui#11696), so the change is
 * made at the recent-item call site only, and the last case below pins that
 * `useNavTargetLabel` still answers the singular for the same object.
 *
 * The `zh-CN` plural differs from the `zh-CN` label on purpose, so each
 * assertion can tell which key was read; the no-plural object is the control.
 *
 * Direction, written before the run: with the recent-item object kind put back
 * on `useNavTargetLabel`, the two plural cells RED (`Project` / `项目`); the
 * control and the nav-entry case GREEN on both sides.
 */

import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { MetadataCtx } from '@object-ui/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { useRecentItemLabel } from '../useRecentItemLabel';
import { useNavTargetLabel } from '../useNavTargetLabel';
import type { RecentItem } from '../../context/RecentItemsProvider';

type Lang = 'en' | 'zh-CN';

function metadata() {
  return {
    apps: [],
    objects: [
      { name: 'showcase_project', label: 'Project', pluralLabel: 'Projects' },
      { name: 'showcase_note', label: 'Note' },
    ],
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready' as const,
  };
}

function wrapper(lang: Lang) {
  const i18n = createI18n({
    defaultLanguage: lang,
    detectBrowserLanguage: false,
    resources: { 'zh-CN': { showcase: { objects: { showcase_project: { label: '项目', pluralLabel: '项目清单' } } } } },
  });
  // The instance really booted in the language under test.
  expect(i18n.language).toBe(lang);
  return ({ children }: { children: ReactNode }) => (
    <I18nProvider instance={i18n} persistLanguage={false}>
      <MetadataCtx.Provider value={metadata() as never}>{children}</MetadataCtx.Provider>
    </I18nProvider>
  );
}

const at = '2026-10-06T09:00:00.000Z';
const recent = (name: string): RecentItem => ({ id: `object:${name}`, type: 'object', name, href: `/apps/demo/${name}`, visitedAt: at });

function recentLabel(lang: Lang, name: string): string {
  const { result } = renderHook(() => useRecentItemLabel(), { wrapper: wrapper(lang) });
  return result.current(recent(name));
}

describe('useRecentItemLabel — a recent object entry names the list with the plural (objectui#11733)', () => {
  it('en: "Projects"', () => {
    expect(recentLabel('en', 'showcase_project')).toBe('Projects');
  });

  it('zh-CN: the translated plural', () => {
    expect(recentLabel('zh-CN', 'showcase_project')).toBe('项目清单');
  });

  it('control: an object that declares no plural is named by its label', () => {
    expect(recentLabel('en', 'showcase_note')).toBe('Note');
  });

  it('an object the metadata does not hold still shows its machine name', () => {
    expect(recentLabel('en', 'showcase_gone')).toBe('showcase_gone');
  });

  it('unchanged: an unlabelled nav entry for the same object still inherits the singular (spec step 3)', () => {
    const en = renderHook(() => useNavTargetLabel(), { wrapper: wrapper('en') });
    expect(en.result.current({ kind: 'object', objectName: 'showcase_project' })).toBe('Project');
    const zh = renderHook(() => useNavTargetLabel(), { wrapper: wrapper('zh-CN') });
    expect(zh.result.current({ kind: 'object', objectName: 'showcase_project' })).toBe('项目');
  });
});
