// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4302 — what the package door actually PUTs.
 *
 * The card's evidence was the wire, not a toast: an author filled in a
 * row-level-security policy under a writable package, Save reported success,
 * and the body was
 *
 *   `{"name":"qa_st2_rls","label":"QA ST2 RLS","objects":{},"fields":{}}`
 *
 * — no `rowLevelSecurity` key at all, so the row filter was never persisted
 * while the surface claimed a control was in place. Tab visibility and the
 * delegated-admin scope were reverted the same way.
 *
 * These pins therefore assert the SAVED BODY, driving the real
 * `PermissionMatrixEditPage` (load effect, facet editors, `doSave`) against a
 * fake client that behaves like the server. The environment door — the one that
 * already worked — is pinned unchanged as a guard, so the fix cannot be a
 * regression traded for a fix.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const USING = 'owner_id == current_user.id';

/**
 * The USING editor is selected by its placeholder, not by its label: the RLS
 * facet renders `CelPredicateField` without the optional `id`, so its
 * `Label htmlFor` associates with no control and `getByLabelText` cannot find
 * it. Reported as an out-of-scope accessibility finding rather than fixed here.
 */
const USING_PLACEHOLDER = 'organization_id == current_user.organization_id';

interface Server {
  /** The published record — what `layered()` answers, i.e. the merge `base`. */
  set: Record<string, unknown>;
  /** A pending package draft, if any (ADR-0086 P2 D6). */
  draft: Record<string, unknown> | null;
  packageObjects: Array<{ name: string; label?: string }>;
  objectFields: Record<string, { fields?: unknown } | undefined>;
  saved: Array<Record<string, unknown>>;
  savedOpts: Array<Record<string, unknown> | undefined>;
}

function makeClient(server: Server) {
  return {
    layered: async () => ({ effective: server.set, code: null, overlay: null, overlayScope: null }),
    getDraft: async () => (server.draft ? { item: server.draft } : null),
    list: async (type: string) => {
      if (type === 'object') return server.packageObjects.map((o) => ({ item: o }));
      return [];
    },
    get: async (type: string, name: string) => (type === 'object' ? server.objectFields[name] ?? null : null),
    save: async (
      _type: string,
      _name: string,
      payload: Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      server.saved.push(payload);
      server.savedOpts.push(opts);
      server.set = payload;
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

function freshServer(): Server {
  return {
    draft: null,
    packageObjects: [{ name: 'a_account' }, { name: 'a_contact' }],
    objectFields: {
      a_account: { fields: [{ name: 'organization_id' }, { name: 'name' }] },
      a_contact: { fields: [{ name: 'email' }] },
    },
    saved: [],
    savedOpts: [],
    set: {
      name: 'sales_perms',
      label: 'Sales',
      systemPermissions: ['api_enabled'],
      // Tab rows are NOT package-scoped by the panel — the editor shows the
      // whole map and edits it in place, which is why holding it back on save
      // discarded the author's edit rather than protecting anyone's rows.
      tabPermissions: { a_account: 'visible', b_order: 'default_on' },
      objects: {
        a_account: { allowRead: true, allowCreate: true },
        a_contact: { allowRead: true },
        // Package B's contribution — must survive every save byte-for-byte.
        b_order: { allowRead: true, allowEdit: true, viewAllRecords: true },
      },
      fields: { 'b_order.total': { readable: true, editable: true } },
    },
  };
}

function renderDoor(packageId?: string) {
  return render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name="sales_perms" packageId={packageId} />
    </MemoryRouter>,
  );
}

/** Expand a collapsed facet section by its title. */
function openFacet(title: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(title) }));
}

/**
 * Author one policy, one tab-visibility change and a delegated-admin scope
 * through the real facet editors — the card's reproduction, minus the browser.
 */
async function authorEveryFacet() {
  openFacet('Row-Level Security');
  fireEvent.click(await screen.findByRole('button', { name: /Add policy/ }));
  fireEvent.change(await screen.findByPlaceholderText('Policy name'), {
    target: { value: 'qa_st2_rls' },
  });
  fireEvent.change(screen.getByPlaceholderText('Object (* = all)'), {
    target: { value: 'a_account' },
  });
  fireEvent.change(screen.getByPlaceholderText(USING_PLACEHOLDER), { target: { value: USING } });

  openFacet('Tab Visibility');
  // The visibility picker is the shared Select (objectui#11865): open it and pick, as a user does.
  fireEvent.keyDown(await screen.findByTestId('tab-visibility-a_account'), { key: 'ArrowDown' });
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'Hidden' }));

  openFacet('Delegated Admin Scope');
  const businessUnit = (await screen.findByText('Business unit')).parentElement!.querySelector(
    'input',
  )!;
  fireEvent.change(businessUnit, { target: { value: 'emea' } });
}

