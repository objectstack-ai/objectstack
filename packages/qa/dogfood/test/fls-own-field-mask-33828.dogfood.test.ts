// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0066 D2 ⑧ note of 2026-11-15] A permission set's own explicit
// `readable: false` row on a field binds that set's holders over the set's own
// View All vote. Pinned here on a real boot, at the two doors a consumer
// meets the rule on:
//
//   - row-blind merge     `GET /auth/me/permissions` → `fields`
//   - list projection     `GET /data/sys_business_unit`
//
// Two members are asked at each door. The first holds the pair alone (a set
// granting View All on the object and hiding four of its fields in its own
// rows): the fields are not served. The second also holds a set that grants
// View All on the object and names no field (the control the 2026-11-02 note
// keeps, ruling of record 6573563853): another set's View All still reads
// every field, and never edits one.
//
// The pure merges are pinned in
// `packages/plugins/plugin-security/src/fls-own-field-mask-33828.test.ts` and
// `packages/core/src/security/superuser-field-vote-33828.test.ts`; the doors
// the 2026-11-02 note opened are pinned in `fls-superuser-vote.dogfood.test.ts`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { showcaseAppDefaultSecurity } from './showcase-security.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

const SYS = { isSystem: true } as const;
const OBJ = 'sys_business_unit';
/** The seeded unit the list assertions read (`examples/app-showcase` seed, `code: 'ACME'`). */
const UNIT = 'bu_acme';
/** The fields the pair hides in its own rows. */
const MASKED = ['code', 'kind', 'manager_user_id', 'active'] as const;
/** The masked fields the seeded unit stores a value for (the oracle of the control's list read). */
const STORED = ['code', 'kind', 'active'] as const;
/** View All on the object, and the set's own rows hiding fields of it. */
const PAIR_SET = 'showcase_scratch_bu_own_field_mask';
/** View All on the object, and no field row. */
const SECOND_SET = 'showcase_scratch_bu_view_all';
const HOLDER = 'fls-own-field-mask.holder@verify.test';
const BOTH = 'fls-own-field-mask.both@verify.test';

const rowsOf = (b: any) => b?.records ?? b?.data ?? (Array.isArray(b) ? b : []);
const has = (row: any, key: string) => Object.prototype.hasOwnProperty.call(row ?? {}, key);

describe('[ADR-0066 ⑧ note of 2026-11-15] a set\'s own readable: false row binds its holders beside its own View All; a second View All set still reads', () => {
  let stack: VerifyStack;
  let ql: any;
  let holderTok: string;
  let bothTok: string;

  beforeAll(async () => {
    stack = await bootShowcase({ security: showcaseAppDefaultSecurity() });
    const adminTok = await stack.signIn(); // the seeded platform admin first, so the sign-ups are plain members
    holderTok = await stack.signUp(HOLDER);
    bothTok = await stack.signUp(BOTH);
    ql = await stack.kernel.getServiceAsync('objectql');

    // Both sets are authored through the metadata door (ADR-0131 D3/D4).
    const sets = [
      {
        name: PAIR_SET,
        label: 'Scratch: View All on business units, own field mask',
        description: 'Test-authored (ADR-0066 D2 ⑧ note of 2026-11-15): View All on the object, four fields hidden in its own rows.',
        objects: { [OBJ]: { allowRead: true, viewAllRecords: true } },
        fields: Object.fromEntries(MASKED.map((f) => [`${OBJ}.${f}`, { readable: false, editable: false }])),
      },
      {
        name: SECOND_SET,
        label: 'Scratch: View All on business units',
        description: 'Test-authored (ADR-0066 D2 ⑧ note of 2026-11-15): View All on the object, no field row.',
        objects: { [OBJ]: { allowRead: true, viewAllRecords: true } },
      },
    ];
    for (const body of sets) {
      const authored = await stack.apiAs(adminTok, 'PUT', `/meta/permission/${body.name}`, body);
      expect(authored.status, `${body.name} authored: ${await authored.clone().text()}`).toBeLessThan(300);
      expect(await catalogPermissionSet(ql, body.name), `the catalog serves ${body.name}`).toBeTruthy();
    }

    const holderId = (await ql.findOne('sys_user', { where: { email: HOLDER }, context: SYS }))?.id;
    const bothId = (await ql.findOne('sys_user', { where: { email: BOTH }, context: SYS }))?.id;
    expect(holderId, 'holder provisioned').toBeTruthy();
    expect(bothId, 'second member provisioned').toBeTruthy();
    const grants: Array<[string, string]> = [
      [holderId, PAIR_SET],
      [bothId, PAIR_SET],
      [bothId, SECOND_SET],
    ];
    for (const [user_id, permission_set] of grants) {
      await ql.insert('sys_user_permission_set', { user_id, permission_set }, { context: SYS });
    }

    const stored = await ql.findOne(OBJ, { where: { id: UNIT }, context: SYS });
    for (const f of STORED) {
      expect(stored?.[f], `the seeded unit carries ${f} (the oracle the reads compare to)`).not.toBeUndefined();
    }
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  const mePermissions = async (tok: string) => {
    const r = await stack.apiAs(tok, 'GET', '/auth/me/permissions');
    expect(r.status).toBe(200);
    const body: any = await r.json();
    return body?.data ?? body;
  };

  it('premise: the holder holds the pair alone; the second member holds the pair and the plain View All set; neither holds admin_full_access', async () => {
    const holder = await mePermissions(holderTok);
    expect(holder.permissionSets).toContain(PAIR_SET);
    expect(holder.permissionSets).not.toContain(SECOND_SET);
    expect(holder.permissionSets).not.toContain('admin_full_access');
    const both = await mePermissions(bothTok);
    expect(both.permissionSets).toEqual(expect.arrayContaining([PAIR_SET, SECOND_SET]));
    expect(both.permissionSets).not.toContain('admin_full_access');
  });

  // ── /auth/me/permissions — the row-blind merge ─────────────────────────────
  it('/auth/me/permissions: the holder is told every field the set hides is unreadable', async () => {
    const { fields } = await mePermissions(holderTok);
    for (const f of MASKED) expect(fields?.[`${OBJ}.${f}`], f).toEqual({ readable: false, editable: false });
  });

  it('[control] /auth/me/permissions: the second set\'s View All reads every hidden field, and edits none', async () => {
    const { fields } = await mePermissions(bothTok);
    for (const f of MASKED) expect(fields?.[`${OBJ}.${f}`], f).toEqual({ readable: true, editable: false });
  });

  // ── list projection ─────────────────────────────────────────────────────────
  it('list: the holder reads the rows, and none of the fields the set hides', async () => {
    const r = await stack.apiAs(holderTok, 'GET', `/data/${OBJ}`);
    expect(r.status).toBe(200);
    const rows = rowsOf(await r.json());
    expect(rows.map((row: any) => row.id), 'the holder lists the seeded unit (vacuity guard)').toContain(UNIT);
    for (const row of rows) {
      expect(has(row, 'name'), 'the field the set does not hide is served').toBe(true);
      for (const f of MASKED) expect(has(row, f), `holder list strips ${f} (row ${row.id})`).toBe(false);
    }
  });

  it('[control] list: the second member is served the hidden fields', async () => {
    const r = await stack.apiAs(bothTok, 'GET', `/data/${OBJ}`);
    expect(r.status).toBe(200);
    const row = rowsOf(await r.json()).find((candidate: any) => candidate.id === UNIT);
    expect(row, 'the second member lists the seeded unit').toBeTruthy();
    for (const f of STORED) expect(has(row, f), `second member list carries ${f}`).toBe(true);
  });
});
