// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#25866 — a field permission entry may carry a row condition on
 * its EDIT vote (`when`, the CEL of `rowLevelSecurity[].using`). The matrix
 * offers the key beside the Read / Edit boxes and shows an authored one, and
 * it never authors the shape the spec refuses (`when` beside
 * `readable: false`): Read off clears the condition, the bulk shortcuts keep
 * it (Read-only all / Write all), blank text removes the key, and a condition the publish gate would
 * refuse holds the save the way an RLS clause does.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

interface FieldEntry {
  readable?: boolean;
  editable?: boolean;
  when?: string;
}
interface SavedSet {
  fields?: Record<string, FieldEntry>;
}

/** The slice of the metadata client the editor calls here. */
type FakeClient = Record<string, (...args: never[]) => Promise<unknown>>;

let clientImpl: FakeClient;
let saved: SavedSet[] = [];

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => clientImpl,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
  }),
}));

vi.mock('./AssignedUsersSection', () => ({ AssignedUsersSection: () => null }));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

afterEach(() => {
  cleanup();
  saved = [];
});

// Eight fields: the same wide object the bulk cases use.
const FIELDS = ['amount', 'email', 'name', 'owner', 'phone', 'region', 'revenue', 'status'];

function makeClient(storedFields: Record<string, FieldEntry>): FakeClient {
  return {
    layered: async () => ({
      effective: {
        name: 'sales_perms',
        label: 'Sales',
        objects: { a_account: { allowRead: true } },
        fields: storedFields,
      },
      code: null,
      overlay: null,
      overlayScope: null,
    }),
    getDraft: async () => null,
    list: async (type: string) => (type === 'object' ? [{ item: { name: 'a_account' } }] : []),
    get: async (type: string) => (type === 'object' ? { fields: FIELDS.map((name) => ({ name })) } : null),
    save: async (_type: string, _name: string, payload: Record<string, unknown>) => {
      saved.push(JSON.parse(JSON.stringify(payload)) as SavedSet);
      return payload;
    },
  };
}

/** The package door autosaves 1.5s after the last edit (objectui#11787). */
const AUTOSAVE = { timeout: 4000 };
const WHEN_LABEL = 'WHEN (edit vote — row condition)';

async function renderExpanded(storedFields: Record<string, FieldEntry> = {}) {
  clientImpl = makeClient(storedFields);
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name="sales_perms" packageId="app.a" />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /a_account/ }));
  await screen.findByLabelText('a_account.amount readable');
}

const whenButton = (field: string) => screen.getByRole('button', { name: `a_account.${field} when` });

async function authorWhen(field: string, expression: string) {
  fireEvent.click(whenButton(field));
  const editor = await screen.findByLabelText(WHEN_LABEL);
  fireEvent.change(editor, { target: { value: expression } });
  return editor;
}

/** The next autosave to land after `n` already have. */
async function saveAfter(n: number): Promise<SavedSet> {
  await waitFor(() => expect(saved.length).toBeGreaterThan(n), AUTOSAVE);
  return saved[saved.length - 1];
}

describe('a field row offers a row condition on its edit vote (objectstack#25866)', () => {
  it('offers the key, shows the authored condition, and the saved entry carries it', async () => {
    await renderExpanded();
    expect(whenButton('amount')).toHaveTextContent('Add condition');

    await authorWhen('amount', "status == 'draft'");
    // The chip beside the boxes shows the condition as authored.
    expect(whenButton('amount')).toHaveTextContent("status == 'draft'");

    const set = await saveAfter(0);
    expect(set.fields?.['a_account.amount']).toEqual({ readable: true, editable: false, when: "status == 'draft'" });
  });

  it('shows a stored condition on load; the other rows still offer the key', async () => {
    await renderExpanded({ 'a_account.amount': { readable: true, editable: false, when: "status == 'approved'" } });
    expect(whenButton('amount')).toHaveTextContent("status == 'approved'");
    expect(whenButton('email')).toHaveTextContent('Add condition');
  });

  it('Read off clears the condition: the spec refuses `when` beside readable:false', async () => {
    await renderExpanded({ 'a_account.amount': { readable: true, editable: true, when: 'owner == current_user.id' } });

    fireEvent.click(screen.getByLabelText('a_account.amount readable'));
    expect(screen.getByLabelText('a_account.amount readable')).not.toBeChecked();
    expect(screen.getByLabelText('a_account.amount editable')).not.toBeChecked();
    // No affordance on a row that cannot carry a condition.
    expect(screen.queryByRole('button', { name: 'a_account.amount when' })).toBeNull();

    const set = await saveAfter(0);
    expect(set.fields?.['a_account.amount']).toEqual({ readable: false, editable: false });
  });

  it('the Edit toggle and the bulk Read-only all / Write all keep the condition; Clear drops it', async () => {
    await renderExpanded({ 'a_account.amount': { readable: true, editable: false, when: "status == 'draft'" } });

    fireEvent.click(screen.getByLabelText('a_account.amount editable'));
    expect(whenButton('amount')).toHaveTextContent("status == 'draft'");

    fireEvent.click(screen.getByRole('button', { name: 'Write all' }));
    expect(screen.getByLabelText('a_account.amount editable')).toBeChecked();
    expect(whenButton('amount')).toHaveTextContent("status == 'draft'");

    fireEvent.click(screen.getByRole('button', { name: 'Read-only all' }));
    expect(screen.getByLabelText('a_account.amount editable')).not.toBeChecked();
    expect(whenButton('amount')).toHaveTextContent("status == 'draft'");

    const first = await saveAfter(0);
    expect(first.fields?.['a_account.amount']).toEqual({ readable: true, editable: false, when: "status == 'draft'" });
    expect(first.fields?.['a_account.email']).toEqual({ readable: true, editable: false });

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(whenButton('amount')).toHaveTextContent('Add condition');
    const second = await saveAfter(1);
    expect(second.fields?.['a_account.amount']).toBeUndefined();
  });

  it('blank text removes the key rather than saving a blank condition', async () => {
    await renderExpanded({ 'a_account.amount': { readable: true, editable: false, when: "status == 'draft'" } });

    const editor = await authorWhen('amount', '   ');
    expect(editor).toHaveValue('');
    expect(whenButton('amount')).toHaveTextContent('Add condition');

    const set = await saveAfter(0);
    expect(set.fields?.['a_account.amount']).toEqual({ readable: true, editable: false });
  });

  it('a condition the publish gate would refuse holds the save; a fixed one releases it', async () => {
    await renderExpanded();

    // A valid condition first: it lands, and warms the lint engine, so the
    // fault below is judged well inside the autosave pause.
    await authorWhen('amount', "status == 'draft'");
    await screen.findByText('Valid CEL', {}, { timeout: 3000 });
    await saveAfter(0);

    fireEvent.change(screen.getByLabelText(WHEN_LABEL), { target: { value: 'status ==' } });
    const held = await screen.findByTestId('perm-autosave-held', {}, { timeout: 3000 });
    expect(held).toHaveTextContent('Fix the CEL syntax errors before saving.');
    // Longer than the autosave's pause: the held edit does not land.
    await new Promise((r) => setTimeout(r, 2000));
    expect(saved).toHaveLength(1);

    fireEvent.change(screen.getByLabelText(WHEN_LABEL), { target: { value: "status == 'approved'" } });
    await waitFor(() => expect(screen.queryByTestId('perm-autosave-held')).toBeNull(), { timeout: 3000 });
    const set = await saveAfter(1);
    expect(set.fields?.['a_account.amount']).toEqual({ readable: true, editable: false, when: "status == 'approved'" });
  });
});
