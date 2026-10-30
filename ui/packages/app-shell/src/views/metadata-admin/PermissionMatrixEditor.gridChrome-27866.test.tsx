// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27866 — the permission-set grid stays readable when it is wider
 * than its pane (1440 px desktop, 390 px phone), on both renderings:
 *
 *  - while columns are cut on the right, a fade on the pane's right edge says
 *    so (`MatrixScrollPane`), and it goes once the last column is in view;
 *  - the Object column, header and rows, is pinned to the pane's left edge;
 *  - an expanded object's field header pins under the matrix's header row, so
 *    field rows are labelled by their own columns;
 *  - two fields sharing a label draw their API names as the distinguishing text.
 *
 * jsdom lays nothing out: the pane's box is stubbed where the cue is read, and
 * the rest pins the classes the browser reads; it is no screenshot.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { t } from './i18n';
import { readPaneOverflow } from './MatrixScrollPane';

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

// An authored `owner` beside the platform's `owner_id`, both labelled "Owner".
const FIELDS = [
  { name: 'name', label: 'Project Name' },
  { name: 'owner', label: 'Owner' },
  { name: 'owner_id', label: 'Owner', system: true },
  { name: 'status', label: 'Status' },
];

function makeClient(): FakeClient {
  return {
    layered: async () => ({
      effective: {
        name: 'project_editor',
        label: 'Project editor',
        objects: { a_project: { allowRead: true }, b_task: { allowRead: true } },
        fields: {},
      },
      code: null,
      overlay: null,
      overlayScope: null,
    }),
    getDraft: async () => null,
    withPreviewDrafts() {
      return this;
    },
    list: async (type: string) =>
      type === 'object' ? [{ item: { name: 'a_project', label: 'Project' } }, { item: { name: 'b_task', label: 'Task' } }] : [],
    get: async (type: string) => (type === 'object' ? { fields: FIELDS } : null),
    save: async (_type: string, _name: string, payload: Record<string, unknown>) => payload,
  };
}

async function renderPage(studio = false) {
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
  await screen.findByRole('button', { name: objectButton('a_project') });
}

/** An object row's expand button: its label, then its API name. */
const objectButton = (name: string) => new RegExp(`^${name === 'a_project' ? 'Project' : 'Task'}\\W*${name}$`);

async function expand() {
  fireEvent.click(screen.getByRole('button', { name: objectButton('a_project') }));
  await screen.findByLabelText('a_project.owner readable');
}

/** Gives the pane a box, then lets it re-read it the way a scroll does. */
function layOut(pane: HTMLElement, box: { scrollLeft: number; scrollWidth: number; clientWidth: number }) {
  Object.defineProperty(pane, 'scrollWidth', { configurable: true, value: box.scrollWidth });
  Object.defineProperty(pane, 'clientWidth', { configurable: true, value: box.clientWidth });
  pane.scrollLeft = box.scrollLeft;
  act(() => {
    fireEvent.scroll(pane);
  });
}

const PINNED_LEFT = ['sticky', 'left-0', 'bg-background'];

describe('readPaneOverflow (objectstack#27866)', () => {
  it('reads a cut right edge and a scrolled-off left edge', () => {
    expect(readPaneOverflow({ scrollLeft: 0, scrollWidth: 1304, clientWidth: 1184 })).toEqual({ right: true, left: false });
    expect(readPaneOverflow({ scrollLeft: 120, scrollWidth: 1304, clientWidth: 1184 })).toEqual({ right: false, left: true });
    expect(readPaneOverflow({ scrollLeft: 60, scrollWidth: 1304, clientWidth: 1184 })).toEqual({ right: true, left: true });
    // A grid that fits, and a sub-pixel remainder, cut nothing.
    expect(readPaneOverflow({ scrollLeft: 0, scrollWidth: 1184, clientWidth: 1184 })).toEqual({ right: false, left: false });
    expect(readPaneOverflow({ scrollLeft: 0, scrollWidth: 1184.5, clientWidth: 1184 })).toEqual({ right: false, left: false });
  });
});

