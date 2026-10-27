// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `access-security.owd-sharing-matrix` acceptance[4] and acceptance[5] (#26571)
// — the `controlled_by_parent` model on the STOCK showcase grants, over HTTP.
//
// `showcase-invoice-cbp.dogfood.test.ts` proves the derivation mechanism with a
// test-local fallback set. This file drives the personas the checklist item
// names, holding only what the showcase ships: two contributors C1/C2
// (`showcase_contributor` — invoice owner RLS `owner == current_user.email`,
// line access derived from the master, no line rule authored) and an auditor
// (`showcase_auditor` — `viewAllRecords` on `showcase_invoice_line`).
//
//  - acceptance[4]: C2 cannot list, read by id or PATCH C1's line; C1 reads and
//    writes it by id. Derivation is the only mechanism in play.
//  - acceptance[5]: the auditor's viewAllRecords crosses the derived scope — C1's
//    line is in the auditor's list (and by-id read) whatever owns the master.
//
// Shared-stack eligible: grants are `sys_user_permission_set` rows for this
// file's own sign-ups, and every list is filtered to the rows this file made.

import { describe, it, expect, beforeAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { getSharedShowcase } from './shared-showcase.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

const SYS = { isSystem: true } as const;
const LINES = '/data/showcase_invoice_line';
const C1 = 'cbp-pair-c1@verify.test';
const C2 = 'cbp-pair-c2@verify.test';
const AUDITOR = 'cbp-pair-auditor@verify.test';
const MARK = 'cbp-pair C1 line';

const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id ?? b?.recordId;
const rowsOf = (b: any) => b?.records ?? b?.data ?? (Array.isArray(b) ? b : []);
const filterOf = (where: Record<string, unknown>) => encodeURIComponent(JSON.stringify(where));

describe('showcase: controlled_by_parent lines across stock contributors and the auditor (ADR-0055)', () => {
  let stack: VerifyStack;
  let ql: any;
  const tok: Record<string, string> = {};
  let c1LineId: string;

  const lineDescription = async () =>
    (await ql.findOne('showcase_invoice_line', { where: { id: c1LineId }, context: SYS }))?.description;
  const listedIds = async (who: string) => {
    const r = await stack.apiAs(tok[who], 'GET', `${LINES}?$filter=${filterOf({ id: c1LineId })}`);
    expect(r.status, `${who} lists lines`).toBe(200);
    return rowsOf(await r.json()).map((x: any) => x.id);
  };

  beforeAll(async () => {
    stack = await getSharedShowcase();
    await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');

    const grants: Array<[string, string]> = [
      [C1, 'showcase_contributor'],
      [C2, 'showcase_contributor'],
      [AUDITOR, 'showcase_auditor'],
    ];
    for (const [email, set] of grants) {
      tok[email] = await stack.signUp(email);
      const ps = await catalogPermissionSet(ql, set);
      expect(ps, `permission set ${set} served by the security catalog`).toBeTruthy();
      const userId = (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;
      expect(userId, `persona ${email} provisioned`).toBeTruthy();
      await ql.insert('sys_user_permission_set', { user_id: userId, permission_set: ps.name }, { context: SYS });
    }

    // An invoice may not be issued against a churned account (#18682).
    const account = (await ql.find('showcase_account', { where: { status: { $ne: 'churned' } }, limit: 1, context: SYS }))?.[0]?.id;
    const product = (await ql.find('showcase_product', { limit: 1, context: SYS }))?.[0]?.id;
    expect(account && product, 'the showcase seed provides an account and a product').toBeTruthy();

    // C1 builds the master and its line through the REST door, as the item's
    // steps do: the invoice owner is C1's email, so the owner RLS selects it.
    const inv = await stack.apiAs(tok[C1], 'POST', '/data/showcase_invoice', {
      name: 'INV-CBP-PAIR-C1', account, status: 'draft', owner: C1,
    });
    expect(inv.status, 'C1 creates their invoice').toBeLessThan(300);
    const invoiceId = idOf(await inv.json());
    const line = await stack.apiAs(tok[C1], 'POST', LINES, {
      invoice: invoiceId, product, quantity: 1, description: MARK,
    });
    expect(line.status, 'C1 creates a line under it').toBeLessThan(300);
    c1LineId = idOf(await line.json());
    expect(c1LineId, 'line id').toBeTruthy();
  }, 120_000);

  it('acceptance[4]: C2 does not see C1’s line in a list', async () => {
    expect(await listedIds(C2), 'the derived scope hides the line from the list').not.toContain(c1LineId);
    // Contrast on the same filtered request, so the exclusion is not an empty route.
    expect(await listedIds(C1), 'the owner’s identical list carries it').toContain(c1LineId);
  });

  it('acceptance[4]: C2 cannot read C1’s line by id', async () => {
    const r = await stack.apiAs(tok[C2], 'GET', `${LINES}/${c1LineId}`);
    expect(r.status, 'a line under an unreadable master is hidden by id').toBeGreaterThanOrEqual(300);
  });

  it('acceptance[4]: C2’s PATCH of C1’s line answers >= 400 and leaves it unchanged', async () => {
    const r = await stack.apiAs(tok[C2], 'PATCH', `${LINES}/${c1LineId}`, { description: 'forged by C2' });
    expect(r.status, 'the derived write gate refuses').toBeGreaterThanOrEqual(400);
    expect(await lineDescription(), 'the row is unchanged').toBe(MARK);
  });

  it('acceptance[4]: C1 reads and writes their own line by id (the entitled side)', async () => {
    const read = await stack.apiAs(tok[C1], 'GET', `${LINES}/${c1LineId}`);
    expect(read.status, 'C1 reads their line').toBe(200);
    const write = await stack.apiAs(tok[C1], 'PATCH', `${LINES}/${c1LineId}`, { description: `${MARK} (edited)` });
    expect(write.status, 'C1 edits their line').toBeLessThan(300);
    expect(await lineDescription(), 'and the edit persisted').toBe(`${MARK} (edited)`);
  });

  it('acceptance[5]: the auditor’s viewAllRecords surfaces C1’s line regardless of master ownership', async () => {
    expect(await listedIds(AUDITOR), 'the auditor’s list carries the foreign line').toContain(c1LineId);
    const byId = await stack.apiAs(tok[AUDITOR], 'GET', `${LINES}/${c1LineId}`);
    expect(byId.status, 'and the by-id read').toBe(200);
  });
});
