/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27138 — `RecordFieldAccessScope` answers the row's own write
 * verdict: the projection's `writable` (the write gate's judgement of sharing,
 * ownership, row-level security and the object grant on the stored row), and
 * a lock the host reads that the projection leaves out (`lockedBy: 'approval'`).
 *
 * Under a signed-in answer that grants `rfa_contract` edit:
 *   - `writable: false` → every field of the record refuses `write` (the ones
 *     `editable` lists included) and `check('rfa_contract', 'update')` refuses
 *     with the reason `record-not-writable`;
 *   - `read`, `create`, other objects and a `check` naming another record keep
 *     the enclosing answer;
 *   - CONTROL `writable: true` and CONTROL no `writable` key → as before: the
 *     fields `editable` lists are writable and `update` is allowed;
 *   - `lockedBy: 'approval'` → refused with `record-locked-by-approval`, before
 *     any answer and with none;
 *   - an object grant the enclosing provider already refuses keeps its reason;
 *   - a scope nested under one for the same record adds the host's lock without
 *     asking again.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { MePermissionsProvider, type MePermissionsResponse } from '../MePermissionsProvider';
import { RecordFieldAccessScope } from '../RecordFieldAccessScope';
import { usePermissions } from '../usePermissions';

type Perms = ReturnType<typeof usePermissions>;

function Probe({ seen }: { seen: Perms[] }) {
  seen.push(usePermissions());
  return null;
}

const ANSWER: MePermissionsResponse = {
  authenticated: true,
  userId: 'u1',
  tenantId: 'org_1',
  roles: ['member'],
  permissionSets: ['rfa_fixture_member'],
  objects: {
    rfa_contract: { allowRead: true, allowCreate: true, allowEdit: true },
    invoice: { allowRead: true, allowEdit: true },
  },
  fields: {},
};

const READ_ONLY_GRANT: MePermissionsResponse = {
  ...ANSWER,
  objects: { ...ANSWER.objects, rfa_contract: { allowRead: true, allowCreate: true, allowEdit: false } },
};

const PROJECTION = { editable: ['title', 'summary'] };

function mount(
  load: (o: string, id: string) => Promise<any>,
  { lockedBy, principal = ANSWER, nestedLock = false }: {
    lockedBy?: 'approval';
    principal?: MePermissionsResponse;
    nestedLock?: boolean;
  } = {},
) {
  const seen: Perms[] = [];
  const probe = <Probe seen={seen} />;
  render(
    <MePermissionsProvider initialPermissions={principal}>
      <RecordFieldAccessScope object="rfa_contract" recordId="c1" load={load} lockedBy={nestedLock ? undefined : lockedBy}>
        {nestedLock
          ? <RecordFieldAccessScope object="rfa_contract" recordId="c1" load={load} lockedBy="approval">{probe}</RecordFieldAccessScope>
          : probe}
      </RecordFieldAccessScope>
    </MePermissionsProvider>,
  );
  return { last: () => seen[seen.length - 1] };
}

describe('[#27138] RecordFieldAccessScope — the row verdict', () => {
  it('on writable: false no field of the record is writable and its update is refused', async () => {
    const load = vi.fn(async () => ({ ...PROJECTION, writable: false }));
    const { last } = mount(load);
    await waitFor(() => expect(last().check('rfa_contract', 'update').allowed).toBe(false));
    expect(last().check('rfa_contract', 'update')).toEqual({ allowed: false, reason: 'record-not-writable' });
    expect(last().can('rfa_contract', 'update')).toBe(false);
    expect(last().checkField('rfa_contract', 'title', 'write')).toBe(false);
    expect(last().checkField('RFA_Contract', 'summary', 'write')).toBe(false);
  });

  it('only the update of this row is refused: read, create, other objects and other records keep the enclosing answer', async () => {
    const { last } = mount(async () => ({ ...PROJECTION, writable: false }));
    await waitFor(() => expect(last().can('rfa_contract', 'update')).toBe(false));
    expect(last().checkField('rfa_contract', 'title', 'read')).toBe(true);
    expect(last().checkField('rfa_contract', 'title', 'create')).toBe(true);
    expect(last().can('rfa_contract', 'read')).toBe(true);
    expect(last().can('rfa_contract', 'create')).toBe(true);
    expect(last().can('invoice', 'update')).toBe(true);
    expect(last().checkField('invoice', 'title', 'write')).toBe(true);
    expect(last().check('rfa_contract', 'update', { id: 'c2' }).allowed).toBe(true);
    expect(last().check('rfa_contract', 'update', { id: 'c1' }).allowed).toBe(false);
  });

  it.each([
    ['writable: true', { ...PROJECTION, writable: true }],
    ['no writable key (a server that predates the verdict)', PROJECTION],
  ])('CONTROL — %s leaves the row writable and the fields as the projection lists them', async (_label, answer) => {
    const load = vi.fn(async () => answer);
    const { last } = mount(load);
    await waitFor(() => expect(load).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(last().check('rfa_contract', 'update')).toEqual({ allowed: true, reason: undefined });
    expect(last().checkField('rfa_contract', 'title', 'write')).toBe(true);
    expect(last().checkField('rfa_contract', 'summary', 'write')).toBe(true);
  });

  it("a host's approval lock refuses the row before any answer, and with none", async () => {
    let resolve: ((v: any) => void) | undefined;
    const pending = mount(() => new Promise((r) => { resolve = r; }), { lockedBy: 'approval' });
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    expect(pending.last().check('rfa_contract', 'update')).toEqual({ allowed: false, reason: 'record-locked-by-approval' });
    expect(pending.last().checkField('rfa_contract', 'title', 'write')).toBe(false);
    resolve!(null);
    await new Promise((r) => setTimeout(r, 0));
    expect(pending.last().check('rfa_contract', 'update').reason).toBe('record-locked-by-approval');

    const writable = mount(async () => ({ ...PROJECTION, writable: true }), { lockedBy: 'approval' });
    await new Promise((r) => setTimeout(r, 0));
    expect(writable.last().check('rfa_contract', 'update').reason).toBe('record-locked-by-approval');
  });

  it('an object grant the enclosing provider refuses keeps its own reason', async () => {
    const { last } = mount(async () => ({ ...PROJECTION, writable: false }), { principal: READ_ONLY_GRANT });
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => expect(last().checkField('rfa_contract', 'title', 'write')).toBe(false));
    expect(last().check('rfa_contract', 'update')).toEqual({ allowed: false, reason: 'denied-by-permission-set' });
  });

  it('a nested scope for the same record adds the host lock without asking again', async () => {
    const load = vi.fn(async () => ({ ...PROJECTION, writable: true }));
    const { last } = mount(load, { nestedLock: true });
    await waitFor(() => expect(last().check('rfa_contract', 'update').reason).toBe('record-locked-by-approval'));
    expect(load).toHaveBeenCalledTimes(1);
  });
});
