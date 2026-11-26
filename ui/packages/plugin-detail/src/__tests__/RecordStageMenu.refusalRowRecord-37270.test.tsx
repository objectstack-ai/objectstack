/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#37270 — the stage menu's dialog: a row a refusal names reads the
 * record the move would leave, also when no collected row is shown. A move to
 * a stage that needs nothing opens the dialog with no fields; the server then
 * refuses it naming a radio whose options read `record.stage`. The row it adds
 * offers the options visible on the moved record, not the empty state.
 *
 * `@object-ui/*` resolves to source through the root vitest alias table.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { InlineEditProvider, RecordContextProvider } from '@object-ui/react';

const { permsStub } = vi.hoisted(() => ({
  permsStub: {
    isLoaded: true,
    checkField: () => true,
    check: () => ({ allowed: true }),
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    userId: null,
    systemPermissions: undefined,
    hasCapabilities: () => true,
    can: () => true,
    cannot: () => false,
  },
}));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub as any };
});

import { RecordStageMenu } from '../RecordStageMenu';

const OPPORTUNITY = {
  name: 'crm_opportunity',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: {
      type: 'select',
      label: 'Stage',
      options: [
        { value: 'prospecting', label: 'Prospecting' },
        { value: 'negotiation', label: 'Negotiation' },
        { value: 'closed_lost', label: 'Closed Lost' },
      ],
    },
    // No `requiredWhen`: the client cannot foresee it, only the server names it.
    channel: {
      type: 'radio',
      label: 'Channel',
      options: [
        { value: 'negotiation_option', label: 'Negotiation option', visibleWhen: 'record.stage == "negotiation"' },
        { value: 'lost_option', label: 'Lost option', visibleWhen: 'record.stage == "closed_lost"' },
      ],
    },
  },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 501, json: async () => ({}) })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('#37270 a refusal-named row in the stage dialog reads the moved record', () => {
  it('with no collected row shown, the added row offers the options visible on the record the move leaves', async () => {
    const refusal = Object.assign(new Error('VALIDATION_FAILED'), {
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'channel', code: 'required', message: 'Channel is required to negotiate' }],
    });
    const dataSource = { update: vi.fn(async () => { throw refusal; }) };
    render(
      <RecordContextProvider
        objectName="crm_opportunity"
        recordId="o1"
        data={{ id: 'o1', name: 'Wayne deal', stage: 'prospecting', channel: null, updated_at: 'v1' }}
        objectSchema={OPPORTUNITY}
        dataSource={dataSource as any}
        reread={vi.fn(async () => {})}
      >
        <InlineEditProvider canEdit>
          <RecordStageMenu field="stage" label="Prospecting" tag={<span>Prospecting</span>} />
        </InlineEditProvider>
      </RecordContextProvider>,
    );
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Stage: / }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const menu = screen.getByRole('menu');
    fireEvent.click(within(menu).getAllByRole('menuitem').find((el) => el.textContent?.startsWith('Negotiation'))!);
    let dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('[data-required-fields-field]')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    dialog = await screen.findByRole('dialog');
    const row = await waitFor(() => {
      const el = dialog.querySelector('[data-required-fields-field="channel"]') as HTMLElement | null;
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(row.querySelector('[data-testid="radio-empty-channel"]')).toBeNull();
    expect(within(row).getByText('Negotiation option')).toBeInTheDocument();
    // Judged on the moved record, not opened up.
    expect(within(row).queryByText('Lost option')).toBeNull();
  });
});
