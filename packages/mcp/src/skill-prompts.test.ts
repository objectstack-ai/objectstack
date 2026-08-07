// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import { projectSkillPrompt } from './skill-prompts.js';
import type { McpDataBridge, McpActionBridge } from './mcp-http-tools.js';
import type { McpSkillBridge } from './skill-prompts.js';

/**
 * `skill` metadata → MCP `prompts` primitive (#3905).
 *
 * Driven through the REAL wire path — a JSON-RPC `prompts/list` / `prompts/get`
 * round-trip against `MCPServerRuntime.handleHttpRequest` — so the assertions
 * pin what an MCP client actually receives, not an internal helper's return
 * value. That matters here: the defect being closed is precisely a surface that
 * validated and linted while no client could ever reach it.
 */

/** Minimal object bridge; the skill half is layered per test. */
function makeDataBridge(): McpDataBridge & Partial<McpActionBridge> {
  return {
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

async function rpc(
  bridge: McpDataBridge & Partial<McpSkillBridge>,
  method: string,
  params?: Record<string, unknown>,
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
    { bridge, parsedBody: body },
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
