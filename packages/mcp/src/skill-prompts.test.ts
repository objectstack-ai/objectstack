// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import {
  MCP_OAUTH_SCOPE_ACTIONS,
  MCP_OAUTH_SCOPE_DATA_READ,
  MCP_OAUTH_SCOPE_DATA_WRITE,
  MCP_OAUTH_SCOPE_METADATA_WRITE,
} from '@objectstack/spec/ai';
import type { AIToolDefinition } from '@objectstack/spec/contracts';
import { PLATFORM_TOOL_FAMILY_PREFIXES } from '@objectstack/spec/system';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import { lookupSkillPrompt, projectSkillPrompt, skillBindingServed, TOOL_FAMILY_DOORS } from './skill-prompts.js';
import type { McpDataBridge, McpActionBridge } from './mcp-http-tools.js';
import type { McpSkillBridge } from './skill-prompts.js';
import type { McpAuthoringInjection } from './types.js';

/**
 * `skill` metadata → MCP `prompts` primitive (#3905).
 *
 * Driven through the REAL wire path — a JSON-RPC `prompts/list` / `prompts/get`
 * round-trip against `MCPServerRuntime.handleHttpRequest` — so the assertions
 * pin what an MCP client actually receives, not an internal helper's return
 * value. That matters here: the defect being closed is precisely a surface that
 * validated and linted while no client could ever reach it.
 */

/**
 * Minimal object + action bridge; the skill half is layered per test. The
 * action half is what serves `run_action`, the door of the `action_<name>`
 * tools {@link CASE_SKILL} binds (#32767: a skill is offered only where its
 * bound tools are served).
 */
function makeDataBridge(): McpDataBridge & Partial<McpActionBridge> {
  return {
    async listActions() {
      return [];
    },
    async runAction() {
      return {};
    },
    async listObjects() {
      return [];
    },
    async describeObject() {
      return null;
    },
    async query() {
      return { records: [] };
    },
    async get() {
      return null;
    },
    async create() {
      return {};
    },
    async update() {
      return {};
    },
    async remove() {
      return {};
    },
  };
}

function withSkills(rows: unknown[]): McpDataBridge & McpSkillBridge {
  return { ...makeDataBridge(), listSkills: async () => rows };
}

/** [#32767] The token's grant and the host's authoring family, when a test serves less (or more) than every native tool. */
interface RpcConnection {
  grantedScopes?: string[];
  authoring?: McpAuthoringInjection;
}

async function rpc(
  bridge: McpDataBridge & Partial<McpSkillBridge>,
  method: string,
  params?: Record<string, unknown>,
  connection: RpcConnection = {},
): Promise<any> {
  const runtime = new MCPServerRuntime({ name: 'skill-prompts', version: '0.0.0' });
  const body = { jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) };
  const res = await runtime.handleHttpRequest(
    new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
    }),
    {
      bridge,
      parsedBody: body,
      ...(connection.grantedScopes ? { toolOptions: { grantedScopes: connection.grantedScopes } } : {}),
      ...(connection.authoring ? { authoring: connection.authoring } : {}),
    },
  );
  return await res.json();
}

const CASE_SKILL = {
  name: 'case_management',
  label: 'Case Management',
  description: 'Handles support case lifecycle',
  surface: 'ask',
  instructions: 'Triage the case, then resolve it with the caller confirmed.',
  tools: ['action_resolve_case'],
  active: true,
};

