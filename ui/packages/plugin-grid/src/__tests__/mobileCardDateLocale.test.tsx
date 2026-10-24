/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4272 — the mobile card view's compact date cells rendered an
 * English month on a non-English console.
 *
 * Below the 768px breakpoint ObjectGrid switches to a stacked card layout
 * whose date cells call `formatDate(value, 'short')`. Two things had to change
 * together for this to move at all, which is why they land in one PR:
 *
 *   - `@object-ui/fields`' `'short'` branch hardcoded
 *     `toLocaleDateString('en-US', { month: 'short' })`, so it ignored a
 *     locale even when one was threaded; and
 *   - these two call sites threaded no locale in the first place.
 *
 * Fixing either half alone leaves the rendered output exactly as it was.
 *
 * ── Directions ───────────────────────────────────────────────────────────
 * The runner's machine locale is `en-US` and `en`/`en-US` share every short
 * month name, so the `en` case here is GREEN ON BOTH SIDES — the
 * byte-identical must-not-change pin. The `zh` case is the red one.
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

const ORIGINAL_INNER_WIDTH = window.innerWidth;

function setMobileWidth() {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 });
}

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: ORIGINAL_INNER_WIDTH });
  cleanup();
});

/**
 * Mid-month and a non-current year: the day can never drift across a month
 * boundary, and the assertion is on the month token alone, so the case is
 * stable in any timezone and in any calendar year the suite runs in.
 */
const ROWS = [
  { id: 'a1', account_name: 'Northwind', close_date: '2024-03-15', start_date: '2024-06-20' },
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
        start_date: { type: 'date', label: 'Start Date' },
      },
    }),
  } as any;
}

function renderSession(language: string) {
  const ds = makeDataSource();
  const schema: any = {
    type: 'object-grid',
    objectName: 'showcase_account',
    // The card view partitions the columns AFTER the first (the card title)
    // and routes them by NAME: `classify()` matches `dateKeys` substrings, so
    // a column must be named like a date to reach the compact `'short'` cells
    // at all — `closed_on` would be classified 'other' and rendered by the
    // ordinary DateCellRenderer instead. Two date columns are carried so both
    // `'short'` sites run: `dateCols[0]` (the unlabelled density row) and
    // `dateCols.slice(1)` (the labelled rows below it).
    columns: [
      { field: 'account_name', label: 'Account Name' },
      { field: 'close_date', label: 'Close Date', type: 'date' },
      { field: 'start_date', label: 'Start Date', type: 'date' },
    ],
    pagination: { pageSize: 50 },
  };
  return render(
    <I18nProvider
      config={{ defaultLanguage: language, detectBrowserLanguage: false }}
      persistLanguage={false}
    >
      <LocalizationProvider value={{}}>
        <ActionProvider>
          <SchemaRendererProvider dataSource={ds}>
            <ObjectGrid schema={schema} dataSource={ds} />
          </SchemaRendererProvider>
        </ActionProvider>
      </LocalizationProvider>
    </I18nProvider>,
  );
}

describe("ObjectGrid mobile cards — the 'short' date cells follow the display locale (objectui#4272)", () => {
  it('zh session renders the Chinese month token at both short sites', async () => {
    setMobileWidth();
    const { container } = renderSession('zh');
    await waitFor(() => expect(screen.getByText('Northwind')).toBeInTheDocument());
    // dateCols[0] — the unlabelled density row.
    expect(container.textContent).toContain('3月');
    // dateCols.slice(1) — the labelled rows below it.
    expect(container.textContent).toContain('6月');
    expect(container.textContent).not.toContain('Mar');
    expect(container.textContent).not.toContain('Jun');
  });

  /** PIN — green on both sides; `en` and the runner's `en-US` agree here. */
  it('en session output is byte-identical (must-not-change)', async () => {
    setMobileWidth();
    const { container } = renderSession('en');
    await waitFor(() => expect(screen.getByText('Northwind')).toBeInTheDocument());
    expect(container.textContent).toContain("Mar 15, '24");
    expect(container.textContent).toContain("Jun 20, '24");
  });
});
