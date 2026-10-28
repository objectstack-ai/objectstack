// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26572] `api-backend.packaged-action-disabled-dispatch`, pinned at the layer
// its `api` oracle names: the real HTTP stack of a booted showcase, the live
// MCP transport (`POST /api/v1/mcp`), and a cold boot on the same database
// file. The 18.2.0 Tier 1 sweep (#26468) scored the item PARTIAL because the
// exact code, the engine's sentence, the 403 leg, the flow-type leg and the
// MCP envelope were asserted only in the unit `action-activation-dispatch.test.ts`
// (an HttpDispatcher over fakes), and the param-ordering pair, the restart leg
// and the anonymous floor were asserted nowhere.
//
// ## What each case pins
//
//   - absence means active: on a stock boot with no ledger row the param
//     gallery's garbage bag answers its param contract's 400 (negative[1]);
//   - acceptance[0]: a disabled `showcase_mark_done` answers 409
//     ACTION_DISABLED with the engine's sentence naming the ledger, for a
//     bogus id and for a real task, and the real task is not written;
//   - acceptance[1] / negative[0]: the disabled gallery answers 409 to the bag
//     its enabled twin answers 400 to, so the consult precedes the param
//     contract;
//   - acceptance[2]: every 409 above was answered with a nonexistent recordId
//     in play; the enabled control on the same id answers 404 RECORD_NOT_FOUND
//     (recorded beside it, corroboration only);
//   - acceptance[3] / negative[1]: the unentitled caller's 403 bodies, enabled
//     and disabled, are byte-identical;
//   - acceptance[4]: the MCP `run_action` tool refuses the disabled
//     `showcase_portfolio_snapshot` with ACTION_DISABLED / 409 and the same
//     sentence the REST door answers, and runs again once re-enabled;
//   - acceptance[6]: a disabled `type: 'flow'` action is refused by its own
//     switch;
//   - negative[2]: an anonymous caller answers the 401 floor, not the 409;
//   - acceptance[5]: after a cold boot on the same file the action is still
//     refused, the row is still there, and re-enabling updates that one row and
//     re-arms dispatch.
//
// The file owns its boot (and its database file): it writes ledger rows, so it
// may not share a showcase with any other file.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type VerifyStack } from '@objectstack/verify';
import { MCPServerPlugin } from '@objectstack/mcp';
import { bootShowcase } from './showcase-boot.js';

const LEDGER = 'sys_metadata_activation';
const SYS = { isSystem: true, positions: [], permissions: [] };
const BOGUS_ID = 'no-such-record-26572';

const activation = (object: string, action: string) => `/actions/_activation/${object}/${action}`;

/** The engine's `describeDisabledAction` sentence, as the wire carries it. */
function expectDisabledSentence(message: unknown, action: string) {
  expect(String(message)).toMatch(new RegExp(`^Action '${action}' is disabled — `));
  expect(String(message)).toContain('(sys_metadata_activation, ADR-0126 §8)');
}

interface Answer { status: number; text: string; json: any }

