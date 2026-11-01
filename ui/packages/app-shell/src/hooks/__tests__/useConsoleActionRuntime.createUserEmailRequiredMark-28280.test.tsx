/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28280 — Create User marks Email required BEFORE submit, exactly
 * when the endpoint requires it.
 *
 * plugin-auth's Create User refuses a blank email while phone sign-in is off
 * (the default) and takes an email OR a phone number while it is on. A param's
 * `required` is static, so `sys_user.create_user` declares two params on the
 * one `email` field, each gated on `features.phoneNumber`; the dialog draws and
 * submits only the param whose gate says yes. `@objectstack/platform-objects`
 * is not a dependency of this tree: its own pin
 * (`identity/sys-user-create-user-email-required.test.ts`) holds the
 * declaration to the params below, which are the declaration as the server
 * serves it (`requiresFeature` lowered into `visible`).
 *
 * The seam is the one objectstack#28289's test boots (a real `ActionRunner`
 * with the console runtime's api and param handlers, the real
 * `ActionParamDialog`, a real Chinese `I18nProvider`), plus the console's own
 * `ExpressionProvider` fed the served `features`, and `sys_user`'s `email`
 * field so the field-backed params resolve through `resolveActionParams`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ActionRunner } from '@object-ui/core';
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
// Only the metadata label lookups are stood in for; translation itself is the
// real provider's.
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
import { ExpressionProvider } from '../../providers/ExpressionProvider';

afterEach(() => cleanup());
beforeEach(() => authFetchSpy.mockReset());

const cel = (source: string) => ({ dialect: 'cel', source });

/** `sys_user.create_user`'s leading params, as the server serves them. */
const PARAMS = [
  { field: 'email', required: false, visible: cel('features.phoneNumber == true') },
  { field: 'email', required: true, visible: cel('has(features.phoneNumber) && features.phoneNumber != true') },
  { name: 'phoneNumber', label: '手机号', type: 'text', required: false, visible: cel('features.phoneNumber == true') },
  { field: 'name', required: false },
];
const CREATE_USER = {
  name: 'create_user',
  label: 'Create User',
  type: 'api',
  target: '/api/v1/auth/admin/create-user',
};
/** The `sys_user` fields the field-backed params resolve against. */
const SYS_USER = {
  name: 'sys_user',
  fields: {
    email: { name: 'email', label: '邮箱', type: 'email' },
    name: { name: 'name', label: '姓名', type: 'text' },
  },
  actions: [{ ...CREATE_USER, params: PARAMS }],
};

function Harness({ onReady }: { onReady: (rt: ReturnType<typeof useConsoleActionRuntime>) => void }) {
  const runtime = useConsoleActionRuntime({
    dataSource: {},
    objects: [SYS_USER] as any[],
    objectName: 'sys_user',
  });
  const ready = React.useRef(false);
  if (!ready.current) {
    ready.current = true;
    onReady(runtime);
  }
  return <>{runtime.dialogs}</>;
}

/** Mount under Chinese with the served `features`, and open Create User. */
async function open(features: Record<string, unknown>) {
  let runtime!: ReturnType<typeof useConsoleActionRuntime>;
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <ExpressionProvider features={features}>
        <Harness onReady={(rt) => { runtime = rt; }} />
      </ExpressionProvider>
    </I18nProvider>,
  );
  const runner = new ActionRunner({});
  runner.setParamCollectionHandler(runtime.paramCollectionHandler);
  runner.setToastHandler(vi.fn());
  runner.registerHandler('api', runtime.apiHandler);
  await act(async () => {
    void runner.execute({ ...CREATE_USER, params: PARAMS } as any);
  });
  await screen.findByLabelText(/邮箱/);
}

/** The Email inputs the dialog drew: one per field row. */
const emailInputs = () => screen.getAllByLabelText(/邮箱/);
const confirm = () => fireEvent.click(screen.getByRole('button', { name: '确认' }));

describe('objectstack#28280 — Create User marks Email required before submit, per phone sign-in', () => {
  it('phone sign-in off: one Email input carrying the required mark, and a blank one is refused before any request', async () => {
    await open({ phoneNumber: false });

    expect(emailInputs()).toHaveLength(1);
    expect(emailInputs()[0]).toHaveAttribute('aria-required', 'true');
    expect(screen.queryByLabelText(/手机号/)).toBeNull();

    confirm();

    expect(await screen.findByText('邮箱 为必填项')).toBeInTheDocument();
    expect(emailInputs()[0]).toHaveAttribute('aria-invalid', 'true');
    expect(authFetchSpy).not.toHaveBeenCalled();
  });

  it('phone sign-in on: one Email input, optional, beside Phone Number; a blank form goes to the server', async () => {
    authFetchSpy.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ success: false, error: { code: 'VALIDATION_FAILED', message: 'Email or phone number is required', httpStatus: 400 } }),
    });
    await open({ phoneNumber: true });

    expect(emailInputs()).toHaveLength(1);
    expect(emailInputs()[0]).not.toHaveAttribute('aria-required');
    expect(screen.getByLabelText(/手机号/)).toBeInTheDocument();

    confirm();

    await waitFor(() => expect(authFetchSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('邮箱 为必填项')).toBeNull();
  });

  it('no served flag (config not fetched, or the fetch failed): one Email input, optional', async () => {
    await open({});

    expect(emailInputs()).toHaveLength(1);
    expect(emailInputs()[0]).not.toHaveAttribute('aria-required');
  });

  it('control: with phone sign-in off a typed email submits once, under its one name', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: { user: { id: 'u_new' } } }) });
    await open({ phoneNumber: false });

    fireEvent.change(emailInputs()[0], { target: { value: 'ada@example.com' } });
    confirm();

    await waitFor(() => expect(authFetchSpy).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String((authFetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(JSON.stringify(body)).toContain('"email":"ada@example.com"');
  });
});
