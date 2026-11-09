/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11695 — the console list's Delete names the record it deletes and
 * confirms with a destructive Delete, in `en` and in `zh`.
 *
 * The console's object list deletes through `useObjectActions`: a row's Delete
 * calls `deleteRecord`, a selection's calls `deleteRecords`, and both ask
 * through the console runtime's confirm handler, which opens the in-app
 * `ActionConfirmDialog`. That dialog used to read "Confirm Action" / "Continue"
 * with the plain question, in the primary button style, for every delete.
 *
 * ## What makes these pins discriminating
 *
 * - The chain is REAL from the hook to the pixels: `useObjectActions`, the
 *   shared `recordDelete` core, `ActionConfirmDialog` and the shipped packs
 *   under a real `I18nProvider`. The one stand-in is the confirm handler, and
 *   it is the console runtime's own body (`useConsoleActionRuntime`'s
 *   `confirmHandler`: open the dialog with the message and options, settle on
 *   the answer), mounted without the rest of that runtime.
 * - The record carries TWO name-ish values: its declared `nameField`
 *   (`product_name`) and a `name`. The title must show the declared one, so a
 *   host that stopped handing `objectDef` through would read `SKU-1` and fail.
 * - Strings are read from the packs by KEY and interpolated here, so the pin is
 *   that the dialog shows THESE keys with THIS record and label, not what the
 *   keys happen to say today. The named subject is asserted on its own too.
 * - The destructive style is read off the confirm button's class, with a
 *   CONTROL: a confirmation that does not ask for it keeps the primary style,
 *   so the class check is shown able to fail.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import type { ConfirmationHandler } from '@object-ui/core';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { useObjectActions } from '../useObjectActions';
import { ActionConfirmDialog, type ConfirmDialogState } from '../../views/ActionConfirmDialog';
import { toast } from 'sonner';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

type Pack = {
  actions: { undo: string };
  recycleBin: { refusal: Record<string, string> };
  objectActions: {
    deleteConfirm: string;
    deleteConfirmQuestion: string;
    deletedNamed: string;
    restoredNamed: string;
    restoreFailed: string;
    deleteConfirmTitle: string;
    deleteConfirmButton: string;
    bulkDeleteConfirmTitle_other: string;
  };
  actionConfirm: { title: string; confirm: string; cancel: string };
};
const PACKS = {
  en: builtInLocales.en as unknown as Pack,
  zh: builtInLocales['zh-Hans'] as unknown as Pack,
};

const fill = (template: string, vars: Record<string, string | number>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(vars[k]));

const PRODUCT = {
  name: 'crm_product',
  label: 'Product',
  nameField: 'product_name',
  fields: { product_name: { type: 'text' }, name: { type: 'text' } },
};
const ROW = { id: 'p1', product_name: 'QA Widget 0', name: 'SKU-1' };
const BATCH = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

function ListDeleteHarness({ dataSource }: { dataSource: { delete: ReturnType<typeof vi.fn> } }) {
  const [state, setState] = React.useState<ConfirmDialogState>({ open: false, message: '' });
  // `useConsoleActionRuntime`'s confirm handler, verbatim in shape.
  const onConfirm = React.useCallback<ConfirmationHandler>(
    (message, options) =>
      new Promise<boolean>((resolve) => {
        setState({ open: true, message, options, resolve });
      }),
    [],
  );
  const actions = useObjectActions({
    objectName: PRODUCT.name,
    objectLabel: PRODUCT.label,
    objectDef: PRODUCT,
    dataSource,
    onConfirm,
  });
  return (
    <>
      <button onClick={() => void actions.deleteRecord(ROW.id, ROW)}>row-delete</button>
      <button onClick={() => void actions.deleteRecords(BATCH)}>bulk-delete</button>
      <button onClick={() => void onConfirm('Proceed?')}>plain-confirm</button>
      <ActionConfirmDialog
        state={state}
        onOpenChange={(open) => {
          if (!open) setState((s) => ({ ...s, open: false }));
        }}
      />
    </>
  );
}

