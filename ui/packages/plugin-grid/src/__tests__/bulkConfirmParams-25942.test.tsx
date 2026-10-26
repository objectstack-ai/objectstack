/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25942 step 2 — a bulk `confirmText` hole naming one of the def's
 * params is filled with that param's DISPLAY value, by the rule the protocol
 * states on the slot: the chosen option's label (a multi-value param's labels
 * joined with ', '), the picked record's display name for a lookup / user
 * param, and the entered value otherwise, so the engine's formatters apply.
 * `count` wins over a param of that name.
 *
 * Two halves:
 *   - the helper `bulkConfirmText` over a full scope;
 *   - the real `BulkActionDialog`: an option label, and a lookup name that
 *     arrives after the confirm step has opened.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { BulkActionDef, BulkActionParam } from '@object-ui/types';

import { BulkActionDialog } from '../components/BulkActionDialog';
import { bulkConfirmText } from '../components/bulkConfirmText';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const TIER: BulkActionParam = {
  name: 'tier',
  label: 'Tier',
  type: 'select',
  options: [
    { label: 'Gold', value: 'gold' },
    { label: 'Silver', value: 'silver' },
  ],
};
const TAGS: BulkActionParam = {
  name: 'tags',
  label: 'Tags',
  type: 'multiselect',
  options: [
    { label: 'Alpha', value: 'a' },
    { label: 'Beta', value: 'b' },
  ],
};
const OWNER: BulkActionParam = { name: 'owner', label: 'Owner', type: 'lookup', object: 'sys_user' };
const AMOUNT: BulkActionParam = { name: 'amount', label: 'Amount', type: 'number' };
const DUE: BulkActionParam = { name: 'due', label: 'Due', type: 'date' };
const NOTE: BulkActionParam = { name: 'note', label: 'Note', type: 'text' };

function fill(source: string, values: Record<string, unknown>, extra: { count?: number; params?: BulkActionParam[]; lookupLabels?: Record<string, Record<string, string>> } = {}) {
  return bulkConfirmText(source, {
    count: extra.count ?? 2,
    params: extra.params ?? [TIER, TAGS, OWNER, AMOUNT, DUE, NOTE],
    values,
    lookupLabels: extra.lookupLabels,
  });
}

describe('bulkConfirmText fills param holes with display values (objectstack#25942)', () => {
  it("shows the chosen option's label, not its value", () => {
    expect(fill('Move {{ count }} account(s) to {{ tier }}?', { tier: 'gold' })).toBe('Move 2 account(s) to Gold?');
  });

  it("joins a multi-value param's labels with ', '", () => {
    expect(fill('Tag them {{ tags }}?', { tags: ['a', 'b'] })).toBe('Tag them Alpha, Beta?');
  });

  it('shows a value no option declares as entered', () => {
    expect(fill('Move to {{ tier }}?', { tier: 'bronze' })).toBe('Move to bronze?');
  });

  it("shows a lookup's resolved record name, and the id until it is resolved", () => {
    expect(fill('Assign to {{ owner }}?', { owner: 'u1' }, { lookupLabels: { owner: { u1: 'Ada Lovelace' } } }))
      .toBe('Assign to Ada Lovelace?');
    expect(fill('Assign to {{ owner }}?', { owner: 'u1' })).toBe('Assign to u1?');
  });

  it('hands the entered value to the formatters', () => {
    expect(fill('Charge {{ amount | currency:EUR }} each?', { amount: 1234.5 })).toBe('Charge €1,234.50 each?');
    expect(fill('Charge {{ amount | number:2 }} each?', { amount: 3 })).toBe('Charge 3.00 each?');
    expect(fill('Due {{ due | date:iso }}?', { due: '2026-10-26' })).toBe('Due 2026-10-26?');
  });

  it('prints an empty param empty, so the default formatter can name it', () => {
    expect(fill('Note: {{ note }}.', {})).toBe('Note: .');
    expect(fill("Note: {{ note | default:'none' }}.", { note: '' })).toBe('Note: none.');
    expect(fill("Tags: {{ tags | default:'none' }}.", { tags: [] })).toBe('Tags: none.');
  });

  it('lets count win over a param named count', () => {
    const countParam: BulkActionParam = { name: 'count', label: 'Count', type: 'number' };
    expect(fill('Update {{ count }} record(s)?', { count: 99 }, { count: 3, params: [countParam] }))
      .toBe('Update 3 record(s)?');
  });

  it('prints a hole outside the closed scope empty', () => {
    expect(fill('Update {{ record.name }} to {{ tier }}?', { tier: 'silver' })).toBe('Update  to Silver?');
  });
});

const ROWS = [{ id: 'r1', name: 'Acme' }, { id: 'r2', name: 'Globex' }];

function openDialog(def: BulkActionDef, dataSource: Record<string, unknown> = {}) {
  cleanup();
  render(
    <BulkActionDialog
      def={def}
      rows={ROWS}
      resource="account"
      dataSource={{ update: vi.fn(async () => ({})), delete: vi.fn(async () => ({})), ...dataSource } as any}
      open
      onClose={() => {}}
    />,
  );
}

describe('BulkActionDialog fills param holes in its confirm sentence (objectstack#25942)', () => {
  it('shows the option label the params step chose', async () => {
    openDialog({
      name: 'set_tier',
      label: 'Set tier',
      operation: 'update',
      params: [{ ...TIER, default: 'silver' }],
      confirmText: { dialect: 'template', source: 'Move {{ count }} account(s) to {{ tier }}?' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Move 2 account(s) to Silver?')).toBeInTheDocument();
  });

  it('shows the lookup record name once it resolves after the step opens', async () => {
    let resolveName: (rec: Record<string, unknown>) => void = () => {};
    const findOne = vi.fn(() => new Promise<Record<string, unknown>>((r) => { resolveName = r; }));
    openDialog(
      {
        name: 'assign',
        label: 'Assign',
        operation: 'update',
        params: [{ ...OWNER, default: 'u1' }],
        confirmText: 'Assign {{ count }} account(s) to {{ owner }}?',
      },
      { findOne },
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Assign 2 account(s) to u1?')).toBeInTheDocument();
    expect(findOne).toHaveBeenCalledWith('sys_user', 'u1');
    resolveName({ id: 'u1', name: 'Ada Lovelace' });
    expect(await screen.findByText('Assign 2 account(s) to Ada Lovelace?')).toBeInTheDocument();
  });
});
