/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A refused run keeps what the user typed (objectui#13161).
 *
 * Measured on a seeded install: Users → Create User with an existing email,
 * and OAuth Applications → Register with a redirect URL of `not-a-url`. The
 * dialog closed on Confirm every time and only a toast remained, because
 * `handleSubmit` resolved its values and closed BEFORE the runner dispatched
 * the action. With the runner's `run` in its state, the dialog now runs the
 * action from inside, stays open until the run settles, closes on success and
 * shows the refusal beside the typed values on failure.
 *
 * The refusals are the measured server sentences. None of their envelopes
 * names a field (the better-auth admin refusal and the platform's own
 * `INVALID_REQUEST` carry `{ code, message }`; better-call drops the zod
 * issues and keeps only the joined message), and the runner's `ActionResult`
 * carries the refusal as text only. So the dialog marks NO field: a field
 * named inside the message text is not read (the redirect-URL case below).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import type { ActionParamDef, ActionResult } from '@object-ui/core';
import { ActionParamDialog, type ParamDialogState } from './ActionParamDialog';

const USER_PARAMS: ActionParamDef[] = [
  { name: 'email', label: 'Email', type: 'text' },
  { name: 'name', label: 'Name', type: 'text' },
];
const TAKEN = 'User already exists. Use another email.';

/**
 * The refusal box leads with the message's first sentence and keeps the whole
 * message behind "More" (objectui#13332): assert the lead, open it, and read
 * the server's text whole.
 */
function expectRefusal(alert: HTMLElement, lead: string, full: string) {
  expect(within(alert).getByTestId('refusal-lead')).toHaveTextContent(lead);
  fireEvent.click(within(alert).getByTestId('refusal-more'));
  expect(within(alert).getByTestId('refusal-detail').textContent).toBe(full);
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function openWith(state: Partial<ParamDialogState>) {
  const resolve = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ActionParamDialog
      state={{ open: true, params: USER_PARAMS, title: 'Create User', resolve, ...state }}
      onOpenChange={onOpenChange}
    />,
  );
  return { resolve, onOpenChange };
}

const confirmButton = () => screen.getByText('actionDialog.confirm').closest('button')!;
const cancelButton = () => screen.getByText('actionDialog.cancel').closest('button')!;

async function type(label: string, value: string) {
  fireEvent.change(await screen.findByLabelText(label), { target: { value } });
}

describe('ActionParamDialog — a refused run keeps the typed input (objectui#13161)', () => {
  it('a refused run leaves the dialog open with the typed values and the refusal shown', async () => {
    const run = vi.fn(async (): Promise<ActionResult> => ({ success: false, error: TAKEN }));
    const { resolve, onOpenChange } = openWith({ run });

    await type('Email', 'ada@example.com');
    await type('Name', 'Ada');
    fireEvent.click(confirmButton());

    const alert = await screen.findByTestId('action-param-refusal');
    expect(alert).toHaveAttribute('role', 'alert');
    expectRefusal(alert, 'User already exists.', TAKEN);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ email: 'ada@example.com', name: 'Ada' });
    // Not settled and not closed: the session is the dialog's to end.
    expect(resolve).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com');
    expect(screen.getByLabelText('Name')).toHaveValue('Ada');
    expect(confirmButton()).not.toBeDisabled();
  });

  it('after a refusal the user fixes the value and confirms again; the success closes with the values it ran', async () => {
    const run = vi
      .fn<(values: Record<string, any>) => Promise<ActionResult>>()
      .mockResolvedValueOnce({ success: false, error: TAKEN })
      .mockResolvedValueOnce({ success: true });
    const { resolve, onOpenChange } = openWith({ run });

    await type('Email', 'taken@example.com');
    fireEvent.click(confirmButton());
    await screen.findByTestId('action-param-refusal');

    await type('Email', 'ada@example.com');
    fireEvent.click(confirmButton());

    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ email: 'ada@example.com' }));
    expect(run).toHaveBeenNthCalledWith(2, { email: 'ada@example.com' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // The second Confirm cleared the first refusal before it ran.
    expect(screen.queryByTestId('action-param-refusal')).toBeNull();
  });

  it('Cancel after a refusal resolves null and runs nothing more (H4 control)', async () => {
    const run = vi.fn(async (): Promise<ActionResult> => ({ success: false, error: TAKEN }));
    const { resolve, onOpenChange } = openWith({ run });

    await type('Email', 'ada@example.com');
    fireEvent.click(confirmButton());
    await screen.findByTestId('action-param-refusal');

    fireEvent.click(cancelButton());

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(null);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('while the run is in flight, Confirm and Cancel are disabled and the dialog refuses to close', async () => {
    const gate = deferred<ActionResult>();
    const run = vi.fn(() => gate.promise);
    const { resolve, onOpenChange } = openWith({ run });

    await type('Email', 'ada@example.com');
    fireEvent.click(confirmButton());

    await waitFor(() => expect(confirmButton()).toBeDisabled());
    expect(confirmButton()).toHaveAttribute('aria-busy', 'true');
    expect(cancelButton()).toBeDisabled();
    // Escape is the route an outside click and the header X share with it.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();

    await act(async () => { gate.resolve({ success: true }); });

    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ email: 'ada@example.com' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('marks no field from the message text: a refusal that names a param inside its sentence is shown as the form\'s', async () => {
    const urlRefusal = '[body.redirect_uris.0] Invalid URL; [body.redirect_uris.0] URL must be parseable';
    const run = vi.fn(async (): Promise<ActionResult> => ({ success: false, error: urlRefusal }));
    openWith({
      run,
      title: 'Register OAuth Application',
      params: [
        { name: 'client_name', label: 'Application name', type: 'text' },
        { name: 'redirect_uris', label: 'Redirect URL', type: 'text' },
      ],
    });

    await type('Application name', 'CRM sync');
    await type('Redirect URL', 'not-a-url');
    fireEvent.click(confirmButton());

    // The OAuth page's measured refusal (objectui#13332): the plain sentence
    // first, the field path and the joined second issue behind "More".
    expectRefusal(await screen.findByTestId('action-param-refusal'), 'Invalid URL', urlRefusal);
    expect(screen.getByTestId('refusal-lead').textContent).toBe('Invalid URL');
    expect(screen.getByLabelText('Redirect URL')).toHaveValue('not-a-url');
    expect(screen.getByLabelText('Redirect URL').className).not.toContain('border-destructive');
    expect(screen.queryByText(/actionDialog\.requiredError/)).toBeNull();
  });

  it('a refused run that says nothing keeps the dialog open without an alert', async () => {
    // The api handler answers `{ success: false }` with no `error` when it has
    // opened its own entitlement dialog for the refusal.
    const run = vi.fn(async (): Promise<ActionResult> => ({ success: false }));
    const { resolve, onOpenChange } = openWith({ run });

    await type('Email', 'ada@example.com');
    fireEvent.click(confirmButton());

    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('action-param-refusal')).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com');
  });

  it('a refusal leaked as an object shows its message, never the object', async () => {
    const run = vi.fn(async () => ({
      success: false,
      error: { code: 'USER_ALREADY_EXISTS', message: TAKEN } as unknown as string,
    }));
    openWith({ run });

    await type('Email', 'ada@example.com');
    fireEvent.click(confirmButton());

    expectRefusal(await screen.findByTestId('action-param-refusal'), 'User already exists.', TAKEN);
  });

  it('control — without `run`, Confirm resolves and closes at once, as it always did', async () => {
    const { resolve, onOpenChange } = openWith({});

    await type('Email', 'ada@example.com');
    fireEvent.click(confirmButton());

    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ email: 'ada@example.com' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('a reopen starts clean: no refusal and no busy state carried over', async () => {
    const run = vi.fn(async (): Promise<ActionResult> => ({ success: false, error: TAKEN }));
    const resolve = vi.fn();
    const state: ParamDialogState = { open: true, params: USER_PARAMS, resolve, run };
    const { rerender } = render(<ActionParamDialog state={state} onOpenChange={() => {}} />);

    await type('Email', 'ada@example.com');
    fireEvent.click(confirmButton());
    await screen.findByTestId('action-param-refusal');

    rerender(<ActionParamDialog state={{ ...state, open: false }} onOpenChange={() => {}} />);
    rerender(<ActionParamDialog state={{ ...state }} onOpenChange={() => {}} />);

    await waitFor(() => expect(screen.queryByTestId('action-param-refusal')).toBeNull());
    expect(confirmButton()).not.toBeDisabled();
  });
});
