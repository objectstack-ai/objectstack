// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package door's save merges onto the PENDING DRAFT when one exists, not
 * onto the published body (objectstack#26837).
 *
 * ## The defect these pins reach
 *
 * `doSave`'s package-door arm re-reads the set and merges this package's slice
 * onto that read with `mergePermissionSlice`, which takes only the facets the
 * editor can author from the edited body and everything else from the base.
 * The base was `client.layered(...).effective` — the PUBLISHED body — while the
 * save itself writes the package DRAFT. So a draft another door wrote (the
 * card's reproduction: `PUT …?mode=draft&package=P` with `description` and
 * `packageId`) lost those keys on the next Studio edit: the load displayed the
 * draft, one checkbox autosaved, and the PUT carried the published values (or
 * none) in their place. 200, no error.
 *
 * ## Why the pin drives the REAL editor
 *
 * `mergePermissionSlice` is correct for any base it is handed — its own pins
 * (`permission-slice.authoredKeys.test.ts`, `permission-slice.facetDrift.test.ts`)
 * call it directly and could never see this. The defect is the CHOICE of base,
 * which only `doSave` makes, so these pins run the real page, the real load and
 * the real autosave (objectui#11787: the package door has no Save button).
 *
 * ## The arms, and what each one's absence is read against
 *
 *  1. A pending draft whose non-authored keys differ from the published body:
 *     every one of them is on the wire byte-for-byte, out-of-scope rows come
 *     from the draft, and the edited row lands.
 *  2. No pending draft: the base is still the published `effective`, so the
 *     published body's own keys and other packages' rows are on the wire —
 *     the control that the draft arm is not "the edited body, wholesale".
 *  3. The save-time DRAFT read rejects: the save is refused on the same
 *     channel as objectui#9420's layered refusal, `client.save` is never
 *     called, and the control `getDraftCalls === 2` proves the read ran.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The published record. `a_account` is the door's own package; `b_order` and
 * `b_order.total` are another package's grants.
 */
const PUBLISHED = {
  name: 'sales_perms',
  label: 'Sales',
  description: 'Published description',
  objects: {
    a_account: { allowRead: true, allowCreate: true },
    b_order: { allowRead: true },
  },
  fields: { 'b_order.total': { readable: true, editable: false } },
};

/**
 * The pending package draft another door wrote — every key the editor cannot
 * author differs from {@link PUBLISHED}, and so does an out-of-scope row, so a
 * value taken from the wrong base cannot pass for the right one.
 */
const DRAFT = {
  name: 'sales_perms',
  label: 'Sales',
  description: 'Set through the API',
  packageId: 'app.a',
  objects: {
    a_account: { allowRead: true, allowCreate: true },
    b_order: { allowRead: true, allowEdit: true, viewAllRecords: true },
  },
  fields: { 'b_order.total': { readable: true, editable: true } },
};

/** The facets `EDITOR_AUTHORED_KEYS` does not name — the ones the base supplies. */
const NON_AUTHORED = ['description', 'packageId'] as const;

/** Distinctive slice of the refusal the author sees on the page's error strip. */
const REFUSAL = /could not be re-read/;

interface Server {
  saved: Array<Record<string, unknown>>;
  savedOpts: Array<Record<string, unknown> | undefined>;
  /** `getDraft` calls seen so far — #1 is the load, #2 is `doSave`'s re-read. */
  getDraftCalls: number;
}

function freshServer(): Server {
  return { saved: [], savedOpts: [], getDraftCalls: 0 };
}

function makeClient(server: Server, opts: { draft: Record<string, unknown> | null; rejectSaveTimeDraft?: boolean }) {
  return {
    layered: async () => ({ effective: PUBLISHED, code: null, overlay: null, overlayScope: null }),
    getDraft: async () => {
      server.getDraftCalls += 1;
      if (opts.rejectSaveTimeDraft && server.getDraftCalls > 1) throw new Error('draft read failed');
      return opts.draft ? { type: 'permission', name: 'sales_perms', item: opts.draft, version: 'v1' } : null;
    },
    // objectstack#26840 — the package door reads its objects through the draft-overlaid door.
    withPreviewDrafts() { return this; },
    // The package declares `a_account` only.
    list: async (type: string) => (type === 'object' ? [{ item: { name: 'a_account' } }] : []),
    get: async () => null,
    save: async (
      _type: string,
      _name: string,
      payload: Record<string, unknown>,
      saveOpts?: Record<string, unknown>,
    ) => {
      server.saved.push(payload);
      server.savedOpts.push(saveOpts);
      return payload;
    },
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

afterEach(cleanup);

function renderPackageDoor() {
  return render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name="sales_perms" packageId="app.a" />
    </MemoryRouter>,
  );
}

/** One ordinary edit: revoke every grant on the door's own `a_account` row. */
function editAccountRow() {
  const row = screen.getByText('a_account').closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: 'None' }));
}

