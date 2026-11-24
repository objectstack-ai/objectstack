/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36841 — a board swimlaned by a reference field (lookup, user).
 *
 * The board fetches with `$expand`, so the swimlane field's value is the
 * referenced record. Each swimlane is keyed by the record's foreign key, the
 * way a column lane on a reference is (`laneKeyOf`), and titled by its name.
 *
 * Rows:
 *   (a) one swimlane per referenced record, titled by the field's
 *       `displayField`, holding that record's cards in each column; a card
 *       with no value sits in "Uncategorized";
 *   (b) a field that declares no `displayField` is titled off the expanded
 *       record by the shared title ladder;
 *   (c) the swimlanes sort by the foreign key, not by the title;
 *   (d) the collapsed-swimlane memory keeps the foreign key, and reads it back.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act, cleanup, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource } from '@object-ui/types';
import { ObjectKanban } from './ObjectKanban';
import './KanbanImpl';

registerAllFields();

const DEAL = {
  name: 'deal',
  fields: {
    title: { type: 'text', label: 'Title' },
    stage: {
      type: 'select',
      label: 'Stage',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'won', label: 'Won' },
      ],
    },
    owner_id: { type: 'user', label: 'Owner', reference: 'sys_user' },
    account_id: { type: 'lookup', label: 'Account', reference: 'account', displayField: 'company' },
  },
};

// The keys run opposite to the titles, so a sort by title and a sort by key
// draw the swimlanes in different orders.
const ACME = { id: 'a2', company: 'Acme', code: 'ZZ-1' };
const GLOBEX = { id: 'a1', company: 'Globex', code: 'ZZ-2' };
const ALICE = { id: 'u1', name: 'Alice' };
const BOB = { id: 'u2', name: 'Bob' };

const rows = () => [
  { id: 'd1', title: 'Deal one', stage: 'open', owner_id: ALICE, account_id: ACME },
  { id: 'd2', title: 'Deal two', stage: 'open', owner_id: BOB, account_id: GLOBEX },
  { id: 'd3', title: 'Deal three', stage: 'won', owner_id: ALICE, account_id: ACME },
  { id: 'd4', title: 'Deal four', stage: 'won', owner_id: null, account_id: null },
];

function makeDataSource(): DataSource {
  return {
    getObjectSchema: vi.fn(async (name: string) => (name === 'deal' ? DEAL : { name, fields: {} })),
    find: vi.fn(async () => ({ value: rows() })),
    update: vi.fn(async () => ({})),
  } as unknown as DataSource;
}

const STORAGE_KEY = 'objectui:kanban-collapsed:account_id';

/** The cards in one swimlane cell, by its column and swimlane titles. */
function cardsIn(column: string, lane: string): string[] {
  const list = screen.getByRole('list', { name: `${column} - ${lane} cards` });
  return within(list)
    .queryAllByRole('listitem')
    .map((el) => el.getAttribute('aria-label') ?? '');
}

/** The swimlane header buttons, top to bottom. */
function swimlaneHeaders(): HTMLElement[] {
  const region = screen.getByRole('region', { name: 'Kanban board with swimlanes' });
  return Array.from(region.querySelectorAll<HTMLElement>('button[aria-expanded]'));
}

/** A swimlane header's title (its first text span after the chevron). */
function headerTitle(button: HTMLElement): string {
  return button.querySelectorAll('span')[1]?.textContent ?? '';
}

function headerFor(title: string): HTMLElement {
  const header = swimlaneHeaders().find((button) => headerTitle(button) === title);
  if (!header) throw new Error(`no swimlane titled ${title}`);
  return header;
}

async function mountBoard(swimlaneField: string) {
  const result = render(
    <ObjectKanban
      schema={{ type: 'object-kanban', objectName: 'deal', groupBy: 'stage', swimlaneField, cardTitle: 'title' } as any}
      dataSource={makeDataSource()}
    />,
  );
  expect(await screen.findByText('Deal four')).toBeInTheDocument();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return result;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('a board swimlaned by a reference field (objectstack#36841)', () => {
  it('(a) draws one swimlane per account, titled by displayField, holding its cards', async () => {
    const { container } = await mountBoard('account_id');
    await waitFor(() => expect(cardsIn('Open', 'Acme')).toEqual(['Deal one']));
    expect(cardsIn('Won', 'Acme')).toEqual(['Deal three']);
    expect(cardsIn('Open', 'Globex')).toEqual(['Deal two']);
    expect(cardsIn('Won', 'Globex')).toEqual([]);
    expect(cardsIn('Won', 'Uncategorized')).toEqual(['Deal four']);
    expect(swimlaneHeaders().map(headerTitle).sort()).toEqual(['Acme', 'Globex', 'Uncategorized']);
    expect(container.textContent).not.toContain('[object Object]');
  });

  it('(b) titles a swimlane off the expanded record when the field declares no displayField', async () => {
    await mountBoard('owner_id');
    await waitFor(() => expect(cardsIn('Open', 'Alice')).toEqual(['Deal one']));
    expect(cardsIn('Won', 'Alice')).toEqual(['Deal three']);
    expect(cardsIn('Open', 'Bob')).toEqual(['Deal two']);
    expect(swimlaneHeaders().map(headerTitle).sort()).toEqual(['Alice', 'Bob', 'Uncategorized']);
  });

  it('(c) sorts the swimlanes by the foreign key, not by the title', async () => {
    await mountBoard('account_id');
    await waitFor(() => expect(swimlaneHeaders()).toHaveLength(3));
    // a1 (Globex) before a2 (Acme); a title sort would put Acme first.
    const order = swimlaneHeaders().map(headerTitle);
    expect(order.indexOf('Globex')).toBeLessThan(order.indexOf('Acme'));
  });

  it('(d) remembers a collapsed swimlane by the foreign key and reads it back', async () => {
    await mountBoard('account_id');
    await waitFor(() => expect(swimlaneHeaders()).toHaveLength(3));
    fireEvent.click(headerFor('Acme'));
    expect(headerFor('Acme')).toHaveAttribute('aria-expanded', 'false');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(['a2']);

    cleanup();
    await mountBoard('account_id');
    await waitFor(() => expect(swimlaneHeaders()).toHaveLength(3));
    expect(headerFor('Acme')).toHaveAttribute('aria-expanded', 'false');
    expect(headerFor('Globex')).toHaveAttribute('aria-expanded', 'true');
  });
});
