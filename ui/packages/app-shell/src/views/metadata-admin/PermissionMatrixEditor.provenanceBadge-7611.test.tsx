// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7611 (F2) — the identity strip's provenance badge reads the layered
 * envelope, so a set a code package SHIPS reads "Package", not "Custom".
 *
 * ## The defect
 *
 * The badge read only `draft.managedBy` and the `packageId` prop. The registry
 * serves no `managedBy` on a permission set, and the Setup catalog (the
 * environment scope) passes no `packageId`, so every packaged set opened there
 * read "Custom" — beside the artifact lock that says a code package provides
 * it. The editor already holds the fact that answers the question: the layered
 * envelope's `code` layer and its ADR-0010 `provenance`, read by
 * `isArtifactBackedLayer` into `codeIsArtifact` for the artifact gate. The badge
 * now reads that same verdict, so the badge and the lock can never disagree.
 *
 * ## What discriminates
 *
 * The first case is the fix. The three after it are the predicate's own
 * exclusions (`PermissionMatrixEditor.artifactTier.test.tsx` pins them for the
 * lock): a set with no code layer, an organization-authored set read back with
 * a code-looking `_packageId`, and the `sys_metadata` save-path sentinel. Each
 * must still read "Custom", so the fix cannot be "always Package".
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/** The layered envelope's `code` slot (see the artifact-tier suite's legend). */
let codeLayer: Record<string, unknown> | null = null;
/** The envelope's ADR-0010 `provenance`; `undefined` = the key absent. */
let provenance: 'package' | 'org' | 'env-forced' | undefined;

/** A set as the registry serves it: no `managedBy`. */
const SET = {
  name: 'showcase_contributor',
  label: 'Contributor',
  objects: { a_account: { allowRead: true } },
  fields: {},
} as Record<string, unknown>;

function makeClient() {
  return {
    layered: async () => ({
      effective: SET,
      code: codeLayer,
      overlay: null,
      overlayScope: null,
      ...(provenance !== undefined ? { provenance } : {}),
    }),
    getDraft: async () => null,
    list: async (type: string) =>
      type === 'object' ? [{ item: { name: 'a_account', label: 'Account' } }] : [],
    get: async (type: string) =>
      type === 'object' ? { fields: [{ name: 'name', label: 'Name' }] } : null,
    save: async (_t: string, _n: string, payload: Record<string, unknown>) => payload,
  } as any;
}

let clientImpl: any;

// The stock-boot `permission` shape: no per-org overlay, runtime authoring open
// — the flags under which a packaged set is locked at the environment scope.
vi.mock('./useMetadata', () => ({
  useMetadataClient: () => clientImpl,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: false, allowRuntimeCreate: true }],
  }),
}));
// The environment scope mounts who-holds-it under the definition; its reads are
// not this suite's subject.
vi.mock('./AssignedUsersSection', () => ({ AssignedUsersSection: () => null }));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

afterEach(() => {
  cleanup();
  codeLayer = null;
  provenance = undefined;
});

/** Mounts the editor at the environment scope (no `packageId`). */
async function renderMatrix() {
  clientImpl = makeClient();
  render(
    <MemoryRouter initialEntries={['/apps/setup/metadata/permission/showcase_contributor?scope=environment']}>
      <PermissionMatrixEditPage type="permission" name="showcase_contributor" />
    </MemoryRouter>,
  );
  await screen.findByText('Account');
}

const badgeText = () => screen.getByTestId('perm-provenance-badge').textContent;

describe('the provenance badge reads the layered envelope (objectui#7611, F2)', () => {
  it('a set a code package ships reads "Package" beside its lock, not "Custom"', async () => {
    codeLayer = { _packageId: 'com.example.showcase', name: 'showcase_contributor' };
    provenance = 'package';
    await renderMatrix();
    expect(badgeText()).toBe('Package');
    // The lock it sits beside: the artifact gate, read off the same envelope.
    expect(screen.getByText(/^Read-only \(/)).toBeInTheDocument();
  });

  it('a set with no code layer (authored in this environment) still reads "Custom"', async () => {
    await renderMatrix();
    expect(badgeText()).toBe('Custom');
  });

  it('an organization-authored set read back with a code-looking _packageId still reads "Custom"', async () => {
    codeLayer = { _packageId: 'com.example.showcase', name: 'showcase_contributor' };
    provenance = 'org';
    await renderMatrix();
    expect(badgeText()).toBe('Custom');
  });

  it('the sys_metadata save-path sentinel still reads "Custom"', async () => {
    codeLayer = { _packageId: 'sys_metadata', name: 'showcase_contributor' };
    await renderMatrix();
    expect(badgeText()).toBe('Custom');
  });
});
