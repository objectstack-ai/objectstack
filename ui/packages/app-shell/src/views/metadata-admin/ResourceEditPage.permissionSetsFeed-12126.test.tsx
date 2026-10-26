// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12126 — the generic editor feeds the permission-set catalog to a
 * form that declares `widget: 'ref-multi:permission'`, and to no other form.
 *
 * The position form arrives from `/meta/types` as the type entry's `form`, so
 * `ResourceEditPage` is the host that has to hand the `ref-multi:permission`
 * picker its catalog. Pinned here, on the real page with a stubbed client:
 *
 *  - a form that declares the hint gets the registry's permission sets as the
 *    picker's options, and a pick stores the set's name in the draft's list;
 *  - the request is the whole registry list (`client.list('permission')`, no
 *    package scope): a position names sets from the environment catalog;
 *  - a FAILED list reaches the picker as a failure, not as an empty catalog;
 *  - a form that does not declare the hint sends no request at all — the
 *    control that makes the first case's request attributable to the hint.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { t } from './i18n';

const ADD = t('engine.form.addPermissionSetPlain', 'en-US');

const POSITION = { name: 'sales_lead', label: 'Sales lead', permissionSets: ['sales_rep', 'retired_set'] };

const listPermission = vi.fn<() => Promise<Array<Record<string, unknown>>>>();

const mockClient = {
  list: vi.fn(async (type: string) => (type === 'permission' ? listPermission() : [])),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => ({
    code: null,
    overlay: POSITION,
    overlayScope: null,
    effective: POSITION,
    provenance: 'org',
  })),
};

const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    label: { type: 'string' },
    permissionSets: { type: 'array', items: { type: 'string' } },
  },
};

/** The position form's row as objectstack#22794 declares it. */
const POSITION_FORM = {
  type: 'simple',
  sections: [
    {
      label: 'Position',
      fields: [
        { field: 'name' },
        { field: 'label' },
        { field: 'permissionSets', label: 'Permission Sets', widget: 'ref-multi:permission' },
      ],
    },
  ],
};

/** Today's row: a free-text tag box, which reads no catalog. */
const TAGS_FORM = {
  type: 'simple',
  sections: [{ label: 'Position', fields: [{ field: 'name' }, { field: 'permissionSets', type: 'tags' }] }],
};

const form = { current: POSITION_FORM as Record<string, unknown> };

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
          form: form.current,
        },
      ],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';

async function mountEditor() {
  render(
    <MemoryRouter initialEntries={['/metadata/position/sales_lead']}>
      <MetadataResourceEditPage type="position" name="sales_lead" />
    </MemoryRouter>,
  );
  await waitFor(() => expect(mockClient.layered).toHaveBeenCalled());
}

const permissionCalls = () => mockClient.list.mock.calls.filter(([type]) => type === 'permission');

beforeEach(() => {
  form.current = POSITION_FORM;
  listPermission.mockImplementation(async () => [
    { name: 'sales_rep', label: 'Sales rep' },
    { name: 'admin_full_access', label: 'Full access' },
    { label: 'a row without a name' },
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the permission-set catalog reaches a form that declares `ref-multi:permission` (objectui#12126)', () => {
  it('offers the registry sets, flags a stored name it lacks, and a pick lands in the list', async () => {
    await mountEditor();
    const list = await screen.findByRole('group', { name: /Permission Sets/ });
    await waitFor(() => expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('(not found)'));
    expect(within(list).getAllByRole('listitem')[0]).not.toHaveTextContent('(not found)');

    // A form-only type opens in view mode; either Edit button (header, or the
    // view-mode notice) enters the editable form.
    await userEvent.click(screen.getAllByRole('button', { name: t('engine.edit.edit', 'en-US') })[0]);
    await userEvent.click(await screen.findByRole('combobox', { name: ADD }));
    // Sorted by name; the stored `sales_rep` is not offered again; a nameless row is not an option.
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Full accessadmin_full_access']);
    await userEvent.click(screen.getByRole('option', { name: /admin_full_access/ }));
    await waitFor(() =>
      expect(within(list).getAllByRole('listitem').map((li) => li.querySelector('code')?.textContent)).toEqual([
        'sales_rep',
        'retired_set',
        'admin_full_access',
      ]),
    );
  });

  it('asks the whole registry once, with no package scope', async () => {
    await mountEditor();
    await waitFor(() => expect(permissionCalls()).toHaveLength(1));
    expect(permissionCalls()[0]).toEqual(['permission']);
  });

  it('a FAILED list reaches the picker as a failure, not as an empty catalog', async () => {
    listPermission.mockImplementation(async () => {
      throw new Error('HTTP 503');
    });
    await mountEditor();
    expect(await screen.findByTestId('ref-multi-permission-load-failed')).toHaveTextContent('HTTP 503');
    expect(screen.queryByText('(not found)')).toBeNull();
  });
});

describe('a form that does not declare `ref-multi:permission` sends no request (objectui#12126)', () => {
  it('the tag-box row reads no catalog, so the permission list is never asked for', async () => {
    form.current = TAGS_FORM;
    await mountEditor();
    // The page has settled: the draft's name is on screen in the tag row's form.
    await screen.findByDisplayValue('sales_lead');
    expect(permissionCalls()).toEqual([]);
  });
});
