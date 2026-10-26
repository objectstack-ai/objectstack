// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13253 — the permission matrix registers its unsaved edits with the
 * shell's seam, so a shell departure (a header menu, the palette, the inbox,
 * the AI entry) asks before dropping them.
 *
 * The matrix kept its own `beforeunload` guard and reported dirty to its host,
 * but did not register with the seam, so a shell menu that navigates from a
 * button left it with no question. It now registers its dirty state with the
 * question its hosts already ask (`engine.edit.unsavedLeaveConfirm`). Every
 * shell menu departure goes through `confirmUnsavedLeave` (pinned for the
 * header in `AppHeader.unsavedEditsLeave-13231.test.tsx`), so that call stands
 * for the departure here, as in `ResourceEditPage.leaveGuard-13231.test.tsx`.
 *
 * The real `PermissionMatrixEditPage` over the client double
 * `PermissionMatrixEditor.basics.test.tsx` uses.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

function makeClient(set: Record<string, unknown>) {
  return {
    layered: async () => ({ effective: set, code: null, overlay: null, overlayScope: null }),
    getDraft: async () => null,
    list: async (type: string) => (type === 'object' ? [{ item: { name: 'a_account' } }] : []),
    get: async (type: string) => (type === 'object' ? { fields: [] } : null),
    save: async (_t: string, _n: string, payload: Record<string, unknown>) => payload,
  } as any;
}

let clientImpl: any;

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => clientImpl,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
  }),
}));
vi.mock('./AssignedUsersSection', () => ({ AssignedUsersSection: () => null }));
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  CapabilityMultiSelectField: () => <div data-testid="cap-picker" />,
  parseCapabilityNames: (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : []),
}));
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';
import { t } from './i18n';
import { confirmUnsavedLeave } from '../../chrome/unsavedEdits';

/** The question the matrix's hosts ask before its edits are dropped. */
const QUESTION = t('engine.edit.unsavedLeaveConfirm', 'en-US');

const confirmSpy = vi.fn((_message?: string) => false);

beforeEach(() => {
  confirmSpy.mockReset();
  confirmSpy.mockReturnValue(false);
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: confirmSpy });
});
afterEach(cleanup);

async function openSet() {
  clientImpl = makeClient({ name: 'sales_perms', label: 'Sales', isProfile: false, objects: {}, fields: {} });
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name="sales_perms" />
    </MemoryRouter>,
  );
  await screen.findByText('Sales');
}

/** Rename the set: the identity strip expands, and the label input takes the edit. */
function editLabel() {
  fireEvent.click(screen.getByRole('button', { name: /Sales/ }));
  fireEvent.change(screen.getByDisplayValue('Sales'), { target: { value: 'Sales, edited' } });
}

describe('PermissionMatrixEditPage registers its unsaved edits with the shell seam (objectui#13253)', () => {
  it('a dirty matrix: a shell departure asks the hosts\' question, and Cancel never leaves', async () => {
    await openSet();
    editLabel();

    const go = vi.fn();
    confirmUnsavedLeave(go);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(QUESTION);
    expect(go).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Sales, edited')).toBeInTheDocument();

    confirmSpy.mockReturnValue(true);
    confirmUnsavedLeave(go);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: a clean matrix registers nothing — a shell departure goes at once', async () => {
    await openSet();

    const go = vi.fn();
    confirmUnsavedLeave(go);
    expect(go).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('CONTROL: once the dirty matrix has unmounted, nothing is registered', async () => {
    await openSet();
    editLabel();
    cleanup();

    const go = vi.fn();
    confirmUnsavedLeave(go);
    expect(go).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
