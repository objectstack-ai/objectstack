// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28782] The MCP `create_record` tool answers a record the engine STORED but
 * whose parent roll-up it could not recompute with the create it is — never
 * the refusal, which told an agent its create failed and invited it to create
 * the record again.
 *
 * ## The defect, measured on `origin/main` (`c9a9981da`) before this file
 *
 * The engine reports that case as `ERR_SUMMARY_RECOMPUTE` ("the triggering
 * records WERE written", carrying `written`). #28781 taught the REST and
 * dispatcher single-record doors to answer the write's success; both MCP
 * bridges still let the refusal reach the tool, which rendered it as an
 * `isError` result:
 *
 * - the runtime bridge (`callData('create')` → the protocol's `createData`,
 *   which attaches the earned answer since #28781) — the tool never read it;
 * - the stdio bridge (`createStdioDataBridge`, `engine.insert` direct) built
 *   no answer at all.
 *
 * ## What is pinned
 *
 * - over the HTTP `/mcp` transport, `create_record` answers the bridge's
 *   success body for both bridges, and the stdio bridge stores the row once;
 * - a refusal BEFORE the write is still an `isError` result (ruling 3);
 * - the stale column is logged once, at `error`.
 *
 * The engine is a double whose `insert` stores the row and then throws the
 * refusal as objectql's `SummaryRecomputeError` does (this package has no SQL
 * driver); the real engine's throw is pinned by #28781's REST suite.
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
  return Object.assign(new Error('Failed to recompute 1 roll-up summary value(s) after write; the triggering records WERE written.'), {
    code: 'ERR_SUMMARY_RECOMPUTE',
    written,
    failures: [{ childObject: 'qsf_child', parentObject: 'qsf_parent', parentId: 'p1', field: 'probe_sf', error: new Error('sum over text') }],
  });
}

/** An engine whose `insert` stores the row, then reports the stale roll-up — or refuses before storing anything. */
function engineDouble(stored: Record<string, unknown>[]) {
  return {
    find: vi.fn(async () => []),
    findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return null; }),
    insert: vi.fn(async (_o: string, data: Record<string, unknown>) => {
      if (data.name === 'refused') {
        throw Object.assign(new Error('name is not allowed'), { code: 'VALIDATION_FAILED', status: 400 });
      }
      const row = { id: `n${stored.length + 1}`, ...data };
      stored.push(row);
      throw staleRefusal(row);
    }),
    update: vi.fn(async (_o: string, data: Record<string, unknown>, options?: any) => { assertEngineUpdateDispatch(data, options); return null; }),
    delete: vi.fn(async (_o: string, options?: any) => { assertEngineDeleteDispatch(options); return true; }),
    count: vi.fn(async () => 0),
  } as unknown as IDataEngine;
}

function metadataDouble(): IMetadataService {
  return {
    listObjects: vi.fn(async () => [CHILD]),
    getObject: vi.fn(async () => CHILD),
  } as unknown as IMetadataService;
}

let nextId = 1;
async function createRecord(bridge: McpDataBridge, data: Record<string, unknown>) {
  const body = { jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name: 'create_record', arguments: { objectName: 'qsf_child', data } } };
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

let errorLog: ReturnType<typeof vi.spyOn>;
beforeAll(() => { errorLog = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterAll(() => { errorLog.mockRestore(); });

describe('[#28782] MCP create_record answers a record stored under a failing roll-up as the create it is', () => {
  it('the stdio bridge: the success body, the row stored once', async () => {
    const stored: Record<string, unknown>[] = [];
    const engine = engineDouble(stored);
    const bridge = createStdioDataBridge({
      engine,
      metadataService: metadataDouble(),
      resolvePrincipal: async () => ({ userId: 'u1' }) as unknown as ExecutionContext,
    });
    const result = await createRecord(bridge, { name: 'mcp1', amount: 5 });
    expect(result.isError, result.content[0]?.text).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toEqual({ object: 'qsf_child', id: 'n1', record: { id: 'n1', name: 'mcp1', amount: 5 } });
    expect(engine.insert).toHaveBeenCalledTimes(1);
    expect(stored).toHaveLength(1);
  });

  it('the runtime bridge: the answer the protocol attached to the refusal', async () => {
    const answer = { object: 'qsf_child', id: 'r1', record: { id: 'r1', name: 'mcp2', amount: 6 } };
    const bridge = {
      async listObjects() { return [{ name: 'qsf_child', label: 'Child', fieldCount: 3 }]; },
      async describeObject() { return { name: 'qsf_child', fields: [] }; },
      async query(object: string) { return { object, records: [], total: 0 }; },
      async get() { return null; },
      async create() { throw withEarnedAnswer(staleRefusal(answer.record) as any, answer); },
      async update() { return null; },
      async remove() { return null; },
    } as unknown as McpDataBridge;
    const result = await createRecord(bridge, { name: 'mcp2', amount: 6 });
    expect(result.isError, result.content[0]?.text).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toEqual(answer);
  });

  it('a refusal before the write is still an error result, and nothing is stored', async () => {
    const stored: Record<string, unknown>[] = [];
    const bridge = createStdioDataBridge({
      engine: engineDouble(stored),
      metadataService: metadataDouble(),
      resolvePrincipal: async () => ({ userId: 'u1' }) as unknown as ExecutionContext,
    });
    const result = await createRecord(bridge, { name: 'refused' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('VALIDATION_FAILED');
    expect(stored).toEqual([]);
  });

  it('the stale column is logged once, at error', () => {
    const lines = errorLog.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes('could not be recomputed'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"qsf_parent.probe_sf"');
  });
});
