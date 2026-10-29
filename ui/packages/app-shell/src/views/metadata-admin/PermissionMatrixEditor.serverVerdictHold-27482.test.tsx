// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27482 — a server error at an RLS clause's own path holds the
 * package door's autosave, the way a CEL parse fault does.
 *
 * objectstack#26858 made the clause SHOW the draft read's verdict; it never
 * reached `celErrorCount`, so an expression the publish refuses (a USING that
 * reads a formula field) kept autosaving with the server's message on screen.
 * The verdict judges the stored draft and nothing else, so it holds while the
 * clause still shows the text it judged, and lets the edit that changes that
 * text go out: only that save brings the next verdict. ⛔ The fake door below
 * is the only place the refusal is decided; the editor restates no rule.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const REFUSED_USING = 'f_total > 5';
const ACCEPTED_USING = 'owner_id == current_user.id';
const REFUSAL = "rowLevelSecurity 'hot_deals' using reads 'f_total', a formula field the database cannot filter on";

const SET = {
  name: 'sales_perms',
  label: 'Sales',
  objects: { a_account: { allowRead: true } },
  fields: {},
};

interface Server {
  draft: Record<string, unknown> | null;
  draftReads: number;
  /** Every body a save sent. */
  sent: Array<Record<string, unknown>>;
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
    withPreviewDrafts() { return this; },
    list: async (type: string) => (type === 'object' ? [{ item: { name: 'a_account' } }] : []),
    get: async () => null,
    save: async (_type: string, _name: string, payload: Record<string, unknown>) => {
      const body = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
      server.sent.push(body);
      server.draft = body;
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
const CHECK_PLACEHOLDER = 'optional — defaults to USING';
/** The shared autosave fires 1.5s after the last edit. */
const AUTOSAVE = { timeout: 5000 };
/** Longer than the autosave's pause. */
const PAST_THE_PAUSE = 2500;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const policy = (using: string) => ({
  ...SET,
  rowLevelSecurity: [{ name: 'hot_deals', object: 'a_account', operation: 'select', using, enabled: true }],
});

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

const edit = (placeholder: string, value: string) =>
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });

describe('a server error at a clause path holds the autosave (objectstack#27482)', () => {
  it('(a) a stored draft the publish refuses: another edit is held, no PUT, the server message stays', async () => {
    const server: Server = { draft: policy(REFUSED_USING), draftReads: 0, sent: [] };
    await openPackageDoor(server);
    await screen.findByText(REFUSAL);

    edit(CHECK_PLACEHOLDER, ACCEPTED_USING);

    await waitFor(() => expect(screen.getByTestId('perm-autosave-held')).toBeInTheDocument(), AUTOSAVE);
    await pause(PAST_THE_PAUSE);
    expect(server.sent).toHaveLength(0);
    expect(screen.getByText(REFUSAL)).toBeInTheDocument();
  });

  it('(b) the card flow: the refused clause saves once, its re-read holds the next edit', async () => {
    const server: Server = { draft: policy(ACCEPTED_USING), draftReads: 0, sent: [] };
    await openPackageDoor(server);
    await screen.findByText('Valid CEL', {}, { timeout: 3000 });

    // No client copy of the rule: the lint passes it and the first save goes out.
    edit(USING_PLACEHOLDER, REFUSED_USING);
    await waitFor(() => expect(server.sent).toHaveLength(1), AUTOSAVE);
    expect(await screen.findByText(REFUSAL, {}, AUTOSAVE)).toBeInTheDocument();

    edit(CHECK_PLACEHOLDER, ACCEPTED_USING);
    await waitFor(() => expect(screen.getByTestId('perm-autosave-held')).toBeInTheDocument(), AUTOSAVE);
    await pause(PAST_THE_PAUSE);
    expect(server.sent).toHaveLength(1);
  });

  it('(c) editing the clause away releases: the save goes out and its clean re-read clears the verdict', async () => {
    const server: Server = { draft: policy(REFUSED_USING), draftReads: 0, sent: [] };
    await openPackageDoor(server);
    await screen.findByText(REFUSAL);

    edit(USING_PLACEHOLDER, ACCEPTED_USING);

    await waitFor(() => expect(server.sent).toHaveLength(1), AUTOSAVE);
    await waitFor(() => expect(screen.queryByText(REFUSAL)).toBeNull(), AUTOSAVE);
    expect(await screen.findByTestId('perm-saved-at', {}, AUTOSAVE)).toBeInTheDocument();
    expect(screen.queryByTestId('perm-autosave-held')).toBeNull();
  });

  it('(d) typed back to the judged text before the autosave fires: held again, no PUT', async () => {
    const server: Server = { draft: policy(REFUSED_USING), draftReads: 0, sent: [] };
    await openPackageDoor(server);
    await screen.findByText(REFUSAL);

    edit(CHECK_PLACEHOLDER, ACCEPTED_USING);
    edit(USING_PLACEHOLDER, 'f_total > 50');
    edit(USING_PLACEHOLDER, REFUSED_USING);

    await waitFor(() => expect(screen.getByTestId('perm-autosave-held')).toBeInTheDocument(), AUTOSAVE);
    await pause(PAST_THE_PAUSE);
    expect(server.sent).toHaveLength(0);
  });
});

/**
 * objectstack#27452 — the verdict on the previous text is not shown under new
 * text. An edit the lint holds never saves, so nothing re-reads the draft and
 * the served verdict stays the one on the stored text; the clause shows only
 * the error that applies to what it holds.
 */
describe('a lint-held edit does not show the previous text\'s server verdict (objectstack#27452)', () => {
  /** A parse fault: the client lint holds it on its own. */
  const HELD_BY_LINT = 'f_total >';

  it('the server message leaves with its text; the client error and the hold stay, no PUT', async () => {
    const server: Server = { draft: policy(REFUSED_USING), draftReads: 0, sent: [] };
    await openPackageDoor(server);
    await screen.findByText(REFUSAL);
    const reads = server.draftReads;

    edit(USING_PLACEHOLDER, HELD_BY_LINT);

    await waitFor(() => expect(screen.getByTestId('perm-autosave-held')).toBeInTheDocument(), AUTOSAVE);
    await waitFor(() => expect(screen.getByPlaceholderText(USING_PLACEHOLDER)).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.queryByText(REFUSAL)).toBeNull();
    await pause(PAST_THE_PAUSE);
    expect(server.sent).toHaveLength(0);
    expect(server.draftReads).toBe(reads);
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });

  it('control: typed back to the judged text, the server message is shown again', async () => {
    const server: Server = { draft: policy(REFUSED_USING), draftReads: 0, sent: [] };
    await openPackageDoor(server);
    await screen.findByText(REFUSAL);

    edit(USING_PLACEHOLDER, HELD_BY_LINT);
    await waitFor(() => expect(screen.queryByText(REFUSAL)).toBeNull());
    edit(USING_PLACEHOLDER, REFUSED_USING);

    expect(await screen.findByText(REFUSAL)).toBeInTheDocument();
  });
});
