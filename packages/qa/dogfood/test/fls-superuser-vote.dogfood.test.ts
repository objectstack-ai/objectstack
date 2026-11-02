// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0066 D2 ⑧ — ruling of record 6573563853, letter A] A permission set
// holding the super-user bypass on an object votes on every field of that
// object in the field-permission merge, so an app set's `readable: false`
// narrows only a caller who holds no wider set.
//
// The card's measurement, on a real boot: an app set grants `sys_business_unit`
// read and withholds every field but `name`; the seeded platform admin also
// holds it, beside `admin_full_access` (`'*'` with `viewAllRecords` /
// `modifyAllRecords`, no field entries). The admin's list came back `name`
// only, `sort=code` was refused 403, and Setup → Business Units rendered empty
// columns, because a set that declares no field entry cast no vote.
//
// Every reader of the merge is asked here, for the admin AND for a member who
// holds the app set alone (the control the ruling keeps: the member stays
// masked):
//
//   - list projection     `GET /data/sys_business_unit`
//   - record read         `GET /data/sys_business_unit/:id`
//   - sort / filter gate  `?sort=code`, `$filter` on `code`
//   - row-blind merge     `GET /auth/me/permissions` → `fields`
//   - explain             `POST /security/explain` → the `fls` layer
//
// The pure merge (both spellings, one predicate) is pinned in
// `packages/plugins/plugin-security/src/fls-superuser-vote.test.ts`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { showcaseAppDefaultSecurity } from './showcase-security.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

const SYS = { isSystem: true } as const;
const OBJ = 'sys_business_unit';
/** The seeded unit every assertion reads (`examples/app-showcase` seed, `code: 'ACME'`). */
const UNIT = 'bu_acme';
/** The fields the app set withholds — the Setup columns the card saw empty. */
const MASKED = ['code', 'kind', 'manager_user_id', 'active'] as const;
const APP_SET = 'showcase_scratch_bu_field_mask';
const MEMBER = 'fls-superuser-vote.member@verify.test';
/** The harness's seeded platform admin (`@objectstack/verify`'s default). */
const ADMIN = 'admin@objectos.ai';

const recordOf = (b: any) => b?.record ?? b?.data ?? b;
const rowsOf = (b: any) => b?.records ?? b?.data ?? (Array.isArray(b) ? b : []);
const has = (row: any, key: string) => Object.prototype.hasOwnProperty.call(row ?? {}, key);

