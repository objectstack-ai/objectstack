// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22502 — the `$` names are the flow engine's at the BINDING doors too. A
 * node's `outputVariable` and a `try_catch` `errorVariable` refuse a `$` name
 * (the engine's own `$error` excepted, as `errorVariable`'s default), with the
 * remedy the text-slot judge already gives: the same name without the `$`,
 * read as `{{ name }}`. These pins hold the rule at every contract that
 * composes it, at the `FlowSchema` door (a region body included), at the stack
 * door, and in the published JSON Schema; and that the remedy's spelling is one
 * the text-slot judge reads.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';
import { defineStack } from '../stack.zod';
import { CreateRecordConfigSchema, GetRecordConfigSchema, MapConfigSchema } from './builtin-node-config.zod';
import { TryCatchConfigSchema } from './control-flow.zod';
import { flowNodeConfigRefusals } from './flow-node-config-refusals';
import { textSlotTemplateRefusal } from './flow-text-slot-template';
import { FlowSchema } from './flow.zod';
import { ScriptConfigSchema, SubflowConfigSchema } from './schemaless-node-config.zod';

/** Every contract with an `outputVariable`, with the smallest config it accepts. */
const OUTPUT_VARIABLE_CONTRACTS = [
  { type: 'get_record', schema: GetRecordConfigSchema, base: { objectName: 'lead' } },
  { type: 'create_record', schema: CreateRecordConfigSchema, base: { objectName: 'lead' } },
  { type: 'map', schema: MapConfigSchema, base: { collection: 'rows', flowName: 'per_row' } },
  { type: 'script', schema: ScriptConfigSchema, base: { function: 'score_lead' } },
  { type: 'subflow', schema: SubflowConfigSchema, base: { flowName: 'child' } },
] as const;

const TRY_REGION = { nodes: [{ id: 'risky', type: 'assignment', label: 'R', config: { assignments: { a: 1 } } }], edges: [] };

/** The refusal sentence a contract gives at `key`, or `undefined` when it accepts the config. */
function refusalAt(schema: { safeParse(v: unknown): { success: boolean; error?: z.ZodError } }, config: unknown, key: string) {
  const r = schema.safeParse(config);
  if (r.success) return undefined;
  return r.error!.issues.find((i) => i.path.join('.') === key)?.message;
}

/** start → one node of `type` → end. */
function flowWith(type: string, config: unknown) {
  return {
    name: 'binding_probe',
    label: 'Binding probe',
    type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'n', type, label: 'N', config },
      { id: 'done', type: 'end', label: 'Done' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'n' },
      { id: 'e2', source: 'n', target: 'done' },
    ],
  };
}

function issuesOf(flow: unknown) {
  const r = FlowSchema.safeParse(flow);
  return r.success ? [] : r.error.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
}

describe('outputVariable — a `$` name is the engine\'s, on every contract that binds one', () => {
  // No `$x` in the title: `it.each` would read it as a property of the row.
  it.each(OUTPUT_VARIABLE_CONTRACTS)('$type refuses a dollar-led name with the remedy: `x`, read as `{{ x }}`', ({ schema, base }) => {
    const message = refusalAt(schema, { ...base, outputVariable: '$x' }, 'outputVariable');
    expect(message).toBeDefined();
    expect(message).toContain('`$x` is a `$` name');
    expect(message).toContain('Name it `x` and read it as `{{ x }}`.');
  });

  it.each(OUTPUT_VARIABLE_CONTRACTS)('$type refuses every `$` name — the engine\'s own included', ({ schema, base }) => {
    for (const name of ['$record', '$error', '$', '$$x']) {
      expect(refusalAt(schema, { ...base, outputVariable: name }, 'outputVariable'), name).toBeDefined();
    }
  });

  it.each(OUTPUT_VARIABLE_CONTRACTS)('CONTROL: $type accepts a plain name, a `$` past the first character, and no key', ({ schema, base }) => {
    for (const config of [{ ...base, outputVariable: 'x' }, { ...base, outputVariable: 'a$b' }, base]) {
      expect(schema.safeParse(config).success, JSON.stringify(config)).toBe(true);
    }
  });

  it('a non-string keeps the type refusal it had — the remedy is for a `$` name only', () => {
    const message = refusalAt(GetRecordConfigSchema, { objectName: 'lead', outputVariable: 42 }, 'outputVariable');
    expect(message).toBeDefined();
    expect(message).not.toContain('`$` name');
  });
});

describe('errorVariable — the engine\'s own `$error`, or a name without a `$`', () => {
  it('refuses `$caught` with the remedy: `caught`, read as `{{ caught.message }}`, or the default', () => {
    const message = refusalAt(TryCatchConfigSchema, { try: TRY_REGION, errorVariable: '$caught' }, 'errorVariable');
    expect(message).toBeDefined();
    expect(message).toContain('`$caught` is a `$` name');
    expect(message).toContain('Name it `caught` and read it as `{{ caught.message }}`');
    expect(message).toContain('delete `errorVariable` and read the default `{{ $error.message }}`');
  });

  it('refuses every other `$` name — another engine variable, a near miss of `$error`, a bare `$`', () => {
    for (const name of ['$record', '$errors', '$error.x', '$']) {
      expect(refusalAt(TryCatchConfigSchema, { try: TRY_REGION, errorVariable: name }, 'errorVariable'), name).toBeDefined();
    }
  });

  it('CONTROL: the default `$error`, an explicit `$error` and a plain `caught` are accepted', () => {
    const absent = TryCatchConfigSchema.safeParse({ try: TRY_REGION });
    expect(absent.success && absent.data.errorVariable).toBe('$error');
    for (const name of ['$error', 'caught']) {
      const r = TryCatchConfigSchema.safeParse({ try: TRY_REGION, errorVariable: name });
      expect(r.success && r.data.errorVariable, name).toBe(name);
    }
  });
});

