/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27521 — the param dialog half of the Invitations screens.
 *
 * - Row 10: an email or url param is checked against the format rule the
 *   object form checks that field type with (`buildValidationRules`), and a
 *   malformed value is marked on its field before anything runs. The server
 *   used to be the only check, and its refusal showed twice (banner and toast)
 *   with the field unmarked.
 * - Row 8: a help text keeps its line breaks, so the role help reads one role
 *   per line; Change Role's description names the member from a list row.
 *
 * Rendered under a real English `I18nProvider`, so the messages asserted are
 * the ones a user reads.
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { ActionRunner, type ActionDef, type ActionParamDef } from '@object-ui/core';
// Module scope, per AGENTS.md 测试纪律: the dialog's widgets sit behind
// `React.lazy`, and this barrel statically re-exports them.
import '@object-ui/fields';
import { ActionParamDialog, paramFormatErrorKey, type ParamDialogState } from './ActionParamDialog';

afterEach(() => cleanup());

function openDialog(params: ActionParamDef[], extra: Partial<ParamDialogState> = {}) {
  const resolve = vi.fn();
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <ActionParamDialog state={{ open: true, params, resolve, ...extra }} onOpenChange={() => {}} />
    </I18nProvider>,
  );
  return resolve;
}

const EMAIL: ActionParamDef = { name: 'email', label: 'Email', type: 'email', required: true };
const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

describe('row 10 — a malformed email is marked on its field (objectstack#27521)', () => {
  it('blocks Confirm and shows the message under the field, which reads invalid', async () => {
    const run = vi.fn();
    const resolve = openDialog([EMAIL], { run });
    const input = await screen.findByLabelText(/Email/);
    fireEvent.change(input, { target: { value: 'not-an-email' } });
    confirm();
    expect(await screen.findByText('Please enter a valid email address')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(run).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    // One place says it: the field. The run's refusal banner is never drawn.
    expect(screen.queryByTestId('action-param-refusal')).toBeNull();
  });

  it('clears the mark on the next keystroke and confirms a well-formed address', async () => {
    const resolve = openDialog([EMAIL]);
    const input = await screen.findByLabelText(/Email/);
    fireEvent.change(input, { target: { value: 'ada@' } });
    confirm();
    await screen.findByText('Please enter a valid email address');
    fireEvent.change(input, { target: { value: 'ada@example.com' } });
    expect(screen.queryByText('Please enter a valid email address')).toBeNull();
    expect(input).toHaveAttribute('aria-invalid', 'false');
    confirm();
    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ email: 'ada@example.com' }));
  });

  it('an empty required email still reads as required, not as malformed', async () => {
    openDialog([EMAIL]);
    await screen.findByLabelText(/Email/);
    confirm();
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.queryByText('Please enter a valid email address')).toBeNull();
  });

  it('a url param is held to the url rule', async () => {
    const resolve = openDialog([{ name: 'site', label: 'Website', type: 'url' }]);
    const input = await screen.findByLabelText(/Website/);
    fireEvent.change(input, { target: { value: 'example.com' } });
    confirm();
    expect(await screen.findByText('Please enter a valid URL')).toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('CONTROL: a text param accepts the same string', async () => {
    const resolve = openDialog([{ name: 'note', label: 'Note', type: 'text', required: true }]);
    const input = await screen.findByLabelText(/Note/);
    fireEvent.change(input, { target: { value: 'not-an-email' } });
    confirm();
    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ note: 'not-an-email' }));
  });

  it('judges neither an empty optional value nor a carried-over one', () => {
    const email: ActionParamDef = { name: 'email', label: 'Email', type: 'email' };
    expect(paramFormatErrorKey(email, '')).toBeNull();
    expect(paramFormatErrorKey({ ...email, carryOver: true }, 'not-an-email')).toBeNull();
    expect(paramFormatErrorKey(email, 'not-an-email')).toBe('validation.email');
  });
});

describe('row 8 — the role help and Change Role (objectstack#27521)', () => {
  const HELP = 'Owner: full control.\nMember: works in the apps.';

  it('keeps the help text\'s line breaks under the control', async () => {
    openDialog([{ name: 'role', label: 'Role', type: 'text', helpText: HELP }]);
    const help = await screen.findByText((_text, node) => node?.tagName === 'P' && node.textContent === HELP);
    expect(help).toHaveClass('whitespace-pre-line');
  });

  it('keeps them under a carried-over value too', async () => {
    openDialog([{ name: 'role', label: 'Role', type: 'text', helpText: HELP, carryOver: true, defaultValue: 'member' }]);
    const help = await screen.findByText((_text, node) => node?.tagName === 'P' && node.textContent === HELP);
    expect(help).toHaveClass('whitespace-pre-line');
  });

  /**
   * `sys_member.update_member_role`'s description, as declared in
   * `@objectstack/platform-objects` (not a dependency of this tree; its own
   * pin, `invitation-screens-copy.test.ts`, holds the declaration to it).
   */
  const CHANGE_ROLE: ActionDef = {
    name: 'update_member_role',
    label: 'Change Role',
    description: "Choose the new organization role for ${record.user_id?.name ?? 'this member'}.",
    actionParams: [{ name: 'role', label: 'Role', type: 'select', required: true }],
  };

  async function descriptionFor(row: Record<string, unknown>): Promise<string> {
    const runner = new ActionRunner({ objectName: 'sys_member' });
    let read = '';
    runner.setParamCollectionHandler(async (_params, action, interpolate) => {
      read = interpolate!(String(action?.description));
      return null;
    });
    await runner.execute({ ...CHANGE_ROLE, params: { _rowRecord: row } });
    return read;
  }

  it('names the member from a list row that expands the user', async () => {
    const row = { id: 'mem_1', role: 'member', user_id: { id: 'usr_1', name: 'Ada Lovelace' } };
    expect(await descriptionFor(row)).toBe('Choose the new organization role for Ada Lovelace.');
  });

  it('reads "this member" for a row that does not carry the user', async () => {
    expect(await descriptionFor({ id: 'mem_1', role: 'member' })).toBe('Choose the new organization role for this member.');
  });
});
