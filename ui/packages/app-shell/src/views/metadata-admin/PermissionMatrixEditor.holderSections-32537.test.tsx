// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32537 — the permission-set editor in the ENVIRONMENT scope draws
 * the set's assignment section and its active switch for the holder it shows,
 * where more than one package holds the name (ADR-0150 D3/D4).
 *
 * Pinned, each against a control:
 *
 *  - CONTROL: one holder of the name. The section and the switch get no
 *    holding, and the Setup link is by the name, as before;
 *  - the read names a package (`?package=`): that holder's holding, and the
 *    Setup link names its package;
 *  - the read names none and the environment holds the name: the environment's
 *    own set, whose link stays by the name;
 *  - the read names none and two packages hold the name: the server refuses
 *    the read, so neither the section nor the switch is drawn (no by-name
 *    union of every holder's grants, whose Remove could delete another
 *    holder's row). The link to Setup stays, by the name: Setup lists each
 *    holder to pick from.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
let layeredRefused = false;

function makeClient() {
  return {
    layered: async () => {
      if (layeredRefused) {
        throw Object.assign(new Error('Permission set "sales_rep" is held by more than one package.'), {
          status: 409,
          code: 'RESOURCE_CONFLICT',
        });
      }
      return {
        effective: { name: 'sales_rep', label: 'Sales Rep', objects: { crm_case: { allowRead: true } }, fields: {} },
        code: null,
        overlay: null,
        overlayScope: null,
      };
    },
    getDraft: async () => null,
    list: async (type: string) =>
      type === 'object' ? [{ item: { name: 'crm_case' } }] : type === 'permission' ? publishedSets : [],
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
    entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
  }),
}));
vi.mock('./AssignedUsersSection', () => ({
  AssignedUsersSection: ({ permissionSetName, holding }: { permissionSetName: string; holding?: unknown }) => (
    <div data-testid="assigned-users-stub" data-set={permissionSetName} data-holding={JSON.stringify(holding ?? null)} />
  ),
}));
vi.mock('./CatalogActiveSwitch', () => ({
  CatalogItemActiveSwitch: ({ name, holding }: { name: string; holding?: unknown }) => (
    <div data-testid="item-switch-stub" data-name={name} data-holding={JSON.stringify(holding ?? null)} />
  ),
}));
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  CapabilityMultiSelectField: () => <div data-testid="cap-picker" />,
  parseCapabilityNames: (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : []),
}));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';
import { MetadataAreaHostContext } from './metadataAreaHost';
import { permissionSetAssignmentPagePath } from '../setup/peopleAssignments';

/** The Setup page's path with no set: the base the link's query is read against. */
const SETUP_PAGE = permissionSetAssignmentPagePath();

afterEach(() => {
  cleanup();
  publishedSets = [];
  layeredRefused = false;
});

const ONE = [{ name: 'sales_rep', label: 'Sales Rep', _packageId: 'com.acme.crm' }];
const TWO_PACKAGES = [
  { name: 'sales_rep', label: 'Sales Rep', _packageId: 'com.acme.crm' },
  { name: 'sales_rep', label: 'Sales Rep (Sales)', _packageId: 'com.acme.sales' },
];
const ENV_AND_PACKAGE = [
  { name: 'sales_rep', label: 'Sales Rep', _packageId: 'sys_metadata' },
  { name: 'sales_rep', label: 'Sales Rep (CRM)', _packageId: 'com.acme.crm' },
];

async function renderEditor(search: string, opts: { area?: boolean } = {}) {
  clientImpl = makeClient();
  const tree = (
    <MemoryRouter initialEntries={[`/apps/setup/metadata/permission/sales_rep${search}`]}>
      <PermissionMatrixEditPage type="permission" name="sales_rep" />
    </MemoryRouter>
  );
  render(
    opts.area ? (
      <MetadataAreaHostContext.Provider value={{ packageId: null, readOnly: false, basePath: '/studio/~all/metadata' }}>
        {tree}
      </MetadataAreaHostContext.Provider>
    ) : (
      tree
    ),
  );
  if (opts.area) await screen.findByTestId('setup-assignments-link-permission');
  else await screen.findByText('crm_case');
}

const holdingOn = (testId: string) => JSON.parse(screen.getByTestId(testId).getAttribute('data-holding') ?? 'null');
const setupHref = () =>
  screen.getByTestId('setup-assignments-link-permission').querySelector('a')!.getAttribute('href');

describe('the editor draws its sections for the holder it shows (objectstack#32537)', () => {
  it('CONTROL: one holder of the name gets no holding, as before', async () => {
    publishedSets = ONE;
    await renderEditor('?scope=environment');
    expect(holdingOn('assigned-users-stub')).toBeNull();
  });

  it("names the holder the read named, and the environment's own set by the name", async () => {
    publishedSets = TWO_PACKAGES;
    await renderEditor('?scope=environment&package=com.acme.sales');
    expect(holdingOn('assigned-users-stub')).toEqual({
      packageId: 'com.acme.sales',
      holders: ['com.acme.crm', 'com.acme.sales'],
    });
    cleanup();

    publishedSets = ENV_AND_PACKAGE;
    await renderEditor('?scope=environment');
    expect(holdingOn('assigned-users-stub')).toEqual({ packageId: null, holders: [null, 'com.acme.crm'] });
  });

  it('draws no section where two packages hold the name and the read named neither', async () => {
    publishedSets = TWO_PACKAGES;
    layeredRefused = true;
    clientImpl = makeClient();
    render(
      <MemoryRouter initialEntries={['/apps/setup/metadata/permission/sales_rep?scope=environment']}>
        <PermissionMatrixEditPage type="permission" name="sales_rep" />
      </MemoryRouter>,
    );
    await screen.findByText(/held by more than one package/);
    expect(screen.queryByTestId('perm-assignments')).toBeNull();
    expect(screen.queryByTestId('assigned-users-stub')).toBeNull();
  });

  it("under Studio's area: the switch gets the holding, and the Setup link names the holder's package", async () => {
    publishedSets = ONE;
    await renderEditor('?scope=environment', { area: true });
    // CONTROL: by the name.
    expect(holdingOn('item-switch-stub')).toBeNull();
    expect(setupHref()).toBe(`${SETUP_PAGE}?set=sales_rep`);
    cleanup();

    publishedSets = TWO_PACKAGES;
    await renderEditor('?scope=environment&package=com.acme.sales', { area: true });
    expect(holdingOn('item-switch-stub')).toEqual({
      packageId: 'com.acme.sales',
      holders: ['com.acme.crm', 'com.acme.sales'],
    });
    expect(setupHref()).toBe(`${SETUP_PAGE}?set=sales_rep&package=com.acme.sales`);
    cleanup();

    // Two package holders, named by neither: no switch; Setup lists each holder.
    publishedSets = TWO_PACKAGES;
    layeredRefused = true;
    await renderEditor('?scope=environment', { area: true });
    expect(screen.queryByTestId('item-switch-stub')).toBeNull();
    expect(setupHref()).toBe(`${SETUP_PAGE}?set=sales_rep`);
  });
});
