// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34686] The open server's HTTP `initialize` instructions carry the
 * metric-first selection rule (ADR-0149 D3) and the published skills install
 * line (#34659 ruling D5 = A).
 *
 * - The rule rides only where this request registers BOTH dataset tools: the
 *   same gate `registerDatasetTools` reads (`datasetToolDescriptions`), so a
 *   grant without `data:read`, a bridge without the dataset members, and a
 *   bridge that defines no description for one of the pair get no rule — each
 *   pinned beside its `tools/list` control.
 * - The install line names `@objectstack/skills` at this package's own
 *   version (one `fixed` changeset group), for every grant, and the CLI
 *   command that installs it with or without a project (#34773).
 * - Host-injected text and the runtime's configured text are whole answers
 *   their author owns: nothing is appended to either.
 */

import { createRequire } from 'node:module';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  LIST_DATASETS_TOOL_NAME,
  MCP_OAUTH_SCOPE_DATA_READ,
  MCP_OAUTH_SCOPE_DATA_WRITE,
  MCP_OAUTH_SCOPE_METADATA_WRITE,
  QUERY_DATASET_TOOL_NAME,
} from '@objectstack/spec/ai';
import { DATASET_NEXT_STEP_PRECEDENCE, getDatasetToolDefinitions } from '@objectstack/service-analytics';
import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge } from './mcp-http-tools.js';
import type { McpAuthoringInjection } from './types.js';

const OWN_VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

const DEFINITIONS = [
  { name: LIST_DATASETS_TOOL_NAME, description: 'list the governed datasets' },
  { name: QUERY_DATASET_TOOL_NAME, description: 'compute a governed metric' },
];

type DatasetMember = 'listDatasets' | 'queryDataset' | 'datasetToolDefinitions';

function makeBridge(
  without: readonly DatasetMember[] = [],
  definitions: ReadonlyArray<{ name: string; description: string }> = DEFINITIONS,
): McpDataBridge {
  const bridge: McpDataBridge = {
    async listObjects() { return []; },
    async describeObject() { return null; },
    async query() { return { records: [] }; },
    async get() { return null; },
    async create() { return {}; },
    async update() { return {}; },
    async remove() { return {}; },
    async listDatasets() { return { datasets: [] }; },
    async queryDataset() { return { rows: [], fields: [], rowCount: 0, truncated: false } as never; },
    datasetToolDefinitions() { return definitions; },
  };
  for (const member of without) delete bridge[member];
  return bridge;
}

interface Opts {
  grantedScopes?: string[];
  authoring?: Partial<McpAuthoringInjection>;
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
      ...(o.authoring
        ? {
            authoring: {
              registry: { getAll: () => [], execute: async () => ({}) as never },
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
  expect(typeof json.result.instructions).toBe('string');
  return json.result.instructions;
}

async function datasetToolsListed(runtime: MCPServerRuntime, bridge: McpDataBridge, o: Opts = {}): Promise<string[]> {
  const json = await rpc(runtime, bridge, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, o);
  return ((json.result?.tools ?? []) as Array<{ name: string }>)
    .map((t) => t.name)
    .filter((n) => n === LIST_DATASETS_TOOL_NAME || n === QUERY_DATASET_TOOL_NAME)
    .sort();
}

/** The rule names both dataset tools; neither name appears anywhere else in the open server's text. */
const carriesRule = (text: string) => text.includes(LIST_DATASETS_TOOL_NAME) && text.includes(QUERY_DATASET_TOOL_NAME);
const namesNoDatasetTool = (text: string) => !text.includes(LIST_DATASETS_TOOL_NAME) && !text.includes(QUERY_DATASET_TOOL_NAME);

describe('[#34686] initialize instructions — the selection rule follows the dataset tools', () => {
  let runtime: MCPServerRuntime;
  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
  });

  it('carries the rule where both dataset tools register: an API key / session and a data:read token', async () => {
    for (const o of [{}, { grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ] }] as Opts[]) {
      expect(await datasetToolsListed(runtime, makeBridge(), o)).toEqual([LIST_DATASETS_TOOL_NAME, QUERY_DATASET_TOOL_NAME].sort());
      expect(carriesRule(await instructionsOf(runtime, makeBridge(), o))).toBe(true);
    }
  });

  it('a grant without data:read gets neither dataset sentence (and lists neither tool)', async () => {
    for (const grantedScopes of [[MCP_OAUTH_SCOPE_DATA_WRITE], [MCP_OAUTH_SCOPE_METADATA_WRITE]]) {
      expect(await datasetToolsListed(runtime, makeBridge(), { grantedScopes })).toEqual([]);
      expect(namesNoDatasetTool(await instructionsOf(runtime, makeBridge(), { grantedScopes }))).toBe(true);
    }
  });

  it('a bridge without the dataset pair gets no rule, whatever the grant', async () => {
    for (const without of [['listDatasets'], ['queryDataset'], ['datasetToolDefinitions']] as DatasetMember[][]) {
      expect(await datasetToolsListed(runtime, makeBridge(without))).toEqual([]);
      expect(namesNoDatasetTool(await instructionsOf(runtime, makeBridge(without)))).toBe(true);
    }
  });

  it('a bridge that registers only one of the pair gets no rule: the rule names both', async () => {
    const listOnly = makeBridge([], DEFINITIONS.filter((d) => d.name === LIST_DATASETS_TOOL_NAME));
    expect(await datasetToolsListed(runtime, listOnly)).toEqual([LIST_DATASETS_TOOL_NAME]);
    expect(namesNoDatasetTool(await instructionsOf(runtime, listOnly))).toBe(true);
  });
});

