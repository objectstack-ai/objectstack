/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27521 row 23 — where focus goes in the console's action dialogs.
 *
 * - Opening: the param dialog opens on its first editable param, not on the
 *   footer's Cancel (the widgets are lazy, so at mount Cancel was the first
 *   tabbable element). A dialog of carried-over values only opens on itself.
 * - Closing: the param, confirm and result dialogs give focus back to the
 *   control that opened them (`useActionDialogReturnFocus`): an action button
 *   that is disabled while its action runs, a row menu's trigger, and the same
 *   opener after a param dialog hands over to a result dialog. Before, focus
 *   fell to `body` in each case.
 *
 * The confirm dialog case is a non-invitation action (a record delete), since
 * the three dialogs are shared by every declared action.
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@object-ui/components';
import type { ActionParamDef } from '@object-ui/core';
// Module scope, per AGENTS.md 测试纪律: the dialog's widgets sit behind
// `React.lazy`, and this barrel statically re-exports them.
import '@object-ui/fields';
import { ActionParamDialog } from './ActionParamDialog';
import { ActionConfirmDialog } from './ActionConfirmDialog';
import { ActionResultDialog } from './ActionResultDialog';

afterEach(() => cleanup());

const INVITE_PARAMS: ActionParamDef[] = [
  { name: 'email', label: 'Email', type: 'email', required: true },
  { name: 'role', label: 'Role', type: 'text', required: true },
];

/**
 * An action button the way the console's action bars draw one: disabled while
 * its action runs, which includes the time its dialog is open, and enabled
 * again a moment after the dialog closes, when the run settles.
 */
function InviteButtonWithDialog({ params = INVITE_PARAMS }: { params?: ActionParamDef[] }) {
  const [running, setRunning] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" disabled={running} onClick={() => { setRunning(true); setOpen(true); }}>
        Invite User
      </button>
      <ActionParamDialog
        state={{ open, title: 'Invite User', params, resolve: () => {} }}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTimeout(() => setRunning(false), 30);
        }}
      />
    </>
  );
}

describe('row 23 — the param dialog opens on its first field (objectstack#27521)', () => {
  it('focuses the first editable param, not Cancel', async () => {
    const user = userEvent.setup();
    render(<InviteButtonWithDialog />);
    await user.click(screen.getByRole('button', { name: 'Invite User' }));
    const email = await screen.findByLabelText(/Email/);
    await waitFor(() => expect(email).toHaveFocus());
    expect(screen.getByRole('button', { name: 'actionDialog.cancel' })).not.toHaveFocus();
  });

  it('a dialog of carried-over values opens on the dialog itself', async () => {
    const user = userEvent.setup();
    render(<InviteButtonWithDialog params={INVITE_PARAMS.map((p) => ({ ...p, carryOver: true, defaultValue: 'x' }))} />);
    await user.click(screen.getByRole('button', { name: 'Invite User' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toHaveFocus());
  });
});

describe('row 23 — closing returns focus to the opener (objectstack#27521)', () => {
  it('Escape returns to an action button that was disabled while its action ran', async () => {
    const user = userEvent.setup();
    render(<InviteButtonWithDialog />);
    const opener = screen.getByRole('button', { name: 'Invite User' });
    await user.click(opener);
    await waitFor(() => expect(screen.getByLabelText(/Email/)).toHaveFocus());
    expect(opener).toBeDisabled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('a user who moved focus meanwhile keeps it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <InviteButtonWithDialog />
        <input aria-label="Search" />
      </>,
    );
    const opener = screen.getByRole('button', { name: 'Invite User' });
    await user.click(opener);
    await waitFor(() => expect(screen.getByLabelText(/Email/)).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const search = screen.getByLabelText('Search');
    act(() => search.focus());
    await waitFor(() => expect(opener).toBeEnabled());
    expect(search).toHaveFocus();
  });

  it('a row menu item returns to the menu\'s trigger (a non-invitation action: Delete)', async () => {
    const user = userEvent.setup();
    function RowMenu() {
      const [confirm, setConfirm] = React.useState(false);
      return (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="Row actions">⋯</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => setConfirm(true)}>Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ActionConfirmDialog
            state={{ open: confirm, message: 'Delete this record?', resolve: () => {} }}
            onOpenChange={setConfirm}
          />
        </>
      );
    }
    render(<RowMenu />);
    const trigger = screen.getByRole('button', { name: 'Row actions' });
    act(() => trigger.focus());
    await user.keyboard('{Enter}');
    const item = await screen.findByRole('menuitem', { name: 'Delete' });
    await waitFor(() => expect(item).toHaveFocus());
    await user.keyboard('{Enter}');
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('a param dialog that hands over to a result dialog: Done returns to the first opener', async () => {
    const user = userEvent.setup();
    function InviteWithResult() {
      const [running, setRunning] = React.useState(false);
      const [step, setStep] = React.useState<'idle' | 'params' | 'result'>('idle');
      return (
        <>
          <button type="button" disabled={running} onClick={() => { setRunning(true); setStep('params'); }}>
            Invite User
          </button>
          <ActionParamDialog
            state={{
              open: step === 'params',
              title: 'Invite User',
              params: INVITE_PARAMS,
              // The run succeeds; the runner then shows the invitation link.
              run: async () => {
                setTimeout(() => setStep('result'), 0);
                return { success: true };
              },
            }}
            onOpenChange={(next) => { if (!next && step === 'params') setStep((s) => (s === 'params' ? 'idle' : s)); }}
          />
          <ActionResultDialog
            state={{ open: step === 'result', spec: { title: 'Invitation link', format: 'text' }, data: 'https://example.test/i/1' }}
            onAcknowledge={() => { setStep('idle'); setTimeout(() => setRunning(false), 30); }}
          />
        </>
      );
    }
    render(<InviteWithResult />);
    const opener = screen.getByRole('button', { name: 'Invite User' });
    await user.click(opener);
    await user.type(await screen.findByLabelText(/Email/), 'ada@example.com');
    await user.type(screen.getByLabelText(/Role/), 'member');
    await user.click(screen.getByRole('button', { name: 'actionDialog.confirm' }));
    await screen.findByText('Invitation link');
    await user.click(screen.getByRole('button', { name: 'actions.resultDialog.acknowledge' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('CONTROL: without an opener (focus on body at open), Radix\'s default stays', async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <ActionConfirmDialog state={{ open: true, message: 'Delete this record?' }} onOpenChange={onOpenChange} />,
    );
    await screen.findByRole('alertdialog');
    rerender(<ActionConfirmDialog state={{ open: false, message: 'Delete this record?' }} onOpenChange={onOpenChange} />);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement === document.body || document.activeElement === null).toBe(true);
  });
});
