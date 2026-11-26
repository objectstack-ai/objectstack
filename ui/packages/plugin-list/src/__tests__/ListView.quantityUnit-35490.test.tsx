/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35490 (ADR-0158 R1 display), in the list view (the console's
 * list host): a `record`-mode quantity reads its row's code even when the code
 * column is not shown, so the list's own read carries the code field and the
 * row's organization.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import '@object-ui/plugin-grid';
import { ListView } from '../ListView';

registerAllFields();
afterEach(cleanup);

const FIELDS = {
  name: { name: 'name', type: 'text', label: 'Line' },
  qty: { name: 'qty', type: 'number', label: 'Qty', unitConfig: { unitMode: 'record', unitField: 'unit_code' } },
  unit_code: { name: 'unit_code', type: 'text', label: 'Unit' },
};
const RAW = [
  { id: 'l1', name: 'L1', qty: 4, unit_code: 'BOX_12', organization_id: 'org_a' },
  { id: 'l2', name: 'L2', qty: 1.5, unit_code: 'GRM', organization_id: 'org_b' },
];

function source() {
  const calls: Array<{ object: string; params: Record<string, unknown> }> = [];
  const ds = {
    find: async (object: string, p: Record<string, unknown>) => {
      calls.push({ object, params: p });
      if (object === 'sys_unit') return { data: [{ code: 'BOX_12', label: 'Box of 12', decimal_places: 1, retired: false, organization_id: 'org_a' }] };
      if (object === 'sys_standard_unit_setting') {
        return { data: [{ code: 'GRM', decimal_places: 3, organization_id: 'org_a' }, { code: 'GRM', decimal_places: 0, organization_id: 'org_b' }] };
      }
      const sel = Array.isArray(p?.$select) ? (p.$select as string[]) : undefined;
      const data = RAW.map((r) => (sel ? Object.fromEntries(Object.entries(r).filter(([k]) => k === 'id' || sel.includes(k))) : r));
      return { data, total: data.length };
    },
    findOne: async () => null,
    create: async () => ({}),
    update: async () => ({}),
    delete: async () => true,
    getObjectSchema: async () => ({ name: 'line', fields: FIELDS }),
  };
  return { ds, calls };
}

describe('list view: a quantity with its unit column not shown (objectstack#35490)', () => {
  it("reads each row's own unit and organization, so the read carries both", async () => {
    const { ds, calls } = source();
    render(
      <LocalizationProvider value={{ locale: 'en-US' }}>
        <SchemaRendererProvider dataSource={ds as never}>
          <ActionProvider>
            <ListView schema={{ type: 'list-view', objectName: 'line', viewType: 'grid', columns: ['name', 'qty'] } as never} dataSource={ds as never} />
          </ActionProvider>
        </SchemaRendererProvider>
      </LocalizationProvider>,
    );
    await waitFor(() => expect(screen.getByText('L1')).toBeInTheDocument(), { timeout: 8000 });
    await waitFor(() => {
      const rows = [...document.querySelectorAll('tbody tr')].map((tr) => (tr.textContent ?? '').replace(/\u00a0/g, ' '));
      expect(rows[0]).toContain('4.0 Box of 12');
      // The row of organization B: B's setting of 0 places, not A's of 3.
      expect(rows[1]).toContain('2 gram');
    });
    const read = calls.find((c) => c.object === 'line')!;
    expect(read.params.$select).toEqual(expect.arrayContaining(['unit_code', 'organization_id']));
  });
});
