/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#37010 — on a phone, a list card whose object names its records
 * with a FORMULA name field never repeats the title in its subtitle. The
 * formula (`display_title` = `case_number - subject`) titles the card, and the
 * view shows its parts as its own leading columns. The subtitle skips every
 * shown column whose field the formula reads and takes the next shown columns
 * instead. A name field that is not a formula keeps today's subtitle.
 *
 * Driven through the real card renderer (`ObjectGrid` at 375 px), with the
 * object schema served by the data source as a list page receives it.
 *
 * ── Directions on the base tree (predicted before the first run) ─────────
 *   formula title, parts as leading columns: subtitle is the next two  RED
 *   formula title, formula column shown too: subtitle skips the parts  RED
 *   control: a text name field keeps today's subtitle                  GREEN
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup, waitFor, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { LocalizationProvider } from '@object-ui/i18n';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';

beforeAll(() => {
  registerAllFields();
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});

const ORIGINAL_INNER_WIDTH = window.innerWidth;

function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: px });
}

afterEach(() => {
  cleanup();
  setWidth(ORIGINAL_INNER_WIDTH);
});

const OBJECT = 'case_37010';

const FIELDS = {
  id: { type: 'text' },
  case_number: { type: 'text', label: 'Case Number' },
  subject: { type: 'text', label: 'Subject' },
  status: {
    type: 'select',
    label: 'Status',
    options: [
      { value: 'open', label: 'Open' },
      { value: 'closed', label: 'Closed' },
    ],
  },
  priority: {
    type: 'select',
    label: 'Priority',
    options: [
      { value: 'critical', label: '紧急' },
      { value: 'low', label: '低' },
    ],
  },
  account: { type: 'text', label: 'Account' },
  display_title: {
    type: 'formula',
    label: 'Title',
    returnType: 'text',
    expression: { dialect: 'cel', source: "record.case_number + ' - ' + record.subject" },
  },
};

const TITLE = 'CASE-00037 - Demo case 29 — critical problem';

const ROWS = [
  {
    id: 'c37',
    case_number: 'CASE-00037',
    subject: 'Demo case 29 — critical problem',
    status: 'open',
    priority: 'critical',
    account: 'Polar Cargo',
    display_title: TITLE,
  },
];

/** The formula's parts lead the view, as a real case list shows them; the formula column itself is not shown. */
const PART_COLUMNS = ['case_number', 'subject', 'status', 'priority', 'account'].map((field) => ({ field }));

function renderGrid(nameField: string, columns: unknown[]) {
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: async (name: string) => ({ name, nameField, fields: structuredClone(FIELDS) }),
  } as never;
  return render(
    <LocalizationProvider value={{ locale: 'en' }}>
      <ActionProvider>
        <SchemaRendererProvider dataSource={dataSource}>
          <ObjectGrid
            schema={{ type: 'object-grid', objectName: OBJECT, columns, pagination: { pageSize: 50 } } as never}
            dataSource={dataSource}
          />
        </SchemaRendererProvider>
      </ActionProvider>
    </LocalizationProvider>,
  );
}

async function phoneCard(nameField: string, columns: unknown[] = PART_COLUMNS) {
  setWidth(375);
  renderGrid(nameField, columns);
  // The status chip reads its label off the object schema, so it proves the
  // field defs (and with them the name field's formula) have arrived.
  await waitFor(() => expect(screen.getByText('Open')).toBeInTheDocument());
  expect(document.querySelector('table'), 'the card layout, not the table').toBeNull();
  const cards = [...document.querySelectorAll('[data-testid="grid-mobile-card"]')] as HTMLElement[];
  expect(cards).toHaveLength(1);
  return cards[0];
}

describe('the phone list card subtitle never repeats a formula title (objectstack#37010)', () => {
  it('a formula name field over the two leading columns: the subtitle is the next two shown columns', async () => {
    const card = await phoneCard('display_title');
    expect(within(card).getByTestId('grid-card-title').textContent).toBe(TITLE);
    expect(within(card).getByTestId('grid-card-subtitle').textContent).toBe('紧急 · Polar Cargo');
  });

  it('the formula column shown as well: the subtitle still skips the columns the formula reads', async () => {
    const columns = ['display_title', 'case_number', 'subject', 'status', 'priority', 'account'].map((field) => ({ field }));
    const card = await phoneCard('display_title', columns);
    expect(within(card).getByTestId('grid-card-title').textContent).toBe(TITLE);
    expect(within(card).getByTestId('grid-card-subtitle').textContent).toBe('紧急 · Polar Cargo');
  });

  it('CONTROL: a name field that is not a formula keeps the first two other shown columns', async () => {
    const card = await phoneCard('subject');
    expect(within(card).getByTestId('grid-card-title').textContent).toBe('Demo case 29 — critical problem');
    expect(within(card).getByTestId('grid-card-subtitle').textContent).toBe('CASE-00037 · 紧急');
  });
});
