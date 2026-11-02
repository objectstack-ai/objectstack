/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#26594 — `RecordFieldAccessScope`: below it, the field `write`
 * verdict of ONE stored record answers from the server's record-scoped
 * projection wherever `/auth/me/permissions` reports a field-level lock, and
 * everything else is the enclosing provider's.
 *
 * The truth table, under a signed-in answer whose `rfa_contract.summary` entry
 * is a lock that the server conditions on the row (`when: status in
 * ['approved']` — `/auth/me/permissions` holds no row, so it serves the entry
 * as its lock), `ref_no` locked on every row, and an owner entry locked:
 *   - `summary` on a draft the server unlocks → writable; on an approved row → locked;
 *   - `ref_no` → locked on both, as the server answers;
 *   - `title` (no entry) → the enclosing object-grant answer;
 *   - `owner_id` → the enclosing answer (a transfer needs a grant the projection does not carry);
 *   - `read` / `create` and every other object → the enclosing answer;
 *   - before the answer arrives, and on no answer → the enclosing answer (locked);
 *   - a new `revision` (the row was saved or re-read) → asked again, locked until it lands;
 *   - a nested scope for the same record asks once; no provider → asks nothing.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import React from 'react';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '../MePermissionsProvider';
import { RecordFieldAccessScope } from '../RecordFieldAccessScope';
import { usePermissions } from '../usePermissions';

type Perms = ReturnType<typeof usePermissions>;

function Probe({ seen }: { seen: Perms[] }) {
  seen.push(usePermissions());
  return null;
}

const ANSWER: MePermissionsAuthenticatedResponse = {
  authenticated: true,
  userId: 'u1',
  tenantId: 'org_1',
  hasAnyQueue: false,
  positions: ['member'],
  permissionSets: ['rfa_fixture_member'],
  objects: {
    rfa_contract: { allowRead: true, allowCreate: true, allowEdit: true },
    invoice: { allowRead: true, allowEdit: true },
  },
  fields: {
    'rfa_contract.summary': { readable: true, editable: false },
    'rfa_contract.ref_no': { readable: true, editable: false },
    'rfa_contract.owner_id': { readable: true, editable: false },
    'invoice.summary': { readable: true, editable: false },
  },
};

const DRAFT = { editable: ['title', 'status', 'summary', 'owner_id'] };
const APPROVED = { editable: ['title', 'status', 'owner_id'] };

function mount(load: (o: string, id: string) => Promise<any>, nested = false) {
  const seen: Perms[] = [];
  const probe = <Probe seen={seen} />;
  render(
    <MePermissionsProvider initialPermissions={ANSWER}>
      <RecordFieldAccessScope object="rfa_contract" recordId="c1" load={load}>
        {nested
          ? <RecordFieldAccessScope object="RFA_Contract" recordId="c1" load={load}>{probe}</RecordFieldAccessScope>
          : probe}
      </RecordFieldAccessScope>
    </MePermissionsProvider>,
  );
  return { last: () => seen[seen.length - 1] };
}

