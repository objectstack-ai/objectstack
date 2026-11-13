/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#33009 — a flow behind a record action whose write step dropped a
 * read-only field warns the person who clicked, naming the field by its label.
 *
 * The #32666 shape: 「提交审批」 starts a flow whose `update_record` step
 * writes `status`, which is `readonly: true`. The data engine drops the value,
 * the step and the run succeed, and since objectstack#32861 the run's answer
 * says so (`droppedFields`). Before this card the console read none of it.
 *
 * The list / page runtime is one of the two launch hosts (the record page is
 * pinned in `RecordDetailView.flowDroppedFields-33009`). Driven end to end:
 * the real `ConsoleActionRuntimeProvider` (real `ActionProvider` /
 * `ActionRunner`), the real flow handler, launch module, reader and
 * `writeWarningToast`, and the real `FlowRunner` it mounts, under the real en
 * pack. Only the network (`authFetch`), the router, the toast library and the
 * data source's `getObjectSchema` (the label source) are stubbed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const authFetchSpy = vi.fn();
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'User', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => authFetchSpy,
}));

vi.mock('sonner', () => {
  const fn: any = vi.fn();
  fn.error = vi.fn();
  fn.success = vi.fn();
  fn.info = vi.fn();
  fn.warning = vi.fn();
  return { toast: fn };
});

import { toast } from 'sonner';
import { ConsoleActionRuntimeProvider } from '../useConsoleActionRuntime';
import { I18nProvider, useAction } from '@object-ui/react';

const OBJECT = 'expense_report';
const FLOW = 'expense_submit';
/** The declared action, as the object metadata carries it. */
const DECLARED = { name: 'submit_for_approval', label: '提交审批', type: 'flow', target: FLOW };
/** An inline page button naming no declared action: the trigger route. */
const INLINE = { name: 'inline_submit', label: 'Submit', type: 'flow', target: FLOW };
/** The object's schema as the adapter serves it: `status` is labelled. */
const SCHEMA = { name: OBJECT, fields: { status: { type: 'select', label: 'Approval status', readonly: true } } };

function answered(data: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) };
}
/** The #32666 run: completed, its `update_record` step's `status` dropped as read-only. */
const DROPPED = answered({
  success: true,
  status: 'completed',
  flowLabel: 'Submit',
  droppedFields: [{ object: OBJECT, fields: ['status'], reason: 'readonly' }],
});
/** A clean run: the same flow, nothing dropped (the member is omitted, as the server omits it). */
const CLEAN = answered({ success: true, status: 'completed', flowLabel: 'Submit' });
const PAUSED = answered({
  success: true,
  status: 'paused',
  runId: 'run-1',
  flowLabel: 'Submit',
  screen: { nodeId: 'note', title: 'Approval note', fields: [] },
});

const TITLE = 'Saved — but some fields did not take effect';
const READONLY_LINE = 'Read-only, so it did not take effect: Approval status';

const getObjectSchema = vi.fn(async (name: string) => (name === OBJECT ? SCHEMA : undefined));
const warnings = () => (toast as any).warning.mock.calls as unknown[][];

beforeEach(() => {
  authFetchSpy.mockReset();
  getObjectSchema.mockClear();
  for (const k of ['error', 'success', 'info', 'warning']) (toast as any)[k].mockClear();
});

/** Mount the runtime, click `action` once through the real runner, and wait for its result. */
async function click(action: Record<string, unknown>) {
  const objects = [{ name: OBJECT, label: 'Expense report', fields: SCHEMA.fields, actions: [DECLARED] }];
  let result: any;
  function Probe() {
    const { execute } = useAction();
    return (
      <button onClick={() => {
        void execute({ ...action, params: { _rowRecord: { id: 'exp-7' } } } as any).then((r) => { result = r; });
      }}>
        run-flow
      </button>
    );
  }
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <ConsoleActionRuntimeProvider dataSource={{ getObjectSchema }} objects={objects} objectName={OBJECT}>
        <Probe />
      </ConsoleActionRuntimeProvider>
    </I18nProvider>,
  );
  fireEvent.click(screen.getByText('run-flow'));
  await waitFor(() => expect(result).toBeDefined());
  return result;
}

describe('objectstack#33009 — a flow launch warns about the read-only fields its write steps dropped', () => {
  it('the #32666 shape: a record action whose flow dropped readonly `status` warns, naming the label', async () => {
    authFetchSpy.mockResolvedValueOnce(DROPPED);

    const result = await click(DECLARED);

    expect(String(authFetchSpy.mock.calls[0][0])).toBe(`/api/v1/actions/${OBJECT}/submit_for_approval`);
    // The run still succeeded: the click's own outcome is unchanged.
    expect(result).toMatchObject({ success: true });
    await waitFor(() => expect(warnings()).toHaveLength(1));
    expect(warnings()[0]).toEqual([TITLE, { description: READONLY_LINE }]);
    expect(getObjectSchema).toHaveBeenCalledWith(OBJECT);
    expect((toast as any).error).not.toHaveBeenCalled();
  });

  it('a clean click warns about nothing', async () => {
    authFetchSpy.mockResolvedValueOnce(CLEAN);

    const result = await click(DECLARED);

    expect(result).toMatchObject({ success: true });
    // Let any stray async announcement land before reading the silence.
    await new Promise((r) => setTimeout(r, 0));
    expect(warnings()).toEqual([]);
  });

  it('the trigger route (an inline button naming no declared action) warns the same way', async () => {
    authFetchSpy.mockResolvedValueOnce(DROPPED);

    await click(INLINE);

    expect(String(authFetchSpy.mock.calls[0][0])).toBe(`/api/v1/automation/${FLOW}/trigger`);
    await waitFor(() => expect(warnings()).toHaveLength(1));
    expect(warnings()[0]).toEqual([TITLE, { description: READONLY_LINE }]);
  });

  it('the resume path: a paused run whose write after the pause dropped `status` warns on Submit', async () => {
    authFetchSpy.mockResolvedValueOnce(PAUSED);
    const result = await click(DECLARED);
    expect(result).toEqual({ success: true, silent: true, handedOff: true });
    expect(warnings()).toEqual([]);

    const dialog = await screen.findByRole('dialog');
    authFetchSpy.mockResolvedValueOnce(DROPPED);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(authFetchSpy).toHaveBeenCalledTimes(2));
    expect(String(authFetchSpy.mock.calls[1][0])).toBe(`/api/v1/automation/${FLOW}/runs/run-1/resume`);

    await waitFor(() => expect(warnings()).toHaveLength(1));
    expect(warnings()[0]).toEqual([TITLE, { description: READONLY_LINE }]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('control: a resume answer without `droppedFields` closes exactly as before, with no warning', async () => {
    authFetchSpy.mockResolvedValueOnce(PAUSED);
    await click(DECLARED);

    const dialog = await screen.findByRole('dialog');
    authFetchSpy.mockResolvedValueOnce(CLEAN);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect((toast as any).success.mock.calls.map((c: unknown[]) => c[0])).toEqual(['Flow "Submit" completed']);
    expect(warnings()).toEqual([]);
  });
});
