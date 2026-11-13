// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32442, ruling A — the read half] The object tools' `sys_*` refusal yields
 * PER OBJECT to the author's read opt-in, `enable.aiReadable: true`, which the
 * bridge attests through `aiReadExposed` (its answer is `isAiReadExposed`,
 * `@objectstack/spec/data`).
 *
 * The READ tools only: `list_objects`, `describe_object`, `query_records`,
 * `get_record` and `aggregate_records` admit an attested system object; every
 * write tool keeps refusing it, attested or not, and a bridge that attests
 * nothing (or throws) keeps every system object refused, exactly as before.
 * The rows themselves are the bridge's to serve: this layer adds no gate and
 * removes none.
 *
 * Driven through `MCPServerRuntime.handleHttpRequest` over JSON-RPC, the path
 * an external client hits. The runtime half (the bridge reading the
 * declaration) and the end-to-end gates are pinned in
 * `packages/runtime/src/mcp-system-object-ai-read.test.ts` and the dogfood
 * `approval-read-over-mcp.dogfood.test.ts`.
 */

import { describe, it, expect } from 'vitest';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge } from './mcp-http-tools.js';

const READABLE = 'sys_approval_request';
const SEALED = 'sys_approval_action';
const APP = 'todo_task';
const REFUSAL = 'is a system object and is not exposed via MCP';

type Calls = { reads: string[]; writes: string[] };

function makeBridge(attest: McpDataBridge['aiReadExposed'] | 'omit'): McpDataBridge & { calls: Calls } {
  const calls: Calls = { reads: [], writes: [] };
  const bridge: McpDataBridge & { calls: Calls } = {
    calls,
    async listObjects() {
      return [
        { name: APP, label: 'Task', fieldCount: 2 },
        { name: READABLE, label: 'Approval Request', fieldCount: 3 },
        { name: SEALED, label: 'Approval Action', fieldCount: 3 },
      ];
    },
    async describeObject(name: string) {
      calls.reads.push(`describe:${name}`);
      return { name, fields: [] };
    },
    async query(object: string) {
      calls.reads.push(`query:${object}`);
      return { records: [{ id: 'r1' }] };
    },
    async get(object: string, id: string) {
      calls.reads.push(`get:${object}`);
      return { id };
    },
    async aggregate(object: string) {
      calls.reads.push(`aggregate:${object}`);
      return [{ n: 1 }];
    },
    async create(object: string) {
      calls.writes.push(`create:${object}`);
      return {};
    },
    async update(object: string) {
      calls.writes.push(`update:${object}`);
      return {};
    },
    async remove(object: string) {
      calls.writes.push(`remove:${object}`);
      return {};
    },
  };
  if (attest !== 'omit') bridge.aiReadExposed = attest;
  return bridge;
}

/** The bridge attests exactly one system object, as the runtime bridge would for `enable.aiReadable: true`. */
const attestsOne = async (name: string) => name === READABLE;

async function call(bridge: McpDataBridge, name: string, args: Record<string, unknown>) {
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
  const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
  const req = new Request('http://localhost/api/v1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const res = await runtime.handleHttpRequest(req, { bridge, parsedBody: body });
  const json = (await res.json()) as any;
  return { isError: json.result?.isError === true, text: String(json.result?.content?.[0]?.text ?? '') };
}

const READS: Array<[string, (o: string) => Record<string, unknown>]> = [
  ['describe_object', (o) => ({ objectName: o })],
  ['query_records', (o) => ({ objectName: o, where: { status: 'pending' } })],
  ['get_record', (o) => ({ objectName: o, recordId: 'r1' })],
  ['aggregate_records', (o) => ({ objectName: o, aggregations: [{ function: 'count', alias: 'n' }] })],
];
const WRITES: Array<[string, Record<string, unknown>]> = [
  ['create_record', { objectName: READABLE, data: { status: 'approved' } }],
  ['update_record', { objectName: READABLE, recordId: 'r1', data: { status: 'approved' } }],
  ['delete_record', { objectName: READABLE, recordId: 'r1' }],
];

describe('an attested system object is read by the read tools (#32442)', () => {
  it.each(READS)('%s reaches the bridge for the attested object', async (tool, args) => {
    const bridge = makeBridge(attestsOne);
    const answer = await call(bridge, tool, args(READABLE));
    expect(answer.isError, answer.text).toBe(false);
    expect(bridge.calls.reads).toEqual([`${tool === 'describe_object' ? 'describe' : tool.split('_')[0]}:${READABLE}`]);
  });

  it('list_objects lists the attested system object and no other', async () => {
    const answer = await call(makeBridge(attestsOne), 'list_objects', {});
    expect(answer.isError, answer.text).toBe(false);
    const names = (JSON.parse(answer.text).objects as Array<{ name: string }>).map((o) => o.name);
    expect(names).toEqual([APP, READABLE]);
    expect(JSON.parse(answer.text).totalCount).toBe(2);
  });
});

describe('everything else about system objects stays refused (#32442)', () => {
  it.each(READS)('%s refuses a system object the bridge does not attest, without reaching the bridge', async (tool, args) => {
    const bridge = makeBridge(attestsOne);
    const answer = await call(bridge, tool, args(SEALED));
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain(REFUSAL);
    expect(bridge.calls.reads).toEqual([]);
  });

  it.each(WRITES)('%s refuses the attested system object: no declaration opens a write', async (tool, args) => {
    const bridge = makeBridge(async () => true);
    const answer = await call(bridge, tool, args);
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain(REFUSAL);
    expect(bridge.calls.writes).toEqual([]);
  });

  it('a bridge with no attestation keeps every system object refused and unlisted, as before', async () => {
    const bridge = makeBridge('omit');
    for (const [tool, args] of READS) {
      const answer = await call(bridge, tool, args(READABLE));
      expect(answer.isError, tool).toBe(true);
      expect(answer.text).toContain(REFUSAL);
    }
    const listed = await call(bridge, 'list_objects', {});
    expect((JSON.parse(listed.text).objects as Array<{ name: string }>).map((o) => o.name)).toEqual([APP]);
    expect(bridge.calls.reads).toEqual([]);
  });

  it('an attestation that throws fails closed', async () => {
    const bridge = makeBridge(async () => {
      throw new Error('metadata store unreadable');
    });
    const answer = await call(bridge, 'query_records', { objectName: READABLE });
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain(REFUSAL);
    const listed = await call(bridge, 'list_objects', {});
    expect((JSON.parse(listed.text).objects as Array<{ name: string }>).map((o) => o.name)).toEqual([APP]);
    expect(bridge.calls.reads).toEqual([]);
  });

  it('a business object never asks the attestation', async () => {
    const asked: string[] = [];
    const bridge = makeBridge(async (name) => {
      asked.push(name);
      return false;
    });
    const answer = await call(bridge, 'query_records', { objectName: APP });
    expect(answer.isError, answer.text).toBe(false);
    expect(asked).toEqual([]);
  });
});

describe('the query tool names the "pending for me" filter shape (#32442)', () => {
  it('query_records text carries the My Pending filter on sys_approval_request', async () => {
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    const req = new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    });
    const res = await runtime.handleHttpRequest(req, { bridge: makeBridge(attestsOne), parsedBody: body });
    const tools = ((await res.json()) as any).result.tools as Array<{ name: string; description: string }>;
    const description = tools.find((t) => t.name === 'query_records')?.description ?? '';
    expect(description).toContain('"sys_approval_request"');
    expect(description).toContain('{"status":"pending","pending_approvers":{"$contains":"{current_user_id}"}}');
  });
});
