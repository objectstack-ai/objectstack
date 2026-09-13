// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D10 — maintainer ruling 2026-09-08, #16549 consequence 2]
 * A delegated `query_records` NARROWED by the agent ceiling says so; an
 * un-narrowed one does not.
 *
 * This is the half of the ruling that is INDEPENDENT of the parity half, and
 * the half that matters most, because the deceived consumer on this surface is
 * the AI itself. Measured on the card: `query_records` answered `total: 0` with
 * no note, and the agent faithfully told a decision-maker "there are no
 * opportunities this quarter" — a wrong answer delivered with full confidence,
 * from a tool that was working exactly as specified.
 *
 * The rows are still served. What the notice adds is the one fact the payload
 * could not previously carry: this count describes the CEILING, not the object.
 * The shape mirrors `list_objects`' `partial` / `warning` pair (#6504) so a
 * client branches on the same vocabulary across both tools.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge } from './mcp-http-tools.js';

const NARROWING = 'This result was narrowed by the ADR-0090 D10 intersection: rows are ABSENT from this result.';

function makeBridge(
  diagnose?: McpDataBridge['diagnoseDelegation'],
): McpDataBridge & { calls: string[] } {
  const calls: string[] = [];
  const bridge: any = {
    calls,
    async listObjects() { return [{ name: 'crm_opportunity', label: 'Opportunity' }]; },
    async describeObject(name: string) { return { name }; },
    async query(object: string) {
      calls.push('query');
      return { object, records: [], total: 0 };
    },
    async get(object: string, id: string) { return { object, id }; },
    async create(object: string, data: any) { return { object, data }; },
    async update(object: string, id: string) { return { object, id }; },
    async remove(object: string, id: string) { return { object, id, success: true }; },
  };
  if (diagnose) bridge.diagnoseDelegation = diagnose;
  return bridge;
}

async function queryRecords(runtime: MCPServerRuntime, bridge: any): Promise<any> {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'query_records', arguments: { objectName: 'crm_opportunity' } },
  };
  const req = new Request('http://localhost/api/v1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const res = await runtime.handleHttpRequest(req, { bridge, parsedBody: body });
  const json: any = await res.json();
  expect(json.result?.isError).toBeFalsy();
  return JSON.parse(json.result.content[0].text);
}

describe('query_records — ADR-0090 D10 delegated-read diagnostic (#16549)', () => {
  let runtime: MCPServerRuntime;

  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
  });

  it('a NARROWED delegated read carries the D10 statement beside the rows', async () => {
    const bridge = makeBridge(async () => ({ narrowed: true, statement: NARROWING }));
    const payload = await queryRecords(runtime, bridge);
    // The rows are still served — a partial answer is the most useful true
    // thing here. What is added is the withheld claim.
    expect(payload.object).toBe('crm_opportunity');
    expect(payload.records).toEqual([]);
    expect(payload.total).toBe(0);
    expect(payload.delegationNarrowed).toBe(true);
    expect(payload.warning).toBe(NARROWING);
  });

  it('an UN-NARROWED delegated read carries NO statement — the payload is byte-identical to before', async () => {
    const bridge = makeBridge(async () => ({ narrowed: false }));
    const payload = await queryRecords(runtime, bridge);
    expect(payload).toEqual({ object: 'crm_opportunity', records: [], total: 0 });
    expect(payload.delegationNarrowed).toBeUndefined();
    expect(payload.warning).toBeUndefined();
  });

  it('a bridge that cannot answer (no member at all) renders exactly what it rendered before', async () => {
    // The stdio API-key host and any deployment whose security service predates
    // the probe. ⛔ Absence must never be rendered as a warning — "cannot say"
    // and "nothing to say" are deliberately the same rendered outcome.
    const bridge = makeBridge(undefined);
    const payload = await queryRecords(runtime, bridge);
    expect(payload).toEqual({ object: 'crm_opportunity', records: [], total: 0 });
  });

  it('a THROWING probe never fails the query it annotates', async () => {
    const bridge = makeBridge(async () => { throw new Error('security service exploded'); });
    const payload = await queryRecords(runtime, bridge);
    expect(payload).toEqual({ object: 'crm_opportunity', records: [], total: 0 });
    expect(bridge.calls).toContain('query');
  });

  it('narrowed:true with NO statement adds nothing — a notice with no sentence is not a notice', async () => {
    const bridge = makeBridge(async () => ({ narrowed: true }));
    const payload = await queryRecords(runtime, bridge);
    expect(payload).toEqual({ object: 'crm_opportunity', records: [], total: 0 });
  });
});
