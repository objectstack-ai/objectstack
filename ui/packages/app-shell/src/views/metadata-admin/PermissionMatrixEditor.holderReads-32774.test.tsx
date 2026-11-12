// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32774 — the permission-set editor's clone source and holder
 * reading, where more than one holder serves the set's name (ADR-0150 D3/D5):
 *
 *  - item 2: "New similar" clones the holder the editor shows: the dialog gets
 *    that holder's package where the name alone does not address it, and a
 *    Studio host is told the same package (`onCloneSourceRead`) for its own
 *    clone dialog;
 *  - item 7: the published list the holder is read from is read again with the
 *    set (a publish), so a holder that arrived while the editor was open is
 *    counted, ⛔ not only after a remount.
 *
 * CONTROL: one holder of the name, and the environment's own set, clone by the
 * name alone, and the editor mounts with the one published read it sent before.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as React from 'react';
// The page reaches `celAuthoring`'s dynamic `@objectstack/lint` and
// `@objectstack/formula` imports, and `catalog-activation`'s dynamic
// `@objectstack/spec/identity` import; their first load is paid here, at
// collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
import '@objectstack/formula';
import '@objectstack/spec/identity';

let publishedSets: Array<Record<string, unknown>> = [];
let permissionListReads = 0;

function makeClient() {
  return {
    layered: async (_type: string, name: string) => ({
      effective: { name, label: 'Sales Rep', objects: { crm_case: { allowRead: true } }, fields: {} },
      // A package ships the set: the artifact tier locks the environment
      // editor, whose primary action is then "New similar".
      code: { name, _packageId: 'com.acme.crm' },
      overlay: null,
      overlayScope: null,
    }),
    getDraft: async () => null,
    list: async (type: string) => {
      if (type === 'object') return [{ item: { name: 'crm_case' } }];
      if (type !== 'permission') return [];
      permissionListReads++;
      return publishedSets;
    },
    get: async (type: string) => (type === 'object' ? { fields: [] } : null),
    save: async (_t: string, _n: string, payload: Record<string, unknown>) => payload,
  };
}

let clientImpl: ReturnType<typeof makeClient> | undefined;

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => clientImpl,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: false, allowRuntimeCreate: true }],
  }),
}));
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => true,
}));
vi.mock('./AssignedUsersSection', () => ({
  AssignedUsersSection: ({ holding }: { holding?: unknown }) => (
    <div data-testid="assigned-users-stub" data-holding={JSON.stringify(holding ?? null)} />
  ),
}));
vi.mock('./CatalogActiveSwitch', () => ({
  CatalogItemActiveSwitch: () => <div data-testid="item-switch-stub" />,
}));
vi.mock('./PermissionSetCloneDialog', () => ({
  PermissionSetCloneDialog: ({ source, sourcePackage }: { source: string; sourcePackage?: string }) => (
    <div data-testid="clone-dialog-stub" data-source={source} data-source-package={sourcePackage ?? ''} />
  ),
}));
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  CapabilityMultiSelectField: () => <div data-testid="cap-picker" />,
  parseCapabilityNames: (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : []),
}));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';
import { t } from './i18n';

afterEach(() => {
  cleanup();
  publishedSets = [];
  permissionListReads = 0;
});

const ONE = [{ name: 'sales_rep', label: 'Sales Rep', _packageId: 'com.acme.crm' }];
const ENV_AND_PACKAGE = [
  { name: 'sales_rep', label: 'Sales Rep', _packageId: 'sys_metadata' },
  { name: 'sales_rep', label: 'Sales Rep (CRM)', _packageId: 'com.acme.crm' },
];

function tree(search: string, publishNonce = 0) {
  return (
    <MemoryRouter initialEntries={[`/apps/setup/metadata/permission/sales_rep${search}`]}>
      <PermissionMatrixEditPage type="permission" name="sales_rep" publishNonce={publishNonce} />
    </MemoryRouter>
  );
}

async function cloneSource(search: string): Promise<string | null> {
  clientImpl = makeClient();
  render(tree(search));
  await screen.findByText('crm_case');
  await screen.findByTestId('assigned-users-stub');
  fireEvent.click(await screen.findByRole('button', { name: t('perm.clone.action', 'en-US') }));
  return (await screen.findByTestId('clone-dialog-stub')).getAttribute('data-source-package');
}

describe('"New similar" clones the holder the editor shows (objectstack#32774 item 2)', () => {
  it("names the package of the holder the read named, where the name alone addresses another holder's set", async () => {
    publishedSets = ENV_AND_PACKAGE;
    expect(await cloneSource('?scope=environment&package=com.acme.crm')).toBe('com.acme.crm');
  });

  it("CONTROL: one holder, and the environment's own set, clone by the name alone", async () => {
    publishedSets = ONE;
    expect(await cloneSource('?scope=environment&package=com.acme.crm')).toBe('');
    cleanup();
    publishedSets = ENV_AND_PACKAGE;
    expect(await cloneSource('?scope=environment')).toBe('');
  });

  it('tells a Studio host the package its own clone dialog names', async () => {
    const onCloneSourceRead = vi.fn();
    publishedSets = ENV_AND_PACKAGE;
    clientImpl = makeClient();
    render(
      <MemoryRouter initialEntries={['/studio/com.acme.crm/access']}>
        <PermissionMatrixEditPage
          type="permission"
          name="sales_rep"
          packageId="com.acme.crm"
          embedded
          studio={{ tab: 'objects', onTabChange: () => {}, onCloneSourceRead }}
        />
      </MemoryRouter>,
    );
    await waitFor(() => expect(onCloneSourceRead).toHaveBeenLastCalledWith('sales_rep', 'com.acme.crm'));
    cleanup();

    // CONTROL: one holder — the name alone.
    onCloneSourceRead.mockClear();
    publishedSets = ONE;
    clientImpl = makeClient();
    render(
      <MemoryRouter initialEntries={['/studio/com.acme.crm/access']}>
        <PermissionMatrixEditPage
          type="permission"
          name="sales_rep"
          packageId="com.acme.crm"
          embedded
          studio={{ tab: 'objects', onTabChange: () => {}, onCloneSourceRead }}
        />
      </MemoryRouter>,
    );
    await waitFor(() => expect(onCloneSourceRead).toHaveBeenCalled());
    // Past the load that reads the holder (the case above settles within it).
    await new Promise((r) => setTimeout(r, 200));
    expect(onCloneSourceRead.mock.calls.every(([, pkg]) => pkg === undefined)).toBe(true);
  });
});

describe('the published list is read again with the set (objectstack#32774 item 7)', () => {
  const holdingShown = () => JSON.parse(screen.getByTestId('assigned-users-stub').getAttribute('data-holding') ?? 'null');

  it('a holder that arrived while the editor was open is counted by the next read of the set', async () => {
    publishedSets = ONE;
    clientImpl = makeClient();
    const view = render(tree('?scope=environment&package=com.acme.crm'));
    await screen.findByText('crm_case');
    await screen.findByTestId('assigned-users-stub');
    // CONTROL: the mount sends the one published read it sent before.
    expect(permissionListReads).toBe(1);
    expect(holdingShown()).toBeNull();

    // The environment's own set of the name arrives; then the package publishes.
    publishedSets = ENV_AND_PACKAGE;
    view.rerender(tree('?scope=environment&package=com.acme.crm', 1));
    await waitFor(() => expect(holdingShown()).toEqual({ packageId: 'com.acme.crm', holders: [null, 'com.acme.crm'] }));
    expect(permissionListReads).toBe(2);
  });
});
