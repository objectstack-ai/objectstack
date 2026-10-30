// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27745] The federation pair, `list_remote_tables` and `import_object`: an
 * agent lists a federated datasource's entity sets and imports one through the
 * same `IExternalDatasourceService` calls Studio's datasource page makes.
 *
 * Pinned here: the pair registers only for a token whose scopes name
 * `metadata:write` (the authoring family's gate, since an import lands object
 * metadata) and only on a bridge that carries both members; each call reaches
 * the bridge with exactly the caller's arguments; a refusal the bridge throws
 * comes back as the coded tool error.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_METADATA_WRITE } from '@objectstack/spec/ai';
import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge, McpFederationBridge } from './mcp-http-tools.js';
import { renderSkillMarkdown } from './skill-md.js';

const FEDERATION_TOOLS = ['import_object', 'list_remote_tables'];

function makeBridge(withFederation = true): McpDataBridge & Partial<McpFederationBridge> & { calls: unknown[] } {
  const calls: unknown[] = [];
  const data: McpDataBridge = {
    async listObjects() { return []; },
    async describeObject() { return null; },
    async query() { return { records: [] }; },
    async get() { return null; },
    async create() { return {}; },
    async update() { return {}; },
    async remove() { return {}; },
  };
  if (!withFederation) return { ...data, calls };
  return {
    ...data,
    calls,
    async listRemoteTables(datasource, opts) {
      calls.push(['listRemoteTables', datasource, opts]);
      if (datasource === 'locked') {
        throw Object.assign(new Error('Introspecting an external datasource requires the `manage_platform_settings` capability.'), {
          code: 'PERMISSION_DENIED',
          status: 403,
        });
      }
      return [{ name: 'Products', columnCount: 6 }, { name: 'Categories', columnCount: 4 }];
    },
    async importObject(datasource, remoteName, opts) {
      calls.push(['importObject', datasource, remoteName, opts]);
      return {
        name: 'products',
        definition: { name: 'products', datasource, external: { remoteName } },
        review: [],
      };
    },
  };
}

async function rpc(runtime: MCPServerRuntime, bridge: unknown, grantedScopes: string[] | undefined, body: unknown) {
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

async function toolNames(runtime: MCPServerRuntime, bridge: unknown, grantedScopes?: string[]): Promise<string[]> {
  const json = await rpc(runtime, bridge, grantedScopes, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  return (json.result?.tools ?? []).map((t: { name: string }) => t.name);
}

async function callTool(runtime: MCPServerRuntime, bridge: unknown, name: string, args: Record<string, unknown>) {
  const json = await rpc(runtime, bridge, [MCP_OAUTH_SCOPE_METADATA_WRITE], {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  return json.result as { content: Array<{ text: string }>; isError?: boolean };
}

describe('the federation tools register behind metadata:write, on a bridge that carries them', () => {
  let runtime: MCPServerRuntime;
  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
  });

  it('registers both for a token naming metadata:write', async () => {
    const names = await toolNames(runtime, makeBridge(), [MCP_OAUTH_SCOPE_METADATA_WRITE]);
    expect(names.filter((n) => FEDERATION_TOOLS.includes(n)).sort()).toEqual(FEDERATION_TOOLS);
  });

  it('registers neither for a key or a session (no scope list), nor for a token without metadata:write', async () => {
    for (const scopes of [undefined, [MCP_OAUTH_SCOPE_DATA_READ]]) {
      const names = await toolNames(runtime, makeBridge(), scopes);
      expect(names.filter((n) => FEDERATION_TOOLS.includes(n)), String(scopes)).toEqual([]);
    }
  });

  it('registers neither on a bridge without the federation members', async () => {
    const names = await toolNames(runtime, makeBridge(false), [MCP_OAUTH_SCOPE_METADATA_WRITE]);
    expect(names.filter((n) => FEDERATION_TOOLS.includes(n))).toEqual([]);
  });

  it('annotates the listing read-only and the import as a non-destructive write', async () => {
    const json = await rpc(runtime, makeBridge(), [MCP_OAUTH_SCOPE_METADATA_WRITE], { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const byName = new Map((json.result.tools as Array<{ name: string; annotations?: Record<string, unknown> }>).map((t) => [t.name, t]));
    expect(byName.get('list_remote_tables')?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(byName.get('import_object')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });
});

describe('the federation tools reach the bridge with the caller\'s arguments', () => {
  let runtime: MCPServerRuntime;
  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
  });

  it('list_remote_tables answers the bridge\'s tables with their count', async () => {
    const bridge = makeBridge();
    const result = await callTool(runtime, bridge, 'list_remote_tables', { datasource: 'erp' });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      tables: [{ name: 'Products', columnCount: 6 }, { name: 'Categories', columnCount: 4 }],
      totalCount: 2,
    });
    expect(bridge.calls).toEqual([['listRemoteTables', 'erp', {}]]);
  });

  it('import_object forwards the name override and the write opt-in, and nothing it was not sent', async () => {
    const bridge = makeBridge();
    await callTool(runtime, bridge, 'import_object', { datasource: 'erp', remoteName: 'Products' });
    await callTool(runtime, bridge, 'import_object', {
      datasource: 'erp',
      remoteName: 'Products',
      name: 'erp_products',
      writable: true,
    });
    expect(bridge.calls).toEqual([
      ['importObject', 'erp', 'Products', {}],
      ['importObject', 'erp', 'Products', { name: 'erp_products', writable: true }],
    ]);
  });

  it('refuses an unknown argument by name instead of dropping it', async () => {
    const bridge = makeBridge();
    const result = await callTool(runtime, bridge, 'import_object', { datasource: 'erp', entitySet: 'Products' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('remoteName');
    expect(bridge.calls).toEqual([]);
  });

  it('answers a refusal the bridge throws as the coded tool error', async () => {
    const result = await callTool(runtime, makeBridge(), 'list_remote_tables', { datasource: 'locked' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text).error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
  });
});

describe('the generated SKILL.md teaches the pair exactly where it registers', () => {
  it('names both for a metadata:write grant on a host that carries them, and neither otherwise', () => {
    const granted = renderSkillMarkdown({ grantedScopes: [MCP_OAUTH_SCOPE_METADATA_WRITE], federationTools: true });
    for (const name of FEDERATION_TOOLS) expect(granted).toContain(`**${name}(`);
    for (const options of [
      { federationTools: true },
      { grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ], federationTools: true },
      { grantedScopes: [MCP_OAUTH_SCOPE_METADATA_WRITE] },
    ]) {
      const skill = renderSkillMarkdown(options);
      for (const name of FEDERATION_TOOLS) expect(skill).not.toContain(name);
    }
  });
});
