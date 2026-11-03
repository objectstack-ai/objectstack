// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29690 — when the pinyin dictionary chunk cannot be fetched
 * (offline, a stale deploy), a Chinese display name falls back to what every
 * door did before: no identifier, the door's "not derived" line, and the
 * identifier typed by hand. Nothing waits forever and nothing is invented.
 *
 * The chunk is `pinyin-pro`, imported dynamically by `romanizeHan`; mocking it
 * with a factory that throws makes that import reject, as a failed chunk fetch
 * does in the Console.
 */

import '@testing-library/jest-dom/vitest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('pinyin-pro', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

import { loadHanRomanizer, romanizeHan, romanizerPending } from './romanizeHan';
import { CreateItemDialog } from '../studio-design/CreateItemDialog';
import { t } from './i18n';

const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
afterAll(() => warn.mockRestore());

describe('romanizeHan when the dictionary chunk fails to load (objectstack#29690)', () => {
  it('settles: nothing pending, the text unchanged, and the failure said once', async () => {
    await expect(loadHanRomanizer()).resolves.toBeUndefined();
    expect(romanizerPending('维修中心')).toBe(false);
    expect(romanizeHan('维修中心')).toBe('维修中心');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a create door falls back to its "not derived" line and the hand-typed identifier', async () => {
    const onSubmit = vi.fn();
    render(
      <CreateItemDialog
        open
        onOpenChange={vi.fn()}
        title="New object"
        labelFieldLabel="Object name"
        idFieldLabel="Identifier"
        submitLabel="Create"
        locale="en-US"
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText('Object name'), { target: { value: '维修中心' } });
    const hint = await waitFor(() => {
      const el = screen.getByTestId('create-item-id-not-derived');
      expect(el).toHaveTextContent(t('engine.studio.createItem.notDerived', 'en-US'));
      return el;
    });
    expect(hint).toBeInTheDocument();
    expect((screen.getByLabelText('Identifier') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Identifier'), { target: { value: 'repair_center' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit).toHaveBeenCalledWith({ label: '维修中心', name: 'repair_center' });
    cleanup();
  });
});
