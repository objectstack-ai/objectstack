// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';

import {
  EVALUATED_EXPRESSION_SOURCE_REQUIRED,
  TYPED_EXPRESSION_SOURCE_REQUIRED,
} from '@objectstack/spec/shared';

import { AUTHORED_FORMULA_FIELD_NAME, AUTHORED_RULE_NAME, validateStackExpressions } from '@objectstack/lint';

import { applyInjectedSystemColumns } from '@objectstack/metadata-core';

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

async function call(runtime: MCPServerRuntime, body: unknown, bridge?: unknown, allowSystemObjects?: boolean) {
  const res = await runtime.handleHttpRequest(mcpRequest(body), {
    bridge,
    parsedBody: body,
    ...(allowSystemObjects !== undefined ? { toolOptions: { allowSystemObjects } } : {}),
  } as never);
  const json = res.status === 202 ? null : await res.json();
  return { status: res.status, json };
}

const toolsCall = (id: number, name: string, args: Record<string, unknown>) => ({
  jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args },
});

async function validate(
  runtime: MCPServerRuntime,
  bridge: McpDataBridge,
  args: Record<string, unknown>,
  allowSystemObjects?: boolean,
) {
  const { json } = await call(runtime, toolsCall(1, 'validate_expression', args), bridge, allowSystemObjects);
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

    // The severity column is the ledger's own answer (`faultOutcomeOf`): a
    // time-relative sweep binds a row of the swept object as its record
    // (#29959) — `objectName`'s, unless `sweepObject` names another (#30026).
    // `startObject: null` is a start node naming no objectName: the gate then
    // types the conditions against the swept object, the tool's `objectName`.
    const sweep = (object: string) => ({ timeRelative: { object, field: 'close_date', offsetDays: 1 }, schedule: '0 * * * *' });
    for (const [label, triggerKind, sweepObject, startObject, startConfig, flowType, severity] of [
      ['(omitted)', undefined, undefined, 'crm_opportunity', { triggerType: 'record-after-update' }, 'autolaunched', 'error'],
      ['record_change', 'record_change', undefined, 'crm_opportunity', { triggerType: 'record-after-create' }, 'autolaunched', 'error'],
      ['time_relative', 'time_relative', undefined, 'crm_opportunity', sweep('crm_opportunity'), 'autolaunched', 'error'],
      ['time_relative, sweepObject objectName', 'time_relative', 'crm_opportunity', 'crm_opportunity', sweep('crm_opportunity'), 'autolaunched', 'error'],
      ['time_relative, start names no objectName', 'time_relative', undefined, null, sweep('crm_opportunity'), 'autolaunched', 'error'],
      ['time_relative, sweepObject another object', 'time_relative', 'crm_task', 'crm_opportunity', sweep('crm_task'), 'autolaunched', 'warning'],
      ['schedule', 'schedule', undefined, 'crm_opportunity', { schedule: '0 * * * *' }, 'autolaunched', 'warning'],
      ['api', 'api', undefined, 'crm_opportunity', {}, 'api', 'warning'],
      ['none', 'none', undefined, 'crm_opportunity', {}, 'autolaunched', 'warning'],
    ] as const) {
      it(`site flow_condition, triggerKind ${label}`, async () => {
        const expression = 'title * 2 > 10';
        const gate = typeVerdicts(validateStackExpressions({
          objects: [{ name: 'crm_opportunity', fields }, { name: 'crm_task', fields: { close_date: { type: 'date' } } }],
          flows: [{
            name: 'f',
            type: flowType,
            nodes: [
              { id: 'start', type: 'start', config: { ...(startObject ? { objectName: startObject } : {}), condition: expression, ...startConfig } },
              { id: 'end', type: 'end' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'end' }],
          }],
        }));
        expect(gate).toHaveLength(1);
        expect(gate[0]![0]).toBe(severity);
        const r = await validate(runtime, bridge, {
          objectName: 'crm_opportunity', expression, site: 'flow_condition',
          ...(triggerKind ? { triggerKind } : {}), ...(sweepObject ? { sweepObject } : {}),
        });
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
        // [#30026] The swept object describes a time-relative flow alone.
        { site: 'flow_condition', sweepObject: 'crm_task' },
        { site: 'flow_condition', triggerKind: 'record_change', sweepObject: 'crm_task' },
        { site: 'validation', sweepObject: 'crm_task' },
        { sweepObject: 'crm_task' },
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

// [#32640] A relationship read BOTH through a reference field
// (`record.balance.remaining`) and as a plain value (`record.balance`) cannot
// be served: the save/publish gate refuses it (`expression-invalid`) at a
// validation rule's condition and at a formula field's `expression`, the two
// sites where the engine hydrates one hop. The tool runs the gate's own judge
// there, so its verdict at those sites is the gate's, read off
// `validateStackExpressions` on the same rule or field.
describe('validate_expression answers the gate on relationship traversal (#32640)', () => {
  const REQ = 'rtbw_leave_req';
  const BAL = 'rtbw_leave_bal';
  // Required, so the gate's null-guard pass has nothing to say and the two
  // verdicts compare whole. (This bridge serves no definition, so the tool
  // runs the shared validator alone: the gate's other passes are pinned in
  // the #32872 block below.)
  const reqFields = {
    leave_type: { type: 'text', label: 'Leave type', required: true },
    days: { type: 'number', label: 'Days', required: true },
    balance: { type: 'lookup', label: 'Balance', reference: BAL },
  };
  const balFields = {
    remaining: { type: 'number', label: 'Remaining' },
    owner: { type: 'lookup', label: 'Owner', reference: REQ },
  };
  const leaveBridge = (): McpDataBridge => ({
    ...makeBridge(),
    async listObjects() {
      return [{ name: REQ }, { name: BAL }];
    },
    async describeObject(name: string) {
      const fields = name === REQ ? reqFields : name === BAL ? balFields : null;
      if (!fields) return null;
      return { name, fields: Object.entries(fields).map(([n, f]) => ({ name: n, ...f })) };
    },
  });
  const verdicts = (r: { errors: { message: string }[]; warnings: { message: string }[] }) => [
    ...r.errors.map((e) => ['error', e.message]),
    ...r.warnings.map((w) => ['warning', w.message]),
  ];
  const gateVerdicts = (issues: ReturnType<typeof validateStackExpressions>) =>
    issues.map((i) => [i.severity ?? 'error', i.message]);
  const ruleGate = (expression: string) => gateVerdicts(validateStackExpressions({
    objects: [
      { name: REQ, fields: reqFields, validations: [{ name: 'r', type: 'script', condition: expression, message: 'm' }] },
      { name: BAL, fields: balFields },
    ],
  }));
  const formulaGate = (expression: string) => gateVerdicts(validateStackExpressions({
    objects: [
      { name: REQ, fields: { ...reqFields, after: { type: 'formula', label: 'After', expression } } },
      { name: BAL, fields: balFields },
    ],
  }));

  let runtime: MCPServerRuntime;
  let bridge: McpDataBridge;
  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    bridge = leaveBridge();
  });

  const READ_TWICE = [
    'has(record.balance) && record.leave_type == "annual" && record.days > record.balance.remaining',
    'record.balance != null && record.days > record.balance.remaining',
  ];

  for (const expression of READ_TWICE) {
    it(`site validation refuses what the gate refuses: ${expression}`, async () => {
      const gate = ruleGate(expression);
      expect(gate).toHaveLength(1);
      expect(gate[0]![0]).toBe('error');
      const r = await validate(runtime, bridge, { objectName: REQ, expression, site: 'validation' });
      expect(r.ok).toBe(false);
      expect(r.errors.map((e: { code: string }) => e.code)).toEqual(['traversal-bare-and-traversed']);
      expect(verdicts(r)).toEqual(gate);
    });

    it(`site formula refuses what the gate refuses: ${expression}`, async () => {
      const value = `${expression} ? 1 : 0`;
      const gate = formulaGate(value);
      expect(gate).toHaveLength(1);
      expect(gate[0]![0]).toBe('error');
      const r = await validate(runtime, bridge, { objectName: REQ, expression: value, site: 'formula' });
      expect(r.ok).toBe(false);
      expect(r.errors.map((e: { code: string }) => e.code)).toEqual(['traversal-bare-and-traversed']);
      expect(verdicts(r)).toEqual(gate);
    });
  }

  it('site validation refuses a second hop as the gate does', async () => {
    const expression = 'record.balance.owner.days > 1';
    const r = await validate(runtime, bridge, { objectName: REQ, expression, site: 'validation' });
    expect(r.errors.map((e: { code: string }) => e.code)).toContain('traversal-multi-hop');
    const gate = ruleGate(expression);
    for (const v of verdicts(r)) expect(gate).toContainEqual(v);
  });

  it('keeps one hop clean where the gate passes it', async () => {
    const expression = "record.leave_type == 'annual' && record.days > record.balance.remaining";
    expect(ruleGate(expression)).toEqual([]);
    const r = await validate(runtime, bridge, { objectName: REQ, expression, site: 'validation' });
    expect([r.errors, r.warnings]).toEqual([[], []]);
    expect(formulaGate(`${expression} ? 1 : 0`)).toEqual([]);
    const f = await validate(runtime, bridge, { objectName: REQ, expression: `${expression} ? 1 : 0`, site: 'formula' });
    expect([f.errors, f.warnings]).toEqual([[], []]);
  });

  // Nothing hydrates a flow condition: the gate does not run the traversal
  // checks there, and neither does the tool.
  it('leaves a flow condition to the gate verdict there (no traversal check)', async () => {
    const expression = READ_TWICE[1]!;
    const r = await validate(runtime, bridge, { objectName: REQ, expression, site: 'flow_condition' });
    expect(r.errors.map((e: { code: string }) => e.code)).not.toContain('traversal-bare-and-traversed');
    const gate = gateVerdicts(validateStackExpressions({
      objects: [{ name: REQ, fields: reqFields }, { name: BAL, fields: balFields }],
      flows: [{
        name: 'f',
        type: 'autolaunched',
        nodes: [
          { id: 'start', type: 'start', config: { objectName: REQ, triggerType: 'record-after-update', condition: expression } },
          { id: 'end', type: 'end' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
      }],
    }));
    expect(gate.filter(([, m]) => /read BOTH through the relationship/.test(m!))).toEqual([]);
    expect(verdicts(r).filter(([, m]) => /read BOTH through the relationship/.test(m!))).toEqual([]);
  });
});

// [#32872] At a validation rule and a formula field the publish gate judges
// with passes of its own beyond the shared validator, each private to
// `@objectstack/lint`'s walk. The tool asks the gate itself for them
// (`judgeAuthoredSiteExpression`) over the definitions the bridge serves
// (`servedObjectDefinitionOf`), so for each member below the tool refuses
// (or warns) where it answered `ok: true` before, in the gate's words, read
// off `validateStackExpressions` on the same rule or field. The list of the
// gate's passes at each site, and the pin that a new one cannot be added
// without this entry, is `packages/lint/src/authored-site-expression.test.ts`.
describe("validate_expression answers the gate's own passes at validation and formula sites (#32872)", () => {
  const OBJECTS: Record<string, Record<string, any>> = {
    gp_req: {
      name: 'gp_req',
      fields: {
        days: { type: 'number', label: 'Days' },
        title: { type: 'text', label: 'Title', required: true },
        balance: { type: 'lookup', label: 'Balance', reference: 'gp_bal' },
        meta: { type: 'lookup', label: 'Meta', reference: 'sys_metadata' },
        header: { type: 'master_detail', label: 'Header', reference: 'gp_bal' },
        approver: { type: 'lookup', label: 'Approver', reference: 'sys_user' },
      },
      // The object's own rule is the gate's business at its own door, never this call's.
      validations: [{ name: 'own', type: 'script', condition: 'record.days > 3', message: 'm' }],
    },
    gp_bal: { name: 'gp_bal', fields: { remaining: { type: 'number', label: 'Remaining', required: true } } },
    // A system object the bridge serves, which the tool's object-name guard
    // does not expose unless the server sets `allowSystemObjects`.
    sys_user: { name: 'sys_user', fields: { email: { type: 'text', label: 'Email', required: true } } },
    gp_ext: {
      name: 'gp_ext',
      external: { remoteName: 'customers' },
      fields: { email: { type: 'text', label: 'Email', required: true } },
    },
  };
  /** As the registry serves it: the injected system columns are declared fields; `describeObject` projects them. */
  const served = (name: string) => (OBJECTS[name] ? applyInjectedSystemColumns(OBJECTS[name]) : null);
  const reads: string[] = [];
  const gateBridge = (withDefinitions = true): McpDataBridge => ({
    ...makeBridge(),
    async listObjects() {
      return Object.keys(OBJECTS).map((name) => ({ name }));
    },
    async describeObject(name: string) {
      const def = served(name);
      if (!def) return null;
      return { name, fields: Object.entries(def.fields).map(([n, f]) => ({ name: n, ...(f as object) })) };
    },
    ...(withDefinitions
      ? {
          async servedObjectDefinitionOf(name: string) {
            reads.push(name);
            return served(name);
          },
        }
      : {}),
  });
  const verdicts = (r: { errors: { message: string }[]; warnings: { message: string }[] }) => [
    ...r.errors.map((e) => ['error', e.message]),
    ...r.warnings.map((w) => ['warning', w.message]),
  ];
  /** The gate's verdicts on the same rule or field, the object's own rules left out as the tool leaves them. */
  const gateOn = (site: 'validation' | 'formula', objectName: string, expression: string) => {
    const { validations: _own, ...subject } = OBJECTS[objectName]!;
    const judged = site === 'validation'
      ? { ...subject, validations: [{ name: AUTHORED_RULE_NAME, type: 'script', condition: expression, message: 'm' }] }
      : { ...subject, fields: { ...subject.fields, [AUTHORED_FORMULA_FIELD_NAME]: { type: 'formula', label: 'F', expression } } };
    const others = Object.keys(OBJECTS).filter((n) => n !== objectName).map((n) => OBJECTS[n]!);
    const name = site === 'validation' ? AUTHORED_RULE_NAME : AUTHORED_FORMULA_FIELD_NAME;
    return validateStackExpressions({ objects: [judged, ...others] })
      .filter((i) => i.where.includes(`'${name}'`))
      .map((i) => [i.severity ?? 'error', i.message]);
  };
  const sorted = (v: unknown[][]) => [...v].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  let runtime: MCPServerRuntime;
  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    reads.length = 0;
  });

  // [member, site, object, expression, severity, the subject the finding names]
  const MEMBERS: Array<[string, 'validation' | 'formula', string, string, 'error' | 'warning', string]> = [
    ['null-guard gate', 'validation', 'gp_req', 'record.days > 3', 'error', 'days'],
    ['undeclared field one hop away', 'validation', 'gp_req', 'record.balance.nope > 1', 'error', 'nope'],
    ['undeclared field one hop away', 'formula', 'gp_req', 'record.balance.nope > 1 ? 1 : 0', 'error', 'nope'],
    ['hop into a stored-metadata table', 'validation', 'gp_req', "record.meta.name == 'x'", 'error', 'sys_metadata'],
    ['hop into a stored-metadata table', 'formula', 'gp_req', "record.meta.name == 'x' ? 1 : 0", 'error', 'sys_metadata'],
    ['a validation rule reading `parent`', 'validation', 'gp_req', 'parent.remaining > 1', 'error', 'parent'],
    ['unprovisioned anchor (warning)', 'validation', 'gp_ext', "record.owner_id == 'u1'", 'warning', 'owner_id'],
    ['unprovisioned anchor (warning)', 'formula', 'gp_ext', "record.owner_id == 'u1' ? 1 : 0", 'warning', 'owner_id'],
  ];

  it('judges the authored body: an injected column is no declared nullable field', async () => {
    const expression = "record.created_at > timestamp('2020-01-01T00:00:00Z')";
    expect(gateOn('validation', 'gp_req', expression)).toEqual([]);
    const r = await validate(runtime, gateBridge(), { objectName: 'gp_req', expression, site: 'validation' });
    expect([r.ok, r.errors, r.warnings]).toEqual([true, [], []]);
  });

  for (const [member, site, objectName, expression, severity, names] of MEMBERS) {
    it(`site ${site}: ${member} — the tool gives the gate's verdict`, async () => {
      const gate = gateOn(site, objectName, expression);
      expect(gate.map(([level]) => level)).toEqual([severity]);
      const r = await validate(runtime, gateBridge(), { objectName, expression, site });
      expect(r.ok).toBe(severity !== 'error');
      expect(sorted(verdicts(r))).toEqual(sorted(gate));
      expect(verdicts(r).some(([, message]) => message!.includes(names))).toBe(true);
    });
  }

  it('reads the definition of each object the expression reads through, and no other', async () => {
    await validate(runtime, gateBridge(), { objectName: 'gp_req', expression: 'record.balance.nope > 1', site: 'validation' });
    expect(reads).toEqual(['gp_req', 'gp_bal']);
  });

  it('CONTROL — a clean rule and formula answer ok with the shape they always had', async () => {
    const expression = "record.title == 'x' && record.balance.remaining > 1";
    for (const [site, source] of [['validation', expression], ['formula', `${expression} ? 1 : 0`]] as const) {
      expect(gateOn(site, 'gp_req', source)).toEqual([]);
      const withGate = await validate(runtime, gateBridge(), { objectName: 'gp_req', expression: source, site });
      const before = await validate(runtime, gateBridge(false), { objectName: 'gp_req', expression: source, site });
      expect(withGate.ok).toBe(true);
      expect([withGate.errors, withGate.warnings]).toEqual([[], []]);
      expect(withGate).toEqual(before);
    }
  });

  it('a bridge that serves no definition answers the shared validator alone, as before', async () => {
    const r = await validate(runtime, gateBridge(false), { objectName: 'gp_req', expression: 'record.days > 3', site: 'validation' });
    expect([r.ok, r.errors, r.warnings]).toEqual([true, [], []]);
  });

  it('a hop target follows the same system-object fence as describe_object', async () => {
    const args = { objectName: 'gp_req', expression: 'record.approver.nope > 1', site: 'validation' };
    // The gate refuses the hop; a server that exposes system objects says so.
    expect(gateOn('validation', 'gp_req', args.expression).map(([level]) => level)).toEqual(['error']);
    const exposed = await validate(runtime, gateBridge(), args, true);
    expect(exposed.ok).toBe(false);
    expect(verdicts(exposed).some(([, message]) => message!.includes('nope'))).toBe(true);
    expect(reads).toEqual(['gp_req', 'sys_user']);
    // By default the target is neither read nor judged: the answer is the one
    // a bridge serving no definition gives, as `describe_object` refuses it.
    reads.length = 0;
    const fenced = await validate(runtime, gateBridge(), args);
    expect(reads).toEqual(['gp_req']);
    expect(fenced).toEqual(await validate(runtime, gateBridge(false), args));
    expect(verdicts(fenced).some(([, message]) => message!.includes('nope'))).toBe(false);
  });

  it('does not judge a flow condition or a template: no definition is read there', async () => {
    await validate(runtime, gateBridge(), { objectName: 'gp_req', expression: 'days > 3', site: 'flow_condition' });
    await validate(runtime, gateBridge(), { objectName: 'gp_req', expression: '{{record.title}}', site: 'template' });
    expect(reads).toEqual([]);
  });
});
