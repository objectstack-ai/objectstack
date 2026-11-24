/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A field-backed lookup param reads `allowCreate` from the field it borrows
 * (objectstack#36865, half 1, the record-header path).
 *
 * The param `{ field, objectOverride }` already inherited the field's
 * `lookupFilters`, `lookupColumns`, `lookupPageSize` and `descriptionField`,
 * but not `allowCreate`, so a field declaring `allowCreate: false` still drew
 * "+ New" in an action's picker. These rows run the real chain the record
 * header's dialog runs — `resolveActionParam` → `paramToField` → `LookupField`
 * — on both faces of the picker (the desktop popover and the phone drawer).
 *
 * - `allowCreate: false` on the field: no create entry, popover and drawer;
 * - CONTROL, a field that allows create: the create entry shows on both.
 */
import { render, screen, fireEvent, waitFor, act, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LookupField, resolveActionParam } from '@object-ui/fields';
import { paramToField } from './paramToField';

const realInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
const realMatchMedia = window.matchMedia;

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  window.matchMedia = ((query: string) => ({
    matches: window.innerWidth < 768,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as any;
}

afterEach(() => {
  cleanup();
  if (realInnerWidth) Object.defineProperty(window, 'innerWidth', realInnerWidth);
  window.matchMedia = realMatchMedia;
});

/** The borrowed field, as the expense app declares it. */
const requestField = (allowCreate: boolean | undefined) => ({
  type: 'lookup',
  label: 'Travel Request',
  reference: 'crm_expense_request',
  displayField: 'name',
  lookupFilters: [{ field: 'status', operator: 'eq', value: 'approved' }],
  ...(allowCreate === undefined ? {} : { allowCreate }),
});

function widgetFieldFor(allowCreate: boolean | undefined) {
  const resolved = resolveActionParam(
    { field: 'crm_expense_request', objectOverride: 'crm_expense_report' } as any,
    {
      objectName: 'crm_expense',
      objects: [{ name: 'crm_expense_report', fields: { crm_expense_request: requestField(allowCreate) } }],
      fieldLabel: (_o: string, _f: string, fallback: string) => fallback,
    } as any,
  );
  return paramToField(resolved);
}

/** Open the picker on the given face and report whether it offers create. */
async function offersCreate(allowCreate: boolean | undefined, face: 'popover' | 'drawer'): Promise<boolean> {
  setViewportWidth(face === 'drawer' ? 390 : 1280);
  const field = widgetFieldFor(allowCreate);
  const ds = {
    find: vi.fn(async () => ({ data: [{ id: 'r1', name: 'Shanghai trip', status: 'approved' }], total: 1 })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  render(<LookupField field={field as any} value={undefined} onChange={vi.fn()} readonly={false} dataSource={ds as any} />);
  await act(async () => {
    fireEvent.click(screen.getByTestId(`lookup-trigger-${field.name}`));
  });
  const panel = await screen.findByTestId(face === 'drawer' ? 'lookup-drawer' : 'lookup-popover');
  await waitFor(() => expect(within(panel).getAllByRole('option')).toHaveLength(1));
  return within(panel).queryByTestId('lookup-create-new') !== null;
}

describe('a field-backed action param honours the borrowed field\'s allowCreate (objectstack#36865)', () => {
  it('the resolved widget field carries the field\'s allowCreate', () => {
    expect(widgetFieldFor(false).allowCreate).toBe(false);
    expect(widgetFieldFor(true).allowCreate).toBe(true);
  });

  it('allowCreate: false — no create entry in the desktop popover', async () => {
    expect(await offersCreate(false, 'popover')).toBe(false);
  });

  it('allowCreate: false — no create entry in the phone drawer', async () => {
    expect(await offersCreate(false, 'drawer')).toBe(false);
  });

  it('CONTROL — allowCreate: true shows the create entry in the popover', async () => {
    expect(await offersCreate(true, 'popover')).toBe(true);
  });

  it('CONTROL — allowCreate: true shows the create entry in the drawer', async () => {
    expect(await offersCreate(true, 'drawer')).toBe(true);
  });
});