describe('the doors — FlowSchema, a region body, the stack, the save door', () => {
  it('FlowSchema refuses `errorVariable: \'$caught\'` at the key, through the one node-config judge', () => {
    const config = { try: TRY_REGION, errorVariable: '$caught' };
    expect(flowNodeConfigRefusals('try_catch', config).map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'node-config-refused-by-contract', path: 'errorVariable' },
    ]);
    const issues = issuesOf(flowWith('try_catch', config));
    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([{ code: 'custom', path: 'nodes.1.config.errorVariable' }]);
    expect(issues[0]!.message).toContain('Name it `caught` and read it as `{{ caught.message }}`');
  });

  it('FlowSchema refuses `outputVariable: \'$x\'` inside a region body, at the path the author wrote', () => {
    const region = { nodes: [{ id: 'g', type: 'get_record', label: 'G', config: { objectName: 'lead', outputVariable: '$x' } }], edges: [] };
    const issues = issuesOf(flowWith('try_catch', { try: region }));
    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'custom', path: 'nodes.1.config.try.nodes.0.config.outputVariable' },
    ]);
    expect(issues[0]!.message).toContain('Name it `x` and read it as `{{ x }}`.');
  });

  it('the remedy reads: `caught` bound and `{{ caught.message }}` in the catch region\'s text slot parse clean', () => {
    // Why the binding door refuses at all: the text-slot judge refuses a hole
    // over a `$` name the engine does not bind, so `$caught` could be bound
    // and never read.
    expect(textSlotTemplateRefusal('Failed: {{ $caught.message }}')).toBeDefined();
    expect(textSlotTemplateRefusal('Failed: {{ caught.message }}')).toBeUndefined();
    const flow = flowWith('try_catch', {
      try: TRY_REGION,
      catch: { nodes: [{ id: 'tell', type: 'notify', label: 'Tell', config: { title: 'Sync failed', message: 'Failed: {{ caught.message }}', recipients: ['ops'] } }], edges: [] },
      errorVariable: 'caught',
    });
    expect(issuesOf(flow)).toEqual([]);
  });

  it('defineStack refuses the flow with the stack envelope, and the save door at the key', () => {
    const stack = {
      manifest: { id: 'com.example.binding', name: 'binding', version: '1.0.0', type: 'app', namespace: 'bnd' },
      objects: [{ name: 'bnd_task', label: 'Task', fields: { title: { type: 'text', label: 'Title' } } }],
      flows: [flowWith('create_record', { objectName: 'bnd_task', outputVariable: '$task' })],
    };
    let refusal: { code?: unknown; status?: unknown; issues?: Array<{ path: unknown[] }> } | undefined;
    try {
      defineStack(stack as never);
    } catch (e) {
      refusal = e as typeof refusal;
    }
    expect(refusal, 'defineStack must refuse the flow').toBeDefined();
    expect({ code: refusal!.code, status: refusal!.status }).toEqual({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    expect(refusal!.issues!.map((i) => i.path.join('.'))).toEqual(['flows.0.nodes.1.config.outputVariable']);

    const schema = getMetadataTypeSchema('flow') as unknown as typeof FlowSchema;
    const saved = schema.safeParse(flowWith('create_record', { objectName: 'bnd_task', outputVariable: '$task' }));
    expect(saved.success ? [] : saved.error.issues.map((i) => i.path.join('.'))).toEqual(['nodes.1.config.outputVariable']);
  });
});

describe('declared = enforced — the published JSON Schema states the rule', () => {
  it('each binding key carries a `pattern` that refuses exactly what the parse refuses', () => {
    const keyed = [
      ...OUTPUT_VARIABLE_CONTRACTS.map(({ type, schema }) => ({ type, schema, key: 'outputVariable' })),
      { type: 'try_catch', schema: TryCatchConfigSchema, key: 'errorVariable' },
    ];
    for (const { type, schema, key } of keyed) {
      const json = z.toJSONSchema(schema as z.ZodType, { io: 'input', unrepresentable: 'any' }) as {
        properties: Record<string, { pattern?: string }>;
      };
      const pattern = json.properties[key]?.pattern;
      expect(pattern, `${type}.${key}`).toBeDefined();
      const re = new RegExp(pattern!);
      for (const name of ['x', 'a$b', '']) expect(re.test(name), `${type}.${key} ${name}`).toBe(true);
      for (const name of ['$x', '$record', '$']) expect(re.test(name), `${type}.${key} ${name}`).toBe(false);
      expect(re.test('$error'), `${type}.${key} $error`).toBe(key === 'errorVariable');
    }
  });
});

describe('ADR-0087 — the narrowing is registered as a D3 semantic entry of protocol 18', () => {
  const ENTRY_ID = 'flow-binding-variable-dollar-name-refused';

  it('names both keys, with no D2 conversion', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((e) => e.id === ENTRY_ID);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.surface).toContain('outputVariable');
    expect(entries[0]!.surface).toContain('errorVariable');
    expect(entries[0]!.conversionIds ?? []).toEqual([]);
  });

  it('names the step-18 rationale fragment for it', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.rationale).toContain(ENTRY_ID);
  });
});
