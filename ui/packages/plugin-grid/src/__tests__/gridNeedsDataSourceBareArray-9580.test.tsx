/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9580 — the 「no data source」 gate speaks for a grid whose only row
 * source is a bare `data` ARRAY.
 *
 * ## What was wrong, and why it was a gate defect and not a carrier defect
 *
 * `gridNeedsDataSource` enumerates the escape hatches that let THIS placement
 * draw rows without an adapter, and one of them was `Array.isArray(schema.data)`
 * — an authored bare array. Two rulings had since retired that carrier on both
 * of its sides:
 *
 *   - objectui#8348 (「8348 以协议为准」, decision batch #83) at the shared
 *     record-source ladder, because this block's published `data` row is the
 *     `ViewData` OBJECT arm;
 *   - objectui#9571 (ruling objectui#8348 Q2-C, batch #136 item 3, maintainer
 *     「同意」) at the props channel, so `SchemaRenderer` no longer spreads an
 *     authored `data` as a React prop for a block on that arm.
 *
 * ⇒ the array no longer draws anything, while the predicate still answered
 * "this placement needs no adapter". A grid authored that way with no adapter
 * rendered the EMPTY SHELL objectui#5378 item 2 exists to replace, with the one
 * diagnostic addressed to exactly that situation staying silent. objectui#9571's
 * warn-once is `__DEV__`-only; this gate is the production-facing half.
 *
 * ⛔ Not in scope and ruled out twice: restoring the bare-array carrier. Rows
 * 1-2 assert what the gate SAYS, and every other row holds a leg that must not
 * move with it.
 *
 * ## How this file is meant to fail
 *
 * Rows 1-2 are the pin: they were RED on the predicate as it stood, because the
 * removed line made `requiresDataSource` false and the gate rendered the block
 * instead of the panel. Rows 3-7 are the controls that would catch a repair
 * that over-reached — the DECLARED inline spellings, the data-scope `bind`, the
 * HOST prop carrier objectui#9571 deliberately kept, and the `objectName` clause
 * that keeps a differently-broken grid pointed at its own defect.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider, noDataSourceMessage } from '@object-ui/react';
// Registers `object-grid` and its `view:grid` alias.
import '../index';

/** The rows an author put in the metadata, in one spelling or another. */
const ROWS = [{ id: 'a1', name: 'Inline row' }];
/** The rows a HOST that owns the fetch hands down as a React prop. */
const HOST_ROWS = [{ id: 'h1', name: 'Host row' }];

const BASE = { type: 'object-grid', objectName: 'account', columns: [{ field: 'name' }] };

function makeAdapter() {
  return {
    find: vi.fn().mockResolvedValue({ data: [{ id: 'q1', name: 'Fetched row' }], total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'account',
      fields: { id: { type: 'text' }, name: { type: 'text' } },
    }),
  };
}

/** The card's reproduction shape: rendered through `SchemaRenderer`, NO adapter. */
function renderWithoutAdapter(schema: Record<string, unknown>, props: Record<string, unknown> = {}) {
  return render(<SchemaRenderer schema={schema as any} {...props} />);
}

const panelOf = (container: HTMLElement) =>
  container.querySelector('[data-testid="object-grid-no-data-source"]');

describe('object-grid — the no-data-source gate and a bare `data` array (objectui#9580)', () => {
  it('1. ⭐ REPRODUCTION: bare `data` array + `objectName` + no adapter ⇒ the gate FIRES', async () => {
    const { container } = renderWithoutAdapter({ ...BASE, data: ROWS });

    await waitFor(() => expect(panelOf(container)).not.toBeNull());
  });

  it('2. …and it says the sentence the family says, naming THIS block and object', async () => {
    const { container } = renderWithoutAdapter({ ...BASE, data: ROWS });

    await waitFor(() => expect(panelOf(container)).not.toBeNull());
    // DERIVED from the exported wording, never restated here: a reworded panel
    // must move this pin with it rather than leave a stale copy asserting green.
    expect(container.textContent).toContain(noDataSourceMessage('object-grid', 'account'));
    // The panel renders INSTEAD of the block — the empty shell is what the
    // author used to get, and the authored rows were never on screen either.
    expect(screen.queryByText('Inline row')).toBeNull();
  });

  it('3. ⛔ CONTROL: the DECLARED `{ provider: value, items }` form still needs no adapter', async () => {
    const { container } = renderWithoutAdapter({
      ...BASE,
      data: { provider: 'value', items: ROWS },
    });

    expect(await screen.findByText('Inline row')).toBeTruthy();
    expect(panelOf(container)).toBeNull();
  });

  it('4. ⛔ CONTROL: the deprecated `staticData` array still needs no adapter', async () => {
    const { container } = renderWithoutAdapter({ ...BASE, staticData: ROWS });

    expect(await screen.findByText('Inline row')).toBeTruthy();
    expect(panelOf(container)).toBeNull();
  });

  it('5. ⛔ CONTROL: `bind` resolves rows from the data scope, so no adapter is needed', async () => {
    const { container } = renderWithoutAdapter({ ...BASE, bind: 'accounts' });

    // No panel: the placement has somewhere to look, even with nothing bound in
    // this render. The BLOCK renders instead — its own empty state is on screen
    // (objectui#13142: an unsearched grid with no row draws that in place of the
    // table, so the column header is no longer the probe) — which is what tells
    // "the gate stayed silent" apart from "nothing rendered at all". Without
    // this row the repair could have collapsed into "anything without an
    // adapter is a defect".
    expect(await screen.findByTestId('object-grid-empty-state')).toBeTruthy();
    expect(panelOf(container)).toBeNull();
  });

  it('6. ⛔ MUST NOT CHANGE: a HOST handing rows down as a `data` REACT PROP', async () => {
    // The carrier objectui#9571 deliberately kept — `plugin-list`'s `ListView`
    // renders `<SchemaRenderer schema={…} {...props} data={data} />`, and the
    // component's own props are spread LAST, so they still arrive. This is also
    // the row that tells "the SCHEMA key lost its escape hatch" apart from "the
    // prop stopped working": same absent adapter, opposite verdict from row 1.
    const { container } = renderWithoutAdapter({ ...BASE }, { data: HOST_ROWS });

    expect(await screen.findByText('Host row')).toBeTruthy();
    expect(panelOf(container)).toBeNull();
  });

  it('7. ⛔ CONTROL: no `objectName` ⇒ still silent, because that is a different defect', async () => {
    // The predicate's last clause. A grid that names no object has nothing the
    // "no data source" sentence could address, and answering it here would put
    // the wrong address on a real defect.
    const { container } = renderWithoutAdapter({
      type: 'object-grid',
      columns: [{ field: 'name' }],
      data: ROWS,
    });

    await waitFor(() => expect(container.firstChild).not.toBeNull());
    expect(panelOf(container)).toBeNull();
  });

  it('8. ⛔ CONTROL: with an adapter injected the gate is silent and the block queries', async () => {
    // `requiresDataSource` is only ever consulted when nothing resolved, so the
    // repair may not change any placement that HAS an adapter. The bare array
    // still draws nothing (objectui#8348 / objectui#9571, pinned next door in
    // `gridBareArrayDataRefused-8348.test.tsx`) — what this row holds is that
    // the gate does not start shouting at a wired-up grid.
    const adapter = makeAdapter();
    const { container } = render(
      <SchemaRendererProvider dataSource={adapter as any}>
        <SchemaRenderer schema={{ ...BASE, data: ROWS } as any} />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(panelOf(container)).toBeNull();
  });
});
