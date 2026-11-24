/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9973 — a flow launched from a LIST action that ends `refused`
 * without ever pausing at a screen.
 *
 * Before the fix this route answered exactly like a completed run: the handler
 * returned terminal success, the ActionRunner toasted the action's
 * `successMessage`, the view refreshed, and the engine's refusal sentence never
 * reached the screen. The objectstack#14945 ruling says a refusal renders with
 * Close only and no completion toast.
 *
 * Driven end to end through the real runtime: `ConsoleActionRuntimeProvider`
 * (the real `ActionProvider` and `ActionRunner`, the real toast sink), the real
 * flow handler, the real `interpretFlowResponse` / `judgeFlowLaunch`, and the
 * real `FlowRefusalNotice`. Only the network (`authFetch`) and the toast
 * library are stubbed. The `completed` case is the lit control: it proves the
 * toast and refresh spies fire at all.
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
import { useAction } from '@object-ui/react';

const SENTENCE = 'Refused: Acme Corp is a confirmed duplicate';
const ACTION = {
  type: 'flow',
  name: 'check_dup',
  label: 'Check duplicate',
  target: 'check_dup',
  successMessage: 'Duplicate check passed',
};

beforeEach(() => {
  authFetchSpy.mockReset();
  (toast as any).mockClear();
  (toast as any).error.mockClear();
  (toast as any).success.mockClear();
});

/** Launch the flow action through the real runner; resolves to the handler's result. */
async function launch(data: Record<string, unknown>) {
  authFetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data }) });
  const refreshSpy = vi.fn();
  let result: any;
  function Probe() {
    const { execute } = useAction();
    return (
      <button onClick={() => { void execute({ ...ACTION } as any).then((r) => { result = r; }); }}>
        run-flow
      </button>
    );
  }
  render(
    <ConsoleActionRuntimeProvider dataSource={{}} objects={[]} objectName="lead" onRefresh={refreshSpy}>
      <Probe />
    </ConsoleActionRuntimeProvider>,
  );
  fireEvent.click(screen.getByText('run-flow'));
  await waitFor(() => expect(result).toBeDefined());
  expect(String(authFetchSpy.mock.calls[0][0])).toContain('/api/v1/automation/check_dup/trigger');
  return { result, refreshSpy };
}

