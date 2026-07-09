// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge, McpActionBridge } from './mcp-http-tools.js';
import { renderSkillMarkdown } from './skill.js';

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
  };
}

async function listRegisteredToolNames(): Promise<string[]> {
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
    { bridge: makeFullBridge(), parsedBody: body },
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
    expect(undocumented, `tools registered but missing from SKILL.md — update packages/mcp/src/skill.ts: ${undocumented.join(', ')}`).toEqual([]);
  });
});
