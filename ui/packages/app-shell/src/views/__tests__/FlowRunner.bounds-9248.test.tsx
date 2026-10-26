// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9248 — the screen-flow dialog refuses an out-of-bound value on
 * Submit, naming the field, beside its `required` check; and a lookup field
 * resolves its picker through the data source the host hands the runner.
 *
 * The bound is objectstack#17306's `min` / `max` on a screen field. The engine
 * re-checks it when the run resumes, so the dialog's refusal is a courtesy that
 * must agree with that rule: inclusive bounds, and an empty optional field is
 * not refused. Each refusal leg is asserted as "no resume request left the
 * dialog", with the pass legs beside it asserting the request that did.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// Module scope, per AGENTS.md 测试纪律: the lookup leg reaches `LookupField`
// through a `React.lazy` factory inside `@object-ui/fields`.
import '@object-ui/fields';
import { FlowRunner, type ScreenFlowState } from '../FlowRunner';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

const BOUNDED: ScreenFlowState = {
  flowName: 'order_entry',
  runId: 'run-1',
  screen: {
    nodeId: 'collect',
    title: 'Order',
    fields: [{ name: 'qty', label: 'Quantity', type: 'number', min: 1, max: 10 }],
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const okResume = () =>
  vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ success: true, data: { success: true } }));

function setup(state: ScreenFlowState, authFetch: ReturnType<typeof okResume>, dataSource?: unknown) {
  const onComplete = vi.fn();
  render(
    <FlowRunner
      state={state}
      authFetch={authFetch}
      baseUrl=""
      onClose={vi.fn()}
      onComplete={onComplete}
      dataSource={dataSource}
    />,
  );
  return { onComplete };
}

/** The inputs the one resume request carried. */
function resumedInputs(authFetch: ReturnType<typeof okResume>): unknown {
  expect(authFetch).toHaveBeenCalledTimes(1);
  return JSON.parse(String(authFetch.mock.calls[0][1]?.body)).inputs;
}

beforeEach(() => {
  toasts.error.mockReset();
  toasts.success.mockReset();
});

describe('objectui#9248 — FlowRunner refuses an out-of-bound value on Submit', () => {
  it('the dialog input carries the declared bounds', () => {
    setup(BOUNDED, okResume());
    const input = screen.getByRole('spinbutton', { name: 'Quantity' });
    expect(input).toHaveAttribute('min', '1');
    expect(input).toHaveAttribute('max', '10');
  });

  it('11 under `max: 10` is refused, naming the field, and no resume is issued', async () => {
    const user = userEvent.setup();
    const authFetch = okResume();
    setup(BOUNDED, authFetch);

    await user.type(screen.getByRole('spinbutton', { name: 'Quantity' }), '11');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));
    // The named subject, not the sentence: the refusal says WHICH field.
    expect(String(toasts.error.mock.calls[0][0])).toContain('Quantity');
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('0 under `min: 1` is refused the same way', async () => {
    const user = userEvent.setup();
    const authFetch = okResume();
    setup(BOUNDED, authFetch);

    await user.type(screen.getByRole('spinbutton', { name: 'Quantity' }), '0');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));
    expect(String(toasts.error.mock.calls[0][0])).toContain('Quantity');
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('10 — the bound itself — passes and resumes with it', async () => {
    const user = userEvent.setup();
    const authFetch = okResume();
    const { onComplete } = setup(BOUNDED, authFetch);

    await user.type(screen.getByRole('spinbutton', { name: 'Quantity' }), '10');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(resumedInputs(authFetch)).toEqual({ qty: 10 });
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('an empty optional bounded field is not refused', async () => {
    const user = userEvent.setup();
    const authFetch = okResume();
    const { onComplete } = setup(BOUNDED, authFetch);

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(resumedInputs(authFetch)).toEqual({});
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('CONTROL — the same field without the keys resumes with 11', async () => {
    const user = userEvent.setup();
    const authFetch = okResume();
    const { onComplete } = setup(
      { ...BOUNDED, screen: { ...BOUNDED.screen, fields: [{ name: 'qty', label: 'Quantity', type: 'number' }] } },
      authFetch,
    );

    await user.type(screen.getByRole('spinbutton', { name: 'Quantity' }), '11');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(resumedInputs(authFetch)).toEqual({ qty: 11 });
    expect(toasts.error).not.toHaveBeenCalled();
  });
});

describe('objectui#9248 — the dialog\'s lookup picker reads the host\'s data source', () => {
  it('lists `account` records through the `dataSource` the host hands the runner', async () => {
    const queries: string[] = [];
    const ds = {
      find: vi.fn(async (objectName: string) => {
        queries.push(objectName);
        return { data: [{ id: 'acc-1', name: 'Northwind Traders' }], total: 1, hasMore: false, pageSize: 50 };
      }),
      findOne: vi.fn(async () => null),
      getObjectSchema: async (name: string) => ({ name, fields: { id: { type: 'text' }, name: { type: 'text' } } }),
    };
    setup(
      {
        flowName: 'case_resolution',
        runId: 'run-2',
        screen: {
          nodeId: 'resolve',
          title: 'Resolve',
          fields: [{ name: 'account', label: 'Account', type: 'lookup', reference: 'account' }],
        },
      },
      okResume(),
      ds,
    );

    fireEvent.click(await screen.findByTestId('lookup-trigger-account'));
    await waitFor(() => expect(screen.getByText('Northwind Traders')).toBeInTheDocument());
    expect(queries).toContain('account');
  });
});
