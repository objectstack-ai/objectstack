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
import userEvent from '@testing-library/user-event';
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
  layered: vi.fn(async (): Promise<unknown> => null),
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

/**
 * objectstack#32105 — an open item with nothing changed withholds Save. Its
 * reason ("No changes to save") was only the disabled button's `title` and
 * `aria-label`: no tooltip on hover, Tab never reached it, and the label
 * replaced the button's name "Save" with the reason. A withheld Save now keeps
 * its name and gives the reason the header Publish's way
 * (`DisabledControlReason`): a focusable wrapper opening a tooltip, both it
 * and the button described by the reason.
 */
describe('a withheld Save says why and keeps its name (objectstack#32105)', () => {
  const describedBy = (el: HTMLElement) =>
    document.getElementById(el.getAttribute('aria-describedby') ?? '') as HTMLElement | null;
  const SAVE = t('engine.edit.save', 'en-US');
  const NO_CHANGES = t('engine.edit.noChanges', 'en-US');
  const ROW = { name: 'sales_mgr', label: 'Sales manager' };

  it('an unchanged position: Tab from Cancel reaches the disabled Save, named "Save" and described by the reason', async () => {
    mockClient.layered.mockImplementation(async () => ({
      code: null,
      overlay: ROW,
      effective: ROW,
      editable: true,
      deletable: true,
      resettable: false,
      lock: 'none',
    }));
    try {
      const user = userEvent.setup();
      render(
        <MemoryRouter initialEntries={['/metadata/position/sales_mgr']}>
          <MetadataResourceEditPage type="position" name="sales_mgr" />
        </MemoryRouter>,
      );
      // The header's Edit (the read view draws a second one in its body).
      await user.click((await screen.findAllByRole('button', { name: t('engine.edit.edit', 'en-US') }))[0]);
      const save = await screen.findByTestId('resource-save');
      expect(save).toBeDisabled();
      expect(save).toHaveAccessibleName(SAVE);
      expect(save).not.toHaveAttribute('title');
      expect(save).toHaveAccessibleDescription(NO_CHANGES);

      screen.getByTitle(t('engine.cancel', 'en-US')).focus();
      await user.tab();
      const wrapper = save.parentElement as HTMLElement;
      expect(wrapper).toHaveFocus();
      expect(wrapper).toHaveAttribute('data-disabled-reason');
      expect(describedBy(wrapper)).toHaveTextContent(NO_CHANGES);
      expect(await screen.findByRole('tooltip')).toHaveTextContent(NO_CHANGES);
    } finally {
      mockClient.layered.mockImplementation(async () => null);
    }
  });

  it('CONTROL — an enabled Save is unchanged: no wrapper, and its name and tooltip stay the shortcut hint', async () => {
    openNewPosition();
    const save = await screen.findByTestId('resource-save');
    expect(save).toBeEnabled();
    expect(save).not.toHaveAttribute('aria-describedby');
    expect(save.parentElement).not.toHaveAttribute('data-disabled-reason');
    expect(save).toHaveAccessibleName(`${SAVE} (⌘S)`);
  });
});
