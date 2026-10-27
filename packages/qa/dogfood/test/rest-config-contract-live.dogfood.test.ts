// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26572] The `api`-oracle legs of the three RestServerConfig construction
// contracts, on the default config every deployment runs:
// `api-backend.rest-crud-config-contract`, `api-backend.rest-batch-config-contract`
// and `api-backend.rest-metadata-config-contract`. The 18.2.0 Tier 1 sweep
// (#26468) scored each PARTIAL because no pin fired the default mounts on a
// booted server against the routing-404 control, the live cap was asserted
// only over a mocked protocol, and the masking clause only over a security
// double. Their `test`-oracle legs (a constructed RestServer) are in
// `rest-config-contract-harness.test.ts`.
//
// ## What each case pins
//
//   - crud acceptance[0]: the six default data mounts each answer something
//     other than the routing-404 control body;
//   - crud acceptance[2]'s live half: an `apiEnabled: false` object answers a
//     coded OBJECT_API_DISABLED envelope that is NOT the routing-404 control,
//     so the two absences stay distinguishable on the wire;
//   - batch acceptance[0]: the four per-object bulk doors and the cross-object
//     door answer something other than the control;
//   - batch acceptance[4]: 201 records against the default cap answer 400
//     BATCH_TOO_LARGE with count 201 and max 200, and create nothing;
//   - metadata acceptance[0]: every default-prefix metadata mount answers
//     something other than the control;
//   - discovery advertises the default `/data` and `/meta` bases (the crud and
//     metadata acceptance[3]/[1] defaults);
//   - metadata acceptance[3] / negative[1]: a `client_liaison`-bound member's
//     served `showcase_project` schema carries no budget, spent or
//     budget_remaining at all, while the admin's copy carries all three.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { showcaseAppDefaultSecurity } from './showcase-security.js';
import { secondObjectExposureStack, secondObjectExposureSecurity } from './fixtures/second-object-exposure-fixture.js';

const SYS = { context: { isSystem: true } } as const;
const LIAISON_EMAIL = 'liaison.26572@rest-config.test';
const WITHHELD = ['budget', 'spent', 'budget_remaining'];

interface Answer { status: number; text: string; json: any }

async function answer(stack: VerifyStack, token: string, method: string, path: string, body?: unknown): Promise<Answer> {
  const res = await stack.apiAs(token, method, path, body);
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, text, json };
}

/** The routing-404 body for one method — every absence verdict is scored against it, never a bare status. */
async function routingControl(stack: VerifyStack, token: string, method: string): Promise<Answer> {
  const control = await answer(stack, token, method, '/definitely-not-a-route-26572', method === 'GET' || method === 'DELETE' ? undefined : {});
  expect(control.status).toBe(404);
  return control;
}

function expectMounted(probe: Answer, control: Answer, label: string) {
  expect(probe.text, `${label} answered the routing-404 control — not mounted`).not.toBe(control.text);
  expect(probe.status, `${label}: ${probe.text}`).not.toBe(401);
}

