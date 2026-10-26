// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11787 — one save model in Studio: the permission matrix autosaves on
 * the PACKAGE door and keeps its explicit Save on the ENVIRONMENT door.
 *
 * ADR-0086 D6 puts the package Access door under package draft/publish "exactly
 * like Data and Interfaces", and ADR-0033 §2 makes that draft the approval gate,
 * so an autosave there writes the same draft the old Save button wrote. The
 * environment-admin door writes live config (ADR-0086 D7): an autosave there
 * would change access on every click, so it never autosaves.
 *
 * Each absence below is read against a presence from the same harness and the
 * same edit: the package-door case that saves is the control for the
 * environment door's silence, and the environment door's Save click is the
 * control that its edit was a real one.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PUBLISHED = {
  name: 'sales_perms',
  label: 'Sales',
  objects: { a_account: { allowRead: true, allowCreate: true } },
  fields: {},
};

const LAYERED = { effective: PUBLISHED, code: null, overlay: null, overlayScope: null };

/** A saved permission set, as far as these pins read it. */
interface SavedSet {
  objects: Record<string, Record<string, boolean>>;
}

interface Server {
  saved: SavedSet[];
  savedOpts: Array<Record<string, unknown> | undefined>;
}

/** A pending answer the test settles by hand: a save held in flight. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The slice of the metadata client the editor calls here. */
type FakeClient = Record<string, (...args: never[]) => Promise<unknown>>;

function makeClient(server: Server, opts: { holdFirstSave?: Promise<void> } = {}): FakeClient {
  return {
    layered: async () => LAYERED,
    getDraft: async () => null,
    list: async (type: string) => (type === 'object' ? [{ item: { name: 'a_account' } }] : []),
    get: async () => null,
    save: async (
      _type: string,
      _name: string,
      payload: Record<string, unknown>,
      saveOpts?: Record<string, unknown>,
    ) => {
      server.saved.push(JSON.parse(JSON.stringify(payload)) as SavedSet);
      server.savedOpts.push(saveOpts);
      if (server.saved.length === 1 && opts.holdFirstSave) await opts.holdFirstSave;
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

/** The shared autosave fires 1.5s after the last edit. */
const AUTOSAVE = { timeout: 4000 };

function renderDoor(packageId: string | undefined, onDraftSaved?: () => void) {
  return render(
    <MemoryRouter>
      <PermissionMatrixEditPage
        type="permission"
        name="sales_perms"
        packageId={packageId}
        onDraftSaved={onDraftSaved}
      />
    </MemoryRouter>,
  );
}

const accountRow = () => screen.getByText('a_account').closest('tr')!;
const readBox = () => within(accountRow()).getByRole('checkbox', { name: 'a_account Read' });
const saveButton = () => screen.queryByRole('button', { name: /^Save$/ });

describe('the package door autosaves to the package draft (objectui#11787)', () => {
  it('saves an edit as a draft of this package after the pause, with no Save button', async () => {
    const server: Server = { saved: [], savedOpts: [] };
    clientImpl = makeClient(server);
    const onDraftSaved = vi.fn();
    renderDoor('app.a', onDraftSaved);
    await screen.findByText('a_account');

    // No Save button on this door: the autosave is the save.
    expect(saveButton()).toBeNull();

    fireEvent.click(within(accountRow()).getByRole('button', { name: 'None' }));
    // Debounced, not per click.
    expect(server.saved).toHaveLength(0);

    await waitFor(() => expect(server.saved).toHaveLength(1), AUTOSAVE);
    expect(server.saved[0].objects.a_account).toEqual({});
    expect(server.savedOpts[0]).toMatchObject({ mode: 'draft', packageId: 'app.a' });
    // The surface's pending-changes count hears of it.
    await waitFor(() => expect(onDraftSaved).toHaveBeenCalledTimes(1));
    // The status line every Studio editor shows replaces the button.
    expect(await screen.findByTestId('perm-saved-at')).toBeInTheDocument();
  });

  it('keeps an edit taken while the autosave is in flight, and sends it next (objectui#11204)', async () => {
    const server: Server = { saved: [], savedOpts: [] };
    const hold = deferred();
    clientImpl = makeClient(server, { holdFirstSave: hold.promise });
    renderDoor('app.a');
    await screen.findByText('a_account');

    fireEvent.click(within(accountRow()).getByRole('button', { name: 'None' }));
    await waitFor(() => expect(server.saved).toHaveLength(1), AUTOSAVE);
    expect(await screen.findByTestId('perm-autosaving')).toBeInTheDocument();

    // A second edit while the first save is on the wire.
    fireEvent.click(readBox());
    expect(readBox()).toBeChecked();
    hold.resolve();

    // The landed save does not put its own body back over the newer edit…
    await waitFor(() => expect(screen.queryByTestId('perm-autosaving')).toBeNull());
    expect(readBox()).toBeChecked();
    // …and the edit, still unsent, goes out next.
    await waitFor(() => expect(server.saved).toHaveLength(2), AUTOSAVE);
    expect(server.saved[0].objects.a_account).toEqual({});
    expect(server.saved[1].objects.a_account).toEqual({ allowRead: true });
  });

  it('fixes the api name: it is the draft’s identity, set by "+ New"', async () => {
    clientImpl = makeClient({ saved: [], savedOpts: [] });
    renderDoor('app.a');
    await screen.findByText('a_account');
    fireEvent.click(screen.getByRole('button', { name: /Sales/ }));
    expect(screen.getByLabelText('Name')).toBeDisabled();
    // CONTROL: the label stays editable on the same door.
    expect(screen.getByLabelText('Label')).toBeEnabled();
  });
});

describe('the environment door keeps its explicit Save: live config never autosaves (ADR-0086 D7)', () => {
  it('sends nothing on an edit, however long the pause, until Save is clicked', async () => {
    const server: Server = { saved: [], savedOpts: [] };
    clientImpl = makeClient(server);
    const onDraftSaved = vi.fn();
    renderDoor(undefined, onDraftSaved);
    await screen.findByText('a_account');

    fireEvent.click(within(accountRow()).getByRole('button', { name: 'None' }));
    // Longer than the autosave's pause, which the package door's case above
    // shows sending the same edit.
    await new Promise((resolve) => setTimeout(resolve, 2200));
    expect(server.saved).toHaveLength(0);
    expect(screen.queryByTestId('perm-autosaving')).toBeNull();

    // CONTROL: the edit is real, and the door's own Save writes it, live.
    fireEvent.click(saveButton()!);
    await waitFor(() => expect(server.saved).toHaveLength(1));
    expect(server.saved[0].objects.a_account).toEqual({});
    expect(server.savedOpts[0]).toEqual({ force: false });
    expect(onDraftSaved).not.toHaveBeenCalled();
  });

  it('keeps the api name editable', async () => {
    clientImpl = makeClient({ saved: [], savedOpts: [] });
    renderDoor(undefined);
    await screen.findByText('a_account');
    fireEvent.click(screen.getByRole('button', { name: /Sales/ }));
    expect(screen.getByLabelText('Name')).toBeEnabled();
  });
});
