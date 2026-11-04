// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';

import {
  EVALUATED_EXPRESSION_SOURCE_REQUIRED,
  TYPED_EXPRESSION_SOURCE_REQUIRED,
} from '@objectstack/spec/shared';

import { validateStackExpressions } from '@objectstack/lint';

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

  // [#29904] A validation rule fails closed, and the publish gate refuses the
  // comparison there; the tool's `validation` site answers what the gate will.
  it('errors on a text field ordered against a number at a validation site (#29904)', async () => {
    const r = await validate(runtime, bridge, { objectName: 'crm_opportunity', expression: 'record.title > 5', site: 'validation' });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e: any) => e.code)).toEqual(['type-mismatch-fail-closed']);
    expect(r.warnings).toHaveLength(0);
  });

  it('validates a flattened flow condition (bare fields correct; type-soundness still applies)', async () => {
    const ok = await validate(runtime, bridge, { objectName: 'crm_opportunity', expression: 'stage == "won" && amount > 1000', site: 'flow_condition' });
    expect(ok.ok).toBe(true);
    expect(ok.warnings).toHaveLength(0);
    // [#29926] A flow condition fails the run on the fault, and the publish
    // gate refuses the comparison on a record-triggered flow; the tool's
    // `flow_condition` site answers what the gate will.
    const bad = await validate(runtime, bridge, { objectName: 'crm_opportunity', expression: 'title * 2 > 10', site: 'flow_condition' });
    expect(bad.ok).toBe(false);
    expect(bad.warnings).toHaveLength(0);
    expect(bad.errors.map((e: any) => e.code)).toEqual(['type-mismatch-run-fails']);
    expect(bad.errors[0].message).toContain('fails the run');
  });

  // [#29959] The two facts the gate's fault-outcome ledger reads off the rule
  // and the flow, as optional inputs: for every value, the tool's verdict on
  // a text-vs-number comparison is the publish gate's own (severity and
  // message), read off `validateStackExpressions` on the same rule or flow.
  describe('answers the publish gate for each severity and trigger kind (#29959)', () => {
    const fields = { title: { type: 'text', required: true } };
    const typeVerdicts = (issues: ReturnType<typeof validateStackExpressions>) =>
      issues.filter((i) => /^type mismatch/.test(i.message)).map((i) => [i.severity, i.message]);
    const toolVerdicts = (r: { errors: { message: string }[]; warnings: { message: string }[] }) => [
      ...r.errors.map((e) => ['error', e.message]),
      ...r.warnings.map((w) => ['warning', w.message]),
    ];

    for (const severity of [undefined, 'error', 'warning', 'info'] as const) {
      it(`site validation, severity ${severity ?? '(omitted)'}`, async () => {
        const expression = 'record.title > 5';
        const gate = typeVerdicts(validateStackExpressions({
          objects: [{
            name: 'crm_opportunity',
            fields,
            validations: [{ name: 'r', type: 'script', condition: expression, message: 'm', ...(severity ? { severity } : {}) }],
          }],
        }));
        expect(gate).toHaveLength(1);
        const r = await validate(runtime, bridge, { objectName: 'crm_opportunity', expression, site: 'validation', ...(severity ? { severity } : {}) });
        expect(toolVerdicts(r)).toEqual(gate);
      });
    }

    for (const [triggerKind, startConfig, flowType] of [
      [undefined, { triggerType: 'record-after-update' }, 'autolaunched'],
      ['record_change', { triggerType: 'record-after-create' }, 'autolaunched'],
      ['time_relative', { timeRelative: { object: 'crm_opportunity', field: 'close_date', offsetDays: 1 }, schedule: '0 * * * *' }, 'autolaunched'],
      ['schedule', { schedule: '0 * * * *' }, 'autolaunched'],
      ['api', {}, 'api'],
      ['none', {}, 'autolaunched'],
    ] as const) {
      it(`site flow_condition, triggerKind ${triggerKind ?? '(omitted)'}`, async () => {
        const expression = 'title * 2 > 10';
        const gate = typeVerdicts(validateStackExpressions({
          objects: [{ name: 'crm_opportunity', fields }],
          flows: [{
            name: 'f',
            type: flowType,
            nodes: [
              { id: 'start', type: 'start', config: { objectName: 'crm_opportunity', condition: expression, ...startConfig } },
              { id: 'end', type: 'end' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'end' }],
          }],
        }));
        expect(gate).toHaveLength(1);
        const r = await validate(runtime, bridge, { objectName: 'crm_opportunity', expression, site: 'flow_condition', ...(triggerKind ? { triggerKind } : {}) });
        expect(toolVerdicts(r)).toEqual(gate);
      });
    }

    it('refuses an input on a site it does not describe', async () => {
      for (const args of [
        { site: 'flow_condition', severity: 'warning' },
        { site: 'formula', severity: 'error' },
        { severity: 'info' },
        { site: 'validation', triggerKind: 'api' },
        { triggerKind: 'record_change' },
      ]) {
        const { json } = await call(runtime, toolsCall(1, 'validate_expression', { objectName: 'crm_opportunity', expression: 'record.title > 5', ...args }), bridge);
        const { result } = json as { result: { isError?: boolean; content: { text: string }[] } };
        expect(result.isError, JSON.stringify(args)).toBe(true);
        expect(result.content[0]!.text, JSON.stringify(args)).toMatch(/applies only with site/);
      }
    });

    it('leaves a well-typed condition clean at every input', async () => {
      for (const severity of ['error', 'warning', 'info'] as const) {
        const r = await validate(runtime, bridge, { objectName: 'crm_opportunity', expression: 'size(record.title) > 5', site: 'validation', severity });
        expect([r.errors, r.warnings], severity).toEqual([[], []]);
      }
      for (const triggerKind of ['record_change', 'time_relative', 'schedule', 'api', 'none'] as const) {
        const r = await validate(runtime, bridge, { objectName: 'crm_opportunity', expression: 'size(title) > 5', site: 'flow_condition', triggerKind });
        expect([r.errors, r.warnings], triggerKind).toEqual([[], []]);
      }
    });
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
