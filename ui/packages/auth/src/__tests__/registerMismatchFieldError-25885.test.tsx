/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #25885 — a mismatched confirmation is an error ON the confirm field.
 *
 * The form set the mismatch as its top `AuthErrorBanner`, above the name
 * field, while the visitor's eyes were on the button at the bottom. It is now
 * drawn under the confirm input, which carries `aria-invalid` and names the
 * message through `aria-describedby`; the banner stays for what the server
 * refuses. The sign-up request is never sent for a mismatch.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { RegisterForm } from '../RegisterForm';
import type { AuthClient } from '../types';

afterEach(cleanup);

function renderForm(signUp: ReturnType<typeof vi.fn>) {
  const client = {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue({}),
    signUp,
  } as unknown as AuthClient;
  render(
    <AuthProvider authUrl="/api/v1/auth" client={client}>
      <RegisterForm />
    </AuthProvider>,
  );
}

async function fillAndSubmit(password: string, confirm: string) {
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Ada' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: confirm } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
}

describe('RegisterForm — password mismatch is a field error (#25885)', () => {
  it('marks the confirm field invalid and describes it with the message, with no banner', async () => {
    const signUp = vi.fn();
    renderForm(signUp);

    await fillAndSubmit('hunter2hunter2', 'hunter2hunter3');

    const confirm = screen.getByLabelText('Confirm Password');
    await waitFor(() => expect(confirm.getAttribute('aria-invalid')).toBe('true'));
    const describedBy = confirm.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const message = document.getElementById(describedBy!);
    expect(message?.textContent).toBe('Passwords do not match');

    // The message sits after the confirm input, not above the form's first field.
    expect(
      confirm.compareDocumentPosition(message!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // ...and the top banner does not carry it.
    expect(screen.queryAllByRole('alert').filter((el) => el !== message)).toHaveLength(0);
    expect(signUp).not.toHaveBeenCalled();
  });

  it('clears the field error once the confirmation is edited', async () => {
    renderForm(vi.fn());

    await fillAndSubmit('hunter2hunter2', 'hunter2hunter3');
    const confirm = screen.getByLabelText('Confirm Password');
    await waitFor(() => expect(confirm.getAttribute('aria-invalid')).toBe('true'));

    fireEvent.change(confirm, { target: { value: 'hunter2hunter2' } });

    expect(confirm.getAttribute('aria-invalid')).toBeNull();
    expect(confirm.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByText('Passwords do not match')).toBeNull();
  });

  it('leaves a matching pair unmarked and keeps a server refusal in the banner', async () => {
    const signUp = vi.fn().mockRejectedValue(new Error('User already exists'));
    renderForm(signUp);

    await fillAndSubmit('hunter2hunter2', 'hunter2hunter2');

    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('User already exists');
    expect(signUp).toHaveBeenCalledTimes(1);
    const confirm = screen.getByLabelText('Confirm Password');
    expect(confirm.getAttribute('aria-invalid')).toBeNull();
    expect(confirm.getAttribute('aria-describedby')).toBeNull();
  });
});
