/**
 * ObjectUI
 * Copyright (c) 2026 ObjectStack. Licensed under the MIT license.
 *
 * `AssignedUsersSection` reads a `find()` answer as `QueryResult` DECLARES it
 * — and rejects the two spellings it does not (objectui#5945).
 *
 * `QueryResult` (`@object-ui/types`) declares exactly one rows member: `data`.
 * Before this pin the module's `asArray` read
 *
 *     Array.isArray(res) ? res : res?.records ?? res?.items ?? res?.data ?? []
 *
 * — trying `records` and `items` FIRST and the contract's `data` only third.
 * Measured on this tree, no producer emits either at this seam
 * (`ObjectStackAdapter.normalizeQueryResult` maps the server's `records`
 * envelope to `data` before returning; `items` has no producer at all), so the
 * two arms bought nothing and cost the contract its authority: a raw SDK client
 * handed in where a `DataSource` belongs would have kept working, unnoticed and
 * unrejected, as a second de-facto contract (AGENTS.md #0.1).
 *
 * The bare-array arm is NOT removed and is pinned here too, because it is live
 * — the fake in this module's own `AssignedUsersSection.test.tsx` answers with
 * a plain array. Live and dead is the whole distinction, so this file measures
 * both directions rather than only the deletion.
 */

import * as React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { AdapterCtx } from '@object-ui/react';
import { AssignedUsersSection } from './AssignedUsersSection';

// The adapter goes in through the real context rather than a module mock:
// `@object-ui/react` is imported transitively for more than `useAdapter` (the
// related-count store subscribes to `subscribeDataChanges` at module scope), and
// a wholesale `vi.mock` of it starves that import.
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  RecordPickerDialog: () => null,
}));

/** How one case wraps its rows on the way back out of `find()`. */
type Envelope = (rows: unknown[]) => unknown;

const asData: Envelope = (rows) => ({ data: rows, total: rows.length });
const asBareArray: Envelope = (rows) => rows;
const asRecords: Envelope = (rows) => ({ records: rows, total: rows.length });
const asItems: Envelope = (rows) => ({ items: rows, total: rows.length });

/**
 * A directory holding one set with one DIRECT grantee — nothing else. The
 * grant names its set (objectui#7611: holders are read by the set's NAME); no
 * position distributes it (no metadata store is mounted, so the registry
 * answers no positions).
 */
const DIRECTORY: Record<string, Record<string, unknown>[]> = {
  sys_user_permission_set: [{ id: 'grant_1', permission_set: 'showcase_contributor', user_id: 'u_direct' }],
  sys_user_position: [],
  sys_user: [{ id: 'u_direct', name: 'Direct Dana', email: 'dana@example.com' }],
};

/**
 * Every leg answers rows — through whichever envelope the case is measuring.
 * So a case that renders the EMPTY state rendered it because the envelope was
 * refused, not because the directory had nothing in it.
 */
function adapterSpeaking(envelope: Envelope) {
  return {
    find: vi.fn(async (object: string, query: any) => {
      const rows = DIRECTORY[object] ?? [];
      const filter = query?.$filter ?? {};
      const matched = rows.filter((r) =>
        Object.entries(filter).every(([k, v]: [string, any]) => {
          if (v && typeof v === 'object' && Array.isArray(v.$in)) return v.$in.includes(r[k]);
          return r[k] === v;
        }),
      );
      return envelope(matched);
    }),
    create: vi.fn(),
    delete: vi.fn(),
  };
}

async function renderThrough(envelope: Envelope) {
  render(
    <AdapterCtx.Provider value={adapterSpeaking(envelope) as never}>
      <AssignedUsersSection permissionSetName="showcase_contributor" />
    </AdapterCtx.Provider>,
  );
  // The load has settled either way — the spinner is gone.
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
}

afterEach(() => {
  cleanup();
});

describe('AssignedUsersSection — the find() envelope it accepts (objectui#5945)', () => {
  it("reads the contract's `data` member", async () => {
    await renderThrough(asData);
    await waitFor(() => expect(screen.getByText('Direct Dana')).toBeTruthy());
  });

  it('still reads a bare array — the live non-envelope shape fakes answer with', async () => {
    await renderThrough(asBareArray);
    await waitFor(() => expect(screen.getByText('Direct Dana')).toBeTruthy());
  });

  it('does NOT read `records` — not a QueryResult member', async () => {
    await renderThrough(asRecords);
    // The grant read's envelope was refused, so the section reports the
    // empty state. Before the fix this rendered `Direct Dana`.
    expect(screen.queryByText('Direct Dana')).toBeNull();
    await waitFor(() =>
      expect(screen.getByText(/No users assigned yet/i)).toBeTruthy(),
    );
  });

  it('does NOT read `items` — not a QueryResult member', async () => {
    await renderThrough(asItems);
    expect(screen.queryByText('Direct Dana')).toBeNull();
    await waitFor(() =>
      expect(screen.getByText(/No users assigned yet/i)).toBeTruthy(),
    );
  });
});