describe('skill metadata → MCP prompts (HTTP transport)', () => {
  it('lists an authored skill that carries instructions', async () => {
    const json = await rpc(withSkills([CASE_SKILL]), 'prompts/list');

    expect(json.error).toBeUndefined();
    expect(json.result.prompts).toEqual([
      {
        name: 'case_management',
        title: 'Case Management',
        description: 'Handles support case lifecycle',
      },
    ]);
  });

  it('serves the skill instructions on prompts/get', async () => {
    const json = await rpc(withSkills([CASE_SKILL]), 'prompts/get', { name: 'case_management' });

    expect(json.error).toBeUndefined();
    expect(json.result).toEqual({
      description: 'Handles support case lifecycle',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'Triage the case, then resolve it with the caller confirmed.',
          },
        },
      ],
    });
  });

  it('declares the prompts capability when the bridge can read skills', async () => {
    const json = await rpc(withSkills([]), 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    });

    expect(json.result.capabilities.prompts).toBeDefined();
  });

  it('returns an EMPTY list — not an error — when no skill is authored', async () => {
    const json = await rpc(withSkills([]), 'prompts/list');

    expect(json.error).toBeUndefined();
    expect(json.result.prompts).toEqual([]);
  });

  it('does not project a skill without instructions', async () => {
    const json = await rpc(
      withSkills([{ name: 'toolbox', label: 'Toolbox', tools: ['query_records'] }, CASE_SKILL]),
      'prompts/list',
    );

    expect(json.result.prompts.map((p: any) => p.name)).toEqual(['case_management']);
  });

  it('does not project an inactive skill', async () => {
    const json = await rpc(withSkills([{ ...CASE_SKILL, active: false }]), 'prompts/list');

    expect(json.result.prompts).toEqual([]);
  });

  it('rejects prompts/get for a name that is not a projected skill (-32602)', async () => {
    const json = await rpc(withSkills([CASE_SKILL]), 'prompts/get', { name: 'no_such_skill' });

    expect(json.result).toBeUndefined();
    expect(json.error.code).toBe(-32602);
    expect(json.error.message).toContain('no_such_skill');
  });

  it('declares NO prompts capability when the host cannot read skill metadata', async () => {
    // Graceful degradation, the same contract the action tools follow: a host
    // that does not implement the seam advertises nothing rather than serving
    // an empty capability.
    const json = await rpc(makeDataBridge(), 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    });

    expect(json.result.capabilities.prompts).toBeUndefined();
  });

  it('still serves the object tools alongside the prompt surface', async () => {
    const json = await rpc(withSkills([CASE_SKILL]), 'tools/list');

    expect(json.result.tools.map((t: any) => t.name)).toContain('query_records');
  });
});

describe('projectSkillPrompt', () => {
  it('keeps the skill name, label and description', () => {
    expect(projectSkillPrompt(CASE_SKILL)).toEqual({
      // [ADR-0150 D6] An environment skill's face is its bare name.
      face: 'case_management',
      name: 'case_management',
      title: 'Case Management',
      description: 'Handles support case lifecycle',
      instructions: 'Triage the case, then resolve it with the caller confirmed.',
    });
  });

  it('drops the tool-binding half — it is cloud-runtime-only', () => {
    const projected = projectSkillPrompt(CASE_SKILL) as Record<string, unknown>;
    expect(projected.tools).toBeUndefined();
    expect(projected.surface).toBeUndefined();
  });

  it('returns null for blank instructions and for non-records', () => {
    expect(projectSkillPrompt({ ...CASE_SKILL, instructions: '   ' })).toBeNull();
    expect(projectSkillPrompt({ ...CASE_SKILL, name: '' })).toBeNull();
    expect(projectSkillPrompt(null)).toBeNull();
    expect(projectSkillPrompt(['skill'])).toBeNull();
  });
});

/**
 * [ADR-0150 D5/D6] Two installed packages each ship a skill of one name. The
 * prompt list names each by its face (`NS-NAME`, spec's `deriveAiFaceName`);
 * `prompts/get` takes the face, and the bare name only while one holder has
 * it; a bare name two packages hold, and a face two skills derive, are refused
 * naming every candidate. Driven through the HTTP wire path above.
 */
