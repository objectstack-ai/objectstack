// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12248 — an attachment's delete asks first, through the console's
 * ordinary destructive-action confirm.
 *
 * Measured on a hosted console (HotCRM 4.0.1, 2026-10-12): the row's 删除附件
 * sent `DELETE /api/v1/data/sys_attachment/…` the moment it was pressed and the
 * server answered 200 — no question asked, nothing to undo. The record page's
 * own Delete asks through `ActionConfirmDialog` (objectui#11001); this panel now
 * mounts the same dialog the same way.
 *
 * ## What makes these pins discriminating
 *
 * - `ActionConfirmDialog` is the REAL component, not a double: the subject is
 *   the dialog a user sees, so the assertions read the rendered `alertdialog`
 *   and press its own buttons.
 * - "Nothing is deleted while the question is open" is red against the old
 *   panel, which called `dataSource.delete` in the click handler itself.
 * - Cancel is judged on the delete spy AND on the row still being listed, and
 *   the confirm case beside it, on the same mount, is what shows the click
 *   does reach the handler — "nothing happened" is also what a dead button
 *   looks like.
 * - The strings are read from the packs by KEY, never written out, in `en` and
 *   `zh`: the pin is which keys the dialog carries, not what they say today.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { RecordAttachmentsPanel } from '../RecordAttachmentsPanel';

type Pack = {
  detail: { deleteAttachment: string; deleteAttachmentConfirm: string };
  objectActions: { deleteConfirmButton: string };
  actionConfirm: { title: string; confirm: string; cancel: string };
};
/** The packs, read by key — see the header on why nothing is written out. */
const PACKS = {
  en: builtInLocales.en as unknown as Pack,
  zh: builtInLocales.zh as unknown as Pack,
};

const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => vars[k]);

const ROWS = [
  { id: 'a1', file_id: 'f1', file_name: 'contract.pdf', mime_type: 'application/pdf', size: 1024 },
  { id: 'a2', file_id: 'f2', file_name: 'invoice.pdf', mime_type: 'application/pdf', size: 2048 },
];

function makeDataSource() {
  return {
    find: vi.fn(async () => ROWS),
    create: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
}

async function mountPanel(language: 'en' | 'zh' = 'en') {
  const dataSource = makeDataSource();
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <RecordAttachmentsPanel objectName="crm_case" recordId="c1" dataSource={dataSource} currentUserId="me" />
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByText('invoice.pdf')).toBeInTheDocument());
  return dataSource;
}

/** The delete button on the row listing `fileName`. */
function deleteButtonOf(fileName: string, pack: Pack): HTMLElement {
  const li = screen.getByText(fileName).closest('li');
  if (!li) throw new Error(`no row for ${fileName}`);
  return within(li as HTMLElement).getByRole('button', { name: pack.detail.deleteAttachment });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('attachment delete asks through the console confirm dialog (objectui#12248)', () => {
  it.each(['en', 'zh'] as const)(
    '[%s] pressing delete opens the dialog naming the file, and nothing is deleted while it is open',
    async (language) => {
      const pack = PACKS[language];
      const dataSource = await mountPanel(language);

      fireEvent.click(deleteButtonOf('invoice.pdf', pack));

      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByRole('heading')).toHaveTextContent(pack.detail.deleteAttachment);
      expect(
        within(dialog).getByText(fill(pack.detail.deleteAttachmentConfirm, { name: 'invoice.pdf' })),
      ).toBeInTheDocument();
      // The destructive Delete, never the generic "Continue".
      const confirm = within(dialog).getByRole('button', { name: pack.objectActions.deleteConfirmButton });
      expect(confirm.className).toContain('bg-destructive');
      expect(within(dialog).queryByRole('button', { name: pack.actionConfirm.confirm })).toBeNull();
      expect(within(dialog).getByRole('button', { name: pack.actionConfirm.cancel })).toBeInTheDocument();

      expect(dataSource.delete).not.toHaveBeenCalled();
    },
  );

  it('cancel deletes nothing and keeps the row', async () => {
    const pack = PACKS.en;
    const dataSource = await mountPanel();

    fireEvent.click(deleteButtonOf('invoice.pdf', pack));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: pack.actionConfirm.cancel }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(dataSource.delete).not.toHaveBeenCalled();
    expect(screen.getByText('invoice.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('confirm deletes that attachment exactly once and drops its row', async () => {
    const pack = PACKS.en;
    const dataSource = await mountPanel();

    fireEvent.click(deleteButtonOf('invoice.pdf', pack));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: pack.objectActions.deleteConfirmButton }));

    await waitFor(() => expect(screen.queryByText('invoice.pdf')).toBeNull());
    expect(dataSource.delete).toHaveBeenCalledTimes(1);
    expect(dataSource.delete).toHaveBeenCalledWith('sys_attachment', 'a2');
    // The other row is untouched.
    expect(screen.getByText('contract.pdf')).toBeInTheDocument();
  });
});
