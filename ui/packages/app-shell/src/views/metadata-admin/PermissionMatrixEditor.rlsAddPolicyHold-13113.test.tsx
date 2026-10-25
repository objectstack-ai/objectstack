// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13113 — "Add policy" inserts a blank RLS row, and the package door's
 * autosave used to send it at once: the server refused the nameless row with a
 * 422 the strip printed as schema paths and zod codes
 * (`rowLevelSecurity.0.name [invalid_format]`) before the author had typed.
 *
 * Pinned here, driving the real `PermissionMatrixEditPage` against a fake
 * client that refuses the way the door does:
 * - an unnamed row is INCOMPLETE: the autosave holds, the row says what it
 *   needs, and nothing is sent or refused;
 * - naming it lets the save go;
 * - a refusal naming a policy name reads in the author's words, mapped from the
 *   refusal's own issue paths; any other refusal keeps the transport's text.
 *
 * Every absence is read against a presence from the same harness: the named
 * row that saves is the control for the unnamed row that does not, and a CEL
 * error still holds as it did.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PUBLISHED = {
  name: 'sales_perms',
  label: 'Sales',
  objects: { a_account: { allowRead: true } },
  fields: {},
};

const LAYERED = { effective: PUBLISHED, code: null, overlay: null, overlayScope: null };

/** The USING editor is found by its placeholder (its label is not associated). */
const USING_PLACEHOLDER = 'organization_id == current_user.organization_id';

/** The door's refusal, as `MetadataClient`'s `parseError` hands it over. */
interface Refusal extends Error {
  status: number;
  issues: Array<{ path: string; message: string; code?: string }>;
}

function refusal(message: string, issues: Refusal['issues']): Refusal {
  return Object.assign(new Error(message), { status: 422, issues });
}

/** A nameless row, refused as the door refused it in the card's measurement. */
const NAMELESS_REFUSAL = () =>
  refusal(
    'permission/sales_perms failed spec validation: 1 issue — rowLevelSecurity.0.name [invalid_format]',
    [
      {
        path: 'rowLevelSecurity.0.name',
        code: 'invalid_format',
        message: 'Invalid string: must match pattern /^[a-z_][a-z0-9_]*$/',
      },
    ],
  );

interface Server {
  /** Every body a save sent, refused or not. */
  sent: Array<Record<string, unknown>>;
  /** What the door answers a body with: a refusal to throw, or nothing (accepted). */
  judge: (body: Record<string, unknown>) => Refusal | null;
}

type FakeClient = Record<string, (...args: never[]) => Promise<unknown>>;

function makeClient(server: Server): FakeClient {
  return {
    layered: async () => LAYERED,
    getDraft: async () => null,
    list: async (type: string) => (type === 'object' ? [{ item: { name: 'a_account' } }] : []),
    get: async () => null,
    save: async (_type: string, _name: string, payload: Record<string, unknown>) => {
      const body = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
      server.sent.push(body);
      const refused = server.judge(body);
      if (refused) throw refused;
      return payload;
    },
  };
}

/** The door's own answer to a nameless row; anything else lands. */
function doorJudge(body: Record<string, unknown>): Refusal | null {
  const rows = (body.rowLevelSecurity ?? []) as Array<{ name?: string }>;
  return rows.some((r) => !r.name) ? NAMELESS_REFUSAL() : null;
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

/** The shared autosave fires 1.5s after the last edit. */
const AUTOSAVE = { timeout: 4000 };
/** Longer than the autosave's pause. */
const PAST_THE_PAUSE = 2200;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function openPackageDoor(server: Server) {
  clientImpl = makeClient(server);
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name="sales_perms" packageId="app.a" />
    </MemoryRouter>,
  );
  await screen.findByText('a_account');
  fireEvent.click(screen.getByRole('button', { name: /Row-Level Security/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Add policy/ }));
}

const nameInput = () => screen.getByPlaceholderText('Policy name');
const typeName = (value: string) => fireEvent.change(nameInput(), { target: { value } });
const typeUsing = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText(USING_PLACEHOLDER), { target: { value } });

