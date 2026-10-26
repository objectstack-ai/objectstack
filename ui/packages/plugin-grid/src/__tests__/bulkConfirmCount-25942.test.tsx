/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25942 step 1 — a bulk action's `confirmText` is a `template`
 * slot, and its `{{ count }}` hole is filled with the number of records the run
 * covers, through the shared template engine (whitelisted formatters, no
 * logic). A sentence with no hole is shown as written, and the default
 * sentence is untouched.
 *
 * Two halves:
 *   - the helper `bulkConfirmText`: the count root, a formatter, the two slot
 *     shapes, a sentence without holes, blank and absent values, a source the
 *     engine refuses;
 *   - the real `BulkActionDialog`: the confirm sentence shows the count of the
 *     rows it was handed, for a string and an envelope alike.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { BulkActionDef } from '@object-ui/types';
import { BULK_CONFIRM_COUNT_ROOT } from '@objectstack/spec/ui';

import { BulkActionDialog } from '../components/BulkActionDialog';
import { bulkConfirmText } from '../components/bulkConfirmText';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

describe('bulkConfirmText fills {{ count }} (objectstack#25942)', () => {
  it('binds the root the protocol names for the count', () => {
    expect(BULK_CONFIRM_COUNT_ROOT).toBe('count');
    expect(bulkConfirmText('Archive {{count}} account(s)?', { count: 3 })).toBe('Archive 3 account(s)?');
  });

  it('fills the hole in a bare string and in an envelope alike', () => {
    expect(bulkConfirmText('Close {{ count }} deal(s)?', { count: 7 })).toBe('Close 7 deal(s)?');
    expect(
      bulkConfirmText({ dialect: 'template', source: 'Close {{ count }} deal(s)?' }, { count: 7 }),
    ).toBe('Close 7 deal(s)?');
  });

  it("applies the engine's whitelisted formatters", () => {
    expect(bulkConfirmText('Update {{ count | number }} records?', { count: 1234 })).toBe('Update 1,234 records?');
  });

  it('shows a sentence without holes as written, a `${}` token included', () => {
    expect(bulkConfirmText('Archive these accounts?', { count: 2 })).toBe('Archive these accounts?');
    expect(bulkConfirmText('Pay ${count} now?', { count: 2 })).toBe('Pay ${count} now?');
  });

  it('returns undefined for a blank or absent slot, so the default sentence shows', () => {
    expect(bulkConfirmText('  ', { count: 2 })).toBeUndefined();
    expect(bulkConfirmText({ dialect: 'template' }, { count: 2 })).toBeUndefined();
    expect(bulkConfirmText(undefined, { count: 2 })).toBeUndefined();
    expect(bulkConfirmText(null, { count: 2 })).toBeUndefined();
  });

  it('returns a source the engine refuses as written', () => {
    expect(bulkConfirmText('Archive {{ count }} of {{ count', { count: 2 })).toBe('Archive {{ count }} of {{ count');
    expect(bulkConfirmText('Archive {{ count + 1 }}?', { count: 2 })).toBe('Archive {{ count + 1 }}?');
  });
});

const ROWS = [
  { id: 'r1', name: 'Acme' },
  { id: 'r2', name: 'Globex' },
  { id: 'r3', name: 'Initech' },
];

function openConfirm(confirmText: BulkActionDef['confirmText'], rows = ROWS) {
  cleanup();
  const def: BulkActionDef = {
    name: 'archive',
    label: 'Archive',
    operation: 'update',
    patch: { archived: true },
    ...(confirmText !== undefined && { confirmText }),
  };
  render(
    <BulkActionDialog
      def={def}
      rows={rows}
      resource="account"
      dataSource={{ update: vi.fn(async () => ({})), delete: vi.fn(async () => ({})) } as any}
      open
      onClose={() => {}}
    />,
  );
}

describe('BulkActionDialog fills {{ count }} in its confirm sentence (objectstack#25942)', () => {
  it('shows the count of the rows the run covers', async () => {
    openConfirm('Archive {{ count }} account(s)?');
    expect(await screen.findByText('Archive 3 account(s)?')).toBeInTheDocument();
    expect(screen.queryByText(/\{\{/)).toBeNull();
  });

  it('counts the rows it was handed, not a fixed number', async () => {
    openConfirm({ dialect: 'template', source: 'Archive {{ count }} account(s)?' }, ROWS.slice(0, 1));
    expect(await screen.findByText('Archive 1 account(s)?')).toBeInTheDocument();
  });

  it('keeps the default sentence when no confirmText is authored', async () => {
    openConfirm(undefined);
    expect(await screen.findByText(/This will apply to 3 record/)).toBeInTheDocument();
  });
});
