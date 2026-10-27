// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  MCP_OAUTH_SCOPE_DATA_READ,
  MCP_OAUTH_SCOPE_DATA_WRITE,
  MCP_OAUTH_SCOPE_ACTIONS,
  MCP_OAUTH_SCOPE_METADATA_WRITE,
} from '@objectstack/spec/ai';
import type { AIToolDefinition } from '@objectstack/spec/contracts';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge, McpActionBridge } from './mcp-http-tools.js';
import type { McpAuthoringToolRegistry, ToolExecutionResult } from './types.js';
import { renderSkillMarkdown } from './skill-md.js';

/**
 * Drift guard: the generated SKILL.md must document every native tool the
 * HTTP MCP surface actually registers.
 *
 * The gap this guards against is real: the action tools (#2307) shipped with
 * doc updates, but `skill.ts` was written later against the CRUD set only and
 * silently documented 7 of 9 tools (fixed in #2715). The skill is the single
 * source every distribution shell copies (ADR-0036 Amendment C), so an
 * undocumented tool here means every agent installing the skill never learns
 * the tool exists.
 *
 * "Skill" here is the `SKILL.md` distributable (`skill-md.ts`), NOT the `skill`
 * metadata type — those are projected onto MCP prompts (`skill-prompts.ts`).
 *
 * The registered surface is obtained by driving the REAL registration path —
 * a `tools/list` round-trip against `MCPServerRuntime` with a full
 * data+action bridge — not from a hand-maintained name list, so adding a new
 * tool to `mcp-http-tools.ts` without teaching the skill turns this red.
 */

/** Minimal full-surface bridge: object + action methods present, all stubbed. */
function makeFullBridge(): McpDataBridge & McpActionBridge {
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
    async listActions() {
      return [];
    },
    async runAction() {
      return {};
    },
    // [#15705] Optional on the bridge, and present here so `resume_run` is on
    // the surface this guard reads: a full host implements it.
    async resumeRun() {
      return {};
    },
  };
}

/**
 * [#26464] A host-injected authoring registry, as the HTTP surface receives
 * one. Names deliberately NOT in the data skill, so the only way the rendered
 * skill can name them is the authoring section.
 */
const AUTHORING_TOOLS: AIToolDefinition[] = [
  { name: 'create_object', description: 'Create a draft object.', parameters: { type: 'object', properties: {} } },
  { name: 'verify_build', description: 'Validate the drafts.', parameters: { type: 'object', properties: {} } },
];

function makeAuthoringRegistry(): McpAuthoringToolRegistry {
  return {
    getAll: () => AUTHORING_TOOLS,
    async execute(toolCall): Promise<ToolExecutionResult> {
      return { type: 'tool-result', toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, output: { type: 'text', value: '' } } as ToolExecutionResult;
    },
  };
}

const EVERY_SCOPE = [
  MCP_OAUTH_SCOPE_DATA_READ,
  MCP_OAUTH_SCOPE_DATA_WRITE,
  MCP_OAUTH_SCOPE_ACTIONS,
  MCP_OAUTH_SCOPE_METADATA_WRITE,
];

async function listRegisteredToolNames(
  extra: { grantedScopes?: string[]; registry?: McpAuthoringToolRegistry } = {},
): Promise<string[]> {
  const runtime = new MCPServerRuntime({ name: 'skill-guard', version: '0.0.0' });
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
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
      bridge: makeFullBridge(),
      parsedBody: body,
      ...(extra.grantedScopes ? { toolOptions: { grantedScopes: extra.grantedScopes } } : {}),
      ...(extra.registry
        ? { authoring: { registry: extra.registry, principal: { userId: 'usr_guard' }, environmentId: 'env_guard' } }
        : {}),
    },
  );
  const json: any = await res.json();
  const tools: Array<{ name: string }> = json?.result?.tools ?? [];
  return tools.map((t) => t.name);
}

describe('SKILL.md ↔ native tool surface drift guard', () => {
  it('documents every tool the HTTP MCP surface registers', async () => {
    const registered = await listRegisteredToolNames();
    // Sanity: the harness must see the full surface, or the guard guards nothing.
    expect(registered.length).toBeGreaterThanOrEqual(9);

    const md = renderSkillMarkdown();
    const undocumented = registered.filter((name) => !md.includes(name));
    expect(undocumented, `tools registered but missing from SKILL.md — update packages/mcp/src/skill-md.ts: ${undocumented.join(', ')}`).toEqual([]);
  });

  it('[#26464] documents every tool the surface registers for a metadata:write token with an injected registry', async () => {
    const registry = makeAuthoringRegistry();
    const registered = await listRegisteredToolNames({ grantedScopes: EVERY_SCOPE, registry });
    // Sanity: native surface plus the two injected tools.
    expect(registered.length).toBeGreaterThanOrEqual(11);
    for (const t of AUTHORING_TOOLS) expect(registered).toContain(t.name);

    // The skill rendered for the SAME grant and the SAME registry names every one of them …
    const md = renderSkillMarkdown({ grantedScopes: EVERY_SCOPE, authoringTools: registry.getAll() });
    const undocumented = registered.filter((name) => !md.includes(name));
    expect(undocumented, `tools registered but missing from the authoring SKILL.md: ${undocumented.join(', ')}`).toEqual([]);

    // … and the skill rendered WITHOUT the scope names none of the injected ones,
    // exactly as the surface registers none of them for that grant.
    const withoutScope = await listRegisteredToolNames({
      grantedScopes: EVERY_SCOPE.filter((s) => s !== MCP_OAUTH_SCOPE_METADATA_WRITE),
      registry,
    });
    const mdWithoutScope = renderSkillMarkdown({
      grantedScopes: EVERY_SCOPE.filter((s) => s !== MCP_OAUTH_SCOPE_METADATA_WRITE),
      authoringTools: registry.getAll(),
    });
    for (const t of AUTHORING_TOOLS) {
      expect(withoutScope).not.toContain(t.name);
      expect(mdWithoutScope).not.toContain(t.name);
    }
  });
});
