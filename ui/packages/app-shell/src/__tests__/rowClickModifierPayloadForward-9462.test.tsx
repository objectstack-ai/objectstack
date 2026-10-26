/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9462 — the modifier payload SURVIVES every hop between
 * `useNavigationOverlay.handleClick` and a host handler.
 *
 * `handleClick` invokes the handler it is given with TWO arguments — the
 * record, and the modifier payload (`metaKey` / `ctrlKey` / `button`) a host
 * needs to answer Cmd/Ctrl/middle-click with "open this record in a new tab".
 * objectui#9360 made the hook's option declare that and objectui#9460 made the
 * component props on the path declare it. Three hops in the middle RECEIVED the
 * payload and dropped it, so the declarations were correct about what the hook
 * delivers and still correct about what these hops delivered — which was
 * nothing, and a host's second argument was always `undefined`.
 *
 * ## Why this file lives in `app-shell`
 *
 * The three subjects and the control sit in four different packages
 * (`@object-ui/components`, `@object-ui/plugin-view`, `@object-ui/plugin-list`),
 * and the control has to share the file — a red that cannot be told apart from
 * a broken harness is half a measurement. `app-shell` is the one package that
 * already depends on all of them, and it is also the real host: its own view
 * code already spells its row-click handlers `(record: any, event?: any)`,
 * which is the population this card is repairing the supply for. Putting the
 * pin here needs no new dependency edge anywhere.
 *
 * ## THREE REDS, one per hop — measured on this branch with the fix reverted
 *
 * Each case names the hop it observes, because "the payload arrives" is true of
 * all three at once only after all three are repaired:
 *
 *  1. the row's own click handler in `data-table`'s renderer, reached through
 *     `ObjectGrid` (which puts `navigation.handleClick` on the table node);
 *  2. the hover "open record" button in the same renderer — the interesting
 *     one, because its handler already bound the DOM event as `e` to call
 *     `stopPropagation`, so the payload was IN SCOPE on that line and still was
 *     not passed on;
 *  3. `plugin-view`'s `ObjectView`, whose `handleRowClick` is what the grid
 *     hands the hook and which forwarded one argument to the component's own
 *     `onRowClick` prop.
 *
 * ## THE CONTROL, in the same file and the same harness
 *
 * `ObjectGallery` already forwards — its card's `onClick` reads
 * `navigation.handleClick(item, e)`. It is GREEN both before and after the
 * change, which is what makes the three reds a reading about the three hops
 * rather than about `fireEvent`, happy-dom or the hook. ⛔ Do not "simplify" it
 * away: without it, a harness that never delivered `metaKey` at all would
 * produce exactly the same three failures.
 */

import React from 'react';
import { describe, it, expect, vi, type Mock } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { ObjectGrid } from '@object-ui/plugin-grid';
import { ObjectView } from '@object-ui/plugin-view';
import { ObjectGallery } from '@object-ui/plugin-list';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';

const rows = [
  { id: 'r1', name: 'Alice', amount: 100 },
  { id: 'r2', name: 'Bob', amount: 200 },
];

const objectSchema = {
  label: 'Test object',
  fields: {
    id: { name: 'id', type: 'text', label: 'Id' },
    name: { name: 'name', type: 'text', label: 'Name' },
    amount: { name: 'amount', type: 'number', label: 'Amount' },
  },
};

function makeDataSource(): DataSource {
  return {
    find: vi.fn().mockResolvedValue(rows),
    findOne: vi.fn().mockResolvedValue(rows[0]),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
  } as unknown as DataSource;
}

/** The host-facing shape all four subjects declare, once. */
type HostRowClick = (record: Record<string, unknown>, event?: unknown) => void;

/**
 * What every case reads: the SECOND argument of the host handler's first call.
 * Spelled once so the three reds and the control are literally the same
 * assertion pointed at four different components.
 */
function secondArgumentOf(spy: Mock<HostRowClick>): unknown {
  expect(spy, 'the host handler was never called — the probe did not reach it').toHaveBeenCalled();
  return spy.mock.calls[0][1];
}

