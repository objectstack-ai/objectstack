// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30891] The MCP `delete_records` tool deletes many records of ONE object in
 * one confirmed call, selected by a filter (`where`) or an id list
 * (`recordIds`).
 *
 * ## What is pinned, and where
 *
 *  - The confirmation is `delete_record`'s (#30813): the same member, code,
 *    status, envelope keys and `details` keys. A call without `confirm: true`
 *    is REFUSED and deletes nothing; the refusal carries a `preview` beside
 *    `error` (how many records match, how many a confirmed call attempts, a
 *    sample of ids).
 *  - A confirmed call deletes each selected row through the bridge's
 *    `remove`, the member `delete_record` deletes with, under the CALLER's
 *    resolved context, handed to the engine unchanged: the tool has no other
 *    path to a delete, so it has no way around a package's delete rules, for
 *    an administrator either (the maintainer's ruling on the card). Rows a
 *    rule refuses stay, and are answered grouped by code, status and reason,
 *    with their ids.
 *  - The per-call cap (200) and the remainder: a selection over the cap
 *    deletes 200 and says how many still match; the next call continues.
 *
 * Driven over the HTTP `/mcp` transport against the REAL stdio data bridge on
 * an engine double that holds the rows; the long-lived server the stdio
 * transport serves is driven once too. A real stack, with a real package
 * locking rule refusing an administrator, is
 * `packages/qa/dogfood/test/mcp-delete-records.dogfood.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AI_ACTION_CONFIRMATION_MEMBER } from '@objectstack/spec/contracts';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import {
  assertEngineDeleteDispatch,
  assertEngineUpdateDispatch,
  assertEngineFindOnePredicate,
  type EngineFindOneQueryInput,
} from '@objectstack/metadata-core';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import { createStdioDataBridge } from './stdio-data-bridge.js';
import { DELETE_RECORDS_MAX_PER_CALL, type McpDataBridge } from './mcp-http-tools.js';

const OBJECT = 'dlr_task';

const TASK = {
  name: OBJECT,
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text' },
    title: { name: 'title', type: 'text' },
    status: { name: 'status', type: 'text' },
    locked: { name: 'locked', type: 'boolean' },
    owner: { name: 'owner', type: 'text' },
  },
  enable: {},
};

/** The resolved caller: an administrator. Every engine call must carry exactly this context. */
const CALLER = { userId: 'u_admin', roles: ['admin'] } as unknown as ExecutionContext;

const LOCKED_REASON = 'The period is closed: a task of a closed period cannot be deleted.';
const OWNER_REASON = 'You may not delete a task you do not own.';
/** A permission refusal's `details` names positions; the tools keep `details` off the wire. */
const WITHHELD_POSITION = 'pos_finance_controller';

type Row = Record<string, unknown>;

/**
 * The equality / `$in` / `$nin` subset the tool's selections use. Anything
 * else is loud: a combinator (`$and`, `$or`, …) is refused rather than read as
 * a field name, and so is an operator this double does not model.
 */
function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  return Object.entries(where ?? {}).every(([key, cond]) => {
    if (key.startsWith('$')) throw new Error(`engine double: combinator ${key} is not modelled`);
    const cell = row[key];
    if (cond === null || typeof cond !== 'object' || Array.isArray(cond)) return cell === cond;
    return Object.entries(cond as Record<string, unknown>).every(([op, operand]) => {
      if (op === '$in') return (operand as unknown[]).includes(cell);
      if (op === '$nin') return !(operand as unknown[]).includes(cell);
      throw new Error(`engine double: operator ${op} is not modelled`);
    });
  });
}

/** objectql's `SummaryRecomputeError`, as a write's caller reads it: by `code`, carrying `written`. */
function staleRefusal(): Error {
  return Object.assign(new Error('Failed to recompute 1 roll-up summary value(s) after write; the triggering records WERE written.'), {
    code: 'ERR_SUMMARY_RECOMPUTE',
    written: undefined,
    failures: [{ childObject: OBJECT, parentObject: 'dlr_project', parentId: 'p1', field: 'open_tasks', error: new Error('count over text') }],
  });
}

/**
 * A store of `dlr_task` rows behind an engine that judges each delete the way
 * a package's delete rules do: a `locked` row is refused with
 * `RECORD_LOCKED` / 409 whoever asks, a row another user owns with
 * `PERMISSION_DENIED` / 403 (carrying `details`), and a `stale` row is
 * deleted under a roll-up the engine could not recompute.
 */
function engineDouble(rows: Map<string, Row>, opts: { aggregate?: boolean } = {}) {
  const contexts: unknown[] = [];
  const engine: Record<string, unknown> = {
    find: vi.fn(async (_o: string, query?: any, options?: any) => {
      contexts.push(options?.context);
      let all = [...rows.values()].filter((r) => matches(r, query?.where));
      const order = query?.orderBy?.[0];
      if (order) {
        const dir = order.order === 'desc' ? -1 : 1;
        all = all.sort((a, b) => (String(a[order.field]) < String(b[order.field]) ? -dir : String(a[order.field]) > String(b[order.field]) ? dir : 0));
      }
      if (Array.isArray(query?.fields)) all = all.map((r) => Object.fromEntries(query.fields.map((f: string) => [f, r[f]])));
      return typeof query?.limit === 'number' ? all.slice(0, query.limit) : all;
    }),
    findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => {
      assertEngineFindOnePredicate(object, query);
      return rows.get(String((query as any)?.where?.id)) ?? null;
    }),
    insert: vi.fn(async () => {
      throw new Error('not used');
    }),
    update: vi.fn(async (_o: string, data: Record<string, unknown>, options?: any) => {
      assertEngineUpdateDispatch(data, options);
      throw new Error('not used');
    }),
    delete: vi.fn(async (_o: string, options?: any) => {
      assertEngineDeleteDispatch(options);
      contexts.push(options?.context);
      const id = String(options?.where?.id);
      const row = rows.get(id);
      if (row?.locked === true) {
        throw Object.assign(new Error(LOCKED_REASON), { code: 'RECORD_LOCKED', status: 409 });
      }
      if (row?.owner === 'someone_else') {
        throw Object.assign(new Error(OWNER_REASON), {
          code: 'PERMISSION_DENIED',
          status: 403,
          details: { positions: [WITHHELD_POSITION] },
        });
      }
      rows.delete(id);
      if (row?.stale === true) throw staleRefusal();
      return { deleted: 1 };
    }),
    count: vi.fn(async () => rows.size),
  };
  if (opts.aggregate !== false) {
    engine.aggregate = vi.fn(async (_o: string, query: any) => {
      contexts.push(query?.context);
      const count = [...rows.values()].filter((r) => matches(r, query?.where)).length;
      return [Object.fromEntries((query.aggregations as Array<{ alias: string }>).map((a) => [a.alias, count]))];
    });
  }
  return { engine: engine as any, contexts };
}

function metadataDouble(): IMetadataService {
  return {
    listObjects: vi.fn(async () => [TASK]),
    getObject: vi.fn(async () => TASK),
  } as unknown as IMetadataService;
}

function stdioBridge(engine: unknown): McpDataBridge {
  return createStdioDataBridge({
    engine: engine as IDataEngine,
    metadataService: metadataDouble(),
    resolvePrincipal: async () => CALLER,
  });
}

let nextId = 1;
async function rpcRaw(bridge: McpDataBridge, method: string, params?: Record<string, unknown>) {
  const body = { jsonrpc: '2.0', id: nextId++, method, ...(params ? { params } : {}) };
  const runtime = new MCPServerRuntime({ name: 'pin', version: '0.0.0' });
  const res = await runtime.handleHttpRequest(
    new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }),
    { bridge: bridge as any, parsedBody: body },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { result?: any; error?: unknown };
}

async function rpc(bridge: McpDataBridge, method: string, params?: Record<string, unknown>) {
  const json = await rpcRaw(bridge, method, params);
  expect(json.error, JSON.stringify(json.error)).toBeUndefined();
  return json.result;
}

type ToolResult = { content: Array<{ text: string }>; isError?: boolean };

async function callTool(bridge: McpDataBridge, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await rpc(bridge, 'tools/call', { name, arguments: args })) as ToolResult;
}

const parsed = (result: ToolResult) => JSON.parse(result.content[0]!.text);

const task = (id: string, extra: Row = {}): [string, Row] => [id, { id, title: `task ${id}`, status: 'done', ...extra }];

describe('MCP delete_records: many records of one object in one confirmed call (#30891)', () => {
  let rows: Map<string, Row>;
  let double: ReturnType<typeof engineDouble>;
  let bridge: McpDataBridge;

  beforeEach(() => {
    rows = new Map([
      task('t1'),
      task('t2', { locked: true }),
      task('t3'),
      task('t4', { locked: true }),
      task('t5', { owner: 'someone_else' }),
      task('t6', { status: 'open' }),
    ]);
    double = engineDouble(rows);
    bridge = stdioBridge(double.engine);
  });

  it('is advertised as destructive, with an optional boolean confirmation member and a capped id list', async () => {
    const listed = await rpc(bridge, 'tools/list');
    const tool = (listed.tools as any[]).find((t) => t.name === 'delete_records');
    expect(tool, 'delete_records is registered').toBeDefined();
    const props = tool.inputSchema.properties;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['objectName', 'where', 'recordIds', AI_ACTION_CONFIRMATION_MEMBER]));
    expect(props[AI_ACTION_CONFIRMATION_MEMBER]?.type).toBe('boolean');
    // Optional, as on delete_record: a call without it must reach the handler,
    // which answers the coded refusal and the preview.
    expect(tool.inputSchema.required ?? []).toEqual(['objectName']);
    expect(props.recordIds?.maxItems).toBe(DELETE_RECORDS_MAX_PER_CALL);
    expect(tool.description).toContain('confirm: true');
    expect(tool.description).toContain(String(DELETE_RECORDS_MAX_PER_CALL));
    expect(tool.annotations?.destructiveHint).toBe(true);
    expect(tool.annotations?.readOnlyHint).toBe(false);
  });

  it('an unconfirmed call is refused with a preview: count, sample ids, nothing deleted', async () => {
    const result = await callTool(bridge, 'delete_records', { objectName: OBJECT, where: { status: 'done' } });

    expect(result.isError).toBe(true);
    const { error, preview } = parsed(result);
    expect(error.code).toBe('ACTION_CONFIRMATION_REQUIRED');
    expect(error.status).toBe(428);
    expect(error.details).toEqual({ actionName: 'delete_records', objectName: OBJECT, confirmationMember: AI_ACTION_CONFIRMATION_MEMBER });
    expect(String(error.message)).toContain('nothing was deleted');
    expect(String(error.message)).toContain('matches 5 record(s)');

    expect(preview).toMatchObject({
      object: OBJECT,
      matched: 5,
      wouldAttempt: 5,
      cap: DELETE_RECORDS_MAX_PER_CALL,
      sampleRecordIds: ['t1', 't2', 't3', 't4', 't5'],
    });
    expect(preview.note).toMatch(/^Nothing was deleted\./);

    // Nothing was deleted: the engine was never asked to, and every row is there.
    expect(double.engine.delete).not.toHaveBeenCalled();
    expect([...rows.keys()]).toEqual(['t1', 't2', 't3', 't4', 't5', 't6']);
  });

  it.each([
    ['false', false],
    ['the string "true"', 'true'],
    ['1', 1],
  ])('refuses %s as the member: only the boolean true attests, and nothing is deleted', async (_label, value) => {
    const result = await callTool(bridge, 'delete_records', {
      objectName: OBJECT,
      where: {},
      [AI_ACTION_CONFIRMATION_MEMBER]: value,
    });

    expect(result.isError).toBe(true);
    expect(double.engine.delete).not.toHaveBeenCalled();
    expect(rows.size).toBe(6);
  });

  it('answers with delete_record\'s refusal: the same code, status, envelope keys and details keys', async () => {
    const one = parsed(await callTool(bridge, 'delete_record', { objectName: OBJECT, recordId: 't1' })).error;
    const many = parsed(await callTool(bridge, 'delete_records', { objectName: OBJECT, recordIds: ['t1'] })).error;

    // Lit control: the delete_record half really is #30813's refusal.
    expect(one.code).toBe('ACTION_CONFIRMATION_REQUIRED');

    expect(many.code).toBe(one.code);
    expect(many.status).toBe(one.status);
    expect(Object.keys(many)).toEqual(Object.keys(one));
    expect(Object.keys(many.details)).toEqual(Object.keys(one.details));
    expect(many.details.confirmationMember).toBe(one.details.confirmationMember);
    expect(many.details.objectName).toBe(one.details.objectName);
    // The tool the refused call addressed, as run_action names its action.
    expect(many.details.actionName).toBe('delete_records');
    expect(rows.has('t1')).toBe(true);
  });

  it('a confirmed call deletes the rows the rules allow and answers the rest grouped by reason, with ids', async () => {
    const result = await callTool(bridge, 'delete_records', {
      objectName: OBJECT,
      where: { status: 'done' },
      [AI_ACTION_CONFIRMATION_MEMBER]: true,
    });

    expect(result.isError, result.content[0]?.text).toBeFalsy();
    const answer = parsed(result);
    expect(answer).toEqual({
      object: OBJECT,
      matched: 5,
      attempted: 5,
      deleted: 2,
      refused: 3,
      refusals: [
        { code: 'RECORD_LOCKED', status: 409, reason: LOCKED_REASON, count: 2, recordIds: ['t2', 't4'] },
        { code: 'PERMISSION_DENIED', status: 403, reason: OWNER_REASON, count: 1, recordIds: ['t5'] },
      ],
      remaining: 3,
      cap: DELETE_RECORDS_MAX_PER_CALL,
    });
    // A refusal's `details` stays off the wire, as on every other tool.
    expect(result.content[0]!.text).not.toContain(WITHHELD_POSITION);

    // Ground truth: the allowed rows are gone, the refused ones and the unselected one stay.
    expect([...rows.keys()]).toEqual(['t2', 't4', 't5', 't6']);
    // Each selected row was asked once, no retry, no second path.
    expect(double.engine.delete).toHaveBeenCalledTimes(5);
  });

  it('runs as the caller: every engine read and delete carries the caller\'s resolved context, unchanged', async () => {
    await callTool(bridge, 'delete_records', { objectName: OBJECT, where: { status: 'done' }, [AI_ACTION_CONFIRMATION_MEMBER]: true });

    expect(double.contexts.length).toBeGreaterThan(5);
    for (const context of double.contexts) {
      // The same object the principal resolver answered: no elevated copy, no
      // `isSystem`, no swapped user. A locking rule judges the caller.
      expect(context).toBe(CALLER);
    }
    const deleteContexts = double.engine.delete.mock.calls.map((c: any[]) => c[1]?.context);
    expect(deleteContexts).toHaveLength(5);
    for (const context of deleteContexts) expect((context as any).isSystem).toBeUndefined();
  });

  it('an id list: duplicates collapse, an id naming no readable record is answered, not attempted', async () => {
    const preview = parsed(await callTool(bridge, 'delete_records', { objectName: OBJECT, recordIds: ['t3', 't1', 't3', 'gone', 't2'] })).preview;
    expect(preview).toMatchObject({ matched: 3, wouldAttempt: 3, sampleRecordIds: ['t3', 't1', 't2'], notFound: ['gone'] });
    expect(double.engine.delete).not.toHaveBeenCalled();

    const answer = parsed(
      await callTool(bridge, 'delete_records', {
        objectName: OBJECT,
        recordIds: ['t3', 't1', 't3', 'gone', 't2'],
        [AI_ACTION_CONFIRMATION_MEMBER]: true,
      }),
    );
    expect(answer).toMatchObject({
      matched: 3,
      attempted: 3,
      deleted: 2,
      refused: 1,
      refusals: [{ code: 'RECORD_LOCKED', status: 409, count: 1, recordIds: ['t2'] }],
      notFound: ['gone'],
      remaining: 1,
    });
    expect([...rows.keys()].sort()).toEqual(['t2', 't4', 't5', 't6']);
  });

  it('caps one call at 200, says how many remain, and the next call continues', async () => {
    rows.clear();
    for (let i = 0; i < 205; i++) {
      const [id, row] = task(`r${String(i).padStart(3, '0')}`);
      rows.set(id, row);
    }

    const preview = parsed(await callTool(bridge, 'delete_records', { objectName: OBJECT, where: {} })).preview;
    expect(preview).toMatchObject({ matched: 205, wouldAttempt: DELETE_RECORDS_MAX_PER_CALL, cap: DELETE_RECORDS_MAX_PER_CALL });
    expect(preview.sampleRecordIds).toHaveLength(10);
    expect(rows.size).toBe(205);

    const first = parsed(await callTool(bridge, 'delete_records', { objectName: OBJECT, where: {}, [AI_ACTION_CONFIRMATION_MEMBER]: true }));
    expect(first).toMatchObject({ matched: 205, attempted: 200, deleted: 200, refused: 0, remaining: 5 });
    expect(first.next).toContain('5 matching record(s) were past this call\'s cap of 200');
    expect(rows.size).toBe(5);
    // In id order: the 200 lowest ids went first.
    expect([...rows.keys()].sort()).toEqual(['r200', 'r201', 'r202', 'r203', 'r204']);

    const second = parsed(await callTool(bridge, 'delete_records', { objectName: OBJECT, where: {}, [AI_ACTION_CONFIRMATION_MEMBER]: true }));
    expect(second).toMatchObject({ matched: 5, attempted: 5, deleted: 5, remaining: 0 });
    expect(second.next).toBeUndefined();
    expect(rows.size).toBe(0);
  });

  it('over the cap with refused rows, the answer tells the caller to exclude their ids to move past them', async () => {
    rows.clear();
    for (let i = 0; i < 202; i++) {
      const [id, row] = task(`r${String(i).padStart(3, '0')}`, i < 2 ? { locked: true } : {});
      rows.set(id, row);
    }
    const answer = parsed(await callTool(bridge, 'delete_records', { objectName: OBJECT, where: {}, [AI_ACTION_CONFIRMATION_MEMBER]: true }));
    expect(answer).toMatchObject({ matched: 202, attempted: 200, deleted: 198, refused: 2, remaining: 4 });
    expect(answer.refusals).toEqual([{ code: 'RECORD_LOCKED', status: 409, reason: LOCKED_REASON, count: 2, recordIds: ['r000', 'r001'] }]);
    expect(answer.next).toContain('$nin');
  });

  it('with no aggregate on the bridge, a selection over the cap answers "more than 200", never a guessed count', async () => {
    rows.clear();
    for (let i = 0; i < 203; i++) {
      const [id, row] = task(`r${String(i).padStart(3, '0')}`);
      rows.set(id, row);
    }
    const plain = engineDouble(rows, { aggregate: false });
    const noAggregate = stdioBridge(plain.engine);
    expect(noAggregate.aggregate).toBeUndefined();

    const preview = parsed(await callTool(noAggregate, 'delete_records', { objectName: OBJECT, where: {} })).preview;
    expect(preview).toMatchObject({ matchedMoreThan: DELETE_RECORDS_MAX_PER_CALL, wouldAttempt: DELETE_RECORDS_MAX_PER_CALL });
    expect('matched' in preview).toBe(false);

    const answer = parsed(await callTool(noAggregate, 'delete_records', { objectName: OBJECT, where: {}, [AI_ACTION_CONFIRMATION_MEMBER]: true }));
    expect(answer).toMatchObject({ matchedMoreThan: DELETE_RECORDS_MAX_PER_CALL, attempted: 200, deleted: 200 });
    expect('remaining' in answer).toBe(false);
    expect(answer.next).toMatch(/^More matching record\(s\) were past this call's cap/);
    expect(rows.size).toBe(3);
  });

  it('a delete applied under a stale roll-up counts as deleted; a remove answering success: false is named', async () => {
    rows.set('t7', { id: 't7', title: 'task t7', status: 'done', stale: true });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const partial: McpDataBridge = {
        ...bridge,
        async remove(object, id) {
          if (id === 't3') return { object, id, success: false };
          return bridge.remove(object, id);
        },
      };
      const answer = parsed(
        await callTool(partial, 'delete_records', { objectName: OBJECT, recordIds: ['t1', 't3', 't7'], [AI_ACTION_CONFIRMATION_MEMBER]: true }),
      );
      expect(answer).toMatchObject({ matched: 3, attempted: 3, deleted: 2, refused: 0, refusals: [], notRemoved: ['t3'], remaining: 1 });
      expect(rows.has('t7')).toBe(false);
      expect(rows.has('t3')).toBe(true);
    } finally {
      errors.mockRestore();
    }
  });

  it.each([
    ['neither selection', {}, 'needs a selection'],
    ['both selections', { where: {}, recordIds: ['t1'] }, 'takes one selection'],
  ])('refuses %s before reading anything, and deletes nothing', async (_label, selection, words) => {
    const result = await callTool(bridge, 'delete_records', { objectName: OBJECT, ...selection, [AI_ACTION_CONFIRMATION_MEMBER]: true });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain(words);
    expect(double.engine.find).not.toHaveBeenCalled();
    expect(double.engine.delete).not.toHaveBeenCalled();
    expect(rows.size).toBe(6);
  });

  it('refuses an id list longer than the cap at the input, and deletes nothing', async () => {
    const ids = Array.from({ length: DELETE_RECORDS_MAX_PER_CALL + 1 }, (_, i) => `x${i}`);
    const json = await rpcRaw(bridge, 'tools/call', {
      name: 'delete_records',
      arguments: { objectName: OBJECT, recordIds: ids, [AI_ACTION_CONFIRMATION_MEMBER]: true },
    });

    const refused = json.error !== undefined || json.result?.isError === true;
    expect(refused, JSON.stringify(json).slice(0, 300)).toBe(true);
    expect(double.engine.delete).not.toHaveBeenCalled();
  });

  it('the long-lived server the stdio transport serves refuses, previews and deletes the same way', async () => {
    const runtime = new MCPServerRuntime({ name: 'pin-stdio', version: '0.0.0' });
    runtime.bridgeDataTools(bridge);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await runtime.server.connect(serverTransport);
    const client = new Client({ name: 'pin-client', version: '0.0.0' });
    await client.connect(clientTransport);
    try {
      const refused: any = await client.callTool({ name: 'delete_records', arguments: { objectName: OBJECT, where: { status: 'done' } } });
      expect(refused.isError).toBe(true);
      const { error, preview } = JSON.parse(refused.content[0].text);
      expect(error.code).toBe('ACTION_CONFIRMATION_REQUIRED');
      expect(error.details).toEqual({ actionName: 'delete_records', objectName: OBJECT, confirmationMember: AI_ACTION_CONFIRMATION_MEMBER });
      expect(preview).toMatchObject({ matched: 5, wouldAttempt: 5 });
      expect(rows.size).toBe(6);

      const confirmed: any = await client.callTool({
        name: 'delete_records',
        arguments: { objectName: OBJECT, where: { status: 'done' }, [AI_ACTION_CONFIRMATION_MEMBER]: true },
      });
      expect(confirmed.isError, confirmed.content?.[0]?.text).toBeFalsy();
      expect(JSON.parse(confirmed.content[0].text)).toMatchObject({ deleted: 2, refused: 3, remaining: 3 });
      expect([...rows.keys()]).toEqual(['t2', 't4', 't5', 't6']);
    } finally {
      await client.close();
    }
  });
});
