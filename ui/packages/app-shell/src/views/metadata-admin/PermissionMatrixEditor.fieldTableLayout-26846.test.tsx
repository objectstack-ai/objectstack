// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26846 — the field sub-table under an expanded object stays
 * readable when the matrix scrolls sideways (its floor is wider than the
 * Studio content column at 1440 px):
 *
 *  - the "visible / total" count sits beside the filter it counts, not at the
 *    far end of the row, where it fell past the visible edge;
 *  - the field-name column, header and rows, is pinned to the left edge of the
 *    scroll container over an opaque background.
 *
 * jsdom lays nothing out, so this pins the structure and the classes the
 * browser reads; it is no screenshot.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { t } from './i18n';

// `withPreviewDrafts` answers the client itself, not a promise (objectstack#26840).
type FakeClient = Record<string, (...args: never[]) => unknown>;

let clientImpl: FakeClient;

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

afterEach(cleanup);

// Eight fields, so the filter shows (threshold is > 6).
const FIELDS = ['amount', 'email', 'name', 'notes', 'phone', 'region', 'revenue', 'status'];

function makeClient(): FakeClient {
  return {
    layered: async () => ({
      effective: { name: 'project_editor', label: 'Project editor', objects: { a_project: { allowRead: true } }, fields: {} },
      code: null,
      overlay: null,
      overlayScope: null,
    }),
    getDraft: async () => null,
    withPreviewDrafts() { return this; },
    list: async (type: string) => (type === 'object' ? [{ item: { name: 'a_project' } }] : []),
    get: async (type: string) => (type === 'object' ? { fields: FIELDS.map((name) => ({ name })) } : null),
    save: async (_type: string, _name: string, payload: Record<string, unknown>) => payload,
  };
}

async function renderExpanded() {
  clientImpl = makeClient();
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name="project_editor" packageId="app.a" />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /a_project/ }));
  await screen.findByLabelText('a_project.notes readable');
}

const PINNED = ['sticky', 'left-0', 'bg-background'];

describe('the field sub-table when the matrix scrolls sideways (objectstack#26846)', () => {
  it('the count sits right after the filter, not pushed to the far end of the row', async () => {
    await renderExpanded();
    const count = screen.getByTestId('perm-field-count-a_project');
    expect(count).toHaveTextContent('8 / 8');
    expect(count.previousElementSibling).toBe(screen.getByLabelText(t('perm.field.filter', 'en')));
    expect(count).not.toHaveClass('ml-auto');
    expect(count).toHaveClass('shrink-0', 'whitespace-nowrap');
  });

  it('the field-name column is pinned left, header and every row', async () => {
    await renderExpanded();
    const header = screen.getByRole('columnheader', { name: t('perm.field.col.name', 'en') });
    expect(header).toHaveClass(...PINNED);
    for (const f of FIELDS) {
      expect(screen.getByTestId(`perm-field-name-a_project-${f}`)).toHaveClass(...PINNED);
    }
    // CONTROL: the boxes beside it scroll; only the name column is pinned.
    expect(screen.getByLabelText('a_project.notes readable').closest('td')).not.toHaveClass('sticky');
  });
});
