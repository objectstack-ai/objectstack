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
// The pin: a non-admin gets min(top, total) rows for every slice whatever its
// position. CONTROLS: the same slices one at a time, and the seeded admin
// (whose reads take no depth at all).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { context: { isSystem: true } } as const;
const CONTACT = { object: 'showcase_contact', field: 'account', top: 3 } as const;
const ZOO = { object: 'showcase_field_zoo', field: 'f_lookup', top: 3 } as const;

type Slice = { object: string; field: string; total?: number; records?: unknown[]; error?: unknown };

describe('#33051 record page related slices — each slice reads at its own object\'s depth', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok = '';
  let managerTok = '';
  let northwindId = '';

  const page = async (token: string, related: ReadonlyArray<typeof CONTACT | typeof ZOO>): Promise<Slice[]> => {
    const res = await stack.apiAs(token, 'POST', `/data/showcase_account/${northwindId}/page`, { related });
    const text = await res.text();
    expect(res.status, text).toBe(200);
    const json = JSON.parse(text);
    return (json.data ?? json).related as Slice[];
  };
  const sliceOf = (slices: Slice[], object: string): Slice => {
    const slice = slices.find((s) => s.object === object);
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
        // Never wider either: a sibling's depth must not widen a slice.
        expect(contact.total).toBe(alone.contact.total);
        expect(zoo.total).toBe(alone.zoo.total);
        expect((zoo.records as any[]).map((r) => r.id).sort()).toEqual((alone.zoo.records as any[]).map((r) => r.id).sort());
      }
    }
  });
});
