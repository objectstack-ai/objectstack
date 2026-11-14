// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#33051] `POST /data/:object/:id/page` answers its `related[]` slices with
// concurrent `findData` reads that share the caller's ONE execution context.
// plugin-security's authz middleware resolves an access depth per object
// (ADR-0057 D1, step 2.6) and plugin-sharing's middleware reads it further down
// the same operation's chain. While the depth was stamped onto the shared
// envelope, a sibling read on another object overwrote it between the stamp
// and its read: on the stock showcase a member staffed `showcase_manager`
// (`showcase_contact` at `readScope: 'org'`, `showcase_field_zoo` at the owner
// depth) got the contact slice's rows filtered at the field zoo's `own` depth —
// 1 row beside `total: 26` — whenever the contact slice was not the last one.
//
// The pin: each related slice equals its own read alone, whatever its
// position — a non-admin gets min(top, total) rows for every slice, and on a
// page whose slices sit on a `private` object (`showcase_private_note`) beside
// an `org`-depth one (`showcase_contact`) each slice's ids and total are the
// ones it answers alone, in both orders. CONTROLS: the same slices one at a
// time, and the seeded admin (whose reads take no depth at all).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { context: { isSystem: true } } as const;
const CONTACT = { object: 'showcase_contact', field: 'account', top: 3 } as const;
const ZOO = { object: 'showcase_field_zoo', field: 'f_lookup', top: 3 } as const;
// Parent = a plain member (bob); both children point back at `sys_user` by `owner_id`.
const NOTE = { object: 'showcase_private_note', field: 'owner_id', top: 50 } as const;
const CONTACT_BY_OWNER = { object: 'showcase_contact', field: 'owner_id', top: 3 } as const;

type Slice = { object: string; field: string; total?: number; records?: unknown[]; error?: unknown };

