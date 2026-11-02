// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_personal_view` over REST on the real showcase stack — a reader's own
 * named list views, the server half of ruling 6570568131 on #28971 (letter C).
 *
 * The engine-level pins live beside the hooks
 * (`plugin-auth/src/personal-view-hooks.test.ts`); this file is the HTTP face a
 * console reader actually reaches, with the real composition, the real
 * authorization resolver and the real error mapping:
 *
 *  - `[owner]` a plain member saves, lists, reads and renames their own view
 *    through `/data/sys_personal_view`;
 *  - `[member]` another member reads none of them by id (404), lists none and
 *    updates none (404), and cannot delete one (403, no grant reaches it);
 *  - `[org-admin]` an organization administrator gets no back door: the same
 *    404s, because this object is named without the wildcard's super-user
 *    bits in the organization administrator's set;
 *  - `[body]` a body that is not spec's `ListView` answers `400
 *    VALIDATION_FAILED` with every `fields[]` path under `config`;
 *  - `[predicate]` a view that filters on a field the reader cannot read is
 *    saved (a save does not judge field security), and the list query that
 *    applies its filter is refused `403 PERMISSION_DENIED` by the existing
 *    predicate guard, naming the field;
 *  - `[meta]` the metadata API never serves a personal view as a view item;
 *  - `[door]` the owner's delete door, `DELETE /api/v1/personal-views/:id`
 *    (seat ruling 6583289013 on #29443, the #26161 shape): the owner removes
 *    their own view; another member and an organization administrator get
 *    the unknown-id 404 and the row stays; a platform administrator, whose
 *    bare wildcard reads the row, is refused loudly (403) and the row stays;
 *    anonymous is 401; and the generic data DELETE of the owner's own row is
 *    still 403, because the door grants nothing (`member_default` is bound to
 *    the `everyone` anchor and carries no delete bit, ADR-0090 D5).
 *
 *  - `[platform-admin]` the recorded boundary: `admin_full_access`'s bare
 *    wildcard reads, edits and deletes a member's view through the generic
 *    data door, as it does on `sys_user_preference` (the admin rescue path);
 *    only the own-row door refuses its delete.
 *
 * Refusals assert `code` AND `status` (ADR-0112).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { showcaseAppDefaultSecurity } from './showcase-security.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

const OBJ = 'sys_personal_view';
const TARGET = 'showcase_project';
/** The field the scratch set hides from the predicate persona. */
const DENIED = 'budget';
const SCRATCH_SET = 'personal_view_scratch_fls_read_deny';
const SYS = { isSystem: true } as const;

const ALICE = 'pv.alice@verify.test';
const BOB = 'pv.bob@verify.test';
const CAROL = 'pv.carol.orgadmin@verify.test';

const recordOf = (b: any) => b?.record ?? b?.data ?? b;
const rowsOf = (b: any) => b?.records ?? b?.data ?? (Array.isArray(b) ? b : []);
const errorCodeOf = (b: any) => b?.error?.code ?? b?.code;

const listView = (extra: Record<string, unknown> = {}) => ({
  type: 'grid',
  data: { provider: 'object', object: TARGET },
  columns: ['name'],
  ...extra,
});

describe('sys_personal_view over REST: a reader\'s own named list views (ruling 6570568131, letter C)', () => {
  let stack: VerifyStack;
  let ql: any;
  let aliceTok: string;
  let bobTok: string;
  let carolTok: string;
  let adminTok: string;
  let aliceId: string;

  const userIdOf = async (email: string): Promise<string> => {
    const id = (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;
    expect(id, `${email} provisioned`).toBeTruthy();
    return String(id);
  };

  /** Save a view as `token`'s owner and return the created row. */
  const save = async (token: string, ownerId: string, label: string, extra: Record<string, unknown> = {}) => {
    const r = await stack.apiAs(token, 'POST', `/data/${OBJ}`, {
      user_id: ownerId, object_name: TARGET, label, config: listView(), ...extra,
    });
    expect(r.status, await r.clone().text()).toBe(201);
    const row = recordOf(await r.json());
    expect(row?.id).toBeTruthy();
    return row;
  };

  beforeAll(async () => {
    stack = await bootShowcase({ security: showcaseAppDefaultSecurity() });
    adminTok = await stack.signIn();
    aliceTok = await stack.signUp(ALICE);
    bobTok = await stack.signUp(BOB);
    carolTok = await stack.signUp(CAROL);
    ql = await stack.kernel.getServiceAsync('objectql');
    aliceId = await userIdOf(ALICE);

    // CAROL holds the organization administrator's set, granted the way an
    // administrator's grant is stored.
    await ql.insert('sys_user_permission_set', { user_id: await userIdOf(CAROL), permission_set: 'organization_admin' }, { context: SYS });

    // BOB is the predicate persona: a scratch set hides `showcase_project.budget`
    // from him, authored through the metadata door like
    // `showcase-fls-read-mask-strip.dogfood.test.ts`'s.
    const authored = await stack.apiAs(adminTok, 'PUT', `/meta/permission/${SCRATCH_SET}`, {
      name: SCRATCH_SET,
      label: 'Scratch: FLS read deny on showcase_project.budget (personal views)',
      description: 'Test-authored: a field the predicate persona cannot read.',
      objects: {},
      fields: { [`${TARGET}.${DENIED}`]: { readable: false, editable: false } },
    });
    expect(authored.status, 'scratch set authored through the metadata door').toBeLessThan(300);
    expect(await catalogPermissionSet(ql, SCRATCH_SET), 'scratch permission set served').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: await userIdOf(BOB), permission_set: SCRATCH_SET }, { context: SYS });
  }, 180_000);

  afterAll(async () => { await stack?.stop?.(); });

  it('[owner] saves, lists, reads and renames their own view', async () => {
    const row = await save(aliceTok, aliceId, 'Alice: this week');
    expect(String(row.id), 'the id is the record id, never the object.key view syntax').not.toContain('.');

    const list = await stack.apiAs(aliceTok, 'GET', `/data/${OBJ}`);
    expect(list.status).toBe(200);
    expect(rowsOf(await list.json()).map((r: any) => r.label)).toContain('Alice: this week');

    const renamed = await stack.apiAs(aliceTok, 'PATCH', `/data/${OBJ}/${row.id}`, { label: 'Alice: this week, hot' });
    expect(renamed.status, await renamed.clone().text()).toBe(200);
    const read = await stack.apiAs(aliceTok, 'GET', `/data/${OBJ}/${row.id}`);
    expect(read.status).toBe(200);
    expect(recordOf(await read.json()).label).toBe('Alice: this week, hot');
  });

  it('[member] another member reads none by id, lists none, updates none and deletes none', async () => {
    const row = await save(aliceTok, aliceId, 'Alice: private');

    const byId = await stack.apiAs(bobTok, 'GET', `/data/${OBJ}/${row.id}`);
    expect(byId.status).toBe(404);

    const list = await stack.apiAs(bobTok, 'GET', `/data/${OBJ}`);
    expect(list.status).toBe(200);
    expect(rowsOf(await list.json())).toEqual([]);

    const patch = await stack.apiAs(bobTok, 'PATCH', `/data/${OBJ}/${row.id}`, { label: 'hijacked' });
    expect(patch.status).toBe(404);
    expect(errorCodeOf(await patch.json())).toBe('RECORD_NOT_FOUND');

    const del = await stack.apiAs(bobTok, 'DELETE', `/data/${OBJ}/${row.id}`);
    expect(del.status).toBe(403);
    expect(errorCodeOf(await del.json())).toBe('PERMISSION_DENIED');

    const after = await ql.findOne(OBJ, { where: { id: row.id }, context: SYS });
    expect(after?.label, 'the row is untouched').toBe('Alice: private');
  });

  it('[member] cannot plant a view in another member\'s name', async () => {
    const r = await stack.apiAs(bobTok, 'POST', `/data/${OBJ}`, {
      user_id: aliceId, object_name: TARGET, label: 'planted', config: listView(),
    });
    expect(r.status).toBe(403);
    expect(errorCodeOf(await r.json())).toBe('PERMISSION_DENIED');
    expect(await ql.findOne(OBJ, { where: { label: 'planted' }, context: SYS })).toBeFalsy();
  });

  it('[org-admin] an organization administrator reads none of a member\'s views and updates none', async () => {
    const row = await save(aliceTok, aliceId, 'Alice: not for the admin');

    const byId = await stack.apiAs(carolTok, 'GET', `/data/${OBJ}/${row.id}`);
    expect(byId.status).toBe(404);

    const list = await stack.apiAs(carolTok, 'GET', `/data/${OBJ}`);
    expect(list.status).toBe(200);
    expect(rowsOf(await list.json()).map((r: any) => r.id)).not.toContain(row.id);

    const patch = await stack.apiAs(carolTok, 'PATCH', `/data/${OBJ}/${row.id}`, { label: 'admin edit' });
    expect(patch.status).toBe(404);
    expect(errorCodeOf(await patch.json())).toBe('RECORD_NOT_FOUND');
    expect((await ql.findOne(OBJ, { where: { id: row.id }, context: SYS }))?.label).toBe('Alice: not for the admin');
  });

  it('[body] a body that is not a ListView answers 400 VALIDATION_FAILED, paths under config', async () => {
    const r = await stack.apiAs(aliceTok, 'POST', `/data/${OBJ}`, {
      user_id: aliceId, object_name: TARGET, label: 'Broken', config: { type: 'not_a_view_type', columns: 'name' },
    });
    expect(r.status, await r.clone().text()).toBe(400);
    const body: any = await r.json();
    expect(errorCodeOf(body)).toBe('VALIDATION_FAILED');
    const fields: Array<{ field: string }> = body?.error?.details?.fields ?? body?.error?.fields ?? body?.fields ?? [];
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) expect(f.field.startsWith('config')).toBe(true);
    expect(await ql.findOne(OBJ, { where: { label: 'Broken' }, context: SYS })).toBeFalsy();
  });

  it('[body] a body listing another object answers 400 VALIDATION_FAILED on config.data.object', async () => {
    const r = await stack.apiAs(aliceTok, 'POST', `/data/${OBJ}`, {
      user_id: aliceId, object_name: TARGET, label: 'Wrong object',
      config: { ...listView(), data: { provider: 'object', object: 'showcase_task' } },
    });
    expect(r.status, await r.clone().text()).toBe(400);
    const body: any = await r.json();
    expect(errorCodeOf(body)).toBe('VALIDATION_FAILED');
    const fields: Array<{ field: string }> = body?.error?.details?.fields ?? body?.error?.fields ?? body?.fields ?? [];
    expect(fields.map((f) => f.field)).toEqual(['config.data.object']);
  });

  it('[owner] cannot hand their view to another member (user_id re-parent refused)', async () => {
    const row = await save(aliceTok, aliceId, 'Alice: keep mine');
    const r = await stack.apiAs(aliceTok, 'PATCH', `/data/${OBJ}/${row.id}`, { user_id: await userIdOf(BOB) });
    expect(r.status, await r.clone().text()).toBe(403);
    expect((await ql.findOne(OBJ, { where: { id: row.id }, context: SYS }))?.user_id).toBe(aliceId);
  });

  it('[predicate] a view filtering on an unreadable field is saved, and its list query is refused by the predicate guard', async () => {
    const bobId = await userIdOf(BOB);
    const row = await save(bobTok, bobId, 'Bob: big budgets', {
      config: listView({ filter: [{ field: DENIED, operator: 'greater_than', value: 0 }] }),
    });

    // Read the stored view back through its own REST list, and apply its filter.
    const mine = await stack.apiAs(bobTok, 'GET', `/data/${OBJ}`);
    const stored = rowsOf(await mine.json()).find((r: any) => r.id === row.id);
    expect(stored, 'the owner reads the view back').toBeTruthy();
    const config = typeof stored.config === 'string' ? JSON.parse(stored.config) : stored.config;
    const [rule] = config.filter;
    expect(rule.field).toBe(DENIED);

    const filter = encodeURIComponent(JSON.stringify({ [rule.field]: { $gt: rule.value } }));
    const q = await stack.apiAs(bobTok, 'GET', `/data/${TARGET}?$filter=${filter}`);
    expect(q.status, 'the stored filter does not reveal the hidden field').toBe(403);
    const body: any = await q.json();
    expect(errorCodeOf(body)).toBe('PERMISSION_DENIED');
    expect(JSON.stringify(body), 'the refusal names the field').toContain(DENIED);
  });

  it('[meta] the metadata API never serves a personal view as a view item', async () => {
    const row = await save(aliceTok, aliceId, 'pv_meta_probe_label');
    const list = await stack.apiAs(aliceTok, 'GET', '/meta/view');
    expect(list.status).toBe(200);
    const text = await list.text();
    expect(text).not.toContain(String(row.id));
    expect(text).not.toContain('pv_meta_probe_label');

    const byId = await stack.apiAs(aliceTok, 'GET', `/meta/view/${row.id}`);
    expect(byId.status).toBe(404);
  });

  describe('[door] DELETE /personal-views/:id removes the owner\'s own view, and nobody else\'s', () => {
    const door = (id: string) => `/personal-views/${id}`;
    const stillThere = async (id: string) => ql.findOne(OBJ, { where: { id }, context: SYS });

    it('[door] the owner removes their own view: 200 { id, deleted: true }, and the row is gone', async () => {
      const row = await save(aliceTok, aliceId, 'Alice: to remove');
      const r = await stack.apiAs(aliceTok, 'DELETE', door(row.id));
      expect(r.status, await r.clone().text()).toBe(200);
      const body: any = await r.json();
      expect(body?.data ?? body).toEqual({ id: row.id, deleted: true });
      expect(await stillThere(row.id)).toBeFalsy();
    });

    it('[door] another member: 404 RECORD_NOT_FOUND, and the row stays', async () => {
      const row = await save(aliceTok, aliceId, 'Alice: not Bob\'s to remove');
      const r = await stack.apiAs(bobTok, 'DELETE', door(row.id));
      expect(r.status, await r.clone().text()).toBe(404);
      expect(errorCodeOf(await r.json())).toBe('RECORD_NOT_FOUND');
      expect((await stillThere(row.id))?.label).toBe('Alice: not Bob\'s to remove');
    });

    it('[door] an organization administrator: 404 RECORD_NOT_FOUND, and the row stays', async () => {
      const row = await save(aliceTok, aliceId, 'Alice: not the org admin\'s to remove');
      const r = await stack.apiAs(carolTok, 'DELETE', door(row.id));
      expect(r.status, await r.clone().text()).toBe(404);
      expect(errorCodeOf(await r.json())).toBe('RECORD_NOT_FOUND');
      expect((await stillThere(row.id))?.label).toBe('Alice: not the org admin\'s to remove');
    });

    it('[door] a platform administrator, who reads the row, is refused loudly: 403 PERMISSION_DENIED, and the row stays', async () => {
      const row = await save(aliceTok, aliceId, 'Alice: not the platform admin\'s to remove');
      const read = await stack.apiAs(adminTok, 'GET', `/data/${OBJ}/${row.id}`);
      expect(read.status, 'the platform administrator\'s wildcard reads the row (the recorded boundary)').toBe(200);
      const r = await stack.apiAs(adminTok, 'DELETE', door(row.id));
      expect(r.status, await r.clone().text()).toBe(403);
      expect(errorCodeOf(await r.json())).toBe('PERMISSION_DENIED');
      expect((await stillThere(row.id))?.label).toBe('Alice: not the platform admin\'s to remove');
    });

    it('[platform-admin] RECORDED BOUNDARY: the generic data door reads, edits and deletes a member\'s view', async () => {
      const row = await save(aliceTok, aliceId, 'Alice: within the platform admin\'s reach');
      const read = await stack.apiAs(adminTok, 'GET', `/data/${OBJ}/${row.id}`);
      expect(read.status, await read.clone().text()).toBe(200);
      const patch = await stack.apiAs(adminTok, 'PATCH', `/data/${OBJ}/${row.id}`, { label: 'edited by the platform admin' });
      expect(patch.status, await patch.clone().text()).toBe(200);
      expect((await stillThere(row.id))?.label).toBe('edited by the platform admin');
      const del = await stack.apiAs(adminTok, 'DELETE', `/data/${OBJ}/${row.id}`);
      expect(del.status, await del.clone().text()).toBeLessThan(300);
      expect(await stillThere(row.id)).toBeFalsy();
    });

    it('[door] anonymous: 401 UNAUTHENTICATED, and the row stays', async () => {
      const row = await save(aliceTok, aliceId, 'Alice: not anonymous\'s to remove');
      const r = await stack.api(door(row.id), { method: 'DELETE' });
      expect(r.status, await r.clone().text()).toBe(401);
      expect(errorCodeOf(await r.json())).toBe('UNAUTHENTICATED');
      expect(await stillThere(row.id)).toBeTruthy();
    });

    it('[door] the grant model does not move: the generic data DELETE of the owner\'s own row is still 403', async () => {
      const row = await save(aliceTok, aliceId, 'Alice: generic delete');
      const r = await stack.apiAs(aliceTok, 'DELETE', `/data/${OBJ}/${row.id}`);
      expect(r.status, await r.clone().text()).toBe(403);
      expect(errorCodeOf(await r.json())).toBe('PERMISSION_DENIED');
      expect(await stillThere(row.id)).toBeTruthy();
    });
  });
});
