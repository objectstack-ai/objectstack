/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RecordDetailDrawer`'s resize-handle name still resolves to ENGLISH when no
 * `I18nProvider` is mounted — objectstack#5733.
 *
 * This is not a nice-to-have. Routing a literal through `t()` without a working
 * default is exactly how a provider-less consumer breaks, and it breaks in a
 * suite that is not this one. `RecordDetailDrawer` is embedded by
 * `plugin-kanban`'s `ObjectKanban` and `plugin-calendar`'s `ObjectCalendar`
 * (and mocked out by `plugin-gantt`'s), none of which wrap it in an
 * `I18nProvider`; the same goes for any host app that never mounts one. The
 * English default lives in `DETAIL_DEFAULT_TRANSLATIONS`
 * (`useDetailTranslation.ts`) — that map is what `createSafeTranslation` falls
 * back to when its `detail.back` probe comes back unresolved.
 *
 * Direction: this file was GREEN before the change and is GREEN after. It pins
 * the FALLBACK, not the fix — the fix is asserted in
 * `RecordDetailDrawer.resizeHandleI18n.test.tsx`. A missing map entry would
 * have turned it red by rendering the raw key `common.resizeDrawer`, which is
 * precisely the regression it exists to catch.
 *
 * ── Why this is its own FILE, not a describe block ────────────────────────
 * `createI18n` calls `instance.use(initReactI18next)`, and `initReactI18next`
 * registers that instance as **react-i18next's module-global default**. The
 * registration survives unmount and `cleanup()`. So the moment any test in a
 * file mounts `<I18nProvider config={{ defaultLanguage: 'de' }}>`, every later
 * "no provider" render in that same file silently resolves against the German
 * instance — a green-looking file that asserts nothing about the fallback, or a
 * confusing red where the drawer announces "Panelbreite anpassen" under a test
 * that mounted no provider at all.
 *
 * Vitest's `dom` project runs with `isolate: true`, so a file that never mounts
 * a provider gets a genuinely clean global. Keep it that way: **do not import
 * or mount `I18nProvider` here.**
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RecordDetailDrawer } from '../RecordDetailDrawer';

vi.mock('../DetailView', () => ({
  DetailView: () => <div data-testid="dv-probe" />,
}));

vi.mock('../InlineEditSaveBar', () => ({
  InlineEditSaveBar: () => null,
}));

afterEach(() => cleanup());

describe('RecordDetailDrawer resize handle — English fallback with no provider (objectstack#5733)', () => {
  it('names the drag handle in English, never the raw key', () => {
    render(
      <RecordDetailDrawer
        open
        onClose={() => {}}
        title="Task Details"
        record={{ id: '1', name: 'Hello' }}
        objectName="tasks"
        recordId="1"
      />,
    );

    const handle = screen.getByRole('separator');
    expect(handle.getAttribute('aria-label')).toBe('Resize drawer');
    // A missing DETAIL_DEFAULT_TRANSLATIONS entry surfaces as the raw key,
    // because createSafeTranslation's fallback is `defaults[key] || key`.
    expect(handle.getAttribute('aria-label')).not.toBe('common.resizeDrawer');
    expect(screen.getByLabelText('Resize drawer')).toBeTruthy();
  });
});
