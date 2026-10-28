// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0015 external objects in the Studio Data pillar. An object carrying an
 * `external` binding offers no Add field — neither the Records grid's "+"
 * column nor the Form toolbar's button — because a new field would be a new
 * column on the remote table. The pillar says where the fields come from, and
 * the field inspector it opens gates rename and retype. A platform-owned
 * object keeps every door (control).
 *
 * The REAL `DataPillar`; the records grid is stubbed to the two authoring
 * affordances it draws from the grid's authoring context.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Module scope as well as in the `vi.mock` factory below: the cold transform is paid
// during collection, which no test or hook timeout clocks (AGENTS.md, flaky-test discipline).
import '@object-ui/components';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const FIELDS = { task_name: { type: 'text', label: 'Task name' } };
let servedObject: Record<string, unknown> = {};

const mockClient = {
  list: vi.fn(async () => [{ name: String(servedObject.name), label: 'Task' }]),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: servedObject, code: servedObject })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
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
        {authoring?.onEditColumn && (
          <button type="button" data-testid="grid-edit-task_name" onClick={() => authoring.onEditColumn?.('task_name')}>
            Edit column
          </button>
        )}
      </div>
    );
  }
  return { ...mod, ObjectView: GridDouble };
});

import { DataPillar } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { ObjectFieldInspector } from '../metadata-admin/inspectors/ObjectFieldInspector';

// The rail holds the REAL registered field inspector, as the console registers it.
registerMetadataInspector('object', ObjectFieldInspector);

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

async function renderPillar(object: Record<string, unknown>) {
  servedObject = object;
  render(
    <MemoryRouter initialEntries={['/studio/com.example.plan/data']}>
      <DataPillar packageId="com.example.plan" />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('records-panel')).toBeInTheDocument(), { timeout: 8000 });
}

async function openFormToolbar() {
  await userEvent.click(screen.getAllByRole('button', { name: FORM })[0]);
  return screen.findByTestId('form-toolbar');
}

describe('Data pillar — external object (ADR-0015)', () => {
  const EXTERNAL = { name: 'gantt_task', label: 'Task', datasource: 'plan_gantt', external: {}, fields: FIELDS };

  it('offers no Add field in the Records grid or the Form toolbar, and names the datasource', async () => {
    await renderPillar(EXTERNAL);
    expect(screen.queryByTestId('grid-add-column')).toBeNull();
    expect(within(screen.getByTestId('external-object-notice')).getByTestId('external-field-badge')).toHaveTextContent(
      'From plan_gantt · Read-only',
    );
    const toolbar = await openFormToolbar();
    expect(within(toolbar).queryByRole('button', { name: ADD_FIELD })).toBeNull();
    // A writable: false object never asks the datasource.
    expect(mockClient.get).not.toHaveBeenCalled();
  });

  it('the column editor still opens the field inspector, which marks the field and gates rename and retype', async () => {
    await renderPillar(EXTERNAL);
    await userEvent.click(screen.getByTestId('grid-edit-task_name'));
    const inspector = await screen.findByTestId('data-field-inspector');
    expect(within(inspector).getByTestId('external-field-badge')).toHaveTextContent('From plan_gantt · Read-only');
    expect(within(inspector).getByTestId('field-apiname-input')).toBeDisabled();
    expect(within(inspector).getByRole('combobox', { name: t('designer.field.type', 'en') })).toBeDisabled();
  });

  it('CONTROL — a platform-owned object keeps both Add field doors and shows no source note', async () => {
    await renderPillar({ name: 'plan_task', label: 'Task', fields: FIELDS });
    expect(screen.getByTestId('grid-add-column')).toBeInTheDocument();
    expect(screen.queryByTestId('external-object-notice')).toBeNull();
    const toolbar = await openFormToolbar();
    expect(within(toolbar).getByRole('button', { name: ADD_FIELD })).toBeInTheDocument();
  });
});
