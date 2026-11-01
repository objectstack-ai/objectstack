// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The by-id upsert of `POST /data/:object/batch` chooses its arm by what the
// CALLER can read — measured at the HTTP data door of the stock showcase and of
// a walled (`isolated`) two-organization boot.
//
// ── what is pinned ─────────────────────────────────────────────────────────
//
// On the write doors a row the caller cannot read is a row that does not exist
// (ruling 5985885287 on #21771). So an upsert row naming such a row takes the
// INSERT arm, and answers exactly what a create naming that id answers — the
// collision on the deployment-global primary key the maintainer ratified on
// 2026-11-01 as the accepted cost of a global key. For every persona below,
// atomic and not:
//
//   1. ⭐ an upsert naming a row the caller cannot read answers the SAME body as
//      a batch create naming that id (the row's `id` echo aside), whose code and
//      status are the plain `POST /data/:object` create's `409
//      UNIQUE_VIOLATION`; the stored row is byte-identical afterwards and the
//      answer names no other organization;
//   2. an upsert naming an id that exists nowhere is created, as the create is;
//   3. a row the caller CAN read keeps the update arm: written with the edit
//      grant, the engine's refusal without it.
//
// Personas — stock showcase:
//
//   - member, `showcase_inquiry` (read+create, private OWD, no edit) — a row
//     another user owns;
//   - member, `showcase_private_note` (read+create+edit, private OWD) — another
//     user's note (hidden) and the member's own (written);
//   - member, `showcase_task` (read+create, no edit, public) — a row the member
//     reads: the update arm's refusal, unchanged;
//   - a create-only principal on `showcase_contact` (no read at all) — every
//     row is one it cannot read;
//   - control: member, `showcase_account` (read only) — one refusal for a row
//     that exists and for one that does not, unchanged.
//
// Personas — walled boot, `showcase_category`, two organizations:
//
//   - organization B's editor (read+create+edit) and creator (read+create) on
//     organization A's row: the wall hides it, so each gets the create's
//     answer; the editor writes its own organization's row, the creator gets
//     the update arm's refusal on it.
//
// The fork itself is pinned at the protocol seam in
// `packages/metadata-protocol/src/protocol.upsert-existence.test.ts`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const PASS = 'Upsert-Read-Pass-0001';

interface Answer { status: number; body: any }

let seq = 0;
/** A fresh id no row carries — 16+ characters, the driver's id floor. */
const unknownId = (): string => `qaupsread${(seq++).toString(36)}${Date.now().toString(36)}`.padEnd(18, '0');

/** A batch body with each row's caller-supplied `id` echo dropped and the verb written out, so an upsert and a create compare. */
const comparable = (a: Answer): Answer => ({
  status: a.status,
  body: {
    ...a.body,
    operation: 'VERB',
    results: (a.body?.results ?? []).map((r: any) => {
      const { id: _id, ...rest } = r ?? {};
      return rest;
    }),
  },
});

/** The four doors one persona drives one id through. */
function doors(stack: () => VerifyStack) {
  const call = async (token: string, method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack().apiAs(token, method, path, body);
    let parsed: unknown;
    try { parsed = await res.json(); } catch { parsed = undefined; }
    return { status: res.status, body: parsed };
  };
  const options = (atomic: boolean) => (atomic ? { atomic: true } : { continueOnError: true });
  return {
    call,
    upsert: (token: string, object: string, id: string, data: Record<string, unknown>, atomic: boolean) =>
      call(token, 'POST', `/data/${object}/batch`, { operation: 'upsert', records: [{ id, data }], options: options(atomic) }),
    batchCreate: (token: string, object: string, id: string, data: Record<string, unknown>, atomic: boolean) =>
      call(token, 'POST', `/data/${object}/batch`, { operation: 'create', records: [{ data: { id, ...data } }], options: options(atomic) }),
    create: (token: string, object: string, id: string, data: Record<string, unknown>) =>
      call(token, 'POST', `/data/${object}`, { id, ...data }),
  };
}

/** The id a single create answered, wherever the envelope carries it. */
const createdId = (a: Answer): string => String(a.body?.id ?? a.body?.record?.id ?? a.body?.data?.id ?? '');

