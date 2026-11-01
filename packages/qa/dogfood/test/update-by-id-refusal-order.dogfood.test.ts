// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// An update by id answers the same refusal whether or not the id exists, as
// delete does — measured at the HTTP data door of the stock showcase.
//
// ── what is pinned ─────────────────────────────────────────────────────────
//
// For a plain member (the everyone baseline only) on three object families
// the member may not edit — a business junction object
// (`showcase_project_membership`), a platform grant object
// (`sys_user_permission_set`) and the two read-only federated objects
// (`showcase_ext_customer`, `showcase_ext_order`):
//
//   1. ⭐ `PATCH /data/:object/:id` on an id that names a row and on an id that
//      names none answer the SAME status and the same body;
//   2. the bulk update doors (`updateMany`, `batch` with `operation: update`)
//      answer the same per-row error for both ids;
//   3. `DELETE` keeps the one answer it already gave for both.
//
// Controls, so a green run is not "everything refuses":
//
//   - a member holding the object's edit grant updates an in-scope row (200)
//     and still answers `404 RECORD_NOT_FOUND` for an id that names no row;
//   - a member holding edit with a row-level restriction (`showcase_private_note`,
//     private) gets one not-found answer for a row out of its scope and for an
//     id that names no row — the row-scope answer, unchanged;
//   - the administrator updates (200) and gets `404` for an id that names no
//     row on an ordinary object;
//   - a refused write leaves the row untouched.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { onEnable } from '@objectstack/example-showcase';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { showcaseAppDefaultSecurity } from './showcase-security.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

const SYS = { isSystem: true } as const;
const MISSING = 'zz_no_such_row_0001';

interface Answer { status: number; body: unknown }

