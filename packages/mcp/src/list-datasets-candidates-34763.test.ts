// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34763, ADR-0149 D3 amendment note] `list_datasets.candidates` reaches an
 * MCP client exactly as the executor answered it.
 *
 * The members offered for a term that matched nothing are chosen by the
 * service-analytics executor (`findDatasetTermCandidates`, pinned there); the
 * MCP tool layer holds no copy of that rule and must neither drop the key,
 * reorder its entries nor add one. Pinned over a fake bridge whose answer is
 * a spec-valid `ListDatasetsOutput` carrying `candidates`, and its control: an
 * answer without the key comes back without it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LIST_DATASETS_TOOL_NAME,
  ListDatasetsOutputSchema,
  QUERY_DATASET_TOOL_NAME,
  type ListDatasetsOutput,
} from '@objectstack/spec/ai';
import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge } from './mcp-http-tools.js';

const WITH_CANDIDATES: ListDatasetsOutput = {
  datasets: [
    {
      name: 'showcase_invoice_metrics',
      label: 'Invoice Metrics',
      object: 'showcase_invoice',
      dimensions: [{ name: 'status', label: 'Status', type: 'string' }],
      measures: [
        { name: 'invoice_count', label: 'Invoices', aggregate: 'count' },
        { name: 'paid_count', label: 'Paid Invoices', aggregate: 'count' },
      ],
      matches: [],
    },
  ],
  candidates: [
    { term: 'invoice', dataset: 'showcase_invoice_metrics', member: 'measures.invoice_count' },
    { term: 'invoice', dataset: 'showcase_invoice_metrics', member: 'measures.paid_count' },
  ],
};

const WITHOUT_CANDIDATES: ListDatasetsOutput = {
  datasets: [{ ...WITH_CANDIDATES.datasets[0], matches: [{ term: 'invoices', member: 'measures.invoice_count', matchedOn: 'label' }] }],
};

function bridgeAnswering(answer: ListDatasetsOutput): McpDataBridge & { inputs: unknown[] } {
  const inputs: unknown[] = [];
  return {
    inputs,
    async listObjects() { return []; },
    async describeObject() { return null; },
    async query() { return { records: [] }; },
    async get() { return null; },
    async create() { return {}; },
    async update() { return {}; },
    async remove() { return {}; },
    async listDatasets(input) {
      inputs.push(input);
      return answer;
    },
    async queryDataset() { return { rows: [], fields: [], rowCount: 0, truncated: false } as never; },
    datasetToolDefinitions() {
      return [
        { name: LIST_DATASETS_TOOL_NAME, description: 'list the governed datasets' },
        { name: QUERY_DATASET_TOOL_NAME, description: 'compute a governed metric' },
      ];
    },
  };
}

async function callListDatasets(runtime: MCPServerRuntime, bridge: McpDataBridge, args: Record<string, unknown>) {
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: LIST_DATASETS_TOOL_NAME, arguments: args } };
  const res = await runtime.handleHttpRequest(
    new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }),
    { bridge, parsedBody: body },
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as { result?: { content: Array<{ type: string; text: string }>; isError?: boolean } };
  expect(json.result?.isError).toBeFalsy();
  return JSON.parse(json.result!.content[0].text) as ListDatasetsOutput;
}

describe('[#34763] list_datasets candidates over MCP', () => {
  let runtime: MCPServerRuntime;
  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
  });

  it('the fixtures are answers the spec accepts', () => {
    expect(ListDatasetsOutputSchema.safeParse(WITH_CANDIDATES).success).toBe(true);
    expect(ListDatasetsOutputSchema.safeParse(WITHOUT_CANDIDATES).success).toBe(true);
  });

  it('passes the executor\'s candidates through unchanged: same entries, same order, nothing added', async () => {
    const bridge = bridgeAnswering(WITH_CANDIDATES);
    const answer = await callListDatasets(runtime, bridge, { terms: ['invoice'] });
    expect(answer).toEqual(WITH_CANDIDATES);
    expect(answer.candidates).toEqual(WITH_CANDIDATES.candidates);
    expect(bridge.inputs).toEqual([{ terms: ['invoice'] }]);
  });

  it('an answer without candidates comes back without the key', async () => {
    const answer = await callListDatasets(runtime, bridgeAnswering(WITHOUT_CANDIDATES), { terms: ['invoices'] });
    expect(answer).toEqual(WITHOUT_CANDIDATES);
    expect('candidates' in answer).toBe(false);
  });
});
