// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29690 — the pinyin dictionary is a lazy chunk, so the first
 * Chinese name a door sees arrives BEFORE it. Until it lands the door holds
 * back its "not derived" line and keeps Create off with the identifier empty;
 * when it lands, a door whose identifier still follows the name fills it in
 * without another keystroke.
 *
 * This file never loads the dictionary up front: the case types first and
 * then waits for the chunk the door itself asked for, so the module-wide
 * state is "not loaded" when it starts. One door per file for that reason;
 * the generic create form's case is `createDerive.romanizerLands-29690`.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CreateItemDialog } from '../studio-design/CreateItemDialog';
import { romanizerPending } from './romanizeHan';

afterEach(cleanup);

describe('a door re-derives when the pinyin dictionary lands (objectstack#29690)', () => {
  it('CreateItemDialog: empty and quiet while loading, then the pinyin identifier', async () => {
    render(
      <CreateItemDialog
        open
        onOpenChange={vi.fn()}
        title="New object"
        labelFieldLabel="Object name"
        idFieldLabel="Identifier"
        submitLabel="Create"
        locale="zh-CN"
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Object name'), { target: { value: '维修中心' } });
    // Not landed yet: no identifier, no "not derived" line, Create off.
    expect(romanizerPending('维修中心')).toBe(true);
    expect((screen.getByLabelText('Identifier') as HTMLInputElement).value).toBe('');
    expect(screen.queryByTestId('create-item-id-not-derived')).toBeNull();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    // Landed: filled, still no line, Create on.
    await waitFor(() => expect((screen.getByLabelText('Identifier') as HTMLInputElement).value).toBe('weixiu_zhongxin'), {
      timeout: 8000,
    });
    expect(screen.queryByTestId('create-item-id-not-derived')).toBeNull();
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  });
});
