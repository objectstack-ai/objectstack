/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RecordDetailDrawer`'s drag-resize handle speaks the session locale —
 * objectstack#5733.
 *
 * The literal removed here was a **byte-identical twin** of the one #5506
 * removed from `NavigationOverlay` (`packages/components/src/custom/
 * navigation-overlay.tsx`): same control (a drag-resize handle on a record
 * drawer's left edge), same shape (`role="separator"`, `aria-orientation=
 * "vertical"`, no visible label), same defect (a zh/ja/de session got one
 * English string in an otherwise localized drawer). #5506's file fence did not
 * reach `packages/plugin-detail`, so this copy survived that sweep.
 *
 * It reuses #5506's key, `common.resizeDrawer` — already in all ten packs —
 * rather than minting a `detail.resizeDrawer` twin: one control rendered from
 * two packages should not get two translations that can drift apart.
 *
 * The handle carries no visible label, so its `aria-label` IS the control as
 * far as a screen reader is concerned. `resizable` defaults to `true`, so this
 * is the drawer the console renders, not a dormant branch.
 *
 * ── Direction of these assertions ─────────────────────────────────────────
 * The non-English cases (zh / de / ja) were RED before the change — the handle
 * announced "Resize drawer" in every locale — and are GREEN after. The `en`
 * case was GREEN before AND after: it pins that routing the name through `t()`
 * did not change what an English session hears. The provider-less fallback is
 * asserted in `RecordDetailDrawer.resizeHandleNoProviderFallback.test.tsx` —
 * it cannot live in this file; see that file's header for why.
 *
 * `DetailView` / `InlineEditSaveBar` are mocked (same as
 * `RecordDetailDrawer.capability.test.tsx`) so the only `role="separator"` in
 * the tree is the handle under test, and the drawer body's data fetching stays
 * out of an assertion about chrome.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { RecordDetailDrawer } from '../RecordDetailDrawer';

vi.mock('../DetailView', () => ({
  DetailView: () => <div data-testid="dv-probe" />,
}));

vi.mock('../InlineEditSaveBar', () => ({
  InlineEditSaveBar: () => null,
}));

function renderDrawerIn(
  language: string,
  extra: Partial<React.ComponentProps<typeof RecordDetailDrawer>> = {},
) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <RecordDetailDrawer
        open
        onClose={() => {}}
        title="Task Details"
        record={{ id: '1', name: 'Hello' }}
        objectName="tasks"
        recordId="1"
        {...extra}
      />
    </I18nProvider>,
  );
}

afterEach(() => cleanup());

describe('RecordDetailDrawer drag-resize handle — accessible name (objectstack#5733)', () => {
  it('still reads English under an en session', () => {
    renderDrawerIn('en');

    expect(screen.getByRole('separator').getAttribute('aria-label')).toBe('Resize drawer');
  });

  it('reads the zh bundle value under a zh session', () => {
    renderDrawerIn('zh');

    expect(screen.getByRole('separator').getAttribute('aria-label')).toBe('调整面板宽度');
    // The whole point of the issue: no English leaks into a zh drawer.
    expect(screen.queryByLabelText('Resize drawer')).toBeNull();
  });

  it('reads the de bundle value under a de session', () => {
    renderDrawerIn('de');

    expect(screen.getByRole('separator').getAttribute('aria-label')).toBe('Panelbreite anpassen');
  });

  it('reads the ja bundle value under a ja session', () => {
    renderDrawerIn('ja');

    expect(screen.getByRole('separator').getAttribute('aria-label')).toBe('パネル幅を調整');
  });

  /**
   * The handle is gated on `resizable`, so a host that turns resizing off must
   * render no separator at all — in any locale. Without this the locale
   * assertions above could pass against an empty tree if the gate ever broke
   * open in the other direction.
   */
  it('renders no handle at all when the host disables resizing', () => {
    renderDrawerIn('zh', { resizable: false });

    expect(screen.queryByRole('separator')).toBeNull();
    expect(screen.queryByLabelText('调整面板宽度')).toBeNull();
  });
});
