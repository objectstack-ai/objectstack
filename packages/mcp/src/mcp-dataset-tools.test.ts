// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0149 D2] `list_datasets` and `query_dataset` on MCP.
 *
 * Pinned here over a fake bridge (the catalogue, the matcher, the executor and
 * the four-face parity live with the service-analytics executor): the pair
 * registers only on a bridge that carries all three dataset members, and only
 * for a grant that admits `data:read`; each tool's description is the one the
 * bridge's definitions carry, never a copy in this package; the arguments reach
 * the bridge as sent, with the tool's page cap beside them; an undeclared key is
 * refused before the bridge is asked, in the spec's words; a refusal the bridge
 * throws comes back as the coded tool error.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LIST_DATASETS_TOOL_NAME,
  MCP_OAUTH_SCOPE_DATA_READ,
  MCP_OAUTH_SCOPE_DATA_WRITE,
  QUERY_DATASET_TOOL_NAME,
  type ListDatasetsOutput,
  type QueryDatasetOutput,
} from '@objectstack/spec/ai';
import { MCPServerRuntime } from './mcp-server-runtime.js';
import { hasDatasetTools, type McpDataBridge } from './mcp-http-tools.js';
import { createStdioDataBridge, type StdioDatasetToolsService } from './stdio-data-bridge.js';
import { renderSkillMarkdown } from './skill-md.js';

const DATASET_TOOLS = [LIST_DATASETS_TOOL_NAME, QUERY_DATASET_TOOL_NAME].sort();

/** Stand-ins for the service-analytics definitions: distinctive, so a copy anywhere else cannot match by accident. */
const DEFINITIONS = [
  { name: LIST_DATASETS_TOOL_NAME, description: 'DEFINED-BY-EXECUTOR list: one hit wins; several, ask; none, fall back.' },
  { name: QUERY_DATASET_TOOL_NAME, description: 'DEFINED-BY-EXECUTOR query: cite the provenance block.' },
];

const CATALOGUE: ListDatasetsOutput = {
  datasets: [
    {
      name: 'sales_analysis',
      label: 'Sales analysis',
      object: 'crm_opportunity',
      dimensions: [{ name: 'stage', label: 'Stage', type: 'string' }],
      measures: [{ name: 'revenue', label: 'Revenue', aggregate: 'sum', synonyms: ['营收'] }],
      matches: [{ term: '营收', member: 'measures.revenue', matchedOn: 'synonym' }],
    },
  ],
};

const ANSWER: QueryDatasetOutput = {
  rows: [{ stage: 'won', revenue: 42 }],
  fields: [
    { name: 'stage', label: 'Stage', type: 'string' },
    { name: 'revenue', label: 'Revenue', type: 'number' },
  ],
  provenance: {
    kind: 'dataset',
    dataset: { name: 'sales_analysis', label: 'Sales analysis' },
    measures: [{ name: 'revenue', label: 'Revenue' }],
    dimensions: [{ name: 'stage', label: 'Stage' }],
  },
  rowCount: 1,
  truncated: false,
} as QueryDatasetOutput;

type Call = [string, ...unknown[]];
type DatasetMember = 'listDatasets' | 'queryDataset' | 'datasetToolDefinitions';

function makeBridge(
  without: readonly DatasetMember[] = [],
  definitions: ReadonlyArray<{ name: string; description: string }> = DEFINITIONS,
): McpDataBridge & { calls: Call[] } {
  const calls: Call[] = [];
  const bridge: McpDataBridge & { calls: Call[] } = {
    calls,
    async listObjects() { return []; },
    async describeObject() { return null; },
    async query() { return { records: [] }; },
    async get() { return null; },
    async create() { return {}; },
    async update() { return {}; },
    async remove() { return {}; },
    async listDatasets(input) {
      calls.push(['listDatasets', input]);
      return CATALOGUE;
    },
    async queryDataset(input, opts) {
      calls.push(['queryDataset', input, opts]);
      if (input.datasetName === 'hidden_dataset') {
        throw Object.assign(new Error('Dataset "hidden_dataset" not found'), { code: 'NOT_FOUND', status: 404 });
      }
      return ANSWER;
    },
    datasetToolDefinitions() {
      calls.push(['datasetToolDefinitions']);
      return definitions;
    },
  };
  for (const member of without) delete bridge[member];
  return bridge;
}

