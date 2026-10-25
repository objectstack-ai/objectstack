/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10423: the mobile card's one-line amount summary reads the FIELD's
 * currency, exactly as the desktop cell of the same row does.
 *
 * objectui#10354 made the desktop cell and the summary footer carry the
 * field's `currencyConfig`. The mobile card's amount line did not follow: it
 * picks `amountCol` from the card's secondary columns by name and resolved
 * the currency from that column DRAFT (`accessorKey`, `header`, `type`, …),
 * which carries neither `currency` nor `currencyConfig`. So under a USD
 * tenant a JPY-fixed amount read `¥1,234,567` in the desktop cell and
 * `$1.2M` on the phone card of the same row.
 *
 * Driven through the real `ObjectGrid` at a phone width, on each column shape
 * the builder branches on (every one keys `accessorKey` by the field name).
 *
 * ── Directions on the base tree (predicted before the first run) ─────────
 *   JPY-fixed card line, each column shape        RED   (tenant `$1.2M`)
 *   control: no currencyConfig reads the tenant $ GREEN (tenant is right)
 *   control: the desktop cell of the fixture      GREEN (objectui#10354)
 */

import React from 'react';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});

const ORIGINAL_INNER_WIDTH = window.innerWidth;
afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: ORIGINAL_INNER_WIDTH });
  cleanup();
});

function setWidth(value: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value });
}

/** A USD tenant: every field that names no currency of its own reads `$`. */
const TENANT = { currency: 'USD', locale: 'en' };

const OBJECT = 'os_10423_deal';

const FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text' },
  name: { type: 'text', label: 'Deal Name' },
  // `classify` reads `amount` in the key, so this is the card's amount line.
  amount: {
    type: 'currency',
    label: 'Yen Amount',
    currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' },
  },
  // The control: also classified `amount`, but no `currencyConfig`.
  plain_amount: { type: 'currency', label: 'Plain Amount' },
  // The enrichment signal: the card's stage badge reads its label off the
  // object schema's options, so `Won Label` on the card proves the field
  // defs have arrived (the schema is fetched async; a `$` read before it
  // lands would pass for the wrong reason).
  stage: { type: 'select', label: 'Stage', options: [{ value: 'won', label: 'Won Label' }] },
};

const ROW = { id: 'd1', name: 'Tower', amount: 1234567, plain_amount: 1234567, stage: 'won' };

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [ROW], total: 1, hasMore: false, pageSize: 50 })),
    getObjectSchema: async (name: string) => ({ name, fields: structuredClone(FIELDS) }),
  } as never;
}

async function renderGrid(schemaExtra: Record<string, unknown>) {
  const ds = makeDataSource();
  const utils = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={TENANT}>
        <ActionProvider>
          <SchemaRendererProvider dataSource={ds}>
            <ObjectGrid
              schema={{
                type: 'object-grid',
                objectName: OBJECT,
                data: { provider: 'value', items: [ROW] },
                pagination: { pageSize: 50 },
                ...schemaExtra,
              } as never}
              dataSource={ds}
            />
          </SchemaRendererProvider>
        </ActionProvider>
      </LocalizationProvider>
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getAllByText('Won Label').length).toBeGreaterThan(0));
  return utils;
}

/** The card's amount line: the left-hand span of the Amount + Stage row. */
async function cardAmountLine(schemaExtra: Record<string, unknown>): Promise<string> {
  setWidth(390);
  const { container } = await renderGrid(schemaExtra);
  expect(container.querySelector('table'), 'expected the mobile card layout, not the table').toBeNull();
  const line = container.querySelector('span.tabular-nums.font-medium');
  expect(line, 'the card rendered no amount line').not.toBeNull();
  return (line!.textContent ?? '').trim();
}

/** Each column shape the builder branches on, leading with the title column. */
function paths(amountField: string): Array<[string, Record<string, unknown>]> {
  return [
    ['ListColumn objects', { columns: [{ field: 'name' }, { field: amountField }, { field: 'stage' }] }],
    ['string columns', { columns: ['name', amountField, 'stage'] }],
    ['inline rows + fields projection', { fields: ['name', amountField, 'stage'] }],
  ];
}

describe('the mobile card amount line reads the field currency (objectui#10423)', () => {
  it.each(paths('amount'))('%s: a JPY-fixed amount reads ¥ on the card under a USD tenant', async (_p, extra) => {
    expect(await cardAmountLine(extra)).toBe('¥1.2M');
  });

  it.each(paths('plain_amount'))('%s: control, a field with no currencyConfig reads the tenant $', async (_p, extra) => {
    expect(await cardAmountLine(extra)).toBe('$1.2M');
  });

  it.each(paths('amount'))('%s: control, the desktop cell of the same fixture reads ¥', async (_p, extra) => {
    setWidth(1280);
    const { container } = await renderGrid(extra);
    const cells = Array.from(container.querySelectorAll('tbody td')).map((td) => (td.textContent ?? '').trim());
    expect(cells, `cells: ${JSON.stringify(cells)}`).toContain('¥1,234,567');
  });
});
