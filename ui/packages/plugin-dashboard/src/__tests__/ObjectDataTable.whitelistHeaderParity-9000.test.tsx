/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9000 — an authored drill `columns` whitelist must not DEGRADE the
 * headers of the table it narrows.
 *
 * ## The asymmetry
 *
 * `ObjectDataTable` derives headers on two branches of one `useMemo`, and both
 * call the same `fieldLabel` lookup. Only the FALLBACK differed:
 *
 *   auto-derive branch   fieldLabel(objectName, k, humanizeFieldKey(k))
 *   whitelist branch     fieldLabel(objectName, col.accessorKey, col.header)
 *
 * A column authored as a bare string is humanized by `normalizeColumns`, so the
 * string shorthand always agreed. The OBJECT form did not: both drill callers
 * build `{ accessorKey: c, header: c }` from a `drillDown.columns` string list,
 * so `col.header` IS the raw field key, and the whitelist branch handed that
 * raw key to `fieldLabel` as its fallback. When no bundle entry resolves — the
 * ordinary case in a drill — the more deliberate configuration produced the
 * less finished table.
 *
 * ## The oracle is PARITY, not a string
 *
 * The acceptance assertion below is "the two branches agree, key for key",
 * taken over one render of each. A per-branch assertion (`expect(header).toBe
 * ('Close Date')`) would go green on a repair that humanized both branches into
 * a new shared wrongness; parity plus the shared `humanizeFieldKey` convention
 * anchor cannot.
 *
 * ## The control that must stay green on BOTH ablation legs
 *
 * The fallback fires for EVERY caller of the whitelist branch, not only for the
 * two drill callers that pass a raw key. `normalizeColumns` resolves the
 * spec-canonical `{ field, label }` and the adapter-canonical
 * `{ accessorKey, header }` into that same `col.header` (objectui#5351), and
 * `DashboardRenderer` forwards an authored dashboard widget's `columns`
 * verbatim into this widget. So a genuine author-written label reaches this
 * branch too — and humanizing it UNCONDITIONALLY would clobber it, a worse
 * defect than the one being fixed. `AUTHORED LABEL` below is that control: it
 * is green before the fix and must stay green after it, and it is the
 * assertion that fails if the fallback is ever made unconditional.
 *
 * ## DIRECTIONS, written before the reverse verification was run
 *
 * Predicted RED on `origin/main`: the two PARITY assertions (both the drawer's
 * end-to-end pair and the widget-level pair) — they read `close_date` /
 * `needs_analysis` where the auto-derived row reads `Close Date` /
 * `Needs Analysis`. Predicted GREEN on both sides: every `AUTHORED LABEL`
 * assertion and the i18n `BUNDLE ENTRY` assertions — the fix touches only the
 * fallback handed to `fieldLabel`. Measured result recorded in the PR body.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { I18nProvider } from '@object-ui/i18n';

import { DrillDownDrawer } from '../DrillDownDrawer';
import { ObjectDataTable } from '../ObjectDataTable';
import { humanizeFieldKey } from '../utils';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '@object-ui/components';

/**
 * Keys chosen so the humanized spelling is VISIBLY different from the raw key:
 * a snake_case key is the case where the two disagree. `unitPrice` is the
 * camelCase control — `humanizeFieldKey` and the raw key still differ there.
 */
const FIELD_ORDER = ['close_date', 'needs_analysis', 'unitPrice'];
const WHITELIST = ['close_date', 'needs_analysis'];

const OPPORTUNITY = {
  name: 'crm_opportunity',
  fields: {
    close_date: { type: 'date' },
    needs_analysis: { type: 'text' },
    unitPrice: { type: 'number' },
  },
};

const ROWS = [{ close_date: '2026-01-01', needs_analysis: 'x', unitPrice: 3 }];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: ROWS })),
    getObjectSchema: vi.fn(async () => OPPORTUNITY),
  };
}

const headers = (): string[] =>
  Array.from(document.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());

async function renderDrawer(columns?: string[]): Promise<string[]> {
  render(
    <DrillDownDrawer
      open
      onClose={vi.fn()}
      title="Won x Web"
      objectName="crm_opportunity"
      filter={{ stage: 'won' }}
      columns={columns}
      dataSource={makeDataSource()}
    />,
  );
  await waitFor(() => expect(headers().length).toBeGreaterThan(0));
  return headers();
}