async function rpc(
  runtime: MCPServerRuntime,
  bridge: unknown,
  body: unknown,
  toolOptions?: { grantedScopes?: string[]; maxQueryLimit?: number },
) {
  const req = new Request('http://localhost/api/v1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const res = await runtime.handleHttpRequest(req, {
    bridge: bridge as McpDataBridge,
    parsedBody: body,
    ...(toolOptions ? { toolOptions } : {}),
  });
  return (await res.json()) as any;
}

async function listTools(runtime: MCPServerRuntime, bridge: unknown, grantedScopes?: string[]) {
  const json = await rpc(runtime, bridge, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, grantedScopes ? { grantedScopes } : undefined);
  return (json.result?.tools ?? []) as Array<{ name: string; description?: string; inputSchema?: any; annotations?: any }>;
}

const namesOf = (tools: Array<{ name: string }>) => tools.map((t) => t.name);
const datasetToolsIn = (tools: Array<{ name: string }>) => namesOf(tools).filter((n) => DATASET_TOOLS.includes(n)).sort();

async function callTool(
  runtime: MCPServerRuntime,
  bridge: unknown,
  name: string,
  args: Record<string, unknown>,
  toolOptions?: { grantedScopes?: string[]; maxQueryLimit?: number },
) {
  const json = await rpc(runtime, bridge, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }, toolOptions);
  return json as { result?: { content: Array<{ type: 'text'; text: string }>; isError?: boolean }; error?: { code: number; message: string } };
}

describe('[ADR-0149 D2] dataset tools on MCP — registration', () => {
  let runtime: MCPServerRuntime;
  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
  });

  it('a bridge carrying all three members registers both tools, read-only, for an unscoped caller', async () => {
    const tools = await listTools(runtime, makeBridge());
    expect(datasetToolsIn(tools)).toEqual(DATASET_TOOLS);
    for (const name of DATASET_TOOLS) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });

  it('each description is the one the bridge definitions carry, verbatim', async () => {
    const tools = await listTools(runtime, makeBridge());
    for (const def of DEFINITIONS) {
      expect(tools.find((t) => t.name === def.name)?.description).toBe(def.description);
    }
  });

  it('the input schemas are the spec declarations, closed against undeclared keys', async () => {
    const tools = await listTools(runtime, makeBridge());
    const list = tools.find((t) => t.name === LIST_DATASETS_TOOL_NAME)!;
    const query = tools.find((t) => t.name === QUERY_DATASET_TOOL_NAME)!;
    expect(Object.keys(list.inputSchema.properties)).toEqual(['terms']);
    expect(list.inputSchema.additionalProperties).toBe(false);
    expect(Object.keys(query.inputSchema.properties).sort()).toEqual(['datasetName', 'selection']);
    expect(query.inputSchema.required).toEqual(expect.arrayContaining(['datasetName', 'selection']));
    expect(query.inputSchema.additionalProperties).toBe(false);
  });

  it.each([
    [['listDatasets']],
    [['queryDataset']],
    [['datasetToolDefinitions']],
    [['listDatasets', 'queryDataset', 'datasetToolDefinitions']],
  ] as Array<[DatasetMember[]]>)('a bridge without %j registers no dataset tool, and the rest of the surface is unchanged', async (without) => {
    const full = namesOf(await listTools(runtime, makeBridge()));
    const partial = namesOf(await listTools(new MCPServerRuntime({ name: 't', version: '1.0.0' }), makeBridge(without)));
    expect(datasetToolsIn(partial.map((name) => ({ name })))).toEqual([]);
    expect(partial.sort()).toEqual(full.filter((n) => !DATASET_TOOLS.includes(n)).sort());
  });

  it('a tool the definitions do not describe is not registered', async () => {
    const tools = await listTools(runtime, makeBridge([], [DEFINITIONS[1]]));
    expect(datasetToolsIn(tools)).toEqual([QUERY_DATASET_TOOL_NAME]);
  });

  it('data:read admits both tools', async () => {
    const tools = await listTools(runtime, makeBridge(), [MCP_OAUTH_SCOPE_DATA_READ]);
    expect(datasetToolsIn(tools)).toEqual(DATASET_TOOLS);
  });

  it('a grant without data:read registers neither, and a call gets the unknown-tool refusal without reaching the bridge', async () => {
    const bridge = makeBridge();
    const tools = await listTools(runtime, bridge, [MCP_OAUTH_SCOPE_DATA_WRITE]);
    expect(datasetToolsIn(tools)).toEqual([]);
    // The same answer a read tool outside the grant gets (`query_records`).
    for (const name of [QUERY_DATASET_TOOL_NAME, 'query_records']) {
      const json = await callTool(
        new MCPServerRuntime({ name: 't', version: '1.0.0' }),
        bridge,
        name,
        name === 'query_records' ? { objectName: 'crm_opportunity' } : { datasetName: 'sales_analysis', selection: { measures: ['revenue'] } },
        { grantedScopes: [MCP_OAUTH_SCOPE_DATA_WRITE] },
      );
      const refused = Boolean(json.error) || json.result?.isError === true;
      expect(refused, name).toBe(true);
      const text = json.error?.message ?? json.result?.content[0]?.text ?? '';
      expect(text, name).toMatch(new RegExp(`Tool ${name} not found`));
    }
    expect(bridge.calls.filter((c) => c[0] === 'listDatasets' || c[0] === 'queryDataset')).toEqual([]);
  });
});

