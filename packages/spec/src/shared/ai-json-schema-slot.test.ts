// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  SUBSCHEMA_MAP_KEYWORDS,
  SUBSCHEMA_SLOT_KEYWORDS,
  TYPE_SCOPED_KEYWORDS,
  findUntypedSubschemas,
} from './ai-json-schema-slot';
import { ActionSchema } from '../ui/action.zod';
import { AgentSchema, StructuredOutputConfigSchema } from '../ai/agent.zod';

/*
 * The mirror pin. These three lists are the cloud AI service's own guard,
 * copied verbatim from `packages/service-ai/src/tools/json-schema-untyped.ts`
 * as read at cloud `main` 55f04d12 (its `TYPE_SCOPED_KEYWORDS`,
 * `SUBSCHEMA_MAPS` and `SUBSCHEMA_SLOTS`). That guard is the one both
 * AI-runtime readers of these slots call, and the declaration refuses exactly
 * what it refuses. A change to any list here is a change to the mirror: re-read
 * that file at cloud `main` first and move this pin with it, never alone.
 */
const CLOUD_TYPE_SCOPED_KEYWORDS = [
  'properties', 'required', 'additionalProperties', 'patternProperties', 'propertyNames',
  'minProperties', 'maxProperties', 'items', 'prefixItems', 'contains', 'minItems', 'maxItems',
  'uniqueItems', 'minLength', 'maxLength', 'pattern', 'format', 'minimum', 'maximum',
  'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
];
const CLOUD_SUBSCHEMA_MAPS = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'];
const CLOUD_SUBSCHEMA_SLOTS = [
  'items', 'additionalProperties', 'contains', 'propertyNames', 'not', 'if', 'then', 'else',
  'unevaluatedProperties', 'unevaluatedItems', 'anyOf', 'oneOf', 'allOf', 'prefixItems',
];

/** Keys the runtime does NOT list, so none of them is refused alone on an untyped node. */
const NOT_TYPE_SCOPED: Record<string, unknown> = {
  enum: ['a', 'b'],
  const: 'a',
  dependentRequired: { a: ['b'] },
  $ref: '#/$defs/x',
  not: { type: 'string' },
  anyOf: [{ type: 'string' }],
  oneOf: [{ type: 'string' }],
  allOf: [{ type: 'string' }],
  if: { type: 'string' },
  then: { type: 'string' },
  else: { type: 'string' },
  title: 't',
  description: 'd',
  default: 'a',
};

const LONG_DESCRIPTION = 'Summarize a support case into a short, structured triage record for the agent.';

function action(outputSchema: unknown) {
  return ActionSchema.safeParse({
    name: 'summarize_case',
    label: 'Summarize Case',
    target: 'noop',
    ai: { exposed: true, description: LONG_DESCRIPTION, outputSchema },
  });
}

function agent(schema: unknown) {
  return AgentSchema.safeParse({
    name: 'triage_agent',
    label: 'Triage Agent',
    role: 'Case triage',
    instructions: 'Return the triage record.',
    structuredOutput: { format: 'json_schema', schema },
  });
}

type Parsed = ReturnType<typeof action> | ReturnType<typeof agent>;

/** The custom issues a parse raised, as `[dotted path, message]` pairs. */
function issues(result: Parsed): [string, string][] {
  if (result.success) return [];
  return result.error.issues.map((i) => [i.path.join('.'), i.message]);
}

/** Every path the walker reports, dotted, for a bare schema. */
function walk(schema: unknown): string[] {
  return findUntypedSubschemas(schema).map((f) => f.path.join('.'));
}

