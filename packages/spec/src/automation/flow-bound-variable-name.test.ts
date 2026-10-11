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
 *
 * #22572 closes the family: EVERY position a flow binds a variable by name —
 * `loop` / `map` `iteratorVariable` and `indexVariable`, a `screen`'s
 * `idVariable` and field `name`, a declared variable's `name`, an `assignment`
 * node's targets — and the enumeration pin below holds it closed.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';
import { defineStack } from '../stack.zod';
import {
  AssignmentConfigSchema,
  CreateRecordConfigSchema,
  GetRecordConfigSchema,
  MapConfigSchema,
  ScreenConfigSchema,
  ScreenFieldConfigSchema,
} from './builtin-node-config.zod';
import { LoopConfigSchema, TryCatchConfigSchema } from './control-flow.zod';
import { FLOW_BINDING_KEYS, flowAssignmentTargets, type FlowBindingKey } from './flow-bound-variable-name';
import { flowNodeConfigRefusals } from './flow-node-config-refusals';
import { textSlotTemplateRefusal } from './flow-text-slot-template';
import { FlowSchema, FlowVariableSchema } from './flow.zod';
import * as automation from './index';
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

// ─── #22572 — every binding door, and the enumeration pin ────────────────────

/** A body with one inert node, so a `loop`'s values are judged (a body-less legacy `loop` reads none of them). */
const LOOP_BODY = { nodes: [{ id: 'step', type: 'assignment', label: 'Step', config: { assignments: { touched: true } } }], edges: [] };

/** The automation export each `outputVariable` contract above is published as. */
const OUTPUT_VARIABLE_EXPORTS: Readonly<Record<string, string>> = {
  get_record: 'GetRecordConfigSchema',
  create_record: 'CreateRecordConfigSchema',
  map: 'MapConfigSchema',
  script: 'ScriptConfigSchema',
  subflow: 'SubflowConfigSchema',
};

type Parser = { safeParse(v: unknown): { success: boolean; error?: z.ZodError } };

/** One position a flow binds a variable by name. */
interface BindingSite {
  /** The position, as the rule's vocabulary names it. */
  readonly key: FlowBindingKey;
  /** The row's name in the test titles. */
  readonly label: string;
  /** The automation export that declares a `*Variable` key — what the discovery pin cross-checks. */
  readonly declaredBy?: string;
  /** The contract that declares the position: a config binding `name` there, and where its issue lands. */
  readonly contract?: { readonly schema: Parser; readonly config: (name: string) => unknown; readonly path: (name: string) => string };
  /** A whole flow binding `name` there, and where `FlowSchema`'s issue lands. */
  readonly flow: (name: string) => unknown;
  readonly flowPath: (name: string) => string;
  /** How the remedy reads the bare name: `{{ <read> }}`. */
  readonly read?: (bare: string) => string;
}

/** `flowWith` plus declared variables. */
function flowDeclaring(variables: unknown[]) {
  return { ...flowWith('assignment', { assignments: { touched: true } }), variables };
}

/**
 * Every binding position, one row per site — the table the enumeration pin
 * holds equal to the rule's vocabulary ({@link FLOW_BINDING_KEYS}) and to the
 * `*Variable` keys it discovers in the automation schemas.
 */
