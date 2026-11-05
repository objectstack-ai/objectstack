// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26571] `access-security.grant-table-write-contract`, acceptance[1] and
// acceptance[3], through the REST data door on the stock showcase.
//
// The plugin-security engine pins (`grant-permission-set-name.test.ts`,
// `granted-by-writer-provenance.test.ts`) prove the contract on a real engine
// and read the thrown error through `resolveThrownHttpError`. The item's
// clauses are scored at the `api` oracle, so this file writes the grant table
// the way an administrator does — `POST /data/sys_user_permission_set` — and
// reads the answer the wire carries:
//
//   - acceptance[1]: a grant naming the retired `permission_set_id` column is
//     400 INVALID_FIELD; a second identical grant is 409 UNIQUE_VIOLATION;
//   - acceptance[3]: a grant naming someone else as `granted_by` stores the
//     caller.
//
// acceptance[2] (the inverted window) is pinned beside the window semantics in
// `permission-set-assignment-window.dogfood.test.ts`. acceptance[4] is the
// walled-boot leg (knownGaps).
//
// [ADR-0090 D10] The second top-level block: a grant is a person's, and an
// agent ceiling set is not a person's set, so every write door of the grant
// table refuses an assignment naming one, for an administrator too — the
// engine pins are `agent-ceiling-grant-refusal.test.ts` in plugin-security.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MCP_AGENT_PERMISSION_SETS, MCP_AGENT_PERMISSION_SET_READ } from '@objectstack/spec/ai';
import { bootShowcase } from './showcase-boot.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

const SYS = { isSystem: true } as const;
const GRANTS = '/data/sys_user_permission_set';
const SET = 'showcase_auditor';

const codeOf = (body: any) => body?.code ?? body?.error?.code;
const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id;