describe('skill prompts are named by their AI face (ADR-0150 D6)', () => {
  const NAMESPACES: Record<string, string> = { 'com.acme.crm': 'crm', 'com.acme.hr': 'hr' };
  const packageNamespace = (packageId: string) => NAMESPACES[packageId];
  const QUALIFY = (packageId: string, instructions: string) => ({
    name: 'qualify_lead', label: 'Qualify', instructions, _packageId: packageId,
  });
  const twoHolders = (): McpDataBridge & McpSkillBridge => ({
    ...withSkills([QUALIFY('com.acme.crm', 'CRM playbook.'), QUALIFY('com.acme.hr', 'HR playbook.')]),
    packageNamespace,
  });
  const text = (json: any) => json.result?.messages?.[0]?.content?.text;

  it('lists both holders, each under its NS-NAME face; neither is dropped', async () => {
    const json = await rpc(twoHolders(), 'prompts/list');
    expect(json.error).toBeUndefined();
    expect(json.result.prompts.map((p: any) => p.name)).toEqual(['crm-qualify_lead', 'hr-qualify_lead']);
  });

  it('a face gets its one skill', async () => {
    expect(text(await rpc(twoHolders(), 'prompts/get', { name: 'crm-qualify_lead' }))).toBe('CRM playbook.');
    expect(text(await rpc(twoHolders(), 'prompts/get', { name: 'hr-qualify_lead' }))).toBe('HR playbook.');
  });

  it('the bare name two packages hold is refused, naming both packages and both faces', async () => {
    const json = await rpc(twoHolders(), 'prompts/get', { name: 'qualify_lead' });
    expect(json.result).toBeUndefined();
    expect(json.error.code).toBe(-32602);
    expect(json.error.data).toEqual({
      code: 'RESOURCE_CONFLICT', status: 409, candidates: ['crm-qualify_lead', 'hr-qualify_lead'],
    });
    expect(json.error.message).toContain('"com.acme.crm"');
    expect(json.error.message).toContain('"com.acme.hr"');
  });

  it('CONTROL: a bare name one package holds still gets that skill, as before faces were derived', async () => {
    const bridge = { ...withSkills([QUALIFY('com.acme.crm', 'CRM playbook.')]), packageNamespace };
    const list = await rpc(bridge, 'prompts/list');
    expect(list.result.prompts.map((p: any) => p.name)).toEqual(['crm-qualify_lead']);
    expect(text(await rpc(bridge, 'prompts/get', { name: 'qualify_lead' }))).toBe('CRM playbook.');
  });

  it('CONTROL: an environment skill keeps its bare name and is reached ahead of a package holder', async () => {
    const bridge = {
      ...withSkills([QUALIFY('com.acme.crm', 'CRM playbook.'), { name: 'qualify_lead', instructions: 'Ours.' }]),
      packageNamespace,
    };
    const list = await rpc(bridge, 'prompts/list');
    expect(list.result.prompts.map((p: any) => p.name)).toEqual(['crm-qualify_lead', 'qualify_lead']);
    expect(text(await rpc(bridge, 'prompts/get', { name: 'qualify_lead' }))).toBe('Ours.');
  });

  it('a face two skills derive is listed ONCE, as the refusal its get answers, naming both', async () => {
    // Two packages of a shareable namespace (ADR-0150 D2) both holding `x`.
    const bridge = {
      ...withSkills([
        { name: 'x', instructions: 'one', _packageId: 'com.base.a' },
        { name: 'x', instructions: 'two', _packageId: 'com.base.b' },
      ]),
      packageNamespace: () => 'base',
    };
    const list = await rpc(bridge, 'prompts/list');
    expect(list.result.prompts).toHaveLength(1);
    expect(list.result.prompts[0].name).toBe('base-x');
    expect(list.result.prompts[0].description).toContain('"com.base.a"');
    expect(list.result.prompts[0].description).toContain('"com.base.b"');
    const get = await rpc(bridge, 'prompts/get', { name: 'base-x' });
    expect(get.result).toBeUndefined();
    expect(get.error.data).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
  });

  it('a face past 64 characters is spec\'s cut form', () => {
    const name = 'a'.repeat(70);
    const found = lookupSkillPrompt(
      [projectSkillPrompt({ name, instructions: 'i', _packageId: 'p' }, () => 'crm')!],
      name,
    );
    expect(found.status).toBe('found');
    const face = found.status === 'found' ? found.prompt.face : '';
    expect(face).toHaveLength(64);
    expect(face.startsWith(`crm-${'a'.repeat(51)}-`)).toBe(true);
  });
});

/**
 * [#32767] A skill's instructions teach the model to call the tools it binds,
 * so a connection is offered a skill only when it serves every one of them. A
 * `data:read` token was offered `metadata_authoring` and eight more skills
 * naming tools its own `tools/list` never listed. Driven through the HTTP wire
 * path above, with the grant and the host's authoring family the hosted
 * platform injects.
 */