/** A grid that owns its rows inline, with a navigation config, as the card names it. */
function renderGrid(onRowClick: Mock<HostRowClick>) {
  const schema: any = {
    type: 'object-grid',
    objectName: 'test_object',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'amount', label: 'Amount', type: 'number' },
    ],
    navigation: { mode: 'drawer' },
    data: { provider: 'value', items: rows },
  };
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} onRowClick={onRowClick} />
    </ActionProvider>,
  );
}

describe('objectui#9462 — RED 1: the data-table row click hands the host the modifier payload', () => {
  it('a ⌘-click on a row reaches the host with the event, not with `undefined`', async () => {
    const onRowClick = vi.fn<HostRowClick>();
    const { container } = renderGrid(onRowClick);

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    const row = container.querySelector('tbody tr');
    expect(row, 'no data row rendered — the harness, not the subject, is broken').not.toBeNull();

    fireEvent.click(row as Element, { metaKey: true });

    const event = secondArgumentOf(onRowClick) as { metaKey?: boolean } | undefined;
    expect(event, 'the row handler called `schema.onRowClick(row)` — one argument').toBeDefined();
    expect(event!.metaKey).toBe(true);
    // The record still arrives first and unchanged: this card forwards a second
    // argument, it does not re-shape the first.
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: 'r1' });
  });
});

describe('objectui#9462 — RED 2: the hover "open record" button forwards the event it already bound', () => {
  it('a Ctrl-click on the row-expand button reaches the host with the event', async () => {
    const onRowClick = vi.fn<HostRowClick>();
    renderGrid(onRowClick);

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    const expand = await screen.findAllByTestId('row-expand-button');

    fireEvent.click(expand[0], { ctrlKey: true });

    const event = secondArgumentOf(onRowClick) as { ctrlKey?: boolean } | undefined;
    expect(
      event,
      'the button handler called `schema.onRowClick?.(row)` — the DOM event was bound as `e` for `stopPropagation` and dropped',
    ).toBeDefined();
    expect(event!.ctrlKey).toBe(true);
  });
});

describe("objectui#9462 — RED 3: ObjectView's own onRowClick prop receives the payload", () => {
  it('the handler the view hands its list view forwards both arguments to the host', async () => {
    const onRowClick = vi.fn<HostRowClick>();
    const dataSource = makeDataSource();

    render(
      <SchemaRendererProvider dataSource={dataSource}>
        <ObjectView
          schema={{ type: 'object-view', objectName: 'test_object' } as any}
          dataSource={dataSource}
          onRowClick={onRowClick}
          renderListView={(props) => (
            <button
              type="button"
              data-testid="custom-list-row"
              onClick={(e) => props.onRowClick?.(rows[0] as Record<string, unknown>, e)}
            >
              Alice
            </button>
          )}
        />
      </SchemaRendererProvider>,
    );

    const trigger = await screen.findByTestId('custom-list-row');
    fireEvent.click(trigger, { metaKey: true });

    const event = secondArgumentOf(onRowClick) as { metaKey?: boolean } | undefined;
    expect(event, "`handleRowClick` called `onRowClick(record)` — the view truncated the call").toBeDefined();
    expect(event!.metaKey).toBe(true);
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: 'r1' });
  });
});

describe('objectui#9462 — CONTROL: ObjectGallery already forwarded, and still does', () => {
  it('a ⌘-click on a gallery card reaches the host with the event (green before and after)', async () => {
    const onRowClick = vi.fn<HostRowClick>();
    const dataSource = makeDataSource();

    render(
      <SchemaRendererProvider dataSource={dataSource}>
        <ObjectGallery
          schema={{
            type: 'object-gallery',
            objectName: 'test_object',
            navigation: { mode: 'drawer' },
            gallery: { titleField: 'name' },
          } as any}
          onRowClick={onRowClick}
        />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    const cards = screen.getAllByRole('listitem');
    fireEvent.click(cards[0], { metaKey: true });

    const event = secondArgumentOf(onRowClick) as { metaKey?: boolean } | undefined;
    expect(
      event,
      'the control is RED — the probe itself is broken, so the three cases above measure nothing',
    ).toBeDefined();
    expect(event!.metaKey).toBe(true);
  });
});
