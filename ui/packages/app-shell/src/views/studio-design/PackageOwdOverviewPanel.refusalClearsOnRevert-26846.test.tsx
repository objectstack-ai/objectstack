// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26846 — a refused OWD save's banner answers the edits it was
 * sent. Reverting every row to its loaded value ("No changes") takes it away;
 * CONTROL: an edit that is still dirty keeps it.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { t } from '../metadata-admin/i18n';
import { PackageOwdOverviewPanel } from './PackageOwdOverviewPanel';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const REFUSAL = 'object/crm_memo: a controlled_by_parent object needs exactly one required master_detail field';
const CBP = t('engine.studio.settings.sharingControlledByParent', 'en-US');
const PRIVATE = t('engine.studio.settings.sharingPrivate', 'en-US');
const PUBLIC_READ = t('engine.studio.settings.sharingPublicRead', 'en-US');

function makeClient() {
  const body = { name: 'crm_memo', label: 'Memo', sharingModel: 'private', fields: {} };
  return {
    list: async (type: string) => (type === 'object' ? [{ name: 'crm_memo', label: 'Memo' }] : []),
    listDrafts: async () => [],
    layered: async () => ({ effective: body, code: null }),
    getDraft: async () => null,
    save: vi.fn(async () => {
      throw Object.assign(new Error(REFUSAL), { status: 422, code: 'VALIDATION_ERROR' });
    }),
  } as unknown as React.ComponentProps<typeof PackageOwdOverviewPanel>['client'];
}

async function pick(label: string) {
  fireEvent.keyDown(screen.getByTestId('owd-internal-crm_memo'), { key: 'ArrowDown' });
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: label }));
}

async function refuseOnce() {
  render(<PackageOwdOverviewPanel client={makeClient()} packageId="com.example.crm" locale="en-US" />);
  await screen.findByTestId('owd-row-crm_memo');
  await pick(CBP);
  fireEvent.click(screen.getByTestId('owd-save'));
  await screen.findByText(new RegExp(REFUSAL));
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('PackageOwdOverviewPanel — the refusal banner and the revert (objectstack#26846)', () => {
  it('reverting the refused edit to the loaded value clears the banner', async () => {
    await refuseOnce();
    await pick(PRIVATE);
    expect(screen.getByTestId('owd-save')).toHaveTextContent(t('engine.studio.owd.saveNone', 'en-US'));
    await waitFor(() => expect(screen.queryByText(new RegExp(REFUSAL))).toBeNull());
  });

  it('CONTROL: an edit that is still dirty keeps the banner', async () => {
    await refuseOnce();
    await pick(PUBLIC_READ);
    expect(screen.getByTestId('owd-dirty-crm_memo')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(REFUSAL))).toBeInTheDocument();
  });
});
