// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26597 — the field sub-table draws a field the set has NO entry
 * for from the object row's grant, marked inherited, and every control writes
 * only what the admin sees change: a click changes the box it lands on, and a
 * bulk shortcut leaves a row that already draws its target untouched.
 *
 * The drawing itself is `fieldRuleCell` (`permission-slice.ts`), pinned row by
 * row in `permission-slice.fieldRule-26597.test.ts`; this file pins that the
 * editor renders it and that its writes follow it.
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

// Eight fields, so the filter shows (threshold is > 6).
const FIELDS = ['amount', 'email', 'name', 'notes', 'phone', 'region', 'revenue', 'status'];

const EDIT_ON = { allowRead: true, allowCreate: true, allowEdit: true };
const EDIT_OFF = { allowRead: true, allowCreate: true };

function makeClient(objectPerm: Record<string, boolean>, storedFields: Record<string, FieldEntry>): FakeClient {
  return {
    layered: async () => ({
      effective: {
        name: 'project_editor',
        label: 'Project editor',
        objects: { a_project: objectPerm },
        fields: storedFields,
      },
      code: null,
      overlay: null,
      overlayScope: null,
    }),
    getDraft: async () => null,
    // objectstack#26840 — the package door reads its objects through the draft-overlaid door.
    withPreviewDrafts() { return this; },
    list: async (type: string) => (type === 'object' ? [{ item: { name: 'a_project' } }] : []),
    get: async (type: string) => (type === 'object' ? { fields: FIELDS.map((name) => ({ name })) } : null),
    save: async (_type: string, _name: string, payload: Record<string, unknown>) => {
      saved.push(JSON.parse(JSON.stringify(payload)) as SavedSet);
      return payload;
    },
  };
}

/** The package door autosaves 1.5s after the last edit (objectui#11787). */
const AUTOSAVE = { timeout: 4000 };

async function renderExpanded(objectPerm: Record<string, boolean>, storedFields: Record<string, FieldEntry> = {}) {
  clientImpl = makeClient(objectPerm, storedFields);
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name="project_editor" packageId="app.a" />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /a_project/ }));
  await screen.findByLabelText('a_project.notes readable');
}

const box = (field: string, bit: 'readable' | 'editable') => screen.getByLabelText(`a_project.${field} ${bit}`);

async function saveAfter(n: number): Promise<SavedSet> {
  await waitFor(() => expect(saved.length).toBeGreaterThan(n), AUTOSAVE);
  return saved[saved.length - 1];
}

describe('a field with no entry draws the object grant (objectstack#26597)', () => {
  it('on an object that grants Edit, an unruled field draws Read and Edit on, marked inherited', async () => {
    await renderExpanded(EDIT_ON);
    for (const f of FIELDS) {
      expect(box(f, 'readable')).toBeChecked();
      expect(box(f, 'editable')).toBeChecked();
      expect(box(f, 'editable')).toHaveAttribute('data-field-rule', 'inherited');
    }
    expect(screen.getByTestId('perm-field-inherited-legend-a_project')).toBeInTheDocument();
  });

  it('on an object without Edit, an unruled field draws Edit off, still inherited', async () => {
    await renderExpanded(EDIT_OFF);
    expect(box('notes', 'readable')).toBeChecked();
    expect(box('notes', 'editable')).not.toBeChecked();
    expect(box('notes', 'editable')).toHaveAttribute('data-field-rule', 'inherited');
  });

  it('an entry draws its own bits as a rule; an edit grant the object does not back is capped', async () => {
    await renderExpanded(EDIT_OFF, {
      'a_project.notes': { readable: true, editable: false },
      'a_project.name': { readable: true, editable: true },
    });
    expect(box('notes', 'editable')).not.toBeChecked();
    expect(box('notes', 'editable')).toHaveAttribute('data-field-rule', 'rule');
    expect(box('name', 'editable')).toBeChecked();
    expect(box('name', 'editable')).toHaveAttribute('data-capped', 'true');
    expect(box('name', 'editable')).toHaveAttribute(
      'title',
      'This rule grants Edit, but the object does not: a holder of this set alone cannot edit the field.',
    );
  });

  it('on an object that grants Edit, a read-only entry draws Edit off beside inherited rows that draw it on', async () => {
    await renderExpanded(EDIT_ON, { 'a_project.notes': { readable: true, editable: false } });
    expect(box('notes', 'editable')).not.toBeChecked();
    expect(box('notes', 'editable')).toHaveAttribute('data-field-rule', 'rule');
    expect(box('name', 'editable')).toBeChecked();
    expect(box('name', 'editable')).toHaveAttribute('data-field-rule', 'inherited');
  });
});

describe('every control writes only what the admin sees change (objectstack#26597)', () => {
  it('Read-only all over unruled fields on an Edit-granting object turns every Edit box off, and saves the locks it shows', async () => {
    await renderExpanded(EDIT_ON);
    fireEvent.change(screen.getByLabelText('Filter fields…'), { target: { value: 'notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read-only all' }));

    expect(box('notes', 'readable')).toBeChecked();
    expect(box('notes', 'editable')).not.toBeChecked();
    expect(box('notes', 'editable')).toHaveAttribute('data-field-rule', 'rule');

    const set = await saveAfter(0);
    // Exactly the visible row the screen changed — nothing else.
    expect(set.fields).toEqual({ 'a_project.notes': { readable: true, editable: false } });
  });

  it('Read-only all over rows that already draw read-only writes nothing', async () => {
    await renderExpanded(EDIT_OFF);
    fireEvent.click(screen.getByRole('button', { name: 'Read-only all' }));
    for (const f of FIELDS) {
      expect(box(f, 'editable')).not.toBeChecked();
      expect(box(f, 'editable')).toHaveAttribute('data-field-rule', 'inherited');
    }
    // An unrelated edit lands a save: it carries no field entry the shortcut invented.
    fireEvent.click(screen.getByLabelText('a_project Delete'));
    const set = await saveAfter(0);
    expect(set.fields ?? {}).toEqual({});
  });

  it('a click on an unruled row changes only the box it lands on', async () => {
    await renderExpanded(EDIT_ON);
    // Edit off on one row: Read stays as drawn.
    fireEvent.click(box('notes', 'editable'));
    expect(box('notes', 'readable')).toBeChecked();
    expect(box('notes', 'editable')).not.toBeChecked();
    // Read off on another: the spec's cascade takes Edit with it, on screen.
    fireEvent.click(box('name', 'readable'));
    expect(box('name', 'readable')).not.toBeChecked();
    expect(box('name', 'editable')).not.toBeChecked();

    const set = await saveAfter(0);
    expect(set.fields).toEqual({
      'a_project.notes': { readable: true, editable: false },
      'a_project.name': { readable: false, editable: false },
    });
  });

  it('Clear drops the rules: the rows draw the object grant again', async () => {
    await renderExpanded(EDIT_ON, { 'a_project.notes': { readable: true, editable: false } });
    fireEvent.change(screen.getByLabelText('Filter fields…'), { target: { value: 'notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(box('notes', 'editable')).toBeChecked();
    expect(box('notes', 'editable')).toHaveAttribute('data-field-rule', 'inherited');

    const set = await saveAfter(0);
    expect(set.fields).toEqual({});
  });
});
