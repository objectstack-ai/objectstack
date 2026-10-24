// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12082 — the AI build panel's spreadsheet import reads the
 * `listImport` row of the affordance-to-grant map, asked of the object it
 * imports into.
 *
 * `ExcelImportBar` is the second mount of `ImportWizard`: the console list's
 * Import is the first, and it has read the `listImport` row since the map
 * landed. The bar read no grant at all, so a caller who may not create records
 * of the picked object could press Import, map the sheet and run it, and every
 * row was refused by the server. The bar now offers Import for the picked
 * object only when its row allows it — the caller's create grant and the
 * effective operation set — and picking another object asks again.
 *
 * Measured through the REAL `MePermissionsProvider`; the wizard is a probe that
 * records the object it was opened for.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, screen, within, act } from '@testing-library/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

const h = vi.hoisted(() => ({
  /** The objects the bar lists as import targets. */
  objects: [
    { name: 'crm_account', label: 'Account' },
    { name: 'crm_deal', label: 'Deal' },
  ],
  /** The props each mounted ImportWizard received. */
  wizard: [] as Array<Record<string, unknown>>,
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => async () =>
    new Response(JSON.stringify({ data: { items: h.objects } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
}));
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ImportWizard: (props: { objectName: string }) => {
    h.wizard.push({ objectName: props.objectName });
    return <div data-testid="import-wizard" />;
  },
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { ExcelImportBar } from '../ExcelImportBar';

const FILE = new File(['a,b\n1,2'], 'deals.xlsx');
/** What `t()` answers with no i18n provider: the key itself. */
const IMPORT = 'excelImport.importAction';

const SHAPES: Array<{ shape: string; bits: Record<string, boolean>; create: boolean }> = [
  { shape: 'create-only', bits: { allowCreate: true, allowRead: true, allowEdit: false, allowDelete: false }, create: true },
  { shape: 'edit-only', bits: { allowCreate: false, allowRead: true, allowEdit: true, allowDelete: false }, create: false },
  { shape: 'read-only', bits: { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false }, create: false },
  { shape: 'full', bits: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true }, create: true },
];
const FULL = SHAPES[3].bits;

const envelope = (objects: Record<string, Record<string, unknown>>): MePermissionsResponse => ({
  authenticated: true,
  userId: 'u-pin',
  tenantId: null,
  roles: ['member'],
  permissionSets: ['member'],
  objects: objects as never,
  fields: {},
});

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

function mount(perms: MePermissionsResponse | null) {
  const dataSource = {
    getObjectSchema: vi.fn(async (_name: string) => ({ fields: { title: { type: 'text', label: 'Title' } } })),
  };
  const bar = <ExcelImportBar file={FILE} dataSource={dataSource} onDone={vi.fn()} />;
  render(perms ? <MePermissionsProvider initialPermissions={perms}>{bar}</MePermissionsProvider> : bar);
  return { dataSource };
}

const importButton = () => screen.getByRole('button', { name: IMPORT });

/** Press Import; report whether the wizard opened, and for which object. */
async function pressImport(dataSource: { getObjectSchema: ReturnType<typeof vi.fn> }): Promise<string | null> {
  fireEvent.click(importButton());
  await settle();
  if (!screen.queryByTestId('import-wizard')) {
    expect(dataSource.getObjectSchema).not.toHaveBeenCalled();
    return null;
  }
  return String(h.wizard[h.wizard.length - 1].objectName);
}

beforeEach(() => {
  cleanup();
  h.wizard.length = 0;
});

describe.each(SHAPES)('the spreadsheet import bar under a $shape grant on its target (objectui#12082)', ({ bits, create }) => {
  it('Import is offered exactly when the create grant allows it', async () => {
    const { dataSource } = mount(envelope({ crm_account: bits, crm_deal: bits }));
    await settle();
    expect(importButton()).toHaveTextContent(IMPORT);
    expect(importButton().hasAttribute('disabled'), 'disabled').toBe(!create);
    expect(await pressImport(dataSource)).toBe(create ? 'crm_account' : null);
  });
});

describe("the spreadsheet import bar: the map's other layers and fail-open (objectui#12082)", () => {
  it('fail-open: with no permission provider Import is offered, as before', async () => {
    const { dataSource } = mount(null);
    await settle();
    expect(importButton()).not.toBeDisabled();
    expect(await pressImport(dataSource)).toBe('crm_account');
  });

  it('an effective operation set without import withholds Import under the full grant', async () => {
    const { dataSource } = mount(envelope({ crm_account: { ...FULL, apiOperations: ['get', 'list', 'create', 'update'] } }));
    await settle();
    expect(importButton()).toBeDisabled();
    expect(await pressImport(dataSource)).toBeNull();
  });

  it('the verdict is asked of the PICKED object: a closed target, then an open one', async () => {
    const { dataSource } = mount(envelope({ crm_account: SHAPES[2].bits, crm_deal: FULL }));
    await settle();
    expect(importButton()).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(within(listbox).getAllByRole('option').find((o) => o.textContent === 'Deal')!);
    await waitFor(() => expect(importButton()).not.toBeDisabled());
    expect(await pressImport(dataSource)).toBe('crm_deal');
  });
});
