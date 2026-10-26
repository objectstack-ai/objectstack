/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `DetailView`'s header title ranks the object's DECLARED name pointer above
 * its `titleFormat` (objectui#9436, ruled C1).
 *
 * `resolveDisplayTitle` used to try the template FIRST ("kept first to
 * preserve existing header behavior"). On an object declaring both a
 * `nameField` and a `titleFormat`, this heading and the name
 * `getRecordDisplayName` resolves were then two different fields. Measured on
 * the tree before this change: an object with `nameField: 'contract_no'` and
 * a two-field `titleFormat` rendered the template's composite as its heading.
 *
 * The protocol's order is the other one. `@objectstack/spec`'s `titleFormat`
 * describe says "an explicit nameField now takes precedence", ADR-0079 D3
 * says the same, and `PageHeaderRenderer` moved in the same change.
 *
 * The first two cases are the pins. The rest are CONTROLS that hold under
 * either order, so a reverted rung reddens only the pins: the template still
 * titles an object that declares no pointer; a pointer that is blank on the
 * record falls through to the template; and the view-level `primaryField`
 * (rung 1, a `DetailViewSchema` key) still outranks the object's pointer.
 *
 * ⚠️ The fixture deliberately has no name-ish record key (no `name`, no
 * `*_name`). The record can paint before `getObjectSchema` answers, and that
 * first paint's heading comes from the schema-less record-key probe. With no
 * name-ish key, it is the `Record #<id>` floor, which equals no expected
 * heading below. A wait on the expected heading therefore cannot be satisfied
 * by the first paint.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/react';
import * as React from 'react';
import { DetailView } from '../DetailView';
import { __clearRecordEditableCache } from '../useRecordEditable';

const contractSchema = {
  name: 'contract',
  label: 'Contract',
  nameField: 'contract_no',
  titleFormat: '{contract_no} - {party}',
  fields: {
    contract_no: { type: 'text', label: 'Contract No' },
    party: { type: 'text', label: 'Party' },
    amount: { type: 'number', label: 'Amount' },
  },
};

/**
 * Render a `detail-view` over one record, let both data requests answer, and
 * return a reader for the heading.
 */
async function renderDetail(objectSchema: any, record: any, extra: Record<string, any> = {}) {
  const ds: any = {
    getObjectSchema: vi.fn(async () => objectSchema),
    findOne: vi.fn(async () => record),
  };
  const { container } = render(
    <DetailView
      schema={{
        type: 'detail-view',
        objectName: objectSchema.name,
        resourceId: record.id,
        fields: [{ name: 'amount', label: 'Amount' }],
        ...extra,
      } as any}
      dataSource={ds}
    />,
  );
  await waitFor(() => {
    expect(ds.getObjectSchema).toHaveBeenCalled();
    expect(ds.findOne).toHaveBeenCalled();
  });
  await act(async () => {
    await ds.getObjectSchema.mock.results[0].value;
    await ds.findOne.mock.results[0].value;
  });
  return () => container.querySelector('h1')?.textContent;
}

beforeEach(() => {
  __clearRecordEditableCache();
  // `useRecordEditable` probes `POST /api/v1/security/explain`; happy-dom
  // would resolve that to a REAL socket (objectui#6640).
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DetailView — the declared pointer outranks `titleFormat` in the header (#9436)', () => {
  it('the declared `nameField` outranks a composite `titleFormat`', async () => {
    const heading = await renderDetail(contractSchema, {
      id: 'C1', contract_no: 'HT-2026-001', party: 'Acme Corporation', amount: 42,
    });
    await waitFor(() => expect(heading()).toBe('HT-2026-001'));
  });

  it('the deprecated `displayNameField` alias outranks `titleFormat` too', async () => {
    const { nameField: _declaredPointer, ...rest } = contractSchema;
    const heading = await renderDetail({ ...rest, displayNameField: 'contract_no' }, {
      id: 'C2', contract_no: 'HT-2026-002', party: 'Acme Corporation', amount: 7,
    });
    await waitFor(() => expect(heading()).toBe('HT-2026-002'));
  });

  it('CONTROL — with no declared pointer the template still titles the record', async () => {
    const { nameField: _declaredPointer, ...templateOnly } = contractSchema;
    const heading = await renderDetail(templateOnly, {
      id: 'C3', contract_no: 'HT-2026-003', party: 'Acme Corporation', amount: 9,
    });
    await waitFor(() => expect(heading()).toBe('HT-2026-003 - Acme Corporation'));
  });

  it('CONTROL — a declared pointer that is BLANK on the record falls through to the template', async () => {
    const heading = await renderDetail(contractSchema, {
      id: 'C4', contract_no: '', party: 'Acme Corporation', amount: 5,
    });
    // The blank `contract_no` placeholder drops out with its separator.
    await waitFor(() => expect(heading()).toBe('Acme Corporation'));
  });

  it('CONTROL — the view-level `primaryField` still outranks the object pointer', async () => {
    const heading = await renderDetail(
      { ...contractSchema, fields: { ...contractSchema.fields, ref_no: { type: 'text', label: 'Ref No' } } },
      { id: 'C5', contract_no: 'HT-2026-005', party: 'Acme Corporation', ref_no: 'R-555', amount: 3 },
      { primaryField: 'ref_no' },
    );
    // Both requests have answered (see `renderDetail`), so this reads the
    // heading the loaded object schema produces, not the first paint.
    expect(heading()).toBe('R-555');
  });
});
