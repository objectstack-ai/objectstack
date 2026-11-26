/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35490 (ADR-0158 R1 display): a quantity's `unitConfig` reaches
 * the DETAIL cells through each place this package hand-copies field metadata
 * for them, and the row they read the unit off carries its code:
 *
 *  - `ENRICHED_FIELD_METADATA_KEYS` (`enrichDetailField`), which `DetailSection`
 *    and `HeaderHighlight` share;
 *  - `buildRecordDetailFields` (`RecordDetailPanel`), the quick-look overlay;
 *  - `RelatedList`'s cell bag and its `$select`, for a code column not shown.
 *
 * The unit rows come from the host's data source, as the console provides it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { SchemaRendererProvider } from '@object-ui/react';
import '@object-ui/components';
import type { DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';
import { RecordDetailPanel } from '../RecordDetailPanel';
import { RelatedList } from '../RelatedList';

vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })),
);

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});
afterEach(cleanup);

const FIELDS = {
  name: { type: 'text', label: 'Name' },
  qty: { type: 'number', label: 'Qty', unitConfig: { unitMode: 'record', unitField: 'unit_code' } },
  weight: { type: 'number', label: 'Weight', unitConfig: { unitMode: 'fixed', unit: 'KGM' } },
  unit_code: { type: 'text', label: 'Unit' },
};
const RECORD = { id: 'r1', name: 'Tower', qty: 4, weight: 1.25, unit_code: 'BOX_12', organization_id: 'org_a' };

function unitSource(rows: Record<string, unknown>[] = [RECORD]) {
  const calls: Array<{ object: string; params: Record<string, unknown> }> = [];
  return {
    calls,
    getObjectSchema: vi.fn(async () => ({ name: 'line', fields: FIELDS })),
    find: vi.fn(async (object: string, params: Record<string, unknown>) => {
      calls.push({ object, params });
      if (object === 'sys_unit') return { data: [{ code: 'BOX_12', label: 'Box of 12', decimal_places: 1, retired: false, organization_id: 'org_a' }] };
      if (object === 'sys_standard_unit_setting') return { data: [{ code: 'KGM', decimal_places: 1, organization_id: 'org_a' }] };
      const sel = Array.isArray(params?.$select) ? (params.$select as string[]) : undefined;
      const data = rows.map((r) => (sel ? Object.fromEntries(Object.entries(r).filter(([k]) => k === 'id' || sel.includes(k))) : r));
      return { data, total: data.length };
    }),
  };
}

const flat = (s: string | null | undefined) => (s ?? '').replace(/\u00a0/g, ' ');

describe('the declared unitConfig reaches the detail cells (objectstack#35490)', () => {
  it('DetailSection: a record-mode and a fixed-mode quantity, with their unit labels', async () => {
    const ds = unitSource();
    const section = { title: 'S', fields: [{ name: 'qty' }, { name: 'weight' }] } as unknown as DetailViewSection;
    const { container } = render(
      <SchemaRendererProvider dataSource={ds as never}>
        <DetailSection section={section} data={RECORD} objectSchema={{ fields: FIELDS }} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => {
      expect(flat(container.textContent)).toContain('4.0 Box of 12');
      expect(flat(container.textContent)).toContain('1.3 kilogram');
    });
  });

  it("RecordDetailPanel: through the panel's own field build", async () => {
    const ds = unitSource();
    const { container } = render(
      <SchemaRendererProvider dataSource={ds as never}>
        <RecordDetailPanel record={RECORD} objectName="line" recordId="r1" objectSchema={{ fields: FIELDS }} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(flat(container.textContent)).toContain('4.0 Box of 12'));
  });

  it("RelatedList: through the cell bag, with the unit column not shown, so the read carries it", async () => {
    const ds = unitSource();
    const { container } = render(
      <SchemaRendererProvider dataSource={ds as never}>
        <RelatedList
          title="Lines"
          type="table"
          api="line"
          objectName="line"
          referenceField="parent"
          parentId="P-1"
          columns={['name', 'qty'] as never}
          dataSource={ds as never}
        />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(container.textContent).toContain('Tower'));
    await waitFor(() => {
      const cells = Array.from(container.querySelectorAll('tbody td')).map((td) => flat(td.textContent).trim());
      expect(cells, `cells: ${JSON.stringify(cells)}`).toContain('4.0 Box of 12');
    });
    const read = ds.calls.find((c) => c.object === 'line');
    expect(read?.params.$select).toEqual(expect.arrayContaining(['unit_code', 'organization_id']));
  });
});
