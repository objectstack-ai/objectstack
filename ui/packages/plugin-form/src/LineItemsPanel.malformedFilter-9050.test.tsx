/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9050 step 2 — a line-items panel whose authored `filter` does not
 * lower renders a malformed-filter state that NAMES the operator, loads no
 * rows, and offers no editable grid over rows that were never scoped.
 *
 * ## Why BOTH mount shapes are here
 *
 * They are different worlds, and the measurement that separates them is the
 * point of this card's step-2 re-scoping:
 *
 *   - Through `SchemaRenderer`, every node is wrapped in a per-component
 *     `SchemaErrorBoundary`, so the OLD tree already contained the throw and
 *     already printed `error.message`. What was missing there was the
 *     DIAGNOSIS: a generic "Component … failed to render" banner. So the
 *     assertion for that path is specifically that the generic wording is GONE
 *     and the panel's own named state is what renders.
 *   - Mounted directly — which `MasterDetailForm` does, and which any host
 *     importing `LineItemsPanel` from `@object-ui/plugin-form` can do — there
 *     is no boundary at all: `plugin-form` carries zero non-test
 *     `ErrorBoundary` hits of its own. The throw escaped to the host.
 *
 * A pin that only proved "the page did not blank" would have been green on the
 * old tree for the first case. Neither assertion below is.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { LineItemsPanel } from './LineItemsPanel';
// Registers `record:line_items`.
import './index';

const COLUMNS = [{ name: 'qty', label: 'Qty', type: 'number' as const }];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    getObjectSchema: vi.fn(async () => ({ name: 'invoice_line', fields: {} })),
    batchTransaction: vi.fn(async () => ({ data: [] })),
  } as any;
}

/**
 * `$regex` — the refusal whose whole message is "there is nothing to translate
 * this INTO". Chosen because this panel's `filter` is declared
 * `any[] | Record FIELD_TO_VALUE`, so the MongoDB-style object arm is a shape it
 * really accepts, and because the operator token is unmistakable in the output.
 */
const REFUSED_FILTER = { note: { $regex: 'a.c' } };

function panelSchema(filter: unknown) {
  return {
    type: 'record:line_items',
    childObject: 'invoice_line',
    relationshipField: 'invoice',
    parentId: 'inv-1',
    columns: COLUMNS,
    filter,
  } as any;
}

describe('objectui#9050 — LineItemsPanel renders a malformed-filter state', () => {
  it('names the operator when mounted directly, with no error boundary above it', async () => {
    const ds = makeDataSource();
    render(
      <SchemaRendererProvider dataSource={ds}>
        <LineItemsPanel schema={panelSchema(REFUSED_FILTER)} />
      </SchemaRendererProvider>,
    );

    const alert = await screen.findByTestId('line-items-malformed-filter');
    // The OPERATOR on the HEADLINE, ⛔ not on the banner as a whole: the
    // technical line under it is the converter's own message and repeats the
    // token, so a whole-banner assertion cannot tell "names the operator" from
    // "prints the raw error". See ablation leg B.
    const headline = await screen.findByTestId('line-items-malformed-filter-subject');
    expect(headline.textContent).toContain('$regex');
    expect(alert.textContent).toMatch(/filter is malformed/i);
    // Nothing was asked of the data layer: the refusal is not "no filter".
    await waitFor(() => expect(ds.find).not.toHaveBeenCalled());
  });

  it('replaces the boundary’s generic banner on the schema-rendered path', async () => {
    const ds = makeDataSource();
    render(
      <SchemaRendererProvider dataSource={ds}>
        <SchemaRenderer schema={panelSchema(REFUSED_FILTER)} />
      </SchemaRendererProvider>,
    );

    const headline = await screen.findByTestId('line-items-malformed-filter-subject');
    expect(headline.textContent).toContain('$regex');
    // The half that was NOT green before this card: the per-component boundary
    // used to catch the throw and say "failed to render", which names no
    // operator and offers no repair.
    expect(document.body.textContent).not.toMatch(/failed to render/i);
  });

  it('positive control — a well-formed filter still loads rows and shows no refusal', async () => {
    const ds = makeDataSource();
    render(
      <SchemaRendererProvider dataSource={ds}>
        <LineItemsPanel schema={panelSchema({ note: { $contains: 'a' } })} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(screen.queryByTestId('line-items-malformed-filter')).toBeNull();
  });
});
