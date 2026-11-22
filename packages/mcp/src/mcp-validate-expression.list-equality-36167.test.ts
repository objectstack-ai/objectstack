// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36167] `validate_expression` refuses `record.<list field> == <scalar>`,
 * which answers one constant on every row, as the publish gate refuses it.
 *
 * The gate hands the shared validator the object's list-valued fields
 * (`ExprSchemaHint.multiValueFields`, read through `isMultiValueField`), so a
 * `select` / `user` declared `multiple: true` is a list there. The tool's own
 * field list comes from `describeObject`, whose projection carries no
 * `multiple`; the served definition (`McpDataBridge.servedObjectDefinitionOf`)
 * does, and the tool reads the list-valued fields off it, once, at the sites
 * where it already reads it for the gate's own passes. A bridge without the
 * member answers exactly as before.
 *
 * Driven through the stdio bridge (`createStdioDataBridge`), whose
 * `servedObjectDefinitionOf` is the real one. The gate's sentence is read off
 * `validateStackExpressions` on the same rule or formula field.
 */

import { describe, it, expect } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { AUTHORED_FORMULA_FIELD_NAME, AUTHORED_RULE_NAME, validateStackExpressions } from '@objectstack/lint';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge } from './mcp-http-tools.js';
import { createStdioDataBridge, type StdioProtocolObjectReads } from './stdio-data-bridge.js';

const OBJECT = 'qa_list_eq';

const OPTIONS = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
];

const SERVED = {
  name: OBJECT,
  label: 'List equality',
  sharingModel: 'private',
  fields: {
    title: { type: 'text', label: 'Title', required: true },
    stage: { type: 'select', label: 'Stage', options: OPTIONS, required: true },
    picks: { type: 'select', label: 'Picks', options: OPTIONS, multiple: true },
    watchers: { type: 'user', label: 'Watchers', multiple: true },
    owner: { type: 'user', label: 'Owner', required: true },
  },
};

const PRINCIPAL = { userId: 'u1', isSystem: false } as unknown as ExecutionContext;

function stdioBridge(): McpDataBridge {
  const protocol = {
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

/** The same bridge with `servedObjectDefinitionOf` taken away (a bridge predating it). */
function withoutDefinitions(bridge: McpDataBridge): McpDataBridge {
  const { servedObjectDefinitionOf: _omit, ...rest } = bridge as McpDataBridge & Record<string, unknown>;
  return rest as McpDataBridge;
}

async function validate(
  bridge: McpDataBridge,
  expression: string,
  site: 'validation' | 'formula' | 'flow_condition',
  extra: Record<string, unknown> = {},
) {
  const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'validate_expression', arguments: { objectName: OBJECT, expression, site, ...extra } },
  };
  const res = await runtime.handleHttpRequest(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }),
    { bridge, parsedBody: body } as never,
  );
  const json = (await res.json()) as { result: { content: Array<{ text: string }> } };
  return JSON.parse(json.result.content[0]!.text) as {
    ok: boolean;
    errors: Array<{ code?: string; message: string; params?: Record<string, unknown> }>;
    warnings: Array<{ message: string }>;
  };
}

/** The publish gate's `list-equality` sentences on the same rule or formula field. */
function gateSentences(site: 'validation' | 'formula', expression: string): string[] {
  const subject = site === 'validation'
    ? { ...SERVED, validations: [{ name: AUTHORED_RULE_NAME, type: 'script', condition: expression, message: 'm' }] }
    : { ...SERVED, fields: { ...SERVED.fields, [AUTHORED_FORMULA_FIELD_NAME]: { type: 'formula', label: 'F', expression } } };
  return validateStackExpressions({ objects: [subject] })
    .filter((i) => i.severity !== 'warning' && i.message.includes('holds a list'))
    .map((i) => i.message);
}

const listEquality = (r: Awaited<ReturnType<typeof validate>>) => r.errors.filter((e) => e.code === 'list-equality');