describe('a skill is offered only where the connection serves the tools it binds (#32767)', () => {
  const AUTHORING_TOOLS: AIToolDefinition[] = [
    { name: 'create_object', description: 'Create a draft object.', parameters: { type: 'object', properties: {} } },
    { name: 'verify_build', description: 'Validate the drafts.', parameters: { type: 'object', properties: {} } },
  ];
  const authoring: McpAuthoringInjection = {
    registry: {
      getAll: () => AUTHORING_TOOLS,
      async execute() {
        throw new Error('not called by these pins');
      },
    },
    principal: { userId: 'usr_1', organizationId: 'org_1', clientId: 'claude-code', scopes: [] },
    environmentId: 'env_1',
  };
  const DATA_ONLY: RpcConnection = { grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ], authoring };
  const FULL: RpcConnection = {
    grantedScopes: [
      MCP_OAUTH_SCOPE_DATA_READ,
      MCP_OAUTH_SCOPE_DATA_WRITE,
      MCP_OAUTH_SCOPE_ACTIONS,
      MCP_OAUTH_SCOPE_METADATA_WRITE,
    ],
    authoring,
  };

  const skill = (name: string, tools?: string[]) => ({
    name,
    instructions: `The ${name} playbook.`,
    ...(tools ? { tools } : {}),
  });
  const SKILLS = [
    skill('metadata_authoring', ['create_object', 'verify_build']),
    skill('record_lookup', ['query_records', 'get_record']),
    skill('half_served', ['query_records', 'create_record']),
    skill('schema_reader', ['describe_*']),
    skill('object_drafting', ['create_*', 'verify_build']),
    skill('case_resolution', ['action_resolve_case']),
    skill('free_text'),
  ];
  const ALL_NAMES = SKILLS.map((s) => s.name);

  const listed = async (connection: RpcConnection): Promise<string[]> => {
    const json = await rpc(withSkills(SKILLS), 'prompts/list', undefined, connection);
    expect(json.error).toBeUndefined();
    return json.result.prompts.map((p: any) => p.name);
  };
  const servedTools = async (connection: RpcConnection): Promise<string[]> => {
    const json = await rpc(withSkills(SKILLS), 'tools/list', undefined, connection);
    return json.result.tools.map((t: any) => t.name);
  };

  it('a data-only connection lists no skill naming a tool it does not serve', async () => {
    expect(await listed(DATA_ONLY)).toEqual(['record_lookup', 'schema_reader', 'free_text']);

    // The rule itself, read against the connection's own tools/list: every
    // plain tool a listed skill binds is a tool this connection lists.
    const served = new Set(await servedTools(DATA_ONLY));
    expect(served.has('create_object')).toBe(false);
    for (const name of await listed(DATA_ONLY)) {
      const bound = (SKILLS.find((s) => s.name === name)!.tools ?? []).filter((t) => !t.endsWith('*'));
      for (const tool of bound) expect(served.has(tool)).toBe(true);
    }
  });

  it('CONTROL: a connection that serves every bound tool still lists every skill', async () => {
    const served = await servedTools(FULL);
    expect(served).toEqual(expect.arrayContaining(['create_object', 'verify_build', 'create_record', 'run_action']));
    expect(await listed(FULL)).toEqual(ALL_NAMES);
  });

  it('prompts/get answers a withheld skill exactly as it answers an unknown name', async () => {
    const withheld = await rpc(withSkills(SKILLS), 'prompts/get', { name: 'metadata_authoring' }, DATA_ONLY);
    const unknown = await rpc(withSkills(SKILLS), 'prompts/get', { name: 'no_such_skill' }, DATA_ONLY);
    expect(withheld.result).toBeUndefined();
    expect(withheld.error.code).toBe(-32602);
    expect(withheld.error.data).toBeUndefined();
    expect(withheld.error.message).toBe(unknown.error.message.replace('no_such_skill', 'metadata_authoring'));
  });

  it('CONTROL: the same get serves the skill on a connection that serves its tools', async () => {
    const json = await rpc(withSkills(SKILLS), 'prompts/get', { name: 'metadata_authoring' }, FULL);
    expect(json.error).toBeUndefined();
    expect(json.result.messages[0].content.text).toBe('The metadata_authoring playbook.');
  });

  it('an action binding is served by run_action, the door the MCP server serves actions through', () => {
    const binding = { tools: ['action_resolve_case', 'action_*'] };
    expect(skillBindingServed(binding, new Set(['run_action']))).toBe(true);
    expect(skillBindingServed(binding, new Set(['list_actions', 'query_records']))).toBe(false);
  });

  it('a family member a host server lists by name is served by that tool, without the family door', () => {
    expect(skillBindingServed({ tools: ['action_resolve_case'] }, new Set(['action_resolve_case']))).toBe(true);
    expect(skillBindingServed({ tools: ['action_*'] }, new Set(['action_resolve_case']))).toBe(true);
    expect(skillBindingServed({ tools: ['action_resolve_case'] }, new Set(['action_close_case']))).toBe(false);
  });

  it('every platform tool family the spec declares has its MCP door here', () => {
    const doors = new Set(TOOL_FAMILY_DOORS.map(([prefix]) => prefix));
    for (const prefix of PLATFORM_TOOL_FAMILY_PREFIXES) expect(doors.has(prefix)).toBe(true);
  });

  it('a trailing wildcard is served by any tool it matches; a skill binding nothing is always served', () => {
    expect(skillBindingServed({ tools: ['describe_*'] }, new Set(['describe_object']))).toBe(true);
    expect(skillBindingServed({ tools: ['describe_*'] }, new Set(['query_records']))).toBe(false);
    expect(skillBindingServed({ tools: [] }, new Set())).toBe(true);
    expect(skillBindingServed({ name: 'free_text' }, new Set())).toBe(true);
  });
});

