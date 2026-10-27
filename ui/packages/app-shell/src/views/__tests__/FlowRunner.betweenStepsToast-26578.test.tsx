// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26578 — a step between screens toasts only a record it saved.
 *
 * A wizard step used to answer every pause with `Saved — next step`, so a flat
 * step that only collected variables told the user something was saved. The
 * toast now follows what the dialog itself persisted:
 *
 * 1. A flat step that pauses again draws the next screen and toasts nothing.
 * 2. An `object-form` step that pauses again has written its record, so it
 *    keeps the toast — the form's own confirmation is silenced by `onSuccess`,
 *    which makes this the only one the user gets.
 * 3. A flat step that ends the run still gets the completion toast: only the
 *    between-steps toast moved.
 *
 * The real `ScreenView` draws every flat screen; an `object-form` step is a
 * stub whose button stands in for the form's Save (as in
 * `FlowRunner.refusedMessageOnly-13342.test.tsx`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }));

vi.mock('../ScreenView.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ScreenView.js')>();
  type Props = Parameters<typeof actual.ScreenView>[0];
  return {
    ...actual,
    ScreenView: (props: Props) =>
      actual.isObjectFormScreen(props.screen) ? (
        <button type="button" onClick={() => props.objectForm?.onSuccess?.({ id: 'ctr_1' })}>
          Stub save
        </button>
      ) : (
        <actual.ScreenView {...props} />
      ),
  };
});

const { FlowRunner } = await import('../FlowRunner');
type ScreenFlowState = import('../FlowRunner').ScreenFlowState;
type ScreenSpec = ScreenFlowState['screen'];

const INFO_SCREEN: ScreenSpec = {
  nodeId: 'screen_info',
  title: 'Contract details',
  fields: [{ name: 'contract_title', label: 'Title', type: 'text', required: true }],
};

const CONTRACT_FORM_SCREEN: ScreenSpec = {
  nodeId: 'screen_contract',
  title: 'New contract',
  kind: 'object-form',
  objectName: 'contract',
  idVariable: 'contractId',
};

const NEXT_SCREEN: ScreenSpec = {
  nodeId: 'screen_submit',
  title: 'Send to legal',
  fields: [{ name: 'notes', label: 'Notes', type: 'text' }],
};

const pausedBody = { success: true, data: { success: true, status: 'paused', runId: 'run_1', screen: NEXT_SCREEN } };
const completedBody = { success: true, data: { success: true } };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function mount(s: ScreenSpec, body: unknown) {
  const onComplete = vi.fn();
  const authFetch = vi.fn(async () => jsonResponse(body));
  render(
    <FlowRunner
      state={{ flowName: 'start_contract', runId: 'run_1', screen: s }}
      authFetch={authFetch}
      baseUrl=""
      onClose={vi.fn()}
      onComplete={onComplete}
    />,
  );
  return { onComplete, authFetch };
}

async function typeAndSubmit() {
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox'), 'Supply agreement');
  await user.click(screen.getByRole('button', { name: 'Submit' }));
}

beforeEach(() => {
  toastError.mockClear();
  toastSuccess.mockClear();
});

describe('objectstack#26578 — a step between screens toasts only a record it saved', () => {
  it('a flat step that pauses again draws the next screen and toasts nothing', async () => {
    const { authFetch, onComplete } = mount(INFO_SCREEN, pausedBody);
    await typeAndSubmit();

    expect(await screen.findByRole('heading', { name: 'Send to legal' })).toBeInTheDocument();
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('an `object-form` step that pauses again keeps the toast for the record it saved', async () => {
    const { authFetch } = mount(CONTRACT_FORM_SCREEN, pausedBody);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stub save' }));

    expect(await screen.findByRole('heading', { name: 'Send to legal' })).toBeInTheDocument();
    expect(authFetch).toHaveBeenCalledWith(
      '/api/v1/automation/start_contract/runs/run_1/resume',
      expect.objectContaining({ body: JSON.stringify({ inputs: { contractId: 'ctr_1' } }) }),
    );
    expect(toastSuccess.mock.calls).toEqual([['Saved — next step']]);
  });

  it('a flat step that ends the run still gets the completion toast', async () => {
    const { onComplete } = mount(INFO_SCREEN, completedBody);
    await typeAndSubmit();

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls).toEqual([['Flow "start_contract" completed']]);
  });
});
