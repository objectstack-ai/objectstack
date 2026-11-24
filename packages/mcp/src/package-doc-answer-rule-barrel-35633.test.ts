// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35633] The app-docs answer-order rule (#35442) and its served-check are
 * exported from the package barrel, so a host that writes its own `initialize`
 * text (the cloud build door) carries the same sentence; the open server's
 * default text holds exactly what the barrel export returns for the same reader.
 */

import { describe, it, expect } from 'vitest';
import { MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_METADATA_WRITE } from '@objectstack/spec/ai';
import {
  MCPServerRuntime,
  packageDocAnswerRule,
  packageDocToolsServed,
  definitionReaderOf,
  DEFINITION_READER_TOOL_NAMES,
  type McpAuthoringInjection,
  type McpDataBridge,
} from './index.js';

const bridge = {
  async listObjects() { return []; },
  async describeObject() { return null; },
  async query() { return { records: [] }; },
  async get() { return null; },
  async create() { return {}; },
  async update() { return {}; },
  async remove() { return {}; },
  async searchPackageDocs() { return { terms: [], results: [], truncated: false }; },
  async readPackageDoc() { return { name: 'p', title: 'T', content: 'body' }; },
} as unknown as McpDataBridge;

/** The default `initialize` text's paragraphs, for a connection listing `authoringTools` (if any). */
async function paragraphsOf(authoringTools?: string[]): Promise<string[]> {
  const body = {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pin', version: '0' } },
  };
  const grantedScopes = [MCP_OAUTH_SCOPE_DATA_READ, ...(authoringTools ? [MCP_OAUTH_SCOPE_METADATA_WRITE] : [])];
  const authoring = authoringTools && ({
    registry: {
      getAll: () => authoringTools.map((name) => ({ name, description: name, parameters: { type: 'object', properties: {} } })),
      execute: async () => ({}) as never,
    },
    principal: { userId: 'usr_1', scopes: grantedScopes },
  } as McpAuthoringInjection);
  const res = await new MCPServerRuntime({ name: 't', version: '1.0.0' }).handleHttpRequest(
    new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }),
    { bridge, parsedBody: body, toolOptions: { grantedScopes }, ...(authoring ? { authoring } : {}) },
  );
  const json = (await res.json()) as { result: { instructions: string } };
  return json.result.instructions.split('\n\n');
}

describe('[#35633] the answer-order rule is a barrel export, and the open server sends exactly it', () => {
  it('exports the rule, the served-check and the reader pick', () => {
    expect(typeof packageDocAnswerRule).toBe('function');
    expect(typeof packageDocToolsServed).toBe('function');
    expect(packageDocToolsServed(bridge, { grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ] })).toBe(true);
    expect([...DEFINITION_READER_TOOL_NAMES]).toEqual(['describe_metadata', 'get_metadata_item']);
    expect(definitionReaderOf(['get_metadata_item', 'describe_metadata'])).toBe('describe_metadata');
    expect(definitionReaderOf(['save_metadata_draft'])).toBeUndefined();
  });

  it('the default initialize text holds packageDocAnswerRule(reader) whole, for each reader a connection lists', async () => {
    for (const [tools, reader] of [
      [undefined, undefined],
      [['list_metadata_items', 'get_metadata_item'], 'get_metadata_item'],
      [['get_metadata_item', 'describe_metadata'], 'describe_metadata'],
    ] as Array<[string[] | undefined, string | undefined]>) {
      expect(definitionReaderOf(tools ?? [])).toBe(reader);
      expect(await paragraphsOf(tools)).toContain(packageDocAnswerRule(reader));
    }
  });
});
