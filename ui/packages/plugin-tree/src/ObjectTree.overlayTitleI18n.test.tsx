/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectTree`'s record-detail overlay heading speaks the session locale —
 * objectui#3459 (the #3426 family).
 *
 * ── Why this path is user-reachable (the issue left it unverified) ─────────
 * `object-tree` / `tree` are registered renderer types
 * (`packages/plugin-tree/src/index.tsx`), so any page schema that names one
 * resolves through `ComponentRegistry`. `ObjectTree` reads `schema.navigation`
 * and hands it to `useNavigationOverlay`, which turns
 * `mode: 'drawer' | 'modal' | 'split' | 'popover'` into `isOverlay`; every row's
 * `onClick` is wired to `navigation.handleClick`. So authored metadata of the
 * form `{ type: 'tree', objectName, navigation: { mode: 'drawer' } }` opens
 * exactly this overlay on row click — the path the test below drives.
 *
 * Unlike `object-grid`/`object-kanban`, `object-tree` is NOT in the curated
 * `PUBLIC_BLOCKS` contract, so it is a rendering capability rather than part of
 * the AI-authoring vocabulary — and unlike the kanban it has NO default
 * navigation config, so the overlay needs `navigation` to be authored
 * explicitly. Both narrow how the heading is reached; neither makes it dead.
 * The hosts that embed a tree (`ListView`, `plugin-view`'s `ObjectView`) never
 * forward `navigation` and `ListView` additionally passes its own `onRowClick`,
 * so those paths suppress this overlay entirely — host overrides, not proof of
 * a dead branch.
 *
 * ── Direction of these assertions ─────────────────────────────────────────
 * The non-English cases (zh / ja / de) were RED before the change — the overlay
 * carried the bare literal `"Record Details"`, so a zh session read one English
 * heading on an otherwise localized drawer — and are GREEN after.
 *
 * The `en` case is the ONE assertion in this PR that was RED before and is
 * GREEN after in English too, and that is deliberate, not a regression: the
 * literal was the stray plural `Record Details`, and per the maintainer's
 * ruling on #3459 it normalizes to the singular `detail.recordDetail`
 * (`Record Detail`) that the whole `detail.*` family — including the default
 * `NavigationOverlay` itself falls back to — already spells. A repo-wide grep
 * for `Record Details` before the change found no `e2e/` spec and no unit test
 * addressing the plural; the only other hit is an unrelated designer palette
 * label in `plugin-detail`'s registration.
 *
 * The provider-less fallback is asserted in
 * `ObjectTree.overlayTitleNoProviderFallback.test.tsx` — it cannot live in this
 * file, because `createI18n` registers its instance as react-i18next's
 * module-global default and that registration survives `cleanup()`; a
 * "no provider" render here would silently resolve against whichever locale a
 * previous test mounted.
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
import { ObjectTree } from './ObjectTree';

// A small self-referencing org hierarchy.
const orgUnits = [
  { id: '1', name: 'Acme', parent_id: null, head: 'CEO' },
  { id: '2', name: 'Engineering', parent_id: '1', head: 'VP Eng' },
];

function renderTreeIn(language: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ObjectTree
        schema={{
          type: 'object-tree',
          objectName: 'business_unit',
          parentField: 'parent_id',
          labelField: 'name',
          fields: ['name', 'head'],
          navigation: { mode: 'drawer' },
        } as never}
        data={orgUnits}
      />
    </I18nProvider>,
  );
}

/** Open the detail overlay the way a user does: click a row. */
async function openOverlay() {
  const cell = await screen.findByText('Acme');
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

describe('ObjectTree record-detail overlay heading (objectui#3459)', () => {
  it('renders the singular English heading under an en session', async () => {
    renderTreeIn('en');
    await openOverlay();

    expect(screen.getByText('Record Detail')).toBeInTheDocument();
    // The stray plural is gone — one control, one spelling (maintainer ruling).
    expect(screen.queryByText('Record Details')).toBeNull();
  });

  it('renders the zh bundle value under a zh session', async () => {
    renderTreeIn('zh');
    await openOverlay();

    expect(screen.getByText('记录详情')).toBeInTheDocument();
    // The whole point of the issue: no English leaks into a zh drawer.
    expect(screen.queryByText('Record Details')).toBeNull();
    expect(screen.queryByText('Record Detail')).toBeNull();
  });

  it('renders the ja bundle value under a ja session', async () => {
    renderTreeIn('ja');
    await openOverlay();

    expect(screen.getByText('レコード詳細')).toBeInTheDocument();
  });

  it('renders the de bundle value under a de session', async () => {
    renderTreeIn('de');
    await openOverlay();

    expect(screen.getByText('Datensatzdetails')).toBeInTheDocument();
  });
});
