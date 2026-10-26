// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The reset/delete control must render the verb it executes — objectui#4886.
 *
 * ## The defect
 *
 * One button, two independently hand-rolled artifact predicates. The render
 * side asked the page's two-tier `isArtifactItem` (which excludes the
 * `sys_metadata` sentinel and ADR-0010 `provenance: 'org'`); `doReset()`
 * asked a looser one of its own, `layered?.code != null`. For a published
 * org-own entry — whose `code` layer is its own rehydrated `sys_metadata`
 * row — those disagree, so the button rendered `Trash2` with the title
 * "Delete", then asked "Reset overlay for …?" and took the reset branch:
 * refetch layered, stay on the page. A button that said delete, asked reset,
 * and did reset.
 *
 * ## The fix this suite pins
 *
 * Both sides now read ONE value, and it is the server's: `resolveLockState`
 * computes `resettable = artifactBacked` and ships it on the layered
 * envelope. The page consumes that verdict instead of re-deriving it, and
 * reads it as an honest tri-state — `layered?.resettable !== false` used to
 * collapse "no opinion" into "true", promising a baseline that may not exist.
 *
 * Each case therefore asserts all THREE surfaces of the same entry together
 * — icon + `title`, confirm text, and the branch actually taken. Asserting
 * any one alone is what let the defect live: every individual surface was
 * self-consistent, only the trio disagreed.
 *
 * ## Measured, not assumed (the two dispatch preconditions)
 *
 * 1. `client.reset()` is `DELETE /meta/:type/:name`. For an entry with no
 *    artifact baseline the server's `deleteMetaItem` routes to
 *    `SysMetadataRepository.delete`, which HARD-deletes the `sys_metadata`
 *    row, appends an `operation_type: 'delete'` tombstone, and retires the
 *    item's registry entry because no layer beneath it can serve the name.
 *    The row IS the entry, so the call destroys it — and the server says so
 *    itself: its receipt for this population reads `Deleted <type> '<name>'
 *    — it no longer exists.`, against `… reset to artifact default.` for the
 *    backed one. "Delete" is the honest verb, which is the maintainer's
 *    2026-08-17 ruling on this card.
 * 2. For that same population the server answers `resettable: false`:
 *    `resettable = artifactBacked = lookupArtifactItem(...) !== undefined`,
 *    and `SchemaRegistry.getArtifactItem` returns `undefined` for both the
 *    `sys_metadata` sentinel and `_provenance: 'org'`. The server is right;
 *    only these two client-side re-derivations were wrong.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/** Body of the entry under test, minus the provenance tags each case adds. */
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
  reset: vi.fn(async () => ({ success: true, reset: true })),
};

// Both tier flags are true so `canWrite` is satisfied on either side of the
// artifact/org split: this suite is about which VERB the control carries, not
// about the two-tier write gate (that one is pinned by
// `ResourceEditPage.artifactTier.test.tsx`).
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
          allowEnvironmentOverlay: true,
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

const START_PATH = '/metadata/object/showcase_account';
/** Where the delete branch is supposed to land: the type's list view. */
const LIST_PATH = '/metadata/object';

/** Renders the live pathname so "navigated back" is observed, not mocked. */
function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="pathname">{loc.pathname}</span>;
}

/**
 * The editor mounted under the route it really lives on. A real `<Routes>`
 * matters here rather than a bare `MemoryRouter`: the delete branch navigates
 * with `{ relative: 'path' }`, which resolves against the matched route — with
 * no route to match, `../` lands on `/` and the assertion would be testing the
 * harness instead of the page.
 */