/**
 * [#34167] The binding test above answers whether a connection CAN run a
 * playbook; it cannot answer whether the playbook is written for MCP. A skill
 * can bind tools MCP serves under the same names and still teach the
 * in-product agent loop (its tools, its approval card). Its owner opts it out
 * with `mcpPrompt: false`: never listed, unknown to `prompts/get`, on every
 * connection, whatever its binding. Driven through both doors that project
 * skills: the per-request HTTP server (`registerSkillPrompts`) and the
 * long-lived stdio server (`MCPServerRuntime.bridgePrompts`).
 */
describe('a skill its owner declares in-product only is never an MCP prompt (#34167)', () => {
  // The card's measured rows: one binds two tools the data door serves by
  // name, the other the `action_` family `run_action` serves.
  const RECORD_WRITING = {
    name: 'record_writing',
    label: 'Record Writing',
    instructions: 'Open the record with open_record, then the user confirms on a card.',
    tools: ['create_record', 'update_record'],
  };
  const ACTIONS_EXECUTOR = {
    name: 'actions_executor',
    label: 'Actions Executor',
    instructions: 'Call the action_ tools; fall back on the confirm card.',
    tools: ['action_*'],
  };
  const inProductOnly = <T extends object>(skill: T) => ({ ...skill, mcpPrompt: false });

  const DATA_WRITE: RpcConnection = { grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_DATA_WRITE] };
  const ACTIONS: RpcConnection = { grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_ACTIONS] };
  const EVERY: RpcConnection = {
    grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_DATA_WRITE, MCP_OAUTH_SCOPE_ACTIONS],
  };

  const listed = async (rows: unknown[], connection: RpcConnection): Promise<string[]> => {
    const json = await rpc(withSkills(rows), 'prompts/list', undefined, connection);
    expect(json.error).toBeUndefined();
    return json.result.prompts.map((p: any) => p.name);
  };
  const servedTools = async (connection: RpcConnection): Promise<string[]> => {
    const json = await rpc(withSkills([]), 'tools/list', undefined, connection);
    return json.result.tools.map((t: any) => t.name);
  };

  it('CONTROL (the card\'s reproduction): undeclared, both rows pass the binding test and are listed', async () => {
    expect(await servedTools(DATA_WRITE)).toEqual(expect.arrayContaining(['create_record', 'update_record']));
    expect(await servedTools(ACTIONS)).toContain('run_action');
    expect(await listed([RECORD_WRITING], DATA_WRITE)).toEqual(['record_writing']);
    expect(await listed([ACTIONS_EXECUTOR], ACTIONS)).toEqual(['actions_executor']);
  });

  it('declared in-product only, record_writing is not listed on a data:write connection that serves both its tools', async () => {
    expect(await listed([inProductOnly(RECORD_WRITING)], DATA_WRITE)).toEqual([]);
    expect(await listed([inProductOnly(RECORD_WRITING)], EVERY)).toEqual([]);
  });

  it('declared in-product only, actions_executor is not listed on a connection that serves run_action', async () => {
    expect(await listed([inProductOnly(ACTIONS_EXECUTOR)], ACTIONS)).toEqual([]);
    expect(await listed([inProductOnly(ACTIONS_EXECUTOR)], EVERY)).toEqual([]);
  });

  it('prompts/get answers a declared skill exactly as it answers an unknown name', async () => {
    const rows = [inProductOnly(RECORD_WRITING)];
    const declared = await rpc(withSkills(rows), 'prompts/get', { name: 'record_writing' }, EVERY);
    const unknown = await rpc(withSkills(rows), 'prompts/get', { name: 'no_such_skill' }, EVERY);
    expect(declared.result).toBeUndefined();
    expect(declared.error.code).toBe(-32602);
    expect(declared.error.data).toBeUndefined();
    expect(declared.error.message).toBe(unknown.error.message.replace('no_such_skill', 'record_writing'));
  });

  it('CONTROL: mcpPrompt true projects exactly as an undeclared skill, beside a declared one', async () => {
    const rows = [{ ...RECORD_WRITING, mcpPrompt: true }, inProductOnly(ACTIONS_EXECUTOR), { ...ACTIONS_EXECUTOR, name: 'mcp_actions' }];
    expect(await listed(rows, EVERY)).toEqual(['record_writing', 'mcp_actions']);
    const json = await rpc(withSkills(rows), 'prompts/get', { name: 'record_writing' }, EVERY);
    expect(json.result.messages[0].content.text).toBe(RECORD_WRITING.instructions);
    expect(projectSkillPrompt(inProductOnly(RECORD_WRITING))).toBeNull();
    expect(projectSkillPrompt({ ...RECORD_WRITING, mcpPrompt: true })).toEqual(projectSkillPrompt(RECORD_WRITING));
  });

  describe('the long-lived stdio server (bridgePrompts), which applies no binding filter', () => {
    // Its binding names a tool no MCP family serves, so a hidden skill here
    // cannot be the binding filter's doing: bridgePrompts has none.
    const OPEN_RECORD = {
      name: 'record_opening',
      label: 'Record Opening',
      instructions: 'Call open_record and wait for the card.',
      tools: ['open_record'],
    };

    // `store.rows` is what the metadata service answers NOW: a test swaps it
    // after boot to model a skill saved while the server runs.
    const stdioPrompts = async (rows: unknown[], store: { rows: unknown[] } = { rows }) => {
      const metadataService = { list: async (type: string) => (type === 'skill' ? store.rows : []) };
      const runtime = new MCPServerRuntime({ name: 'skill-prompts-stdio', version: '0.0.0' });
      await runtime.bridgePrompts(metadataService as never);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'test-client', version: '0.0.0' });
      await Promise.all([runtime.server.connect(serverTransport), client.connect(clientTransport)]);
      return {
        client,
        names: (await client.listPrompts()).prompts.map((p) => p.name),
        close: async () => {
          await client.close();
          await runtime.stop().catch(() => {});
        },
      };
    };

    it('CONTROL: undeclared, a skill binding a tool nothing serves is still listed and got', async () => {
      const stdio = await stdioPrompts([OPEN_RECORD]);
      expect(stdio.names).toEqual(['record_opening']);
      const got = await stdio.client.getPrompt({ name: 'record_opening' });
      expect(got.messages[0].content).toEqual({ type: 'text', text: OPEN_RECORD.instructions });
      await stdio.close();
    });

    it('a skill saved in-product only while the server runs is answered as unknown at once', async () => {
      const sibling = { ...OPEN_RECORD, name: 'mcp_opening' };
      const store = { rows: [OPEN_RECORD, sibling] as unknown[] };
      const stdio = await stdioPrompts(store.rows, store);
      expect(stdio.names).toEqual(['record_opening', 'mcp_opening']);

      store.rows = [inProductOnly(OPEN_RECORD), sibling];
      const optedOut = await stdio.client.getPrompt({ name: 'record_opening' }).catch((e) => e);
      const unknown = await stdio.client.getPrompt({ name: 'no_such_skill' }).catch((e) => e);
      expect(optedOut.code).toBe(-32602);
      expect(optedOut.message).toBe(unknown.message.replace('no_such_skill', 'record_opening'));
      // The sibling still serves; the list is the boot snapshot until restart.
      expect((await stdio.client.getPrompt({ name: 'mcp_opening' })).messages).toHaveLength(1);
      await stdio.close();
    });

    it('CONTROL: a skill gone from the store since boot is still served from the snapshot, as before', async () => {
      const store = { rows: [OPEN_RECORD] as unknown[] };
      const stdio = await stdioPrompts(store.rows, store);
      store.rows = [];
      const got = await stdio.client.getPrompt({ name: 'record_opening' });
      expect(got.messages[0].content).toEqual({ type: 'text', text: OPEN_RECORD.instructions });
      await stdio.close();
    });

    it('declared in-product only, the same skill is neither listed nor got', async () => {
      // An undeclared sibling keeps the prompt surface up: the SDK declares no
      // prompts capability on a server that registers no prompt at all.
      const stdio = await stdioPrompts([
        inProductOnly(OPEN_RECORD),
        inProductOnly(RECORD_WRITING),
        { ...OPEN_RECORD, name: 'mcp_opening' },
      ]);
      expect(stdio.names).toEqual(['mcp_opening']);
      await expect(stdio.client.getPrompt({ name: 'record_opening' })).rejects.toMatchObject({ code: -32602 });
      await stdio.close();
    });
  });
});