function mount(language: keyof typeof PACKS) {
  const dataSource = { delete: vi.fn(async () => ({})), findOne: vi.fn() };
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter initialEntries={['/apps/crm/crm_product']}>
        <ListDeleteHarness dataSource={dataSource} />
      </MemoryRouter>
    </I18nProvider>,
  );
  return dataSource;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe.each(['en', 'zh'] as const)('console list Delete in %s (objectui#11695)', (language) => {
  const pack = PACKS[language];

  it('a row names the record by its declared name field and the object label, with a destructive Delete', async () => {
    const dataSource = mount(language);
    fireEvent.click(screen.getByText('row-delete'));

    const dialog = await screen.findByRole('alertdialog');
    const title = fill(pack.objectActions.deleteConfirmTitle, { label: 'Product', name: 'QA Widget 0' });
    await waitFor(() => expect(within(dialog).getByRole('heading')).toHaveTextContent(title));
    // The named subject itself, independent of the template's words.
    expect(within(dialog).getByRole('heading')).toHaveTextContent('QA Widget 0');
    expect(within(dialog).getByRole('heading')).not.toHaveTextContent(pack.actionConfirm.title);
    // A business object's delete goes to the recycle bin (objectstack#30239):
    // the question alone, never "cannot be undone".
    expect(within(dialog).getByText(pack.objectActions.deleteConfirmQuestion)).toBeInTheDocument();
    expect(within(dialog).queryByText(pack.objectActions.deleteConfirm)).toBeNull();

    const confirm = within(dialog).getByRole('button', { name: pack.objectActions.deleteConfirmButton });
    expect(confirm.className).toContain('bg-destructive');
    expect(within(dialog).queryByRole('button', { name: pack.actionConfirm.confirm })).toBeNull();
    expect(dataSource.delete).not.toHaveBeenCalled();

    fireEvent.click(confirm);
    await waitFor(() => expect(dataSource.delete).toHaveBeenCalledWith('crm_product', 'p1'));
  });

  it('a selection counts the batch in the title, with the same destructive Delete', async () => {
    const dataSource = mount(language);
    fireEvent.click(screen.getByText('bulk-delete'));

    const dialog = await screen.findByRole('alertdialog');
    const title = fill(pack.objectActions.bulkDeleteConfirmTitle_other, { count: 3, label: 'Product' });
    await waitFor(() => expect(within(dialog).getByRole('heading')).toHaveTextContent(title));
    const confirm = within(dialog).getByRole('button', { name: pack.objectActions.deleteConfirmButton });
    expect(confirm.className).toContain('bg-destructive');

    fireEvent.click(confirm);
    await waitFor(() => expect(dataSource.delete).toHaveBeenCalledTimes(3));
  });

  it('control: a confirmation that does not ask for `destructive` keeps the primary confirm', async () => {
    mount(language);
    fireEvent.click(screen.getByText('plain-confirm'));

    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: pack.actionConfirm.confirm })).toBeInTheDocument(),
    );
    const confirm = within(dialog).getByRole('button', { name: pack.actionConfirm.confirm });
    expect(confirm.className).toContain('bg-primary');
    expect(confirm.className).not.toContain('bg-destructive');
  });
});

/**
 * objectstack#30239 (ADR-0148) — the list's one-record Delete offers Undo on
 * its toast when the delete wrote a recycle-bin entry and the caller holds
 * `allowRestoreOwnDeleted` on the object (the effective map, served by
 * `/auth/me/permissions`). Real chain: `useObjectActions`, the core, the
 * shipped packs, a real `MePermissionsProvider`; sonner is the one stand-in.
 */

function grants(objects: Record<string, Record<string, boolean>>): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: null,
    positions: [],
    permissionSets: [],
    objects,
    fields: {},
    hasAnyQueue: false,
  } as MePermissionsResponse;
}

