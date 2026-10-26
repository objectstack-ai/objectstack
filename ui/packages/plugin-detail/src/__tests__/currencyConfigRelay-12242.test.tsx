/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12242: a currency field's `currencyConfig`, `@objectstack/spec`'s
 * one declaration of a fixed currency, reaches the DETAIL cells through each
 * place this package hand-copies field metadata for them.
 *
 *  - `ENRICHED_FIELD_METADATA_KEYS` (`enrichDetailField`), which `DetailSection`,
 *    `HeaderHighlight` and the summary chips share;
 *  - `buildRecordDetailFields` (`RecordDetailPanel`), the quick-look overlay,
 *    rendered with NO data source, so the panel's own copy is the only road;
 *  - `RelatedList`'s `makeCell` bag.
 *
 * `FieldSchema` refuses a field-level `currency` by name, so a spec object can
 * only say "this amount is in euros" with `currencyConfig`. The panel and the
 * related list copied `currency` and dropped `currencyConfig`, so a fixed-EUR
 * amount read in the tenant's currency there, or as a bare number with none.
 * Each case asserts the drawn text, beside a same-shape control field that
 * declares no currency and must keep the plain-number answer.
 *
 * The viewport is pinned to desktop: `RelatedList` swaps its table for a
 * gallery under `useIsMobile()`, and the gallery draws no table cells.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { FieldSchema } from '@objectstack/spec/data';

// The real data-table (and its cell renderers) must be registered: these pins
// read what the cells DRAW.
import '@object-ui/components';
import type { DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';
import { RecordDetailPanel } from '../RecordDetailPanel';
import { RelatedList } from '../RelatedList';

// `RecordDetailPanel` mounts `DetailView`, whose `useRecordEditable` probes
// `POST /api/v1/security/explain`; happy-dom would resolve that to a REAL
// socket. One double at module scope, never torn down, so no test can end
// with the real `fetch` back in place.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })),
);

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});
afterEach(cleanup);

const FIELDS = {
  // The spec's fixed currency.
  price: { type: 'currency', label: 'Price', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' } },
  // The control: no currency declared and no tenant default, so a plain number.
  amount: { type: 'currency', label: 'Amount' },
};

const RECORD = { id: 'r1', price: 1234.5, amount: 6789.5 };

function expectDeclaredCurrency(text: string) {
  expect(text, 'the fixed currency is drawn').toContain('€1,234.50');
  expect(text, 'CONTROL: no declared currency stays a plain number').toContain('6,789.5');
  expect(text).not.toContain('€6,789');
}

describe('the declared currencyConfig reaches the detail cells (objectui#12242)', () => {
  it('CONTROL — the field under test is a spec-valid field def, and a field-level `currency` is not', () => {
    expect(FieldSchema.safeParse({ name: 'price', ...FIELDS.price }).success).toBe(true);
    expect(FieldSchema.safeParse({ name: 'price', type: 'currency', currency: 'EUR' }).success).toBe(false);
  });

  it('DetailSection: through the enrichment key list, from the object schema', () => {
    const section = {
      title: 'S',
      fields: [{ name: 'price' }, { name: 'amount' }],
    } as unknown as DetailViewSection;
    const { container } = render(
      <DetailSection section={section} data={RECORD} objectSchema={{ fields: FIELDS }} />,
    );
    expectDeclaredCurrency(container.textContent ?? '');
  });

  it('RecordDetailPanel: through the panel\'s own field build', async () => {
    const { container } = render(
      <RecordDetailPanel
        record={RECORD}
        objectName="quote"
        recordId="r1"
        objectSchema={{ fields: FIELDS }}
      />,
    );
    await waitFor(() => expect(container.textContent).toContain('6,789.5'));
    expectDeclaredCurrency(container.textContent ?? '');
  });

  it('RelatedList: through the related table\'s cell bag', async () => {
    const dataSource = {
      getObjectSchema: vi.fn(async () => ({ name: 'quote', fields: { name: { type: 'text', label: 'Name' }, ...FIELDS } })),
      find: vi.fn(async () => ({ data: [{ ...RECORD, name: 'Tower' }], total: 1 })),
    };
    const { container } = render(
      <RelatedList
        title="Quotes"
        type="table"
        api="quote"
        objectName="quote"
        referenceField="parent"
        parentId="P-1"
        dataSource={dataSource as any}
      />,
    );
    await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
    await waitFor(() => expect(container.textContent).toContain('Tower'));
    const cells = Array.from(container.querySelectorAll('tbody td')).map((td) => (td.textContent ?? '').trim());
    expect(cells, `cells: ${JSON.stringify(cells)}`).toContain('€1,234.50');
    expect(cells.some((c) => c.includes('6,789.5') && !c.includes('€'))).toBe(true);
  });
});
