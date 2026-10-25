/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11475 — the detail faces read a percent field's DECLARED storage
 * (the spec's `percentScaleOf`: a fraction unless the field declares a `max`
 * above 1), never a storage guessed from the value.
 *
 * - The related list's cell bag carries `max`. It copied `scale` and
 *   `useGrouping` but not `max`, so once the cell read the declaration a
 *   whole-stored field (`max: 100`, as every shipped percent field declares)
 *   would have read a stored `50` as `5000%` there.
 * - The details body (through the enrichment key list) reads the same.
 * - `summaryChipPercentPoints` takes the storage its caller states.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

import '@object-ui/components';
import type { DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';
import { RelatedList } from '../RelatedList';
import { summaryChipPercentPoints } from '../summaryChipPercent';

vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })),
);

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});
afterEach(cleanup);

const FIELDS = {
  // Whole-stored, as CRM `probability` declares it.
  probability: { type: 'percent', label: 'Probability', min: 0, max: 100 },
  // Fraction-stored: no `max`.
  won_share: { type: 'percent', label: 'Won Share' },
};

const RECORD = { id: 'r1', probability: 50, won_share: 1 };

describe("the detail faces read a percent field's declared storage (objectui#11475)", () => {
  it('DetailSection: a whole-stored 50 reads 50% and a fraction-stored 1 reads 100%', () => {
    const section = {
      title: 'S',
      fields: [{ name: 'probability' }, { name: 'won_share' }],
    } as unknown as DetailViewSection;
    const { container } = render(
      <DetailSection section={section} data={RECORD} objectSchema={{ fields: FIELDS }} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('50%');
    expect(text).toContain('100%');
    expect(text).not.toContain('5000%');
  });

  it("RelatedList: the related table's cell bag carries `max`", async () => {
    const dataSource = {
      getObjectSchema: vi.fn(async () => ({ name: 'deal', fields: { name: { type: 'text', label: 'Name' }, ...FIELDS } })),
      find: vi.fn(async () => ({ data: [{ ...RECORD, name: 'Tower' }], total: 1 })),
    };
    const { container } = render(
      <RelatedList
        title="Deals"
        type="table"
        api="deal"
        objectName="deal"
        referenceField="parent"
        parentId="P-1"
        dataSource={dataSource as any}
      />,
    );
    await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
    await waitFor(() => expect(container.textContent).toContain('Tower'));
    const cells = Array.from(container.querySelectorAll('tbody td')).map((td) => (td.textContent ?? '').trim());
    expect(cells, `cells: ${JSON.stringify(cells)}`).toContain('50%');
    expect(cells).toContain('100%');
    expect(cells).not.toContain('5000%');
  });
});

describe('summaryChipPercentPoints takes the stated storage (objectui#11475)', () => {
  it('a fraction is scaled at every magnitude, with the residue trim', () => {
    expect(summaryChipPercentPoints(1, 'fraction')).toBe(100);
    expect(summaryChipPercentPoints(0.07, 'fraction')).toBe(7);
  });

  it('whole points pass through at every magnitude', () => {
    expect(summaryChipPercentPoints(0.5, 'whole')).toBe(0.5);
    expect(summaryChipPercentPoints(50, 'whole')).toBe(50);
  });
});
