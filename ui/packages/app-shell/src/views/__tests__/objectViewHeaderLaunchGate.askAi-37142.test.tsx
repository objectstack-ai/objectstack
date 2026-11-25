// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37142 (ADR-0160 D7) — a list header holds no record until the
 * user selects one. An `ask_ai` action there is drawn only while exactly one
 * row is selected; with none or several it is ABSENT, not greyed out with a
 * reason as other refused launches are.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import '@object-ui/components';
import { ActionProvider, useAction } from '@object-ui/react';
import type { ActionRunner } from '@object-ui/core';
import { ListHeaderActionBar } from '../objectViewHeaderLaunchGate';

afterEach(() => cleanup());

const ASK = { name: 'ask_about_account', label: 'Ask AI', type: 'ask_ai' };
const CLOSE = { name: 'close_selected', label: 'Close', type: 'script', target: 'close' };

let runnerRef: ActionRunner | undefined;
function GrabRunner() {
  runnerRef = useAction().runner;
  return null;
}

function mount(selectedRecords: Array<{ id: string }>) {
  render(
    <ActionProvider context={{ objectName: 'account', selectedRecords, selectionAvailable: true }} onAskAi={vi.fn()}>
      <GrabRunner />
      <ListHeaderActionBar schema={{ type: 'action:bar', actions: [ASK, CLOSE] } as never} />
    </ActionProvider>,
  );
}

describe('ListHeaderActionBar — ask_ai needs exactly one selected row', () => {
  it('is absent with no row selected, while other actions stay', () => {
    mount([]);
    expect(screen.queryByRole('button', { name: /Ask AI/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Close/ })).toBeInTheDocument();
  });

  it('is absent with several rows selected', () => {
    mount([{ id: 'a' }, { id: 'b' }]);
    expect(screen.queryByRole('button', { name: /Ask AI/ })).toBeNull();
  });

  it('is drawn, enabled, with one row selected, and leaves again when a second is selected', () => {
    mount([{ id: 'a' }]);
    const button = screen.getByRole('button', { name: /Ask AI/ });
    expect(button).toBeEnabled();
    act(() => runnerRef!.updateContext({ selectedRecords: [{ id: 'a' }, { id: 'b' }] }));
    expect(screen.queryByRole('button', { name: /Ask AI/ })).toBeNull();
  });
});
