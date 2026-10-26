/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12274 — a flow action whose run goes STRAIGHT THROUGH (no screen)
 * closes with the same copy a paused run closes with: the action's own
 * `successMessage`, then the flow's own `successMessage`, then the default.
 *
 * Beside objectui#12234's paused-path pins
 * (`useConsoleActionRuntime.flowActionSuccessMessage-12234`). Before this fix
 * the straight-through `done` arm handed the ActionRunner a plain success, and
 * the runner's toast has no rung for the flow's copy, so a flow's declared
 * `successMessage` was read only when the run happened to pause.
 *
 * Driven end to end through the real runtime, as there:
 * `ConsoleActionRuntimeProvider` (the real `ActionProvider` / `ActionRunner`
 * and its toast sink), the real flow handler and launch module, under the real
 * en pack. Only the network (`authFetch`), the router and the toast library
 * are stubbed. Every case asserts the FULL `toast.success` call list, so a
 * second toast — the runner's default beside the flow's copy — cannot hide.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
const FLOW_MESSAGE = 'Escalation recorded';
/** The runner's own default text, in the en pack. */
const RUNNER_DEFAULT = 'Action completed successfully';
/** The declared action, as the object metadata carries it. */
const DECLARED_WITHOUT_MESSAGE = { name: 'escalate_case', label: 'Escalate case', type: 'flow', target: FLOW };
const DECLARED = { ...DECLARED_WITHOUT_MESSAGE, successMessage: ACTION_MESSAGE };

function answered(data: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) };
}
/** A run that went straight through, serving the flow's own `successMessage`. */
const COMPLETED_WITH_FLOW_MESSAGE = { success: true, status: 'completed', flowLabel: 'Escalate', successMessage: FLOW_MESSAGE };
const COMPLETED_PLAIN = { success: true, status: 'completed', flowLabel: 'Escalate' };

/**
 * The text of every success toast, in order. The runner's sink passes an
 * options bag beside the text and the launch passes none, so the text alone is
 * compared — the full list, so a second toast cannot hide.
 */
const successTexts = () => (toast as any).success.mock.calls.map((call: unknown[]) => call[0]);

beforeEach(() => {
  authFetchSpy.mockReset();
  (toast as any).mockClear();
  (toast as any).error.mockClear();
  (toast as any).success.mockClear();
});

/**
 * Mount the runtime with `declared` on the object (none when `null`), click
 * `clicked` once through the real runner, and return what the runner returned.
 */
async function click(clicked: Record<string, unknown>, declared: Record<string, unknown> | null = clicked) {
  const objects = [{ name: OBJECT, label: 'Case', fields: {}, actions: declared ? [declared] : [] }];
  let result: any;
  function Probe() {
    const { execute } = useAction();
    return (
      <button onClick={() => {
        void execute({ ...clicked, params: { _rowRecord: { id: 'case-41' } } } as any).then((r) => { result = r; });
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
  return result;
}

describe('objectui#12274 — a straight-through action-door launch closes by the one precedence', () => {
  it("(i) the action's message, over the flow's", async () => {
    authFetchSpy.mockResolvedValueOnce(answered(COMPLETED_WITH_FLOW_MESSAGE));

    const result = await click(DECLARED);

    expect(String(authFetchSpy.mock.calls[0][0])).toBe(`/api/v1/actions/${OBJECT}/escalate_case`);
    expect(result).toEqual({ success: true, data: COMPLETED_WITH_FLOW_MESSAGE, reload: true });
    expect(successTexts()).toEqual([ACTION_MESSAGE]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("(ii) the flow's own successMessage when the action declares none — once, with no runner default beside it", async () => {
    authFetchSpy.mockResolvedValueOnce(answered(COMPLETED_WITH_FLOW_MESSAGE));

    const result = await click(DECLARED_WITHOUT_MESSAGE);

    expect(String(authFetchSpy.mock.calls[0][0])).toBe(`/api/v1/actions/${OBJECT}/escalate_case`);
    // The toast first: it is what the user reads, so a red run names the sentence.
    expect(successTexts()).toEqual([FLOW_MESSAGE]);
    expect(result).toEqual({ success: true, data: COMPLETED_WITH_FLOW_MESSAGE, reload: true, silent: true });
    expect((toast as any).error).not.toHaveBeenCalled();
  });

  it("(iii) neither declares copy: the runner's default text", async () => {
    authFetchSpy.mockResolvedValueOnce(answered(COMPLETED_PLAIN));

    const result = await click(DECLARED_WITHOUT_MESSAGE);

    expect(result).toEqual({ success: true, data: COMPLETED_PLAIN, reload: true });
    expect(successTexts()).toEqual([RUNNER_DEFAULT]);
  });

  it('(iv) a run that ends refused shows its notice and no success toast', async () => {
    authFetchSpy.mockResolvedValueOnce(answered({
      success: true, status: 'refused', refusalMessage: 'Refused: already escalated', successMessage: FLOW_MESSAGE,
    }));

    const result = await click(DECLARED_WITHOUT_MESSAGE);

    expect(result).toEqual({ success: true, silent: true });
    expect(await screen.findByText('Refused: already escalated')).toBeTruthy();
    expect((toast as any).success).not.toHaveBeenCalled();
  });

  it('(iv) a run that fails shows the failure and no success toast', async () => {
    authFetchSpy.mockResolvedValueOnce(answered({ success: false, error: "Node 'escalate' failed", successMessage: FLOW_MESSAGE }));

    const result = await click(DECLARED_WITHOUT_MESSAGE);

    expect(result).toMatchObject({ success: false });
    expect((toast as any).success).not.toHaveBeenCalled();
    expect((toast as any).error).toHaveBeenCalledTimes(1);
  });
});

describe('objectui#12274 — the trigger-route door follows the same precedence', () => {
  it("a click naming no declared action closes with the flow's own successMessage", async () => {
    authFetchSpy.mockResolvedValueOnce(answered(COMPLETED_WITH_FLOW_MESSAGE));

    // `null`: the object declares no action, so the click takes the trigger route.
    const result = await click({ name: 'escalate_inline', label: 'Escalate', type: 'flow', target: FLOW }, null);

    expect(String(authFetchSpy.mock.calls[0][0])).toBe(`/api/v1/automation/${FLOW}/trigger`);
    expect(successTexts()).toEqual([FLOW_MESSAGE]);
    expect(result).toMatchObject({ success: true, silent: true });
  });
});
