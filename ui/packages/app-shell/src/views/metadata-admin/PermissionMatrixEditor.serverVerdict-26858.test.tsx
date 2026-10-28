// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26858 — the permission-set editor hands its RLS clause editors
 * the served verdict on the set on screen.
 *
 * The set's page is its own: it holds the draft read itself and strips the
 * read decorations off the body, so the verdict the draft read serves (since
 * objectstack#26707, what its publish will refuse) never reached a field. The
 * page now keeps that verdict and provides it, and reads it again after each
 * package-door save, so the field follows the draft it describes.
 *
 * The fake door below serves a draft whose `_diagnostics` refuses its USING
 * clause the way `rls-predicate-unenforceable` does, until the clause changes.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const REFUSED_USING = 'deal_score > 5';
const REFUSAL =
  "rowLevelSecurity 'hot_deals' using reads 'deal_score', a formula field the database cannot filter on";

const SET = {
  name: 'sales_perms',
  label: 'Sales',
  objects: { a_account: { allowRead: true } },
  fields: {},
};

interface Server {
  draft: Record<string, unknown> | null;
  draftReads: number;
}

/** The door's publish verdict on a stored draft: it refuses the one USING clause. */
function verdictOf(body: Record<string, unknown>) {
  const rows = (body.rowLevelSecurity ?? []) as Array<{ using?: string }>;
  const errors = rows.flatMap((r, i) =>
    r.using === REFUSED_USING
      ? [{ path: `rowLevelSecurity.${i}.using`, message: REFUSAL, code: 'rls-predicate-unenforceable' }]
      : [],
  );
  return errors.length ? { valid: false, errors } : { valid: true };
}

// `withPreviewDrafts` answers the client itself, not a promise (objectstack#26840).
type FakeClient = Record<string, (...args: never[]) => unknown>;

function makeClient(server: Server): FakeClient {
  return {
    layered: async () => ({ effective: SET, code: null, overlay: null, overlayScope: null }),
    getDraft: async () => {
      server.draftReads += 1;
      return server.draft
        ? { type: 'permission', name: 'sales_perms', item: { ...server.draft, _draft: true, _diagnostics: verdictOf(server.draft) } }
        : null;
    },
    // objectstack#26840 — the package door reads its objects through the draft-overlaid door.
    withPreviewDrafts() { return this; },
    list: async (type: string) => (type === 'object' ? [{ item: { name: 'a_account' } }] : []),
    get: async () => null,
    save: async (_type: string, _name: string, payload: Record<string, unknown>) => {
      server.draft = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
      return payload;
    },
  };
}

let clientImpl: FakeClient;

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

const USING_PLACEHOLDER = 'organization_id == current_user.organization_id';

async function openPackageDoor(server: Server) {
  clientImpl = makeClient(server);
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name="sales_perms" packageId="app.a" />
    </MemoryRouter>,
  );
  await screen.findByText('a_account');
  fireEvent.click(screen.getByRole('button', { name: /Row-Level Security/ }));
}

const policy = (using: string) => ({
  ...SET,
  rowLevelSecurity: [{ name: 'hot_deals', object: 'a_account', operation: 'select', using, enabled: true }],
});

describe('the permission-set editor provides the served verdict to its RLS clauses (objectstack#26858)', () => {
  it('a pending draft the publish refuses: the USING clause shows the server message, not "Valid CEL"', async () => {
    const server: Server = { draft: policy(REFUSED_USING), draftReads: 0 };
    await openPackageDoor(server);
    expect(await screen.findByText(REFUSAL)).toBeInTheDocument();
    // The lint itself answered: the clause parses, and only the server refuses it.
    await waitFor(() => expect(screen.getByPlaceholderText(USING_PLACEHOLDER)).toHaveValue(REFUSED_USING));
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByText('Valid CEL')).toBeNull();
  });

  it('the verdict follows the draft: after an autosave of a changed clause the refusal goes', async () => {
    const server: Server = { draft: policy(REFUSED_USING), draftReads: 0 };
    await openPackageDoor(server);
    await screen.findByText(REFUSAL);
    const readsBefore = server.draftReads;

    fireEvent.change(screen.getByPlaceholderText(USING_PLACEHOLDER), { target: { value: 'owner_id == current_user.id' } });

    await waitFor(() => expect(server.draftReads).toBeGreaterThan(readsBefore), { timeout: 5000 });
    await waitFor(() => expect(screen.queryByText(REFUSAL)).toBeNull(), { timeout: 5000 });
    expect(await screen.findByText('Valid CEL', {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it('control: a draft the publish accepts reads "Valid CEL"', async () => {
    const server: Server = { draft: policy('owner_id == current_user.id'), draftReads: 0 };
    await openPackageDoor(server);
    expect(await screen.findByText('Valid CEL', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });
});
