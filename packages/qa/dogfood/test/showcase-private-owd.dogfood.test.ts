// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0056 — declarative `private` OWD proof on the REAL showcase app.
// `showcase_private_note` declares `sharingModel: 'private'` and NOTHING else:
// no RLS policy, no owner predicate, no permission-set rule. Two plain sign-ups
// (governed only by the default member set) each create notes; the engine scopes
// every read/write to the owner purely from the OWD baseline + the auto-stamped
// `owner_id`. This is the canonical "declare one word, get owner isolation"
// capability — proven end-to-end through the real HTTP stack.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const OBJ = '/data/showcase_private_note';
const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id ?? b?.recordId;

describe('showcase: declarative private OWD (ADR-0056)', () => {
  let stack: VerifyStack;
  let aToken: string;
  let bToken: string;
  let aNoteId: string;
  let bNoteId: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    await stack.signIn(); // seed dev admin (first user)
    aToken = await stack.signUp('owd-alice@verify.test');
    bToken = await stack.signUp('owd-bob@verify.test');

    const a1 = await stack.apiAs(aToken, 'POST', OBJ, { title: 'Alice private 1', body: 'a-body' });
    expect(a1.status, 'alice creates note').toBeLessThan(300);
    aNoteId = idOf(await a1.json());
    await stack.apiAs(aToken, 'POST', OBJ, { title: 'Alice private 2' });

    const b1 = await stack.apiAs(bToken, 'POST', OBJ, { title: 'Bob private 1' });
    expect(b1.status, 'bob creates note').toBeLessThan(300);
    bNoteId = idOf(await b1.json());

    expect(aNoteId, 'alice note id').toBeTruthy();
    expect(bNoteId, 'bob note id').toBeTruthy();
  }, 60_000);

  afterAll(async () => { await stack?.stop(); });

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
});
