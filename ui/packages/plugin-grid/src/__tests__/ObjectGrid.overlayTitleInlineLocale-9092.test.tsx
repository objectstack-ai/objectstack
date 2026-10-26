/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectGrid`'s record-detail overlay heading resolves an INLINE locale map
 * label instead of stringifying it — objectui#9092.
 *
 * ── Why this site needed its own pin ──────────────────────────────────────
 * objectui#9092 restored `ObjectGridSchema.label` to `string | I18nLabel`, the
 * form `BaseSchema` has carried since objectui#4580. The other two reads in
 * `ObjectGrid.tsx` that put the label in a string position were found because
 * `tsc` NAMED them: the data-table `caption` and the export `viewLabel` are
 * both `string`-typed sinks, so the widening surfaced them as compile errors.
 *
 * This one is different, and that is the transferable part: `detailTitle` hands
 * the label to `createSafeTranslation`'s `t(key, options)`, whose options
 * parameter is `Record<string, unknown>` (`i18n/src/useSafeTranslation.ts`). An
 * `unknown`-typed sink SWALLOWS the diagnostic, so an inventory built from
 * compiler errors cannot reach this site — it has to be found by hand. After a
 * widening, `tsc` finds the typed readers; `t()` options, `String(…)`, template
 * literals and `JSON.stringify` do not report.
 *
 * ── What goes wrong when it is missed ─────────────────────────────────────
 * `detailTitle` is handed to `NavigationOverlay`'s `title` prop (three call
 * sites in `ObjectGrid.tsx`), which means it IS the visible heading of the
 * record-detail drawer/modal/split/popover — not a diagnostic, not a log line.
 * An unresolved map interpolates as `[object Object]`, on BOTH i18n paths:
 * i18next substitutes the raw value into `'{{label}} Detail'`, and the
 * provider-less fallback runs it through `String(v)`
 * (`i18n/src/fallbackInterpolation.ts`). So the user-visible heading reads
 * `[object Object] Detail`.
 *
 * ── Direction of these assertions (red-first) ─────────────────────────────
 * The map cases were RED before the fix (`[object Object] Detail`) and are
 * GREEN after (`Accounts Detail` / `联系人详情`). The STRING cases were GREEN
 * before AND after: they are the control that must not move — resolving a plain
 * string through `resolveI18nLabel` returns it unchanged, so English (and every
 * other) output on the string arm is byte-identical to what objectui#3426 left.
 *
 * The provider-LESS half of the same fix is asserted in
 * `ObjectGrid.overlayTitleNoProviderFallback.test.tsx`. It cannot live in this
 * file: `createI18n` registers its instance as react-i18next's module-global
 * default and that registration survives `cleanup()`, so a "no provider" render
 * here would silently resolve against whichever locale a previous test mounted.
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
import type { ObjectGridSchema } from '@object-ui/types';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

/**
 * Typed against the DECLARED face on purpose. `tsc -p tsconfig.test.json` reads
 * this file, so re-narrowing `ObjectGridSchema.label` back to a plain `string`
 * fails the type half of this pin as well as the runtime half.
 */
type GridLabel = NonNullable<ObjectGridSchema['label']>;

const MAP_LABEL: GridLabel = { en: 'Accounts', zh: '联系人' };
const STRING_LABEL: GridLabel = 'Accounts';
/** An entry-less map resolves to `undefined` — the `objectName` branch must take over. */
const ENTRYLESS_MAP: GridLabel = {};
/** An empty entry resolves to `''` — falsy, so the same fallthrough applies. */
const EMPTY_ENTRY_MAP: GridLabel = { en: '' };

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

describe('ObjectGrid record-detail overlay heading — inline locale map label (objectui#9092)', () => {
  it('resolves the map against the display locale instead of stringifying it', async () => {
    renderGridIn('en', { label: MAP_LABEL });
    await openOverlay();

    expect(screen.getByText('Accounts Detail')).toBeInTheDocument();
    // The defect this pin exists to catch, spelled out rather than implied.
    expect(screen.queryByText('[object Object] Detail')).toBeNull();
  });

  it('CONTROL — a plain-string label renders the same bytes it always did', async () => {
    renderGridIn('en', { label: STRING_LABEL });
    await openOverlay();

    expect(screen.getByText('Accounts Detail')).toBeInTheDocument();
    expect(screen.queryByText('[object Object] Detail')).toBeNull();
  });

  it('reads the session locale, not a hard-coded `en` arm', async () => {
    // Proves the resolver is wired to `useDisplayLocale()`: the same map picks
    // its zh entry, and the zh bundle's own word order (`{{label}}详情`) applies.
    renderGridIn('zh', { label: MAP_LABEL });
    await openOverlay();

    expect(screen.getByText('联系人详情')).toBeInTheDocument();
    expect(screen.queryByText('[object Object]详情')).toBeNull();
  });

  it('falls through to the capitalized objectName when the map resolves to nothing', async () => {
    // An entry-less map is the one input `resolveI18nLabel` answers `undefined`
    // for. The old `schema.label ? …` test was TRUTHY for it (any object is),
    // so the heading would have interpolated an empty-ish object; the branch
    // must land on `objectName` exactly as a missing label always did.
    renderGridIn('en', { label: ENTRYLESS_MAP });
    await openOverlay();

    expect(screen.getByText('Contacts Detail')).toBeInTheDocument();
  });

  it('falls through to the capitalized objectName when the entry is empty', async () => {
    renderGridIn('en', { label: EMPTY_ENTRY_MAP });
    await openOverlay();

    expect(screen.getByText('Contacts Detail')).toBeInTheDocument();
  });
});
