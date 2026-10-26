/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectView`'s split-mode record-detail heading speaks the session locale —
 * objectui#3459 (the #3426 family).
 *
 * ── Why this path is user-reachable (the issue left it unverified) ─────────
 * `object-view` / `view` are registered renderer types
 * (`packages/plugin-view/src/index.tsx`) and `navigation` is a DECLARED
 * authorable input on that registration (`{ name: 'navigation', type:
 * 'object', label: 'Navigation Config' }`), typed as `ViewNavigationConfig`
 * whose `mode` union includes `'split'`. `handleRowClick` turns a click under
 * `mode: 'split'` into `setSelectedRecord(record); setIsFormOpen(true)`, and
 * `formLayout` maps that same mode to the `split` branch that renders
 * `NavigationOverlay` with this heading. So authored metadata of the form
 * `{ type: 'object-view', objectName, navigation: { mode: 'split' } }` reaches
 * it on a row click — the path the test below drives.
 *
 * `layout` cannot get you here: `ObjectViewSchema.layout` is
 * `'drawer' | 'modal' | 'page'` and `deriveRecordSurface` only ever returns
 * `'drawer'` or `'page'`, so `navigation.mode` is the only door. The one host
 * that suppresses the branch is `app-shell`'s `ObjectView` wrapper, which pins
 * `layout: 'page'` and supplies `onNavigate` — a host override of a registered
 * block, not proof the branch is dead.
 *
 * ── Direction of these assertions ─────────────────────────────────────────
 * The non-English cases (zh / ja / de) were RED before the change — the panel
 * was headed by a TypeScript template literal (`` `${objectLabel} Detail` ``),
 * so a zh session read "联系人 Detail" — and are GREEN after. The `en` case was
 * GREEN before AND after: it pins that routing the heading through `t()` did
 * not change a single byte of what an English session sees. No plural is
 * involved on this site, so nothing visible changes in English here.
 *
 * The provider-less fallback is asserted in
 * `ObjectView.overlayTitleNoProviderFallback.test.tsx` — it cannot live in this
 * file, because `createI18n` registers its instance as react-i18next's
 * module-global default and that registration survives `cleanup()`; a
 * "no provider" render here would silently resolve against whichever locale a
 * previous test mounted.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import type { DataSource } from '@object-ui/types';
import { ObjectView } from '../ObjectView';
import { installExplainDouble } from './explainDouble';

const rows = [{ id: '1', name: 'Alice' }];

/** Minimal DataSource: `ObjectGrid` reads `result.data`, the label comes from the schema. */
function dataSourceLabelled(label: string): DataSource {
  return {
    find: vi.fn().mockResolvedValue({ data: rows, total: rows.length }),
    findOne: vi.fn().mockResolvedValue(rows[0]),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'contacts',
      label,
      fields: { name: { label: 'Name', type: 'text' } },
    }),
  } as unknown as DataSource;
}

function renderViewIn(language: string, label: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ObjectView
        schema={{
          type: 'object-view',
          objectName: 'contacts',
          navigation: { mode: 'split' },
          table: { fields: ['name'] },
        } as never}
        dataSource={dataSourceLabelled(label)}
      />
    </I18nProvider>,
  );
}

/** Open the split detail panel the way a user does: click a row. */
async function openSplitPanel() {
  const cell = await screen.findByText('Alice');
  fireEvent.click(cell);
}

// objectui#4688 — ObjectGrid batches a record-level explain probe for the
// rows on screen; with no host `apiFetch` here it would otherwise escape to
// the real network under happy-dom. See `explainDouble.ts`.
beforeEach(() => installExplainDouble());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ObjectView split-mode detail heading (objectui#3459)', () => {
  it('renders the object label in English under an en session', async () => {
    renderViewIn('en', 'Contacts');
    await openSplitPanel();

    await waitFor(() => expect(screen.getByText('Contacts Detail')).toBeInTheDocument());
  });

  it('renders the zh bundle arrangement under a zh session', async () => {
    renderViewIn('zh', '联系人');
    await openSplitPanel();

    await waitFor(() => expect(screen.getByText('联系人详情')).toBeInTheDocument());
    // The whole point of the issue: no English leaks into a zh panel.
    expect(screen.queryByText('联系人 Detail')).toBeNull();
  });

  it('renders the ja bundle arrangement under a ja session', async () => {
    renderViewIn('ja', '取引先');
    await openSplitPanel();

    await waitFor(() => expect(screen.getByText('取引先の詳細')).toBeInTheDocument());
  });

  it('renders the de bundle arrangement under a de session', async () => {
    renderViewIn('de', 'Kontakte');
    await openSplitPanel();

    await waitFor(() => expect(screen.getByText('Kontakte-Details')).toBeInTheDocument());
  });
});
