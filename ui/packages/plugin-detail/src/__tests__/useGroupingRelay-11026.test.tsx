/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11026: a number field's authored `useGrouping` reaches the DETAIL
 * cells, through each of the three places this package hand-copies field
 * metadata beside `scale`.
 *
 *  - `ENRICHED_FIELD_METADATA_KEYS` (`enrichDetailField`), which `DetailSection`,
 *    `HeaderHighlight` and the summary chips share;
 *  - `buildRecordDetailFields` (`RecordDetailPanel`), the quick-look overlay,
 *    rendered here with NO data source, so `DetailView` has no object schema
 *    to enrich from and the panel's own copy is the only road;
 *  - `RelatedList`'s `makeCell` bag.
 *
 * `NumberCellRenderer` reads the key; a site that drops it hands the cell a
 * field without it, and the author's hint silently becomes the heuristic.
 * Each case asserts the drawn text, with a same-shape control field that
 * carries no hint and must keep the heuristic's grouped answer.
 *
 * The viewport is pinned to desktop: `RelatedList` swaps its table for a
 * gallery under `useIsMobile()` (objectui#8399), and the gallery draws no
 * table cells.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// The real data-table (and its cell renderers) must be registered: these pins
// read what the cells DRAW.
import '@object-ui/components';
import type { DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';
import { RecordDetailPanel } from '../RecordDetailPanel';
import { RelatedList } from '../RelatedList';

// `RecordDetailPanel` mounts `DetailView`, whose `useRecordEditable` probes
// `POST /api/v1/security/explain`; happy-dom would resolve that to a REAL
// socket (objectui#6640). One double at module scope, never torn down, so no
// test can end with the real `fetch` back in place (objectui#7439).
vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })),
);

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});
afterEach(cleanup);

const FIELDS = {
  // The author's opt-out, on a scale the heuristic would group.
  code: { type: 'number', label: 'Plain Code', scale: 1, useGrouping: false },
  // The author's pin, on a scale the heuristic would leave ungrouped.
  headcount: { type: 'number', label: 'Headcount', scale: 0, useGrouping: true },
  // The control: no hint, so the heuristic's grouped answer is right.
  total: { type: 'number', label: 'Total', scale: 1 },
};

const RECORD = { id: 'r1', code: 12345.5, headcount: 2026, total: 67890.5 };

function expectDeclaredGrouping(text: string) {
  expect(text, 'useGrouping false renders ungrouped').toContain('12345.5');
  expect(text).not.toContain('12,345.5');
  expect(text, 'useGrouping true renders grouped at scale 0').toContain('2,026');
  expect(text, 'CONTROL: no hint keeps the heuristic').toContain('67,890.5');
}

describe('the authored useGrouping reaches the detail cells (objectui#11026)', () => {
  it('DetailSection: through the enrichment key list, from the object schema', () => {
    const section = {
      title: 'S',
      fields: [{ name: 'code' }, { name: 'headcount' }, { name: 'total' }],
    } as unknown as DetailViewSection;
    const { container } = render(
      <DetailSection section={section} data={RECORD} objectSchema={{ fields: FIELDS }} />,
    );
    expectDeclaredGrouping(container.textContent ?? '');
  });

  it('RecordDetailPanel: through the panel\'s own field build', async () => {
    const { container } = render(
      <RecordDetailPanel
        record={RECORD}
        objectName="metric"
        recordId="r1"
        objectSchema={{ fields: FIELDS }}
      />,
    );
    await waitFor(() => expect(container.textContent).toContain('67,890.5'));
    expectDeclaredGrouping(container.textContent ?? '');
  });

  it('RelatedList: through the related table\'s cell bag', async () => {
    const dataSource = {
      getObjectSchema: vi.fn(async () => ({ name: 'metric', fields: { name: { type: 'text', label: 'Name' }, ...FIELDS } })),
      find: vi.fn(async () => ({ data: [{ ...RECORD, name: 'Tower' }], total: 1 })),
    };
    const { container } = render(
      <RelatedList
        title="Metrics"
        type="table"
        api="metric"
        objectName="metric"
        referenceField="parent"
        parentId="P-1"
        dataSource={dataSource as any}
      />,
    );
    await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
    await waitFor(() => expect(container.textContent).toContain('Tower'));
    const cells = Array.from(container.querySelectorAll('tbody td')).map((td) => (td.textContent ?? '').trim());
    expect(cells, `cells: ${JSON.stringify(cells)}`).toContain('12345.5');
    expect(cells).toContain('2,026');
    expect(cells).toContain('67,890.5');
  });
});
