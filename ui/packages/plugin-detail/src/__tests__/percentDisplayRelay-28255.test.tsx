/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28255: a percent field's authored `percentDisplay` reaches the
 * DETAIL cells, through each place this package hand-copies field metadata
 * beside `useGrouping`:
 *
 *  - `ENRICHED_FIELD_METADATA_KEYS` (`enrichDetailField`), which `DetailSection`
 *    and `HeaderHighlight` share;
 *  - `buildRecordDetailFields` (`RecordDetailPanel`), rendered with NO data
 *    source, so the panel's own copy is the only road;
 *  - `RelatedList`'s cell bag.
 *
 * `PercentCellRenderer` reads the key; a site that drops it hands the cell a
 * field without it, and a `plain` probability draws its bar again. Each case
 * has a same-shape control field with no key, which must keep its bar.
 *
 * The viewport is pinned to desktop: `RelatedList` swaps its table for a
 * gallery under `useIsMobile()` (objectui#8399).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

import '@object-ui/components';
import type { DetailViewSection, HighlightField } from '@object-ui/types';
import { DetailSection } from '../DetailSection';
import { HeaderHighlight } from '../HeaderHighlight';
import { RecordDetailPanel } from '../RecordDetailPanel';
import { RelatedList } from '../RelatedList';

// `RecordDetailPanel` mounts `DetailView`, whose `useRecordEditable` probes
// `POST /api/v1/security/explain`; one double at module scope (objectui#7439).
vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })),
);

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});
afterEach(cleanup);

const FIELDS = {
  // A probability, not progress: the author asks for the plain face.
  probability: { type: 'percent', label: 'Probability', percentDisplay: 'plain' },
  // The control: no key, so the bar stays.
  completion: { type: 'percent', label: 'Completion' },
};

const RECORD = { id: 'r1', probability: 0.25, completion: 0.6 };

/** Exactly one bar on the surface, and it is the control's 60. */
function expectDeclaredFaces(container: HTMLElement) {
  const text = container.textContent ?? '';
  expect(text, 'the plain value is drawn').toContain('25%');
  expect(text, 'CONTROL: the barred value is drawn').toContain('60%');
  const bars = Array.from(container.querySelectorAll('[role="progressbar"]'));
  expect(bars.map((b) => b.getAttribute('aria-valuenow')), '`plain` draws no bar; the control keeps its bar').toEqual(['60']);
}

describe('the authored percentDisplay reaches the detail cells (objectstack#28255)', () => {
  it('DetailSection: through the enrichment key list, from the object schema', () => {
    const section = {
      title: 'S',
      fields: [{ name: 'probability' }, { name: 'completion' }],
    } as unknown as DetailViewSection;
    const { container } = render(
      <DetailSection section={section} data={RECORD} objectSchema={{ fields: FIELDS }} />,
    );
    expectDeclaredFaces(container);
  });

  it('HeaderHighlight: the header chips share the enrichment key list', () => {
    const fields: HighlightField[] = [
      { name: 'probability', label: 'Probability' },
      { name: 'completion', label: 'Completion' },
    ];
    const { container } = render(
      <HeaderHighlight fields={fields} data={RECORD} objectSchema={{ fields: FIELDS }} />,
    );
    expectDeclaredFaces(container);
  });

  it('RecordDetailPanel: through the panel\'s own field build', async () => {
    const { container } = render(
      <RecordDetailPanel
        record={RECORD}
        objectName="deal"
        recordId="r1"
        objectSchema={{ fields: FIELDS }}
      />,
    );
    await waitFor(() => expect(container.textContent).toContain('60%'));
    expectDeclaredFaces(container);
  });

  it('RelatedList: through the related table\'s cell bag', async () => {
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
    expectDeclaredFaces(container.querySelector('tbody') as HTMLElement);
  });
});
