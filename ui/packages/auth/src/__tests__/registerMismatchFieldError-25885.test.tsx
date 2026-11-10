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
 *
 * objectstack#32021 item 2 — the same goes for every other field problem, all
 * at once. The form relied on the browser's constraint bubbles for the empty
 * and too-short cases: one field at a time, in the browser's language (English
 * on a zh-CN page), and only after that was fixed did the visitor learn that
 * the two passwords differ. The form is now `noValidate` and checks every
 * field on submit, so a short, mismatched pair shows both messages together.
 * No minimum length is served by the auth config, so the form keeps 8.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../AuthProvider';
import { RegisterForm } from '../RegisterForm';
import type { RegisterFormProps } from '../RegisterForm';
import type { AuthClient } from '../types';

afterEach(cleanup);

function renderForm(signUp: ReturnType<typeof vi.fn>, labels?: RegisterFormProps['labels']) {
  const client = {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue({}),
    signUp,
  } as unknown as AuthClient;
  render(
    <AuthProvider authUrl="/api/v1/auth" client={client}>
      <RegisterForm labels={labels} />
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

/** The message a field names through `aria-describedby`, or null. */
function fieldMessage(label: string): string | null {
  const input = screen.getByLabelText(label);
  if (input.getAttribute('aria-invalid') !== 'true') return null;
  const id = input.getAttribute('aria-describedby');
  return id ? document.getElementById(id)?.textContent ?? null : null;
}

describe('RegisterForm — inline errors, all at once, no browser bubble (objectstack#32021)', () => {
  it('the form leaves validation to itself, not to the browser', async () => {
    renderForm(vi.fn());
    const button = await screen.findByRole('button', { name: 'Create Account' });
    expect(button.closest('form')?.noValidate).toBe(true);
  });

  it('a short password that also does not match shows both messages together, and sends nothing', async () => {
    const signUp = vi.fn();
    renderForm(signUp);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), '张伟');
    await user.type(screen.getByLabelText('Email'), 'zhang@example.com');
    await user.type(screen.getByLabelText('Password'), '123');
    await user.type(screen.getByLabelText('Confirm Password'), '456');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(fieldMessage('Password')).toBe('Password must be at least 8 characters');
    expect(fieldMessage('Confirm Password')).toBe('Passwords do not match');
    expect(fieldMessage('Name')).toBeNull();
    expect(fieldMessage('Email')).toBeNull();
    expect(signUp).not.toHaveBeenCalled();
  });

  it('an empty submit marks every field, each under itself', async () => {
    const signUp = vi.fn();
    renderForm(signUp);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Create Account' }));

    expect(fieldMessage('Name')).toBe('Enter your name');
    expect(fieldMessage('Email')).toBe('Enter your email address');
    expect(fieldMessage('Password')).toBe('Password must be at least 8 characters');
    expect(fieldMessage('Confirm Password')).toBeNull();
    expect(signUp).not.toHaveBeenCalled();
  });

  it('an address with no @ is said under the email field', async () => {
    renderForm(vi.fn());
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Email'), 'zhang');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(fieldMessage('Email')).toBe('Enter an email address such as name@example.com');
  });

  it('the host translates every message (the console passes its zh-CN pack)', async () => {
    renderForm(vi.fn(), {
      nameRequiredError: '请输入姓名',
      emailRequiredError: '请输入邮箱地址',
      passwordTooShortError: '密码至少需要 8 个字符',
      passwordMismatchError: '两次输入的密码不一致',
    });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Password'), '123');
    await user.type(screen.getByLabelText('Confirm Password'), '456');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(fieldMessage('Name')).toBe('请输入姓名');
    expect(fieldMessage('Email')).toBe('请输入邮箱地址');
    expect(fieldMessage('Password')).toBe('密码至少需要 8 个字符');
    expect(fieldMessage('Confirm Password')).toBe('两次输入的密码不一致');
  });

  it('CONTROL: a complete, matching form is sent, with no field marked', async () => {
    const signUp = vi.fn().mockResolvedValue({ user: { id: 'u1' } });
    renderForm(signUp);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), '张伟');
    await user.type(screen.getByLabelText('Email'), ' zhang@example.com ');
    await user.type(screen.getByLabelText('Password'), 'hunter2hunter2');
    await user.type(screen.getByLabelText('Confirm Password'), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(signUp).toHaveBeenCalledTimes(1);
    expect(signUp.mock.calls[0]![0]).toMatchObject({ name: '张伟', email: 'zhang@example.com', password: 'hunter2hunter2' });
    for (const label of ['Name', 'Email', 'Password', 'Confirm Password']) expect(fieldMessage(label)).toBeNull();
  });
});
