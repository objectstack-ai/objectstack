// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34689] What the open door's `tools/list` costs: every connection pays it,
 * in the client's own tokens, before any work starts.
 *
 * The surface is the one a self-hosted app serves an API key (no scope list):
 * object CRUD with `aggregate_records`, the action trio, the file pair and the
 * dataset pair — the dataset descriptions are the service-analytics
 * definitions the runtime hands the bridge. It is read through the real
 * registration path (a `tools/list` round-trip), never from a list of names.
 *
 * The run prints one row per tool (description bytes, input-schema bytes) and
 * the response total, so the before/after table a PR on this surface owes is
 * one command away:
 *
 *   pnpm --filter @objectstack/mcp exec vitest run src/tools-list-weight-34689.test.ts
 *
 * The ceiling is the slimmed total with headroom for one more tool's worth of
 * text. Teaching prose belongs in the served SKILL.md (`skill-md.ts`), which a
 * client reads when it needs it; a description carries what the call needs.
 */

import { describe, it, expect } from 'vitest';
import { getDatasetToolDefinitions } from '@objectstack/service-analytics';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge, McpActionBridge } from './mcp-http-tools.js';
import type { McpFileBridge } from './file-content.js';

/** Every member the open door's API-key surface registers a tool for, all stubbed. */
function makeFullBridge(): McpDataBridge & McpActionBridge & McpFileBridge {
  return {
    async listObjects() { return []; },
    async describeObject() { return null; },
    async query() { return { records: [] }; },
    async get() { return null; },
    async create() { return {}; },
    async update() { return {}; },
    async remove() { return {}; },
    async aggregate() { return []; },
    async listActions() { return []; },
    async runAction() { return {}; },
    async resumeRun() { return {}; },
    async listRecordFiles() { return []; },
    async readRecordFile() {
      return { fileId: 'f', name: 'f', mimeType: null, size: null, maxBytes: 0, download: null };
    },
    async createUploadLink() {
      return { url: 'https://x.test/u', expiresAt: '2026-01-01T00:00:00.000Z' };
    },
    // The runtime bridge serves it where storage can mint a link for a record
    // not yet created; it adds text to create_upload_link, so it is measured.
    async createUploadLinkForNewRecord() {
      return { url: 'https://x.test/u', expiresAt: '2026-01-01T00:00:00.000Z', fileIds: ['f'] };
    },
    async listDatasets() { return { datasets: [] }; },
    async queryDataset() { throw new Error('not called'); },
    datasetToolDefinitions() { return getDatasetToolDefinitions(); },
  };
}

interface ToolRow { name: string; description: number; inputSchema: number }

async function measureToolsList(): Promise<{ total: number; rows: ToolRow[] }> {
  const runtime = new MCPServerRuntime({ name: 'objectstack', version: '0.0.0' });
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  const res = await runtime.handleHttpRequest(
    new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }),
    { bridge: makeFullBridge(), parsedBody: body },
  );
  const text = await res.text();
  const tools: Array<{ name: string; description?: string; inputSchema?: unknown }> = JSON.parse(text).result.tools;
  const rows = tools.map((t) => ({
    name: t.name,
    description: Buffer.byteLength(t.description ?? ''),
    inputSchema: Buffer.byteLength(JSON.stringify(t.inputSchema ?? {})),
  }));
  return { total: Buffer.byteLength(text), rows };
}

/**
 * The slimmed total (36,481 bytes, from 47,712) plus room for one more tool. A PR
 * that needs more raises it beside its own before/after table.
 */
const TOOLS_LIST_BYTE_CEILING = 38_000;

describe('[#34689] the open door tools/list weight', () => {
  it('prints the per-tool table and stays under the ceiling', async () => {
    const { total, rows } = await measureToolsList();
    // Sanity: the harness sees the whole API-key surface, or the number measures nothing.
    expect(rows.map((r) => r.name)).toEqual(expect.arrayContaining([
      'list_objects', 'describe_object', 'validate_expression', 'query_records', 'aggregate_records',
      'get_record', 'create_record', 'update_record', 'delete_record', 'delete_records',
      'list_actions', 'run_action', 'resume_run', 'read_file', 'create_upload_link',
      'list_datasets', 'query_dataset',
    ]));

    const sorted = [...rows].sort((a, b) => (b.description + b.inputSchema) - (a.description + a.inputSchema));
    const lines = sorted.map((r) => `| ${r.name} | ${r.description} | ${r.inputSchema} | ${r.description + r.inputSchema} |`);
    const sum = (k: 'description' | 'inputSchema') => rows.reduce((n, r) => n + r[k], 0);
    console.log([
      `tools/list: ${rows.length} tools, ${total} bytes (descriptions ${sum('description')}, input schemas ${sum('inputSchema')})`,
      '| tool | description | input schema | both |',
      '|:--|--:|--:|--:|',
      ...lines,
    ].join('\n'));

    expect(total).toBeLessThanOrEqual(TOOLS_LIST_BYTE_CEILING);
  });
});
