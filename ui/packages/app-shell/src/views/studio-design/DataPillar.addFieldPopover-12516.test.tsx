// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12516 — "Add field" asks for the label and type before it creates
 * the field. Every entry (the Form toolbar and the Records grid's "+" column)
 * opens the same popover: a required Label, a Type control (the inspector's
 * searchable picker, Text preselected) and Create. Create adds the field
 * through the pillar's one add-field path, named as the field inspector's
 * Label names it, and opens it in the inspector; Cancel creates nothing.
 *
 * The REAL `DataPillar`; the records grid is stubbed to its "+" column, drawn
 * from the grid's authoring context the way the real grid draws it.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { readFields } from '../metadata-admin/previews/object-fields-io';
import { addFieldFromFormToolbar, addFieldFromGrid } from './__tests__/dataPillarAddField';

const FORM = t('engine.studio.data.tab.form', 'en');
const ADD_FIELD = t('engine.studio.data.addField', 'en');

beforeEach(() => {
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(m in Element.prototype)) {
      (Element.prototype as unknown as Record<string, unknown>)[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
  if (!('scrollIntoView' in Element.prototype)) {
    (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderPillar(props: { readOnly?: boolean } = {}) {
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" readOnly={props.readOnly} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('records-panel')).toBeInTheDocument(), { timeout: 8000 });
}

async function openForm() {
  await renderPillar();
  await userEvent.click(screen.getAllByRole('button', { name: FORM })[0]);
  await screen.findByRole('button', { name: 'Layout', pressed: true });
}

const toolbarAddField = () => within(screen.getByTestId('form-toolbar')).getByRole('button', { name: ADD_FIELD });

/** The fields of the latest object draft the pillar saved. */
async function savedFields(): Promise<Record<string, Record<string, unknown>>> {
  await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 8000 });
  const calls = mockClient.save.mock.calls as unknown as Array<[string, string, Record<string, unknown>]>;
  const body = calls[calls.length - 1][2];
  return Object.fromEntries(readFields(body.fields).entries.map((e) => [e.name, e.def]));
}

describe('Data pillar — Add field asks for the label and type first (objectui#12516)', () => {
  it('the popover: a focused, required Label, the Type picker on Text, and Create off until a label is typed', async () => {
    await openForm();
    await userEvent.click(toolbarAddField());
    const popover = await screen.findByTestId('add-field-popover');
    const label = within(popover).getByRole('textbox', { name: t('designer.field.label', 'en') });
    expect(label).toHaveFocus();
    expect(label).toBeRequired();
    const type = within(popover).getByRole('combobox', { name: t('designer.field.type', 'en') });
    expect(type).toHaveAttribute('data-field-type', 'text');
    const create = within(popover).getByTestId('add-field-create');
    expect(create).toBeDisabled();
    await userEvent.type(label, '   ');
    expect(create).toBeDisabled();
    await userEvent.type(label, 'Score');
    expect(create).toBeEnabled();
  });

  it('Create adds the field named as typed with the chosen type, and opens it in the inspector', async () => {
    await openForm();
    // Email, a type the save door takes with no further config (a Picklist
    // without options is held until it has some, objectui#11786).
    await addFieldFromFormToolbar(undefined, { label: 'Health Score', type: /^Email$/ });
    expect(screen.queryByTestId('add-field-popover')).toBeNull();
    // The api name is the inspector's derivation of the label; the inspector
    // opens on the new field, its header naming it.
    const inspector = await screen.findByTestId('data-field-inspector');
    expect(within(inspector).getByText('health_score')).toBeInTheDocument();
    const fields = await savedFields();
    expect(fields.health_score).toMatchObject({ type: 'email', label: 'Health Score' });
  });

  it('the type search works in the popover: "pick" leaves Picklist alone', async () => {
    await openForm();
    await userEvent.click(toolbarAddField());
    const popover = await screen.findByTestId('add-field-popover');
    await userEvent.click(within(popover).getByRole('combobox', { name: t('designer.field.type', 'en') }));
    const search = await screen.findByRole('combobox', { name: t('designer.canvas.searchFieldType', 'en') });
    expect(search).toHaveFocus();
    await userEvent.type(search, 'pick');
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('data-field-type'))).toEqual(['select']);
    await userEvent.keyboard('{Enter}');
    // Picking a type closes the list, not the popover.
    expect(screen.getByTestId('add-field-popover')).toBeInTheDocument();
    expect(within(popover).getByRole('combobox', { name: t('designer.field.type', 'en') })).toHaveAttribute(
      'data-field-type',
      'select',
    );
  });

  it('Cancel, and Escape, create nothing', async () => {
    await openForm();
    const cardsBefore = document.querySelectorAll('[aria-roledescription]').length;
    await userEvent.click(toolbarAddField());
    let popover = await screen.findByTestId('add-field-popover');
    await userEvent.type(within(popover).getByTestId('add-field-label-input'), 'Not wanted');
    await userEvent.click(within(popover).getByRole('button', { name: t('engine.studio.cancel', 'en') }));
    expect(screen.queryByTestId('add-field-popover')).toBeNull();

    await userEvent.click(toolbarAddField());
    popover = await screen.findByTestId('add-field-popover');
    // Every open starts from an empty label.
    expect(within(popover).getByTestId('add-field-label-input')).toHaveValue('');
    await userEvent.type(within(popover).getByTestId('add-field-label-input'), 'Not wanted');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('add-field-popover')).toBeNull();

    expect(document.querySelectorAll('[aria-roledescription]')).toHaveLength(cardsBefore);
    expect(screen.queryByTestId('data-field-inspector')).toBeNull();
    expect(mockClient.save).not.toHaveBeenCalled();
  });

  // objectui#13389 — these two used to get a silent `field_<N>`, permanent
  // once published; the popover now asks for the api name instead.
  it('a label whose name is taken, or that derives none, is named by the api name the popover asks for', async () => {
    await openForm();
    // `name` is the served field's api name.
    await addFieldFromFormToolbar(undefined, { label: 'Name', apiName: 'full_name' });
    const inspector = await screen.findByTestId('data-field-inspector');
    expect(within(inspector).getByText('full_name')).toBeInTheDocument();
    await addFieldFromFormToolbar(undefined, { label: '健康分', apiName: 'health_score' });
    await waitFor(() => expect(within(screen.getByTestId('data-field-inspector')).getByText('health_score')).toBeInTheDocument());
    const fields = await waitFor(async () => {
      const f = await savedFields();
      expect(Object.keys(f)).toEqual(['name', 'full_name', 'health_score']);
      return f;
    }, { timeout: 8000 });
    expect(fields.full_name).toMatchObject({ type: 'text', label: 'Name' });
    expect(fields.health_score).toMatchObject({ type: 'text', label: '健康分' });
  });

  it('a label that derives no name keeps Create off until an api name is typed, and says why', async () => {
    await openForm();
    await userEvent.click(toolbarAddField());
    const popover = await screen.findByTestId('add-field-popover');
    await userEvent.type(within(popover).getByTestId('add-field-label-input'), '满意度');
    const create = within(popover).getByTestId('add-field-create');
    expect(create).toBeDisabled();
    expect(within(popover).getByTestId('add-field-api-name-hint')).toHaveTextContent(
      t('engine.studio.data.addFieldApiNameNotDerived', 'en'),
    );
    await userEvent.type(within(popover).getByTestId('add-field-api-name-input'), 'Satisfaction');
    // Typed through the same normaliser as the inspector's API name box.
    expect(within(popover).getByTestId('add-field-api-name-input')).toHaveValue('satisfaction');
    expect(within(popover).queryByTestId('add-field-api-name-hint')).toBeNull();
    expect(create).toBeEnabled();
    // A typed name another field holds is refused here too.
    await userEvent.clear(within(popover).getByTestId('add-field-api-name-input'));
    await userEvent.type(within(popover).getByTestId('add-field-api-name-input'), 'name');
    expect(create).toBeDisabled();
    expect(within(popover).getByTestId('add-field-api-name-hint')).toHaveTextContent('name');
    expect(mockClient.save).not.toHaveBeenCalled();
  });

  it('CONTROL — a Latin label shows the api name it derives and asks for none', async () => {
    await openForm();
    await userEvent.click(toolbarAddField());
    const popover = await screen.findByTestId('add-field-popover');
    await userEvent.type(within(popover).getByTestId('add-field-label-input'), 'Health Score');
    expect(within(popover).getByTestId('add-field-api-name-preview')).toHaveTextContent('health_score');
    expect(within(popover).queryByTestId('add-field-api-name-input')).toBeNull();
    expect(within(popover).getByTestId('add-field-create')).toBeEnabled();
  });

  it('the Records grid "+" opens the same popover, and focus goes back to it on Cancel', async () => {
    await renderPillar();
    const plus = screen.getByTestId('grid-add-column');
    await userEvent.click(plus);
    const popover = await screen.findByTestId('add-field-popover');
    expect(within(popover).getByTestId('add-field-label-input')).toHaveFocus();
    await userEvent.click(within(popover).getByRole('button', { name: t('engine.studio.cancel', 'en') }));
    await waitFor(() => expect(plus).toHaveFocus());

    await addFieldFromGrid(undefined, { label: 'Region', type: /^Lookup$/ });
    const inspector = await screen.findByTestId('data-field-inspector');
    expect(within(inspector).getByText('region')).toBeInTheDocument();
  });

  it('leaving the Records grid with the popover open does not bring it back open on return', async () => {
    await renderPillar();
    await userEvent.click(screen.getByTestId('grid-add-column'));
    await screen.findByTestId('add-field-popover');
    // The tab row is outside the popover: a click there dismisses it (the
    // host's open state with it) before the grid unmounts with the tab.
    await userEvent.click(screen.getAllByRole('button', { name: FORM })[0]);
    await screen.findByTestId('form-toolbar');
    await userEvent.click(screen.getAllByRole('button', { name: t('engine.studio.data.tab.records', 'en') })[0]);
    await screen.findByTestId('grid-add-column');
    expect(screen.queryByTestId('add-field-popover')).toBeNull();
  });

  it('CONTROL — read-only: no Add field, so no popover', async () => {
    await renderPillar({ readOnly: true });
    expect(screen.queryByTestId('grid-add-column')).toBeNull();
    expect(screen.queryByTestId('add-field-popover')).toBeNull();
    await userEvent.click(screen.getAllByRole('button', { name: FORM })[0]);
    expect(within(await screen.findByTestId('form-toolbar')).queryByRole('button', { name: ADD_FIELD })).toBeNull();
  });
});
