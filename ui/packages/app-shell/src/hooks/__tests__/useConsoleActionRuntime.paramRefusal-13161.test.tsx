/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The whole seam, end to end (objectui#13161): a real `ActionRunner` with the
 * console runtime's own param handler and the real `ActionParamDialog`.
 *
 * The dialog-level suite (`ActionParamDialog.refusalKeepsInput-13161`) hands
 * the dialog a `run` by hand, and the runner suite
 * (`ActionRunner.paramRun-13161`) drives `run` from a fake handler. Neither
 * proves the console wiring between them: that the runtime's handler forwards
 * the runner's `run` into the dialog's state. This one does, through the
 * public surfaces only — `runner.execute`, the rendered inputs and buttons.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { ActionRunner, type ActionResult } from '@object-ui/core';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'User', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
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
  return { toast: fn };
});

import { useConsoleActionRuntime } from '../useConsoleActionRuntime';

const TAKEN = 'User already exists. Use another email.';

function Harness({ onReady }: { onReady: (fn: any) => void }) {
  const runtime = useConsoleActionRuntime({ dataSource: {}, objects: [] });
  const ready = React.useRef(false);
  if (!ready.current) {
    ready.current = true;
    onReady(runtime.paramCollectionHandler);
  }
  return <>{runtime.dialogs}</>;
}

describe('console runtime — a refused param run keeps the dialog and its input (objectui#13161)', () => {
  it('runner → console handler → dialog: the refusal shows beside the typed value, and the fixed retry closes it', async () => {
    let collect: any;
    render(<Harness onReady={(fn) => { collect = fn; }} />);

    const runner = new ActionRunner({});
    runner.setParamCollectionHandler(collect);
    const toast = vi.fn();
    runner.setToastHandler(toast);
    const sent: Array<Record<string, any>> = [];
    runner.registerHandler('api', async (action: any): Promise<ActionResult> => {
      sent.push({ ...action.params });
      return action.params.email === 'taken@example.com'
        ? { success: false, error: TAKEN }
        : { success: true };
    });

    let result: ActionResult | undefined;
    await act(async () => {
      void runner
        .execute({
          type: 'api',
          name: 'create_user',
          label: 'Create User',
          params: [{ name: 'email', label: 'Email', type: 'text' }],
        } as any)
        .then((r) => { result = r; });
    });

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'taken@example.com' } });
    fireEvent.click(screen.getByText('actionDialog.confirm'));

    // The box leads with the first sentence; the whole refusal is behind
    // "More" (objectui#13332).
    const alert = await screen.findByTestId('action-param-refusal');
    expect(alert).toHaveTextContent('User already exists.');
    fireEvent.click(screen.getByTestId('refusal-more'));
    expect(screen.getByTestId('refusal-detail').textContent).toBe(TAKEN);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('taken@example.com');
    expect(sent).toEqual([{ email: 'taken@example.com' }]);
    // The runner still toasts the refusal, as it did for the lone run.
    expect(toast).toHaveBeenCalledWith(TAKEN, expect.objectContaining({ type: 'error' }));
    expect(result).toBeUndefined();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.click(screen.getByText('actionDialog.confirm'));

    await waitFor(() => expect(result).toEqual({ success: true }));
    expect(sent).toEqual([{ email: 'taken@example.com' }, { email: 'ada@example.com' }]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toast).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ type: 'success' }));
  });
});
