// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27404 — the field sub-table offers the object's own fields, not
 * the columns the platform injects for its bookkeeping. Such a column carries
 * `system: true` AND `hidden: true` on the served definition (`__search`,
 * `organization_id`), the Data rail's predicate (`isStudioHiddenSystemField`,
 * objectui#11780). A stored entry against one still draws as written (the
 * objectui#13152 CONTROL); either mark alone is not enough to leave a field out.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

interface FieldEntry {
  readable?: boolean;
  editable?: boolean;
}
interface SavedSet {
  fields?: Record<string, FieldEntry>;
}

// `withPreviewDrafts` answers the client itself, not a promise (objectstack#26840).
type FakeClient = Record<string, (...args: never[]) => unknown>;

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

// The served definition: two bookkeeping columns (system + hidden), the
// reassignable owner (system only), an author's own hidden field, and two
// plain fields.
const SERVED_FIELDS = [
  { name: '__search', label: 'Search Index', system: true, hidden: true },
  { name: 'amount', label: 'Amount' },
  { name: 'internal_notes', label: 'Internal notes', hidden: true },
  { name: 'name', label: 'Name' },
  { name: 'organization_id', label: 'Organization', system: true, hidden: true },
  { name: 'owner_id', label: 'Owner', system: true },
];

const EDIT_ON = { allowRead: true, allowCreate: true, allowEdit: true };

function makeClient(storedFields: Record<string, FieldEntry>): FakeClient {
  return {
    layered: async () => ({
      effective: {
        name: 'project_editor',
        label: 'Project editor',
        objects: { a_project: EDIT_ON },
        fields: storedFields,
      },
      code: null,
      overlay: null,
      overlayScope: null,
    }),
    getDraft: async () => null,
    withPreviewDrafts() {
      return this;
    },
    list: async (type: string) => (type === 'object' ? [{ item: { name: 'a_project' } }] : []),
    get: async (type: string) => (type === 'object' ? { fields: SERVED_FIELDS } : null),
    save: async (_type: string, _name: string, payload: Record<string, unknown>) => {
      saved.push(JSON.parse(JSON.stringify(payload)) as SavedSet);
      return payload;
    },
  };
}

/** The package door autosaves 1.5s after the last edit (objectui#11787). */
const AUTOSAVE = { timeout: 4000 };

async function renderExpanded(storedFields: Record<string, FieldEntry> = {}) {
  clientImpl = makeClient(storedFields);
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name="project_editor" packageId="app.a" />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /a_project/ }));
  await screen.findByLabelText('a_project.name readable');
}

/** The field names the sub-table draws, in the order it draws them. */
const drawnRows = () =>
  screen
    .getAllByTestId(/^perm-field-name-a_project-/)
    .map((el) => el.getAttribute('data-testid')!.slice('perm-field-name-a_project-'.length));

describe('the field rows leave out the platform bookkeeping columns (objectstack#27404)', () => {
  it('does not offer a field that is system AND hidden', async () => {
    await renderExpanded();
    expect(screen.queryByTestId('perm-field-name-a_project-__search')).toBeNull();
    expect(screen.queryByTestId('perm-field-name-a_project-organization_id')).toBeNull();
    expect(screen.queryByLabelText('a_project.__search readable')).toBeNull();
    expect(screen.getByTestId('perm-field-count-a_project')).toHaveTextContent('4 / 4');
  });

  it('CONTROL: one mark alone is not enough — an author-hidden field and the system owner still draw, in name order', async () => {
    await renderExpanded();
    expect(drawnRows()).toEqual(['amount', 'internal_notes', 'name', 'owner_id']);
  });

  it('CONTROL: a stored entry against a bookkeeping column still draws, as written', async () => {
    await renderExpanded({ 'a_project.__search': { readable: false, editable: false } });
    expect(drawnRows()).toEqual(['__search', 'amount', 'internal_notes', 'name', 'owner_id']);
    const read = screen.getByLabelText('a_project.__search readable');
    expect(read).not.toBeChecked();
    expect(read).toHaveAttribute('data-field-rule', 'rule');
    expect(screen.queryByTestId('perm-field-name-a_project-organization_id')).toBeNull();
  });

  it('CONTROL: a stored row the draft clears keeps its row, so the admin sees what the save drops', async () => {
    await renderExpanded({ 'a_project.__search': { readable: false, editable: false } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    const body = await (async () => {
      await waitFor(() => expect(saved.length).toBeGreaterThan(0), AUTOSAVE);
      return saved[saved.length - 1];
    })();
    expect(body.fields?.['a_project.__search']).toBeUndefined();
    expect(screen.getByTestId('perm-field-name-a_project-__search')).toBeInTheDocument();
    expect(screen.getByLabelText('a_project.__search readable')).toHaveAttribute('data-field-rule', 'inherited');
  });

  it('a bulk shortcut writes only the offered rows, never a bookkeeping column', async () => {
    await renderExpanded();
    fireEvent.click(screen.getByRole('button', { name: 'Read-only all' }));
    await waitFor(() => expect(saved.length).toBeGreaterThan(0), AUTOSAVE);
    const keys = Object.keys(saved[saved.length - 1].fields ?? {}).sort();
    expect(keys).toEqual(['a_project.amount', 'a_project.internal_notes', 'a_project.name', 'a_project.owner_id']);
  });
});
