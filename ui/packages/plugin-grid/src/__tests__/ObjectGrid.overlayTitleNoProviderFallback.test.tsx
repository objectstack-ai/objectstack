/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectGrid`'s record-detail overlay heading still resolves to ENGLISH, and
 * to the SAME BYTES as before, when no `I18nProvider` is mounted —
 * objectui#3426.
 *
 * This is not a nice-to-have. Routing a literal through `t()` without a working
 * default is exactly how a provider-less consumer breaks, and it breaks in a
 * suite that is not this one: `object-grid` is a public page block, so any host
 * that renders schema without mounting a provider (this package's own tests,
 * the preview gallery, an embedding app) reads whatever the defaults map says.
 * The English defaults live in `GRID_DEFAULT_TRANSLATIONS` (`ObjectGrid.tsx`) —
 * that map is what `createSafeTranslation` falls back to when its `grid.actions`
 * probe comes back unresolved.
 *
 * The byte-identity matters beyond aesthetics: the heading is `Contacts Detail`
 * before the change and `Contacts Detail` after, so e2e specs and host tests
 * that address this chrome by its English name keep addressing it.
 *
 * Direction: this file was GREEN before the change and is GREEN after. It pins
 * the FALLBACK, not the fix — the fix is asserted in
 * `ObjectGrid.overlayTitleI18n.test.tsx`. A missing map entry would have turned
 * it red by rendering the raw key `detail.recordDetailWithLabel`, which is
 * precisely the regression it exists to catch.
 *
 * ── The second describe block has the opposite direction (objectui#9092) ──
 * The `inline locale map label` block below was RED before objectui#9092's grid
 * fix and is GREEN after. It belongs in THIS file rather than in a third one
 * because the defect is path-specific: a map label reaches `[object Object]`
 * through TWO different interpolators, i18next's and this file's provider-less
 * `interpolateFallback` (`i18n/src/fallbackInterpolation.ts`, `String(v)`), and
 * a pin that exercised only the provider path would leave the `String(v)` arm
 * unmeasured. The file-splitting rule below is what makes this arm reachable at
 * all, so it is a reason to keep that rule, not an exception to it.
 *
 * ── Why this is its own FILE, not a describe block ────────────────────────
 * `createI18n` calls `instance.use(initReactI18next)`, and `initReactI18next`
 * registers that instance as **react-i18next's module-global default**. The
 * registration survives unmount and `cleanup()`. So the moment any test in a
 * file mounts `<I18nProvider config={{ defaultLanguage: 'zh' }}>`, every later
 * "no provider" render in that same file silently resolves against the Chinese
 * instance — a green-looking file that asserts nothing about the fallback.
 *
 * Vitest's `dom` project runs with `isolate: true`, so a file that never mounts
 * a provider gets a genuinely clean global. Keep it that way: **do not import
 * or mount `I18nProvider` here.**
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  assertNoOtherNetworkEscape,
  installRecordSecurityExplainDouble,
} from '@object-ui/test-support';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import type { ObjectGridSchema } from '@object-ui/types';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

/** Typed against the DECLARED face — see the sibling file's note on why. */
type GridLabel = NonNullable<ObjectGridSchema['label']>;

const rows = [
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' },
];

function renderGrid(schemaExtra: Record<string, unknown>) {
  return render(
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          columns: [{ field: 'name', label: 'Name' }],
          data: { provider: 'value', items: rows },
          navigation: { mode: 'drawer' },
          ...schemaExtra,
        } as never}
      />
    </ActionProvider>,
  );
}

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

describe('ObjectGrid overlay heading — English fallback with no provider (objectui#3426)', () => {
  it('interpolates the authored label in English, never the raw key', async () => {
    renderGrid({ objectName: 'contacts', label: 'Contacts' });
    await openOverlay();

    expect(screen.getByText('Contacts Detail')).toBeInTheDocument();
    expect(screen.queryByText('detail.recordDetailWithLabel')).toBeNull();
  });

  it('capitalizes objectName in English when no label is authored', async () => {
    renderGrid({ objectName: 'contacts' });
    await openOverlay();

    expect(screen.getByText('Contacts Detail')).toBeInTheDocument();
  });

  it('falls back to the bare English heading when the schema names nothing', async () => {
    renderGrid({});
    await openOverlay();

    expect(screen.getByText('Record Detail')).toBeInTheDocument();
    expect(screen.queryByText('detail.recordDetail')).toBeNull();
  });
});

describe('ObjectGrid overlay heading — inline locale map label, no provider (objectui#9092)', () => {
  it('resolves the map before interpolation, never `String(v)`s it', async () => {
    const label: GridLabel = { en: 'Accounts', zh: '联系人' };
    renderGrid({ objectName: 'contacts', label });
    await openOverlay();

    // `interpolateFallback` runs each value through `String(v)`. Unresolved,
    // this heading reads `[object Object] Detail` — user-visible chrome.
    expect(screen.getByText('Accounts Detail')).toBeInTheDocument();
    expect(screen.queryByText('[object Object] Detail')).toBeNull();
    expect(screen.queryByText('detail.recordDetailWithLabel')).toBeNull();
  });

  it('CONTROL — a plain-string label renders the same bytes it always did', async () => {
    const label: GridLabel = 'Accounts';
    renderGrid({ objectName: 'contacts', label });
    await openOverlay();

    expect(screen.getByText('Accounts Detail')).toBeInTheDocument();
    expect(screen.queryByText('[object Object] Detail')).toBeNull();
  });

  it('falls through to the capitalized objectName when the map resolves to nothing', async () => {
    const label: GridLabel = {};
    renderGrid({ objectName: 'contacts', label });
    await openOverlay();

    expect(screen.getByText('Contacts Detail')).toBeInTheDocument();
  });
});
