// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5425, second defect — "a value cannot appear twice under two
 * spellings on one dashboard", applied to the surviving instance of that class
 * in the widget the card names.
 *
 * ## What was measured
 *
 * The `table` widget family derives a column header from a field key on three
 * paths. Two of them called `humanizeFieldKey`, whose own docstring names it
 * "the single home for the convention, because both halves of the `table`
 * widget family need it and they must agree". The third — the AUTO-DERIVED
 * columns of the object-bound half, in `ObjectDataTable` — carried an inline
 * third spelling that split camelCase but never turned `_` into a space, so it
 * left a raw underscore in a user-visible header:
 *
 *   path                                    close_date     needs_analysis
 *   ─────────────────────────────────────── ────────────── ────────────────
 *   object-bound, AUTO-DERIVED (before)     Close_date     Needs_analysis
 *   object-bound, DECLARED `columns: [...]` Close Date     Needs Analysis
 *   static `data-table`, no columns         Close Date     Needs Analysis
 *
 * One dashboard can hold all three widgets over the same object, so one field
 * key rendered under two spellings — the card's defect, one step across from
 * where it was reported. The fix adopts the convention on the odd path out
 * rather than adding a fourth dialect.
 *
 * ## Why the header family and not the member family
 *
 * The card's own measurement (`NeedsAnalysis` vs `Needs Analysis` for a
 * dimension MEMBER) no longer reproduces: dataset dimension members resolve
 * through the picklist's translated options and reach no prettifier at all —
 * pinned in `DatasetWidget.dimensionMemberLabels.test.tsx`. The prettifier
 * family the card pointed at survives only over field KEYS, which is what this
 * file covers. `humanizeLabel` in `plugin-charts` is deliberately NOT changed
 * here: it is a byte-identical copy of `@object-ui/fields`' export that
 * `plugin-grid` / `plugin-gantt` / `plugin-detail` also read, so aligning it
 * alone would trade one disagreement for another across a package this card
 * does not own. Recorded as a separate finding.
 *
 * ## DIRECTIONS, written before the reverse verification was run
 *
 * Predicted RED on `origin/main` for the two auto-derived assertions (they read
 * `Close_date` / `Needs_analysis`), and GREEN on both sides for the declared,
 * static and i18n-override assertions — the fix must not move those. The
 * camelCase row (`unitPrice` → `Unit Price`) is green on both sides too: the
 * old spelling already agreed there, which is precisely why the disagreement
 * went unnoticed. Measured result recorded in the PR body.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { ObjectDataTable, normalizeColumns } from '../ObjectDataTable';
import { deriveStaticTableColumns, humanizeFieldKey } from '../utils';

/** Capture the columns the widget hands the data-table renderer. */
let captured: any = null;
beforeAll(() => {
  ComponentRegistry.register('data-table', (props: any) => {
    captured = props;
    return null;
  });
});

afterEach(() => {
  cleanup();
  captured = null;
  vi.restoreAllMocks();
});

const KEYS = ['close_date', 'needs_analysis', 'unitPrice'];
const ROW = { close_date: '2026-01-01', needs_analysis: 'x', unitPrice: 3 };

const OPPORTUNITY = {
  name: 'crm_opportunity',
  fields: {
    close_date: { type: 'date' },
    needs_analysis: { type: 'text' },
    unitPrice: { type: 'number' },
  },
};

const dataSource = {
  getObjectSchema: async () => OPPORTUNITY,
  find: async () => [ROW],
};

const headers = (): string[] => (captured?.schema?.columns ?? []).map((c: any) => c.header);

async function renderTable(schema: Record<string, unknown>, ui?: (node: React.ReactElement) => React.ReactElement) {
  const node = <ObjectDataTable schema={schema as any} dataSource={dataSource} />;
  render(ui ? ui(node) : node);
  await waitFor(() => expect((captured?.schema?.columns ?? []).length).toBeGreaterThan(0));
}

describe('objectui#5425 — one field key, ONE header spelling across the table family', () => {
  it('AUTO-DERIVED columns spell the header with the shared convention', async () => {
    await renderTable({ type: 'object-data-table', objectName: 'crm_opportunity' });
    expect(headers()).toEqual(['Close Date', 'Needs Analysis', 'Unit Price']);
    // The pre-fix spelling left a raw underscore on screen.
    expect(headers()).not.toContain('Close_date');
    expect(headers()).not.toContain('Needs_analysis');
  });

  it('AUTO-DERIVED, DECLARED and STATIC paths all agree, key for key', async () => {
    // The property the card asks for, stated over all three producers at once
    // rather than as three separate expected strings — a future fourth path
    // that reintroduces a dialect fails here without anyone updating a literal.
    await renderTable({ type: 'object-data-table', objectName: 'crm_opportunity' });
    const auto = headers();
    cleanup();
    captured = null;

    await renderTable({ type: 'object-data-table', objectName: 'crm_opportunity', columns: KEYS });
    const declared = headers();

    const staticHeaders = deriveStaticTableColumns([ROW]).map((c) => c.header);
    const shorthand = normalizeColumns(KEYS).map((c) => c.header);
    const convention = KEYS.map(humanizeFieldKey);

    expect(auto).toEqual(convention);
    expect(declared).toEqual(convention);
    expect(staticHeaders).toEqual(convention);
    expect(shorthand).toEqual(convention);
  });

  it('BOUNDARY — a bundle entry still wins over the derived spelling', async () => {
    // Green on both sides. The fix touches only the fallback handed to
    // `fieldLabel`; a translated header must keep overriding it.
    const resources = {
      zh: { crm: { fields: { crm_opportunity: { close_date: '结单日期' } } } },
    };
    await renderTable({ type: 'object-data-table', objectName: 'crm_opportunity' }, (node) => (
      <I18nProvider
        config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, resources }}
      >
        {node}
      </I18nProvider>
    ));
    expect(headers()[0]).toBe('结单日期');
    expect(headers()).not.toContain('Close Date');
  });

  it('BOUNDARY — camelCase already agreed, and still does', async () => {
    // Green on both sides: `unitPrice` is where the old inline spelling and the
    // convention happened to coincide, which is why the divergence on
    // snake_case keys went unnoticed. Pinned so the fix is not misread as
    // having changed camelCase behaviour.
    expect(humanizeFieldKey('unitPrice')).toBe('Unit Price');
    await renderTable({ type: 'object-data-table', objectName: 'crm_opportunity' });
    expect(headers()[2]).toBe('Unit Price');
  });
});
