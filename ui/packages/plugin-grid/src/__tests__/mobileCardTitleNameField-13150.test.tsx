/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13150 — below the mobile breakpoint, ObjectGrid's stacked card is
 * titled by the object's DECLARED `nameField`, not by whichever column the
 * view shows first.
 *
 * Measured at 390x844 (Studio, Data, an object's Records): the view's first
 * column was Owner, a lookup, so every card was titled "Dev Admin" and the
 * record's own name ("Plant A check") sat in a body row at the bottom of the
 * card.
 *
 * Pinned on the real ObjectGrid:
 *   - a shown name column titles the card, and the body does not repeat it;
 *     the first column it displaced reads as a body row;
 *   - a name field no column shows still titles the card: the grid's own
 *     `$select` asks for it (objectui#13107), so the row carries it;
 *   - a declared name value the row lacks draws the card's empty title,
 *     never another field's value.
 * Control: an object that declares no `nameField` keeps the first shown
 * column as its title.
 *
 * The data source honours `$select` the way a server does: a row carries the
 * selected keys only, so a field left out of the projection is really absent.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const ORIGINAL_INNER_WIDTH = window.innerWidth;

function setMobileWidth() {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 });
}

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: ORIGINAL_INNER_WIDTH });
});

const OBJECT = 'showcase_inspection';

const FIELDS = {
  id: { type: 'text' },
  name: { type: 'text', label: 'Name' },
  owner: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
  notes: { type: 'text', label: 'Notes' },
};

const ROWS = [
  { id: 'r1', name: 'Plant A check', owner: { id: 'u1', name: 'Dev Admin' }, notes: 'Boiler room' },
  { id: 'r2', name: 'Plant B check', owner: { id: 'u1', name: 'Dev Admin' }, notes: 'Loading dock' },
];

function renderGrid(opts: {
  columns: unknown[];
  objectExtra?: Record<string, unknown>;
  /** Keys the server leaves off every row, selected or not. */
  withheld?: string[];
}) {
  const find = vi.fn(async (_object: string, params: Record<string, any>) => {
    const select = params?.$select as string[] | undefined;
    const data = ROWS.map((row) => {
      const keys = ['id', ...(select ?? Object.keys(row))]
        .filter((k, i, all) => all.indexOf(k) === i)
        .filter((k) => k in row && !(opts.withheld ?? []).includes(k));
      return Object.fromEntries(keys.map((k) => [k, (row as Record<string, unknown>)[k]]));
    });
    return { data, total: data.length, hasMore: false, pageSize: 50 };
  });
  const dataSource = {
    find,
    getObjectSchema: async (name: string) => ({ name, fields: FIELDS, ...(opts.objectExtra ?? {}) }),
  } as any;
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    columns: opts.columns,
    pagination: { pageSize: 50 },
  };
  setMobileWidth();
  render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource}>
        <ObjectGrid schema={schema} dataSource={dataSource} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
  return { find };
}

/** Each card's title text, and the text of the card body below it. */
async function readCards(expectedCount: number) {
  const titles = await screen.findAllByTestId('grid-card-title');
  expect(titles).toHaveLength(expectedCount);
  return titles.map((title) => {
    const card = title.parentElement as HTMLElement;
    const body = (card.textContent ?? '').slice((title.textContent ?? '').length);
    return { title: title.textContent, body };
  });
}

describe('mobile card is titled by the declared nameField, not the first column (objectui#13150)', () => {
  it('the measured shape: a shown name column titles the card, and the displaced first column reads in the body', async () => {
    renderGrid({
      columns: [{ field: 'owner' }, { field: 'notes' }, { field: 'name' }],
      objectExtra: { nameField: 'name' },
    });
    const cards = await readCards(2);
    expect(cards.map((c) => c.title)).toEqual(['Plant A check', 'Plant B check']);
    for (const card of cards) {
      expect(card.body).toContain('Dev Admin');
      expect(card.body).not.toContain('check');
    }
  });

  it('a name field no column shows still titles the card: the grid asks for it, and the row carries it', async () => {
    const { find } = renderGrid({
      columns: [{ field: 'owner' }, { field: 'notes' }],
      objectExtra: { nameField: 'name' },
    });
    const cards = await readCards(2);
    expect(cards.map((c) => c.title)).toEqual(['Plant A check', 'Plant B check']);
    expect(find.mock.calls.at(-1)?.[1]?.$select).toContain('name');
    for (const card of cards) {
      expect(card.body).toContain('Dev Admin');
      expect(card.body).toContain('Notes');
    }
  });

  it('a declared name value the row lacks draws the empty title, never the first column', async () => {
    renderGrid({
      columns: [{ field: 'owner' }, { field: 'notes' }],
      objectExtra: { nameField: 'name' },
      withheld: ['name'],
    });
    const cards = await readCards(2);
    expect(cards.map((c) => c.title)).toEqual(['—', '—']);
  });

  it('CONTROL: an object that declares no nameField keeps the first shown column as its title', async () => {
    renderGrid({
      columns: [{ field: 'owner' }, { field: 'notes' }, { field: 'name' }],
    });
    const cards = await readCards(2);
    expect(cards.map((c) => c.title)).toEqual(['Dev Admin', 'Dev Admin']);
    expect(cards[0].body).toContain('Plant A check');
    expect(cards[1].body).toContain('Plant B check');
  });
});
