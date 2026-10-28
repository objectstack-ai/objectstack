// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26572] `api-backend.action-activation-door-contract`, pinned at the layer
// its `api` oracle names: `POST /api/v1/actions/_activation/:object/:action`
// on a booted showcase, and on a scratch app that declares one action name on
// two objects. The 18.2.0 Tier 1 sweep (#26468) scored the item PARTIAL: the
// authority-first ordering, the field-level 400 codes, the empty-body 200 body,
// the zero-row ledger read after refusals, the exactly-one-row count and the
// ambiguity arm were asserted only at unit level (action-activation-posture-gate.test.ts,
// a dispatcher over fakes) or not at all.
//
// ## What each case pins
//
//   - acceptance[0] / negative[1]: a member without `manage_metadata` sending a
//     mis-bodied request for an undeclared action gets the 403 with the
//     capability sentence and no clone recommendation, never the body's 400 or
//     the lookup's 404; the anonymous twin gets the 401 floor;
//   - acceptance[1]: the 2-segment path is this door's shape 400, the
//     4-segment path is the router's 404, byte-identical to an unmounted path;
//   - acceptance[2] / negative[0]: `{enable:false}`, `{enabled:"false"}` and a
//     non-object body each answer 400 VALIDATION_FAILED with the named
//     `fields[0]`, and the one-letter-off probe does not answer 200;
//   - acceptance[4] / negative[2]: an undeclared action is 404 "nothing to
//     switch off", and no refused probe of any arm leaves a ledger row;
//   - acceptance[3]: an empty body answers 200 with `enabled: true`;
//   - acceptance[5]: the flip answers `{name, objectName, enabled}`, writes
//     exactly one row with no tenant column, and flipping back updates that row;
//   - acceptance[6] (scratch app): a name declared on two objects answers 409
//     RESOURCE_CONFLICT naming both owners, from either object, writes nothing,
//     and leaves the action armed.
//
// acceptance[4]'s metadata-plane 503 arm and acceptance[7]'s 501/503 arms stay
// where the item records them (no stock door).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { activationAmbiguityStack, SHARED_ACTION, OWNERS } from './fixtures/activation-ambiguity-fixture.js';

const LEDGER = 'sys_metadata_activation';
const SYS = { isSystem: true, positions: [], permissions: [] };
const DOOR = '/actions/_activation/showcase_task/showcase_mark_done';
const UNDECLARED = '/actions/_activation/showcase_task/no_such_action';

interface Answer { status: number; text: string; json: any }

async function answer(stack: VerifyStack, token: string | null, method: string, path: string, body?: unknown): Promise<Answer> {
  const res = token
    ? await stack.apiAs(token, method, path, body)
    : await stack.api(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, text, json };
}

async function ledgerRows(stack: VerifyStack): Promise<Array<Record<string, unknown>>> {
  const ql: any = await stack.kernel.getServiceAsync('objectql');
  return ql.find(LEDGER, { where: {}, context: SYS });
}

