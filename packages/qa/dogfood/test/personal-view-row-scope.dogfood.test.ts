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
 *    through `/data/sys_personal_view`, and a second default clears the first;
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
 *  - `[meta]` the metadata API never serves a personal view as a view item.
 *
 * What it deliberately does not pin: the owner's own delete. No shipped set
 * grants a member delete on any platform object (`member_default` is bound to
 * the `everyone` anchor, ADR-0090 D5); the delete door is a separate decision
 * on #29443. A platform administrator's wildcard keeps reading every row, as it
 * does on `sys_user_preference` (the recorded admin rescue path).
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
    const adminTok = await stack.signIn();
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

  it('[owner] a second default clears the first in the same write', async () => {
    const first = await save(aliceTok, aliceId, 'Alice: default one', { is_default: true });
    const second = await save(aliceTok, aliceId, 'Alice: default two', { is_default: true });
    const rows = await ql.find(OBJ, { where: { id: { $in: [first.id, second.id] } }, context: SYS });
    const on = Object.fromEntries(rows.map((r: any) => [r.label, r.is_default === true || r.is_default === 1]));
    expect(on).toEqual({ 'Alice: default one': false, 'Alice: default two': true });
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
});
