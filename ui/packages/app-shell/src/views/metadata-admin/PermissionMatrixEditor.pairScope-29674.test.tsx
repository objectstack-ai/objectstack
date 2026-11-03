// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29674 (ADR-0146 D3) — the package door's object scope.
 *
 * A paired `<base>.custom` package holds the permission sets FOR its base, and
 * declares none of the base's objects, so a set saved there is scoped to the
 * base's objects as well as the pair's own (`permissionObjectScopePackages`).
 * Every other package is scoped to itself, as before (ADR-0086 P0).
 *
 * The matrix-level pins sit beside the Studio composition
 * (`StudioDesignSurface.accessPairCopy-29674.test.tsx`), on a fake client that
 * answers each package's object list.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { permissionObjectScopePackages } from './permission-slice';

interface Server {
  set: Record<string, unknown>;
  saved: Array<Record<string, unknown>>;
  savedOpts: Array<Record<string, unknown> | undefined>;
  listed: Array<string | undefined>;
}

/** Objects by the package that declares them. */
const OBJECTS: Record<string, Array<Record<string, unknown>>> = {
  'com.acme.crm': [
    { name: 'crm_account', label: 'Account' },
    { name: 'crm_deal', label: 'Deal' },
  ],
  'com.acme.crm.custom': [{ name: 'crm_custom_survey', label: 'Survey' }],
  'app.a': [{ name: 'a_account', label: 'A account' }],
  'app.b': [{ name: 'b_ledger', label: 'B ledger' }],
};

function makeClient(server: Server): any {
  const client: any = {
    withPreviewDrafts: () => client,
    layered: async () => ({ effective: server.set, code: null, overlay: null, overlayScope: null }),
    getDraft: async () => null,
    list: async (type: string, opts?: { packageId?: string }) => {
      if (type !== 'object') return [];
      server.listed.push(opts?.packageId);
      return OBJECTS[opts?.packageId ?? ''] ?? [];
    },
    get: async () => null,
    save: async (_type: string, _name: string, payload: Record<string, unknown>, opts?: Record<string, unknown>) => {
      server.saved.push(payload);
      server.savedOpts.push(opts);
      server.set = payload;
      return payload;
    },
  };
  return client;
}

let clientImpl: any;

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
import { t } from './i18n';

afterEach(cleanup);

function serverWith(set: Record<string, unknown>): Server {
  return { set, saved: [], savedOpts: [], listed: [] };
}

function renderMatrix(packageId: string) {
  return render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name="the_set" packageId={packageId} />
    </MemoryRouter>,
  );
}

const rowOf = (text: string) => screen.getByText(text).closest('tr')!;
const readBox = (objectName: string) => screen.getByLabelText(`${objectName} ${t('perm.action.read', 'en')}`);

describe('permissionObjectScopePackages (objectstack#29674)', () => {
  it('scopes a pair to itself and its base, the pair first', () => {
    expect(permissionObjectScopePackages('com.acme.crm.custom')).toEqual(['com.acme.crm.custom', 'com.acme.crm']);
  });

  it('scopes every other package to itself', () => {
    expect(permissionObjectScopePackages('com.acme.crm')).toEqual(['com.acme.crm']);
    expect(permissionObjectScopePackages('app.a')).toEqual(['app.a']);
    // A pair of a pair has no base by the spec's pairing rule.
    expect(permissionObjectScopePackages('com.acme.crm.custom.custom')).toEqual(['com.acme.crm.custom.custom']);
  });
});

describe('PermissionMatrixEditPage — a pair’s set lists its base’s objects (objectstack#29674)', () => {
  const PAIR_SET = {
    name: 'the_set',
    label: 'Copy',
    objects: { crm_account: { allowRead: true }, crm_deal: { allowRead: true } },
    fields: { 'crm_deal.amount': { readable: true, editable: false } },
  };

  it('lists the pair’s and the base’s objects, each once, and draws the grants it holds on the base’s', async () => {
    const server = serverWith(structuredClone(PAIR_SET));
    clientImpl = makeClient(server);
    renderMatrix('com.acme.crm.custom');

    await screen.findByText('Account');
    expect(screen.getByText('Deal')).toBeInTheDocument();
    expect(screen.getByText('Survey')).toBeInTheDocument();
    expect(readBox('crm_account')).toBeChecked();
    expect(readBox('crm_deal')).toBeChecked();
    expect(readBox('crm_custom_survey')).not.toBeChecked();
    expect(new Set(server.listed)).toEqual(new Set(['com.acme.crm.custom', 'com.acme.crm']));
  });

  it('a grant on a base object saves into the pair’s draft, with every row it held', async () => {
    const server = serverWith(structuredClone(PAIR_SET));
    clientImpl = makeClient(server);
    renderMatrix('com.acme.crm.custom');

    await screen.findByText('Account');
    fireEvent.click(within(rowOf('Account')).getByLabelText(`crm_account ${t('perm.action.edit', 'en')}`));

    await waitFor(() => expect(server.saved).toHaveLength(1), { timeout: 4000 });
    expect(server.savedOpts[0]).toMatchObject({ mode: 'draft', packageId: 'com.acme.crm.custom' });
    expect(server.saved[0]!.objects).toStrictEqual({
      crm_account: { allowRead: true, allowEdit: true },
      crm_deal: { allowRead: true },
    });
    expect(server.saved[0]!.fields).toStrictEqual(PAIR_SET.fields);
  });
});

describe('CONTROL: an ordinary package’s set is scoped to its own objects (objectstack#29674)', () => {
  const SET = {
    name: 'the_set',
    label: 'A set',
    objects: { a_account: { allowRead: true }, b_ledger: { allowRead: true, allowEdit: true } },
    fields: { 'b_ledger.total': { readable: true, editable: false } },
  };

  it('lists only its package’s objects and keeps another package’s rows byte-identical on save', async () => {
    const server = serverWith(structuredClone(SET));
    clientImpl = makeClient(server);
    renderMatrix('app.a');

    await screen.findByText('A account');
    expect(screen.queryByText('B ledger')).toBeNull();
    expect(server.listed.every((p) => p === 'app.a')).toBe(true);

    fireEvent.click(within(rowOf('A account')).getByLabelText(`a_account ${t('perm.action.edit', 'en')}`));
    await waitFor(() => expect(server.saved).toHaveLength(1), { timeout: 4000 });
    expect(server.savedOpts[0]).toMatchObject({ mode: 'draft', packageId: 'app.a' });
    expect(server.saved[0]!.objects).toStrictEqual({
      a_account: { allowRead: true, allowEdit: true },
      b_ledger: SET.objects.b_ledger,
    });
    expect(server.saved[0]!.fields).toStrictEqual(SET.fields);
  });
});
