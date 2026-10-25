/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7245 — ObjectGrid's own default-column synthesis is the third face
 * that took a declared `highlightFields` verbatim, and it needs the same
 * name-field lead as the two app-shell faces.
 *
 * `highlightFields` is ADR-0085's "most important fields" role, NOT a column
 * list. Its first consumer — the detail-page highlight strip — deliberately
 * removes the title field, because the page H1 directly above it already shows
 * one. So metadata that is entirely correct routinely omits the name, and the
 * showcase `showcase_account` (`nameField: "name"`,
 * `highlightFields: ["status", "industry", "annual_revenue"]`, no list views)
 * rendered 14 rows with nothing to tell them apart.
 *
 * ## What discriminates
 *
 * Asserting only "the name column is present" would pass on the broken build
 * for the object below, because `name` would appear once the author listed it.
 * The load-bearing assertion is the FULL header list in ORDER — on the
 * unfixed synthesis the curated three come through with no `Account Name` at
 * all.
 *
 * The controls hold the boundaries the lead must not cross: an authored
 * `fields` projection is never reordered (that is the author's declaration, and
 * reordering it would be the renderer second-guessing metadata — AGENTS.md
 * Commandment #0.1), and the no-`highlightFields` walk is untouched.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

/**
 * The served `showcase_account`, abridged. Field declaration order deliberately
 * does NOT match `highlightFields` order, so the assertion below cannot pass by
 * accident through the declaration-order walk.
 */
const ACCOUNT_SCHEMA = {
  name: 'showcase_account',
  label: 'Account',
  nameField: 'name',
  highlightFields: ['status', 'industry', 'annual_revenue'],
  fields: {
    name: { type: 'text', label: 'Account Name' },
    industry: { type: 'text', label: 'Industry' },
    annual_revenue: { type: 'number', label: 'Annual Revenue' },
    status: { type: 'text', label: 'Lifecycle' },
    created_at: { type: 'datetime', label: 'Created At', system: true, readonly: true },
  },
};

const ROWS = [
  {
    id: 'acct-1',
    name: 'Northwind Traders',
    industry: 'Retail',
    annual_revenue: 25000000,
    status: 'active',
    created_at: '2026-08-01T10:00:00Z',
  },
];

function makeDataSource(schema: Record<string, unknown> = ACCOUNT_SCHEMA) {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    getObjectSchema: vi.fn(async () => schema),
  } as any;
}

/** Data-column header labels in render order (drops furniture + the `#` index). */
function dataHeaders(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('thead th'))
    .map((th) => (th.textContent ?? '').trim())
    .filter((text) => text.length > 0 && text !== '#');
}

function renderGrid(schemaOverrides: Record<string, unknown> = {}, objectSchema = ACCOUNT_SCHEMA) {
  const ds = makeDataSource(objectSchema);
  const utils = render(
    <ActionProvider>
      <ObjectGrid
        schema={{ type: 'object-grid', objectName: 'showcase_account', ...schemaOverrides }}
        dataSource={ds}
        data={ROWS}
      />
    </ActionProvider>,
  );
  return { ...utils, ds };
}

describe('ObjectGrid default columns lead with the name field (#7245)', () => {
  it('THE REPRO: a curated highlightFields that omits the name still gets a name column, first', async () => {
    const { container } = renderGrid();
    await waitFor(() =>
      expect(dataHeaders(container)).toEqual([
        'Account Name',
        'Lifecycle',
        'Industry',
        'Annual Revenue',
      ]),
    );
  });

  it('does not duplicate a name field the curated list already carries', async () => {
    const { container } = renderGrid(
      {},
      { ...ACCOUNT_SCHEMA, highlightFields: ['name', 'status'] },
    );
    await waitFor(() => expect(dataHeaders(container)).toEqual(['Account Name', 'Lifecycle']));
  });

  it('moves a late-listed name field to the front', async () => {
    const { container } = renderGrid(
      {},
      { ...ACCOUNT_SCHEMA, highlightFields: ['status', 'name', 'industry'] },
    );
    await waitFor(() =>
      expect(dataHeaders(container)).toEqual(['Account Name', 'Lifecycle', 'Industry']),
    );
  });

  // CONTROL — an author who declares a projection gets it verbatim, in their
  // order. The lead applies only to what the renderer synthesized itself.
  it('never reorders an authored `fields` projection', async () => {
    const { container } = renderGrid({ fields: ['status', 'name'] });
    await waitFor(() => expect(dataHeaders(container)).toEqual(['Lifecycle', 'Account Name']));
  });

  // CONTROL — no `highlightFields`, so the walk runs. It takes every visible
  // field with no cap, so the name cannot fall off the end; that branch is
  // deliberately left alone and must stay declaration-ordered.
  it('leaves the no-highlightFields walk untouched', async () => {
    const { highlightFields: _dropped, ...noHighlights } = ACCOUNT_SCHEMA;
    const { container } = renderGrid({}, noHighlights as typeof ACCOUNT_SCHEMA);
    await waitFor(() =>
      expect(dataHeaders(container)).toEqual([
        'Account Name',
        'Industry',
        'Annual Revenue',
        'Lifecycle',
      ]),
    );
  });
});
