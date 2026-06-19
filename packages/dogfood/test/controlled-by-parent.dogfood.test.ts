// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Master-detail "controlled by parent" RLS proof (ADR-0055 P2), end-to-end
// through the real HTTP + security stack.
//
// @proof: cbp-controlled-by-parent
// ADR-0055 runtime proof for derived master-detail access. Referenced by the
// liveness ledger entry `object.sharingModel` (packages/spec/liveness/object.json);
// the spec liveness gate fails if this tag is removed. See proof-registry.mts.
//
// The detail (`cbp_note`) carries NO authored RLS — access is DERIVED from the
// master (`cbp_account`, owner-scoped). The proof asserts both directions:
//   • a member who cannot read the admin's account can neither READ nor by-id
//     WRITE notes under it (the derived guard), and
//   • the member CAN read/write notes under an account they own (not over-blocked).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { cbpStack, cbpSecurity } from './fixtures/cbp-fixture.js';

describe('objectstack verify: master-detail controlled-by-parent (#cbp)', () => {
  let stack: VerifyStack;
  let adminToken: string;
  let memberToken: string;

  // Admin-owned graph (member must NOT reach it).
  let adminAccountId: string;
  let adminNoteId: string;

  beforeAll(async () => {
    stack = await bootStack(cbpStack, { security: cbpSecurity() });
    adminToken = await stack.signIn();
    memberToken = await stack.signUp('cbp-member@verify.test');

    const acc = await stack.apiAs(adminToken, 'POST', '/data/cbp_account', { name: 'admin account' });
    expect(acc.status, `admin account create: ${acc.status} ${await acc.clone().text()}`).toBeLessThan(300);
    adminAccountId = idOf(await acc.json());

    const note = await stack.apiAs(adminToken, 'POST', '/data/cbp_note', {
      name: 'admin note',
      body: 'admin-only',
      account: adminAccountId,
    });
    expect(note.status, `admin note create: ${note.status} ${await note.clone().text()}`).toBeLessThan(300);
    adminNoteId = idOf(await note.json());
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('precondition: the member cannot read the admin master account (owner RLS)', async () => {
    const r = await stack.apiAs(memberToken, 'GET', `/data/cbp_account/${adminAccountId}`);
    expect(r.status, 'member must not read the admin account').not.toBe(200);
  });

  it('DERIVED READ: member cannot read a note under an account they cannot read', async () => {
    const r = await stack.apiAs(memberToken, 'GET', `/data/cbp_note/${adminNoteId}`);
    expect(r.status, 'member must not read the controlled-by-parent note').not.toBe(200);
  });

  it('DERIVED WRITE: member cannot by-id mutate a note whose master they cannot edit', async () => {
    const w = await stack.apiAs(memberToken, 'PATCH', `/data/cbp_note/${adminNoteId}`, { body: 'hacked' });
    expect(w.status, 'member by-id write should be denied').not.toBeLessThan(300);
    // Ground truth: admin re-reads — the row must be unchanged.
    const after = await stack.apiAs(adminToken, 'GET', `/data/cbp_note/${adminNoteId}`);
    expect(after.status).toBe(200);
    expect(((await after.json()) as any).record?.body).toBe('admin-only');
  });

  it('NOT over-blocked: member CAN read + write a note under an account they own', async () => {
    // Member owns this account → derived access grants the note under it.
    const acc = await stack.apiAs(memberToken, 'POST', '/data/cbp_account', { name: 'member account' });
    expect(acc.status).toBeLessThan(300);
    const memberAccountId = idOf(await acc.json());

    const note = await stack.apiAs(memberToken, 'POST', '/data/cbp_note', {
      name: 'member note',
      body: 'mine',
      account: memberAccountId,
    });
    expect(note.status, `member note create: ${note.status} ${await note.clone().text()}`).toBeLessThan(300);
    const memberNoteId = idOf(await note.json());

    // Read it back (derived: account IN [memberAccountId]).
    const read = await stack.apiAs(memberToken, 'GET', `/data/cbp_note/${memberNoteId}`);
    expect(read.status, 'member should read their own note').toBe(200);

    // Edit it (master is member-owned → editable).
    const edit = await stack.apiAs(memberToken, 'PATCH', `/data/cbp_note/${memberNoteId}`, { body: 'updated' });
    expect(edit.status, 'member should edit their own note').toBeLessThan(300);
    const after = await stack.apiAs(memberToken, 'GET', `/data/cbp_note/${memberNoteId}`);
    expect(((await after.json()) as any).record?.body).toBe('updated');
  });
});

function idOf(j: any): string {
  const id = j?.id ?? j?.record?.id;
  expect(id, 'expected an id from create').toBeTruthy();
  return id as string;
}
