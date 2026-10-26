/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One server refusal raises ONE error toast (objectui#13340).
 *
 * A Setup form that collects action params (Users → Create User, Teams → Add
 * Member) runs its action from inside `ActionParamDialog`. A refusal reaches
 * the user on two surfaces: the dialog's own refusal line beside the input
 * (objectui#13161), and a toast. The toast must be raised once per refusal, by
 * one emitter: the runner's post-execution, through the console's
 * `toastHandler`. A second emitter on the same path (the api handler toasting
 * before it returns the refusal, or the session's end re-reporting a refusal
 * the run already reported) would put two identical toasts over the page.
 *
 * Driven through the console's OWN handlers — `toastHandler`, `apiHandler`
 * and `paramCollectionHandler` from `useConsoleActionRuntime`, wired into a
 * real `ActionRunner` the way `actionProviderProps` hands them over — down to
 * `sonner`, so every raiser on the path is counted, undeduplicated. Only the
 * network is faked: the authenticated fetch answers the create-user door's
 * 400 envelope.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { ActionRunner, type ActionResult } from '@object-ui/core';

const REFUSAL = 'Either email or phoneNumber is required';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(async () =>
    new Response(
      JSON.stringify({ success: false, error: { code: 'BAD_REQUEST', message: 'Either email or phoneNumber is required' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    ),
  ),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'User', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => fetchMock,
}));
// Partial mock, the sibling suites' shape: `@object-ui/components` reaches for
// `createSafeTranslation` at import time, so a total double breaks the graph.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/i18n')>()),
  useObjectLabel: () => ({
    fieldLabel: (_o: any, _n: any, l: any) => l,
    fieldOptionLabel: (_o: any, _f: any, _v: any, l: any) => l,
    actionParamText: (_o: any, _a: any, _p: any, _attr: any, fallback: any) => fallback,
    actionParamOptionLabel: (_o: any, _a: any, _p: any, _v: any, fallback: any) => fallback,
    actionDescription: (_o: any, _a: any, fallback: any) => fallback,
  }),
  useObjectTranslation: () => ({
    t: (key: string, options?: any) => String(options?.defaultValue ?? key),
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
  fn.info = vi.fn();
  fn.warning = vi.fn();
  fn.dismiss = vi.fn();
  return { toast: fn };
});

import { toast } from 'sonner';
import { useConsoleActionRuntime } from '../useConsoleActionRuntime';

type Runtime = ReturnType<typeof useConsoleActionRuntime>;

function Harness({ onReady }: { onReady: (runtime: Runtime) => void }) {
  const runtime = useConsoleActionRuntime({ dataSource: {}, objects: [] });
  const ready = React.useRef(false);
  if (!ready.current) {
    ready.current = true;
    onReady(runtime);
  }
  return <>{runtime.dialogs}</>;
}

/** Every error toast raised so far, whoever raised it. */
const errorToasts = () => vi.mocked(toast.error).mock.calls.map((c) => String(c[0]));

async function openCreateUser(): Promise<{ result: () => ActionResult | undefined }> {
  let runtime!: Runtime;
  render(<Harness onReady={(r) => { runtime = r; }} />);
  const props = runtime.actionProviderProps;
  const runner = new ActionRunner(props.context as any);
  runner.setToastHandler(props.onToast as any);
  runner.setParamCollectionHandler(props.onParamCollection as any);
  runner.registerHandler('api', props.handlers!.api as any);

  let result: ActionResult | undefined;
  await act(async () => {
    void runner
      .execute({
        type: 'api',
        name: 'create_user',
        label: 'Create User',
        target: '/api/v1/auth/admin/create-user',
        params: [{ name: 'email', label: 'Email', type: 'text' }],
      } as any)
      .then((r) => { result = r; });
  });
  await screen.findByLabelText('Email');
  return { result: () => result };
}

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
  fetchMock.mockClear();
});

describe('console runtime — one refusal, one error toast (objectui#13340)', () => {
  it('a refused Confirm raises exactly one error toast, carrying the server`s sentence', async () => {
    await openCreateUser();
    fireEvent.click(screen.getByText('actionDialog.confirm'));

    expect(await screen.findByTestId('action-param-refusal')).toHaveTextContent(REFUSAL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Settle anything still in flight before counting.
    await act(async () => {});
    expect(errorToasts()).toEqual([REFUSAL]);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('each further refusal adds one toast, and cancelling afterwards adds none', async () => {
    const session = await openCreateUser();
    fireEvent.click(screen.getByText('actionDialog.confirm'));
    await waitFor(() => expect(errorToasts()).toHaveLength(1));

    fireEvent.click(screen.getByText('actionDialog.confirm'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(errorToasts()).toHaveLength(2));

    // Cancel ends the session with the refusal already reported: the runner
    // answers it without reporting it a second time.
    fireEvent.click(screen.getByText('actionDialog.cancel'));
    await waitFor(() => expect(session.result()).toBeDefined());
    await act(async () => {});
    expect(errorToasts()).toEqual([REFUSAL, REFUSAL]);
  });
});
