// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#6605 — the bulk buttons (R / CRUD / All / None) and the keys the
 * matrix does not author.
 *
 * `bulkSetObject` used to REPLACE the object's permission row. Three
 * spec-declared keys are modelled by neither the local `ObjectPerm` interface
 * nor the `OBJECT_ACTIONS` column list — `allowExport`, and the ADR-0057
 * access-depth axis `readScope` / `writeScope` — so one bulk click dropped
 * whatever those held. The sharpest shape is the button labelled **All**: an
 * admin clicking what reads as "grant everything" could WIDEN effective read
 * access by deleting a `readScope: 'own'` narrowing, with no diff shown and no
 * error.
 *
 * Every pin here asserts the SAVED payload, never editor state. That is the
 * card's own argument for why the defect persisted: both save doors carry the
 * row as-is — the environment door writes the whole record, and at package
 * scope `mergePermissionSlice` takes in-scope rows entirely from `edited`
 * (ADR-0086 P0), so `base` cannot restore what a bulk click dropped. An
 * editor-state assertion would prove nothing about either door.
 *
 * ## `none` is pinned to keep REPLACING — that is the fix's fence, not a gap
 *
 * The dispatch on #6605 deliberately rejects the card's "`none` needs the same
 * treatment" suggestion. The defect is a GRANT that silently drops a
 * narrowing; `none` grants nothing, so nothing survives for a scope to
 * narrow. Merging `none` would instead leave `allowExport: true` (and the
 * scopes) alive after a click on the button labelled "None" — a permissive
 * outcome that does not exist today, on a surface whose whole problem is
 * silent permissiveness. What an admin's "None" means is a behaviour
 * decision, made on #6605, not a mechanical merge. The `none` pin below makes
 * that fence mechanical: a refactor that quietly adopts the card's suggestion
 * goes red here and needs a maintainer decision, not a cleanup commit.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/** Every object-permission key the matrix authors, in column order. */
const MATRIX_KEYS = [
  'allowCreate',
  'allowRead',
  'allowEdit',
  'allowDelete',
  'allowTransfer',
  'viewAllRecords',
  'modifyAllRecords',
];

interface FakeServer {
  /** The stored record — what `layered()` answers (also the merge `base`). */
  set: Record<string, any>;
  /** What `list('object')` lists — the matrix rows (and, under a packageId, the slice scope). */
  objectNames: string[];
  saved: Record<string, any> | null;
  savedOpts: Record<string, any> | undefined;
}

function makeClient(server: FakeServer) {
  return {
    layered: async () => ({ effective: server.set, code: null, overlay: null, overlayScope: null }),
    getDraft: async () => null,
    list: async (type: string) =>
      type === 'object' ? server.objectNames.map((name) => ({ item: { name } })) : [],
    get: async (type: string) => (type === 'object' ? { fields: [] } : null),
    save: async (
      _t: string,
      _n: string,
      payload: Record<string, any>,
      opts?: Record<string, any>,
    ) => {
      server.saved = payload;
      server.savedOpts = opts;
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
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  CapabilityMultiSelectField: () => <div data-testid="cap-picker" />,
  parseCapabilityNames: (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : []),
}));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

afterEach(cleanup);

async function renderMatrix(
  objects: Record<string, unknown>,
  opts: { objectNames?: string[]; packageId?: string } = {},
): Promise<FakeServer> {
  const server: FakeServer = {
    set: { name: 'sales_perms', label: 'Sales', objects, fields: {} },
    objectNames: opts.objectNames ?? Object.keys(objects),
    saved: null,
    savedOpts: undefined,
  };
  clientImpl = makeClient(server);
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name="sales_perms" packageId={opts.packageId} />
    </MemoryRouter>,
  );
  await screen.findByText('Sales');
  return server;
}

/** The bulk button (`R` / `CRUD` / `All` / `None`) inside one object's row. */
function bulkButton(objectName: string, label: string) {
  const row = screen
    .getAllByRole('row')
    .find((r) => within(r).queryByText(objectName) != null);
  expect(row, `row for ${objectName}`).toBeTruthy();
  return within(row!).getByRole('button', { name: new RegExp(`^${label}$`) });
}

/** Click Save and return the payload the client was handed. */
async function save(server: FakeServer) {
  fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
  await waitFor(() => expect(server.saved).not.toBeNull());
  return server.saved!;
}

/**
 * objectui#11787 — the package door has no Save button: the edit autosaves to
 * the package draft after the shared autosave's pause. Return what it sent.
 */
async function autosaved(server: FakeServer) {
  await waitFor(() => expect(server.saved).not.toBeNull(), { timeout: 4000 });
  return server.saved!;
}

