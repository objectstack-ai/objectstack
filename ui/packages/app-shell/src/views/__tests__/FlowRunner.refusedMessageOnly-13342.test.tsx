/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13342 — a run that ends `refused` shows its message and Close, with
 * no screen fields under it.
 *
 * The notice itself (Close only, no toast, per-record text) is objectui#7707's
 * and is pinned in `FlowRunner.refusedOutcome-7707.test.tsx`; that file's
 * fixture is a message-only screen, which has no fields to leave behind. This
 * one is about what stays UNDER the notice: the screen the run paused on used
 * to stay mounted, its inputs visible and editable, though a refused run is
 * never resumed and nothing would submit them.
 *
 * ## What each pin is a fact about
 *
 * 1. **A flat screen's inputs go.** The fixture's screen declares a field the
 *    user types into before submitting; once the run answers `refused`, the
 *    textbox and the screen body are absent, the engine's sentence and the
 *    footer Close are present, and the dialog keeps the step's heading.
 * 2. **An `object-form` step keeps a way out.** Its Close lived in the form's
 *    own button bar, inside the body that now goes, so the runner's footer
 *    Close must take its place. `ScreenView` is replaced for that step only
 *    by a stub whose one button calls the `onSuccess` the runner hands it —
 *    the shape of a saved record resuming the run — because a real
 *    `ObjectForm` needs a data source this pin is not about.
 * 3. **A screen still waiting for input renders as before** — the lit
 *    control. The first screen shows its textbox, Submit and Cancel; a resume
 *    that answers `paused` draws the NEXT screen's field.
 * 4. **A terminal failure keeps the screen** — the other control, and the
 *    boundary of this change: a non-retryable `FLOW_FAILED` leaves the typed
 *    value on screen under the reason (the resume-result rule), so the change
 *    keys on `refused` and not on the wider "terminal" disposition.
 *
 * ## Reverse verification, direction predicted before running
 *
 * Drawing the screen body regardless of the outcome must turn pins 1 and 2
 * RED (the textbox, or the stub's button, is still there) while 3 and 4 stay
 * GREEN. Recorded in the PR body with the real output.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }));

/**
 * The real `ScreenView` for every flat screen; a stub for an `object-form`
 * step only (see pin 2). The stub's button stands in for the form's Save.
 */
vi.mock('../ScreenView.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ScreenView.js')>();
  type Props = Parameters<typeof actual.ScreenView>[0];
  return {
    ...actual,
    ScreenView: (props: Props) =>
      actual.isObjectFormScreen(props.screen) ? (
        <button type="button" onClick={() => props.objectForm?.onSuccess?.({ id: 'acc_1' })}>
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

const REFUSAL = 'Refused: the Spring cohort is not open for enrollment';

const MEMBERS_SCREEN: ScreenSpec = {
  nodeId: 'screen_members',
  title: 'Enroll members',
  fields: [{ name: 'member_count', label: 'Member count', type: 'text', required: true }],
};

const NEXT_SCREEN: ScreenSpec = {
  nodeId: 'screen_notes',
  title: 'Enrollment notes',
  fields: [{ name: 'notes', label: 'Notes', type: 'text' }],
};

const OBJECT_FORM_SCREEN: ScreenSpec = {
  nodeId: 'screen_account',
  title: 'New account',
  kind: 'object-form',
  objectName: 'crm_account',
  idVariable: 'accountId',
};

const stateFor = (s: ScreenSpec): ScreenFlowState => ({ flowName: 'enroll_members', runId: 'run_1', screen: s });

const refusedBody = { success: true, data: { success: true, status: 'refused', refusalMessage: REFUSAL } };
const pausedBody = { success: true, data: { success: true, status: 'paused', runId: 'run_1', screen: NEXT_SCREEN } };
const FAILED_MESSAGE = "Node 'enroll' failed: the cohort is full";
const failedBody = { success: false, error: { code: 'FLOW_FAILED', message: FAILED_MESSAGE, httpStatus: 400 } };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Radix's `DialogContent` renders its own dismiss `X` whose accessible name is
 * also "Close" (an `sr-only` span). The footer's is the one whose label is
 * VISIBLE.
 */
function footerCloseButton(): HTMLElement | undefined {
  return screen
    .queryAllByRole('button', { name: 'Close' })
    .find((b) => b.querySelector('.sr-only') === null);
}

function mount(s: ScreenSpec, body: unknown, status = 200) {
  const onClose = vi.fn();
  const onComplete = vi.fn();
  const authFetch = vi.fn(async () => jsonResponse(body, status));
  render(<FlowRunner state={stateFor(s)} authFetch={authFetch} baseUrl="" onClose={onClose} onComplete={onComplete} />);
  return { onClose, onComplete, authFetch };
}

async function typeAndSubmit(value: string) {
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox'), value);
  await user.click(screen.getByRole('button', { name: 'Submit' }));
  return user;
}

beforeEach(() => {
  toastError.mockClear();
  toastSuccess.mockClear();
});

describe('objectui#13342 — a refused end shows its message with no screen fields under it', () => {
  it('a flat screen: the typed input and the screen body are gone; the message, the heading and Close stay', async () => {
    const { onClose } = mount(MEMBERS_SCREEN, refusedBody);
    const user = await typeAndSubmit('12');

    await waitFor(() => expect(screen.getByText(REFUSAL)).toBeInTheDocument());
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Member count')).not.toBeInTheDocument();
    expect(screen.queryByTestId('flow-screen-body')).not.toBeInTheDocument();
    expect(screen.getByText('Enroll members')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();

    const close = footerCloseButton();
    expect(close).toBeDefined();
    await user.click(close!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('an `object-form` step: the form goes, and the runner footer draws the Close it used to carry', async () => {
    const { onClose, authFetch } = mount(OBJECT_FORM_SCREEN, refusedBody);
    // The step brings its own button bar, so the runner draws no footer yet.
    expect(footerCloseButton()).toBeUndefined();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Stub save' }));

    await waitFor(() => expect(screen.getByText(REFUSAL)).toBeInTheDocument());
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Stub save' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('flow-screen-body')).not.toBeInTheDocument();

    const close = footerCloseButton();
    expect(close).toBeDefined();
    await user.click(close!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('objectui#13342 — controls: a screen waiting for input, and a terminal failure, are unchanged', () => {
  it('a paused screen renders its field, Cancel and Submit; a `paused` resume draws the next screen field', async () => {
    mount(MEMBERS_SCREEN, pausedBody);
    expect(screen.getByTestId('flow-screen-body')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();

    await typeAndSubmit('12');

    await waitFor(() => expect(screen.getByText('Enrollment notes')).toBeInTheDocument());
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
  });

  it('a terminal FLOW_FAILED keeps the screen and the typed value under the reason', async () => {
    mount(MEMBERS_SCREEN, failedBody, 400);
    await typeAndSubmit('12');

    await waitFor(() => expect(screen.getByText(FAILED_MESSAGE)).toBeInTheDocument());
    expect(screen.getByTestId('flow-screen-body')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('12');
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
    expect(footerCloseButton()).toBeDefined();
  });
});
