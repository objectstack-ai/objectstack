// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CelTestRunDialog } from './CelTestRunDialog';

afterEach(cleanup);

const t = (k: string) => k;
const noop = () => {};

function open(props: Partial<React.ComponentProps<typeof CelTestRunDialog>>) {
  return render(
    <CelTestRunDialog
      open
      onOpenChange={noop}
      objectName="account"
      fieldNames={['organization_id']}
      t={t}
      {...props}
    />,
  );
}

const runButton = () => screen.getByRole('button', { name: /perm\.cel\.test\.run/ });

describe('CelTestRunDialog (real engine)', () => {
  it('reports ALLOW when the predicate is satisfied by the sample', async () => {
    const user = userEvent.setup();
    open({ using: '"admin" in current_user.positions' });
    await user.click(runButton());
    expect(await screen.findByText('perm.cel.test.allow', {}, { timeout: 3000 })).toBeTruthy();
  });

  it('reports DENY when the predicate is not satisfied', async () => {
    const user = userEvent.setup();
    open({ using: '"nope" in current_user.positions' });
    await user.click(runButton());
    expect(await screen.findByText('perm.cel.test.deny', {}, { timeout: 3000 })).toBeTruthy();
  });

  it('surfaces an evaluation error (self-correcting message) for a missing key', async () => {
    const user = userEvent.setup();
    open({ using: 'current_user.does_not_exist == 1' });
    await user.click(runButton());
    const banner = await screen.findByRole('status', {}, { timeout: 3000 });
    expect(within(banner).getByText('perm.cel.test.error')).toBeTruthy();
    // The engine's self-correcting message names the offending key.
    expect(within(banner).getByText(/does_not_exist/)).toBeTruthy();
  });

  it('flags a non-boolean result as an authoring smell', async () => {
    const user = userEvent.setup();
    open({ using: 'current_user.id' });
    await user.click(runButton());
    expect(await screen.findByText('perm.cel.test.nonBool', {}, { timeout: 3000 })).toBeTruthy();
  });

  it('rejects invalid sample JSON before evaluating', async () => {
    const user = userEvent.setup();
    open({ using: 'true' });
    const userBox = screen.getByLabelText(/perm\.cel\.test\.user/) as HTMLTextAreaElement;
    await user.clear(userBox);
    await user.type(userBox, '{{not json'); // `{{` => a literal `{` in userEvent
    await user.click(runButton());
    // A JSON error is surfaced (label text now appears twice: field label + error),
    // and evaluation never runs — no outcome banner of any kind.
    await waitFor(() => expect(screen.getAllByText(/perm\.cel\.test\.user/).length).toBeGreaterThan(1), {
      timeout: 3000,
    });
    expect(screen.queryByText('perm.cel.test.allow')).toBeNull();
    expect(screen.queryByText('perm.cel.test.error')).toBeNull();
  });

  it('disables the run button when the policy has no predicate', () => {
    open({ using: '', check: '' });
    expect(screen.getByText('perm.cel.test.noPredicate')).toBeTruthy();
    expect(runButton()).toBeDisabled();
  });
});
