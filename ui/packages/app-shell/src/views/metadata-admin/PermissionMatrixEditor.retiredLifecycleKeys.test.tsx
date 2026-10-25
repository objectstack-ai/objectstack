// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins that the Access matrix never AUTHORS the retired lifecycle bits
 * `allowRestore` / `allowPurge` (objectui#6595).
 *
 * Both keys gated `restore` / `purge` ObjectQL operations that have never
 * existed — a dispatched restore/purge is denied unconditionally by the
 * evaluator's fail-closed destructive-operation backstop — so every tick of
 * the `Re` / `Pu` checkboxes was a grant no runtime has ever read.
 * `@objectstack/spec` retired both as `retiredKey()` tombstones
 * (objectstack#12497; maintainer ruling 2026-08-26 accepting objectstack#1883
 * recommendation B, ADR-0049 enforce-or-remove). They return with the M2
 * lifecycle initiative, whose restart is recorded on objectstack#1883.
 *
 * Two directions are pinned, because a missing column is only half of it:
 *  - the COLUMN SET, not merely the absence of two keys. A set assertion is
 *    what stops a retired key drifting back in beside a live one, and it is
 *    the direction that also proves `allowTransfer` — enforced upstream, and
 *    explicitly out of this removal — is still authorable.
 *  - what reaches the WIRE. "Grant all" seeds a row from the column list, so
 *    the key set it writes is the real product of this change; asserting on
 *    the saved payload catches a column list that drifts back into the seed
 *    without a header cell to show for it.
 *
 * ## The one assertion the spec bump is expected to revisit
 *
 * `carries a stored legacy value through untouched` pins TODAY's posture: the
 * installed `@objectstack/spec` (17.2.0, measured 2026-08-27) still ACCEPTS
 * both keys at permission parse, so stripping a stored value here would delete
 * data the schema still honours. Once the bump carrying the retirement lands,
 * a carried-through value becomes a body the schema REFUSES, and strip-on-load
 * becomes correct (objectui#4644's resolution for `indexed`). That is the bump
 * PR's change to make, deliberately, replacing this assertion — not a red to
 * be quietly deleted.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/** The object-permission keys the matrix may author, in column order. */
const LIVE_COLUMN_SHORTS = ['C', 'R', 'U', 'D', 'Tr', 'VA', 'MA'];

let clientImpl: any;
let saved: Record<string, any> | null = null;

function makeClient(set: Record<string, unknown>) {
  return {
    layered: async () => ({ effective: set, code: null, overlay: null, overlayScope: null }),
    getDraft: async () => null,
    list: async (type: string) => (type === 'object' ? [{ item: { name: 'a_account' } }] : []),
    get: async (type: string) => (type === 'object' ? { fields: [] } : null),
    save: async (_t: string, _n: string, payload: Record<string, any>) => {
      saved = payload;
      return payload;
    },
  } as any;
}

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

afterEach(() => {
  cleanup();
  saved = null;
});

async function renderSet(objects: Record<string, unknown> = {}) {
  clientImpl = makeClient({
    name: 'sales_perms',
    label: 'Sales',
    objects,
    fields: {},
  });
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name="sales_perms" />
    </MemoryRouter>,
  );
  await screen.findByText('Sales');
}

/** Click Save and return the payload the client was handed. */
async function save() {
  fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
  await waitFor(() => expect(saved).not.toBeNull());
  return saved!;
}

describe('PermissionMatrixEditor · retired lifecycle keys (objectui#6595)', () => {
  it('offers exactly the live capability columns — no Re, no Pu', async () => {
    await renderSet();

    const headers = screen
      .getAllByRole('columnheader')
      .map((th) => th.textContent?.trim() ?? '');
    // Object + capabilities + Bulk; the capability strip is what this pins.
    expect(headers.slice(1, -1)).toEqual(LIVE_COLUMN_SHORTS);
    // Stated twice on purpose: the set assertion above is the guard, these two
    // name the keys this card retired so a future reader sees them by name.
    expect(headers).not.toContain('Re');
    expect(headers).not.toContain('Pu');
  });

  it('offers no Restore / Purge checkbox, and still offers Transfer', async () => {
    await renderSet({ a_account: { allowRead: true } });

    expect(screen.queryByLabelText(/restore/i)).toBeNull();
    expect(screen.queryByLabelText(/purge/i)).toBeNull();
    // Falsification: `allowTransfer` is enforced upstream and is NOT part of
    // this removal — if it vanished too, the assertions above would be passing
    // for the wrong reason.
    expect(screen.getByLabelText('a_account Transfer ownership')).toBeTruthy();
  });

  it('"Grant all" writes exactly the live keys — the retired pair cannot ride along', async () => {
    await renderSet({ a_account: {} });

    fireEvent.click(screen.getAllByRole('button', { name: /^All$/ })[0]);
    const payload = await save();

    const row = payload.objects.a_account;
    expect(Object.keys(row).sort()).toEqual(
      [
        'allowCreate',
        'allowRead',
        'allowEdit',
        'allowDelete',
        'allowTransfer',
        'viewAllRecords',
        'modifyAllRecords',
      ].sort(),
    );
    expect('allowRestore' in row).toBe(false);
    expect('allowPurge' in row).toBe(false);
  });

  it('carries a stored legacy value through untouched rather than authoring it', async () => {
    // What an older build of this editor wrote. Read the header note above
    // before changing this: it pins today's posture, and the spec bump that
    // lands the retirement is the change that replaces it with strip-on-load.
    await renderSet({ a_account: { allowRead: true, allowRestore: true, allowPurge: true } });

    // Not authorable: no control renders for either key…
    expect(screen.queryByLabelText(/restore/i)).toBeNull();
    expect(screen.queryByLabelText(/purge/i)).toBeNull();

    // …and an unrelated edit does not silently delete them either.
    fireEvent.click(screen.getByLabelText('a_account Create'));
    const payload = await save();

    const row = payload.objects.a_account;
    expect(row.allowCreate).toBe(true);
    expect(row.allowRestore).toBe(true);
    expect(row.allowPurge).toBe(true);
  });
});
