// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28844] The MCP `update_record` and `delete_record` tools answer a write the
 * engine STORED but whose parent roll-up it could not recompute with the
 * update or delete it is — never the refusal, which told an agent its write
 * failed and invited it to apply it again.
 *
 * ## The defect, measured on `origin/main` (`b95a856e3`) before this file
 *
 * The engine reports that case as `ERR_SUMMARY_RECOMPUTE` ("the triggering
 * records WERE written", carrying `written`). #28843 taught `create_record`
 * and the stdio bridge's `create` to read #28781's carrier; the update and
 * delete tools still rendered the refusal as an `isError` result on both
 * bridges:
 *
 * - the runtime bridge (`callData('update' | 'delete')` → the protocol's
 *   `updateData` / `deleteData`, which attach the earned answer since #28781)
 *   — the tools never read it;
 * - the stdio bridge (`createStdioDataBridge`, `engine.update` /
 *   `engine.delete` direct) built no answer at all.
 *
 * ## What is pinned
 *
 * - over the HTTP `/mcp` transport, each tool answers the bridge's success
 *   result for both bridges, and the stdio bridge applies the write once;
 * - a refusal BEFORE the write is still an `isError` result (ruling 4);
 * - the stale column is logged once, at `error`.
 *
 * The engine is a double whose `update` / `delete` apply the write and then
 * throw the refusal as objectql's `SummaryRecomputeError` does (this package
 * has no SQL driver); the real engine's throw is pinned by #28781's REST suite.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { withEarnedAnswer } from '@objectstack/types';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import { createStdioDataBridge } from './stdio-data-bridge.js';
import type { McpDataBridge } from './mcp-http-tools.js';

const CHILD = {
  name: 'qsf_child',
  label: 'Child',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    amount: { name: 'amount', type: 'number' },
  },
  enable: {},
};

/** objectql's `SummaryRecomputeError`, as a write's caller reads it: by `code`, carrying `written`. */
function staleRefusal(written: unknown): Error {
  return Object.assign(new Error('Roll-up summary recompute failed after retries for 1 parent record(s); the triggering records WERE written.'), {
    code: 'ERR_SUMMARY_RECOMPUTE',
    written,
    failures: [{ childObject: 'qsf_child', parentObject: 'qsf_parent', parentId: 'p1', field: 'probe_sf', error: new Error('sum over text') }],
  });
}

const idOf = (options: any): string | undefined => options?.where?.id;

/**
 * A store of `qsf_child` rows behind an engine whose `update` / `delete` apply
 * the write, then report the stale roll-up — or refuse before writing anything
 * when the patch names `refused`.
 */
function engineDouble(rows: Map<string, Record<string, unknown>>, writes: string[]) {
  return {
    find: vi.fn(async (_o: string, query?: any) => {
      const id = query?.where?.id;
      const all = [...rows.values()].filter((r) => id === undefined || r.id === id);
      return typeof query?.limit === 'number' ? all.slice(0, query.limit) : all;
    }),
    findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => {
      assertEngineFindOnePredicate(object, query);
      return rows.get(String((query as any)?.where?.id)) ?? null;
    }),
    insert: vi.fn(async () => { throw new Error('not used'); }),
    update: vi.fn(async (_o: string, data: Record<string, unknown>, options?: any) => {
      assertEngineUpdateDispatch(data, options);
      if (data.name === 'refused') {
        throw Object.assign(new Error('name is not allowed'), { code: 'VALIDATION_FAILED', status: 400 });
      }
      const id = idOf(options)!;
      const next = { ...rows.get(id), ...data };
      rows.set(id, next);
      writes.push(`update:${id}`);
      throw staleRefusal(next);
    }),
    delete: vi.fn(async (_o: string, options?: any) => {
      assertEngineDeleteDispatch(options);
      const id = idOf(options)!;
      rows.delete(id);
      writes.push(`delete:${id}`);
      throw staleRefusal(true);
    }),
    count: vi.fn(async () => rows.size),
  } as unknown as IDataEngine;
}

function metadataDouble(): IMetadataService {
  return {
    listObjects: vi.fn(async () => [CHILD]),
    getObject: vi.fn(async () => CHILD),
  } as unknown as IMetadataService;
}

function stdioBridge(rows: Map<string, Record<string, unknown>>, writes: string[]) {
  return createStdioDataBridge({
    engine: engineDouble(rows, writes),
    metadataService: metadataDouble(),
    resolvePrincipal: async () => ({ userId: 'u1' }) as unknown as ExecutionContext,
  });
}