const AUTHORED_POLICY = {
  name: 'qa_st2_rls',
  object: 'a_account',
  operation: 'all',
  using: USING,
  enabled: true,
};

describe('PermissionMatrixEditPage — the PACKAGE door persists every authored facet (objectui#4302)', () => {
  it('PUTs the authored RLS policy, tab visibility and admin scope', async () => {
    const server = freshServer();
    clientImpl = makeClient(server);
    renderDoor('app.a');
    await screen.findByText('a_account');

    await authorEveryFacet();

    // objectui#11787 — the package door autosaves to its draft after the
    // shared autosave's pause; it has no Save button. An authoring pause along
    // the way may send an earlier body, so the save read is the one carrying
    // the last facet authored.
    await waitFor(
      () => expect((server.saved.at(-1) as any)?.adminScope).toEqual({ businessUnit: 'emea' }),
      { timeout: 4000 },
    );
    const body = server.saved.at(-1) as any;

    // The row filter reaches the wire — the key whose absence was the defect.
    expect(body.rowLevelSecurity).toEqual([AUTHORED_POLICY]);
    // …and so do the other two facets the whitelist reverted.
    expect(body.tabPermissions).toEqual({ a_account: 'hidden', b_order: 'default_on' });
    expect(body.adminScope).toEqual({ businessUnit: 'emea' });

    // ADR-0086 P0 — package B's rows still survive byte-for-byte.
    expect(body.objects.b_order).toEqual({
      allowRead: true,
      allowEdit: true,
      viewAllRecords: true,
    });
    expect(body.fields['b_order.total']).toEqual({ readable: true, editable: true });
    // ADR-0086 P2 (D6/D7) — still a package-stamped DRAFT write, not a live one.
    expect(server.savedOpts.at(-1)).toMatchObject({ mode: 'draft', packageId: 'app.a' });
  });

  it('keeps a policy carried by the pending draft when the published base has none', async () => {
    // The D6 reopen path: a previous package save staged the policy in the
    // draft; the published record has not moved. The merge base is the
    // PUBLISHED read, so a whitelist that takes facets from `base` erases the
    // staged policy on the next save — silently, again.
    const server = freshServer();
    server.draft = { ...(server.set as Record<string, unknown>), rowLevelSecurity: [AUTHORED_POLICY] };
    clientImpl = makeClient(server);
    renderDoor('app.a');
    await screen.findByText('a_account');

    // An edit elsewhere on the panel — the author is not touching RLS at all.
    const row = screen.getByText('a_account').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'None' }));

    // objectui#11787 — autosaved after the shared pause (no Save button here).
    await waitFor(() => expect(server.saved).toHaveLength(1), { timeout: 4000 });
    const body = server.saved[0] as any;

    expect(body.rowLevelSecurity).toEqual([AUTHORED_POLICY]);
    expect(body.objects.a_account).toEqual({});
    expect(body.objects.b_order).toEqual({
      allowRead: true,
      allowEdit: true,
      viewAllRecords: true,
    });
  });
});

describe('PermissionMatrixEditPage — the ENVIRONMENT door is unchanged (guard)', () => {
  it('still PUTs the whole record, with no draft/package options', async () => {
    const server = freshServer();
    clientImpl = makeClient(server);
    renderDoor(undefined);
    await screen.findByText('a_account');

    await authorEveryFacet();

    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(server.saved).toHaveLength(1));
    const body = server.saved[0] as any;

    expect(body.rowLevelSecurity).toEqual([AUTHORED_POLICY]);
    expect(body.tabPermissions).toEqual({ a_account: 'hidden', b_order: 'default_on' });
    expect(body.adminScope).toEqual({ businessUnit: 'emea' });
    // The environment door writes the record live — no `mode: 'draft'`, no
    // `packageId`, and no slice merge in front of it.
    expect(server.savedOpts[0]).toEqual({ force: false });
    expect(body.objects.b_order).toEqual({
      allowRead: true,
      allowEdit: true,
      viewAllRecords: true,
    });
  });
});
