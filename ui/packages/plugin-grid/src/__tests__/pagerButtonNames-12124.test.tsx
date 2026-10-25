/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A paged grid's first / previous / next / last buttons are named
 * (objectui#12124).
 *
 * `ObjectGrid` draws its pager through the `data-table` renderer: four icon
 * `Button`s, each holding a chevron and nothing else. A screen reader heard
 * four unnamed buttons, and a role query found none of them — the
 * objectui#12081 footer suite had to reach the next-page button through its
 * icon. Each button now reads its name through the renderer's own
 * `useTableTranslation`, from `table.firstPage` / `table.previousPage` /
 * `table.nextPage` / `table.lastPage`.
 *
 * The names are read against the PACK, never against a literal: with no
 * provider the renderer's defaults table stands in for the `en` pack, and
 * under a provider the viewer's pack answers. Each name is also DRIVEN — a
 * click on the button so named must land on the page the name promises — so
 * two swapped keys are red, not only a missing one.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { ObjectGridSchema } from '@object-ui/types';
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as unknown as Element['hasPointerCapture'];
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});

/** 12 rows over pages of 5: three pages, so every button has somewhere to go. */
const ROWS = Array.from({ length: 12 }, (_, i) => ({
  id: String(i + 1),
  name: `Row ${String(i + 1).padStart(2, '0')}`,
}));

function grid(language?: string) {
  const node = (
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: 'task',
          columns: [{ field: 'name', label: 'Name' }],
          data: { provider: 'value', items: ROWS },
          pagination: { pageSize: 5 },
        } as unknown as ObjectGridSchema}
      />
    </ActionProvider>
  );
  return language ? (
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      {node}
    </I18nProvider>
  ) : (
    node
  );
}

const PAGER_KEYS = ['firstPage', 'previousPage', 'nextPage', 'lastPage'] as const;
type PagerKey = (typeof PAGER_KEYS)[number];
type PagerNames = Record<PagerKey, string>;

const namesIn = (pack: { table: Record<string, string> }): PagerNames =>
  Object.fromEntries(PAGER_KEYS.map((k) => [k, pack.table[k]])) as PagerNames;

/** The page on screen is the one whose first row is drawn and whose neighbours' are not. */
async function expectPage(first: string, absent: string[]) {
  await waitFor(() => expect(screen.getByText(first)).toBeInTheDocument());
  for (const row of absent) expect(screen.queryByText(row)).toBeNull();
}

/** Find each of the four by role and name, and drive it to the page it names. */
async function walkThePager(names: PagerNames) {
  // The names are four distinct words — none empty, none a raw key.
  for (const k of PAGER_KEYS) {
    expect(names[k]).toBeTruthy();
    expect(names[k]).not.toBe(`table.${k}`);
  }
  expect(new Set(Object.values(names)).size).toBe(4);

  const button = (k: PagerKey) => screen.getByRole('button', { name: names[k] });

  await expectPage('Row 01', ['Row 06', 'Row 11']);
  expect(button('firstPage')).toBeDisabled();
  expect(button('previousPage')).toBeDisabled();
  expect(button('nextPage')).toBeEnabled();
  expect(button('lastPage')).toBeEnabled();

  fireEvent.click(button('lastPage'));
  await expectPage('Row 11', ['Row 01', 'Row 06']);
  expect(button('nextPage')).toBeDisabled();
  expect(button('lastPage')).toBeDisabled();

  fireEvent.click(button('previousPage'));
  await expectPage('Row 06', ['Row 01', 'Row 11']);

  fireEvent.click(button('firstPage'));
  await expectPage('Row 01', ['Row 06', 'Row 11']);

  fireEvent.click(button('nextPage'));
  await expectPage('Row 06', ['Row 01', 'Row 11']);
}

describe('the paged grid names its four page buttons (objectui#12124)', () => {
  it('with no provider, each is found by the `en` pack\'s name and goes where it says', async () => {
    render(grid());
    await walkThePager(namesIn(en));
  });

  it('under zh, each is named by the zh pack, not by the English words', async () => {
    const zhNames = namesIn(zh);
    const enNames = namesIn(en);
    // The pin is only a pin if the two packs disagree, key by key.
    for (const k of PAGER_KEYS) expect(zhNames[k]).not.toBe(enNames[k]);

    render(grid('zh'));
    await screen.findByRole('button', { name: zhNames.nextPage });
    for (const k of PAGER_KEYS) {
      expect(screen.queryByRole('button', { name: enNames[k] })).toBeNull();
    }
    await walkThePager(zhNames);
  });
});
