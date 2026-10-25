/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineEditProvider, useInlineEdit } from '@object-ui/react';

/**
 * `InlineEditContext` (objectui#2407 P1) — the record-level inline-edit session
 * lifted out of DetailView so the details body and (P2) the highlights strip
 * share ONE draft. These tests pin the pure-UI-state contract: enter/exit,
 * draft staging, and the `canEdit` gate.
 */

function Probe() {
  const inline = useInlineEdit();
  if (!inline) return <div data-testid="state">no-provider</div>;
  return (
    <div>
      <span data-testid="editing">{String(inline.editing)}</span>
      <span data-testid="locked">{String(inline.locked)}</span>
      <span data-testid="approvalPending">{String(inline.approvalPending)}</span>
      <span data-testid="lockedReason">{inline.lockedReason ?? ''}</span>
      <span data-testid="draft">{JSON.stringify(inline.draft)}</span>
      <span data-testid="focus">{inline.autoFocusField ?? ''}</span>
      <button onClick={() => inline.enter('status')}>enter</button>
      <button onClick={() => inline.setField('status', 'active')}>set</button>
      <button onClick={() => inline.cancel()}>cancel</button>
    </div>
  );
}

describe('InlineEditContext', () => {
  it('returns null outside a provider (bare DetailView → read-only)', () => {
    render(<Probe />);
    expect(screen.getByTestId('state').textContent).toBe('no-provider');
  });

  it('enter() flips into edit mode and records the auto-focus field', () => {
    render(
      <InlineEditProvider canEdit>
        <Probe />
      </InlineEditProvider>,
    );
    expect(screen.getByTestId('editing').textContent).toBe('false');
    fireEvent.click(screen.getByText('enter'));
    expect(screen.getByTestId('editing').textContent).toBe('true');
    expect(screen.getByTestId('focus').textContent).toBe('status');
  });

  it('setField() stages ONLY the edited keys into the draft', () => {
    render(
      <InlineEditProvider canEdit>
        <Probe />
      </InlineEditProvider>,
    );
    fireEvent.click(screen.getByText('enter'));
    fireEvent.click(screen.getByText('set'));
    expect(screen.getByTestId('draft').textContent).toBe('{"status":"active"}');
  });

  it('cancel() exits edit mode and discards the draft', () => {
    render(
      <InlineEditProvider canEdit>
        <Probe />
      </InlineEditProvider>,
    );
    fireEvent.click(screen.getByText('enter'));
    fireEvent.click(screen.getByText('set'));
    fireEvent.click(screen.getByText('cancel'));
    expect(screen.getByTestId('editing').textContent).toBe('false');
    expect(screen.getByTestId('draft').textContent).toBe('{}');
  });

  it('gates enter() behind canEdit — a non-editable record never enters edit', () => {
    render(
      <InlineEditProvider canEdit={false}>
        <Probe />
      </InlineEditProvider>,
    );
    fireEvent.click(screen.getByText('enter'));
    expect(screen.getByTestId('editing').textContent).toBe('false');
  });

  it('defaults locked to false and lockedReason to undefined (objectui#2618)', () => {
    render(
      <InlineEditProvider canEdit>
        <Probe />
      </InlineEditProvider>,
    );
    expect(screen.getByTestId('locked').textContent).toBe('false');
    expect(screen.getByTestId('lockedReason').textContent).toBe('');
  });

  it('surfaces the host-supplied approval lock + reason on the context (objectui#2618)', () => {
    render(
      <InlineEditProvider canEdit={false} locked lockedReason="Pending approval">
        <Probe />
      </InlineEditProvider>,
    );
    expect(screen.getByTestId('locked').textContent).toBe('true');
    expect(screen.getByTestId('lockedReason').textContent).toBe('Pending approval');
  });

  // ── approvalPending vs locked (objectui#2902) ──────────────────
  //
  // An approval node's `lockRecord: false` means the server keeps accepting
  // writes while the node waits. The context has to carry both facts so the
  // band can say "in approval" without claiming a lock, and so `canEdit` stays
  // free to allow the edit the server would accept.

  it('carries approvalPending independently of locked', () => {
    render(
      <InlineEditProvider canEdit approvalPending locked={false}>
        <Probe />
      </InlineEditProvider>,
    );
    expect(screen.getByTestId('approvalPending').textContent).toBe('true');
    expect(screen.getByTestId('locked').textContent).toBe('false');
  });

  it('defaults approvalPending to locked, so pre-#2902 hosts are unchanged', () => {
    render(
      <InlineEditProvider canEdit={false} locked>
        <Probe />
      </InlineEditProvider>,
    );
    expect(screen.getByTestId('approvalPending').textContent).toBe('true');
  });

  it('leaves enter() usable while an unlocked approval is pending', () => {
    // The whole point of `lockRecord: false`: the approver edits in place.
    render(
      <InlineEditProvider canEdit approvalPending locked={false}>
        <Probe />
      </InlineEditProvider>,
    );
    fireEvent.click(screen.getByText('enter'));
    expect(screen.getByTestId('editing').textContent).toBe('true');
  });
});
