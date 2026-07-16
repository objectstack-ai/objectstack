// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0056 — `read` (public-read) OWD proof on the REAL showcase app.
// `showcase_announcement` declares `sharingModel: 'public_read'` and nothing else: every
// member READS every announcement, but only the OWNER may edit/delete it — derived
// from the OWD baseline + auto-stamped `owner_id`, no RLS authored. This is the
// sibling of the `private` proof: same owner-write protection, but rows are
// VISIBLE across owners (the read-visibility axis of OWD).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const OBJ = '/data/showcase_announcement';
const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id ?? b?.recordId;

describe('showcase: public-read OWD (ADR-0056)', () => {
  let stack: VerifyStack;
  let aToken: string;
  let bToken: string;
  let aAnnId: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    await stack.signIn();
    aToken = await stack.signUp('pr-alice@verify.test');
    bToken = await stack.signUp('pr-bob@verify.test');

    const a = await stack.apiAs(aToken, 'POST', OBJ, { title: 'Alice announces', body: 'hello team' });
    expect(a.status).toBeLessThan(300);
    aAnnId = idOf(await a.json());
    expect(aAnnId).toBeTruthy();
  }, 60_000);

  afterAll(async () => { await stack?.stop(); });

  it('every member READS another owner’s announcement (public-read)', async () => {
    const byId = await stack.apiAs(bToken, 'GET', `${OBJ}/${aAnnId}`);
    expect(byId.status, 'bob reads alice announcement by id').toBe(200);

    const list = await stack.apiAs(bToken, 'GET', OBJ);
    const titles: string[] = ((await list.json()).records ?? []).map((x: any) => x.title);
    expect(titles, 'bob sees alice announcement in the list').toContain('Alice announces');
  });

  it('but only the OWNER may edit it', async () => {
    const foreign = await stack.apiAs(bToken, 'PATCH', `${OBJ}/${aAnnId}`, { body: 'tampered' });
    expect(foreign.status, 'bob must not edit alice announcement').not.toBeLessThan(300);

    const own = await stack.apiAs(aToken, 'PATCH', `${OBJ}/${aAnnId}`, { body: 'edited by owner' });
    expect(own.status, 'alice edits her own announcement').toBeLessThan(300);
  });

  it('contrast with private: read-visibility is the distinguishing axis', async () => {
    // (sanity) the announcement is readable cross-owner — the very thing the
    // private note forbids — confirming `read` vs `private` are distinct OWDs.
    const r = await stack.apiAs(bToken, 'GET', `${OBJ}/${aAnnId}`);
    expect(r.status).toBe(200);
  });
});
