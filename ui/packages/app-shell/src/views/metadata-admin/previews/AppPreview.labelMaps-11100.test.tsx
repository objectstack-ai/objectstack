// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11100: the Studio app preview resolves a locale-map app label,
 * nav-item label and group label in the designer locale.
 *
 * The spec types all three as `I18nLabel` (a plain string or an inline locale
 * map). Before this card the preview:
 *   - printed a map app label as `[object Object]` (`String(label)`);
 *   - dropped a childless nav item whose label was a map, target and all
 *     (`typeof it.label === 'string'` read the map as no label);
 *   - named a map-labelled group `(unnamed)`.
 *
 * The cases:
 *   - a map app label, a map nav-item label and a map group label each render
 *     the text resolved for the designer locale, under en and zh, with no
 *     `[object Object]` anywhere; the nav item keeps its target;
 *   - plain strings are the control, and read as they always did;
 *   - a label that resolves to nothing still reads `(unnamed)`, but never
 *     decides whether an entry with a target exists. A label that is truly
 *     ABSENT is not unnamed: the entry shows the text it inherits
 *     (objectui#11196, pinned in `AppPreview.labelInherits-11196.test.tsx`);
 *   - the app label resolves in design mode too.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { t } from '../i18n';
import { AppPreview } from './AppPreview';

afterEach(cleanup);

const APP_LABEL = { en: 'Customer Hub', 'zh-CN': '客户中心' };
const ITEM_LABEL = { en: 'Accounts', 'zh-CN': '客户' };
const GROUP_LABEL = { en: 'Administration', 'zh-CN': '系统管理' };
const DOCS = { id: 'docs', type: 'url', label: 'Docs', url: 'https://docs.example.com' };

function mapDraft(): Record<string, unknown> {
  return {
    name: 'crm',
    label: APP_LABEL,
    navigation: [
      { id: 'accounts', type: 'object', label: ITEM_LABEL, objectName: 'account' },
      { id: 'admin', type: 'group', label: GROUP_LABEL, children: [DOCS] },
    ],
  };
}

function renderApp(draft: Record<string, unknown>, locale: string) {
  return render(<AppPreview type="app" name="crm" draft={draft} locale={locale} />);
}

/** The nav list row that shows `label`. */
function navRow(label: string): HTMLElement {
  const row = screen.getByText(label).parentElement;
  expect(row, `no nav row shows ${JSON.stringify(label)}`).not.toBeNull();
  return row as HTMLElement;
}

describe('AppPreview resolves locale-map labels in the designer locale (objectui#11100)', () => {
  const cases: Array<[string, { app: string; item: string; group: string }]> = [
    ['en-US', { app: 'Customer Hub', item: 'Accounts', group: 'Administration' }],
    ['zh-CN', { app: '客户中心', item: '客户', group: '系统管理' }],
  ];

  for (const [locale, want] of cases) {
    it(`renders a map app label, nav-item label and group label as ${locale} text`, () => {
      renderApp(mapDraft(), locale);

      expect(screen.getByText(want.app)).toBeTruthy();
      // The nav item is kept with its target, not dropped for a label it could not read.
      expect(navRow(want.item).textContent).toContain('account');
      expect(navRow(want.group).textContent).toContain('group');
      // The group's child still renders beneath it.
      expect(screen.getByText('Docs')).toBeTruthy();
      // The landing line names the first reachable entry by its resolved label.
      expect(screen.getByText(`→ ${want.item}`)).toBeTruthy();

      for (const unnamed of [t('engine.appPreview.unnamed', 'en-US'), t('engine.appPreview.unnamed', 'zh-CN')]) {
        expect(screen.queryByText(unnamed), 'a resolved label never reads as unnamed').toBeNull();
      }
      expect(document.body.textContent).not.toContain('[object Object]');
    });
  }

  it('reads plain-string labels as before (the control)', () => {
    renderApp(
      {
        name: 'crm',
        label: 'Customer Hub',
        navigation: [
          { id: 'accounts', type: 'object', label: 'Accounts', objectName: 'account' },
          { id: 'admin', type: 'group', label: 'Administration', children: [DOCS] },
        ],
      },
      'zh-CN',
    );

    expect(screen.getByText('Customer Hub')).toBeTruthy();
    expect(navRow('Accounts').textContent).toContain('account');
    expect(navRow('Administration').textContent).toContain('group');
    expect(document.body.textContent).not.toContain('[object Object]');
  });

  it('falls back to the app name for an app with no label', () => {
    renderApp({ name: 'crm', navigation: [] }, 'en-US');
    // The name shows twice: as the header text and as the mono id beneath it.
    expect(screen.getAllByText('crm')).toHaveLength(2);
  });

  for (const locale of ['en-US', 'zh-CN']) {
    it(`keeps ${locale} "(unnamed)" for a label that resolves to nothing, inherits for an absent one, and never drops an entry that has a target`, () => {
      const unnamed = t('engine.appPreview.unnamed', locale);
      renderApp(
        {
          name: 'crm',
          label: 'Customer Hub',
          navigation: [
            // Absent label, holds children.
            { id: 'admin', type: 'group', children: [DOCS] },
            // Absent label, names a record: kept.
            { id: 'leads', type: 'object', objectName: 'lead' },
            // A map that resolves to nothing is no label either: kept.
            { id: 'deals', type: 'object', label: {}, objectName: 'deal' },
            // No label, no children, no target: nothing to show.
            { id: 'ghost', type: 'object' },
          ],
        },
        locale,
      );

      // Only the empty map reads unnamed. The two absent labels inherit
      // (objectui#11196): the group its id, the object its machine name, which
      // the row also prints as its target.
      expect(screen.getAllByText(unnamed)).toHaveLength(1);
      expect(screen.getByText('admin')).toBeTruthy();
      expect(screen.getAllByText('lead')).toHaveLength(2);
      expect(screen.getByText('deal')).toBeTruthy();
      // No label, no children, no target: still not listed.
      expect(screen.queryByText('ghost')).toBeNull();
      expect(document.body.textContent).not.toContain('[object Object]');
    });
  }

  it('resolves a map app label in design mode too', () => {
    render(
      <AppPreview
        type="app"
        name="crm"
        draft={mapDraft()}
        editing
        selection={null}
        onSelectionChange={() => {}}
        locale="zh-CN"
      />,
    );

    expect(screen.getByText('客户中心')).toBeTruthy();
    expect(screen.getByText('→ 客户')).toBeTruthy();
    expect(document.body.textContent).not.toContain('[object Object]');
  });
});
