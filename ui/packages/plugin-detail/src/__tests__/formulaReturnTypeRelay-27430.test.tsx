/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27430 row 1: a formula's declared `returnType` reaches the two
 * remaining places this package hand-copies field metadata for its cells
 * (the record page's key list and the grid were objectstack#27494):
 *
 *  - `RelatedList`'s `makeCell` bag;
 *  - `buildRecordDetailFields` (`RecordDetailPanel`), the quick-look overlay.
 *
 * The formula cell picks its face from `returnType`, and a `currency` one
 * draws through the currency cell with the formula's own `currencyConfig`.
 * Both copies carried `currencyConfig` and `scale` but not `returnType`, so
 * a money formula read as a bare `90,000.00`.
 *
 * ── Directions on the base tree (predicted before the first run) ─────────
 *   currency formula, related list and panel   RED   (`90,000.00`)
 *   number formula control                     GREEN (the number face is right)
 *
 * The viewport is pinned to desktop: `RelatedList` swaps its table for a
 * gallery under `useIsMobile()`, and the gallery draws no table cells.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { FieldSchema } from '@objectstack/spec/data';

import '@object-ui/components';
import { RecordDetailPanel, buildRecordDetailFields } from '../RecordDetailPanel';
import { RelatedList } from '../RelatedList';

// `RecordDetailPanel` mounts `DetailView`, whose `useRecordEditable` probes
// `POST /api/v1/security/explain`; one double at module scope, never torn down.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })),
);

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});
afterEach(cleanup);

const USD_FIXED = { currencyMode: 'fixed', defaultCurrency: 'USD' } as const;

const FIELDS = {
  budget: { type: 'currency', label: 'Budget', currencyConfig: USD_FIXED },
  // The showcase's Budget Remaining, as `project.object.ts` declares it.
  remaining: { type: 'formula', label: 'Budget Remaining', returnType: 'currency', currencyConfig: USD_FIXED, scale: 2 },
  // The control: a declared number keeps the bare grouped number.
  ratio: { type: 'formula', label: 'Burn Ratio', returnType: 'number', scale: 2 },
};

const RECORD = { id: 'p1', budget: 150000, remaining: 90000, ratio: 1234.5 };

function expectMoneyFormula(text: string) {
  expect(text).toContain('$150,000.00');
  expect(text, 'the currency formula draws as money').toContain('$90,000.00');
  expect(text, 'CONTROL: a number formula keeps the bare grouped number').toContain('1,234.50');
  expect(text).not.toContain('$1,234.50');
}

describe('a formula returnType reaches the related list and the quick-look panel (objectstack#27430)', () => {
  it('CONTROL: the fixture is a spec-valid formula field def', () => {
    expect(FieldSchema.safeParse({ name: 'remaining', expression: 'record.budget', ...FIELDS.remaining }).success).toBe(true);
  });

  it('buildRecordDetailFields carries returnType from the object field', () => {
    const built = buildRecordDetailFields(RECORD, { fields: FIELDS }, new Set(['id']));
    expect(built.find((f) => f.name === 'remaining')?.returnType).toBe('currency');
    expect(built.find((f) => f.name === 'ratio')?.returnType).toBe('number');
  });

  it('RecordDetailPanel: the currency formula reads as money; a number formula stays bare', async () => {
    const { container } = render(
      <RecordDetailPanel record={RECORD} objectName="project" recordId="p1" objectSchema={{ fields: FIELDS }} />,
    );
    await waitFor(() => expect(container.textContent).toContain('1,234.5'));
    expectMoneyFormula(container.textContent ?? '');
  });

  it('RelatedList: the currency formula cell reads as money; a number formula cell stays bare', async () => {
    const dataSource = {
      getObjectSchema: vi.fn(async () => ({ name: 'project', fields: { name: { type: 'text', label: 'Name' }, ...FIELDS } })),
      find: vi.fn(async () => ({ data: [{ ...RECORD, name: 'Tower' }], total: 1 })),
    };
    const { container } = render(
      <RelatedList
        title="Projects"
        type="table"
        api="project"
        objectName="project"
        referenceField="parent"
        parentId="P-1"
        dataSource={dataSource as any}
      />,
    );
    await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
    await waitFor(() => expect(container.textContent).toContain('Tower'));
    const cells = Array.from(container.querySelectorAll('tbody td')).map((td) => (td.textContent ?? '').trim());
    expect(cells, `cells: ${JSON.stringify(cells)}`).toContain('$90,000.00');
    expect(cells.some((c) => c.includes('1,234.50') && !c.includes('$'))).toBe(true);
  });
});