describe('upsert by id: a row the caller cannot read answers as a create naming that id (stock showcase)', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  let memberTok: string;
  let creatorTok: string;
  const d = doors(() => stack);
  const rows: Record<string, string> = {};
  let projectId = '';

  const CREATE_ONLY = 'qa_upsert_read_contact_create_only';
  const CREATOR = 'upsert-read-creator@verify.test';
  const MEMBER = 'upsert-read-member@verify.test';

  const stored = async (object: string, id: string) =>
    JSON.stringify(await ql.findOne(object, { where: { id }, context: SYS }));

  const PAYLOAD: Record<string, () => Record<string, unknown>> = {
    showcase_inquiry: () => ({ name: 'Upsert Probe', email: 'upsert-probe@verify.test', message: 'probe' }),
    showcase_private_note: () => ({ title: 'upsert probe' }),
    showcase_task: () => ({ title: 'upsert probe', project: projectId, status: 'todo' }),
    showcase_contact: () => ({ name: 'Upsert Probe', email: 'upsert-probe@verify.test' }),
    showcase_account: () => ({ name: 'Upsert Probe', status: 'prospect' }),
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    adminTok = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    memberTok = await stack.signUp(MEMBER, PASS);

    // A principal who may CREATE contacts and do nothing else with them: no
    // read, no edit. The member baseline grants nothing on the object.
    const saved = await stack.apiAs(adminTok, 'PUT', `/meta/permission/${CREATE_ONLY}`, {
      name: CREATE_ONLY, label: 'QA create-only contacts', systemPermissions: [],
      objects: { showcase_contact: { allowRead: false, allowCreate: true, allowEdit: false, allowDelete: false } },
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    creatorTok = await stack.signUp(CREATOR, PASS);
    const creatorId = (await ql.findOne('sys_user', { where: { email: CREATOR }, context: SYS }))?.id;
    expect(creatorId, 'creator provisioned').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: creatorId, permission_set: CREATE_ONLY }, { context: SYS });

    projectId = String((await ql.find('showcase_project', { limit: 1, context: SYS }))?.[0]?.id ?? '');
    expect(projectId, 'the showcase seed provides a project').toBeTruthy();

    // Rows the admin owns: hidden from the member by the private OWD, and from
    // the creator by having no read at all.
    for (const object of ['showcase_inquiry', 'showcase_private_note', 'showcase_contact']) {
      const made = await d.create(adminTok, object, unknownId(), PAYLOAD[object]());
      expect(made.status, `admin ${object} created — ${JSON.stringify(made.body)}`).toBeLessThan(300);
      rows[`hidden:${object}`] = createdId(made);
    }
    const own = await d.create(memberTok, 'showcase_private_note', unknownId(), { title: 'member note' });
    expect(own.status, `member note created — ${JSON.stringify(own.body)}`).toBeLessThan(300);
    rows.ownNote = createdId(own);
    rows.task = String((await ql.find('showcase_task', { limit: 1, context: SYS }))?.[0]?.id ?? '');
    rows.account = String((await ql.find('showcase_account', { limit: 1, context: SYS }))?.[0]?.id ?? '');
    for (const [k, v] of Object.entries(rows)) expect(v, `fixture row ${k}`).toBeTruthy();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('guard the guard: who can read which row, and which grants each persona holds', async () => {
    for (const object of ['showcase_inquiry', 'showcase_private_note']) {
      expect((await d.call(memberTok, 'GET', `/data/${object}/${rows[`hidden:${object}`]}`)).status, `member cannot read the admin's ${object}`).toBe(404);
      expect((await d.call(adminTok, 'GET', `/data/${object}/${rows[`hidden:${object}`]}`)).status).toBe(200);
    }
    expect((await d.call(memberTok, 'GET', `/data/showcase_private_note/${rows.ownNote}`)).status).toBe(200);
    expect((await d.call(memberTok, 'GET', `/data/showcase_task/${rows.task}`)).status, 'the member reads the task').toBe(200);
    expect((await d.call(memberTok, 'PATCH', `/data/showcase_task/${rows.task}`, { title: 'x' })).status, 'the member may not edit tasks').toBe(403);
    expect((await d.call(memberTok, 'GET', `/data/showcase_account/${rows.account}`)).status, 'the member reads the account').toBe(200);
    expect((await d.create(memberTok, 'showcase_account', unknownId(), PAYLOAD.showcase_account())).status, 'the member may not create accounts').toBe(403);
    expect((await d.call(creatorTok, 'GET', `/data/showcase_contact/${rows['hidden:showcase_contact']}`)).status, 'the creator reads no contact').toBe(403);
    expect((await d.create(creatorTok, 'showcase_contact', unknownId(), PAYLOAD.showcase_contact())).status, 'the creator creates contacts').toBe(201);
  });

  const HIDDEN: Array<[string, string, () => string]> = [
    ['member, read+create without edit, private row', 'showcase_inquiry', () => memberTok],
    ['member, read+create+edit, private row', 'showcase_private_note', () => memberTok],
    ['create-only principal, no read at all', 'showcase_contact', () => creatorTok],
  ];

  for (const [label, object, tok] of HIDDEN) {
    for (const atomic of [false, true]) {
      it(`${label} (${object}, ${atomic ? 'atomic' : 'non-atomic'}): the unreadable row answers as a create naming it`, async () => {
        const id = rows[`hidden:${object}`];
        const before = await stored(object, id);

        const ups = await d.upsert(tok(), object, id, PAYLOAD[object](), atomic);
        const batchCreate = await d.batchCreate(tok(), object, id, PAYLOAD[object](), atomic);
        const create = await d.create(tok(), object, id, PAYLOAD[object]());

        // ⭐ The create's answer, whole: same status, same envelope, same row
        // refusal — nothing of the upsert's own.
        expect(comparable(ups), JSON.stringify(ups.body)).toEqual(comparable(batchCreate));
        expect(create.status, JSON.stringify(create.body)).toBe(409);
        expect(create.body?.code).toBe('UNIQUE_VIOLATION');
        expect(ups.body?.results?.[0]?.errors?.[0]).toMatchObject({ code: create.body.code, httpStatus: create.status });
        expect(ups.body?.results?.[0]?.id).toBe(id);
        // Nothing moved.
        expect(await stored(object, id)).toBe(before);
      });

      it(`${label} (${object}, ${atomic ? 'atomic' : 'non-atomic'}): an id that names no row is created, as the create is`, async () => {
        const id = unknownId();
        const ups = await d.upsert(tok(), object, id, PAYLOAD[object](), atomic);
        expect(ups.status, JSON.stringify(ups.body)).toBe(200);
        expect(ups.body?.success, JSON.stringify(ups.body)).toBe(true);
        expect(ups.body?.results?.[0]).toMatchObject({ id, success: true });
        expect(JSON.parse(await stored(object, id))?.id).toBe(id);

        const other = unknownId();
        const batchCreate = await d.batchCreate(tok(), object, other, PAYLOAD[object](), atomic);
        expect(batchCreate.body?.success, JSON.stringify(batchCreate.body)).toBe(true);
      });
    }
  }

  for (const atomic of [false, true]) {
    it(`member, read+create+edit, own row (${atomic ? 'atomic' : 'non-atomic'}): the readable row is UPDATED`, async () => {
      const title = `renamed ${atomic ? 'atomic' : 'plain'}`;
      const ups = await d.upsert(memberTok, 'showcase_private_note', rows.ownNote, { title }, atomic);
      expect(ups.body?.success, JSON.stringify(ups.body)).toBe(true);
      expect(ups.body?.results?.[0]).toMatchObject({ id: rows.ownNote, success: true });
      expect(JSON.parse(await stored('showcase_private_note', rows.ownNote))?.title).toBe(title);
    });

    it(`member, read+create without edit, readable row (${atomic ? 'atomic' : 'non-atomic'}): the update arm's refusal, unchanged`, async () => {
      const before = await stored('showcase_task', rows.task);
      const ups = await d.upsert(memberTok, 'showcase_task', rows.task, { title: 'should not land' }, atomic);
      expect(ups.body?.success).toBe(false);
      expect(ups.body?.results?.[0]?.errors?.[0], JSON.stringify(ups.body)).toMatchObject({ code: 'PERMISSION_DENIED', httpStatus: 403 });
      expect(await stored('showcase_task', rows.task)).toBe(before);

      const id = unknownId();
      const created = await d.upsert(memberTok, 'showcase_task', id, PAYLOAD.showcase_task(), atomic);
      expect(created.body?.results?.[0], JSON.stringify(created.body)).toMatchObject({ id, success: true });
    });

    it(`control — member refused create and edit (showcase_account, ${atomic ? 'atomic' : 'non-atomic'}): one refusal for a row that exists and one that does not`, async () => {
      const before = await stored('showcase_account', rows.account);
      const miss = unknownId();
      const hit = await d.upsert(memberTok, 'showcase_account', rows.account, PAYLOAD.showcase_account(), atomic);
      const none = await d.upsert(memberTok, 'showcase_account', miss, PAYLOAD.showcase_account(), atomic);
      expect(hit.body?.results?.[0]?.errors?.[0], JSON.stringify(hit.body)).toMatchObject({ code: 'PERMISSION_DENIED', httpStatus: 403 });
      expect(comparable(hit)).toEqual(comparable(none));
      expect(await stored('showcase_account', rows.account)).toBe(before);
      expect(await ql.findOne('showcase_account', { where: { id: miss }, context: SYS })).toBeFalsy();
    });
  }
});

