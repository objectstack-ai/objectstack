// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The MCP `delete_record` tool takes `run_action`'s confirmation gate: a call
 * without `confirm: true` is REFUSED with `ACTION_CONFIRMATION_REQUIRED` and
 * nothing is deleted.
 *
 * ## Why
 *
 * A delete over MCP is hard and permanent, and before this gate one call did
 * it: `annotations.destructiveHint` is a hint a client may ignore, and the
 * bridge's own checks (API exposure, credentials, the caller's permissions)
 * say whether the caller MAY delete, never whether a human asked for it. An
 * instruction planted in a record's text could lead an agent to delete rows
 * its user may delete with no human asked. The maintainer chose option B: the
 * server-side backstop `run_action` already has, widened to this one tool,
 * with the same member, code, status and `details`.
 *
 * ## What is pinned, and where
 *
 *  - The door, over the HTTP `/mcp` transport, against the REAL stdio data
 *    bridge on an engine double that holds the row: the member is advertised,
 *    an unconfirmed call (absent, `false`, the string `'true'`) is refused and
 *    the row is still there, a confirmed call deletes it.
 *  - The refusal's code, status and `details` keys are `run_action`'s, served
 *    through the same door from a bridge throwing what the runtime gate
 *    throws. The real runtime gate beside the real `delete_record` refusal, and
 *    REST `DELETE /data/:object/:id` (outside the gate), are driven together in
 *    `packages/qa/dogfood/test/mcp-delete-record-confirmation.dogfood.test.ts`.
 *  - The long-lived server the stdio transport serves gates too: both
 *    transports register their tools through `wireBridgeTools`.
 *  - Controls: `update_record` is not gated, and the bridge is never reached
 *    by a refused call.
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
import type { McpActionBridge, McpDataBridge } from './mcp-http-tools.js';

const OBJECT = 'dlc_note';

const NOTE = {
  name: OBJECT,
  label: 'Note',
  fields: {
    id: { name: 'id', type: 'text' },
    title: { name: 'title', type: 'text' },
  },
  enable: {},
};

/** A store of `dlc_note` rows behind an engine that applies every write it is handed. */
function engineDouble(rows: Map<string, Record<string, unknown>>) {
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
    insert: vi.fn(async () => {
      throw new Error('not used');
    }),
    update: vi.fn(async (_o: string, data: Record<string, unknown>, options?: any) => {
      assertEngineUpdateDispatch(data, options);
      const id = String(options?.where?.id);
      rows.set(id, { ...rows.get(id), ...data });
      return rows.get(id);
    }),
    delete: vi.fn(async (_o: string, options?: any) => {
      assertEngineDeleteDispatch(options);
      rows.delete(String(options?.where?.id));
      return { deleted: 1 };
    }),
    count: vi.fn(async () => rows.size),
  };
}

function metadataDouble(): IMetadataService {
  return {
    listObjects: vi.fn(async () => [NOTE]),
    getObject: vi.fn(async () => NOTE),
  } as unknown as IMetadataService;
}

function stdioBridge(engine: ReturnType<typeof engineDouble>): McpDataBridge {
  return createStdioDataBridge({
    engine: engine as unknown as IDataEngine,
    metadataService: metadataDouble(),
    resolvePrincipal: async () => ({ userId: 'u1' }) as unknown as ExecutionContext,
  });
}

/** What the runtime's `run_action` gate throws for an author-gated action. */
function runtimeGateRefusal(): Error {
  return Object.assign(
    new Error(
      "Action 'archive_note' on 'dlc_note' declares ai.requiresConfirmation: true — nothing was run. "
        + "Confirm with the human in the loop, then retry this call with 'confirm': true on the request.",
    ),
    {
      code: 'ACTION_CONFIRMATION_REQUIRED',
      status: 428,
      details: { actionName: 'archive_note', objectName: OBJECT, confirmationMember: AI_ACTION_CONFIRMATION_MEMBER },
    },
  );
}

let nextId = 1;
async function rpc(bridge: McpDataBridge, method: string, params?: Record<string, unknown>) {
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
  const json = (await res.json()) as { result?: any; error?: unknown };
  expect(json.error, JSON.stringify(json.error)).toBeUndefined();
  return json.result;
}

async function callTool(bridge: McpDataBridge, name: string, args: Record<string, unknown>) {
  return (await rpc(bridge, 'tools/call', { name, arguments: args })) as {
    content: Array<{ text: string }>;
    isError?: boolean;
  };
}

const envelopeOf = (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0]!.text) as { error: any };

