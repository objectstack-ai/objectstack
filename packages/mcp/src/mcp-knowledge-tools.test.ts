// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0149 D2] `search_knowledge` on MCP, over a fake bridge (the executor —
 * `aiExposed` and the row-level re-check — is pinned with the knowledge
 * service, in `service-knowledge`'s `knowledge-tools.test.ts`).
 *
 * Pinned here: the tool registers only on a bridge carrying both knowledge
 * members, and only for a grant that admits `data:read`; its description and
 * argument schema are the ones the bridge's definition carries, never a copy
 * in this package; the arguments reach the bridge as sent, an undeclared one
 * is refused before the bridge is asked, and a refusal the bridge throws comes
 * back as the coded tool error; a skill binding `search_knowledge` is listed
 * in `prompts/list` where the tool is served and withheld, with a debug line
 * naming the tool, where it is not; and the stdio bridge runs each call as the
 * principal it resolves for that call.
 */

import { describe, it, expect, vi } from 'vitest';
import { MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_DATA_WRITE } from '@objectstack/spec/ai';
import { MCPServerRuntime } from './mcp-server-runtime.js';
import { SEARCH_KNOWLEDGE_TOOL_NAME, type McpDataBridge } from './mcp-http-tools.js';
import type { McpSkillBridge } from './skill-prompts.js';
import { createStdioDataBridge, type StdioKnowledgeToolsService } from './stdio-data-bridge.js';

/** A stand-in for the knowledge service's definition: distinctive, so a copy anywhere else cannot match by accident. */
const DEFINITION = {
  name: SEARCH_KNOWLEDGE_TOOL_NAME,
  description: 'DEFINED-BY-EXECUTOR search: cite the passages you used.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1 },
      sourceIds: { type: 'array', items: { type: 'string' } },
      topK: { type: 'integer', minimum: 1, maximum: 20 },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

const ANSWER = {
  hits: [{ sourceId: 'policy_clauses', documentId: 'policy_clauses:p1', snippet: 'Refunds within 30 days.', score: 0.9 }],
  sources: [{ id: 'policy_clauses', label: 'Policy clauses' }],
};

type KnowledgeMember = 'searchKnowledge' | 'knowledgeToolDefinitions';

function makeBridge(without: readonly KnowledgeMember[] = []): McpDataBridge & McpSkillBridge & { calls: unknown[]; skills: unknown[] } {
  const calls: unknown[] = [];
  const bridge: McpDataBridge & McpSkillBridge & { calls: unknown[]; skills: unknown[] } = {
    calls,
    skills: [],
    async listObjects() { return []; },
    async describeObject() { return null; },
    async query() { return { records: [] }; },
    async get() { return null; },
    async create() { return {}; },
    async update() { return {}; },
    async remove() { return {}; },
    async listSkills() { return bridge.skills; },
    async searchKnowledge(input) {
      calls.push(input);
      if ((input.sourceIds as string[] | undefined)?.includes('staff_notes')) {
        throw Object.assign(new Error('No knowledge source this tool may search is named "staff_notes".'), {
          code: 'NOT_FOUND',
          status: 404,
        });
      }
      return ANSWER;
    },
    knowledgeToolDefinitions() {
      return [DEFINITION];
    },
  };
  for (const member of without) delete bridge[member];
  return bridge;
}

async function rpc(
  bridge: unknown,
  body: Record<string, unknown>,
  grantedScopes?: string[],
  logger?: { debug: (m: string) => void },
) {
  const runtime = new MCPServerRuntime({
    name: 't',
    version: '1.0.0',
    ...(logger ? { logger: { debug: logger.debug, info: () => {}, warn: () => {}, error: () => {} } as never } : {}),
  });
  const req = new Request('http://localhost/api/v1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const res = await runtime.handleHttpRequest(req, {
    bridge: bridge as McpDataBridge,
    parsedBody: body,
    ...(grantedScopes ? { toolOptions: { grantedScopes } } : {}),
  });
  return (await res.json()) as any;
}

async function listTools(bridge: unknown, grantedScopes?: string[]) {
  const json = await rpc(bridge, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, grantedScopes);
  return (json.result?.tools ?? []) as Array<{ name: string; description?: string; inputSchema?: any; annotations?: any }>;
}

async function callTool(bridge: unknown, args: Record<string, unknown>, grantedScopes?: string[]) {
  return rpc(
    bridge,
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: SEARCH_KNOWLEDGE_TOOL_NAME, arguments: args } },
    grantedScopes,
  ) as Promise<{ result?: { content: Array<{ text: string }>; isError?: boolean }; error?: { message: string } }>;
}

const knowledgeTool = (tools: Array<{ name: string }>) => tools.find((t) => t.name === SEARCH_KNOWLEDGE_TOOL_NAME);

