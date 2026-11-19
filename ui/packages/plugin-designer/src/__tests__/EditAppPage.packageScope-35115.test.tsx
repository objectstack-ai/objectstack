// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35115 — the app wizard saves a packaged app at its package.
 *
 * `EditAppPage` reads the stored app at the package the served app came from
 * (`getAuthoredItem('app', name, { packageId })`, objectstack#35054), but its
 * save called `client.meta.saveItem('app', name, body)` with no package, so
 * the write went to the package-less address (no `?package=`) while the row it
 * edited belongs to a package. The save now names the same package
 * (`{ packageId }`, sent as `?package=`); a package-less app, and an app
 * served with the server's `sys_metadata` sentinel, keep the package-less
 * address for both the read and the save.
 *
 * Direction, written before the run: with the save left package-less (the
 * unmodified tree) the packaged case goes RED on the save's options while the
 * package-less case stays GREEN.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const saveItem = vi.fn().mockResolvedValue({});
const getAuthoredItem = vi.fn();
const apps: Record<string, unknown>[] = [];

vi.mock('react-router-dom', () => ({
  useParams: () => ({ editAppName: 'qa_scope_app' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAdapter: () => ({ getClient: () => ({ meta: { saveItem } }), getAuthoredItem }),
    useMetadata: () => ({ apps, objects: [], refresh: () => Promise.resolve() }),
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { EditAppPage } from '../pages/EditAppPage';

/** The app as its author stored it. */
const STORED = { name: 'qa_scope_app', label: 'QA Scope App', icon: 'sparkles', navigation: [] };

const next = () => fireEvent.click(screen.getByTestId('wizard-next'));

/** Open the wizard on the served app, edit the description and complete it. */
async function editAndSave(served: Record<string, unknown>) {
  apps.push(served);
  getAuthoredItem.mockResolvedValue(STORED);
  render(<EditAppPage />);
  await screen.findByTestId('edit-app-page');
  fireEvent.change(screen.getByTestId('app-description-input'), { target: { value: 'Edited description' } });
  next(); // → objects
  next(); // → navigation
  next(); // → branding
  fireEvent.click(screen.getByTestId('wizard-complete'));
  await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
  return saveItem.mock.calls[0] as unknown[];
}

beforeEach(() => {
  saveItem.mockClear();
  getAuthoredItem.mockReset();
  apps.length = 0;
});
afterEach(() => cleanup());

describe('EditAppPage saves the app at its package (objectstack#35115)', () => {
  it('a packaged app is read and saved at its package', async () => {
    const call = await editAndSave({ ...STORED, _packageId: 'com.qa.scope' });
    expect(getAuthoredItem).toHaveBeenCalledWith('app', 'qa_scope_app', { packageId: 'com.qa.scope' });
    expect(call[3]).toEqual({ packageId: 'com.qa.scope' });
    // Control: the save is the app, with the edit.
    expect(call.slice(0, 2)).toEqual(['app', 'qa_scope_app']);
    expect((call[2] as Record<string, unknown>).description).toBe('Edited description');
  });

  it('a package-less app is read and saved with no package', async () => {
    const call = await editAndSave({ ...STORED });
    expect(getAuthoredItem).toHaveBeenCalledWith('app', 'qa_scope_app', {});
    expect(call).toHaveLength(3);
    expect(call.slice(0, 2)).toEqual(['app', 'qa_scope_app']);
  });

  it('an app served with the sys_metadata sentinel names no package on the read or the save', async () => {
    const call = await editAndSave({ ...STORED, _packageId: 'sys_metadata' });
    expect(getAuthoredItem).toHaveBeenCalledWith('app', 'qa_scope_app', {});
    expect(call).toHaveLength(3);
  });
});