describe('[ADR-0149 D2] dataset tools on MCP — calls', () => {
  let runtime: MCPServerRuntime;
  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
  });

  it('list_datasets hands the terms to the bridge and answers its catalogue', async () => {
    const bridge = makeBridge();
    const json = await callTool(runtime, bridge, LIST_DATASETS_TOOL_NAME, { terms: ['营收'] });
    expect(json.result?.isError).toBeFalsy();
    expect(JSON.parse(json.result!.content[0].text)).toEqual(CATALOGUE);
    expect(bridge.calls.filter((c) => c[0] === 'listDatasets')).toEqual([['listDatasets', { terms: ['营收'] }]]);
  });

  it('query_dataset hands the input to the bridge with the default page cap, and answers rows plus provenance', async () => {
    const bridge = makeBridge();
    const input = { datasetName: 'sales_analysis', selection: { measures: ['revenue'], dimensions: ['stage'] } };
    const json = await callTool(runtime, bridge, QUERY_DATASET_TOOL_NAME, input);
    expect(json.result?.isError).toBeFalsy();
    expect(JSON.parse(json.result!.content[0].text)).toEqual(ANSWER);
    const [call] = bridge.calls.filter((c) => c[0] === 'queryDataset');
    expect(call[1]).toMatchObject(input);
    expect(call[2]).toEqual({ maxRows: 50 });
  });

  it('query_dataset carries the host page cap (maxQueryLimit), the one query_records uses', async () => {
    const bridge = makeBridge();
    await callTool(runtime, bridge, QUERY_DATASET_TOOL_NAME, { datasetName: 'sales_analysis', selection: { measures: ['revenue'] } }, { maxQueryLimit: 7 });
    expect(bridge.calls.find((c) => c[0] === 'queryDataset')?.[2]).toEqual({ maxRows: 7 });
  });

  it('an undeclared key is refused before the bridge is asked, naming the key to send', async () => {
    const bridge = makeBridge();
    const json = await callTool(runtime, bridge, QUERY_DATASET_TOOL_NAME, {
      dataset: 'sales_analysis',
      selection: { measures: ['revenue'] },
    });
    const text = json.error?.message ?? json.result?.content[0]?.text ?? '';
    expect(Boolean(json.error) || json.result?.isError === true).toBe(true);
    expect(text).toContain('datasetName');
    expect(bridge.calls.filter((c) => c[0] === 'queryDataset')).toEqual([]);
  });

  it('a refusal the bridge throws comes back as the coded tool error', async () => {
    const bridge = makeBridge();
    const json = await callTool(runtime, bridge, QUERY_DATASET_TOOL_NAME, {
      datasetName: 'hidden_dataset',
      selection: { measures: ['revenue'] },
    });
    expect(json.result?.isError).toBe(true);
    const envelope = JSON.parse(json.result!.content[0].text);
    expect(envelope.error).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('[ADR-0149 D3] the SKILL.md teaches the selection rule where the pair registers', () => {
  it('renders both tools and the rule for a host whose bridge carries them', () => {
    const md = renderSkillMarkdown({ datasetTools: true });
    for (const name of DATASET_TOOLS) expect(md).toContain(`**${name}(`);
    expect(md).toContain('Choosing between a metric and an object query');
  });

  it('renders them for a data:read grant, and not without one or without the pair', () => {
    expect(renderSkillMarkdown({ datasetTools: true, grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ] })).toContain('list_datasets');
    expect(renderSkillMarkdown({ datasetTools: true, grantedScopes: [MCP_OAUTH_SCOPE_DATA_WRITE] })).not.toContain('list_datasets');
    expect(renderSkillMarkdown({})).not.toContain('list_datasets');
  });
});

describe('[ADR-0149 D2] the stdio bridge\'s dataset members', () => {
  const PRINCIPAL = { userId: 'u_key', tenantId: 'org_1' };
  const SAVED = [{ name: 'sales_analysis', object: 'crm_opportunity' }];

  function stdioHarness(protocolItems: unknown[] | undefined) {
    const bound: any[] = [];
    const executor = {
      definitions: DEFINITIONS,
      listDatasets: vi.fn(async () => CATALOGUE),
      queryDataset: vi.fn(async () => ANSWER),
    };
    const service: StdioDatasetToolsService = { datasetTools: vi.fn((d) => { bound.push(d); return executor; }) };
    const metadataService = { list: vi.fn(async () => SAVED) } as any;
    const protocol = protocolItems === undefined
      ? undefined
      : () => ({ getMetaItems: vi.fn(async () => ({ items: protocolItems })) });
    const deps = {
      engine: {} as any,
      metadataService,
      ...(protocol ? { protocol } : {}),
      resolvePrincipal: async () => PRINCIPAL as any,
    };
    return { deps, service, executor, bound, metadataService };
  }

  it('a bridge built without the analytics executor carries no dataset member', () => {
    const { deps } = stdioHarness([]);
    const bridge = createStdioDataBridge(deps);
    expect(hasDatasetTools(bridge)).toBe(false);
    expect(bridge.listDatasets).toBeUndefined();
  });

  it('runs both tools as the stdio principal, with the page cap, over the merged dataset read', async () => {
    const { deps, service, executor, bound } = stdioHarness(SAVED);
    const bridge = createStdioDataBridge({ ...deps, datasetTools: service });
    expect(hasDatasetTools(bridge)).toBe(true);
    expect(bridge.datasetToolDefinitions!()).toBe(DEFINITIONS);
    await bridge.listDatasets!({ terms: ['营收'] });
    expect(executor.listDatasets).toHaveBeenCalledWith({ terms: ['营收'] }, PRINCIPAL);
    const input = { datasetName: 'sales_analysis', selection: { measures: ['revenue'] } };
    await bridge.queryDataset!(input, { maxRows: 9 });
    expect(executor.queryDataset).toHaveBeenCalledWith(input, PRINCIPAL);
    expect(bound.at(-1).maxQueryLimit).toBe(9);
    expect(await bound[0].loadDatasets(PRINCIPAL)).toEqual(SAVED);
  });

  it('reads the metadata service on a host with no merged read', async () => {
    const { deps, service, bound, metadataService } = stdioHarness(undefined);
    createStdioDataBridge({ ...deps, datasetTools: service }).datasetToolDefinitions!();
    expect(await bound[0].loadDatasets(PRINCIPAL)).toEqual(SAVED);
    expect(metadataService.list).toHaveBeenCalledWith('dataset');
  });
});
