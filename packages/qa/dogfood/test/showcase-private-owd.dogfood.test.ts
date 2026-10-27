// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0056 — declarative `private` OWD proof on the REAL showcase app.
// `showcase_private_note` declares `sharingModel: 'private'` and NOTHING else:
// no RLS policy, no owner predicate, no permission-set rule. Two plain sign-ups
// (governed only by the default member set) each create notes; the engine scopes
// every read/write to the owner purely from the OWD baseline + the auto-stamped
// `owner_id`. This is the canonical "declare one word, get owner isolation"
// capability — proven end-to-end through the real HTTP stack.
//
// ADR-0056 D10 — the authz-conformance matrix row this file is the cited proof
// for; `authz-conformance.test.ts` asserts the pairing is mutual (#7976).
// authz-row: owd-private

import { describe, it, expect, beforeAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { getSharedShowcase } from './shared-showcase.js';

const OBJ = '/data/showcase_private_note';
const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id ?? b?.recordId;
const recordOf = (b: any) => b?.record ?? b?.data ?? b;
const rowsOf = (b: any) => b?.records ?? b?.data ?? (Array.isArray(b) ? b : []);
const filterOf = (where: Record<string, unknown>) => encodeURIComponent(JSON.stringify(where));

describe('showcase: declarative private OWD (ADR-0056)', () => {
  let stack: VerifyStack;
  let adminToken: string;
  let aToken: string;
  let bToken: string;
  let aNoteId: string;
  let aNote2Id: string;
  let bNoteId: string;

  beforeAll(async () => {
    stack = await getSharedShowcase();
    adminToken = await stack.signIn(); // seed dev admin (first user)
    aToken = await stack.signUp('owd-alice@verify.test');
    bToken = await stack.signUp('owd-bob@verify.test');

    const a1 = await stack.apiAs(aToken, 'POST', OBJ, { title: 'Alice private 1', body: 'a-body' });
    expect(a1.status, 'alice creates note').toBeLessThan(300);
    aNoteId = idOf(await a1.json());
    const a2 = await stack.apiAs(aToken, 'POST', OBJ, { title: 'Alice private 2' });
    expect(a2.status, 'alice creates a second note').toBeLessThan(300);
    aNote2Id = idOf(await a2.json());

    const b1 = await stack.apiAs(bToken, 'POST', OBJ, { title: 'Bob private 1' });
    expect(b1.status, 'bob creates note').toBeLessThan(300);
    bNoteId = idOf(await b1.json());

    expect(aNoteId, 'alice note id').toBeTruthy();
    expect(aNote2Id, 'alice second note id').toBeTruthy();
    expect(bNoteId, 'bob note id').toBeTruthy();
  }, 60_000);

  it('owner_id is auto-stamped (no manual assignment, no predicate)', async () => {
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    const row = await ql.findOne('showcase_private_note', { where: { id: aNoteId }, context: { isSystem: true } });
    expect(row?.owner_id, 'owner_id stamped to a real user id').toBeTruthy();
  });

  it('a member LISTS only the notes they own', async () => {
    const r = await stack.apiAs(aToken, 'GET', OBJ);
    expect(r.status).toBe(200);
    const body: any = await r.json();
    const titles: string[] = (body.records ?? body.data ?? body ?? []).map((x: any) => x.title);
    expect(titles).toContain('Alice private 1');
    expect(titles).toContain('Alice private 2');
    expect(titles).not.toContain('Bob private 1'); // owner isolation, no RLS authored
  });

  it('a member cannot READ another owner’s note by id', async () => {
    const r = await stack.apiAs(aToken, 'GET', `${OBJ}/${bNoteId}`);
    expect(r.status, 'alice must not read bob note').not.toBe(200);
  });

  it('a member cannot WRITE another owner’s note, but can write their own', async () => {
    const foreign = await stack.apiAs(aToken, 'PATCH', `${OBJ}/${bNoteId}`, { body: 'hacked' });
    expect(foreign.status, 'alice must not edit bob note').not.toBeLessThan(300);

    const own = await stack.apiAs(aToken, 'PATCH', `${OBJ}/${aNoteId}`, { body: 'updated' });
    expect(own.status, 'alice edits her own note').toBeLessThan(300);
  });

  it('the OTHER member is symmetric (bob sees only his own)', async () => {
    const r = await stack.apiAs(bToken, 'GET', OBJ);
    const body: any = await r.json();
    const titles: string[] = (body.records ?? body.data ?? body ?? []).map((x: any) => x.title);
    expect(titles).toContain('Bob private 1');
    expect(titles).not.toContain('Alice private 1');
    const foreign = await stack.apiAs(bToken, 'GET', `${OBJ}/${aNoteId}`);
    expect(foreign.status).not.toBe(200);
  });

  // ── access-security.rls-both-sides a2/a3/n0 + owd-sharing-matrix a0 (#26571) ──
  // The two halves the member-only cases above leave open: the admin re-read
  // that proves a refused foreign write changed nothing (a 4xx over a mutated
  // row is still the failure), and the entitled side of the same gate.

  it('a foreign by-id read is non-2xx, not merely not-200', async () => {
    const r = await stack.apiAs(aToken, 'GET', `${OBJ}/${bNoteId}`);
    expect(r.status, 'any 2xx is a read of a row owner isolation hides').toBeGreaterThanOrEqual(300);
  });

  it('a refused foreign PATCH leaves the row byte-identical on the admin re-read', async () => {
    const read = async () => {
      const r = await stack.apiAs(adminToken, 'GET', `${OBJ}/${bNoteId}`);
      expect(r.status, 'the admin reads the foreign note').toBe(200);
      return recordOf(await r.json());
    };
    const before = await read();
    const forged = await stack.apiAs(aToken, 'PATCH', `${OBJ}/${bNoteId}`, { body: 'forged' });
    expect(forged.status, 'the forged foreign write is refused').toBeGreaterThanOrEqual(400);
    const after = await read();
    expect(after, 'the refused write changed nothing on the row').toEqual(before);
    expect(after.body, 'the forged value never landed').not.toBe('forged');
  });

  it('the admin (platform posture) lists every note this file created — the entitled side', async () => {
    const ids = [aNoteId, aNote2Id, bNoteId];
    const r = await stack.apiAs(adminToken, 'GET', `${OBJ}?$filter=${filterOf({ id: { $in: ids } })}`);
    expect(r.status).toBe(200);
    const listed = rowsOf(await r.json()).map((x: any) => x.id);
    expect([...listed].sort(), 'both owners’ rows, from the server row set').toEqual([...ids].sort());
  });
});