describe('#33051 record page related slices — each slice reads at its own object\'s depth', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok = '';
  let managerTok = '';
  let northwindId = '';
  let bobId = '';

  type Entry = { object: string; field: string; top: number };
  const pageOf = async (token: string, object: string, id: string, related: ReadonlyArray<Entry>): Promise<Slice[]> => {
    const res = await stack.apiAs(token, 'POST', `/data/${object}/${id}/page`, { related });
    const text = await res.text();
    expect(res.status, text).toBe(200);
    const json = JSON.parse(text);
    return (json.data ?? json).related as Slice[];
  };
  const page = (token: string, related: ReadonlyArray<Entry>) => pageOf(token, 'showcase_account', northwindId, related);
  const sliceOf = (slices: Slice[], object: string, field?: string): Slice => {
    const slice = slices.find((s) => s.object === object && (field === undefined || s.field === field));
    expect(slice, `a ${object} slice`).toBeTruthy();
    expect(slice!.error, JSON.stringify(slice!.error)).toBeUndefined();
    return slice!;
  };
  /** A slice carries min(top, total) rows. */
  const expectFilled = (slice: Slice, top: number) => {
    expect(typeof slice.total).toBe('number');
    expect(slice.records?.length, `${slice.object}: ${slice.records?.length} rows beside total ${slice.total}`)
      .toBe(Math.min(top, slice.total!));
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    adminTok = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    const [northwind] = await stack.rows('showcase_account', { name: 'Northwind' });
    northwindId = String(northwind.id);

    const email = 'page-slices-manager@verify.test';
    managerTok = await stack.signUp(email, 'Rel!Pass12345', 'Page slices manager');
    const [user] = await ql.find('sys_user', { where: { email }, limit: 1 }, SYS);
    let membership: any;
    for (let i = 0; i < 40 && !membership; i++) {
      [membership] = await ql.find('sys_member', { where: { user_id: user.id }, limit: 1 }, SYS);
      if (!membership) await new Promise((r) => setTimeout(r, 250));
    }
    expect(membership, `a sys_member row for ${email}`).toBeTruthy();
    await ql.insert('sys_user_position', { user_id: user.id, position: 'showcase_manager', organization_id: membership.organization_id }, SYS);
    expect((await stack.contextFor(managerTok)).positions ?? []).toContain('showcase_manager');

    // bob: a plain member who owns two private notes and two contacts.
    const bobEmail = 'page-slices-bob@verify.test';
    const bobTok = await stack.signUp(bobEmail, 'Rel!Pass12345', 'Page slices bob');
    const [bob] = await ql.find('sys_user', { where: { email: bobEmail }, limit: 1 }, SYS);
    bobId = String(bob.id);
    for (const title of ['bob note 1', 'bob note 2']) {
      const res = await stack.apiAs(bobTok, 'POST', '/data/showcase_private_note', { title });
      expect(res.status, await res.clone().text()).toBeLessThan(300);
    }
    let bobMember: any;
    for (let i = 0; i < 40 && !bobMember; i++) {
      [bobMember] = await ql.find('sys_member', { where: { user_id: bob.id }, limit: 1 }, SYS);
      if (!bobMember) await new Promise((r) => setTimeout(r, 250));
    }
    for (const n of [1, 2]) {
      await ql.insert('showcase_contact', { name: `Bob Contact ${n}`, email: `bob.c${n}@verify.test`, owner_id: bobId, organization_id: bobMember?.organization_id }, SYS);
    }
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('CONTROL: each slice alone fills to min(top, total) for the manager', async () => {
    const contact = sliceOf(await page(managerTok, [CONTACT]), CONTACT.object);
    expect(contact.total, 'Northwind carries the 26 seeded contacts, all readable at the org depth').toBe(26);
    expectFilled(contact, CONTACT.top);
    expectFilled(sliceOf(await page(managerTok, [ZOO]), ZOO.object), ZOO.top);
  });

  it('CONTROL: the admin fills every slice in either order', async () => {
    for (const related of [[CONTACT, ZOO], [ZOO, CONTACT]] as const) {
      const slices = await page(adminTok, related);
      expectFilled(sliceOf(slices, CONTACT.object), CONTACT.top);
      expectFilled(sliceOf(slices, ZOO.object), ZOO.top);
    }
  });

  it('the manager fills every slice whatever its position, and agrees with the slice read alone', async () => {
    const alone = {
      contact: sliceOf(await page(managerTok, [CONTACT]), CONTACT.object),
      zoo: sliceOf(await page(managerTok, [ZOO]), ZOO.object),
    };
    for (const related of [[CONTACT, ZOO], [ZOO, CONTACT]] as const) {
      // Repeated: the interleaving is the scheduler's, so one lucky order is not a pass.
      for (let round = 0; round < 3; round++) {
        const slices = await page(managerTok, related);
        const contact = sliceOf(slices, CONTACT.object);
        const zoo = sliceOf(slices, ZOO.object);
        expectFilled(contact, CONTACT.top);
        expectFilled(zoo, ZOO.top);
        // And each slice equals its own read alone.
        expect(contact.total).toBe(alone.contact.total);
        expect(zoo.total).toBe(alone.zoo.total);
        expect((zoo.records as any[]).map((r) => r.id).sort()).toEqual((alone.zoo.records as any[]).map((r) => r.id).sort());
      }
    }
  });

  it('each related slice equals its own read alone, whatever its position (a private-object slice beside an org-depth one)', async () => {
    const ids = (slice: Slice) => (slice.records ?? []).map((r: any) => String(r.id)).sort();
    const aloneNote = sliceOf(await pageOf(managerTok, 'sys_user', bobId, [NOTE]), NOTE.object, NOTE.field);
    const aloneContact = sliceOf(await pageOf(managerTok, 'sys_user', bobId, [CONTACT_BY_OWNER]), CONTACT_BY_OWNER.object, CONTACT_BY_OWNER.field);
    expect(aloneNote.total, 'the manager reads none of bob\'s private notes alone').toBe(0);
    expect(aloneNote.records ?? []).toHaveLength(0);
    expect(aloneContact.total, 'bob owns two contacts').toBe(2);
    for (const related of [[NOTE, CONTACT_BY_OWNER], [CONTACT_BY_OWNER, NOTE]] as const) {
      for (let round = 0; round < 3; round++) {
        const slices = await pageOf(managerTok, 'sys_user', bobId, related);
        const note = sliceOf(slices, NOTE.object, NOTE.field);
        const contact = sliceOf(slices, CONTACT_BY_OWNER.object, CONTACT_BY_OWNER.field);
        const seen = `${related[0].object} first: note total=${note.total} rows=${JSON.stringify((note.records ?? []).map((r: any) => r.title))}`;
        expect(ids(note), seen).toEqual(ids(aloneNote));
        expect(note.total, seen).toBe(aloneNote.total);
        expect(ids(contact)).toEqual(ids(aloneContact));
        expect(contact.total).toBe(aloneContact.total);
      }
    }
  });
});
