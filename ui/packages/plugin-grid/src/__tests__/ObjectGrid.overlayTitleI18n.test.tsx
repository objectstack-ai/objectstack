/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectGrid`'s record-detail overlay heading speaks the session locale —
 * objectui#3426.
 *
 * ── Why this path is user-reachable (the issue left it unverified) ─────────
 * `object-grid` / `grid` are PUBLIC page blocks (`packages/core/src/registry/
 * public-blocks.ts`) and `navigation` is an authorable key on the grid schema
 * (`ViewNavigationConfig`, aligned with `@objectstack/spec ListView.navigation`).
 * `useNavigationOverlay` turns `mode: 'drawer' | 'modal' | 'split' | 'popover'`
 * into `isOverlay`, and `ObjectGrid` wires `navigation.handleClick` onto every
 * row. So any page metadata that drops a grid block with an overlay navigation
 * mode gets this drawer — no console/app-shell involvement.
 *
 * The one host that DOES suppress it is `app-shell`'s `ObjectView`, which
 * passes its own `onRowClick` (that takes full priority inside
 * `useNavigationOverlay`) and renders its own overlay. That is a host override,
 * not proof the branch is dead: `ObjectView` is one consumer of a public block.
 *
 * ── Direction of these assertions ─────────────────────────────────────────
 * The non-English cases (zh / ja / de) were RED before the change — the drawer
 * was titled by a TypeScript template literal (`` `${schema.label} Detail` ``),
 * so a zh session read "Contacts Detail" — and are GREEN after. The `en` cases
 * were GREEN before AND after: they pin that routing the heading through `t()`
 * did not change a single byte of what an English session sees, in all three
 * branches (label / objectName / neither).
 *
 * The provider-less fallback is asserted in
 * `ObjectGrid.overlayTitleNoProviderFallback.test.tsx` — it cannot live in this
 * file, because `createI18n` registers its instance as react-i18next's
 * module-global default and that registration survives `cleanup()`; a
 * "no provider" render in this file would silently resolve against whichever
 * locale a previous test mounted.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  assertNoOtherNetworkEscape,
  installRecordSecurityExplainDouble,
} from '@object-ui/test-support';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

const rows = [
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' },
];

function renderGridIn(language: string, schemaExtra: Record<string, unknown>) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ActionProvider>
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: 'contacts',
            columns: [{ field: 'name', label: 'Name' }],
            data: { provider: 'value', items: rows },
            navigation: { mode: 'drawer' },
            ...schemaExtra,
          } as never}
        />
      </ActionProvider>
    </I18nProvider>,
  );
}

/** Open the detail overlay the way a user does: click a row. */
async function openOverlay() {
  const cell = await screen.findByText('Alice');
  fireEvent.click(cell);
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
}

/**
 * objectui#9299 — this renderer's record overlay mounts the shared
 * `RecordDetailPanel` now, and its `DetailView` asks
 * `POST /api/v1/security/explain` whether the record may be updated and
 * deleted. With no host `apiFetch` that call degrades to the global `fetch`,
 * which under happy-dom is a real HTTP client — so it is served from a double
 * rather than from the network. Nothing below reads the verdict: the double is
 * permissive and `useRecordEditable` fails open, so no assertion here moves.
 */
beforeEach(() => installRecordSecurityExplainDouble(vi));
afterEach(() => {
  // A request to any OTHER endpoint reds here rather than vanishing into
  // `useRecordEditable`'s best-effort `catch`.
  assertNoOtherNetworkEscape(expect);
  // Unmount BEFORE restoring the real `fetch`: vitest runs `afterEach` hooks in
  // reverse registration order, so this one runs before the root setup's RTL
  // cleanup, and unstubbing first would leave the tree mounted with the real
  // global back in place (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
});

describe('ObjectGrid record-detail overlay heading (objectui#3426)', () => {
  it('renders the authored label in English under an en session', async () => {
    renderGridIn('en', { label: 'Contacts' });
    await openOverlay();

    expect(screen.getByText('Contacts Detail')).toBeInTheDocument();
  });

  it('renders the zh bundle value under a zh session', async () => {
    renderGridIn('zh', { label: '联系人' });
    await openOverlay();

    expect(screen.getByText('联系人详情')).toBeInTheDocument();
    // The whole point of the issue: no English leaks into a zh drawer.
    expect(screen.queryByText('联系人 Detail')).toBeNull();
  });

  it('renders the ja bundle value under a ja session', async () => {
    renderGridIn('ja', { label: '取引先' });
    await openOverlay();

    expect(screen.getByText('取引先の詳細')).toBeInTheDocument();
  });

  it('renders the de bundle value under a de session', async () => {
    renderGridIn('de', { label: 'Kontakte' });
    await openOverlay();

    expect(screen.getByText('Kontakte-Details')).toBeInTheDocument();
  });

  /**
   * Second branch: no `label`, so the heading is built from the capitalized
   * `objectName`. Same key, same interpolation — this exists because the
   * branch is separately spelled in the source and a partial fix would leave
   * it English.
   */
  it('falls back to the capitalized objectName through the same key', async () => {
    renderGridIn('zh', {});
    await openOverlay();

    expect(screen.getByText('Contacts详情')).toBeInTheDocument();
  });

  /**
   * Third branch: neither label nor objectName — reuses `detail.recordDetail`,
   * the very key `NavigationOverlay` defaults to. Pins that the two headings
   * cannot drift into two different translations of one control.
   */
  it('reuses detail.recordDetail when the schema names nothing', async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <ActionProvider>
          <ObjectGrid
            schema={{
              type: 'object-grid',
              columns: [{ field: 'name', label: 'Name' }],
              data: { provider: 'value', items: rows },
              navigation: { mode: 'drawer' },
            } as never}
          />
        </ActionProvider>
      </I18nProvider>,
    );
    await openOverlay();

    expect(screen.getByText('记录详情')).toBeInTheDocument();
  });
});