describe('[#34686] initialize instructions — the skills install line', () => {
  let runtime: MCPServerRuntime;
  beforeEach(() => {
    // The operator's serverInfo.version is not the skills version: a distinct value proves which one is read.
    runtime = new MCPServerRuntime({ name: 't', version: '0.0.1-operator' });
  });

  it('names @objectstack/skills at this package\'s own version, for every grant', async () => {
    expect(OWN_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    for (const o of [{}, { grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ] }, { grantedScopes: [MCP_OAUTH_SCOPE_DATA_WRITE] }] as Opts[]) {
      const text = await instructionsOf(runtime, makeBridge(), o);
      expect(text).toContain(`Published skills: @objectstack/skills ${OWN_VERSION}`);
      expect(text).not.toContain('0.0.1-operator');
    }
  });

  // [#34773] The install is the CLI's own command, at that version, which needs
  // no project: a client that only connected over MCP can follow it in an empty
  // directory. The npx form is for a machine without the CLI installed.
  it('names `os skills install --version` at that version, and no project-only install', async () => {
    const text = await instructionsOf(runtime, makeBridge());
    expect(text).toContain(`os skills install --version ${OWN_VERSION}`);
    expect(text).toContain(`npx -p @objectstack/cli@${OWN_VERSION} os skills install --version ${OWN_VERSION}`);
    expect(text).not.toContain('pnpm add');
  });
});

describe('[#34686] initialize instructions — host and configured texts are left whole', () => {
  const HOST = 'Host text for a connection that can build.';
  const DATA_ONLY = 'Host text for a connection that cannot build.';
  const CONFIGURED = 'Configured server-wide instructions.';

  it('the host\'s per-request texts answer exactly as injected, with no rule or install line appended', async () => {
    const runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
    expect(
      await instructionsOf(runtime, makeBridge(), {
        grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_METADATA_WRITE],
        authoring: { instructions: HOST },
      }),
    ).toBe(HOST);
    expect(
      await instructionsOf(runtime, makeBridge(), {
        grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ],
        authoring: { dataOnlyInstructions: DATA_ONLY },
      }),
    ).toBe(DATA_ONLY);
  });

  it('a runtime configured with instructions answers them exactly, dataset tools served or not', async () => {
    const runtime = new MCPServerRuntime({ name: 't', version: '1.0.0', instructions: CONFIGURED });
    expect(await datasetToolsListed(runtime, makeBridge())).toHaveLength(2);
    expect(await instructionsOf(runtime, makeBridge())).toBe(CONFIGURED);
  });
});

describe('[#34766] initialize instructions — the drafts line follows the authoring tools', () => {
  const DRAFTS = 'They save drafts only';
  const ONE_TOOL = { getAll: () => [{ name: 'save_metadata_draft', description: 'Save a draft.' }], execute: async () => ({}) as never };

  it('a metadata:write request whose host registry lists a tool is told authoring lands as drafts a person publishes', async () => {
    const runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
    const text = await instructionsOf(runtime, makeBridge(), {
      grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_METADATA_WRITE],
      authoring: { registry: ONE_TOOL as never },
    });
    expect(text).toContain(DRAFTS);
    // The rest of the open text is still there.
    expect(carriesRule(text)).toBe(true);
    expect(text).toContain('@objectstack/skills');
  });

  it('no drafts line where no authoring tool registers: an empty registry, a grant without metadata:write, no injection', async () => {
    const runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
    const cases: Opts[] = [
      { grantedScopes: [MCP_OAUTH_SCOPE_METADATA_WRITE], authoring: {} },
      { grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ], authoring: { registry: ONE_TOOL as never } },
      {},
    ];
    for (const o of cases) expect(await instructionsOf(runtime, makeBridge(), o), JSON.stringify(o)).not.toContain(DRAFTS);
  });
});

/**
 * [#34919] The rule tells the client to follow `list_datasets`' `nextStep`
 * and cite `query_dataset`'s `sourceLine`, and names the precedence among
 * mixed cases in the order the service-analytics executor applies it (its
 * exported constant, so a reorder there reds here).
 */
describe('[#34919] initialize instructions — follow nextStep, cite sourceLine', () => {
  it('names both members and the executor\'s precedence, in its order', async () => {
    const runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
    const text = await instructionsOf(runtime, makeBridge());
    expect(text).toContain('nextStep');
    expect(text).toContain('sourceLine');
    expect(text).toContain(DATASET_NEXT_STEP_PRECEDENCE.join(', '));
  });
});

/**
 * [#35005] The ask-back is owed only for a word with a measure among its
 * candidates; a word whose candidates are all dimensions is at most a possible
 * grouping. The rule states it in the same words as `list_datasets`' own
 * description (the real one, read from the executor's package), so the two
 * doors cannot drift apart.
 */
describe('[#35005] initialize instructions — the ask-back is scoped in the same words as list_datasets', () => {
  const SCOPED =
    'A word whose candidates are all dimensions is at most a possible grouping: never ask about it, and it never '
    + 'stops a matched measure.';

  it('both doors carry the scoped sentence, and the question names a measure among the candidates', async () => {
    const runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
    const text = await instructionsOf(runtime, makeBridge());
    const list = getDatasetToolDefinitions().find((d) => d.name === LIST_DATASETS_TOOL_NAME)!;
    expect(text).toContain(SCOPED);
    expect(list.description).toContain(SCOPED);
    expect(text).toContain('A word with no match and a measure among its candidates in the answer: ask the same way');
    // The unscoped form is gone from both doors.
    expect(text).not.toContain('A word with no match but with candidates in the answer');
    expect(list.description).not.toContain('possible readings: ask the same way');
  });
});