function editorUnderRoute() {
  return (
    <MemoryRouter initialEntries={[START_PATH]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/metadata/:type/:name"
          element={<MetadataResourceEditPage type="object" name="showcase_account" />}
        />
        <Route path="/metadata/:type" element={<span data-testid="list-view">list</span>} />
      </Routes>
    </MemoryRouter>
  );
}

/**
 * What the confirm dialog actually asked — its title, then its body. The
 * confirm is the page's in-app AlertDialog (objectui#13333); the browser's
 * native `confirm` is stubbed only as a tripwire that must never be called.
 */
const confirmMessages: string[] = [];
const nativeConfirm = vi.fn(() => true);

beforeEach(() => {
  confirmMessages.length = 0;
  nativeConfirm.mockClear();
  vi.stubGlobal('confirm', nativeConfirm);
});

/** Click the control, read the in-app confirm it opens, and answer yes. */
async function clickAndConfirm(btn: HTMLElement) {
  await userEvent.click(btn);
  const dialog = await screen.findByRole('alertdialog');
  confirmMessages.push(within(dialog).getByRole('heading').textContent ?? '');
  confirmMessages.push(within(dialog).getByTestId('resource-edit-confirm-body').textContent ?? '');
  await userEvent.click(within(dialog).getByTestId('resource-edit-confirm-action'));
  expect(nativeConfirm).not.toHaveBeenCalled();
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/**
 * Mount the editor over one layered envelope and return the control.
 * Every fixture carries a non-null `overlay` — the button only renders for
 * an entry that HAS a customization to reset or delete.
 */
async function mountWithEnvelope(layered: Record<string, unknown>) {
  layeredImpl.current = vi.fn(async () => layered);
  render(editorUnderRoute());
  await waitFor(() => expect(mockClient.layered).toHaveBeenCalled());
  return await screen.findByTestId('reset-or-delete-button');
}

/** Current pathname, trailing slash normalised away (`navigate('../')`). */
function pathname(): string {
  const raw = screen.getByTestId('pathname').textContent ?? '';
  return raw.length > 1 ? raw.replace(/\/+$/, '') : raw;
}

/**
 * A published org-own entry as the server actually ships it: the `code` layer
 * is the entry's own rehydrated `sys_metadata` row, so `code != null` — the
 * exact shape the old `doReset()` predicate misread — while the server's
 * verdict says there is no baseline behind it.
 */
const ORG_OWN_SENTINEL = {
  code: { ...objectDef, _packageId: 'sys_metadata' },
  overlay: { ...objectDef, label: 'Account (customized)' },
  overlayScope: 'env',
  effective: { ...objectDef, label: 'Account (customized)' },
  packageId: 'sys_metadata',
  editable: true,
  deletable: true,
  resettable: false,
};

/** A genuine packaged artifact carrying an environment overlay on top. */
const PACKAGED_WITH_OVERLAY = {
  code: { ...objectDef, _packageId: 'com.example.showcase', _provenance: 'package' },
  overlay: { ...objectDef, label: 'Account (customized)' },
  overlayScope: 'env',
  effective: { ...objectDef, label: 'Account (customized)' },
  provenance: 'package',
  packageId: 'com.example.showcase',
  editable: true,
  deletable: true,
  resettable: true,
};

describe('ResourceEditPage — one server verdict drives icon, confirm and branch (#4886)', () => {
  it('resettable:false — renders Delete, ASKS delete, and leaves the page', async () => {
    // The card's population. `code != null` here, which is precisely why the
    // old execute-side predicate said "artifact" and reset; the server says
    // there is no baseline, so the DELETE this button issues destroys the
    // entry and the current URL stops referring to anything.
    const btn = await mountWithEnvelope(ORG_OWN_SENTINEL);

    expect(btn).toHaveAttribute('title', 'Delete');
    expect(screen.getByTestId('delete-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('reset-icon')).toBeNull();

    await clickAndConfirm(btn);

    // No `?package=` on this editor's URL, so the options carry no package
    // key at all (objectui#12335): absent, never empty.
    await waitFor(() => expect(mockClient.reset).toHaveBeenCalledWith('object', 'showcase_account', {}));
    expect(confirmMessages).toEqual([
      'Delete Object "Account (customized)"?',
      'object/showcase_account is deleted. This cannot be undone.',
    ]);
    await waitFor(() => expect(pathname()).toBe(LIST_PATH));
  });

  it('resettable:true — renders Reset overlay, ASKS reset, and stays put', async () => {
    // The other half of the same verdict: a baseline exists, so the overlay
    // is peeled and the code default remains — the page must survive.
    const btn = await mountWithEnvelope(PACKAGED_WITH_OVERLAY);

    expect(btn).toHaveAttribute('title', 'Reset overlay');
    expect(screen.getByTestId('reset-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('delete-icon')).toBeNull();

    await clickAndConfirm(btn);

    await waitFor(() => expect(mockClient.reset).toHaveBeenCalledWith('object', 'showcase_account', {}));
    expect(confirmMessages).toEqual([
      'Reset the overlay on Object "Account (customized)"?',
      'Your customization of object/showcase_account is removed and its code-defined version applies again.',
    ]);
    // The reset branch re-reads the layered envelope in place …
    await waitFor(() => expect(mockClient.layered.mock.calls.length).toBeGreaterThan(1));
    // … and does NOT navigate away.
    expect(pathname()).toBe(START_PATH);
  });

  it('no verdict + packaged code layer — falls back to the conservative reset reading', async () => {
    // Pre-ADR-0010 server: the envelope carries no `resettable`. We do not
    // invent one — the page falls back to its own artifact tier, which for a
    // genuine packaged item is "reset", i.e. exactly the legacy rendering.
    const { resettable: _omitted, ...noVerdict } = PACKAGED_WITH_OVERLAY;
    const btn = await mountWithEnvelope(noVerdict);

    expect(btn).toHaveAttribute('title', 'Reset overlay');

    await clickAndConfirm(btn);

    await waitFor(() => expect(mockClient.reset).toHaveBeenCalled());
    expect(confirmMessages).toEqual([
      'Reset the overlay on Object "Account (customized)"?',
      'Your customization of object/showcase_account is removed and its code-defined version applies again.',
    ]);
    expect(pathname()).toBe(START_PATH);
  });

  it('no verdict + org-own code layer — "no opinion" is NOT collapsed into resettable', async () => {
    // The tri-state that the old `layered?.resettable !== false` erased. With
    // no verdict AND a sentinel code layer the conservative fallback is the
    // page's own tier, which correctly reads this entry as org-own → delete.
    // Under the old collapse this same entry rendered delete and executed
    // reset; the point of the fallback is that both sides move together.
    const { resettable: _omitted, ...noVerdict } = ORG_OWN_SENTINEL;
    const btn = await mountWithEnvelope(noVerdict);

    expect(btn).toHaveAttribute('title', 'Delete');
    expect(screen.getByTestId('delete-icon')).toBeInTheDocument();

    await clickAndConfirm(btn);

    await waitFor(() => expect(mockClient.reset).toHaveBeenCalled());
    expect(confirmMessages).toEqual([
      'Delete Object "Account (customized)"?',
      'object/showcase_account is deleted. This cannot be undone.',
    ]);
    await waitFor(() => expect(pathname()).toBe(LIST_PATH));
  });

  it('server verdict outranks the client tier: provenance-org entry with resettable:true resets', async () => {
    // The verdict is the authority, not a tie-breaker layered on top of the
    // old heuristic. An entry the page's own tier would call org-own
    // (`provenance: 'org'`) but the server says IS artifact-backed must
    // render and execute reset — otherwise the client is still deciding.
    const btn = await mountWithEnvelope({
      ...ORG_OWN_SENTINEL,
      code: { ...objectDef, _packageId: 'com.example.base', _provenance: 'org' },
      provenance: 'org',
      packageId: 'com.example.base',
      resettable: true,
    });

    expect(btn).toHaveAttribute('title', 'Reset overlay');

    await clickAndConfirm(btn);

    await waitFor(() => expect(mockClient.reset).toHaveBeenCalled());
    expect(confirmMessages).toEqual([
      'Reset the overlay on Object "Account (customized)"?',
      'Your customization of object/showcase_account is removed and its code-defined version applies again.',
    ]);
    expect(pathname()).toBe(START_PATH);
  });

  it('deletable:false hides the control for BOTH verbs — the server gates one DELETE', async () => {
    // Reset and delete are the same `DELETE /meta/:type/:name`, and the
    // server gates it once (`assertLockAllowsDelete` → `evaluateLockForDelete`)
    // regardless of artifact backing. Rendering a Reset button the server
    // would answer 403 ITEM_LOCKED is the same "second copy of the contract"
    // this card removes, so `deletable` gates both.
    layeredImpl.current = vi.fn(async () => ({
      ...PACKAGED_WITH_OVERLAY,
      lock: 'no-delete',
      deletable: false,
    }));
    render(editorUnderRoute());
    await waitFor(() => expect(mockClient.layered).toHaveBeenCalled());
    expect(screen.queryByTestId('reset-or-delete-button')).toBeNull();
  });
});