describe('upsert by id: a row behind the organization wall answers as a create naming that id (walled two-organization boot)', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  const tok: Record<string, string> = {};
  const org: Record<string, { id: string; name: string; slug: string }> = {};
  const d = doors(() => stack);
  const rows: Record<string, string> = {};

  const OBJECT = 'showcase_category';
  const RW = 'qa_upsert_read_category_rw';
  const CREATE = 'qa_upsert_read_category_create';

  const stored = async (id: string) => JSON.stringify(await ql.findOne(OBJECT, { where: { id }, context: SYS }));
  const userId = async (email: string) => String((await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id ?? '');

  beforeAll(async () => {
    stack = await bootShowcase({ multiTenant: true });
    adminTok = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');

    for (const [set, grant] of [
      [RW, { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false }],
      [CREATE, { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false }],
    ] as const) {
      const saved = await stack.apiAs(adminTok, 'PUT', `/meta/permission/${set}`, {
        name: set, label: set, systemPermissions: [], objects: { [OBJECT]: grant },
      });
      expect(saved.status, await saved.clone().text()).toBe(200);
    }

    const people: Array<[string, string, string, string]> = [
      // [key, email, organization key, permission set]
      ['aOwner', 'upsert-read-a-owner@verify.test', 'A', RW],
      ['bEditor', 'upsert-read-b-owner@verify.test', 'B', RW],
      ['bCreator', 'upsert-read-b-member@verify.test', 'B', CREATE],
    ];
    for (const [key, email] of people) tok[key] = await stack.signUp(email, PASS);

    for (const [key, owner] of [['A', 'aOwner'], ['B', 'bEditor']] as const) {
      const slug = `upsert-read-${key.toLowerCase()}-org`;
      const name = `Upsert Read Org ${key}`;
      const made = await stack.apiAs(tok[owner], 'POST', '/auth/organization/create', { name, slug });
      expect(made.status, `org ${key}: ${await made.clone().text()}`).toBe(200);
      org[key] = { id: String(((await made.json()) as any).id), name, slug };
    }
    await ql.insert('sys_member', { user_id: await userId('upsert-read-b-member@verify.test'), organization_id: org.B.id, role: 'member' }, { context: SYS });
    for (const [key, email, orgKey, set] of people) {
      const active = await stack.apiAs(tok[key], 'POST', '/auth/organization/set-active', { organizationSlug: org[orgKey].slug });
      expect(active.status, `set-active ${key}: ${await active.clone().text()}`).toBe(200);
      await ql.insert('sys_user_permission_set', { user_id: await userId(email), permission_set: set, organization_id: org[orgKey].id }, { context: SYS });
    }

    const a = await d.create(tok.aOwner, OBJECT, unknownId(), { name: 'org A category' });
    expect(a.status, `org A row — ${JSON.stringify(a.body)}`).toBe(201);
    rows.foreign = createdId(a);
    const b = await d.create(tok.bEditor, OBJECT, unknownId(), { name: 'org B category' });
    expect(b.status, `org B row — ${JSON.stringify(b.body)}`).toBe(201);
    rows.own = createdId(b);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('guard the guard: a real walled posture, two organizations, and the wall hides A`s row from B', async () => {
    const tenancy = await stack.kernel.getServiceAsync<any>('tenancy');
    expect(tenancy.posture).toBe('isolated');
    expect(tenancy.isolationActive).toBe(true);
    expect(tenancy.degraded).toBe(false);
    expect(org.A.id).not.toBe(org.B.id);

    expect(JSON.parse(await stored(rows.foreign))?.organization_id).toBe(org.A.id);
    expect(JSON.parse(await stored(rows.own))?.organization_id).toBe(org.B.id);
    expect((await d.call(tok.aOwner, 'GET', `/data/${OBJECT}/${rows.foreign}`)).status).toBe(200);
    for (const who of ['bEditor', 'bCreator']) {
      expect((await d.call(tok[who], 'GET', `/data/${OBJECT}/${rows.foreign}`)).status, `${who} cannot read A's row`).toBe(404);
      expect((await d.call(tok[who], 'GET', `/data/${OBJECT}/${rows.own}`)).status, `${who} reads B's row`).toBe(200);
    }
    expect((await d.call(tok.bCreator, 'PATCH', `/data/${OBJECT}/${rows.own}`, { name: 'x' })).status, 'the B creator may not edit').toBe(403);
  });

  for (const who of ['bEditor', 'bCreator']) {
    for (const atomic of [false, true]) {
      it(`${who} (${atomic ? 'atomic' : 'non-atomic'}): organization A's row answers as a create naming it, and names no organization`, async () => {
        const before = await stored(rows.foreign);
        const ups = await d.upsert(tok[who], OBJECT, rows.foreign, { name: 'cross-org probe' }, atomic);
        const batchCreate = await d.batchCreate(tok[who], OBJECT, rows.foreign, { name: 'cross-org probe' }, atomic);
        const create = await d.create(tok[who], OBJECT, rows.foreign, { name: 'cross-org probe' });

        expect(comparable(ups), JSON.stringify(ups.body)).toEqual(comparable(batchCreate));
        expect(create.status, JSON.stringify(create.body)).toBe(409);
        expect(create.body?.code).toBe('UNIQUE_VIOLATION');
        expect(ups.body?.results?.[0]?.errors?.[0]).toMatchObject({ code: create.body.code, httpStatus: create.status });
        const text = JSON.stringify(ups.body);
        for (const name of [org.A.id, org.A.name, org.A.slug]) expect(text).not.toContain(name);
        expect(await stored(rows.foreign)).toBe(before);

        const id = unknownId();
        const fresh = await d.upsert(tok[who], OBJECT, id, { name: 'fresh' }, atomic);
        expect(fresh.body?.results?.[0], JSON.stringify(fresh.body)).toMatchObject({ id, success: true });
        expect(JSON.parse(await stored(id))?.organization_id).toBe(org.B.id);
      });
    }
  }

  for (const atomic of [false, true]) {
    it(`B editor, own organization's row (${atomic ? 'atomic' : 'non-atomic'}): UPDATED`, async () => {
      const name = `B renamed ${atomic ? 'atomic' : 'plain'}`;
      const ups = await d.upsert(tok.bEditor, OBJECT, rows.own, { name }, atomic);
      expect(ups.body?.results?.[0], JSON.stringify(ups.body)).toMatchObject({ id: rows.own, success: true });
      expect(JSON.parse(await stored(rows.own))?.name).toBe(name);
    });

    it(`B creator, own organization's row (${atomic ? 'atomic' : 'non-atomic'}): the update arm's refusal`, async () => {
      const before = await stored(rows.own);
      const ups = await d.upsert(tok.bCreator, OBJECT, rows.own, { name: 'should not land' }, atomic);
      expect(ups.body?.results?.[0]?.errors?.[0], JSON.stringify(ups.body)).toMatchObject({ code: 'PERMISSION_DENIED', httpStatus: 403 });
      expect(await stored(rows.own)).toBe(before);
    });
  }
});
