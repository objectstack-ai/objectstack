// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35442] The door's app-docs pair and the answer-order rule.
 *
 * - `search_package_docs` / `read_package_doc` register only where the bridge
 *   carries both doc members and the grant admits `data:read` (the read
 *   family's gate); each hands its call to the bridge member unchanged, under
 *   the stated cap, and relays a member's coded refusal with its code.
 * - The HTTP `initialize` instructions carry the answer-order rule exactly where
 *   `tools/list` lists both doc tools, and the rule names only tools the
 *   connection lists: the definition reader the authoring registry registers
 *   for the grant, else none, and then it says the configuration was not
 *   checked. Host and configured texts stay whole.
 *
 * What the members read and whom they show it to (the `/meta/doc`
 * docs-audience gate, the search, the console address) is pinned in
 * `@objectstack/runtime`'s `mcp-package-docs.test.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MCP_OAUTH_SCOPE_DATA_READ,
  MCP_OAUTH_SCOPE_DATA_WRITE,
  MCP_OAUTH_SCOPE_METADATA_WRITE,
} from '@objectstack/spec/ai';
import { MCPServerRuntime } from './mcp-server-runtime.js';
import {
  PACKAGE_DOC_SEARCH_MAX_RESULTS,
  READ_PACKAGE_DOC_MAX_CHARS,
  READ_PACKAGE_DOC_TOOL_NAME,
  SEARCH_PACKAGE_DOCS_TOOL_NAME,
  type McpDataBridge,
} from './mcp-http-tools.js';
import type { McpAuthoringInjection } from './types.js';

const DOC_TOOLS = [READ_PACKAGE_DOC_TOOL_NAME, SEARCH_PACKAGE_DOCS_TOOL_NAME].sort();

type DocMember = 'searchPackageDocs' | 'readPackageDoc';

interface DocBridge extends McpDataBridge {
  calls: unknown[][];
  page?: unknown;
  fail?: unknown;
}

function makeBridge(without: readonly DocMember[] = []): DocBridge {
  const bridge: DocBridge = {
    calls: [],
    async listObjects() { return []; },
    async describeObject() { return null; },
    async query() { return { records: [] }; },
    async get() { return null; },
    async create() { return {}; },
    async update() { return {}; },
    async remove() { return {}; },
    async searchPackageDocs(input, opts) {
      bridge.calls.push(['searchPackageDocs', input, opts]);
      if (bridge.fail) throw bridge.fail;
      return { terms: input.terms, results: [], truncated: false };
    },
    async readPackageDoc(input) {
      bridge.calls.push(['readPackageDoc', input]);
      if (bridge.fail) throw bridge.fail;
      return (bridge.page ?? { name: input.name, title: 'T', content: 'body' }) as never;
    },
  };
  for (const member of without) delete bridge[member];
  return bridge;
}

interface Opts {
  grantedScopes?: string[];
  authoring?: Partial<McpAuthoringInjection>;
  /** Tool names the authoring registry lists. */
  authoringTools?: string[];
}

async function rpc(runtime: MCPServerRuntime, bridge: McpDataBridge, body: unknown, o: Opts = {}) {
  const res = await runtime.handleHttpRequest(
    new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }),
    {
      bridge,
      parsedBody: body,
      ...(o.grantedScopes ? { toolOptions: { grantedScopes: o.grantedScopes } } : {}),
      ...(o.authoring || o.authoringTools
        ? {
            authoring: {
              registry: {
                getAll: () => (o.authoringTools ?? []).map((name) => ({ name, description: name, parameters: { type: 'object', properties: {} } })),
                execute: async () => ({}) as never,
              },
              principal: { userId: 'usr_1', scopes: o.grantedScopes ?? [] },
              ...o.authoring,
            } as McpAuthoringInjection,
          }
        : {}),
    },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as any;
}