async function renderWidget(
  columns: unknown[] | undefined,
  wrap?: (node: React.ReactElement) => React.ReactElement,
): Promise<string[]> {
  const node = (
    <ObjectDataTable
      schema={{ type: 'object-data-table', objectName: 'crm_opportunity', columns } as any}
      dataSource={makeDataSource()}
    />
  );
  render(wrap ? wrap(node) : node);
  await waitFor(() => expect(headers().length).toBeGreaterThan(0));
  return headers();
}

/** The exact mapping both drill callers apply to `drillDown.columns`. */
const asDrillColumns = (keys: string[]) => keys.map((c) => ({ accessorKey: c, header: c }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('objectui#9000 — a `columns` whitelist narrows the table, it does not degrade it', () => {
  it('PARITY, end to end through the drill drawer: whitelisted headers equal auto-derived headers', async () => {
    // Both readings come from the same object schema, the same data source and
    // the same locale; the whitelist is the only thing that differs.
    const auto = await renderDrawer(undefined);
    expect(auto).toHaveLength(FIELD_ORDER.length);
    const autoByKey = Object.fromEntries(FIELD_ORDER.map((k, i) => [k, auto[i]]));
    cleanup();

    const declared = await renderDrawer(WHITELIST);

    expect(declared).toEqual(WHITELIST.map((k) => autoByKey[k]));
  });

  it('PARITY at the widget seam, over the object column shape the drill callers build', async () => {
    const auto = await renderWidget(undefined);
    const autoByKey = Object.fromEntries(FIELD_ORDER.map((k, i) => [k, auto[i]]));
    cleanup();

    const declared = await renderWidget(asDrillColumns(WHITELIST));

    expect(declared).toEqual(WHITELIST.map((k) => autoByKey[k]));
    // The convention anchor, referenced rather than spelled: parity alone would
    // also hold if BOTH branches moved to a new shared wrongness.
    expect(declared).toEqual(WHITELIST.map(humanizeFieldKey));
  });

  it('PARITY holds for the string shorthand too (it always did — pinned so the fix is not misread)', async () => {
    const auto = await renderWidget(undefined);
    const autoByKey = Object.fromEntries(FIELD_ORDER.map((k, i) => [k, auto[i]]));
    cleanup();

    const declared = await renderWidget(WHITELIST);

    expect(declared).toEqual(WHITELIST.map((k) => autoByKey[k]));
  });

  it('AUTHORED LABEL — an adapter-spelled `header` survives the fallback', async () => {
    // Green before AND after. An unconditional humanize renders "Close Date"
    // here and fails: the author's label would have been clobbered.
    const declared = await renderWidget([{ accessorKey: 'close_date', header: 'Deal Close' }]);
    expect(declared).toEqual(['Deal Close']);
  });

  it('AUTHORED LABEL — a spec-spelled `label` survives the fallback', async () => {
    // The same control seen through the other authoring spelling
    // (objectui#5351 resolves `{ field, label }` into the same `col.header`).
    const declared = await renderWidget([{ field: 'close_date', label: 'Deal Close' }]);
    expect(declared).toEqual(['Deal Close']);
  });

  it('AUTHORED LABEL — a label that happens to be the humanized spelling is still the author\'s', async () => {
    // The boundary between "absent" and "authored": an author who writes the
    // convention's own output must get it back unchanged.
    const declared = await renderWidget([{ accessorKey: 'close_date', header: 'Close Date' }]);
    expect(declared).toEqual(['Close Date']);
  });

  it('BUNDLE ENTRY — a translation still wins over the derived spelling in BOTH branches', async () => {
    const resources = {
      zh: { crm: { fields: { crm_opportunity: { close_date: '结单日期' } } } },
    };
    const wrap = (node: React.ReactElement) => (
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, resources }}>
        {node}
      </I18nProvider>
    );

    const auto = await renderWidget(undefined, wrap);
    expect(auto[0]).toBe('结单日期');
    cleanup();

    const declared = await renderWidget(asDrillColumns(['close_date']), wrap);
    expect(declared).toEqual(['结单日期']);
  });
});