const BINDING_SITES: readonly BindingSite[] = [
  ...OUTPUT_VARIABLE_CONTRACTS.map(({ type, schema, base }): BindingSite => ({
    key: 'outputVariable',
    label: `${type} outputVariable`,
    declaredBy: OUTPUT_VARIABLE_EXPORTS[type],
    contract: { schema, config: (name) => ({ ...base, outputVariable: name }), path: () => 'outputVariable' },
    flow: (name) => flowWith(type, { ...base, outputVariable: name }),
    flowPath: () => 'nodes.1.config.outputVariable',
  })),
  {
    key: 'errorVariable',
    label: 'try_catch errorVariable',
    declaredBy: 'TryCatchConfigSchema',
    contract: { schema: TryCatchConfigSchema, config: (name) => ({ try: TRY_REGION, errorVariable: name }), path: () => 'errorVariable' },
    flow: (name) => flowWith('try_catch', { try: TRY_REGION, errorVariable: name }),
    flowPath: () => 'nodes.1.config.errorVariable',
    read: (bare) => `${bare}.message`,
  },
  ...(['iteratorVariable', 'indexVariable'] as const).flatMap((key): BindingSite[] => [
    {
      key,
      label: `loop ${key}`,
      declaredBy: 'LoopConfigSchema',
      contract: { schema: LoopConfigSchema, config: (name) => ({ collection: 'rows', body: LOOP_BODY, [key]: name }), path: () => key },
      flow: (name) => flowWith('loop', { collection: 'rows', body: LOOP_BODY, [key]: name }),
      flowPath: () => `nodes.1.config.${key}`,
    },
    {
      key,
      label: `map ${key}`,
      declaredBy: 'MapConfigSchema',
      contract: { schema: MapConfigSchema, config: (name) => ({ collection: 'rows', flowName: 'per_row', [key]: name }), path: () => key },
      flow: (name) => flowWith('map', { collection: 'rows', flowName: 'per_row', [key]: name }),
      flowPath: () => `nodes.1.config.${key}`,
    },
  ]),
  {
    key: 'idVariable',
    label: 'screen idVariable',
    declaredBy: 'ScreenConfigSchema',
    contract: { schema: ScreenConfigSchema, config: (name) => ({ objectName: 'lead', idVariable: name }), path: () => 'idVariable' },
    flow: (name) => flowWith('screen', { objectName: 'lead', idVariable: name }),
    flowPath: () => 'nodes.1.config.idVariable',
  },
  {
    key: 'screenFieldName',
    label: 'screen fields[].name',
    contract: { schema: ScreenFieldConfigSchema, config: (name) => ({ name, label: 'N', type: 'text' }), path: () => 'name' },
    flow: (name) => flowWith('screen', { fields: [{ name, label: 'N', type: 'text' }] }),
    flowPath: () => 'nodes.1.config.fields.0.name',
  },
  {
    key: 'variableName',
    label: 'flow variables[].name',
    contract: { schema: FlowVariableSchema, config: (name) => ({ name, type: 'text' }), path: () => 'name' },
    flow: (name) => flowDeclaring([{ name, type: 'text' }]),
    flowPath: () => 'variables.0.name',
  },
  {
    key: 'assignmentTarget',
    label: 'assignment assignments map key',
    contract: { schema: AssignmentConfigSchema, config: (name) => ({ assignments: { [name]: 1 } }), path: (name) => `assignments.${name}` },
    flow: (name) => flowWith('assignment', { assignments: { [name]: 1 } }),
    flowPath: (name) => `nodes.1.config.assignments.${name}`,
  },
  {
    key: 'assignmentTarget',
    label: 'assignment bare top-level key',
    contract: { schema: AssignmentConfigSchema, config: (name) => ({ [name]: 1 }), path: (name) => name },
    flow: (name) => flowWith('assignment', { [name]: 1 }),
    flowPath: (name) => `nodes.1.config.${name}`,
  },
  {
    // No contract row: `AssignmentConfigSchema` refuses the legacy array form
    // whole, with the write-the-map prescription; the flow door, which reads
    // every shape the executor binds, judges its items.
    key: 'assignmentTarget',
    label: 'assignment legacy array item variable',
    flow: (name) => flowWith('assignment', { assignments: [{ variable: name, value: 1 }] }),
    flowPath: () => 'nodes.1.config.assignments.0.variable',
  },
];

const CONTRACT_SITES = BINDING_SITES.filter((site) => site.contract !== undefined);

