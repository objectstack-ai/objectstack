/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The rest of the record overlay's chrome speaks the session locale —
 * objectstack#5506 (follow-on to #5430, which covered only the two close
 * affordances).
 *
 * Four more strings were hardcoded English literals in `NavigationOverlay`:
 *
 *   - the drag-resize handle's `aria-label` on `role="separator"`. The handle
 *     has no visible label at all, so the literal WAS the control.
 *   - `expandLabel`'s **default**. Callers may override it (the console's
 *     `ObjectView` does), but the default is what ships to every other host —
 *     and it feeds both `aria-label` and `title` of an icon-only button.
 *   - `resolvedTitle`'s fallback, `'Record Detail'`. This one is **visible**
 *     copy, not just an accessible name.
 *   - the sr-only `SheetDescription`/`DialogDescription` prose, which existed
 *     in three copies (drawer / modal / popover) and interpolates the title.
 *
 * Addressing convention, inherited from `navigation-overlay-close-i18n.test.tsx`:
 * the shadcn `Sheet` primitive auto-renders a close button whose only name is a
 * hardcoded English `sr-only` span (an upstream No-Touch zone, AGENTS.md #7).
 * `NavigationOverlay` CSS-hides it, but happy-dom applies no Tailwind, so it is
 * still in the tree — never address anything here by a bare name of "Close".
 *
 * Direction of these assertions: `en` was already green before the change (the
 * English default has to survive), and every non-English case was red. The
 * provider-less fallback is asserted in `chrome-i18n-no-provider-fallback.test.tsx`
 * — it cannot live in this file, see that file's header for why.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { NavigationOverlay } from '../custom/navigation-overlay';

const record = { _id: 'rec_1', name: 'Acme Corp' };

type DrawerOpts = {
  /** Omitted on purpose in the default-title cases. */
  title?: string;
  /** Presence of a storageKey is what renders the drag-resize handle. */
  storageKey?: string;
  onExpand?: () => void;
  expandLabel?: string;
};

function renderDrawer(language: string, opts: DrawerOpts = {}) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <NavigationOverlay
        isOpen
        isOverlay
        selectedRecord={record}
        mode="drawer"
        close={() => {}}
        setIsOpen={() => {}}
        {...opts}
      >
        {/* Deliberately NOT the record's name: the header title renders it too,
            and a body echo makes `getByText(title)` ambiguous. */}
        {() => <div>BODY CONTENT</div>}
      </NavigationOverlay>
    </I18nProvider>,
  );
}

afterEach(() => cleanup());

describe('NavigationOverlay drag-resize handle — accessible name (objectstack#5506)', () => {
  it('still reads English under an en session', () => {
    renderDrawer('en', { title: 'Acme Corp', storageKey: 'drawer-width:lead' });

    expect(screen.getByRole('separator').getAttribute('aria-label')).toBe('Resize drawer');
  });

  it('reads the zh bundle value under a zh session', () => {
    renderDrawer('zh', { title: 'Acme Corp', storageKey: 'drawer-width:lead' });

    expect(screen.getByRole('separator').getAttribute('aria-label')).toBe('调整面板宽度');
    expect(screen.queryByLabelText('Resize drawer')).toBeNull();
  });

  it('reads the de bundle value under a de session', () => {
    renderDrawer('de', { title: 'Acme Corp', storageKey: 'drawer-width:lead' });

    expect(screen.getByRole('separator').getAttribute('aria-label')).toBe('Panelbreite anpassen');
  });
});

describe('NavigationOverlay expand button — default label (objectstack#5506)', () => {
  it('still reads English under an en session', () => {
    renderDrawer('en', { title: 'Acme Corp', onExpand: () => {} });

    // Ours is the only expand affordance, and it carries both name and title.
    expect(screen.getByTitle('Open as full page').getAttribute('aria-label')).toBe(
      'Open as full page',
    );
  });

  it('reads the zh bundle value under a zh session', () => {
    renderDrawer('zh', { title: 'Acme Corp', onExpand: () => {} });

    expect(screen.getByTitle('以完整页面打开').getAttribute('aria-label')).toBe('以完整页面打开');
    expect(screen.queryByTitle('Open as full page')).toBeNull();
  });

  it('reads the ja bundle value under a ja session', () => {
    renderDrawer('ja', { title: 'Acme Corp', onExpand: () => {} });

    expect(screen.getByTitle('フルページで開く')).toBeTruthy();
  });

  /**
   * The prop is still an override, not merely a default hint — the console
   * passes its own `console.objectView.expandToPage` value through it, and that
   * must keep winning over the component's own key.
   */
  it("a host-supplied expandLabel still wins over the locale's default", () => {
    renderDrawer('zh', {
      title: 'Acme Corp',
      onExpand: () => {},
      expandLabel: '主机自定义标签',
    });

    expect(screen.getByTitle('主机自定义标签')).toBeTruthy();
    expect(screen.queryByTitle('以完整页面打开')).toBeNull();
  });
});

describe('NavigationOverlay default heading — visible copy (objectstack#5506)', () => {
  it('still reads English under an en session', () => {
    renderDrawer('en');

    expect(screen.getByText('Record Detail')).toBeTruthy();
  });

  it('reads the zh bundle value under a zh session', () => {
    renderDrawer('zh');

    expect(screen.getByText('记录详情')).toBeTruthy();
    expect(screen.queryByText('Record Detail')).toBeNull();
  });

  it('reads the ko bundle value under a ko session', () => {
    renderDrawer('ko');

    expect(screen.getByText('레코드 세부 정보')).toBeTruthy();
  });

  it('a host-supplied title still wins in every locale', () => {
    renderDrawer('zh', { title: 'Acme Corp' });

    expect(screen.getByText('Acme Corp')).toBeTruthy();
    expect(screen.queryByText('记录详情')).toBeNull();
  });
});

describe('NavigationOverlay sr-only description (objectstack#5506)', () => {
  it('still reads English under an en session, interpolating the title', () => {
    renderDrawer('en', { title: 'Acme Corp' });

    expect(screen.getByText('Record detail overlay for Acme Corp.')).toBeTruthy();
  });

  it('reads the zh bundle value under a zh session', () => {
    renderDrawer('zh', { title: 'Acme Corp' });

    expect(screen.getByText('Acme Corp 的记录详情浮层。')).toBeTruthy();
    expect(screen.queryByText('Record detail overlay for Acme Corp.')).toBeNull();
  });

  /**
   * The description interpolates `resolvedTitle`, so with no host title BOTH
   * halves have to come from the pack — a regression that localized the prose
   * but left the title fallback English would show up here and nowhere else.
   */
  it('interpolates the localized default title when the host passes none', () => {
    renderDrawer('zh');

    expect(screen.getByText('记录详情 的记录详情浮层。')).toBeTruthy();
  });

  it('is rendered in modal mode too', () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <NavigationOverlay
          isOpen
          isOverlay
          selectedRecord={record}
          mode="modal"
          close={() => {}}
          setIsOpen={() => {}}
          title="Acme Corp"
        >
          {() => <div>BODY CONTENT</div>}
        </NavigationOverlay>
      </I18nProvider>,
    );

    expect(screen.getByText('Acme Corp 的记录详情浮层。')).toBeTruthy();
  });
});