let nextId = 1;
async function callTool(bridge: McpDataBridge, name: string, args: Record<string, unknown>) {
  const body = { jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } };
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
  const json = (await res.json()) as { result?: any; error?: unknown };
  expect(json.error, JSON.stringify(json.error)).toBeUndefined();
  return json.result as { content: Array<{ text: string }>; isError?: boolean };
}

/** The runtime bridge's shape: `callData` hands back the protocol's refusal with the earned answer attached. */
function runtimeShapedBridge(answers: { update: Record<string, unknown>; remove: Record<string, unknown> }): McpDataBridge {
  return {
    async listObjects() { return [{ name: 'qsf_child', label: 'Child', fieldCount: 3 }]; },
    async describeObject() { return { name: 'qsf_child', fields: [] }; },
    async query(object: string) { return { object, records: [], total: 0 }; },
    async get() { return null; },
    async create() { return null; },
    async update() { throw withEarnedAnswer(staleRefusal(answers.update.record) as any, answers.update); },
    async remove() { throw withEarnedAnswer(staleRefusal(true) as any, answers.remove); },
  } as unknown as McpDataBridge;
}

let errorLog: ReturnType<typeof vi.spyOn>;
beforeAll(() => { errorLog = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterAll(() => { errorLog.mockRestore(); });

describe('[#28844] MCP update_record / delete_record answer a write applied under a failing roll-up as the write it is', () => {
  it('update_record, stdio bridge: the success result, the update applied once', async () => {
    const rows = new Map([['c1', { id: 'c1', name: 'c1', amount: 100 }]]);
    const writes: string[] = [];
    const result = await callTool(stdioBridge(rows, writes), 'update_record', { objectName: 'qsf_child', recordId: 'c1', data: { amount: 35 } });
    expect(result.isError, result.content[0]?.text).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toEqual({ object: 'qsf_child', id: 'c1', record: { id: 'c1', name: 'c1', amount: 35 } });
    expect(writes).toEqual(['update:c1']);
    expect(rows.get('c1')).toMatchObject({ amount: 35 });
  });

  it('delete_record, stdio bridge: the success result, the delete applied once', async () => {
    const rows = new Map([['c2', { id: 'c2', name: 'c2', amount: 135 }]]);
    const writes: string[] = [];
    const result = await callTool(stdioBridge(rows, writes), 'delete_record', { objectName: 'qsf_child', recordId: 'c2' });
    expect(result.isError, result.content[0]?.text).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toEqual({ object: 'qsf_child', id: 'c2', success: true });
    expect(writes).toEqual(['delete:c2']);
    expect(rows.has('c2')).toBe(false);
  });

  it('both tools, runtime bridge: the answer the protocol attached to the refusal', async () => {
    const answers = {
      update: { object: 'qsf_child', id: 'r1', record: { id: 'r1', name: 'r1', amount: 6 } },
      remove: { object: 'qsf_child', id: 'r2', success: true },
    };
    const bridge = runtimeShapedBridge(answers);
    const updated = await callTool(bridge, 'update_record', { objectName: 'qsf_child', recordId: 'r1', data: { amount: 6 } });
    expect(updated.isError, updated.content[0]?.text).toBeFalsy();
    expect(JSON.parse(updated.content[0]!.text)).toEqual(answers.update);
    const removed = await callTool(bridge, 'delete_record', { objectName: 'qsf_child', recordId: 'r2' });
    expect(removed.isError, removed.content[0]?.text).toBeFalsy();
    expect(JSON.parse(removed.content[0]!.text)).toEqual(answers.remove);
  });

  it('a refusal before the write is still an error result, and nothing is written', async () => {
    const rows = new Map([['c3', { id: 'c3', name: 'c3', amount: 10 }]]);
    const writes: string[] = [];
    const result = await callTool(stdioBridge(rows, writes), 'update_record', { objectName: 'qsf_child', recordId: 'c3', data: { name: 'refused' } });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('VALIDATION_FAILED');
    expect(writes).toEqual([]);
    expect(rows.get('c3')).toMatchObject({ name: 'c3' });
  });

  it('the stale column is logged once, at error', () => {
    const lines = errorLog.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes('could not be recomputed'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"qsf_parent.probe_sf"');
  });
});
