// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12451 — the Data pillar's Form tab keeps exactly one toolbar row
 * between the object's tab row and the first section card, in Layout and in
 * Preview alike: the Layout / Preview control and a hint at the left, Add
 * section and Add field at the right. The caption that used to trail the
 * control is each item's title (pinned in `DataPillar.layoutBadge.test.tsx`).
 *
 * The toolbar's Add field and the Records grid's "+" column are one action:
 * each opens the Add field popover (objectui#12516), and its Create adds one
 * field card and opens its inspector (objectui#12511 — the object header's
 * More → Add field, this pin's other entry before, retired).
 *
 * The REAL `DataPillar`; the records grid is stubbed to its "+" column, drawn
 * from the grid's authoring context the way the real grid draws it.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Module scope as well as in the `vi.mock` factory below: the cold transform is paid
// during collection, which no test or hook timeout clocks (AGENTS.md, flaky-test discipline).
import '@object-ui/components';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const servedObject = {
  name: 'showcase_account',
  label: 'Account',
  fields: { name: { type: 'text', label: 'Account Name', required: true } },
};

const mockClient = {
  list: vi.fn(async () => [{ name: 'showcase_account', label: 'Account' }]),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: servedObject, code: servedObject })),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({ ok: true })),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const { useGridFieldAuthoring } = await import('@object-ui/components');
  function GridDouble() {
    const authoring = useGridFieldAuthoring();
    return (
      <div data-testid="records-panel">
        {authoring?.onAddColumn && (
          <button type="button" data-testid="grid-add-column" onClick={authoring.onAddColumn}>
            Add column
          </button>
        )}
      </div>
    );
  }
  return { ...mod, ObjectView: GridDouble };
});

import { DataPillar } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';
import { addFieldFromFormToolbar, addFieldFromGrid } from './__tests__/dataPillarAddField';

const FORM = t('engine.studio.data.tab.form', 'en');
const RECORDS = t('engine.studio.data.tab.records', 'en');
const ADD_FIELD = t('engine.studio.data.addField', 'en');
const ADD_GROUP = t('engine.studio.designer.addGroup', 'en');
const HINT = t('engine.studio.designer.toolbarHint', 'en');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openForm(props: { readOnly?: boolean } = {}) {
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" readOnly={props.readOnly} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('records-panel')).toBeInTheDocument(), { timeout: 8000 });
  await userEvent.click(screen.getAllByRole('button', { name: FORM })[0]);
  await screen.findByRole('button', { name: 'Layout', pressed: true });
}

/** The field cards on the canvas. */
const cards = () => Array.from(document.querySelectorAll('[aria-roledescription]'));

describe('Data pillar Form tab — one toolbar row (objectui#12451)', () => {
  it('Layout: one toolbar holds the mode control, the hint, Add section and Add field', async () => {
    await openForm();
    const toolbars = screen.getAllByTestId('form-toolbar');
    expect(toolbars).toHaveLength(1);
    const bar = within(toolbars[0]);
    expect(bar.getByRole('button', { name: 'Layout', pressed: true })).toBeInTheDocument();
    expect(bar.getByRole('button', { name: 'Preview', pressed: false })).toBeInTheDocument();
    expect(bar.getByText(HINT)).toBeInTheDocument();
    expect(bar.getByRole('button', { name: ADD_GROUP })).toBeInTheDocument();
    expect(bar.getByRole('button', { name: ADD_FIELD })).toBeInTheDocument();
    // The toolbar is followed by the canvas whose first child holds the
    // first section card: no strip or caption row between them.
    const canvas = toolbars[0].nextElementSibling as HTMLElement;
    expect(canvas).not.toBeNull();
    expect(within(canvas).getByText('Account Name')).toBeInTheDocument();
  });

  it('Preview: the same single toolbar row, without the layout actions', async () => {
    await openForm();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const toolbars = screen.getAllByTestId('form-toolbar');
    expect(toolbars).toHaveLength(1);
    const bar = within(toolbars[0]);
    expect(bar.getByRole('button', { name: 'Preview', pressed: true })).toBeInTheDocument();
    expect(bar.queryByRole('button', { name: ADD_FIELD })).toBeNull();
  });

  it('the toolbar Add field and the Records grid "+" are one action', async () => {
    await openForm();
    const before = cards().length;
    await addFieldFromFormToolbar(undefined, { label: 'From toolbar' });
    expect(cards()).toHaveLength(before + 1);
    expect(await screen.findByTestId('data-field-inspector')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: RECORDS })[0]);
    await addFieldFromGrid(undefined, { label: 'From grid' });
    expect(await screen.findByTestId('data-field-inspector')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: FORM })[0]);
    await waitFor(() => expect(cards()).toHaveLength(before + 2));
  });

  it('CONTROL — read-only: one toolbar, no add actions', async () => {
    await openForm({ readOnly: true });
    const toolbars = screen.getAllByTestId('form-toolbar');
    expect(toolbars).toHaveLength(1);
    expect(within(toolbars[0]).queryByRole('button', { name: ADD_FIELD })).toBeNull();
    expect(within(toolbars[0]).queryByRole('button', { name: ADD_GROUP })).toBeNull();
  });
});