describe('MCP delete_record refuses a call without confirm: true (ACTION_CONFIRMATION_REQUIRED)', () => {
  let rows: Map<string, Record<string, unknown>>;
  let engine: ReturnType<typeof engineDouble>;
  let bridge: McpDataBridge;

  beforeEach(() => {
    rows = new Map([['n1', { id: 'n1', title: 'keep me' }]]);
    engine = engineDouble(rows);
    bridge = stdioBridge(engine);
  });

  it('advertises the confirmation member on the tool schema, so a model can discover the retry', async () => {
    const listed = await rpc(bridge, 'tools/list');
    const tool = (listed.tools as any[]).find((t) => t.name === 'delete_record');
    expect(tool, 'delete_record is registered').toBeDefined();
    const props = tool.inputSchema.properties;
    // Control: the members that were already there are still advertised.
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['objectName', 'recordId']));
    expect(props[AI_ACTION_CONFIRMATION_MEMBER]?.type).toBe('boolean');
    // Optional in the schema: a call without it must reach the handler, which
    // answers the coded refusal. Required there, it would be refused as a bare
    // input-validation error naming no code and no retry.
    expect(tool.inputSchema.required ?? []).not.toContain(AI_ACTION_CONFIRMATION_MEMBER);
    // The description tells the agent the order: ask the human, then retry.
    expect(tool.description).toContain('confirm: true');
    expect(tool.description).toMatch(/ask the human/i);
    expect(tool.annotations?.destructiveHint).toBe(true);
  });

  it('refuses a call without the member: code, status and the retry details; the record is intact', async () => {
    const result = await callTool(bridge, 'delete_record', { objectName: OBJECT, recordId: 'n1' });

    expect(result.isError).toBe(true);
    const { error } = envelopeOf(result);
    expect(error.code).toBe('ACTION_CONFIRMATION_REQUIRED');
    expect(error.status).toBe(428);
    expect(error.details).toEqual({
      actionName: 'delete_record',
      objectName: OBJECT,
      confirmationMember: AI_ACTION_CONFIRMATION_MEMBER,
    });
    expect(String(error.message)).toContain('nothing was deleted');

    // Nothing was deleted: the engine was never asked, and the row is there.
    expect(engine.delete).not.toHaveBeenCalled();
    expect(rows.get('n1')).toEqual({ id: 'n1', title: 'keep me' });
  });

  it.each([
    ['false', false],
    ['the string "true"', 'true'],
    ['1', 1],
  ])('refuses %s as the member: only the boolean true attests, and the record is intact', async (_label, value) => {
    const result = await callTool(bridge, 'delete_record', {
      objectName: OBJECT,
      recordId: 'n1',
      [AI_ACTION_CONFIRMATION_MEMBER]: value,
    });

    expect(result.isError).toBe(true);
    expect(engine.delete).not.toHaveBeenCalled();
    expect(rows.has('n1')).toBe(true);
  });

  it('deletes on the retry with confirm: true, once', async () => {
    const result = await callTool(bridge, 'delete_record', {
      objectName: OBJECT,
      recordId: 'n1',
      [AI_ACTION_CONFIRMATION_MEMBER]: true,
    });

    expect(result.isError, result.content[0]?.text).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toEqual({ object: OBJECT, id: 'n1', success: true });
    expect(engine.delete).toHaveBeenCalledTimes(1);
    expect(rows.has('n1')).toBe(false);
  });

  it('answers with run_action\'s refusal shape: the same code, status, envelope keys and details keys', async () => {
    const actionBridge: McpDataBridge & McpActionBridge = {
      ...bridge,
      async listActions() {
        return [{ name: 'archive_note', objectName: OBJECT, requiresRecord: true, requiresConfirmation: true }];
      },
      async runAction() {
        throw runtimeGateRefusal();
      },
    };

    const viaAction = envelopeOf(await callTool(actionBridge, 'run_action', { actionName: 'archive_note', objectName: OBJECT, recordId: 'n1' })).error;
    const viaDelete = envelopeOf(await callTool(actionBridge, 'delete_record', { objectName: OBJECT, recordId: 'n1' })).error;

    // Lit control: the run_action half really is the gate's refusal.
    expect(viaAction.code).toBe('ACTION_CONFIRMATION_REQUIRED');

    expect(viaDelete.code).toBe(viaAction.code);
    expect(viaDelete.status).toBe(viaAction.status);
    expect(Object.keys(viaDelete)).toEqual(Object.keys(viaAction));
    expect(Object.keys(viaDelete.details).sort()).toEqual(Object.keys(viaAction.details).sort());
    expect(viaDelete.details.confirmationMember).toBe(viaAction.details.confirmationMember);
    expect(viaDelete.details.objectName).toBe(viaAction.details.objectName);
    expect(rows.has('n1')).toBe(true);
  });

  it('control: update_record is not gated, and writes without the member', async () => {
    const result = await callTool(bridge, 'update_record', { objectName: OBJECT, recordId: 'n1', data: { title: 'changed' } });

    expect(result.isError, result.content[0]?.text).toBeFalsy();
    expect(engine.update).toHaveBeenCalledTimes(1);
    expect(rows.get('n1')).toMatchObject({ title: 'changed' });
  });

  it('the long-lived server the stdio transport serves gates the same way', async () => {
    const runtime = new MCPServerRuntime({ name: 'pin-stdio', version: '0.0.0' });
    runtime.bridgeDataTools(bridge);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await runtime.server.connect(serverTransport);
    const client = new Client({ name: 'pin-client', version: '0.0.0' });
    await client.connect(clientTransport);
    try {
      const refused: any = await client.callTool({ name: 'delete_record', arguments: { objectName: OBJECT, recordId: 'n1' } });
      expect(refused.isError).toBe(true);
      const { error } = JSON.parse(refused.content[0].text);
      expect(error.code).toBe('ACTION_CONFIRMATION_REQUIRED');
      expect(error.status).toBe(428);
      expect(error.details).toEqual({ actionName: 'delete_record', objectName: OBJECT, confirmationMember: AI_ACTION_CONFIRMATION_MEMBER });
      expect(rows.has('n1')).toBe(true);

      const confirmed: any = await client.callTool({
        name: 'delete_record',
        arguments: { objectName: OBJECT, recordId: 'n1', [AI_ACTION_CONFIRMATION_MEMBER]: true },
      });
      expect(confirmed.isError, confirmed.content?.[0]?.text).toBeFalsy();
      expect(rows.has('n1')).toBe(false);
    } finally {
      await client.close();
    }
  });
});