describe('[#26572] a disabled packaged action is refused at both doors, over HTTP and MCP, across a cold boot', () => {
  let stack: VerifyStack;
  let admin: string;
  let dir: string;
  let dbFile: string;
  let taskId: string;
  let markDoneRowId: unknown;

  const boot = (file: string) => bootShowcase({ databaseFile: file, extraPlugins: [new MCPServerPlugin()] });

  const call = async (token: string | null, method: string, path: string, body?: unknown): Promise<Answer> => {
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
  };
  const flip = async (object: string, action: string, enabled: boolean) => {
    const res = await call(admin, 'POST', activation(object, action), { enabled });
    expect(res.status, res.text).toBe(200);
  };
  const actionRows = async (name: string) => {
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    const rows: Array<Record<string, unknown>> = await ql.find(LEDGER, { where: { metadata_type: 'action' }, context: SYS });
    return rows.filter((r) => r.name === name);
  };
  const isActive = (row: Record<string, unknown>) => row.active === true || row.active === 1;
  /** `tools/call run_action` over the live MCP transport; the tool's text content, parsed. */
  const runActionTool = async (actionName: string) => {
    const res = await stack.api('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${admin}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_action', arguments: { actionName } } }),
    });
    expect(res.status).toBe(200);
    const rpc: any = await res.json();
    expect(rpc.error, JSON.stringify(rpc.error)).toBeUndefined();
    return { isError: rpc.result?.isError === true, payload: JSON.parse(rpc.result.content[0].text) };
  };
  const readTask = async (id: string) => (await call(admin, 'GET', `/data/showcase_task/${id}`)).json.record;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dogfood-26572-dispatch-'));
    dbFile = join(dir, 'showcase.db');
    stack = await boot(dbFile);
    admin = await stack.signIn();
    const list = await call(admin, 'GET', '/data/showcase_task?$top=1');
    taskId = list.json.records[0].id;
    expect(taskId).toBeTruthy();
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('absence means active: with no ledger row the gallery\'s garbage bag answers its param contract, never 409', async () => {
    expect(await actionRows('showcase_action_param_gallery')).toEqual([]);
    const res = await call(admin, 'POST', '/actions/showcase_field_zoo/showcase_action_param_gallery', {
      recordId: BOGUS_ID,
      params: { bogus_key: 1 },
    });
    expect(res.status, res.text).toBe(400);
    expect(res.json.error.code).not.toBe('ACTION_DISABLED');
  });

  it('acceptance[0]: the REST door answers 409 ACTION_DISABLED with the engine\'s sentence and writes nothing', async () => {
    const before = await readTask(taskId);
    await flip('showcase_task', 'showcase_mark_done', false);

    for (const recordId of [BOGUS_ID, taskId]) {
      const res = await call(admin, 'POST', '/actions/showcase_task/showcase_mark_done', { recordId });
      expect(res.status, res.text).toBe(409);
      expect(res.json.error.code).toBe('ACTION_DISABLED');
      expectDisabledSentence(res.json.error.message, 'showcase_mark_done');
    }

    // Mark Done's declared write is `{ done: true, progress: 100 }`: none of it landed.
    const after = await readTask(taskId);
    expect({ done: after.done, progress: after.progress, updated_at: after.updated_at })
      .toEqual({ done: before.done, progress: before.progress, updated_at: before.updated_at });
    expect(after.done).toBe(false);

    const rows = await actionRows('showcase_mark_done');
    expect(rows).toHaveLength(1);
    markDoneRowId = rows[0].id;
  });

  it('acceptance[1]: the consult precedes the param contract — 409 disabled, 400 enabled, for the identical request', async () => {
    const request = { recordId: BOGUS_ID, params: { bogus_key: 1 } };
    const path = '/actions/showcase_field_zoo/showcase_action_param_gallery';

    await flip('showcase_field_zoo', 'showcase_action_param_gallery', false);
    const disabled = await call(admin, 'POST', path, request);
    // A disabled action discloses no param shape: not the 400, not a word about p_text.
    expect(disabled.status, disabled.text).toBe(409);
    expect(disabled.json.error.code).toBe('ACTION_DISABLED');
    expect(disabled.text).not.toContain('p_text');

    await flip('showcase_field_zoo', 'showcase_action_param_gallery', true);
    const enabled = await call(admin, 'POST', path, request);
    expect(enabled.status, enabled.text).toBe(400);
    expect(enabled.json.error.message).toMatch(/^Invalid action params: /);
    expect(enabled.json.error.message).toContain('"p_text" is required');
    expect(enabled.json.error.message).toContain('"bogus_key"');
  });

  it('acceptance[3]: the unentitled caller\'s 403 is byte-identical whether the action is enabled or disabled', async () => {
    const path = '/actions/showcase_field_zoo/showcase_zoo_perm_missing';
    const enabled = await call(admin, 'POST', path, { recordId: BOGUS_ID });
    expect(enabled.status, enabled.text).toBe(403);
    expect(enabled.json.error.code).toBe('PERMISSION_DENIED');
    expect(enabled.json.error.message).toContain('showcase.restricted_ops');

    await flip('showcase_field_zoo', 'showcase_zoo_perm_missing', false);
    const disabled = await call(admin, 'POST', path, { recordId: BOGUS_ID });
    expect(disabled.status, disabled.text).toBe(403);
    expect(disabled.text).toBe(enabled.text);
    expect(disabled.text).not.toContain('ACTION_DISABLED');
  });

  it('acceptance[4]: the live MCP run_action tool refuses with ACTION_DISABLED / 409 and the REST door\'s own sentence', async () => {
    const armed = await runActionTool('showcase_portfolio_snapshot');
    expect(armed.isError).toBe(false);
    expect(armed.payload.ok).toBe(true);

    await flip('global', 'showcase_portfolio_snapshot', false);
    const refused = await runActionTool('showcase_portfolio_snapshot');
    expect(refused.isError).toBe(true);
    expect(refused.payload.error.code).toBe('ACTION_DISABLED');
    expect(refused.payload.error.status).toBe(409);
    expectDisabledSentence(refused.payload.error.message, 'showcase_portfolio_snapshot');

    // One producer, not two agreeing texts.
    const rest = await call(admin, 'POST', '/actions/global/showcase_portfolio_snapshot', {});
    expect(rest.status, rest.text).toBe(409);
    expect(rest.json.error.message).toBe(refused.payload.error.message);

    await flip('global', 'showcase_portfolio_snapshot', true);
    const rearmed = await runActionTool('showcase_portfolio_snapshot');
    expect(rearmed.isError).toBe(false);
    expect(rearmed.payload.ok).toBe(true);
  });

  it('acceptance[6]: a disabled `type: flow` action is refused by its OWN switch', async () => {
    // The target flow has no ledger row of its own: the refusal is the action's.
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    const flowRows = await ql.find(LEDGER, { where: { metadata_type: 'flow' }, context: SYS });
    expect(flowRows.filter((r: any) => r.name === 'showcase_reassign_wizard')).toEqual([]);

    await flip('showcase_task', 'showcase_bulk_reassign', false);
    const res = await call(admin, 'POST', '/actions/showcase_task/showcase_bulk_reassign', { recordId: taskId });
    expect(res.status, res.text).toBe(409);
    expect(res.json.error.code).toBe('ACTION_DISABLED');
    expectDisabledSentence(res.json.error.message, 'showcase_bulk_reassign');
  });

  it('negative[2]: an anonymous caller answers the 401 floor before the switch', async () => {
    const res = await call(null, 'POST', '/actions/showcase_task/showcase_mark_done', { recordId: taskId });
    expect(res.status, res.text).toBe(401);
    expect(res.json.error.code).toBe('UNAUTHENTICATED');
  });

  it('acceptance[5] / [2]: after a cold boot the switch holds; re-enabling updates the same row and re-arms dispatch', async () => {
    await stack.stop();
    stack = await boot(dbFile);
    admin = await stack.signIn();

    const stillOff = await call(admin, 'POST', '/actions/showcase_task/showcase_mark_done', { recordId: BOGUS_ID });
    expect(stillOff.status, stillOff.text).toBe(409);
    expect(stillOff.json.error.code).toBe('ACTION_DISABLED');
    const [rowAfterBoot] = await actionRows('showcase_mark_done');
    expect(rowAfterBoot.id).toBe(markDoneRowId);
    expect(isActive(rowAfterBoot)).toBe(false);

    await flip('showcase_task', 'showcase_mark_done', true);
    const rows = await actionRows('showcase_mark_done');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(markDoneRowId);
    expect(isActive(rows[0])).toBe(true);

    // acceptance[2]'s corroboration: the enabled control on the bogus id is the load's 404.
    const control = await call(admin, 'POST', '/actions/showcase_task/showcase_mark_done', { recordId: BOGUS_ID });
    expect(control.status, control.text).toBe(404);
    expect(control.json.error.code).toBe('RECORD_NOT_FOUND');

    const dispatched = await call(admin, 'POST', '/actions/showcase_task/showcase_mark_done', { recordId: taskId });
    expect(dispatched.status, dispatched.text).toBe(200);
    const task = await readTask(taskId);
    expect({ done: task.done, progress: task.progress }).toEqual({ done: true, progress: 100 });
  }, 240_000);
});
