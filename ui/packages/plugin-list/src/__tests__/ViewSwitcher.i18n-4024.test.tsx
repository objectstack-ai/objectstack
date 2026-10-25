/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The list-view mode switcher speaks the session locale — objectui#4024
 * (migrated from objectstack#5084).
 *
 * `ViewSwitcher.tsx` carried `VIEW_LABELS`, a hardcoded English
 * `Record<ViewType, string>` used three ways per button: the visible span, the
 * `aria-label`, and the `title`. So on a zh-CN console the switcher read
 * "Grid" / "Gallery" beside a fully translated toolbar, and there was nothing
 * an app could author to reach it.
 *
 * ## No new keys — this was a wiring gap, not a missing capability
 *
 * `console.objectView.viewType{Grid,Kanban,Gallery,…}` already exists in all
 * ten packs and already carries exactly these words: the create-view picker
 * (`packages/app-shell/src/views/CreateViewDialog.tsx:88-96`) has resolved them
 * through the bundle for months. The switcher naming the same nine
 * visualizations with a private English copy is the drift; reusing the pack's
 * key is what keeps the picker's 「画廊」 and the switcher's 「画廊」 the same
 * word in nine languages. The triage seat on objectstack#5084 predicted this
 * ("i18n 包已有 `viewTypeGrid`/`viewTypeGallery` 词条,疑似未接线") and it holds.
 *
 * A plugin package reading a `console.*` key has precedent in this repo, in
 * this very namespace: `packages/plugin-view/src/ObjectView.tsx:83` resolves
 * `console.objectView.new`.
 *
 * ## Red-first prediction (written BEFORE the first run)
 *
 * Pre-fix, on `origin/main`:
 *   - the two zh cases FAIL — the component renders the English literal
 *     'Grid' / 'Gallery' from `VIEW_LABELS`, never consulting the bundle, so
 *     `getByRole('tab', { name: '表格' })` finds nothing;
 *   - the en case and the no-provider case PASS — the English literal happens
 *     to equal the `en` pack value, which is precisely why nothing caught this.
 *
 * That asymmetry is the point: only the translated assertion can go red here,
 * so the English one is kept as the must-not-change half rather than as
 * evidence of the fix.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ViewSwitcher, ViewSwitcherDropdown } from '../ViewSwitcher';

afterEach(() => cleanup());

function inLocale(language: string, body: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      {body}
    </I18nProvider>,
  );
}

/** Two visualizations → the segmented control (`role="tab"`). */
function segmented() {
  return (
    <ViewSwitcherDropdown
      currentView="grid"
      availableViews={['grid', 'gallery']}
      onViewChange={() => {}}
      animated={false}
    />
  );
}

describe('list-view mode switcher resolves its labels from the bundle (objectui#4024)', () => {
  it('zh-CN: the segmented control announces 表格 / 画廊', async () => {
    inLocale('zh', segmented());
    // Accessible-name queries, not text queries: the label is the button's
    // `aria-label`, which is what assistive tech announces and what a text
    // query would miss on the `sm:`-hidden span.
    expect(await screen.findByRole('tab', { name: '表格' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '画廊' })).toBeTruthy();
  });

  it('zh-CN: the full button-row switcher announces 表格 / 画廊', async () => {
    inLocale(
      'zh',
      <ViewSwitcher
        currentView="grid"
        availableViews={['grid', 'gallery']}
        onViewChange={() => {}}
        animated={false}
      />,
    );
    expect(await screen.findByRole('button', { name: '表格' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '画廊' })).toBeTruthy();
  });

  it('ja-JP: the segmented control announces グリッド / ギャラリー', async () => {
    inLocale('ja', segmented());
    expect(await screen.findByRole('tab', { name: 'グリッド' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'ギャラリー' })).toBeTruthy();
  });

  it('en: unchanged — Grid / Gallery (must-not-change)', async () => {
    inLocale('en', segmented());
    expect(await screen.findByRole('tab', { name: 'Grid' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Gallery' })).toBeTruthy();
  });
});

/**
 * The English no-provider fallback is pinned in a FILE OF ITS OWN —
 * `ViewSwitcher.i18n-4024.no-provider.test.tsx`.
 *
 * `createI18n` registers its instance as react-i18next's module-global
 * default, and that registration survives unmount and `cleanup()`, so a
 * "no provider" render placed HERE would silently resolve against whichever
 * locale the cases above mounted last. This is not a guess: it is the warning
 * `sheet-dialog-close-i18n.test.tsx` records after being bitten by it
 * (objectstack#5505/#5506), and it applies verbatim to this file.
 */
