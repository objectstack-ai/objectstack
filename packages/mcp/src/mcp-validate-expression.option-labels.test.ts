// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28715] `validate_expression` refuses the `label()` call the object save
 * door refuses: `label(record.<field>)` on a field that declares no options.
 *
 * ## The state this closes
 *
 * The object door hands the shared validator the object's option-bearing
 * fields (`ExprSchemaHint.optionFields`) on a formula field's `expression`, so
 * `label(record.first)` on a text field is refused there as
 * `label-field-no-options`. The MCP tool judged the same expression with the
 * same validator, but its hint carried only field names and types: both
 * bridges project fields to name/type/label/required. So the tool answered
 * `ok: true` for a formula the door then refused at save.
 *
 * ## The fix, and what is pinned here
 *
 * Each bridge answers `optionFieldsOf(name)` from the object `describeObject`
 * reads, through `@objectstack/formula`'s `declaresOptions`, and the tool
 * hands that list to the validator on the `formula` site, the one site the
 * door judges it on. `describe_object` serves what it served before.
 *
 * Which predicate: measured on real kernels (`ObjectKernel` + `MetadataPlugin`
 * + `ObjectQLPlugin`, with and without an `environmentId`), the protocol's
 * merged object listing, which both bridges read, and the metadata service's
 * by-name read, the fallback on a host with no merged read, serve a field
 * bound to a shared picklist with the list's resolved `options` beside its
 * `picklist` name. That is the served form `declaresOptions` reads; the door
 * reads the AUTHORED body (no `options` on a picklist-bound field) and so
 * uses `declaresOptionsOnceServed`. {@link SERVED} below is that measured
 * shape and {@link authored} the body an author saves.
 *
 * This file drives the stdio bridge (`createStdioDataBridge`) through the
 * shared tool handler; the HTTP bridge's answer is pinned in
 * `packages/runtime/src/domains/mcp-option-fields-read.test.ts` on the same
 * shape. Refusals assert `code` and the named field; the parity case asserts
 * the tool's sentence is the one the door carries.
 */

import { describe, it, expect } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { runRuntimeAuthoringRules } from '@objectstack/lint';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge } from './mcp-http-tools.js';
import { createStdioDataBridge, type StdioProtocolObjectReads } from './stdio-data-bridge.js';

const OBJECT = 'qaformula_p4';

/** The fields an author saves (the door judges this body). */
const AUTHORED_FIELDS = {
  first: { type: 'text', label: 'First' },
  kind: { type: 'select', label: 'Kind', options: [{ value: 'clean', label: 'Clean' }] },
  stage: { type: 'radio', label: 'Stage', options: [{ value: 'draft', label: 'Draft' }] },
  // Bound to a shared picklist: authored with no `options`.
  tier: { type: 'select', label: 'Tier', picklist: 'qa_tiers' },
};

/** The shared list `tier` names. */
const QA_TIERS = { name: 'qa_tiers', label: 'Tiers', options: [{ value: 'gold', label: 'Gold' }] };

/** The same object as the protocol serves it: `tier` carries its list's options (measured). */
const SERVED = {
  name: OBJECT,
  label: 'P4',
  fields: {
    ...AUTHORED_FIELDS,
    tier: { ...AUTHORED_FIELDS.tier, options: QA_TIERS.options },
  },
};

/** The authored object with a formula field `pf` holding `expression`. */
const authored = (expression: string) => ({
  name: OBJECT,
  label: 'P4',
  // Keeps `security-owd-unset` quiet, so a refusal is the expression rule's.
  sharingModel: 'private',
  fields: { ...AUTHORED_FIELDS, pf: { type: 'formula', label: 'PF', expression } },
});

const PRINCIPAL = { userId: 'u1', isSystem: false } as unknown as ExecutionContext;

/** The stdio bridge over a protocol that serves {@link SERVED}. */
function stdioBridge(): McpDataBridge {
  const protocol: StdioProtocolObjectReads = {
    getMetaItems: async () => ({ type: 'object', items: [SERVED] }),
    getMetaItem: async ({ name }: { name: string }) => ({ type: 'object', name, item: name === OBJECT ? SERVED : undefined }),
  } as unknown as StdioProtocolObjectReads;
  return createStdioDataBridge({
    engine: {} as unknown as IDataEngine,
    metadataService: { listObjects: async () => [], getObject: async () => undefined } as unknown as IMetadataService,
    protocol: () => protocol,
    resolvePrincipal: async () => PRINCIPAL,
  });
}

