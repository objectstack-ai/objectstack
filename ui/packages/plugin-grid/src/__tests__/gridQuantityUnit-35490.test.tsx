/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35490 (ADR-0158 R1 display), in the object grid: a quantity
 * draws with its unit's label and display decimal places, and a `record`-mode
 * quantity reads its row's code even when the code column is not shown, so
 * the grid's read carries the code field and the row's organization.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();
afterEach(cleanup);

const FIELDS = {
  name: { name: 'name', type: 'text', label: 'Line' },
  qty: { name: 'qty', type: 'number', label: 'Qty', unitConfig: { unitMode: 'record', unitField: 'unit_code' } },
  weight: { name: 'weight', type: 'number', label: 'Weight', unitConfig: { unitMode: 'fixed', unit: 'KGM' } },
  unit_code: { name: 'unit_code', type: 'text', label: 'Unit' },
};
const RAW = [
  { id: 'l1', name: 'L1', qty: 4, weight: 1.25, unit_code: 'BOX_12', organization_id: 'org_a' },
  { id: 'l2', name: 'L2', qty: 1.5, weight: 2, unit_code: 'GRM', organization_id: 'org_a' },
  { id: 'l3', name: 'L3', qty: 2, weight: 3, unit_code: 'JIN1', organization_id: 'org_a' },
];
const UNITS = [
  { code: 'BOX_12', label: 'Box of 12', decimal_places: 1, retired: false, organization_id: 'org_a' },
  { code: 'JIN1', label: 'Jin', decimal_places: 2, retired: true, organization_id: 'org_a' },
];
const SETTINGS = [
  { code: 'GRM', decimal_places: 3, organization_id: 'org_a' },
  { code: 'KGM', decimal_places: 1, organization_id: 'org_a' },
];

/** A source that honours `$select`, as the server does, and answers the unit tables. */
function source() {
  const calls: Array<{ object: string; params: Record<string, unknown> }> = [];
  const ds = {
    find: async (object: string, p: Record<string, unknown>) => {
      calls.push({ object, params: p });
      if (object === 'sys_unit') return { data: UNITS };
      if (object === 'sys_standard_unit_setting') return { data: SETTINGS };
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

const rowTexts = () => [...document.querySelectorAll('tbody tr')].map((tr) => (tr.textContent ?? '').replace(/ /g, ' '));

describe('object grid: a quantity with its unit (objectstack#35490)', () => {
  it("draws each row in its own unit, with the unit column not shown", async () => {
    const { ds, calls } = source();
    render(
      <LocalizationProvider value={{ locale: 'en-US' }}>
        {/* The host's data source, as the console provides it to every cell. */}
        <SchemaRendererProvider dataSource={ds as never}>
          <ActionProvider>
            <ObjectGrid schema={{ type: 'object-grid', objectName: 'line', columns: [{ field: 'name' }, { field: 'qty' }, { field: 'weight' }] } as never} dataSource={ds as never} />
          </ActionProvider>
        </SchemaRendererProvider>
      </LocalizationProvider>,
    );
    await waitFor(() => expect(screen.getByText('L1')).toBeInTheDocument());
    await waitFor(() => {
      const rows = rowTexts();
      expect(rows[0]).toContain('4.0 Box of 12');
      expect(rows[0]).toContain('1.3 kg');
      expect(rows[1]).toContain('1.500 g');
      expect(rows[2]).toContain('2 JIN1');
    });
    const read = calls.find((c) => c.object === 'line')!;
    expect(read.params.$select).toEqual(expect.arrayContaining(['unit_code', 'organization_id']));
  });
});

describe('object grid with no SchemaRendererProvider: the known degraded shape (objectstack#35490)', () => {
  it('reads no unit rows, so a standard unit keeps its label at the field width and an org unit shows its code, with no error', async () => {
    const { ds, calls } = source();
    render(
      <LocalizationProvider value={{ locale: 'en-US' }}>
        <ActionProvider>
          <ObjectGrid schema={{ type: 'object-grid', objectName: 'line', columns: [{ field: 'name' }, { field: 'qty' }, { field: 'weight' }] } as never} dataSource={ds as never} />
        </ActionProvider>
      </LocalizationProvider>,
    );
    await waitFor(() => expect(screen.getByText('L1')).toBeInTheDocument());
    const rows = rowTexts();
    expect(rows[0]).toContain('4 BOX_12');
    expect(rows[0]).toContain('1.25 kg');
    expect(rows[1]).toContain('1.5 g');
    expect(calls.some((c) => c.object === 'sys_unit' || c.object === 'sys_standard_unit_setting')).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