describe('validate_expression — list-equality on a multiple: true field (#36167)', () => {
  for (const [site, expression, reference] of [
    ['validation', "record.picks == 'a'", 'record.picks'],
    ['validation', "'u1' != record.watchers", 'record.watchers'],
    ['formula', "record.picks == 'a' ? 1 : 0", 'record.picks'],
  ] as const) {
    it(`${site}: refuses \`${expression}\` once, in the publish gate's words`, async () => {
      const gate = gateSentences(site, expression);
      expect(gate).toHaveLength(1);
      const r = await validate(stdioBridge(), expression, site);
      expect(r.ok).toBe(false);
      const refused = listEquality(r);
      expect(refused).toHaveLength(1);
      expect(refused[0]!.params).toMatchObject({ reference });
      expect(refused[0]!.message).toContain(`\`${reference}\` holds a list`);
      expect(refused[0]!.message).toContain(' in ');
      expect(refused.map((e) => e.message)).toEqual(gate);
      // Judged once: the gate's own passes (`judgeAuthoredSiteExpression`)
      // leave the shared validator to the tool, so no second sentence.
      expect(r.errors.filter((e) => e.message.includes('holds a list'))).toHaveLength(1);
    });
  }

  it('a bridge that serves no definition answers as before: a multiple: true select is not judged', async () => {
    const r = await validate(withoutDefinitions(stdioBridge()), "record.picks == 'a'", 'validation');
    expect(listEquality(r)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  for (const [site, expression] of [
    ['validation', "'a' in record.picks"],
    ['validation', 'record.watchers != null'],
    ['validation', "record.stage == 'a'"],
    ['validation', "record.owner == 'u1'"],
    ['formula', "record.stage == 'a' ? 1 : 0"],
  ] as const) {
    it(`CONTROL — ${site}: \`${expression}\` reads ok, as before`, async () => {
      const r = await validate(stdioBridge(), expression, site);
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r).toEqual(await validate(withoutDefinitions(stdioBridge()), expression, site));
    });
  }

  // A record-triggered flow's condition reads the trigger record flattened, so
  // a bare `picks` is the field, as the type pass reads it.
  it('flow_condition: refuses the bare `picks == \'a\'` and `record.picks == \'a\'`', async () => {
    for (const [expression, reference] of [["picks == 'a'", 'picks'], ["record.picks == 'a'", 'record.picks']] as const) {
      const r = await validate(stdioBridge(), expression, 'flow_condition');
      expect(listEquality(r).map((e) => e.params?.reference)).toEqual([reference]);
      expect(r.ok).toBe(false);
    }
  });

  it('flow_condition: the bare rewrite is parenthesised whole and reads ok itself', async () => {
    const [refused] = listEquality(await validate(stdioBridge(), "record.stage == 'b' && picks != 'a'", 'flow_condition'));
    expect(refused!.params?.rewrite).toBe('(picks == null || !("a" in picks))');
    const r = await validate(stdioBridge(), `record.stage == 'b' && ${refused!.params?.rewrite as string}`, 'flow_condition');
    expect(listEquality(r)).toEqual([]);
  });

  // A flow no record write fires runs on what its entrance handed it: `picks`
  // is not proven to be the field there, so `picks == 'a'` can be correct.
  it.each(['api', 'schedule', 'none'] as const)(
    'CONTROL — flow_condition with triggerKind %s: neither the bare nor the record. read is judged',
    async (triggerKind) => {
      for (const expression of ["picks == 'a'", "record.picks == 'a'"]) {
        expect(listEquality(await validate(stdioBridge(), expression, 'flow_condition', { triggerKind }))).toEqual([]);
      }
    },
  );

  it('CONTROL — flow_condition: a bare name a declared variable holds is not the field; without the member, as before', async () => {
    const variables = [{ name: 'picks', type: 'text' }];
    expect(listEquality(await validate(stdioBridge(), "picks == 'a'", 'flow_condition', { variables }))).toEqual([]);
    expect(listEquality(await validate(withoutDefinitions(stdioBridge()), "picks == 'a'", 'flow_condition'))).toEqual([]);
  });
});
