// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13337 — Setup → Positions → New, on the real page with a stubbed
 * client.
 *
 *  - the create form offers Permission Sets at once: the position type's create
 *    fields name `permissionSets`, so the served form's `ref-multi:permission`
 *    row is on screen before the first save and its picker reads the registry;
 *  - a key the create fields do not name (`delegatable`) still waits for the
 *    edit form — the CONTROL that makes the first case attributable to the list;
 *  - the editor's Save draws the word beside its icon, while the name a reader
 *    hears (and the tooltip) stays the shortcut hint.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { t } from './i18n';

const ADD = t('engine.form.addPermissionSetPlain', 'en-US');

const listPermission = vi.fn(async () => [
  { name: 'sales_rep', label: 'Sales rep' },
  { name: 'admin_full_access', label: 'Full access' },
]);

const mockClient = {
  list: vi.fn(async (type: string) => (type === 'permission' ? listPermission() : [])),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => null),
};

/** The position's served schema: the keys `PositionSchema` declares. */
const SCHEMA = {
  type: 'object',
  required: ['name', 'label'],
  properties: {
    name: { type: 'string' },
    label: { type: 'string' },
    description: { type: 'string' },
    permissionSets: { type: 'array', items: { type: 'string' } },
    delegatable: { type: 'boolean' },
  },
};

/** The position form's rows as objectstack's `positionForm` declares them. */
const POSITION_FORM = {
  type: 'simple',
  sections: [
    {
      label: 'Position',
      fields: [
        { field: 'name', required: true },
        { field: 'label', required: true },
        { field: 'description' },
        { field: 'permissionSets', label: 'Permission Sets', widget: 'ref-multi:permission' },
        { field: 'delegatable', label: 'Delegatable', type: 'boolean' },
      ],
    },
  ],
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [
        {
          type: 'position',
          name: 'position',
          label: 'Position',
          allowEnvironmentOverlay: false,
          allowRuntimeCreate: true,
          schema: SCHEMA,
          form: POSITION_FORM,
        },
      ],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerDefaultMetadataSchemas } from './default-schemas';

registerDefaultMetadataSchemas();

function openNewPosition() {
  render(
    <MemoryRouter initialEntries={['/metadata/position/new']}>
      <MetadataResourceEditPage type="position" name="" createMode />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('New Position offers Permission Sets before the first save (objectui#13337)', () => {
  it('the create form shows the Permission Sets picker, fed from the registry', async () => {
    openNewPosition();
    const list = await screen.findByRole('group', { name: /Permission Sets/ });
    expect(within(list).queryAllByRole('listitem')).toHaveLength(0);
    expect(await screen.findByRole('combobox', { name: ADD })).toBeInTheDocument();
    await waitFor(() => expect(mockClient.list).toHaveBeenCalledWith('permission'));
  });

  it('CONTROL — a key the create fields do not name waits for the edit form', async () => {
    openNewPosition();
    await screen.findByRole('group', { name: /Permission Sets/ });
    expect(screen.queryByText('Delegatable')).toBeNull();
  });
});

describe("the editor's Save is labelled (objectui#13337)", () => {
  it('draws the word beside the icon and keeps the shortcut hint as its name', async () => {
    openNewPosition();
    const save = await screen.findByTestId('resource-save');
    expect(save).toHaveTextContent(t('engine.edit.save', 'en-US'));
    expect(save).toHaveAccessibleName(`${t('engine.edit.save', 'en-US')} (⌘S)`);
    expect(save).toHaveAttribute('title', `${t('engine.edit.save', 'en-US')} (⌘S)`);
  });
});
