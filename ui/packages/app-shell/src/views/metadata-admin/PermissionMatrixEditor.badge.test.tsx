// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The provenance badge in the permission set editor has two answers: "Package"
 * (a package ships the set: the package door's `packageId`, or the layered
 * envelope's code artifact) and "Custom" (authored in this environment).
 *
 * objectui#12753 — spec 18 retired the authored `managedBy` on a permission set
 * (objectstack#23891). The badge used to read it for a third answer,
 * "Platform", and for "Package" too. No served datum names a platform set, so
 * the badge reads `packageId` and the artifact only. A draft that still carries
 * a stray `managedBy` (an old stored row) must not move the answer.
 *
 * Both sites are pinned: the routed page's badge, and the Studio Access
 * pillar's kind chip (`studio`). They read one derivation, so they agree.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/** The layered envelope's `code` slot; `null` = no code layer. */
let codeLayer: Record<string, unknown> | null = null;

function makeClient(set: Record<string, unknown>) {
  return {
    layered: async () => ({
      effective: set,
      code: codeLayer,
      overlay: null,
      overlayScope: null,
      ...(codeLayer ? { provenance: 'package' } : {}),
    }),
    getDraft: async () => null,
    list: async (type: string) => (type === 'object' ? [{ item: { name: 'a_account', label: 'Account' } }] : []),
    get: async (type: string) => (type === 'object' ? { fields: [] } : null),
    save: async (_t: string, _n: string, payload: Record<string, unknown>) => payload,
  } as any;
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

afterEach(() => {
  cleanup();
  codeLayer = null;
});

function baseSet(extra: Record<string, unknown>) {
  return { name: 'sales_perms', label: 'Sales', isProfile: false, objects: {}, fields: {}, ...extra };
}

type Site = 'page' | 'studio';

async function renderWith(site: Site, extra: Record<string, unknown>, packageId?: string) {
  clientImpl = makeClient(baseSet(extra));
  render(
    <MemoryRouter>
      {site === 'studio' ? (
        <PermissionMatrixEditPage
          type="permission"
          name="sales_perms"
          packageId={packageId}
          embedded
          studio={{ tab: 'objects', onTabChange: () => {} }}
        />
      ) : (
        <PermissionMatrixEditPage type="permission" name="sales_perms" packageId={packageId} />
      )}
    </MemoryRouter>,
  );
  // Wait for the load to settle: the object list arrives with the set.
  await screen.findByText('Account');
}

const badgeText = () => screen.getByTestId('perm-provenance-badge').textContent;

describe.each<Site>(['page', 'studio'])('the provenance badge (%s site)', (site) => {
  it('a set opened under a packageId reads "Package"', async () => {
    await renderWith(site, {}, 'com.example.sales');
    expect(badgeText()).toBe('Package');
  });

  it('a set whose code layer is a package artifact reads "Package"', async () => {
    codeLayer = { _packageId: 'com.example.sales', name: 'sales_perms' };
    await renderWith(site, {});
    expect(badgeText()).toBe('Package');
  });

  it('a set with neither reads "Custom"', async () => {
    await renderWith(site, {});
    expect(badgeText()).toBe('Custom');
  });

  it('a stray managedBy "platform" on an old stored row does not read "Platform"', async () => {
    await renderWith(site, { managedBy: 'platform' });
    expect(badgeText()).toBe('Custom');
    expect(screen.queryByText('Platform')).not.toBeInTheDocument();
  });

  it('a stray managedBy "package" does not make an environment-authored set read "Package"', async () => {
    await renderWith(site, { managedBy: 'package' });
    expect(badgeText()).toBe('Custom');
  });
});