/** The package door autosaves after the shared pause (1.5s). */
const AUTOSAVE = { timeout: 4000 };

describe('PermissionMatrixEditPage — the PACKAGE door saves onto the pending draft (objectstack#26837)', () => {
  it('keeps every key the editor does not author from the pending draft, byte-for-byte', async () => {
    const server = freshServer();
    clientImpl = makeClient(server, { draft: DRAFT });
    renderPackageDoor();
    await screen.findByText('a_account');

    editAccountRow();

    await waitFor(() => expect(server.saved).toHaveLength(1), AUTOSAVE);
    const body = server.saved[0] as any;

    // The edited row lands…
    expect(body.objects.a_account).toEqual({});
    // …and the draft's non-authored keys survive, not the published ones.
    for (const key of NON_AUTHORED) expect(body[key]).toEqual(DRAFT[key]);
    // Out-of-scope rows come from the draft too: it is what this save replaces.
    expect(body.objects.b_order).toEqual(DRAFT.objects.b_order);
    expect(body.fields).toEqual(DRAFT.fields);
    // CONTROL: the save-time draft read ran (#1 is the load).
    expect(server.getDraftCalls).toBe(2);
    expect(server.savedOpts[0]).toMatchObject({ mode: 'draft', packageId: 'app.a' });
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });

  it('CONTROL — with no pending draft the base is still the published body', async () => {
    const server = freshServer();
    clientImpl = makeClient(server, { draft: null });
    renderPackageDoor();
    await screen.findByText('a_account');

    editAccountRow();

    await waitFor(() => expect(server.saved).toHaveLength(1), AUTOSAVE);
    const body = server.saved[0] as any;

    expect(body.objects.a_account).toEqual({});
    expect(body.description).toBe(PUBLISHED.description);
    expect('packageId' in body).toBe(false);
    expect(body.objects.b_order).toEqual(PUBLISHED.objects.b_order);
    expect(body.fields).toEqual(PUBLISHED.fields);
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });

  it('REFUSES the save when the save-time draft read rejects, rather than fall back to the published body', async () => {
    const server = freshServer();
    clientImpl = makeClient(server, { draft: DRAFT, rejectSaveTimeDraft: true });
    renderPackageDoor();
    await screen.findByText('a_account');

    editAccountRow();

    // Settle on either arm — the refusal on screen, or a PUT landing.
    await waitFor(
      () => expect(server.saved.length > 0 || screen.queryByText(REFUSAL) !== null).toBe(true),
      AUTOSAVE,
    );

    // CONTROL: the save-time draft read really ran and really rejected.
    expect(server.getDraftCalls).toBe(2);
    expect(server.saved).toEqual([]);
    expect(server.savedOpts).toEqual([]);
    // The same error strip objectui#9420's layered refusal renders into.
    expect(screen.getByText(REFUSAL)).toBeInTheDocument();
    expect(screen.queryByTestId('perm-autosaving')).toBeNull();
  });
});
