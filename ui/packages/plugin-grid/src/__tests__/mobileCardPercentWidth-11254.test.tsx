/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11254 — the mobile card's percent cell reads its width through
 * `resolveFieldScale`, a carrier of ruling A′ (objectstack-ai/objectstack#19628).
 *
 * Below the 768px breakpoint ObjectGrid draws stacked cards whose density row
 * prints one percent column through `formatPercent` with an `undefined` width,
 * so the function's own parameter default decided: a percent field declaring
 * `scale: 2` read whole percents on the card while the desktop cell for the
 * same field read two decimals. For an undeclared percent that default equals
 * the protocol's row, which is why only a declared width is red on the base
 * tree.
 *
 * The card picks its percent column by NAME (`classify`'s `percentKeys`), so
 * every column here is named like one. That classification is not this card's
 * subject. What this file adds about it is one negative row: a `number` field
 * the card files under percent by its name does not have its `scale` read as a
 * percent width, because a `number`'s `scale` counts the decimals of the stored
 * value and not of the percentage points the card prints.
 *
 * ── Directions on the base tree (predicted before the first run) ──────────
 *   percent `scale: 2`            RED   (`12%` before)
 *   percent, no `scale`           GREEN (the default equals the protocol row)
 *   number `scale: 2` by name     GREEN (no `25.00%` either side)
 */

import React from 'react';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { registerAllFields, PercentCellRenderer } from '@object-ui/fields';
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

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: 'en' }}>{children}</LocalizationProvider>
    </I18nProvider>
  );
}

/** What the desktop list cell renders for `value` on `field`. */
function cellText(value: number, field: Record<string, unknown>): string {
  const { container, unmount } = render(
    <Providers>
      <PercentCellRenderer value={value} field={field as any} />
    </Providers>,
  );
  const text = container.textContent ?? '';
  unmount();
  return text;
}

/** Mount a one-row mobile grid whose percent-named column is `field`. */
async function renderCard(field: Record<string, unknown>, value: number) {
  const ds = {
    find: vi.fn(async () => ({
      data: [{ id: 'a1', account_name: 'Northwind', probability: value }],
      total: 1,
      hasMore: false,
      pageSize: 50,
    })),
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        account_name: { type: 'text', label: 'Account Name' },
        probability: { label: 'Probability', ...field },
      },
    }),
  } as any;
  const schema: any = {
    type: 'object-grid',
    objectName: 'showcase_account',
    columns: [
      { field: 'account_name', label: 'Account Name' },
      { field: 'probability', label: 'Probability' },
    ],
    pagination: { pageSize: 50 },
  };
  setMobileWidth();
  const view = render(
    <Providers>
      <ActionProvider>
        <SchemaRendererProvider dataSource={ds}>
          <ObjectGrid schema={schema} dataSource={ds} />
        </SchemaRendererProvider>
      </ActionProvider>
    </Providers>,
  );
  await waitFor(() => expect(screen.getByText('Northwind')).toBeInTheDocument());
  return view;
}

describe('the mobile card percent cell reads the resolved width (objectui#11254)', () => {
  it('a percent declaring `scale: 2` reads what the desktop cell reads', async () => {
    const field = { type: 'percent', scale: 2 };
    const expected = cellText(0.1234, field);
    expect(expected).toBe('12.34%');
    const { container } = await renderCard(field, 0.1234);
    await waitFor(() => expect(container.textContent).toContain(expected));
  });

  it('an undeclared percent reads the protocol row', async () => {
    const field = { type: 'percent' };
    const expected = cellText(0.1234, field);
    expect(expected).toBe('12%');
    const { container } = await renderCard(field, 0.1234);
    await waitFor(() => expect(container.textContent).toContain(expected));
    expect(container.textContent).not.toContain('12.34%');
  });

  // objectui#11475 replaced this case's subject. It pinned that a `number`
  // filed under percent by its NAME kept its `scale` off the percent width,
  // which presumed the slot printed it as a percent at all (`25%` for a stored
  // `0.25`). A non-percent field declares no percent storage, so the slot now
  // prints it through its own cell, the way the desktop row does, and its
  // `scale` is a NUMBER width again.
  it("a `number` filed under percent by its NAME prints through its own cell, with no percent affix (objectui#11475)", async () => {
    const { container } = await renderCard({ type: 'number', scale: 2 }, 0.25);
    await waitFor(() => expect(container.textContent).toContain('0.25'));
    expect(container.textContent).not.toContain('25%');
    expect(container.textContent).not.toContain('%');
  });

  it('a whole-stored percent (`max: 100`) reads its declared storage, as the desktop cell does (objectui#11475)', async () => {
    const field = { type: 'percent', max: 100 };
    const expected = cellText(50, field);
    expect(expected).toBe('50%');
    const { container } = await renderCard(field, 50);
    await waitFor(() => expect(container.textContent).toContain(expected));
    expect(container.textContent).not.toContain('5000%');
  });
});
