// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DeclaredActionsBar — the `ask_ai` action on a record (objectstack#37142,
 * ADR-0160 D7).
 *
 * The bar mounts its own `<ActionProvider>` from the console runtime, and the
 * runtime hands that provider `onAskAi` only where the console can serve the
 * click (`useAskAiHandler`, pinned in its own suite). What is pinned here is
 * the surface:
 *
 *  1. No `onAskAi` → the `ask_ai` action is ABSENT (not disabled), while a
 *     neighbouring action of another type is drawn.
 *  2. With `onAskAi` → it is drawn, and a click hands the record the bar
 *     shows to the assistant, once, and dispatches nothing else.
 *
 * As in the capability suite next door, `@object-ui/react` is not doubled: the
 * gate must read the provider this bar mounts itself.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const harness = vi.hoisted(() => ({
  onAskAi: undefined as undefined | ((focus: { object: string; id: string }) => void),
  script: vi.fn(async () => ({ success: true })),
}));

vi.mock('../../hooks/useConsoleActionRuntime', () => ({
  useConsoleActionRuntime: () => ({
    actionProviderProps: {
      context: { objectName: 'account', user: { id: 'u_1' } },
      handlers: { script: harness.script },
      ...(harness.onAskAi ? { onAskAi: harness.onAskAi } : {}),
    },
    dialogs: null,
  }),
}));

vi.mock('../../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../../utils/getIcon', () => ({ getIcon: () => () => null }));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectLabel: () => ({
    actionLabel: (_o: unknown, _n: unknown, fallback: string) => fallback,
    actionConfirm: (_o: unknown, _n: unknown, fallback?: string) => fallback,
    actionSuccess: (_o: unknown, _n: unknown, fallback?: string) => fallback,
  }),
  useObjectTranslation: () => ({
    t: (key: string, options?: any) => String(options?.defaultValue ?? key),
    language: 'en',
  }),
  pickLocalized: (value: unknown) => (typeof value === 'string' ? value : ''),
}));

vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Button: ({ children, onClick, ...props }: any) => (
      <button onClick={onClick} {...props}>{children}</button>
    ),
    Separator: () => <hr />,
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
  };
});

import { DeclaredActionsBar } from '../DeclaredActionsBar';

const ASK = { name: 'ask_about_account', type: 'ask_ai', label: 'Ask AI', locations: ['record_section'] };
const CLOSE = { name: 'close_account', type: 'script', target: 'close_account', label: 'Close', locations: ['record_section'] };
const RECORD = { id: 'acc_1', name: 'Acme' };

function renderBar() {
  return render(
    <DeclaredActionsBar
      objectName="account"
      record={RECORD}
      location="record_section"
      actions={[ASK, CLOSE] as never}
    />,
  );
}

beforeEach(() => {
  harness.onAskAi = undefined;
  harness.script.mockClear();
});

describe('DeclaredActionsBar — ask_ai (ADR-0160 D7)', () => {
  it('leaves the action out where the console has no in-app assistant', () => {
    renderBar();
    expect(screen.queryByTestId('declared-action-ask_about_account')).toBeNull();
    // Lit control: the bar rendered, and the neighbour is drawn.
    expect(screen.getByTestId('declared-action-close_account')).toBeInTheDocument();
  });

  it('draws it with an assistant, and a click focuses the assistant on the record and sends nothing', async () => {
    const onAskAi = vi.fn();
    harness.onAskAi = onAskAi;
    renderBar();
    const button = screen.getByTestId('declared-action-ask_about_account');
    fireEvent.click(button);
    await waitFor(() => expect(onAskAi).toHaveBeenCalledTimes(1));
    expect(onAskAi).toHaveBeenCalledWith({ object: 'account', id: 'acc_1' });
    expect(harness.script).not.toHaveBeenCalled();
  });
});
