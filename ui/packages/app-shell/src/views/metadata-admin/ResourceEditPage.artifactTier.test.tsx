// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The metadata-admin designer must claim "provided by an installed package"
 * only for items that really come from one — objectui#4308.
 *
 * ## The defect
 *
 * Three surfaces disagreed about one object. For an object published into a
 * WRITABLE package, this page showed the artifact lock banner while Studio
 * presented the same object as editable and the server accepted the PUT. The
 * banner therefore asserted a lock nothing enforced, sending an operator off
 * to "edit it in its source package and republish" for a change they could
 * have made in front of them.
 *
 * The cause was the tier test this page used to decide which of the two-tier
 * gates applies. It asked only "is there a `code` layer, and is it not the
 * `sys_metadata` sentinel" — and an org-authored item satisfies both, because
 * boot-time rehydration of `sys_metadata` re-registers each row under its REAL
 * package id. The framework had already been bitten by the identical read
 * (cloud#970: an app the user had just built went un-editable at the first
 * kernel rebuild) and fixed it by asking ADR-0010 provenance instead. This
 * page still carried the pre-cloud#970 spelling.
 *
 * ## What this suite pins — both directions, deliberately
 *
 * The fix must not degenerate into "drop the lock". Half of these cases assert
 * the banner is GONE where the package is writable, and half assert it is
 * STILL THERE for a genuine code package — which is the objectui#4036 ruling
 * ("a code-defined package is read-only; customize in a writable package") and
 * must survive this change untouched. The unstamped-provenance case pins the
 * fail direction for an older server: no opinion keeps the conservative
 * artifact reading rather than unlocking on a guess.
 *
 * `object` is the type under test because it is the type the card reports and
 * the one where the two tiers actually diverge: `allowEnvironmentOverlay: false` (the
 * server refuses overlays of packaged objects with `NOT_OVERRIDABLE`) with
 * `allowRuntimeCreate: true` (orgs author their own). A type with both flags
 * true would be writable under either tier and could not detect the bug.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/** The object body as the code layer surfaces it, minus provenance tags. */
const objectDef = {
  name: 'showcase_account',
  label: 'Account',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
};

const layeredImpl = { current: vi.fn() };

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async (...args: unknown[]) => layeredImpl.current(...args)),
};

// The registry entry for `object`: overlaying a PACKAGED object is refused by
// the server (`allowEnvironmentOverlay: false`), authoring your own is not
// (`allowRuntimeCreate: true`). Which of those two gates this page applies is
// exactly what the tier test decides.
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
          type: 'object',
          name: 'object',
          label: 'Object',
          allowEnvironmentOverlay: false,
          allowRuntimeCreate: true,
          schema: {
            type: 'object',
            properties: { name: { type: 'string' }, label: { type: 'string' } },
          },
        },
      ],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * Mount the editor over one layered envelope. `code` carries the tags the
 * server stamps; `provenance` is the top-level ADR-0010 flag the server
 * resolves from the code layer and ships on the envelope.
 */
async function renderEditor(layered: Record<string, unknown>) {
  layeredImpl.current = vi.fn(async () => layered);
  render(
    <MemoryRouter initialEntries={['/metadata/object/showcase_account']}>
      <MetadataResourceEditPage type="object" name="showcase_account" />
    </MemoryRouter>,
  );
  // The load effect has resolved once the layered read has been consumed;
  // each assertion below then waits on the chrome it actually cares about.
  await waitFor(() => expect(mockClient.layered).toHaveBeenCalled());
}

/** The read-only notice, addressed by testid — its two texts are asserted separately. */
function banner(): HTMLElement | null {
  return screen.queryByTestId('readonly-banner');
}

const INSTALLED_PACKAGE_CLAIM = 'provided by an installed package';

describe('ResourceEditPage — the artifact lock follows provenance, not the package tag (#4308)', () => {
  it('writable package: an org-authored object carries NO installed-package lock', async () => {
    // The card's case. The row lives in a writable base, so rehydration gave
    // it a real-looking `_packageId` — and `_provenance: 'org'` is what says
    // it is the org's own content.
    await renderEditor({
      code: {
        ...objectDef,
        _packageId: 'com.example.base',
        _provenance: 'org',
      },
      overlay: null,
      overlayScope: null,
      effective: objectDef,
      provenance: 'org',
      packageId: 'com.example.base',
      editable: true,
    });

    await waitFor(() => {
      expect(banner()).toBeNull();
    });
    expect(screen.queryByText(new RegExp(INSTALLED_PACKAGE_CLAIM))).toBeNull();
  });

  it('writable package: the editor is actually editable, not merely un-bannered', async () => {
    // Suppressing the banner while leaving the form read-only would satisfy
    // the assertion above and still ship the defect — the operator would just
    // lose the explanation for a lock that is still there.
    await renderEditor({
      code: { ...objectDef, _packageId: 'com.example.base', _provenance: 'org' },
      overlay: null,
      overlayScope: null,
      effective: objectDef,
      provenance: 'org',
      packageId: 'com.example.base',
      editable: true,
    });

    await waitFor(() => expect(banner()).toBeNull());
    // `canWrite` drives the Save affordance; a read-only page offers none.
    const saveish = await screen.findAllByRole('button');
    const labels = saveish.map((b) => (b.textContent ?? '').trim().toLowerCase());
    expect(labels.some((l) => l.includes('save') || l.includes('edit'))).toBe(true);
  });

  it('code package: a genuine packaged object KEEPS the installed-package lock', async () => {
    // The objectui#4036 ruling, pinned from this side: a code-defined package
    // stays read-only here. If the fix ever widens into "drop the lock", this
    // is the test that goes red.
    await renderEditor({
      code: {
        ...objectDef,
        _packageId: 'com.example.showcase',
        _provenance: 'package',
      },
      overlay: null,
      overlayScope: null,
      effective: objectDef,
      provenance: 'package',
      packageId: 'com.example.showcase',
      editable: true,
    });

    const el = await waitFor(() => {
      const b = banner();
      expect(b).not.toBeNull();
      return b as HTMLElement;
    });
    // The banner text interpolates `{type}` as a <code> node, so read the
    // whole subtree rather than matching one text node.
    expect(el.textContent).toContain(INSTALLED_PACKAGE_CLAIM);
  });

  it('legacy sentinel: a `sys_metadata`-tagged code layer stays unlocked', async () => {
    // The save-path sentinel carve-out that predates this change. It still
    // holds — the provenance test is an ADDITIONAL exclusion, not a swap.
    await renderEditor({
      code: { ...objectDef, _packageId: 'sys_metadata' },
      overlay: null,
      overlayScope: null,
      effective: objectDef,
      packageId: 'sys_metadata',
      editable: true,
    });

    await waitFor(() => {
      expect(banner()).toBeNull();
    });
  });

  it('no provenance opinion: an unstamped code layer keeps the conservative lock', async () => {
    // Older server / unstamped item. `undefined` is not `'org'`, so the item
    // stays in the artifact tier — the same fail direction the `lock*` flags
    // beside it already take. Unlocking on a missing field would be a guess.
    await renderEditor({
      code: { ...objectDef, _packageId: 'com.example.showcase' },
      overlay: null,
      overlayScope: null,
      effective: objectDef,
      packageId: 'com.example.showcase',
      editable: true,
    });

    const el = await waitFor(() => {
      const b = banner();
      expect(b).not.toBeNull();
      return b as HTMLElement;
    });
    expect(el.textContent).toContain(INSTALLED_PACKAGE_CLAIM);
  });
});
