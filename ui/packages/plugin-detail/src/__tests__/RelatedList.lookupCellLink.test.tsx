/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4336, the follow-up's widening — the related list's own lookup
 * columns were dead too.
 *
 * On 设备详情页 → 相关 → 维保履历 the ROW navigates (to that 维保履历 record),
 * but every lookup cell pointing at a THIRD object (`执行责任人`,
 * `来源维保派工单`) was plain text: "逐格取 href 全部为 null,整行 6 个单元格
 * 没有任何 <a>".
 *
 * Measurement put both halves on ONE path: `RelatedList.makeCell` and
 * `DetailSection`'s read branch each resolve the cell through
 * `getCellRenderer('lookup')` → `LookupCellRenderer`. So this pin exists to
 * keep the related-list half honest at the end of ITS path — the detail body
 * being green is not evidence for this one.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

import { RelatedList } from '../RelatedList';
import { RelatedRecordActionsProvider } from '@object-ui/react';

/**
 * Desktop, pinned rather than inherited (objectui#8399). `RelatedList` reads
 * `useIsMobile` (breakpoint 768): above it a `type="table"` list renders a real
 * `data-table`, below it an `object-gallery` card layout with no headers, no
 * cells and no sort.
 *
 * Every case here reads what a lookup CELL draws.
 *
 * happy-dom's ambient `innerWidth` is 1024, so the desktop branch was inherited
 * here rather than chosen.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

// Capture the schema RelatedList hands to SchemaRenderer (the data-table), so
// a column's cell can be rendered directly — the same lever
// `RelatedList.lookupLabelResolution.test.tsx` uses.
const h = vi.hoisted(() => ({ schema: null as any }));
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    SchemaRenderer: (props: any) => {
      h.schema = props.schema;
      return null;
    },
  };
});

const historySchema = {
  name: 'mtc_history',
  fields: {
    equipment_id: { type: 'lookup', label: '设备', reference: 'mtc_equipment' },
    work_order_id: { type: 'lookup', label: '来源维保派工单', reference: 'mtc_work_order' },
  },
};

const rows = [{ id: 'h1', equipment_id: 'eq_1', work_order_id: 'wo_1' }];

const makeDataSource = () => ({
  getObjectSchema: vi.fn(async () => historySchema),
  find: vi.fn(async () => ({ data: rows, total: rows.length })),
});

function makeHost(overrides: Record<string, unknown> = {}) {
  return {
    resolve: () => ({}),
    recordHref: (objectName: string, recordId: string | number) =>
      `/apps/demo/${objectName}/record/${encodeURIComponent(String(recordId))}`,
    openRecord: vi.fn(),
    ...overrides,
  } as any;
}

/**
 * Render one column's cell for `value` INSIDE the host provider — production
 * mounts the whole related list under the console's bridge, so the cell reads
 * the same context there.
 */
function renderCell(accessorKey: string, value: unknown, host: any = makeHost()) {
  const col = h.schema?.columns?.find((c: any) => c?.accessorKey === accessorKey);
  expect(col?.cell).toBeTypeOf('function');
  return render(
    <RelatedRecordActionsProvider value={host}>
      <>{col.cell(value)}</>
    </RelatedRecordActionsProvider>,
  );
}

function mountList(dataSource: any) {
  return render(
    <RelatedRecordActionsProvider value={makeHost()}>
      <RelatedList
        title="维保履历"
        type="table"
        api="mtc_history"
        objectName="mtc_history"
        referenceField="equipment_id"
        parentId="eq_1"
        columns={[
          { accessorKey: 'equipment_id', header: '设备' },
          { accessorKey: 'work_order_id', header: '来源维保派工单' },
        ]}
        dataSource={dataSource as any}
      />
    </RelatedRecordActionsProvider>,
  );
}

beforeEach(() => {
  h.schema = null;
});

describe('RelatedList — lookup cells link to their referenced record (#4336)', () => {
  it('a lookup column pointing at a third object renders an anchor', async () => {
    const dataSource = makeDataSource();
    mountList(dataSource);
    await waitFor(() => expect(h.schema?.columns?.length).toBeGreaterThan(0));

    const { container } = renderCell('work_order_id', 'wo_1');
    const anchor = container.querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor).toHaveAttribute('href', '/apps/demo/mtc_work_order/record/wo_1');
  });

  it('must-not-change: no host routing → the cell stays plain text', async () => {
    const dataSource = makeDataSource();
    mountList(dataSource);
    await waitFor(() => expect(h.schema?.columns?.length).toBeGreaterThan(0));

    const { container } = renderCell('work_order_id', 'wo_1', makeHost({ recordHref: () => null }));
    expect(container.querySelector('a')).toBeNull();
  });

  it('must-not-change: an empty cell keeps its placeholder, with no link', async () => {
    const dataSource = makeDataSource();
    mountList(dataSource);
    await waitFor(() => expect(h.schema?.columns?.length).toBeGreaterThan(0));

    const { container } = renderCell('work_order_id', null);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('—');
  });
});
