/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4553 phase 2 — the mobile card's percent cell.
 *
 * Below the 768px breakpoint ObjectGrid switches to a stacked card layout. Its
 * density row renders a date and a percent SIDE BY SIDE:
 *
 *     {formatDate(row[dateCols[0]...], 'short', { locale: displayLocale })}
 *     {formatPercent(Number(row[percentCols[0]...]))}
 *
 * objectui#4272 threaded the date half. The percent half beside it could not be
 * threaded then — `formatPercent` had no locale parameter — so one row rendered
 * two conventions, the same shape objectui#4553 found in the gantt tooltip.
 *
 * This consumer was NOT in the card's named consumer list; it came out of the
 * repo-wide `formatPercent` census the ruling asked for.
 *
 * ── Directions, predicted in writing BEFORE the run ──────────────────────
 * Runner machine locale en-US.
 *   de   `1235%` → `1.235 %`   RED
 *   en   `1235%` → `1,235%`    RED (the deliberate grouping move)
 *   the date half beside it                       PIN, green both sides
 */

import React from 'react';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

/** German writes a NO-BREAK SPACE (U+00A0) before the percent sign. */
const NBSP = '\u00a0';

const ORIGINAL_INNER_WIDTH = window.innerWidth;

function setMobileWidth() {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 });
}

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: ORIGINAL_INNER_WIDTH });
  cleanup();
});

/**
 * A four-digit percent, so the GROUPING separator is exercised — the whole
 * point of the en case. `win_rate` is named to match `classify()`'s
 * `percentKeys` ('rate'), which is what routes it to the percent cell at all;
 * `close_date` matches `dateKeys` for the same reason.
 */
const ROWS = [
  { id: 'a1', account_name: 'Northwind', close_date: '2024-03-15', win_rate: 1234.5 },
];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        account_name: { type: 'text', label: 'Account Name' },
        close_date: { type: 'date', label: 'Close Date' },
        // objectui#11475 — `1234.5` is percentage points, so the field
        // declares whole-point storage (a `max` above 1, the spec's
        // `percentScaleOf`); the card used to guess it from the value's size.
        // The locale this file measures is unmoved.
        win_rate: { type: 'percent', label: 'Win Rate', max: 10000 },
      },
    }),
  } as any;
}

function renderSession(language: string, tenantLocale?: string) {
  const ds = makeDataSource();
  const schema: any = {
    type: 'object-grid',
    objectName: 'showcase_account',
    columns: [
      { field: 'account_name', label: 'Account Name' },
      { field: 'close_date', label: 'Close Date', type: 'date' },
      { field: 'win_rate', label: 'Win Rate', type: 'percent' },
    ],
    pagination: { pageSize: 50 },
  };
  return render(
    <I18nProvider
      config={{ defaultLanguage: language, detectBrowserLanguage: false }}
      persistLanguage={false}
    >
      <LocalizationProvider value={{ locale: tenantLocale }}>
        <ActionProvider>
          <SchemaRendererProvider dataSource={ds}>
            <ObjectGrid schema={schema} dataSource={ds} />
          </SchemaRendererProvider>
        </ActionProvider>
      </LocalizationProvider>
    </I18nProvider>,
  );
}

describe('ObjectGrid mobile cards — the percent cell follows the display locale (objectui#4553)', () => {
  it('de session renders the German percent form', async () => {
    setMobileWidth();
    const { container } = renderSession('de');
    await waitFor(() => expect(screen.getByText('Northwind')).toBeInTheDocument());
    expect(container.textContent).toContain(`1.235${NBSP}%`);
    expect(container.textContent).not.toContain('1235%');
  });

  it('en session groups the percent — the deliberate output move', async () => {
    setMobileWidth();
    const { container } = renderSession('en');
    await waitFor(() => expect(screen.getByText('Northwind')).toBeInTheDocument());
    expect(container.textContent).toContain('1,235%');
  });

  /**
   * The card's actual complaint, asserted as ONE row: the date cell and the
   * percent cell beside it now speak the same convention. Pre-fix the date was
   * already German (objectui#4272) and the percent was not.
   */
  it('the date cell and the percent cell in one row agree on one convention', async () => {
    setMobileWidth();
    const { container } = renderSession('de');
    await waitFor(() => expect(screen.getByText('Northwind')).toBeInTheDocument());
    // objectui#4272's date half — PIN, unchanged by this card.
    expect(container.textContent).toContain('Mär');
    expect(container.textContent).toContain(`1.235${NBSP}%`);
  });
});