describe('update by id: one refusal whether or not the id exists, as delete', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  let memberTok: string;
  let editorTok: string;
  const existing = new Map<string, string>();
  let foreignNoteId = '';
  let ownNoteId = '';

  const call = async (token: string, method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    let parsed: unknown;
    try { parsed = await res.json(); } catch { parsed = undefined; }
    return { status: res.status, body: parsed };
  };
  /** The answer with the caller-supplied id written out, so two ids compare. */
  const withoutId = (a: Answer, id: string): Answer =>
    JSON.parse(JSON.stringify(a).split(id).join('ID')) as Answer;

  beforeAll(async () => {
    // The federated objects' remote tables (the showcase's own fixture
    // provisioner, as `showcase-external-autoconnect` runs it).
    await onEnable({ logger: { info() {}, warn() {} } } as never);
    stack = await bootShowcase({ security: showcaseAppDefaultSecurity() });
    adminTok = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');

    memberTok = await stack.signUp('upd-order-member@verify.test');
    editorTok = await stack.signUp('upd-order-editor@verify.test');
    const ops = await catalogPermissionSet(ql, 'showcase_ops');
    expect(ops, 'showcase_ops served by the security catalog').toBeTruthy();
    const editorId = (await ql.findOne('sys_user', { where: { email: 'upd-order-editor@verify.test' }, context: SYS }))?.id;
    expect(editorId, 'editor provisioned').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: editorId, permission_set: ops.name }, { context: SYS });

    const first = async (object: string) =>
      String((await ql.find(object, { limit: 1, context: SYS }))?.[0]?.id ?? '');
    for (const object of ['showcase_project_membership', 'sys_user_permission_set', 'showcase_ext_customer', 'showcase_ext_order']) {
      const id = await first(object);
      expect(id, `a seeded ${object} row`).toBeTruthy();
      existing.set(object, id);
    }

    const foreign = await call(adminTok, 'POST', '/data/showcase_private_note', { title: 'admin note' });
    expect(foreign.status, `admin note created — ${JSON.stringify(foreign.body)}`).toBeLessThan(300);
    foreignNoteId = String((foreign.body as any)?.id ?? (foreign.body as any)?.record?.id ?? (foreign.body as any)?.data?.id);
    const own = await call(memberTok, 'POST', '/data/showcase_private_note', { title: 'member note' });
    expect(own.status, `member note created — ${JSON.stringify(own.body)}`).toBeLessThan(300);
    ownNoteId = String((own.body as any)?.id ?? (own.body as any)?.record?.id ?? (own.body as any)?.data?.id);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  const PATCHES: Record<string, Record<string, unknown>> = {
    showcase_project_membership: { engagement: 'reviewer' },
    sys_user_permission_set: { reason: 'x' },
    showcase_ext_customer: { region: 'EU' },
    showcase_ext_order: { status: 'void' },
  };

  for (const [object, patch] of Object.entries(PATCHES)) {
    it(`${object}: PATCH by id answers one refusal for a row and for no row`, async () => {
      const id = existing.get(object)!;
      const before = await ql.findOne(object, { where: { id }, context: SYS });
      const hit = await call(memberTok, 'PATCH', `/data/${object}/${id}`, patch);
      const miss = await call(memberTok, 'PATCH', `/data/${object}/${MISSING}`, patch);
      console.log(`[measure] ${object} PATCH existing=${JSON.stringify(hit)} missing=${JSON.stringify(miss)}`);
      expect(hit.status, 'refused').toBeGreaterThanOrEqual(400);
      expect(withoutId(miss, MISSING)).toEqual(withoutId(hit, id));
      const after = await ql.findOne(object, { where: { id }, context: SYS });
      expect(after).toEqual(before);
    });

    it(`${object}: DELETE by id keeps its one refusal for a row and for no row`, async () => {
      const id = existing.get(object)!;
      const hit = await call(memberTok, 'DELETE', `/data/${object}/${id}`);
      const miss = await call(memberTok, 'DELETE', `/data/${object}/${MISSING}`);
      console.log(`[measure] ${object} DELETE existing=${JSON.stringify(hit)} missing=${JSON.stringify(miss)}`);
      expect(hit.status, 'refused').toBeGreaterThanOrEqual(400);
      expect(withoutId(miss, MISSING)).toEqual(withoutId(hit, id));
      expect(await ql.findOne(object, { where: { id }, context: SYS })).toBeTruthy();
    });

    it(`${object}: the bulk update doors answer one per-row refusal for a row and for no row`, async () => {
      const id = existing.get(object)!;
      const many = async (rid: string) => call(memberTok, 'POST', `/data/${object}/updateMany`, { records: [{ id: rid, data: patch }] });
      const batch = async (rid: string) => call(memberTok, 'POST', `/data/${object}/batch`, { operation: 'update', records: [{ id: rid, data: patch }] });
      const manyHit = await many(id);
      const manyMiss = await many(MISSING);
      const batchHit = await batch(id);
      const batchMiss = await batch(MISSING);
      console.log(`[measure] ${object} updateMany existing=${JSON.stringify(manyHit)} missing=${JSON.stringify(manyMiss)}`);
      console.log(`[measure] ${object} batch existing=${JSON.stringify(batchHit)} missing=${JSON.stringify(batchMiss)}`);
      expect(withoutId(manyMiss, MISSING)).toEqual(withoutId(manyHit, id));
      expect(withoutId(batchMiss, MISSING)).toEqual(withoutId(batchHit, id));
    });
  }

  it('control: a caller holding the edit grant updates an in-scope row and gets 404 for no row', async () => {
    const id = existing.get('showcase_project_membership')!;
    const ok = await call(editorTok, 'PATCH', `/data/showcase_project_membership/${id}`, { engagement: 'reviewer' });
    const miss = await call(editorTok, 'PATCH', `/data/showcase_project_membership/${MISSING}`, { engagement: 'reviewer' });
    console.log(`[measure] editor membership ok=${JSON.stringify(ok.status)} missing=${JSON.stringify(miss)}`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(miss.status).toBe(404);
    expect((miss.body as any)?.code ?? (miss.body as any)?.error?.code).toBe('RECORD_NOT_FOUND');
  });

  it('control: edit with a row-level restriction keeps one not-found for a foreign row and for no row', async () => {
    const hit = await call(memberTok, 'PATCH', `/data/showcase_private_note/${foreignNoteId}`, { title: 'x' });
    const miss = await call(memberTok, 'PATCH', `/data/showcase_private_note/${MISSING}`, { title: 'x' });
    const own = await call(memberTok, 'PATCH', `/data/showcase_private_note/${ownNoteId}`, { title: 'mine, renamed' });
    console.log(`[measure] private_note foreign=${JSON.stringify(hit)} missing=${JSON.stringify(miss)} own=${own.status}`);
    expect(hit.status).toBe(404);
    expect(withoutId(miss, MISSING)).toEqual(withoutId(hit, foreignNoteId));
    expect(own.status, JSON.stringify(own.body)).toBe(200);
  });

  it('control: the administrator updates and gets 404 for no row on an ordinary object', async () => {
    const id = existing.get('showcase_project_membership')!;
    const ok = await call(adminTok, 'PATCH', `/data/showcase_project_membership/${id}`, { engagement: 'lead' });
    const miss = await call(adminTok, 'PATCH', `/data/showcase_project_membership/${MISSING}`, { engagement: 'lead' });
    const extHit = await call(adminTok, 'PATCH', `/data/showcase_ext_customer/c1`, { region: 'EU' });
    const extMiss = await call(adminTok, 'PATCH', `/data/showcase_ext_customer/${MISSING}`, { region: 'EU' });
    const extDelMiss = await call(adminTok, 'DELETE', `/data/showcase_ext_customer/${MISSING}`);
    console.log(`[measure] admin ok=${ok.status} missing=${JSON.stringify(miss)} extHit=${JSON.stringify(extHit)} extMiss=${JSON.stringify(extMiss)} extDelMiss=${JSON.stringify(extDelMiss)}`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(miss.status).toBe(404);
  });
});