describe('[#26572] the default RestServerConfig on a booted showcase: crud, batch and metadata', () => {
  let stack: VerifyStack;
  let admin: string;
  let liaison: string;
  let taskId: string;
  const call = (token: string, method: string, path: string, body?: unknown) => answer(stack, token, method, path, body);

  beforeAll(async () => {
    stack = await bootShowcase({ security: showcaseAppDefaultSecurity() });
    admin = await stack.signIn();
    liaison = await stack.signUp(LIAISON_EMAIL);
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    const user = await ql.findOne('sys_user', { where: { email: LIAISON_EMAIL }, ...SYS });
    const membership = await ql.findOne('sys_member', { where: { user_id: user.id }, ...SYS });
    await ql.insert('sys_user_position', {
      user_id: user.id, position: 'client_liaison', organization_id: membership?.organization_id,
    }, SYS);
    taskId = (await call(admin, 'GET', '/data/showcase_task?$top=1')).json.records[0].id;
    expect(taskId).toBeTruthy();
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('crud acceptance[0]: all six default data mounts answer, none with the routing-404 control', async () => {
    const probes: Array<[string, string, unknown?]> = [
      ['GET', '/data/showcase_task'],
      ['GET', `/data/showcase_task/${taskId}`],
      ['POST', '/data/showcase_task', {}],
      ['POST', '/data/showcase_task/query', { limit: 1 }],
      ['PATCH', `/data/showcase_task/${taskId}`, {}],
      ['DELETE', '/data/showcase_task/no-such-record-26572'],
    ];
    for (const [method, path, body] of probes) {
      expectMounted(await call(admin, method, path, body), await routingControl(stack, admin, method), `${method} ${path}`);
    }
  });

  it('batch acceptance[0]: the four per-object bulk doors and the cross-object door are mounted', async () => {
    const control = await routingControl(stack, admin, 'POST');
    const probes: Array<[string, unknown]> = [
      ['/data/showcase_private_note/batch', {}],
      ['/data/showcase_private_note/createMany', []],
      ['/data/showcase_private_note/updateMany', { records: [] }],
      ['/data/showcase_private_note/deleteMany', { ids: [] }],
      ['/batch', { operations: [] }],
    ];
    for (const [path, body] of probes) expectMounted(await call(admin, 'POST', path, body), control, `POST ${path}`);
  });

  it('batch acceptance[4]: 201 records against the default cap answer 400 BATCH_TOO_LARGE (max 200) and create nothing', async () => {
    const marker = 'cap-26572-';
    const records = Array.from({ length: 201 }, (_, i) => ({ title: `${marker}${i}` }));
    const res = await call(admin, 'POST', '/data/showcase_private_note/createMany', records);
    expect(res.status, res.text).toBe(400);
    expect(res.json).toMatchObject({ code: 'BATCH_TOO_LARGE', count: 201, max: 200 });

    const filter = encodeURIComponent(JSON.stringify({ title: { $startsWith: marker } }));
    const left = await call(admin, 'GET', `/data/showcase_private_note?$filter=${filter}`);
    expect(left.status, left.text).toBe(200);
    expect(left.json.records).toEqual([]);

    // The count is load-bearing: the same filter finds a row the door did create.
    const one = await call(admin, 'POST', '/data/showcase_private_note/createMany', [{ title: `${marker}control` }]);
    expect(one.status, one.text).toBe(201);
    expect((await call(admin, 'GET', `/data/showcase_private_note?$filter=${filter}`)).json.records).toHaveLength(1);
  });

  it('metadata acceptance[0]: every default-prefix metadata mount answers, none with the routing-404 control', async () => {
    const control = await routingControl(stack, admin, 'GET');
    const book = (await call(admin, 'GET', '/meta/book')).json.items[0].name;
    expect(book).toBeTruthy();
    const paths = [
      '/meta',
      '/meta/types',
      '/meta/diagnostics',
      '/meta/_drafts',
      '/meta/object',
      '/meta/object/showcase_task',
      '/meta/object/showcase_task/references',
      '/meta/object/showcase_task/layers',
      `/meta/book/${book}/tree`,
    ];
    for (const path of paths) {
      const res = await call(admin, 'GET', path);
      expectMounted(res, control, `GET ${path}`);
      expect(res.status, `GET ${path}: ${res.text}`).toBe(200);
    }
  });

  it('discovery advertises the default data and metadata bases', async () => {
    const res = await call(admin, 'GET', '/discovery');
    expect(res.status).toBe(200);
    expect(res.json.routes).toMatchObject({ data: '/api/v1/data', metadata: '/api/v1/meta' });
  });

  it('metadata acceptance[3]: the client_liaison member\'s served schema omits the withheld fields entirely', async () => {
    const fieldsOf = (a: Answer) => (a.json.item ?? a.json).fields as Record<string, unknown>;

    const adminDoc = await call(admin, 'GET', '/meta/object/showcase_project');
    expect(adminDoc.status, adminDoc.text).toBe(200);
    // negative[1]: the admin's own document is the unmasked control, never the verdict.
    for (const f of WITHHELD) expect(Object.keys(fieldsOf(adminDoc))).toContain(f);

    const liaisonDoc = await call(liaison, 'GET', '/meta/object/showcase_project');
    expect(liaisonDoc.status, liaisonDoc.text).toBe(200);
    const served = Object.keys(fieldsOf(liaisonDoc));
    for (const f of WITHHELD) expect(served).not.toContain(f);
    // Absent, not blanked: the name appears nowhere in the served document.
    expect(liaisonDoc.text).not.toMatch(/budget|"spent"/);
    // Every other field is served unchanged in kind.
    expect(served).toEqual(Object.keys(fieldsOf(adminDoc)).filter((f) => !WITHHELD.includes(f)));
  });
});

describe('[#26572] crud acceptance[2]\'s live half: the object-level 404 is not the routing 404', () => {
  let stack: VerifyStack;
  let admin: string;

  beforeAll(async () => {
    stack = await bootStack(secondObjectExposureStack as never, { security: secondObjectExposureSecurity() });
    admin = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('an `apiEnabled: false` object answers OBJECT_API_DISABLED, distinguishable from the routing-404 control', async () => {
    for (const [method, path] of [['GET', '/data/sox_hidden'], ['POST', '/data/sox_hidden'], ['GET', '/data/sox_hidden/x1']] as const) {
      const res = await answer(stack, admin, method, path, method === 'POST' ? {} : undefined);
      const control = await routingControl(stack, admin, method);
      expect(res.status, res.text).toBe(404);
      expect(res.json).toMatchObject({ code: 'OBJECT_API_DISABLED', object: 'sox_hidden' });
      expect(res.text).not.toBe(control.text);
    }
  });
});