describe('[ruling 6573563853] a super-user set reads every field an app set masks; the member stays masked', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  let memberTok: string;
  let memberId: string;

  beforeAll(async () => {
    stack = await bootShowcase({ security: showcaseAppDefaultSecurity() });
    adminTok = await stack.signIn(); // the seeded platform admin first, so the sign-up is a plain member
    memberTok = await stack.signUp(MEMBER);
    ql = await stack.kernel.getServiceAsync('objectql');

    // The card's app set, authored through the metadata door (ADR-0131 D3/D4).
    const authored = await stack.apiAs(adminTok, 'PUT', `/meta/permission/${APP_SET}`, {
      name: APP_SET,
      label: 'Scratch: app mask on business-unit fields',
      description: 'Test-authored (ruling 6573563853): object read, every field but name withheld.',
      objects: { [OBJ]: { allowRead: true } },
      fields: Object.fromEntries(MASKED.map((f) => [`${OBJ}.${f}`, { readable: false, editable: false }])),
    });
    expect(authored.status, `app set authored: ${await authored.clone().text()}`).toBeLessThan(300);
    const ps = await catalogPermissionSet(ql, APP_SET);
    expect(ps, 'the catalog serves the app set').toBeTruthy();

    const adminId = (await ql.findOne('sys_user', { where: { email: ADMIN }, context: SYS }))?.id;
    memberId = (await ql.findOne('sys_user', { where: { email: MEMBER }, context: SYS }))?.id;
    expect(adminId, 'admin resolved').toBeTruthy();
    expect(memberId, 'member provisioned').toBeTruthy();
    for (const user_id of [adminId, memberId]) {
      await ql.insert('sys_user_permission_set', { user_id, permission_set: APP_SET }, { context: SYS });
    }

    const stored = await ql.findOne(OBJ, { where: { id: UNIT }, context: SYS });
    for (const f of ['code', 'kind', 'active'] as const) {
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

  it('premise: the admin holds admin_full_access AND the app set; the member holds the app set without a super-user set', async () => {
    const admin = await mePermissions(adminTok);
    expect(admin.permissionSets).toEqual(expect.arrayContaining(['admin_full_access', APP_SET]));
    const member = await mePermissions(memberTok);
    expect(member.permissionSets).toContain(APP_SET);
    expect(member.permissionSets).not.toContain('admin_full_access');
  });

  // ── /auth/me/permissions — the row-blind merge ─────────────────────────────
  it('/auth/me/permissions: every masked field is readable and editable for the admin', async () => {
    const { fields } = await mePermissions(adminTok);
    for (const f of MASKED) expect(fields?.[`${OBJ}.${f}`], f).toEqual({ readable: true, editable: true });
  });

  it('[control] /auth/me/permissions: the member is still told every masked field is unreadable', async () => {
    const { fields } = await mePermissions(memberTok);
    for (const f of MASKED) expect(fields?.[`${OBJ}.${f}`], f).toEqual({ readable: false, editable: false });
  });

  // Each door is asked in two cases, the admin's and the member's, so an
  // ablation of the vote reds the admin half while the member control stays
  // green on its own.

  // ── list projection ─────────────────────────────────────────────────────────
  it('list: the admin is served every masked field', async () => {
    const a = await stack.apiAs(adminTok, 'GET', `/data/${OBJ}`);
    expect(a.status).toBe(200);
    const adminRow = rowsOf(await a.json()).find((r: any) => r.id === UNIT);
    expect(adminRow, 'the admin lists the seeded unit').toBeTruthy();
    for (const f of ['code', 'kind', 'active']) expect(has(adminRow, f), `admin list carries ${f}`).toBe(true);
  });

  it('[control] list: the member is served none of the masked fields', async () => {
    const m = await stack.apiAs(memberTok, 'GET', `/data/${OBJ}`);
    expect(m.status).toBe(200);
    const memberRows = rowsOf(await m.json());
    expect(memberRows.length, 'the member lists rows at all (vacuity guard)').toBeGreaterThan(0);
    for (const row of memberRows) {
      expect(has(row, 'name'), 'the unmasked field is served').toBe(true);
      for (const f of MASKED) expect(has(row, f), `member list strips ${f} (row ${row.id})`).toBe(false);
    }
  });

  // ── record read ─────────────────────────────────────────────────────────────
  it('record read: the admin gets the stored values', async () => {
    const stored = await ql.findOne(OBJ, { where: { id: UNIT }, context: SYS });
    const a = await stack.apiAs(adminTok, 'GET', `/data/${OBJ}/${UNIT}`);
    expect(a.status).toBe(200);
    const adminRecord = recordOf(await a.json());
    expect(adminRecord.code).toBe(stored.code);
    expect(adminRecord.kind).toBe(stored.kind);
  });

  it('[control] record read: the member gets name only', async () => {
    const stored = await ql.findOne(OBJ, { where: { id: UNIT }, context: SYS });
    const m = await stack.apiAs(memberTok, 'GET', `/data/${OBJ}/${UNIT}`);
    expect(m.status).toBe(200);
    const memberRecord = recordOf(await m.json());
    expect(memberRecord.name).toBe(stored.name);
    for (const f of MASKED) expect(has(memberRecord, f), `member record strips ${f}`).toBe(false);
  });

  // ── sort / filter gate ─────────────────────────────────────────────────────
  const FILTER = encodeURIComponent(JSON.stringify({ code: 'ACME' }));

  it('sort and filter on a masked field: 200 for the admin', async () => {
    const sorted = await stack.apiAs(adminTok, 'GET', `/data/${OBJ}?sort=code`);
    expect(sorted.status, `admin sort: ${await sorted.clone().text()}`).toBe(200);
    expect(rowsOf(await sorted.json()).length).toBeGreaterThan(0);
    const filtered = await stack.apiAs(adminTok, 'GET', `/data/${OBJ}?$filter=${FILTER}`);
    expect(filtered.status, `admin filter: ${await filtered.clone().text()}`).toBe(200);
    expect(rowsOf(await filtered.json()).map((r: any) => r.id)).toContain(UNIT);
  });

  it('[control] sort and filter on a masked field: 403 PERMISSION_DENIED naming the field for the member', async () => {
    for (const query of ['sort=code', `$filter=${FILTER}`]) {
      const m = await stack.apiAs(memberTok, 'GET', `/data/${OBJ}?${query}`);
      expect(m.status, query).toBe(403);
      const body: any = await m.json();
      expect(body?.code ?? body?.error?.code, query).toBe('PERMISSION_DENIED');
      expect(String(body?.error?.message ?? body?.error ?? ''), query).toContain('code');
    }
  });

  // ── explain ─────────────────────────────────────────────────────────────────
  const flsOf = async (body: Record<string, unknown>) => {
    const r = await stack.apiAs(adminTok, 'POST', '/security/explain', body);
    const text = await r.text();
    expect(r.status, text).toBe(200);
    const json: any = JSON.parse(text);
    const layers = json?.layers ?? json?.data?.layers ?? [];
    const fls = layers.find((l: any) => l.layer === 'fls');
    expect(fls, `an fls layer: ${text}`).toBeTruthy();
    return fls;
  };

  it('explain: the fls layer masks nothing for the admin', async () => {
    const admin = await flsOf({ object: OBJ, operation: 'read' });
    expect(admin.verdict, admin.detail).toBe('not_applicable');
  });

  it('[control] explain: the fls layer names every masked field for the member', async () => {
    const member = await flsOf({ object: OBJ, operation: 'read', userId: memberId });
    expect(member.verdict, member.detail).toBe('narrows');
    for (const f of MASKED) expect(member.detail).toContain(f);
  });
});
