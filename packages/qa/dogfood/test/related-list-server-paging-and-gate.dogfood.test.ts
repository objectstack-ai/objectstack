// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Checklist item `records-forms.related-list-server-pagination` (#26573): the
// server half of its clauses, at the REST data door the related list reads
// through — `GET /api/v1/data/showcase_contact` scoped by the parent filter —
// on the showcase as shipped (Northwind carries 26 seeded contacts).
//
//   acceptance[1]'s server half, negative[1] — the parent-scoped list answers
//     the filtered total (26), and $top/$skip pages partition the set: no id
//     repeated or skipped across the pages, and their union is the filtered
//     set the unpaged count reads.
//   acceptance[4] — each child the related list serves re-reads by its own
//     API id with the same row.
//   acceptance[5]'s server half, negative[2]'s server half — the child read is
//     gated at the server on both ends: a member staffed `contributor` (whose
//     set omits showcase_contact read) is refused the identical parent-scoped
//     query 403, and a member staffed `manager` reads it 200 with rows.
//
// The console's request shape (acceptance[0], negative[0]: `top`/`skip` on
// every child request), the pager text, the derived tabs and the relatedList
// config (acceptance[2], [3]) and the tab's absence for the contributor stay
// network/dom legs.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { context: { isSystem: true } } as const;
const CONTACT = 'showcase_contact';

type Answer = { status: number; json: any; text: string };

describe('records-forms.related-list-server-pagination — the parent-scoped child read over REST', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok = '';
  let contributorTok = '';
  let managerTok = '';
  let northwindId = '';

  const call = async (token: string, path: string): Promise<Answer> => {
    const res = await stack.apiAs(token, 'GET', path);
    const text = await res.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  const rowsOf = (json: any): any[] => json.records ?? json.data ?? json.value ?? [];
  const childPath = (extra = '') =>
    `/data/${CONTACT}?$filter=${encodeURIComponent(JSON.stringify([['account', '=', northwindId]]))}${extra}`;

  /** Sign a member up and staff one showcase position on their own membership. */
  const staffed = async (email: string, position: string): Promise<string> => {
    const token = await stack.signUp(email, 'Rel!Pass12345', `Related list ${position}`);
    const [user] = await ql.find('sys_user', { where: { email }, limit: 1 }, SYS);
    let membership: any;
    for (let i = 0; i < 40 && !membership; i++) {
      [membership] = await ql.find('sys_member', { where: { user_id: user.id }, limit: 1 }, SYS);
      if (!membership) await new Promise((r) => setTimeout(r, 250));
    }
    expect(membership, `a sys_member row for ${email}`).toBeTruthy();
    await ql.insert('sys_user_position', { user_id: user.id, position, organization_id: membership.organization_id }, SYS);
    expect((await stack.contextFor(token)).positions ?? []).toContain(position);
    return token;
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    adminTok = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    const [northwind] = await stack.rows('showcase_account', { name: 'Northwind' });
    northwindId = String(northwind.id);
    contributorTok = await staffed('rel-contributor@verify.test', 'contributor');
    managerTok = await staffed('rel-manager@verify.test', 'manager');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[1], negative[1]: the filtered total is 26 and $top/$skip pages partition it', async () => {
    const all = await call(adminTok, childPath('&$top=200'));
    expect(all.status, all.text).toBe(200);
    const allIds = rowsOf(all.json).map((r) => String(r.id));
    expect(allIds, 'Northwind carries the 26 seeded contacts').toHaveLength(26);

    const pageIds: string[][] = [];
    for (const skip of [0, 10, 20]) {
      const page = await call(adminTok, childPath(`&$top=10&$skip=${skip}&$orderby=name&$count=true`));
      expect(page.status, page.text).toBe(200);
      expect(page.json).toMatchObject({ total: 26, hasMore: skip < 20 });
      pageIds.push(rowsOf(page.json).map((r) => String(r.id)));
    }
    expect(pageIds.map((p) => p.length)).toEqual([10, 10, 6]);
    const union = pageIds.flat();
    expect(new Set(union).size, 'no id repeated across pages').toBe(union.length);
    expect([...union].sort(), 'no id skipped').toEqual([...allIds].sort());
  });

  it('acceptance[4]: each served child re-reads by its own API id with the same row', async () => {
    const page = await call(adminTok, childPath('&$top=5&$orderby=name'));
    expect(page.status, page.text).toBe(200);
    const served = rowsOf(page.json);
    expect(served).toHaveLength(5);
    for (const row of served) {
      const read = await call(adminTok, `/data/${CONTACT}/${row.id}`);
      expect(read.status, read.text).toBe(200);
      expect(read.json.record ?? read.json).toMatchObject({ id: row.id, name: row.name, email: row.email, account: northwindId });
    }
  });

  it('acceptance[5], negative[2]: the contributor is refused the parent-scoped child query 403; the manager reads it 200 with rows', async () => {
    const refused = await call(contributorTok, childPath('&$top=10'));
    expect(refused.status, refused.text).toBe(403);
    expect(rowsOf(refused.json)).toHaveLength(0);

    const served = await call(managerTok, childPath('&$top=10'));
    expect(served.status, served.text).toBe(200);
    expect(rowsOf(served.json).length).toBeGreaterThan(0);
  });
});