async function instructionsOf(runtime: MCPServerRuntime, bridge: McpDataBridge, o: Opts = {}): Promise<string> {
  const json = await rpc(runtime, bridge, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pin', version: '0' } },
  }, o);
  expect(json.error).toBeUndefined();
  return json.result.instructions as string;
}

async function toolNames(runtime: MCPServerRuntime, bridge: McpDataBridge, o: Opts = {}): Promise<string[]> {
  const json = await rpc(runtime, bridge, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, o);
  return ((json.result?.tools ?? []) as Array<{ name: string }>).map((t) => t.name);
}

async function callTool(runtime: MCPServerRuntime, bridge: McpDataBridge, name: string, args: unknown) {
  const json = await rpc(runtime, bridge, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } });
  return json.result as { content: Array<{ type: string; text: string }>; isError?: boolean };
}

const docToolsOf = (names: string[]) => names.filter((n) => DOC_TOOLS.includes(n)).sort();
/** The rule's own opening, which no other open-server sentence carries. */
const RULE_OPENING = 'read their manuals before you answer';

describe('[#35442] the app-docs pair registers where the bridge carries both members and the grant reads', () => {
  let runtime: MCPServerRuntime;
  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
  });

  it('lists both for an API key / session and for a data:read token', async () => {
    for (const o of [{}, { grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ] }] as Opts[]) {
      expect(docToolsOf(await toolNames(runtime, makeBridge(), o))).toEqual(DOC_TOOLS);
    }
  });

  it('lists neither for a grant without data:read, nor on a bridge missing either member', async () => {
    for (const grantedScopes of [[MCP_OAUTH_SCOPE_DATA_WRITE], [MCP_OAUTH_SCOPE_METADATA_WRITE]]) {
      expect(docToolsOf(await toolNames(runtime, makeBridge(), { grantedScopes }))).toEqual([]);
    }
    for (const without of [['searchPackageDocs'], ['readPackageDoc']] as DocMember[][]) {
      const names = await toolNames(runtime, makeBridge(without));
      expect(names, 'control: the object tools still register').toContain('query_records');
      expect(docToolsOf(names)).toEqual([]);
    }
  });

  it('search hands the terms to the bridge under the stated cap, and the description states the match rule and cap', async () => {
    const bridge = makeBridge();
    const json = await rpc(runtime, bridge, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const description: string = json.result.tools.find((t: any) => t.name === SEARCH_PACKAGE_DOCS_TOOL_NAME).description;
    expect(description).toContain(`at most ${PACKAGE_DOC_SEARCH_MAX_RESULTS}`);
    expect(description).toContain('title, a heading or its text contains a term');

    const result = await callTool(runtime, bridge, SEARCH_PACKAGE_DOCS_TOOL_NAME, { terms: ['回款'], package: 'crm' });
    expect(result.isError).toBeUndefined();
    expect(bridge.calls).toEqual([['searchPackageDocs', { terms: ['回款'], package: 'crm' }, { maxResults: PACKAGE_DOC_SEARCH_MAX_RESULTS }]]);
  });

  it('search refuses a query string in place of terms before the bridge is called, naming terms', async () => {
    const bridge = makeBridge();
    const result = await callTool(runtime, bridge, SEARCH_PACKAGE_DOCS_TOOL_NAME, { query: '回款' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('terms');
    expect(bridge.calls).toEqual([]);
  });

  it('read hands name, package and locale to the bridge, and answers the page', async () => {
    const bridge = makeBridge();
    bridge.page = { name: 'order_payment', package: 'crm', title: '订单与回款', url: '/_console/apps/crm/docs/crm/order_payment', content: '# 回款' };
    const result = await callTool(runtime, bridge, READ_PACKAGE_DOC_TOOL_NAME, { name: 'order_payment', package: 'crm', locale: 'zh-CN' });
    expect(bridge.calls).toEqual([['readPackageDoc', { name: 'order_payment', package: 'crm', locale: 'zh-CN' }]]);
    expect(JSON.parse(result.content[0].text)).toEqual(bridge.page);
  });

  it('read cuts a page over the cap and says so', async () => {
    const bridge = makeBridge();
    bridge.page = { name: 'long', title: 'Long', content: 'x'.repeat(READ_PACKAGE_DOC_MAX_CHARS + 5) };
    const page = JSON.parse((await callTool(runtime, bridge, READ_PACKAGE_DOC_TOOL_NAME, { name: 'long' })).content[0].text);
    expect(page.content).toHaveLength(READ_PACKAGE_DOC_MAX_CHARS);
    expect(page.truncated).toContain(String(READ_PACKAGE_DOC_MAX_CHARS + 5));
  });

  it('a member\'s coded refusal arrives with its code and status', async () => {
    const bridge = makeBridge();
    bridge.fail = Object.assign(new Error('No manual page named \'nope\' that you can read.'), { code: 'RESOURCE_NOT_FOUND', status: 404 });
    const result = await callTool(runtime, bridge, READ_PACKAGE_DOC_TOOL_NAME, { name: 'nope' });
    expect(result.isError).toBe(true);
    const envelope = JSON.parse(result.content[0].text);
    expect(envelope.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(envelope.error.status).toBe(404);
  });
});

describe('[#35442] initialize instructions — the answer-order rule follows the doc tools', () => {
  let runtime: MCPServerRuntime;
  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
  });

  it('carries the rule where both doc tools register, and not where they do not', async () => {
    const text = await instructionsOf(runtime, makeBridge());
    expect(text).toContain(RULE_OPENING);
    expect(text).toContain(SEARCH_PACKAGE_DOCS_TOOL_NAME);
    expect(text).toContain(READ_PACKAGE_DOC_TOOL_NAME);
    for (const [bridge, o] of [
      [makeBridge(['readPackageDoc']), {}],
      [makeBridge(), { grantedScopes: [MCP_OAUTH_SCOPE_DATA_WRITE] }],
    ] as Array<[McpDataBridge, Opts]>) {
      const other = await instructionsOf(runtime, bridge, o);
      expect(other).not.toContain(RULE_OPENING);
      expect(other).not.toContain(SEARCH_PACKAGE_DOCS_TOOL_NAME);
    }
  });

  it('without a definition reader on the connection, it names none and says the configuration was not checked', async () => {
    for (const o of [{}, { grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ] }] as Opts[]) {
      const text = await instructionsOf(runtime, makeBridge(), o);
      expect(text).toContain('configured process was not checked');
      expect(text).not.toContain('describe_metadata');
      expect(text).not.toContain('get_metadata_item');
    }
  });

  it('names the definition reader the connection lists: describe_metadata first, else get_metadata_item', async () => {
    const grantedScopes = [MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_METADATA_WRITE];
    const open = await instructionsOf(runtime, makeBridge(), { grantedScopes, authoringTools: ['list_metadata_items', 'get_metadata_item'] });
    expect(open).toContain('read its real definition with get_metadata_item');
    expect(open).toContain('the definition is what runs');
    expect(open).not.toContain('was not checked');

    const both = await instructionsOf(runtime, makeBridge(), { grantedScopes, authoringTools: ['get_metadata_item', 'describe_metadata'] });
    expect(both).toContain('read its real definition with describe_metadata');

    // Control: a registry with no reader is "none listed", whatever else it lists.
    const writesOnly = await instructionsOf(runtime, makeBridge(), { grantedScopes, authoringTools: ['save_metadata_draft'] });
    expect(writesOnly).toContain('configured process was not checked');
  });

  it('a host\'s per-request text and a configured text stay whole: no rule appended', async () => {
    const HOST = 'Host text.';
    expect(
      await instructionsOf(runtime, makeBridge(), { grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ], authoring: { dataOnlyInstructions: HOST } }),
    ).toBe(HOST);
    const configured = new MCPServerRuntime({ name: 't', version: '1.0.0', instructions: 'Configured.' });
    expect(await instructionsOf(configured, makeBridge())).toBe('Configured.');
  });
});