describe('[ADR-0149 D2] search_knowledge on MCP — registration', () => {
  it('a bridge carrying both members registers it, read-only, under the definition\'s description and schema', async () => {
    const tool = knowledgeTool(await listTools(makeBridge()));
    expect(tool?.description).toBe(DEFINITION.description);
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(Object.keys(tool!.inputSchema.properties).sort()).toEqual(['query', 'sourceIds', 'topK']);
    expect(tool!.inputSchema.required).toEqual(['query']);
    expect(tool!.inputSchema.additionalProperties).toBe(false);
  });

  it('data:read admits it', async () => {
    expect(knowledgeTool(await listTools(makeBridge(), [MCP_OAUTH_SCOPE_DATA_READ]))).toBeDefined();
  });

  it('a grant without data:read does not register it, and a call is refused without reaching the bridge', async () => {
    const bridge = makeBridge();
    expect(knowledgeTool(await listTools(bridge, [MCP_OAUTH_SCOPE_DATA_WRITE]))).toBeUndefined();
    const json = await callTool(bridge, { query: 'refund' }, [MCP_OAUTH_SCOPE_DATA_WRITE]);
    const text = json.error?.message ?? json.result?.content[0]?.text ?? '';
    expect(text).toMatch(new RegExp(`Tool ${SEARCH_KNOWLEDGE_TOOL_NAME} not found`));
    expect(bridge.calls).toEqual([]);
  });

  it.each([[['searchKnowledge']], [['knowledgeToolDefinitions']]] as Array<[KnowledgeMember[]]>)(
    'a bridge without %j (no knowledge service) registers no knowledge tool, and the rest of the surface is unchanged',
    async (without) => {
      const full = (await listTools(makeBridge())).map((t) => t.name);
      const partial = (await listTools(makeBridge(without))).map((t) => t.name);
      expect(partial).not.toContain(SEARCH_KNOWLEDGE_TOOL_NAME);
      expect(partial.sort()).toEqual(full.filter((n) => n !== SEARCH_KNOWLEDGE_TOOL_NAME).sort());
    },
  );
});

describe('[ADR-0149 D2] search_knowledge on MCP — calls', () => {
  it('hands the arguments to the bridge as sent and answers what it answered', async () => {
    const bridge = makeBridge();
    const json = await callTool(bridge, { query: 'refund window', sourceIds: ['policy_clauses'], topK: 3 });
    expect(json.result?.isError).toBeFalsy();
    expect(JSON.parse(json.result!.content[0].text)).toEqual(ANSWER);
    expect(bridge.calls).toEqual([{ query: 'refund window', sourceIds: ['policy_clauses'], topK: 3 }]);
  });

  it('refuses an undeclared argument before the bridge is asked', async () => {
    const bridge = makeBridge();
    const json = await callTool(bridge, { query: 'refund', sources: ['policy_clauses'] });
    expect(Boolean(json.error) || json.result?.isError === true).toBe(true);
    expect(bridge.calls).toEqual([]);
  });

  it('a refusal the bridge throws comes back as the coded tool error', async () => {
    const json = await callTool(makeBridge(), { query: 'q', sourceIds: ['staff_notes'] });
    expect(json.result?.isError).toBe(true);
    const body = JSON.parse(json.result!.content[0].text);
    expect(body.error).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('[ADR-0149 D2] a skill binding search_knowledge on prompts/list', () => {
  const SKILL = {
    name: 'policy_inquiry',
    instructions: 'Search the policy clauses, cite the clause, escalate when nothing applies.',
    tools: ['search_knowledge', 'query_records', 'get_record'],
  };

  it('is listed where the knowledge tool is served', async () => {
    const bridge = makeBridge();
    bridge.skills = [SKILL];
    const json = await rpc(bridge, { jsonrpc: '2.0', id: 1, method: 'prompts/list' });
    expect(json.result.prompts.map((p: { name: string }) => p.name)).toEqual(['policy_inquiry']);
  });

  it('is withheld where it is not, and the withholding is said at debug, naming the skill and the tool', async () => {
    const bridge = makeBridge(['searchKnowledge', 'knowledgeToolDefinitions']);
    bridge.skills = [SKILL];
    const debug = vi.fn();
    const json = await rpc(bridge, { jsonrpc: '2.0', id: 1, method: 'prompts/list' }, undefined, { debug });
    expect(json.result.prompts).toEqual([]);
    const lines = debug.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('is not offered on this connection'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"policy_inquiry"');
    expect(lines[0]).toContain('"search_knowledge"');
    // Only the tool this connection lacks is named.
    expect(lines[0]).not.toContain('"query_records"');
  });
});

describe('[ADR-0149 D2] search_knowledge on the stdio bridge', () => {
  it('carries both members only where the host hands the knowledge executor over, and runs each call as the principal', async () => {
    const principal = { userId: 'u_key_owner', isSystem: false };
    const searchKnowledge = vi.fn(async () => ANSWER);
    const service: StdioKnowledgeToolsService = {
      knowledgeTools: () => ({ definitions: [DEFINITION], searchKnowledge }),
    };
    const base = {
      engine: {} as never,
      metadataService: { list: async () => [], getObject: async () => undefined } as never,
      resolvePrincipal: async () => principal as never,
    };
    const without = createStdioDataBridge(base);
    expect(without.searchKnowledge).toBeUndefined();
    expect(without.knowledgeToolDefinitions).toBeUndefined();

    const bridge = createStdioDataBridge({ ...base, knowledgeTools: service });
    expect(bridge.knowledgeToolDefinitions!()).toEqual([DEFINITION]);
    expect(await bridge.searchKnowledge!({ query: 'refund' })).toBe(ANSWER);
    expect(searchKnowledge).toHaveBeenCalledWith({ query: 'refund' }, principal);
  });
});
