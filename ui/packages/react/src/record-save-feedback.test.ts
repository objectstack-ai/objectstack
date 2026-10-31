/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record save's one toast, at its own seam: the channel's park door and
 * the toast a surface raises. The full chain (adapter → write-warning channel
 * → claim) is pinned in `app-shell`'s `writeWarningToast.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { claimAnswerWarnings, parkAnswerWarnings, toastRecordSave } from './record-save-feedback';

const ev = (over: Record<string, unknown> = {}) => ({
  operation: 'update' as const,
  resource: 'quote',
  id: 'r1',
  warnings: [{ message: 'Discount above 30%' }, { message: 'Discount above 30%' }],
  ...over,
});

describe('parkAnswerWarnings', () => {
  it('parks on the open claim that names the write, and the claim hands back distinct lines', () => {
    const adapter = {};
    const claim = claimAnswerWarnings(adapter, { operation: 'update', resource: 'quote', id: 'r1' });
    const show = vi.fn();

    expect(parkAnswerWarnings(adapter, ev(), show)).toBe(true);
    expect(claim.take({ id: 'r1' })).toEqual(['Discount above 30%']);
    claim.release();
    expect(show).not.toHaveBeenCalled();
  });

  it('CONTROL: refuses when no claim names the write — another adapter, record or object', () => {
    const adapter = {};
    const claim = claimAnswerWarnings(adapter, { operation: 'update', resource: 'quote', id: 'r1' });

    expect(parkAnswerWarnings({}, ev(), vi.fn())).toBe(false);
    expect(parkAnswerWarnings(adapter, ev({ id: 'r2' }), vi.fn())).toBe(false);
    expect(parkAnswerWarnings(adapter, ev({ resource: 'order' }), vi.fn())).toBe(false);
    claim.release();
    expect(parkAnswerWarnings(adapter, ev(), vi.fn())).toBe(false);
  });
});

describe('toastRecordSave', () => {
  it('the success variant without warnings, the warning variant carrying them one per line', () => {
    const sink = { success: vi.fn(), warning: vi.fn() };
    toastRecordSave(sink, 'Quote "Q-1" updated');
    toastRecordSave(sink, 'Quote "Q-1" updated', ['a', 'b']);

    expect(sink.success).toHaveBeenCalledWith('Quote "Q-1" updated');
    expect(sink.warning).toHaveBeenCalledWith('Quote "Q-1" updated', { description: 'a\nb' });
    expect(sink.success).toHaveBeenCalledTimes(1);
  });
});