describe('PermissionMatrixEditor · bulk buttons vs unmodelled keys (objectui#6605)', () => {
  it('"All" — the widening shape — grants every column AND the saved row keeps readScope / writeScope / allowExport', async () => {
    const server = await renderMatrix({
      a_account: { allowRead: true, allowExport: true, readScope: 'own', writeScope: 'own' },
    });

    fireEvent.click(bulkButton('a_account', 'All'));
    const payload = await save(server);

    const row = payload.objects.a_account;
    for (const key of MATRIX_KEYS) expect(row[key], key).toBe(true);
    // The narrowings survive the click that used to delete them. `readScope`
    // is the load-bearing one: dropping `own` silently widened read access.
    expect(row.readScope).toBe('own');
    expect(row.writeScope).toBe('own');
    expect(row.allowExport).toBe(true);
    expect(Object.keys(row).sort()).toEqual(
      [...MATRIX_KEYS, 'allowExport', 'readScope', 'writeScope'].sort(),
    );
  });

  it('"CRUD" merges the unmodelled keys through but still RESETS the matrix columns outside its grant', async () => {
    const server = await renderMatrix({
      a_account: {
        allowTransfer: true,
        viewAllRecords: true,
        modifyAllRecords: true,
        allowExport: true,
        readScope: 'own',
        writeScope: 'unit',
      },
    });

    fireEvent.click(bulkButton('a_account', 'CRUD'));
    const payload = await save(server);

    const row = payload.objects.a_account;
    // Falsification direction: merge must not decay into "add" — a bulk CRUD
    // after a wider grant still means exactly CRUD for the keys the matrix owns.
    expect(Object.keys(row).sort()).toEqual(
      ['allowCreate', 'allowRead', 'allowEdit', 'allowDelete', 'allowExport', 'readScope', 'writeScope'].sort(),
    );
    expect('allowTransfer' in row).toBe(false);
    expect('viewAllRecords' in row).toBe(false);
    expect('modifyAllRecords' in row).toBe(false);
    expect(row.readScope).toBe('own');
    expect(row.writeScope).toBe('unit');
    expect(row.allowExport).toBe(true);
  });

  it('"R" saves a read-only row that still carries the unmodelled keys', async () => {
    const server = await renderMatrix({
      a_account: {
        allowCreate: true,
        allowEdit: true,
        allowExport: true,
        readScope: 'own',
        writeScope: 'unit',
      },
    });

    fireEvent.click(bulkButton('a_account', 'R'));
    const payload = await save(server);

    const row = payload.objects.a_account;
    expect(Object.keys(row).sort()).toEqual(
      ['allowRead', 'allowExport', 'readScope', 'writeScope'].sort(),
    );
    expect(row.allowRead).toBe(true);
    expect(row.readScope).toBe('own');
  });

  it('"None" still clears the WHOLE row — narrowings included (deliberate: the #6605 dispatch fence)', async () => {
    // Read the header before "fixing" this pin: merging `none` would leave
    // `allowExport: true` alive after a click on the button labelled "None".
    const server = await renderMatrix({
      a_account: { allowRead: true, allowExport: true, readScope: 'own', writeScope: 'own' },
      a_contact: { allowRead: true, readScope: 'own' },
    });

    fireEvent.click(bulkButton('a_account', 'None'));
    const payload = await save(server);

    expect(payload.objects.a_account).toEqual({});
    // Positive control in the same query shape: the untouched sibling row in
    // the SAME saved payload still carries its narrowing, so the emptiness
    // above is a measurement of `none`, not of a save path that drops keys.
    expect(payload.objects.a_contact).toEqual({ allowRead: true, readScope: 'own' });
  });

  it('package door: the merged slice keeps the unmodelled keys after "All", and other packages\' rows survive byte-for-byte', async () => {
    // In-scope: a_account (this package's row, carrying the narrowings).
    // Out-of-scope: b_order — another package's contribution, not listed by
    // this package, which `mergePermissionSlice` must copy verbatim from base.
    const server = await renderMatrix(
      {
        a_account: { allowRead: true, allowExport: true, readScope: 'own', writeScope: 'own' },
        b_order: { allowRead: true, viewAllRecords: true, readScope: 'unit' },
      },
      { objectNames: ['a_account'], packageId: 'app.a' },
    );

    fireEvent.click(bulkButton('a_account', 'All'));
    const payload = await autosaved(server);

    const row = payload.objects.a_account;
    for (const key of MATRIX_KEYS) expect(row[key], key).toBe(true);
    expect(row.readScope).toBe('own');
    expect(row.writeScope).toBe('own');
    expect(row.allowExport).toBe(true);
    // The other package's row is untouched — and the save went through the
    // package door (a draft write), not a live record write.
    expect(payload.objects.b_order).toEqual({ allowRead: true, viewAllRecords: true, readScope: 'unit' });
    expect(server.savedOpts).toMatchObject({ mode: 'draft', packageId: 'app.a' });
  });
});
