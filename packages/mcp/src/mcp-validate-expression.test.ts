// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';

import {
  EVALUATED_EXPRESSION_SOURCE_REQUIRED,
  TYPED_EXPRESSION_SOURCE_REQUIRED,
} from '@objectstack/spec/shared';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge } from './mcp-http-tools.js';

/**
 * A data bridge whose `describeObject` returns a realistic schema (field names
 * AND types), so the `validate_expression` tool can run the full build-time
 * check — including the #1928 type-soundness warning that needs field types.
 */
function makeBridge(): McpDataBridge {
  return {
    async listObjects() {
      return [{ name: 'crm_opportunity', label: 'Opportunity', fieldCount: 4 }];
    },
    async describeObject(name: string) {
      if (name !== 'crm_opportunity') return null;
      return {
        name: 'crm_opportunity',
        label: 'Opportunity',
        fields: [
          { name: 'amount', type: 'currency', label: 'Amount', required: false },
          { name: 'probability', type: 'percent', label: 'Probability', required: false },
          { name: 'title', type: 'text', label: 'Title', required: true },
          { name: 'is_active', type: 'boolean', label: 'Active', required: false },
          { name: 'stage', type: 'select', label: 'Stage', required: false },
        ],
      };
    },
    async query() { return { records: [] }; },
    async get() { return null; },
    async create() { return {}; },
    async update() { return {}; },
    async remove() { return {}; },
  };
}

function mcpRequest(body: unknown): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
}

async function call(runtime: MCPServerRuntime, body: unknown, bridge?: unknown) {
  const res = await runtime.handleHttpRequest(mcpRequest(body), { bridge, parsedBody: body } as never);
  const json = res.status === 202 ? null : await res.json();
  return { status: res.status, json };
}

const toolsCall = (id: number, name: string, args: Record<string, unknown>) => ({
  jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args },
});

async function validate(runtime: MCPServerRuntime, bridge: McpDataBridge, args: Record<string, unknown>) {
  const { json } = await call(runtime, toolsCall(1, 'validate_expression', args), bridge);
  return JSON.parse(json.result.content[0].text);
}

describe('validate_expression MCP tool (#1928)', () => {
  let runtime: MCPServerRuntime;
  let bridge: McpDataBridge;

  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    bridge = makeBridge();
  });

  it('registers as a read-only tool', async () => {
    const { json } = await call(runtime, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, bridge);
    const byName = Object.fromEntries(json.result.tools.map((t: any) => [t.name, t]));
    expect(byName.validate_expression).toBeDefined();
    expect(byName.validate_expression.annotations.readOnlyHint).toBe(true);
  });

  it('accepts a sound formula and reports its inferred type + in-scope context', async () => {
    const r = await validate(runtime, bridge, { objectName: 'crm_opportunity', expression: 'record.amount / 100', site: 'formula' });
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(0); // currency → dyn, so int-literal arithmetic is fine
    expect(r.inScope.fields).toContain('amount');
    expect(r.inScope.functions).toContain('daysBetween');
  });

  it('flags a bare field reference in a record-scoped formula (error)', async () => {
    const r = await validate(runtime, bridge, { objectName: 'crm_opportunity', expression: 'amount > 100', site: 'formula' });
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/bare reference `amount`|record\.amount/);
  });

  it('flags an unknown field with a did-you-mean (error)', async () => {
    const r = await validate(runtime, bridge, { objectName: 'crm_opportunity', expression: 'record.amont > 100', site: 'validation' });
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/unknown field `amont`/);
  });

  it('warns (does not error) on a text field misused in arithmetic — tier 4', async () => {
    const r = await validate(runtime, bridge, { objectName: 'crm_opportunity', expression: 'record.title * 2', site: 'formula' });
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w: any) => /type mismatch/i.test(w.message))).toBe(true);
  });

  it('validates a flattened flow condition (bare fields correct; type-soundness still applies)', async () => {
    const ok = await validate(runtime, bridge, { objectName: 'crm_opportunity', expression: 'stage == "won" && amount > 1000', site: 'flow_condition' });
    expect(ok.ok).toBe(true);
    expect(ok.warnings).toHaveLength(0);
    const warn = await validate(runtime, bridge, { objectName: 'crm_opportunity', expression: 'title * 2 > 10', site: 'flow_condition' });
    expect(warn.warnings.some((w: any) => /type mismatch/i.test(w.message))).toBe(true);
  });

  it('errors clearly when the object does not exist', async () => {
    const { json } = await call(runtime, toolsCall(1, 'validate_expression', { objectName: 'nope', expression: 'record.x > 1' }), bridge);
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toMatch(/not found/i);
  });

  // A blank source is refused by the save/build gate (the spec's evaluated-slot
  // and template-slot input schemas). The tool's verdict must be that gate's:
  // ok:false, the schema's own issue code, and its published sentence.
  describe('a blank or whitespace-only expression gets the save gate verdict', () => {
    for (const expression of ['', '   ', '\t\n ']) {
      for (const site of ['formula', 'validation', 'flow_condition'] as const) {
        it(`refuses ${JSON.stringify(expression)} at site ${site}`, async () => {
          const r = await validate(runtime, bridge, { objectName: 'crm_opportunity', expression, site });
          expect(r.ok).toBe(false);
          expect(r.errors).toHaveLength(1);
          expect(r.errors[0].code).toBe('invalid_union');
          expect(r.errors[0].message).toBe(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
          expect(r.warnings).toHaveLength(0);
          expect(r.inferredType).toBeUndefined();
          // The scope context still comes back, so the agent can self-correct.
          expect(r.inScope.fields).toContain('amount');
        });
      }
      it(`refuses ${JSON.stringify(expression)} at site template with the template sentence`, async () => {
        const r = await validate(runtime, bridge, { objectName: 'crm_opportunity', expression, site: 'template' });
        expect(r.ok).toBe(false);
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0].code).toBe('invalid_union');
        expect(r.errors[0].message).toBe(TYPED_EXPRESSION_SOURCE_REQUIRED.template);
      });
    }

    it('defaults to the formula site when none is given', async () => {
      const r = await validate(runtime, bridge, { objectName: 'crm_opportunity', expression: '' });
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toBe(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
    });

    it('keeps the verdict of a non-blank control expression unchanged', async () => {
      const r = await validate(runtime, bridge, { objectName: 'crm_opportunity', expression: ' record.amount / 100 ', site: 'formula' });
      expect(r.ok).toBe(true);
      expect(r.errors).toHaveLength(0);
      expect(r.inferredType).toBeDefined();
      const t = await validate(runtime, bridge, { objectName: 'crm_opportunity', expression: 'Hi {{ record.title }}', site: 'template' });
      expect(t.ok).toBe(true);
      expect(t.errors).toHaveLength(0);
    });
  });

  it('refuses system objects (fail-closed guard)', async () => {
    const { json } = await call(runtime, toolsCall(1, 'validate_expression', { objectName: 'sys_user', expression: 'record.x > 1' }), bridge);
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toMatch(/system object/i);
  });
});