describe('objectui#9973 — list-action flow launch that ends refused', () => {
  it('shows the refusal sentence in a notice titled with the action, with Close only', async () => {
    await launch({ success: true, status: 'refused', refusalMessage: SENTENCE });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Check duplicate')).toBeTruthy();
    // Plain notice, not an error: the sentence sits in a non-destructive alert.
    const alert = within(dialog).getByRole('alert');
    expect(alert.textContent).toContain(SENTENCE);
    expect(alert.className).not.toMatch(/destructive/);
    // Close only: every button the notice offers is a Close (the footer button
    // and the dialog's corner X) — no Submit, no Cancel, no OK.
    const names = within(dialog).getAllByRole('button').map((b) => b.textContent?.trim());
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n === 'Close')).toBe(true);
  });

  it("does NOT toast the action's successMessage, does not refresh, and returns silent success", async () => {
    const { result, refreshSpy } = await launch({ success: true, status: 'refused', refusalMessage: SENTENCE });

    // The refusal also rides on the result (objectstack#36915), for a caller
    // that counts outcomes; the notice above is still this launch's surface.
    expect(result).toEqual({ success: true, silent: true, handedOff: true, refusal: { message: SENTENCE } });
    expect((toast as any).success).not.toHaveBeenCalled();
    expect((toast as any).error).not.toHaveBeenCalled();
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('Close dismisses the notice and runs nothing else', async () => {
    const { refreshSpy } = await launch({ success: true, status: 'refused', refusalMessage: SENTENCE });

    const dialog = await screen.findByRole('dialog');
    const footerClose = within(dialog).getAllByRole('button').find((b) => !b.querySelector('.sr-only'));
    fireEvent.click(footerClose!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((toast as any).success).not.toHaveBeenCalled();
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('control: a COMPLETED run still toasts successMessage, refreshes, and opens no notice', async () => {
    const { result, refreshSpy } = await launch({ success: true, status: 'completed' });

    expect(result).toEqual({ success: true, data: { success: true, status: 'completed' }, reload: true });
    expect((toast as any).success).toHaveBeenCalledTimes(1);
    expect((toast as any).success.mock.calls[0][0]).toBe('Duplicate check passed');
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.textContent).not.toContain(SENTENCE);
  });
});

// objectui#11092 — the same harness, on a launch that PAUSES: the provider's
// flow handler hands the trigger answer's `flowLabel` to the `FlowRunner` it
// mounts, and the runner names the flow by it rather than by its API name.
describe('objectui#11092 — a paused list-action launch names the flow by its served label', () => {
  it('opens the runner headed by the served flowLabel', async () => {
    const { result } = await launch({
      success: true,
      status: 'paused',
      runId: 'run-1',
      flowLabel: 'Duplicate Screening',
      screen: { nodeId: 'confirm', title: 'Confirm', fields: [] },
    });

    expect(result).toEqual({ success: true, silent: true, handedOff: true });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Confirm' })).toBeTruthy();
    expect(within(dialog).getByText('Duplicate Screening')).toBeTruthy();
    expect(within(dialog).queryByText('check_dup')).toBeNull();
  });
});

// objectstack#36915 — the grid's per-record bulk fan-out dispatches each record
// with `reportsRefusal` (the runner's `callContext`) and lists every refused
// record in its own result. The same harness, on that dispatch: no notice
// opens, and the refusal comes back on the result for the caller to report.
describe('objectstack#36915 — a dispatch that reports refusals itself opens no notice', () => {
  /** Dispatch the flow action once per answer, the way the bulk fan-out does. */
  async function fanOut(answers: Array<Record<string, unknown>>, callContext?: Record<string, unknown>) {
    for (const data of answers) {
      authFetchSpy.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true, data }) });
    }
    const results: any[] = [];
    let done = false;
    function Probe() {
      const { runner } = useAction();
      const run = async () => {
        for (let i = 0; i < answers.length; i += 1) {
          results.push(await runner.execute({ ...ACTION, toast: { showOnSuccess: false, showOnError: false } } as any, callContext as any));
        }
        done = true;
      };
      return <button onClick={() => { void run(); }}>run-fan-out</button>;
    }
    render(
      <ConsoleActionRuntimeProvider dataSource={{}} objects={[]} objectName="lead" onRefresh={vi.fn()}>
        <Probe />
      </ConsoleActionRuntimeProvider>,
    );
    fireEvent.click(screen.getByText('run-fan-out'));
    await waitFor(() => expect(done).toBe(true));
    return results;
  }

  const REFUSED_A = 'Ann has opted out of email, so the lead was not added to the campaign.';
  const REFUSED_B = 'Bob has opted out of email, so the lead was not added to the campaign.';

  it("the card's repro: two refused records and one completed open no notice, and each refusal comes back with its own sentence", async () => {
    const results = await fanOut([
      { success: true, status: 'refused', refusalMessage: REFUSED_A },
      { success: true, status: 'completed' },
      { success: true, status: 'refused', refusalMessage: REFUSED_B },
    ], { reportsRefusal: true });

    expect(results.map((r) => r.refusal?.message)).toEqual([REFUSED_A, undefined, REFUSED_B]);
    expect(results[1].refusal).toBeUndefined();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.textContent).not.toContain(REFUSED_A);
    expect(document.body.textContent).not.toContain(REFUSED_B);
  });

  it('one refused record opens no notice either', async () => {
    const [result] = await fanOut([{ success: true, status: 'refused', refusalMessage: REFUSED_A }], { reportsRefusal: true });

    expect(result).toEqual({ success: true, silent: true, handedOff: true, refusal: { message: REFUSED_A } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('control: the same dispatch without the flag (the row menu) still opens the notice', async () => {
    const [result] = await fanOut([{ success: true, status: 'refused', refusalMessage: REFUSED_A }]);

    expect(result.refusal).toEqual({ message: REFUSED_A });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('alert').textContent).toContain(REFUSED_A);
  });
});
