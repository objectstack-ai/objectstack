/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ActionParamDialog — a `password` / `secret` action param renders a masked
 * input with a show/hide toggle and an `autocomplete` token (objectui#13295).
 *
 * The params travel the real chain: `paramToField` → `resolveParamWidgetType`
 * (which folds `secret` onto `password`) → the lazy `@object-ui/fields`
 * `PasswordField`. The token is `current-password` for a param whose name reads
 * as the user's existing password and `new-password` otherwise. A `text` param
 * is the control: it keeps a plain input with no token.
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ActionParamDef } from '@object-ui/core';
import { ActionParamDialog } from './ActionParamDialog';

function openDialog(params: ActionParamDef[]) {
  render(
    <ActionParamDialog state={{ open: true, params, resolve: vi.fn() }} onOpenChange={() => {}} />,
  );
}

/** The toggle is the button rendered beside the input, inside the widget's wrapper. */
function toggleOf(input: HTMLElement): HTMLElement {
  const button = input.parentElement?.querySelector('button');
  if (!button) throw new Error('no show/hide toggle beside the password input');
  return button;
}

describe('ActionParamDialog — password params are masked, toggleable and carry autocomplete (objectui#13295)', () => {
  it('renders a change-password pair as masked inputs with current- and new-password tokens', async () => {
    openDialog([
      { name: 'current_password', label: 'Current password', type: 'password' },
      { name: 'new_password', label: 'New password', type: 'password' },
    ]);

    const current = await screen.findByLabelText('Current password');
    const next = await screen.findByLabelText('New password');
    expect(current).toHaveAttribute('type', 'password');
    expect(current).toHaveAttribute('autocomplete', 'current-password');
    expect(next).toHaveAttribute('type', 'password');
    expect(next).toHaveAttribute('autocomplete', 'new-password');
  });

  it('reads camelCase and `old` names as the current password', async () => {
    openDialog([{ name: 'oldPassword', label: 'Old password', type: 'password' }]);
    expect(await screen.findByLabelText('Old password')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('the toggle reveals the value and masks it again', async () => {
    openDialog([{ name: 'current_password', label: 'Current password', type: 'password' }]);

    const input = await screen.findByLabelText('Current password');
    fireEvent.click(toggleOf(input));
    expect(input).toHaveAttribute('type', 'text');
    fireEvent.click(toggleOf(input));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('a `secret` param renders the same masked input with new-password', async () => {
    openDialog([{ name: 'api_token', label: 'API token', type: 'secret' }]);

    const input = await screen.findByLabelText('API token');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'new-password');
  });

  it('CONTROL: a `text` param is unchanged — a plain input with no autocomplete token', async () => {
    openDialog([{ name: 'note', label: 'Note', type: 'text' }]);

    const input = await screen.findByLabelText('Note');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).not.toHaveAttribute('autocomplete');
  });
});