describe('the AI JSON-Schema slot mirrors the cloud guard exactly', () => {
  it('pins the 22 type-scoped keywords, in the runtime order', () => {
    expect([...TYPE_SCOPED_KEYWORDS]).toEqual(CLOUD_TYPE_SCOPED_KEYWORDS);
    expect(TYPE_SCOPED_KEYWORDS).toHaveLength(22);
  });

  it('pins the 5 map keywords and the 14 slot keywords it descends into', () => {
    expect([...SUBSCHEMA_MAP_KEYWORDS]).toEqual(CLOUD_SUBSCHEMA_MAPS);
    expect([...SUBSCHEMA_SLOT_KEYWORDS]).toEqual(CLOUD_SUBSCHEMA_SLOTS);
  });
});

describe('both slots refuse an untyped subschema at its path (triage pins)', () => {
  const untypedRoot = { properties: { name: { type: 'string' } }, required: ['name'] };
  const untypedChild = {
    type: 'object',
    properties: { customer: { properties: { name: { type: 'string' } } } },
  };

  it('action.ai.outputSchema: an untyped schema root with properties is refused at the slot', () => {
    const got = issues(action(untypedRoot));
    expect(got).toHaveLength(1);
    expect(got[0][0]).toBe('ai.outputSchema');
    expect(got[0][1]).toMatch(/^ai\.outputSchema uses "properties" without a "type"/);
    expect(got[0][1]).toContain('declare its "type"');
  });

  it('action.ai.outputSchema: an untyped child is refused at its own path', () => {
    const got = issues(action(untypedChild));
    expect(got).toHaveLength(1);
    expect(got[0][0]).toBe('ai.outputSchema.properties.customer');
    expect(got[0][1]).toMatch(/^ai\.outputSchema\.properties\.customer uses "properties" without a "type"/);
  });

  it('agent.structuredOutput.schema: an untyped schema root with properties is refused at the slot', () => {
    const got = issues(agent(untypedRoot));
    expect(got).toHaveLength(1);
    expect(got[0][0]).toBe('structuredOutput.schema');
    expect(got[0][1]).toMatch(/^structuredOutput\.schema uses "properties" without a "type"/);
  });

  it('agent.structuredOutput.schema: an untyped child is refused at its own path', () => {
    const got = issues(agent(untypedChild));
    expect(got).toHaveLength(1);
    expect(got[0][0]).toBe('structuredOutput.schema.properties.customer');
  });

  it('the structured-output config refuses it on its own, at `schema`', () => {
    const result = StructuredOutputConfigSchema.safeParse({ format: 'json_schema', schema: untypedRoot });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual(['schema']);
  });

  it('control: the same schemas with "type" declared are accepted on both slots', () => {
    const typedRoot = { type: 'object', ...untypedRoot };
    const typedChild = {
      type: 'object',
      properties: { customer: { type: 'object', properties: { name: { type: 'string' } } } },
    };
    for (const schema of [typedRoot, typedChild]) {
      expect(issues(action(schema))).toEqual([]);
      expect(action(schema).success).toBe(true);
      expect(agent(schema).success).toBe(true);
    }
  });

  it('a nested untyped subschema is refused at its nested path', () => {
    const schema = {
      type: 'object',
      properties: {
        lines: {
          type: 'array',
          items: { type: 'object', properties: { sku: { pattern: '^[A-Z]+$' } } },
        },
      },
    };
    expect(issues(action(schema)).map(([p]) => p)).toEqual(['ai.outputSchema.properties.lines.items.properties.sku']);
    expect(issues(agent(schema)).map(([p]) => p)).toEqual(['structuredOutput.schema.properties.lines.items.properties.sku']);
    expect(issues(action(schema))[0][1]).toContain('uses "pattern" without a "type"');
  });

  it('an untyped node under $defs is refused at its path', () => {
    const schema = {
      type: 'object',
      properties: { address: { $ref: '#/$defs/address' } },
      $defs: { address: { properties: { city: { type: 'string' } } } },
    };
    expect(issues(action(schema)).map(([p]) => p)).toEqual(['ai.outputSchema.$defs.address']);
    expect(issues(agent(schema)).map(([p]) => p)).toEqual(['structuredOutput.schema.$defs.address']);
  });

  it('boolean subschemas and {} are accepted', () => {
    for (const schema of [
      {},
      { type: 'object', properties: { anything: true, nothing: false, open: {} }, additionalProperties: false },
      { type: 'array', items: true },
    ]) {
      expect(action(schema).success).toBe(true);
      expect(agent(schema).success).toBe(true);
    }
  });

  it('an untyped node carrying only enum is accepted', () => {
    const schema = { type: 'object', properties: { status: { enum: ['open', 'closed'] } } };
    expect(action(schema).success).toBe(true);
    expect(agent(schema).success).toBe(true);
  });
});