/** The same bridge with `optionFieldsOf` taken away (a bridge predating it). */
function withoutOptionFields(bridge: McpDataBridge): McpDataBridge {
  const { optionFieldsOf: _omit, ...rest } = bridge as McpDataBridge & Record<string, unknown>;
  return rest as McpDataBridge;
}

async function callTool(bridge: McpDataBridge, name: string, args: Record<string, unknown>) {
  const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
  const res = await runtime.handleHttpRequest(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }),
    { bridge, parsedBody: body } as never,
  );
  const json = (await res.json()) as { result: { content: Array<{ text: string }> } };
  return JSON.parse(json.result.content[0]!.text);
}

const validate = (bridge: McpDataBridge, expression: string, site?: string) =>
  callTool(bridge, 'validate_expression', { objectName: OBJECT, expression, ...(site ? { site } : {}) });

const codes = (r: { errors: Array<{ code?: string }> }) => r.errors.map((e) => e.code);

describe('validate_expression judges label() targets as the object door does (#28715)', () => {
  it('the stdio bridge answers the served object\'s option-bearing fields, picklist-bound included', async () => {
    const bridge = stdioBridge();
    expect(await bridge.optionFieldsOf!(OBJECT)).toEqual(['kind', 'stage', 'tier']);
    expect(await bridge.optionFieldsOf!('qa_absent')).toBeNull();
  });

  for (const expression of ['label(record.first)', 'label(record.kind) + label(record.first)']) {
    it(`⭐ LIT — \`${expression}\` is refused, naming \`first\``, async () => {
      const r = await validate(stdioBridge(), expression);
      expect(r.ok).toBe(false);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatchObject({ code: 'label-field-no-options', params: { field: 'first' } });
    });
  }

  for (const expression of [
    'label(record.kind)',
    "label(record.kind) + ' · ' + label(record.stage)",
    'record.first + label(record.kind)',
    // Bound to a shared picklist: the served field carries the list's options.
    'label(record.tier)',
    "label(record.tier) + ' / ' + label(record.kind)",
  ]) {
    it(`CONTROL — \`${expression}\` (option-bearing fields) reads ok`, async () => {
      const r = await validate(stdioBridge(), expression);
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
    });
  }

  it('CONTROL — an unknown field keeps its unknown-field refusal and gets no second one', async () => {
    const r = await validate(stdioBridge(), 'label(record.nope)');
    expect(codes(r)).toEqual(['unknown-field']);
  });

  it('CONTROL — every other site answers exactly what it answered before (the door judges label() targets on a formula only)', async () => {
    for (const [site, expression] of [
      ['validation', "label(record.first) == 'x'"],
      ['flow_condition', "label(first) == 'x'"],
      ['template', '{{ label(record.first) }}'],
    ] as const) {
      const before = await validate(withoutOptionFields(stdioBridge()), expression, site);
      const after = await validate(stdioBridge(), expression, site);
      expect(after, `${site}: ${expression}`).toEqual(before);
      expect(codes(after)).not.toContain('label-field-no-options');
    }
  });

  it('CONTROL — a bridge without optionFieldsOf answers as before: no label() target check', async () => {
    const r = await validate(withoutOptionFields(stdioBridge()), 'label(record.first)');
    expect(codes(r)).not.toContain('label-field-no-options');
    expect(r.ok).toBe(true);
  });

  it('describe_object serves the same projection as before: no options reading on its answer', async () => {
    const answer = await callTool(stdioBridge(), 'describe_object', { objectName: OBJECT });
    expect(Object.keys(answer).sort()).toEqual(['enableFeatures', 'fields', 'label', 'name']);
    for (const field of answer.fields) expect(Object.keys(field).sort()).toEqual(['label', 'name', 'required', 'type']);
  });

  it('PARITY — the tool and the object door give one verdict, in one sentence, for each expression', async () => {
    for (const expression of [
      'label(record.first)',
      'label(record.kind) + label(record.first)',
      'label(record.kind)',
      'label(record.tier)',
      'label(record.nope)',
    ]) {
      const tool = await validate(stdioBridge(), expression);
      const door = runRuntimeAuthoringRules({ type: 'object', item: authored(expression), context: { objects: [] } });
      const doorErrors = door.errors.filter((f) => f.rule === 'expression-invalid');
      expect(tool.ok, expression).toBe(doorErrors.length === 0);
      expect(tool.errors.length, expression).toBe(doorErrors.length);
      tool.errors.forEach((e: { message: string }, i: number) => {
        expect(doorErrors[i]!.message, expression).toContain(e.message);
      });
    }
  });
});
