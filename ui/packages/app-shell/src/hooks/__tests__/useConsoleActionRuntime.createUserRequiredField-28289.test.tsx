/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28289 — Create User left without an email marks the Email input
 * as required, in the user's language.
 *
 * The whole console seam: a real `ActionRunner` with the console runtime's own
 * api and param handlers, the real `ActionParamDialog`, and a real Chinese
 * `I18nProvider`. The action door is the mocked authenticated fetch, answering
 * the body plugin-auth's Create User serves for an empty email (pinned
 * server-side by `request-json-body-refusal.test.ts`) as the action door
 * relays it whole: `400 VALIDATION_FAILED` with `error.fields`, one `required`
 * entry per input that would satisfy it, and an English sentence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ActionRunner, type ActionResult } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
// Module scope, per AGENTS.md 测试纪律: the dialog's widgets sit behind
// `React.lazy`, and this barrel statically re-exports them.
import '@object-ui/fields';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const authFetchSpy = vi.fn();
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'User', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => authFetchSpy,
}));
// Only the metadata label lookups are stood in for (no object metadata is
// mounted); translation itself is the real provider's.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/i18n')>()),
  useObjectLabel: () => ({
    fieldLabel: (_o: any, _n: any, l: any) => l,
    fieldOptionLabel: (_o: any, _f: any, _v: any, l: any) => l,
    actionParamText: (_o: any, _a: any, _p: any, _attr: any, fallback: any) => fallback,
    actionParamOptionLabel: (_o: any, _a: any, _p: any, _v: any, fallback: any) => fallback,
    actionDescription: (_o: any, _a: any, fallback: any) => fallback,
    actionSubmitText: (_o: any, _a: any, fallback: any) => fallback,
  }),
}));
vi.mock('../useActionModal', () => ({
  useActionModal: () => ({
    modalHandler: vi.fn(async () => ({ success: true })),
    modalElement: null,
    closeModal: () => {},
    resolveModalTarget: vi.fn(async () => null),
  }),
}));
vi.mock('sonner', () => {
  const fn: any = vi.fn();
  fn.error = vi.fn();
  fn.success = vi.fn();
  return { toast: fn };
});

import { useConsoleActionRuntime } from '../useConsoleActionRuntime';

afterEach(() => cleanup());
beforeEach(() => authFetchSpy.mockReset());

/** The declared action, as `sys_user` serves it (the door looks it up by name and target). */
const CREATE_USER = {
  name: 'create_user',
  label: 'Create User',
  type: 'api',
  target: '/api/v1/auth/admin/create-user',
};
/** The params the dialog draws: the labels a Chinese console resolves for them. */
const EMAIL = { name: 'email', label: '邮箱', type: 'email' };
const PHONE = { name: 'phoneNumber', label: '手机号', type: 'text' };
const NAME = { name: 'name', label: '姓名', type: 'text' };

/** The refusal Create User answers for neither an email nor a phone number. */
function requiredRefusal(fields: string[], message: string) {
  return {
    success: false,
    error: {
      code: 'VALIDATION_FAILED',
      message,
      httpStatus: 400,
      fields: fields.map((field) => ({ field, code: 'required', message })),
    },
  };
}

function answer(status: number, body: unknown) {
  authFetchSpy.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function Harness({ onReady }: { onReady: (rt: ReturnType<typeof useConsoleActionRuntime>) => void }) {
  const runtime = useConsoleActionRuntime({
    dataSource: {},
    objects: [{ name: 'sys_user', actions: [CREATE_USER] }] as any[],
    objectName: 'sys_user',
  });
  const ready = React.useRef(false);
  if (!ready.current) {
    ready.current = true;
    onReady(runtime);
  }
  return <>{runtime.dialogs}</>;
}

/** Mount under Chinese, open Create User with `params`, and press 确认 with nothing typed. */
async function confirmEmpty(params: unknown[]) {
  let runtime!: ReturnType<typeof useConsoleActionRuntime>;
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <Harness onReady={(rt) => { runtime = rt; }} />
    </I18nProvider>,
  );
  const runner = new ActionRunner({});
  runner.setParamCollectionHandler(runtime.paramCollectionHandler);
  runner.setToastHandler(vi.fn());
  runner.registerHandler('api', runtime.apiHandler);
  const settled: { result?: ActionResult } = {};
  await act(async () => {
    void runner.execute({ ...CREATE_USER, params } as any).then((r) => { settled.result = r; });
  });
  const email = await screen.findByLabelText('邮箱');
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  await waitFor(() => expect(authFetchSpy).toHaveBeenCalledTimes(1));
  return { email, settled };
}

describe('objectstack#28289 — Create User marks a required field the server named, in the user\'s language', () => {
  it('an empty email marks the Email input with the Chinese required sentence, not the server\'s English', async () => {
    answer(400, requiredRefusal(['email'], 'Email is required'));
    const { email, settled } = await confirmEmpty([EMAIL, NAME]);

    expect(String(authFetchSpy.mock.calls[0][0]).endsWith('/api/v1/actions/sys_user/create_user')).toBe(true);
    expect(await screen.findByText('邮箱 为必填项')).toBeInTheDocument();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('姓名')).not.toHaveAttribute('aria-invalid', 'true');
    // Every entry is marked, so the English sentence is not drawn beside it.
    expect(screen.queryByTestId('action-param-refusal')).toBeNull();
    expect(screen.queryByText('Email is required')).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(settled.result).toBeUndefined();
  });

  it('with phone sign-in on, both the Email and the Phone Number inputs are marked', async () => {
    answer(400, requiredRefusal(['email', 'phoneNumber'], 'Email or phone number is required'));
    const { email } = await confirmEmpty([EMAIL, PHONE, NAME]);

    expect(await screen.findByText('邮箱 为必填项')).toBeInTheDocument();
    expect(screen.getByText('手机号 为必填项')).toBeInTheDocument();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('手机号')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByTestId('action-param-refusal')).toBeNull();
  });

  it('typing into the marked input clears its mark', async () => {
    answer(400, requiredRefusal(['email'], 'Email is required'));
    const { email } = await confirmEmpty([EMAIL, NAME]);
    await screen.findByText('邮箱 为必填项');

    fireEvent.change(email, { target: { value: 'ada@example.com' } });

    expect(screen.queryByText('邮箱 为必填项')).toBeNull();
    expect(email).toHaveAttribute('aria-invalid', 'false');
  });

  it('control: a refusal that names no field keeps the server\'s sentence in the box and marks nothing', async () => {
    answer(400, { success: false, error: { code: 'INVALID_REQUEST', message: 'A valid email is required', httpStatus: 400 } });
    const { email } = await confirmEmpty([EMAIL, NAME]);

    const box = await screen.findByTestId('action-param-refusal');
    expect(box).toHaveTextContent('A valid email is required');
    expect(screen.queryByText('邮箱 为必填项')).toBeNull();
    expect(email).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('control: an entry the dialog cannot mark keeps the box beside the marks it can make', async () => {
    const body = requiredRefusal(['email'], 'Email is required');
    body.error.fields.push({ field: 'tenant', code: 'required', message: 'Email is required' });
    answer(400, body);
    await confirmEmpty([EMAIL, NAME]);

    expect(await screen.findByText('邮箱 为必填项')).toBeInTheDocument();
    expect(screen.getByTestId('action-param-refusal')).toHaveTextContent('Email is required');
  });

  it('control: a created user closes the dialog', async () => {
    answer(200, { success: true, data: { user: { id: 'u_new' } } });
    const { settled } = await confirmEmpty([EMAIL, NAME]);

    await waitFor(() => expect(settled.result?.success).toBe(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
