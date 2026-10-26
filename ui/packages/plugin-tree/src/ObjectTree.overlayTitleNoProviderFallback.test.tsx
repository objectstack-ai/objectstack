/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectTree`'s record-detail overlay heading still resolves to ENGLISH when
 * no `I18nProvider` is mounted — objectui#3459.
 *
 * This is not a nice-to-have. Routing a literal through `t()` without a working
 * default is exactly how a provider-less consumer breaks, and it breaks in a
 * suite that is not this one: a tree renders wherever its type is registered,
 * so any host that renders schema without mounting a provider (this package's
 * own tests, the preview gallery, an embedding app) reads whatever the defaults
 * map says. The English default lives in `TREE_DEFAULT_TRANSLATIONS`
 * (`ObjectTree.tsx`) — that map is what `createSafeTranslation` falls back to
 * when its `detail.recordDetail` probe comes back unresolved.
 *
 * Direction: unlike its kanban / view siblings, this file was RED before the
 * change and is GREEN after, in English. That is the deliberate visible change
 * the maintainer ruled on for #3459: the old literal was the stray plural
 * `Record Details`, normalized here to the singular `detail.recordDetail`
 * spelling shared with `NavigationOverlay`'s own default. A missing map entry
 * would turn this red the other way, by rendering the raw key
 * `detail.recordDetail` — precisely the regression it also exists to catch.
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
import { ObjectTree } from './ObjectTree';

const orgUnits = [
  { id: '1', name: 'Acme', parent_id: null, head: 'CEO' },
  { id: '2', name: 'Engineering', parent_id: '1', head: 'VP Eng' },
];

function renderTree() {
  return render(
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
    />,
  );
}

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

describe('ObjectTree overlay heading — English fallback with no provider (objectui#3459)', () => {
  it('falls back to the English heading, never the raw key', async () => {
    renderTree();
    await openOverlay();

    expect(screen.getByText('Record Detail')).toBeInTheDocument();
    expect(screen.queryByText('detail.recordDetail')).toBeNull();
  });
});