describe('every binding door refuses a `$` name — #22572 closes the family', () => {
  it.each(CONTRACT_SITES)('$label: its contract refuses a dollar-led name at the position, with the remedy', ({ contract, read }) => {
    const message = refusalAt(contract!.schema, contract!.config('$x'), contract!.path('$x'));
    expect(message).toBeDefined();
    expect(message).toContain('`$x` is a `$` name');
    expect(message).toContain(`Name it \`x\` and read it as \`{{ ${read ? read('x') : 'x'} }}\``);
  });

  it.each(BINDING_SITES)('$label: FlowSchema refuses a dollar-led name there, and nothing else', ({ flow, flowPath, read }) => {
    const issues = issuesOf(flow('$x'));
    expect(issues.map(({ path }) => path)).toEqual([flowPath('$x')]);
    expect(issues[0]!.message).toContain(`Name it \`x\` and read it as \`{{ ${read ? read('x') : 'x'} }}\``);
  });

  it.each(BINDING_SITES)('$label: the engine\'s own names are refused as bindings too', ({ flow, flowPath }) => {
    for (const name of ['$record', '$runId', '$loopItems', '$']) {
      expect(issuesOf(flow(name)).map(({ path }) => path), name).toEqual([flowPath(name)]);
    }
  });

  it.each(BINDING_SITES)('$label: a leading blank does not hide the `$` — a trimming executor would bind it', ({ flow, flowPath }) => {
    // `screen`'s `idVariable` and `script`'s `outputVariable` are trimmed by
    // their executors before they bind, so the rule judges the first non-blank
    // character, at every site alike.
    for (const name of [' $x', '\t$record', '\n$x']) {
      expect(issuesOf(flow(name)).map(({ path }) => path), JSON.stringify(name)).toEqual([flowPath(name)]);
    }
  });

  it.each(BINDING_SITES)('CONTROL: $label: a plain name and a `$` past the first character parse clean', ({ contract, flow }) => {
    for (const name of ['x', 'a$b', ' x']) {
      if (contract) expect(contract.schema.safeParse(contract.config(name)).success, name).toBe(true);
      expect(issuesOf(flow(name)), name).toEqual([]);
    }
  });

  it('CONTROL: the defaults are kept — `iteratorVariable` is still `item` on a loop and a map, `$error` on a try_catch', () => {
    const loop = LoopConfigSchema.safeParse({ collection: 'rows', body: LOOP_BODY });
    const map = MapConfigSchema.safeParse({ collection: 'rows', flowName: 'per_row' });
    expect(loop.success && loop.data.iteratorVariable).toBe('item');
    expect(map.success && map.data.iteratorVariable).toBe('item');
    expect(loop.success && loop.data.indexVariable).toBeUndefined();
    expect(issuesOf(flowWith('try_catch', { try: TRY_REGION, errorVariable: '$error' }))).toEqual([]);
  });

  it('defineStack refuses a declared `$` variable with the stack envelope, at the variable', () => {
    const stack = {
      manifest: { id: 'com.example.binding', name: 'binding', version: '1.0.0', type: 'app', namespace: 'bnd' },
      objects: [{ name: 'bnd_task', label: 'Task', fields: { title: { type: 'text', label: 'Title' } } }],
      flows: [flowDeclaring([{ name: '$total', type: 'number' }])],
    };
    let refusal: { code?: unknown; status?: unknown; issues?: Array<{ path: unknown[] }> } | undefined;
    try {
      defineStack(stack as never);
    } catch (e) {
      refusal = e as typeof refusal;
    }
    expect(refusal, 'defineStack must refuse the flow').toBeDefined();
    expect({ code: refusal!.code, status: refusal!.status }).toEqual({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    expect(refusal!.issues!.map((i) => i.path.join('.'))).toEqual(['flows.0.variables.0.name']);
  });

  it('the remedy reads: a loop binding `row` and a body text slot reading `{{ row.name }}` parse clean', () => {
    expect(textSlotTemplateRefusal('Due: {{ $row.name }}')).toBeDefined();
    const body = { nodes: [{ id: 'tell', type: 'notify', label: 'Tell', config: { title: 'Due', message: 'Due: {{ row.name }}', recipients: ['ops'] } }], edges: [] };
    expect(issuesOf(flowWith('loop', { collection: 'rows', iteratorVariable: 'row', body }))).toEqual([]);
  });
});

describe('assignment targets — the names the executor binds, in each of its three shapes', () => {
  it('reads the canonical map\'s keys, a bare config\'s top-level keys, and a legacy array item\'s variable', () => {
    const at = (config: unknown) => flowAssignmentTargets(config).map(({ path, name }) => `${path.join('.')}=${name}`);
    // The map: its keys, and a top-level key beside it is never bound.
    expect(at({ assignments: { a: 1, b: 2 }, c: 3 })).toEqual(['assignments.a=a', 'assignments.b=b']);
    // The bare config: every top-level key.
    expect(at({ a: 1, b: 2 })).toEqual(['a=a', 'b=b']);
    // The legacy array: each item's first non-null `variable` / `name` / `key`, when a non-empty string.
    expect(at({ assignments: [{ variable: 'v', value: 1 }, { name: 'n' }, { key: 'k' }, { variable: null, name: 'm' }, { variable: '' }, 5, null] }))
      .toEqual(['assignments.0.variable=v', 'assignments.1.name=n', 'assignments.2.key=k', 'assignments.3.name=m']);
    for (const config of [null, undefined, [], 'x', 5]) expect(at(config), JSON.stringify(config)).toEqual([]);
  });

  it('a region body\'s assignment is refused at the path the author wrote', () => {
    const region = { nodes: [{ id: 'set', type: 'assignment', label: 'Set', config: { assignments: { $total: 1 } } }], edges: [] };
    expect(issuesOf(flowWith('loop', { collection: 'rows', body: region })).map(({ path }) => path)).toEqual([
      'nodes.1.config.body.nodes.0.config.assignments.$total',
    ]);
  });
});

describe('the enumeration pin — every flow binding is listed, and every listed one carries the rule', () => {
  it('the rule\'s vocabulary and the site table name the same positions', () => {
    expect([...new Set(BINDING_SITES.map((site) => site.key))].sort()).toEqual([...FLOW_BINDING_KEYS].sort());
  });

  it('every `*Variable` key of every automation schema carries the rule — a new one without it turns this red', () => {
    // Discovery by NAME: the binding keys the protocol spells `*Variable`, at
    // any depth of any schema `automation/index.ts` exports. A binding
    // position spelled otherwise (a field's `name`, a variable's `name`, an
    // `assignments` key) cannot be found this way; those are the vocabulary
    // rows above, held by the previous pin.
    const discovered: Array<{ exportName: string; key: string; pattern?: string }> = [];
    for (const [exportName, value] of Object.entries(automation)) {
      if (value === null || (typeof value !== 'object' && typeof value !== 'function') || !('_zod' in value)) continue;
      const json = z.toJSONSchema(value as z.ZodType, { io: 'input', unrepresentable: 'any' });
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (node === null || typeof node !== 'object') return;
        const properties = (node as { properties?: Record<string, { pattern?: string }> }).properties;
        for (const [key, property] of Object.entries(properties ?? {})) {
          if (/Variable$/.test(key)) discovered.push({ exportName, key, pattern: property?.pattern });
        }
        Object.values(node).forEach(walk);
      };
      walk(json);
    }
    for (const { exportName, key, pattern } of discovered) {
      const at = `${exportName}.${key}`;
      expect(FLOW_BINDING_KEYS as readonly string[], at).toContain(key);
      expect(pattern, `${at} publishes no pattern — compose flowBoundVariableNameSchema`).toBeDefined();
      const re = new RegExp(pattern!);
      expect(re.test('x') && re.test('a$b') && re.test(' x'), at).toBe(true);
      expect(re.test('$x') || re.test('$record') || re.test(' $x'), at).toBe(false);
      expect(BINDING_SITES.some((site) => site.declaredBy === exportName && site.key === key), `${at} has no row in BINDING_SITES`).toBe(true);
    }
    // FLOOR: the walk reaches every `*Variable` row of the table, so a walker
    // that silently finds nothing cannot pass the loop above vacuously.
    for (const site of BINDING_SITES.filter((s) => s.declaredBy !== undefined)) {
      expect(discovered.some((d) => d.exportName === site.declaredBy && d.key === site.key), `${site.label} not discovered`).toBe(true);
    }
  });

  it('the positions not spelled `*Variable` carry the rule in the published JSON Schema too', () => {
    const json = (schema: unknown) => z.toJSONSchema(schema as z.ZodType, { io: 'input', unrepresentable: 'any' }) as {
      properties: Record<string, { pattern?: string; propertyNames?: { pattern?: string } }>;
    };
    const patterns = {
      'FlowVariable.name': json(FlowVariableSchema).properties.name?.pattern,
      'ScreenFieldConfig.name': json(ScreenFieldConfigSchema).properties.name?.pattern,
      'AssignmentConfig.assignments (keys)': json(AssignmentConfigSchema).properties.assignments?.propertyNames?.pattern,
    };
    for (const [at, pattern] of Object.entries(patterns)) {
      expect(pattern, at).toBeDefined();
      const re = new RegExp(pattern!);
      expect(re.test('x') && re.test('a$b') && re.test(' x'), at).toBe(true);
      expect(re.test('$x') || re.test(' $x'), at).toBe(false);
    }
  });
});

describe('ADR-0087 — the close-out is registered as a D3 semantic entry of protocol 18', () => {
  const ENTRY_ID = 'flow-binding-name-dollar-refused';

  it('names every remaining binding position, with no D2 conversion', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((e) => e.id === ENTRY_ID);
    expect(entries).toHaveLength(1);
    for (const position of ['iteratorVariable', 'indexVariable', 'idVariable', 'fields[].name', 'variables[].name', 'assignment']) {
      expect(entries[0]!.surface, position).toContain(position);
    }
    expect(entries[0]!.conversionIds ?? []).toEqual([]);
  });

  it('names the step-18 rationale fragment for it', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.rationale).toContain(ENTRY_ID);
  });
});