describe('[#26572] the action activation door\'s ordered arms, on a booted showcase', () => {
  let stack: VerifyStack;
  let admin: string;
  let member: string;
  const call = (token: string | null, method: string, path: string, body?: unknown) => answer(stack, token, method, path, body);

  beforeAll(async () => {
    stack = await bootShowcase();
    admin = await stack.signIn();
    member = await stack.signUp('member.26572@activation-door.test');
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[0]: authority runs first — the member gets the capability 403, the anonymous caller the 401', async () => {
    const refused = await call(member, 'POST', UNDECLARED, { enable: false });
    expect(refused.status, refused.text).toBe(403);
    expect(refused.json.error.code).toBe('PERMISSION_DENIED');
    expect(refused.json.error.message).toContain('`manage_metadata`');
    expect(refused.json.error.message).toContain('switching a shipped artifact off is functionally equivalent to deleting it');
    expect(refused.json.error.message).not.toMatch(/clone/i);
    // Neither the body contract nor the action namespace leaked.
    expect(refused.text).not.toContain('enabled');
    expect(refused.text).not.toContain('no_such_action');

    const anonymous = await call(null, 'POST', UNDECLARED, { enable: false });
    expect(anonymous.status, anonymous.text).toBe(401);
    expect(anonymous.json.error.code).toBe('UNAUTHENTICATED');
  });

  it('acceptance[1]: the 2-segment path is the door\'s shape 400; the 4-segment path is the router\'s 404', async () => {
    const two = await call(admin, 'POST', '/actions/_activation/showcase_mark_done', {});
    expect(two.status, two.text).toBe(400);
    expect(two.json.error.message).toBe(
      'Path must be /actions/_activation/:object/:action (use `global` for an object-less action)',
    );

    const four = await call(admin, 'POST', `${DOOR}/extra`, {});
    const control = await call(admin, 'POST', '/definitely-not-a-route-26572', {});
    expect(control.status).toBe(404);
    expect(four.status).toBe(404);
    expect(four.text).toBe(control.text);
  });

  it('acceptance[2]: the body contract refuses with named field codes, never inverts', async () => {
    const typo = await call(admin, 'POST', DOOR, { enable: false });
    expect(typo.status, typo.text).not.toBe(200);
    expect(typo.status).toBe(400);
    expect(typo.json.error.code).toBe('VALIDATION_FAILED');
    expect(typo.json.error.details.fields[0]).toMatchObject({ field: 'enable', code: 'unknown_field' });
    expect(typo.json.error.details.fields[0].message).toContain('`enabled`');

    const stringly = await call(admin, 'POST', DOOR, { enabled: 'false' });
    expect(stringly.status, stringly.text).toBe(400);
    expect(stringly.json.error.code).toBe('VALIDATION_FAILED');
    expect(stringly.json.error.details.fields[0]).toMatchObject({ field: 'enabled', code: 'invalid_type' });

    const array = await call(admin, 'POST', DOOR, []);
    expect(array.status, array.text).toBe(400);
    expect(array.json.error.code).toBe('VALIDATION_FAILED');
    expect(array.json.error.details.fields[0]).toMatchObject({ field: '(body)', code: 'invalid_type' });
  });

  it('acceptance[4]: an undeclared action is 404 "nothing to switch off", and no refusal so far wrote a row', async () => {
    const res = await call(admin, 'POST', UNDECLARED, { enabled: false });
    expect(res.status, res.text).toBe(404);
    expect(res.json.error.message).toContain('has no declaration — there is nothing to switch off');

    expect(await ledgerRows(stack)).toEqual([]);
  });

  it('acceptance[3]: an empty body ENABLES — 200 with enabled true', async () => {
    const res = await call(admin, 'POST', DOOR, {});
    expect(res.status, res.text).toBe(200);
    expect(res.json.data).toEqual({ name: 'showcase_mark_done', objectName: 'showcase_task', enabled: true });
  });

  it('acceptance[5]: the flip answers its body and keeps exactly ONE deployment-level row, updated in place', async () => {
    const off = await call(admin, 'POST', DOOR, { enabled: false });
    expect(off.status, off.text).toBe(200);
    expect(off.json.data).toEqual({ name: 'showcase_mark_done', objectName: 'showcase_task', enabled: false });

    const offRows = (await ledgerRows(stack)).filter((r) => r.name === 'showcase_mark_done');
    expect(offRows).toHaveLength(1);
    expect(offRows[0].metadata_type).toBe('action');
    expect(offRows[0].active === false || offRows[0].active === 0).toBe(true);
    // A key-set reading off the driver's own SELECT: the table has no tenant column.
    expect(Object.keys(offRows[0])).not.toContain('organization_id');
    expect(Object.keys(offRows[0])).toEqual(expect.arrayContaining(['id', 'metadata_type', 'name', 'active']));

    const on = await call(admin, 'POST', DOOR, { enabled: true });
    expect(on.status, on.text).toBe(200);
    expect(on.json.data).toEqual({ name: 'showcase_mark_done', objectName: 'showcase_task', enabled: true });

    const onRows = (await ledgerRows(stack)).filter((r) => r.name === 'showcase_mark_done');
    expect(onRows).toHaveLength(1);
    expect(onRows[0].id).toBe(offRows[0].id);
    expect(onRows[0].active === true || onRows[0].active === 1).toBe(true);
  });
});

describe('[#26572] the ambiguity arm, on a scratch app declaring one action name on two objects', () => {
  let stack: VerifyStack;
  let admin: string;

  beforeAll(async () => {
    stack = await bootStack(activationAmbiguityStack as never, {});
    admin = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[6]: 409 RESOURCE_CONFLICT naming every owner, from either object, and nothing written', async () => {
    for (const object of OWNERS) {
      const res = await answer(stack, admin, 'POST', `/actions/_activation/${object}/${SHARED_ACTION}`, { enabled: false });
      expect(res.status, res.text).toBe(409);
      expect(res.json.error.code).toBe('RESOURCE_CONFLICT');
      for (const named of OWNERS) expect(res.json.error.message).toContain(`'${named}'`);
    }
    expect(await ledgerRows(stack)).toEqual([]);

    // The refusal switched nothing off: the action still dispatches.
    const created = await answer(stack, admin, 'POST', `/data/${OWNERS[0]}`, { name: 'still armed' });
    expect(created.status, created.text).toBeLessThan(300);
    const id = created.json.id ?? created.json.record?.id;
    const run = await answer(stack, admin, 'POST', `/actions/${OWNERS[0]}/${SHARED_ACTION}`, { recordId: id });
    expect(run.status, run.text).toBe(200);
  });
});