describe('the walker, keyword by keyword and position by position', () => {
  it('refuses each of the 22 keywords alone on an untyped node, naming it', () => {
    for (const keyword of TYPE_SCOPED_KEYWORDS) {
      const found = findUntypedSubschemas({ [keyword]: 1 });
      expect(found, keyword).toEqual([{ path: [], keyword }]);
    }
  });

  it('tests presence, not value: a listed key holding undefined still counts', () => {
    expect(findUntypedSubschemas({ minimum: undefined })).toEqual([{ path: [], keyword: 'minimum' }]);
  });

  it('names the first keyword present in list order', () => {
    expect(findUntypedSubschemas({ pattern: 'x', items: {}, required: [] })[0].keyword).toBe('required');
  });

  it('accepts every non-listed keyword alone on an untyped node', () => {
    for (const [key, value] of Object.entries(NOT_TYPE_SCOPED)) {
      expect(walk({ [key]: value }), key).toEqual([]);
    }
  });

  it('reads "type" as present for any value, and absent only when it is undefined', () => {
    expect(walk({ type: ['string', 'null'], minLength: 1 })).toEqual([]);
    expect(walk({ type: 'not-a-json-type', minLength: 1 })).toEqual([]);
    expect(walk({ type: null, minLength: 1 })).toEqual([]);
    expect(walk({ type: undefined, minLength: 1 })).toEqual(['']);
  });

  it('accepts non-object schemas: booleans, null, arrays and scalars have no findings', () => {
    for (const schema of [true, false, null, [], [{ properties: {} }], 'string', 1]) {
      expect(walk(schema)).toEqual([]);
    }
  });

  it('descends every map keyword, at <keyword>.<name>', () => {
    for (const key of SUBSCHEMA_MAP_KEYWORDS) {
      expect(walk({ type: 'object', [key]: { a: { type: 'string' }, b: { maxLength: 3 } } }), key)
        .toEqual([`${key}.b`]);
    }
  });

  it('descends every slot keyword, as one subschema and as an array of them', () => {
    for (const key of SUBSCHEMA_SLOT_KEYWORDS) {
      expect(walk({ type: 'object', [key]: { maxLength: 3 } }), key).toEqual([key]);
      expect(walk({ type: 'object', [key]: [{ type: 'string' }, { maxLength: 3 }] }), `${key}[]`)
        .toEqual([`${key}.1`]);
    }
  });

  it('descends under typed and untyped parents alike, and reports every offender', () => {
    const schema = {
      properties: {
        a: { items: { minimum: 0 } },
        b: { type: 'object', additionalProperties: { format: 'email' } },
      },
    };
    expect(walk(schema)).toEqual(['', 'properties.a', 'properties.a.items', 'properties.b.additionalProperties']);
  });

  it('does not follow $ref', () => {
    expect(walk({ type: 'object', properties: { a: { $ref: '#/definitions/missing' } } })).toEqual([]);
  });

  it('does not descend a keyword the runtime does not walk', () => {
    expect(walk({ type: 'object', dependentRequired: { a: { properties: {} } }, examples: [{ items: 1 }] })).toEqual([]);
  });

  it('terminates on a cyclic object instead of overflowing', () => {
    const node: Record<string, unknown> = { type: 'object' };
    node.properties = { self: node };
    expect(walk(node)).toEqual([]);
  });
});
