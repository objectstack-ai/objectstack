/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12234 — a declared flow action launched through the action door
 * ends with ITS OWN `successMessage`, whether or not its run pauses.
 *
 * The list / page runtime is one of the two console launch hosts (the record
 * page is the other, pinned in `RecordDetailView.flowActionSuccessMessage-12234`).
 * Before the fix a run that paused on a screen held the action's message back
 * at the pause (`silent`, as ruled) and then completed on the runner's
 * flow-completed sentence, so the action's message was never shown.
 *
 * Driven end to end through the real runtime: `ConsoleActionRuntimeProvider`
 * (the real `ActionProvider` / `ActionRunner` and its toast sink), the real
 * flow handler and launch module, and the real `FlowRunner` it mounts, under
 * the real en pack. Only the network (`authFetch`), the router and the toast
 * library are stubbed. Every case asserts the FULL `toast.success` call list,
 * so the pause's silence and the single terminal toast are one reading.
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

const OBJECT = 'service_case';
const FLOW = 'case_escalate';
const ACTION_MESSAGE = 'Case escalated';
/** The declared action, as the object metadata carries it — the control declares no message. */
const DECLARED_WITHOUT_MESSAGE = { name: 'escalate_case', label: 'Escalate case', type: 'flow', target: FLOW };
const DECLARED = { ...DECLARED_WITHOUT_MESSAGE, successMessage: ACTION_MESSAGE };

function answered(data: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) };
}
const PAUSED = answered({
  success: true,
  status: 'paused',
  runId: 'run-1',
  flowLabel: 'Escalate',
  screen: { nodeId: 'reason', title: 'Escalation reason', fields: [] },
});
const COMPLETED = answered({ success: true, status: 'completed', flowLabel: 'Escalate' });

/**
 * The text of every success toast, in order. The runner's sink passes an
 * options bag beside the text and `FlowRunner` passes none, so the text alone
 * is compared — the full list, so a second toast cannot hide.
 */
const successTexts = () => (toast as any).success.mock.calls.map((call: unknown[]) => call[0]);

beforeEach(() => {
  authFetchSpy.mockReset();
  (toast as any).mockClear();
  (toast as any).error.mockClear();
  (toast as any).success.mockClear();
});

/** Mount the runtime with `declared` on the object, and click it once through the real runner. */
async function click(declared: Record<string, unknown>) {
  const objects = [{ name: OBJECT, label: 'Case', fields: {}, actions: [declared] }];
  let result: any;
  function Probe() {
    const { execute } = useAction();
    return (
      <button onClick={() => {
        void execute({ ...declared, params: { _rowRecord: { id: 'case-41' } } } as any).then((r) => { result = r; });
      }}>
        run-flow
      </button>
    );
  }
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <ConsoleActionRuntimeProvider dataSource={{}} objects={objects} objectName={OBJECT}>
        <Probe />
      </ConsoleActionRuntimeProvider>
    </I18nProvider>,
  );
  fireEvent.click(screen.getByText('run-flow'));
  await waitFor(() => expect(result).toBeDefined());
  expect(String(authFetchSpy.mock.calls[0][0])).toBe(`/api/v1/actions/${OBJECT}/escalate_case`);
  return result;
}

/** Submit the paused run's screen, answering the resume with `answer`. */
async function submitWith(answer: ReturnType<typeof answered>) {
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('heading', { name: 'Escalation reason' })).toBeTruthy();
  authFetchSpy.mockResolvedValueOnce(answer);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }));
  await waitFor(() => expect(authFetchSpy).toHaveBeenCalledTimes(2));
  expect(String(authFetchSpy.mock.calls[1][0])).toBe(`/api/v1/automation/${FLOW}/runs/run-1/resume`);
}

describe('objectui#12234 — a paused action-door launch completes with the action message', () => {
  it('stays silent at the pause, then toasts the action message once at completion', async () => {
    authFetchSpy.mockResolvedValueOnce(PAUSED);

    const result = await click(DECLARED);

    // The pause: silent, as ruled — no toast of either colour yet.
    expect(result).toEqual({ success: true, silent: true });
    expect((toast as any).success).not.toHaveBeenCalled();

    await submitWith(COMPLETED);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(successTexts()).toEqual([ACTION_MESSAGE]);
    expect((toast as any).error).not.toHaveBeenCalled();
  });

  it('a straight-through run toasts the same action message (the path that already worked)', async () => {
    authFetchSpy.mockResolvedValueOnce(COMPLETED);

    const result = await click(DECLARED);

    expect(result).toMatchObject({ success: true });
    expect(successTexts()).toEqual([ACTION_MESSAGE]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a run that ends refused after the pause shows its notice and no success toast', async () => {
    authFetchSpy.mockResolvedValueOnce(PAUSED);
    await click(DECLARED);

    await submitWith(answered({ success: true, status: 'refused', refusalMessage: 'Refused: already escalated' }));
    expect(await screen.findByText('Refused: already escalated')).toBeTruthy();
    expect((toast as any).success).not.toHaveBeenCalled();
    expect((toast as any).error).not.toHaveBeenCalled();
  });

  it('control: an action that declares no successMessage keeps the flow-completed toast', async () => {
    authFetchSpy.mockResolvedValueOnce(PAUSED);

    await click(DECLARED_WITHOUT_MESSAGE);
    await submitWith(COMPLETED);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(successTexts()).toEqual(['Flow "Escalate" completed']);
  });
});