describe.each([
  ['the routed Setup page', false],
  ['the Studio Objects tab', true],
])('the permission grid on %s (objectstack#27866)', (_where, studio) => {
  it('fades the right edge while columns are cut, and not once the last one is in view', async () => {
    await renderPage(studio);
    const pane = screen.getByTestId('perm-matrix-pane');
    expect(pane).toContainElement(screen.getAllByRole('table')[0]);

    layOut(pane, { scrollLeft: 0, scrollWidth: 1304, clientWidth: 1184 });
    expect(screen.getByTestId('perm-matrix-overflow-cue')).toHaveAttribute('aria-hidden', 'true');
    expect(pane).not.toHaveAttribute('data-scrolled-x');

    layOut(pane, { scrollLeft: 120, scrollWidth: 1304, clientWidth: 1184 });
    expect(screen.queryByTestId('perm-matrix-overflow-cue')).toBeNull();
    // Rows now slide under the pinned column, which draws its edge.
    expect(pane).toHaveAttribute('data-scrolled-x', 'true');

    // CONTROL: a grid that fits its pane shows no cue.
    layOut(pane, { scrollLeft: 0, scrollWidth: 1600, clientWidth: 1600 });
    expect(screen.queryByTestId('perm-matrix-overflow-cue')).toBeNull();
  });

  it('pins the Object column, header and every row, to the left edge', async () => {
    await renderPage(studio);
    const header = screen.getByRole('columnheader', { name: t('perm.col.object', 'en') });
    expect(header).toHaveClass(...(studio ? ['sticky', 'left-0', 'bg-sidebar'] : PINNED_LEFT));
    for (const name of ['a_project', 'b_task']) {
      const cell = screen.getByRole('button', { name: objectButton(name) }).closest('td');
      expect(cell).toHaveClass(...PINNED_LEFT);
    }
    // CONTROL: the boxes scroll under it.
    expect(screen.getByLabelText(/^a_project Create/).closest('td')).not.toHaveClass('sticky');
  });

  it("pins the field header under the matrix's header row once an object is expanded", async () => {
    await renderPage(studio);
    await expand();
    // The matrix's header row is the h-9 the field header pins beneath.
    const objectHeader = screen.getByRole('columnheader', { name: t('perm.col.object', 'en') });
    expect(objectHeader.closest('tr')).toHaveClass('h-9');
    const fieldHead = screen.getByTestId('perm-field-head-a_project');
    const cells = Array.from(fieldHead.querySelectorAll('th'));
    expect(cells.map((c) => c.textContent)).toEqual([
      t('perm.field.col.name', 'en'),
      t('perm.field.read', 'en'),
      t('perm.field.edit', 'en'),
      t('perm.field.when', 'en'),
    ]);
    for (const c of cells) expect(c).toHaveClass('sticky', 'top-9', 'bg-background');
    // The name header is pinned both ways and stacks over the pinned name cells.
    expect(cells[0]).toHaveClass('left-0', 'z-[3]');
    // CONTROL: field rows are not pinned to the top.
    expect(screen.getByLabelText('a_project.owner readable').closest('td')).not.toHaveClass('top-9');
  });

  it('draws the API names of two fields that share a label as their distinguishing text', async () => {
    await renderPage(studio);
    await expand();
    for (const name of ['owner', 'owner_id']) {
      const cell = screen.getByTestId(`perm-field-name-a_project-${name}`);
      expect(cell).toHaveAttribute('data-shared-label', 'true');
      expect(cell).toHaveTextContent(`Owner(${name})`);
      expect(cell.querySelector('span')).toHaveClass('text-foreground');
      expect(cell.querySelector('span')).not.toHaveClass('text-muted-foreground');
    }
    // CONTROL: a field with a label of its own keeps the muted aside.
    const status = screen.getByTestId('perm-field-name-a_project-status');
    expect(status).not.toHaveAttribute('data-shared-label');
    expect(status.querySelector('span')).toHaveClass('text-muted-foreground');
  });
});
