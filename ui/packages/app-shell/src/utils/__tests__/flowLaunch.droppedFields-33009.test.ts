/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#33009 — the one reader of a flow answer's `droppedFields`, below
 * its three hosts (pinned end to end in
 * `useConsoleActionRuntime.flowDroppedFields-33009` and
 * `RecordDetailView.flowDroppedFields-33009`).
 *
 * What only this level can say cheaply: the parse is data-objectstack's own
 * (its skew arm reaches the toast), a run that wrote two objects is labelled
 * per object, an off-spec entry with no `object` is named by api name, and a
 * failed launch carrying the member says nothing beyond its failure.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UNRECOGNIZED_DROP_REASON } from '@object-ui/data-objectstack';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

import { announceFlowDroppedFields, flowAnswerDroppedFields, launchConsoleFlow } from '../flowLaunch';

const SCHEMAS: Record<string, { fields: Record<string, { label: string }> }> = {
  expense_report: { fields: { status: { label: 'Approval status' } } },
  expense_line: { fields: { status: { label: 'Line status' }, amount: { label: 'Amount' } } },
};
const dataSource = { getObjectSchema: vi.fn(async (name: string) => SCHEMAS[name]) };
const t = ((key: string, opts?: { fields?: string; defaultValue?: string }) =>
  (opts?.defaultValue ?? key).replace('{{fields}}', opts?.fields ?? '')) as never;
const fieldLabel = (_object: string, _field: string, fallback: string) => fallback;
const ctx = { t, fieldLabel, dataSource };

function sink() {
  return { warning: vi.fn(), info: vi.fn() };
}
const answer = (droppedFields: unknown) => ({ success: true, data: { success: true, status: 'completed', droppedFields } });

beforeEach(() => {
  dataSource.getObjectSchema.mockClear();
  for (const fn of Object.values(toasts)) fn.mockClear();
});

describe('flowAnswerDroppedFields — the wire through data-objectstack’s own parser', () => {
  it('parses the member, keeps the skew arm for a reason the pin cannot name, and drops an entry naming no field', () => {
    expect(
      flowAnswerDroppedFields(answer([
        { object: 'expense_report', fields: ['status'], reason: 'readonly' },
        { object: 'expense_report', fields: ['status'], reason: 'from_the_future' },
        { object: 'expense_report', fields: [42] },
      ])),
    ).toEqual([
      { object: 'expense_report', fields: ['status'], reason: 'readonly' },
      { object: 'expense_report', fields: ['status'], reason: UNRECOGNIZED_DROP_REASON, unrecognizedReason: 'from_the_future' },
    ]);
  });

  it('control: an answer without the member (or no answer) reads as none', () => {
    expect(flowAnswerDroppedFields({ success: true, data: { success: true, status: 'completed' } })).toEqual([]);
    expect(flowAnswerDroppedFields(null)).toEqual([]);
  });
});

describe('announceFlowDroppedFields', () => {
  it('labels each object’s fields on that object: one warning per object', async () => {
    const s = sink();
    await announceFlowDroppedFields(answer([
      { object: 'expense_report', fields: ['status'], reason: 'readonly' },
      { object: 'expense_line', fields: ['status', 'amount'], reason: 'readonly' },
    ]), ctx, s);

    expect(s.warning.mock.calls.map((c) => c[1].description)).toEqual([
      'Read-only, so it did not take effect: Approval status',
      'Read-only, so it did not take effect: Line status, Amount',
    ]);
    expect(dataSource.getObjectSchema.mock.calls.map((c) => c[0])).toEqual(['expense_report', 'expense_line']);
  });

  it('a reason from the future is named without claiming a cause', async () => {
    const s = sink();
    await announceFlowDroppedFields(answer([{ object: 'expense_report', fields: ['status'], reason: 'from_the_future' }]), ctx, s);
    expect(s.warning.mock.calls[0][1].description).toBe('Not applied by the server: Approval status');
  });

  it('an off-spec entry with no `object` is named by api name, never by a guessed object', async () => {
    const s = sink();
    await announceFlowDroppedFields(answer([{ fields: ['status'], reason: 'readonly' }]), ctx, s);
    expect(s.warning.mock.calls[0][1].description).toBe('Read-only, so it did not take effect: status');
    expect(dataSource.getObjectSchema).not.toHaveBeenCalled();
  });

  it('a data source without getObjectSchema still warns, by api name', async () => {
    const s = sink();
    await announceFlowDroppedFields(answer([{ object: 'expense_report', fields: ['status'], reason: 'readonly' }]), { ...ctx, dataSource: {} }, s);
    expect(s.warning.mock.calls[0][1].description).toBe('Read-only, so it did not take effect: status');
  });

  it('control: no member, no warning', async () => {
    const s = sink();
    await announceFlowDroppedFields({ success: true, data: { success: true, status: 'completed' } }, ctx, s);
    expect(s.warning).not.toHaveBeenCalled();
    expect(s.info).not.toHaveBeenCalled();
  });
});

describe('launchConsoleFlow — a failed run says only that it failed', () => {
  it('a failed answer carrying the member gets its error and no "saved, but" warning', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        success: false,
        status: 'failed',
        error: 'boom',
        droppedFields: [{ object: 'expense_report', fields: ['status'], reason: 'readonly' }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const launch = await launchConsoleFlow({
      fetch,
      baseUrl: '',
      action: { name: 'expense_submit', type: 'flow', target: 'expense_submit' },
      objectName: 'expense_report',
      recordId: 'exp-7',
      triggerParams: {},
      objects: [],
      language: 'en',
      droppedFields: ctx,
    });
    expect(launch.judged.result.success).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(toasts.warning).not.toHaveBeenCalled();
  });
});
