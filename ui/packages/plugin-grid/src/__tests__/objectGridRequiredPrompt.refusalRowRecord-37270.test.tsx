/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#37270 — the list cell's fill-in dialog: the row a refusal names
 * carries the record the change would leave (the row with the cell's value
 * merged in, the merge the collector judges its rows on), so an option
 * `visibleWhen` on that row reads the change, as the collected rows' do.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type React from 'react';
import { useCellRequiredPrompt } from '../objectGridRequiredPrompt';

const FIELDS = {
  name: { type: 'text', label: 'Name' },
  stage: { type: 'select', label: 'Stage', options: [{ value: 'new', label: 'New' }, { value: 'won', label: 'Won' }] },
  win_reason: { type: 'text', label: 'Win Reason', requiredWhen: 'record.stage == "won"' },
  // No `requiredWhen`: only a refusal names it.
  channel: {
    type: 'radio',
    label: 'Channel',
    options: [{ value: 'won_option', label: 'Won option', visibleWhen: 'record.stage == "won"' }],
  },
};
const ROW = { id: 'd1', name: 'Acme deal', stage: 'new', win_reason: null, channel: null };

describe('#37270 the list cell dialog hands a refusal-named row the changed record', () => {
  it('the refusal row carries the row with the cell value merged in', () => {
    const { result } = renderHook(() => useCellRequiredPrompt({
      objectName: undefined,
      objectSchema: { name: 'deal', fields: FIELDS },
      objectFields: FIELDS,
      perms: undefined as never,
      labelOf: (f) => f,
      translateOptions: (_o, _f, options) => options,
      optionLabel: (_f, _c, fallback) => fallback,
      emptyText: '—',
      save: vi.fn(async () => {}),
    }));
    act(() => { void result.current.ask(ROW, 'stage', 'won', () => null); });
    const dialog = result.current.renderDialog() as React.ReactElement<{
      refusalField: (name: string) => { name: string; record?: Record<string, unknown> } | null;
    }>;
    expect(dialog).not.toBeNull();
    const row = dialog.props.refusalField('channel');
    expect(row?.name).toBe('channel');
    expect(row?.record).toEqual({ ...ROW, stage: 'won' });
  });
});
