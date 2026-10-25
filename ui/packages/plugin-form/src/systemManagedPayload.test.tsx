/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A form never emits a column the server owns (objectui#10108).
 *
 * ## What was measured, and the control that makes it readable
 *
 * The platform refuses a write to a system-managed ownership column unless the
 * caller holds the transfer grant (`allowTransfer` / `modifyAllRecords`), and
 * it cannot tell a round-trip of the value it just served from an attempted
 * ownership transfer. So a form that echoes an UNCHANGED `owner_id` back is a
 * 403 for every role without that grant — and because a master-detail save
 * commits as ONE atomic batch, one echoed column on one row refuses the whole
 * save, including the parent and the rows the user never touched.
 *
 * The rows below are written so the absence of `owner_id` cannot be read as an
 * absence the fixture invented: each one asserts, in the same payload, that a
 * column which was ALREADY refused before this fix is still refused
 * (`created_at`, `updated_at`, `organization_id`, `id`) and that the business
 * columns are still present. Before the fix the same fixture kept `owner_id`,
 * `owning_business_unit_id`, `created_by` and `updated_by` while dropping
 * `created_at` and `organization_id` — one filter, two answers, which is what
 * identified the roster rather than the schema as the defect's home.
 *
 * ## Both paths, and why they are pinned separately
 *
 * The card names two: the master-detail `POST /api/v1/batch` save and the plain
 * record edit form's `PATCH`. They share ONE builder (`sanitizeFormData`), so
 * the fix is one place — but nothing structural makes them keep sharing it, and
 * a fix asserted only through the batch would not notice the plain form growing
 * its own payload assembly. Each is pinned at its own seam.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

import { ObjectForm } from './ObjectForm';
import { registerAllFields } from '@object-ui/fields';
import { sanitizeFormData } from './sanitize';
import { buildMasterDetailEditBatch, buildMasterDetailBatch } from './masterDetailTx';

registerAllFields();

/**
 * The child object as the platform serves it: author-declared business columns
 * PLUS the columns `applySystemFields` injects. The injected ones are neither
 * `hidden` nor `readonly` — ownership is reassignable — which is precisely why
 * the type/readonly branches of the sanitizer never caught them.
 */
const CHILD_SCHEMA = {
  name: 'kpi_entry_line',
  fields: {
    sheet: { type: 'master_detail', label: 'Sheet', reference: 'kpi_entry_sheet' },
    plan_indicator: { type: 'lookup', label: 'Indicator' },
    actual_value: { type: 'number', label: 'Actual' },
    remark: { type: 'textarea', label: 'Remark' },
    owner_id: { type: 'lookup', label: 'Owner', system: true },
    owning_business_unit_id: { type: 'lookup', label: 'Business Unit', system: true },
    organization_id: { type: 'lookup', label: 'Organization', system: true },
    created_at: { type: 'datetime', label: 'Created', system: true },
    created_by: { type: 'lookup', label: 'Created By', system: true },
    updated_at: { type: 'datetime', label: 'Updated', system: true },
    updated_by: { type: 'lookup', label: 'Updated By', system: true },
  },
};

/** One child row exactly as `dataSource.find` returns it. */
const serverRow = (id: string, actual: number) => ({
  id,
  sheet: 'SHEET1',
  plan_indicator: 'IND1',
  actual_value: actual,
  remark: null,
  owner_id: null,
  owning_business_unit_id: 'bu1',
  organization_id: 'org1',
  created_at: '2026-01-01T00:00:00Z',
  created_by: 'u1',
  updated_at: '2026-01-02T00:00:00Z',
  updated_by: 'u1',
});

/** Every ownership / audit column the card names, plus record identity. */
const REFUSED = [
  'owner_id',
  'owning_business_unit_id',
  'organization_id',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'id',
] as const;

describe('form write payloads — server-owned columns (objectui#10108)', () => {
  it('sanitizeFormData refuses the whole ownership/audit family, and keeps the business columns', () => {
    const out = sanitizeFormData(serverRow('r1', 1000), CHILD_SCHEMA);

    for (const key of REFUSED) expect(out).not.toHaveProperty(key);
    // The control: the same call in the same fixture still carries every
    // author-declared column, so the absences above are a filter doing its job
    // rather than an empty payload.
    expect(out).toEqual({
      sheet: 'SHEET1',
      plan_indicator: 'IND1',
      actual_value: 1000,
      remark: null,
    });
  });

  it('refuses an injected column by its spec `system` flag even when the name roster has never heard of it', () => {
    // The half a name list cannot cover: the NEXT column the platform injects.
    const schema = {
      name: 'kpi_entry_line',
      fields: {
        actual_value: { type: 'number', label: 'Actual' },
        // Not in any roster in this repository — only the flag marks it.
        regional_ledger_key: { type: 'text', label: 'Ledger', system: true },
      },
    };
    const out = sanitizeFormData({ actual_value: 5, regional_ledger_key: 'RL-1' }, schema);
    expect(out).toEqual({ actual_value: 5 });
  });

  describe('master-detail /batch save', () => {
    const buildEdit = () => {
      const original = [serverRow('a', 1000), serverRow('b', 1100), serverRow('c', 1200)];
      const rows = original.map((r) => ({ ...r }));
      rows[0].actual_value = 900; // one cell, nothing else touched
      return buildMasterDetailEditBatch(
        'kpi_entry_sheet',
        'SHEET1',
        { subject: 'bu_sw_sales', status: 'draft', owner_id: 'ptc', created_by: 'u1' },
        [{ childObject: 'kpi_entry_line', relationshipField: 'sheet', rows, original, childSchema: CHILD_SCHEMA }],
      );
    };

    it('no operation in the batch carries a server-owned column — parent included', () => {
      const ops = buildEdit();
      for (const op of ops) {
        for (const key of REFUSED) expect(op.data ?? {}).not.toHaveProperty(key);
      }
      // Control: the parent operation is still there and still writes its
      // business columns, so the assertion above is not passing over an empty
      // batch.
      expect(ops[0]).toEqual({
        object: 'kpi_entry_sheet',
        action: 'update',
        id: 'SHEET1',
        data: { subject: 'bu_sw_sales', status: 'draft' },
      });
    });

    it('a child update carries only the cell the user changed, and an untouched row no operation at all', () => {
      const ops = buildEdit();
      const childOps = ops.filter((o) => o.object === 'kpi_entry_line');
      expect(childOps).toEqual([
        { object: 'kpi_entry_line', action: 'update', id: 'a', data: { actual_value: 900 } },
      ]);
    });

    it('a real edit is never dropped: every changed cell survives the dirty diff', () => {
      const original = [serverRow('a', 1000)];
      const rows = [{ ...original[0], actual_value: 42, remark: 'note', plan_indicator: 'IND2' }];
      const ops = buildMasterDetailEditBatch('kpi_entry_sheet', 'SHEET1', {}, [
        { childObject: 'kpi_entry_line', relationshipField: 'sheet', rows, original, childSchema: CHILD_SCHEMA },
      ]);
      const upd = ops.find((o) => o.object === 'kpi_entry_line');
      expect(upd!.data).toEqual({ actual_value: 42, remark: 'note', plan_indicator: 'IND2' });
    });

    it('a CREATE batch refuses the same family on parent and children', () => {
      const ops = buildMasterDetailBatch(
        'kpi_entry_sheet',
        { subject: 'bu_sw_sales', owner_id: 'ptc', organization_id: 'org1' },
        [{
          childObject: 'kpi_entry_line',
          relationshipField: 'sheet',
          rows: [{ ...serverRow('client-only', 7), id: undefined }],
          childSchema: CHILD_SCHEMA,
        }],
      );
      for (const op of ops) {
        for (const key of REFUSED) expect(op.data ?? {}).not.toHaveProperty(key);
      }
      expect(ops[0].data).toEqual({ subject: 'bu_sw_sales' });
      expect(ops[1].data).toMatchObject({ actual_value: 7, sheet: { $ref: 0 } });
    });
  });

  describe('plain record edit form PATCH', () => {
    it('sends no server-owned column, from a form that declares none of them', async () => {
      const record = serverRow('EW1', 92);
      const update = vi.fn(async (_o: string, _id: string, d: any) => ({ id: 'EW1', ...d }));
      const ds: any = {
        getObjectSchema: vi.fn().mockResolvedValue(CHILD_SCHEMA),
        findOne: vi.fn().mockResolvedValue(record),
        create: vi.fn(),
        update,
      };
      const { container } = render(
        <ObjectForm
          schema={{
            type: 'object-form',
            objectName: 'kpi_entry_line',
            mode: 'edit',
            recordId: 'EW1',
            // Business fields only — no ownership or audit column is declared
            // in any section, which is what makes an emitted one an INJECTION
            // rather than a displayed field being echoed.
            fields: ['plan_indicator', 'actual_value', 'remark'],
          } as any}
          dataSource={ds}
        />,
      );

      await waitFor(() => {
        const el = container.querySelector('input[name="actual_value"]') as HTMLInputElement | null;
        if (!el || el.value !== '92') throw new Error('record not on screen yet');
      });
      // Submitted with NOTHING changed, on purpose. An edit writes only the
      // fields that differ from the record it read (objectui#10156), so after a
      // real edit an unchanged `owner_id` is kept off the wire by the dirty diff
      // alone, and this row would stay green with the roster emptied. A save
      // with nothing changed sends the full sanitized payload — the one edit
      // route where the roster and the `system` flag are the only filter.
      fireEvent.submit(container.querySelector('form')!);

      await waitFor(() => expect(update).toHaveBeenCalled());
      const payload = update.mock.calls[0][2];
      for (const key of REFUSED) expect(payload).not.toHaveProperty(key);
      // Control: the business columns the record carries are still on the wire.
      expect(payload).toMatchObject({ plan_indicator: 'IND1', actual_value: 92, remark: null });
    });
  });
});
