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

type Pack = {
  objectActions: {
    deleteConfirm: string;
    deleteConfirmTitle: string;
    deleteConfirmButton: string;
    bulkDeleteConfirmTitle_other: string;
  };
  actionConfirm: { title: string; confirm: string; cancel: string };
};
const PACKS = {
  en: builtInLocales.en as unknown as Pack,
  zh: builtInLocales.zh as unknown as Pack,
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
    expect(within(dialog).getByText(pack.objectActions.deleteConfirm)).toBeInTheDocument();

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