describe('[#26594] RecordFieldAccessScope', () => {
  it("a lock the server lifts on this row is writable; a lock it keeps stays locked", async () => {
    const { last } = mount(async () => DRAFT);
    await waitFor(() => expect(last().checkField('rfa_contract', 'summary', 'write')).toBe(true));
    expect(last().checkField('rfa_contract', 'ref_no', 'write')).toBe(false);
    // Matched case-insensitively, as the provider matches object names.
    expect(last().checkField('RFA_Contract', 'summary', 'write')).toBe(true);
  });

  it('on a row the condition names, the lock stands', async () => {
    const load = vi.fn(async () => APPROVED);
    const { last } = mount(load);
    await waitFor(() => expect(load).toHaveBeenCalledWith('rfa_contract', 'c1'));
    await waitFor(() => expect(last().checkField('rfa_contract', 'title', 'write')).toBe(true));
    expect(last().checkField('rfa_contract', 'summary', 'write')).toBe(false);
    expect(last().checkField('rfa_contract', 'ref_no', 'write')).toBe(false);
  });

  it('only the field-level lock is replaced: owner, read, create and other objects keep the enclosing answer', async () => {
    const { last } = mount(async () => DRAFT);
    await waitFor(() => expect(last().checkField('rfa_contract', 'summary', 'write')).toBe(true));
    // In `editable`, but writing the owner is a transfer the projection does not judge.
    expect(last().checkField('rfa_contract', 'owner_id', 'write')).toBe(false);
    expect(last().checkField('rfa_contract', 'summary', 'create')).toBe(false);
    expect(last().checkField('rfa_contract', 'summary', 'read')).toBe(true);
    expect(last().checkField('invoice', 'summary', 'write')).toBe(false);
    expect(last().getFieldPermissions('rfa_contract')).toContainEqual({ field: 'summary', read: true, write: false });
    expect(last().isLoaded).toBe(true);
    expect(last().userId).toBe('u1');
  });

  it('a field the answer omits but no entry locks keeps the object-grant answer', async () => {
    const { last } = mount(async () => ({ editable: [] }));
    await waitFor(() => expect(last().checkField('rfa_contract', 'summary', 'write')).toBe(false));
    expect(last().checkField('rfa_contract', 'title', 'write')).toBe(true);
  });

  it('before the answer arrives, and with no answer, the row-blind lock stands', async () => {
    let resolve: ((v: any) => void) | undefined;
    const pending = mount(() => new Promise((r) => { resolve = r; }));
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    expect(pending.last().checkField('rfa_contract', 'summary', 'write')).toBe(false);
    resolve!(null);
    await new Promise((r) => setTimeout(r, 0));
    expect(pending.last().checkField('rfa_contract', 'summary', 'write')).toBe(false);

    const refused = mount(async () => { throw Object.assign(new Error('gone'), { httpStatus: 404 }); });
    await new Promise((r) => setTimeout(r, 0));
    expect(refused.last().checkField('rfa_contract', 'summary', 'write')).toBe(false);
  });

  it('a new revision asks again and holds the lock until the new answer lands', async () => {
    const seen: Perms[] = [];
    const answers: Array<(v: any) => void> = [];
    const load = vi.fn(() => new Promise<any>((r) => { answers.push(r); }));
    const tree = (revision: number) => (
      <MePermissionsProvider initialPermissions={ANSWER}>
        <RecordFieldAccessScope object="rfa_contract" recordId="c1" load={load} revision={revision}>
          <Probe seen={seen} />
        </RecordFieldAccessScope>
      </MePermissionsProvider>
    );
    const { rerender } = render(tree(0));
    await waitFor(() => expect(answers).toHaveLength(1));
    await act(async () => { answers[0](DRAFT); });
    await waitFor(() => expect(seen[seen.length - 1].checkField('rfa_contract', 'summary', 'write')).toBe(true));

    rerender(tree(1));
    await waitFor(() => expect(answers).toHaveLength(2));
    expect(seen[seen.length - 1].checkField('rfa_contract', 'summary', 'write')).toBe(false);
    await act(async () => { answers[1](APPROVED); });
    expect(seen[seen.length - 1].checkField('rfa_contract', 'summary', 'write')).toBe(false);
    expect(seen[seen.length - 1].checkField('rfa_contract', 'title', 'write')).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a scope nested under one for the same record asks once and answers the same', async () => {
    const load = vi.fn(async () => DRAFT);
    const { last } = mount(load, true);
    await waitFor(() => expect(last().checkField('rfa_contract', 'summary', 'write')).toBe(true));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('with no enclosing provider there is nothing to refine, and nothing is asked', () => {
    const load = vi.fn(async () => DRAFT);
    const seen: Perms[] = [];
    render(
      <RecordFieldAccessScope object="rfa_contract" recordId="c1" load={load}>
        <Probe seen={seen} />
      </RecordFieldAccessScope>,
    );
    expect(load).not.toHaveBeenCalled();
    expect(seen[seen.length - 1].checkField('rfa_contract', 'summary', 'write')).toBe(true);
  });
});