describe('"Add policy" holds the blank row it inserts (objectui#13113)', () => {
  it('(a) sends nothing for an unnamed row, says what it needs beside it, and shows no banner', async () => {
    const server: Server = { sent: [], judge: doorJudge };
    await openPackageDoor(server);

    expect(screen.getByTestId('rls-name-needed-0')).toHaveTextContent('Give the policy a name to save it.');
    await pause(PAST_THE_PAUSE);

    expect(server.sent).toHaveLength(0);
    expect(screen.queryByText(/failed spec validation/)).toBeNull();
    expect(screen.queryByText(/rowLevelSecurity/)).toBeNull();
    // The draft keeps the row while it is held.
    expect(nameInput()).toHaveValue('');
    // The status line says why nothing was saved, in a neutral tone.
    expect(screen.getByTestId('perm-autosave-held')).toHaveTextContent('Give the policy a name to save it.');
  });

  it('(b) sends the save once the row is named, and the hint goes', async () => {
    const server: Server = { sent: [], judge: doorJudge };
    await openPackageDoor(server);
    await pause(PAST_THE_PAUSE);
    expect(server.sent).toHaveLength(0);

    typeName('tenant_rows');
    typeUsing('owner_id == current_user.id');
    expect(screen.queryByTestId('rls-name-needed-0')).toBeNull();

    await waitFor(() => expect(server.sent).toHaveLength(1), AUTOSAVE);
    expect(server.sent[0].rowLevelSecurity).toEqual([
      { name: 'tenant_rows', object: '*', operation: 'all', using: 'owner_id == current_user.id', enabled: true },
    ]);
    expect(await screen.findByTestId('perm-saved-at')).toBeInTheDocument();
  });

  it('(c) words a refused policy name in the author’s terms, not the raw schema path', async () => {
    // A named row the door still refuses: the name is sent, and the refusal mapped.
    const server: Server = { sent: [], judge: () => NAMELESS_REFUSAL() };
    await openPackageDoor(server);
    typeName('Tenant Rows');
    typeUsing('owner_id == current_user.id');

    await waitFor(() => expect(server.sent).toHaveLength(1), AUTOSAVE);
    const strip = await screen.findByText(/Policy name, on row 1/);
    expect(strip).toHaveTextContent(/^Not saved\. Policy name, on row 1: /);
    expect(screen.queryByText(/rowLevelSecurity\.0\.name/)).toBeNull();
    expect(screen.queryByText(/invalid_format/)).toBeNull();
  });
});

describe('controls: what held, saved and read before still does (objectui#13113)', () => {
  it('(d) a CEL error on a named row still holds the save, as before', async () => {
    const server: Server = { sent: [], judge: doorJudge };
    await openPackageDoor(server);
    typeName('tenant_rows');
    typeUsing('organization_id ==');

    await waitFor(() =>
      expect(screen.getByTestId('perm-autosave-held')).toHaveTextContent('Fix the CEL syntax errors before saving.'),
    );
    await pause(PAST_THE_PAUSE);
    expect(server.sent).toHaveLength(0);

    // Fixing the predicate lets the same row go.
    typeUsing('owner_id == current_user.id');
    await waitFor(() => expect(server.sent).toHaveLength(1), AUTOSAVE);
  });

  it('(d) a refusal naming no policy name keeps the transport’s text', async () => {
    const raw = 'permission/sales_perms failed spec validation: 1 issue — objects.a_account [custom]';
    const server: Server = {
      sent: [],
      judge: () => refusal(raw, [{ path: 'objects.a_account', code: 'custom', message: 'nope' }]),
    };
    await openPackageDoor(server);
    typeName('tenant_rows');
    typeUsing('owner_id == current_user.id');

    await waitFor(() => expect(server.sent).toHaveLength(1), AUTOSAVE);
    expect(await screen.findByText(raw)).toBeInTheDocument();
    expect(screen.queryByText(/Policy name, on row/)).toBeNull();
  });
});