function mountBin(
  language: keyof typeof PACKS,
  permissions: MePermissionsResponse,
  opts: { entryId?: string; restoreError?: unknown } = {},
) {
  const dataSource = {
    delete: vi.fn(async (_r: string, _id: string, o?: { onRecycleBinEntry?: (id: string) => void }) => {
      if (opts.entryId) o?.onRecycleBinEntry?.(opts.entryId);
      return true;
    }),
    create: vi.fn(),
    findOne: vi.fn(),
    restoreRecycleBinEntry: vi.fn(async () => {
      if (opts.restoreError) throw opts.restoreError;
      return { entryId: opts.entryId };
    }),
  };
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <MePermissionsProvider initialPermissions={permissions}>
        <MemoryRouter initialEntries={['/apps/crm/crm_product']}>
          <ListDeleteHarness dataSource={dataSource as any} />
        </MemoryRouter>
      </MePermissionsProvider>
    </I18nProvider>,
  );
  return dataSource;
}

async function confirmRowDelete(pack: Pack) {
  fireEvent.click(screen.getByText('row-delete'));
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: pack.objectActions.deleteConfirmButton }));
}

const MAY_RESTORE = grants({ crm_product: { allowRead: true, allowDelete: true, allowRestoreOwnDeleted: true } });
const MAY_NOT_RESTORE = grants({ crm_product: { allowRead: true, allowDelete: true } });

describe.each(['en', 'zh'] as const)('console list Delete undo in %s (objectstack#30239)', (language) => {
  const pack = PACKS[language];
  const deleted = fill(pack.objectActions.deletedNamed, { label: 'Product', name: 'QA Widget 0' });

  it('round trip: Undo restores the entry the delete wrote, never re-creates, and names the record', async () => {
    const dataSource = mountBin(language, MAY_RESTORE, { entryId: 'rb1' });
    await confirmRowDelete(pack);
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    const [message, data] = (toast.success as any).mock.calls[0];
    expect(message).toBe(deleted);
    expect(data.action.label).toBe(pack.actions.undo);

    data.action.onClick();
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2));
    expect(dataSource.restoreRecycleBinEntry).toHaveBeenCalledWith('crm_product', 'rb1');
    expect(dataSource.create).not.toHaveBeenCalled();
    expect((toast.success as any).mock.calls[1]).toEqual([
      fill(pack.objectActions.restoredNamed, { label: 'Product', name: 'QA Widget 0' }),
    ]);
  });

  it('a refused undo reads the refusal sentence in the session language', async () => {
    const refusal = Object.assign(new Error('raw server text'), {
      code: 'RESTORE_UNIQUE_VALUE_TAKEN',
      details: { object: 'crm_product', recordId: 'p1', field: 'product_name' },
    });
    mountBin(language, MAY_RESTORE, { entryId: 'rb1', restoreError: refusal });
    await confirmRowDelete(pack);
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    (toast.success as any).mock.calls[0][1].action.onClick();
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(fill(pack.objectActions.restoreFailed, { label: 'Product' }), {
      description: fill(pack.recycleBin.refusal.uniqueValueTaken, { field: 'product_name' }),
    });
  });

  it('control: without allowRestoreOwnDeleted the toast is today\'s, and no entry id is asked for', async () => {
    const dataSource = mountBin(language, MAY_NOT_RESTORE, { entryId: 'rb1' });
    await confirmRowDelete(pack);
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect((toast.success as any).mock.calls[0]).toEqual([deleted]);
    expect(dataSource.delete.mock.calls).toEqual([['crm_product', 'p1']]);
  });

  it('control: an answer with no recycle-bin entry keeps today\'s toast', async () => {
    mountBin(language, MAY_RESTORE, {});
    await confirmRowDelete(pack);
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect((toast.success as any).mock.calls[0]).toEqual([deleted]);
  });
});
