// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26846 — the field sub-table under an expanded object stays
 * readable when the matrix scrolls sideways (its floor is wider than the
 * Studio content column at 1440 px):
 *
 *  - the "visible / total" count sits beside the filter it counts, not at the
 *    far end of the row, where it fell past the visible edge;
 *  - objectstack#29677: the whole field panel (toolbar, header, rows) is pinned
 *    at the expanded cell's inset and no wider than the pane shows, so the
 *    name column needs no pin of its own. The geometry (no box covered at any
 *    scroll offset) is measured in a browser by
 *    ui/e2e/permission-field-panel-scroll.spec.ts.
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

async function renderExpanded(studio = false) {
  clientImpl = makeClient();
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage
        type="permission"
        name="project_editor"
        packageId="app.a"
        studio={studio ? { tab: 'objects', onTabChange: () => {} } : undefined}
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /a_project/ }));
  await screen.findByLabelText('a_project.notes readable');
}

describe('the field sub-table when the matrix scrolls sideways (objectstack#26846)', () => {
  it('the count sits right after the filter, not pushed to the far end of the row', async () => {
    await renderExpanded();
    const count = screen.getByTestId('perm-field-count-a_project');
    expect(count).toHaveTextContent('8 / 8');
    expect(count.previousElementSibling).toBe(screen.getByLabelText(t('perm.field.filter', 'en')));
    expect(count).not.toHaveClass('ml-auto');
    expect(count).toHaveClass('shrink-0', 'whitespace-nowrap');
  });

  // objectstack#29677 — both renderings: the metadata admin's table and Studio Access's.
  for (const studio of [false, true]) {
    it(`the whole field panel is pinned at the cell inset, so the name column needs no pin of its own (objectstack#29677, ${studio ? 'Studio' : 'metadata admin'})`, async () => {
      await renderExpanded(studio);
      if (studio) expect(screen.getByTestId('perm-studio-matrix')).toBeInTheDocument();
      const panel = screen.getByTestId('perm-field-panel-a_project');
      // Pinned at the expanded cell's own left inset (pl-12 / px-12), as wide as
      // the pane shows less both insets: the pane is the size container.
      expect(panel).toHaveClass('sticky', 'left-12', 'max-w-[calc(100cqi-6rem)]');
      expect(panel.closest('td')?.className).toMatch(/(^|\s)(px|pl)-12(\s|$)/);
      expect(screen.getByTestId('perm-matrix-pane').parentElement).toHaveClass('@container');
      // The toolbar, the header and every row with its boxes sit inside it.
      expect(panel).toContainElement(screen.getByTestId('perm-field-count-a_project'));
      expect(panel).toContainElement(screen.getByRole('columnheader', { name: t('perm.field.col.name', 'en') }));
      for (const f of FIELDS) {
        const name = screen.getByTestId(`perm-field-name-a_project-${f}`);
        expect(panel).toContainElement(name);
        // The name cell is no longer a pinned column of its own: pinned, it was
        // the table's flexible column and covered the boxes once scrolled.
        expect(name).not.toHaveClass('sticky');
        expect(panel).toContainElement(screen.getByLabelText(`a_project.${f} readable`));
        expect(panel).toContainElement(screen.getByLabelText(`a_project.${f} editable`));
      }
      expect(screen.getByRole('columnheader', { name: t('perm.field.col.name', 'en') })).not.toHaveClass('left-0');
    });
  }
});