describe('the grant table\'s write contract over the REST data door', () => {
  let stack: VerifyStack;
  let ql: any;
  let admin: string;
  let adminId: string;
  const uid: Record<string, string> = {};

  const userIdOf = async (email: string) => String((await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id ?? '');

  beforeAll(async () => {
    stack = await bootShowcase();
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    const session = (await (await stack.apiAs(admin, 'GET', '/auth/get-session')).json()) as any;
    adminId = String(session?.user?.id ?? '');
    expect(adminId, 'the admin has an id').toBeTruthy();
    expect(await catalogPermissionSet(ql, SET), `${SET} is served by the catalog`).toBeTruthy();
    for (const who of ['dup', 'retired', 'provenance', 'granter']) {
      const email = `grant-contract-${who}@verify.test`;
      await stack.signUp(email);
      uid[who] = await userIdOf(email);
      expect(uid[who], `${who} signed up`).toBeTruthy();
    }
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[1]: a grant naming the retired permission_set_id column is 400 INVALID_FIELD, and nothing is stored', async () => {
    const res = await stack.apiAs(admin, 'POST', GRANTS, { user_id: uid.retired, permission_set_id: SET });
    const body = await res.json();
    expect([res.status, codeOf(body)], JSON.stringify(body)).toEqual([400, 'INVALID_FIELD']);
    expect(JSON.stringify(body), 'the refusal names the column').toContain('permission_set_id');
    expect(await ql.find('sys_user_permission_set', { where: { user_id: uid.retired }, context: SYS })).toEqual([]);
  });

  it('acceptance[1]: a second identical grant is 409 UNIQUE_VIOLATION, and one row stands', async () => {
    const first = await stack.apiAs(admin, 'POST', GRANTS, { user_id: uid.dup, permission_set: SET });
    expect(first.status, await first.clone().text()).toBe(201);
    const second = await stack.apiAs(admin, 'POST', GRANTS, { user_id: uid.dup, permission_set: SET });
    const body = await second.json();
    expect([second.status, codeOf(body)], JSON.stringify(body)).toEqual([409, 'UNIQUE_VIOLATION']);
    expect(await ql.find('sys_user_permission_set', { where: { user_id: uid.dup }, context: SYS })).toHaveLength(1);
  });

  it('acceptance[3]: a grant naming ANOTHER user as granted_by stores the caller', async () => {
    const res = await stack.apiAs(admin, 'POST', GRANTS, {
      user_id: uid.provenance, permission_set: SET, granted_by: uid.granter,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const id = idOf(await res.json());
    expect(id, 'the created grant id').toBeTruthy();

    const read = await stack.apiAs(admin, 'GET', `${GRANTS}/${id}`);
    expect(read.status).toBe(200);
    const row = (await read.json()) as any;
    expect((row?.record ?? row?.data ?? row)?.granted_by, 'the wire read-back names the writer').toBe(adminId);
    const stored = await ql.findOne('sys_user_permission_set', { where: { id }, context: SYS });
    expect(stored?.granted_by, 'and so does the stored row').toBe(adminId);
  });
});

describe('a grant naming an agent ceiling set is refused at every write door of the grant table', () => {
  let stack: VerifyStack;
  let ql: any;
  let admin: string;
  let personId: string;
  let grantId: string;

  /** The field errors the wire carries, wherever the door nests them. */
  const fieldsOf = (body: any): any[] =>
    body?.error?.details?.fields ?? body?.details?.fields ?? body?.fields ?? [];
  /** A refused grant write's identifying answer: 400 VALIDATION_FAILED, `invalid_value` at `permission_set`. */
  const expectRefused = async (res: Response, setName: string, label: string) => {
    const body = await res.json();
    expect([res.status, codeOf(body)], `${label}: ${JSON.stringify(body)}`).toEqual([400, 'VALIDATION_FAILED']);
    expect(fieldsOf(body)[0], `${label}: ${JSON.stringify(body)}`).toMatchObject({
      field: 'permission_set', code: 'invalid_value', value: setName,
    });
  };
  const ceilingGrantsOf = async (userId: string) =>
    ((await ql.find('sys_user_permission_set', { where: { user_id: userId }, context: SYS })) as any[])
      .filter((g) => (MCP_AGENT_PERMISSION_SETS as readonly string[]).includes(String(g?.permission_set)));

  beforeAll(async () => {
    stack = await bootShowcase();
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    // The stock catalog serves every agent ceiling set, so the refusal below is
    // this rule's and never the catalog's `reference_not_found`.
    for (const name of MCP_AGENT_PERMISSION_SETS) {
      expect(await catalogPermissionSet(ql, name), `${name} is served by the catalog`).toBeTruthy();
    }
    const email = 'grant-contract-agent-ceiling@verify.test';
    await stack.signUp(email);
    personId = String((await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id ?? '');
    expect(personId, 'the person signed up').toBeTruthy();
    // A person grant to rename on the update doors.
    const res = await stack.apiAs(admin, 'POST', GRANTS, { user_id: personId, permission_set: SET });
    expect(res.status, await res.clone().text()).toBe(201);
    grantId = String(idOf(await res.json()) ?? '');
    expect(grantId, 'the person grant id').toBeTruthy();
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('POST /data/sys_user_permission_set refuses each agent ceiling set from an administrator, and stores none', async () => {
    for (const name of MCP_AGENT_PERMISSION_SETS) {
      await expectRefused(await stack.apiAs(admin, 'POST', GRANTS, { user_id: personId, permission_set: name }), name, name);
    }
    expect(await ceilingGrantsOf(personId)).toEqual([]);
  });

  it('PATCH /data/sys_user_permission_set/:id refuses renaming a grant to an agent ceiling set, and the grant keeps its set', async () => {
    await expectRefused(
      await stack.apiAs(admin, 'PATCH', `${GRANTS}/${grantId}`, { permission_set: MCP_AGENT_PERMISSION_SET_READ }),
      MCP_AGENT_PERMISSION_SET_READ, 'PATCH',
    );
    const stored = await ql.findOne('sys_user_permission_set', { where: { id: grantId }, context: SYS });
    expect(stored?.permission_set).toBe(SET);
  });

  it('the many-row and batch doors refuse a row naming an agent ceiling set, and store none', async () => {
    const row = { user_id: personId, permission_set: MCP_AGENT_PERMISSION_SET_READ };
    const doors: Array<[string, () => Promise<Response>]> = [
      ['POST /data/OBJECT/createMany', () => stack.apiAs(admin, 'POST', `${GRANTS}/createMany`, [row])],
      ['POST /data/OBJECT/updateMany', () => stack.apiAs(admin, 'POST', `${GRANTS}/updateMany`, {
        records: [{ id: grantId, data: { permission_set: MCP_AGENT_PERMISSION_SET_READ } }],
      })],
      ['POST /data/OBJECT/batch', () => stack.apiAs(admin, 'POST', `${GRANTS}/batch`, {
        operation: 'create', records: [{ data: row }],
      })],
      ['POST /batch', () => stack.apiAs(admin, 'POST', '/batch', {
        operations: [{ action: 'create', object: 'sys_user_permission_set', data: row }],
      })],
    ];
    for (const [door, call] of doors) {
      const res = await call();
      const body = await res.json();
      // Each door answers in its own report shape; what they share is the
      // refusal's codes on the failing row, and nothing stored.
      const text = JSON.stringify(body);
      expect(res.status, `${door}: ${text}`).toBeGreaterThanOrEqual(400);
      expect(text, `${door} carries the rule's field code`).toContain('"invalid_value"');
      expect(text, `${door} names the column`).toContain('permission_set');
    }
    expect(await ceilingGrantsOf(personId)).toEqual([]);
    const stored = await ql.findOne('sys_user_permission_set', { where: { id: grantId }, context: SYS });
    expect(stored?.permission_set).toBe(SET);
  });

  it('both import doors fail a row naming an agent ceiling set at permission_set, and store none', async () => {
    type Row = { ok: boolean; action: string; code?: string; field?: string };
    const rows = [{ user_id: personId, permission_set: MCP_AGENT_PERMISSION_SET_READ }];
    const sync = await stack.apiAs(admin, 'POST', `${GRANTS}/import`, { format: 'json', rows });
    expect(sync.status, await sync.clone().text()).toBe(200);
    const [syncRow] = ((await sync.json()) as { results: Row[] }).results;
    expect(syncRow, JSON.stringify(syncRow)).toMatchObject({ ok: false, action: 'failed', code: 'invalid_value', field: 'permission_set' });

    const job = await stack.apiAs(admin, 'POST', `${GRANTS}/import/jobs`, { format: 'json', rows });
    expect(job.status, await job.clone().text()).toBe(201);
    const { jobId } = (await job.json()) as { jobId: string };
    let jobRows: Row[] | undefined;
    for (let i = 0; i < 400 && !jobRows; i++) {
      const body: any = await (await stack.apiAs(admin, 'GET', `/data/import/jobs/${jobId}/results`)).json();
      if (body.status === 'succeeded' || body.status === 'failed') jobRows = body.results;
      else await new Promise((r) => setTimeout(r, 25));
    }
    expect(jobRows?.[0], JSON.stringify(jobRows)).toMatchObject({ ok: false, action: 'failed', code: 'invalid_value', field: 'permission_set' });
    expect(await ceilingGrantsOf(personId)).toEqual([]);
  });
});
