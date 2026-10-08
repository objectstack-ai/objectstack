// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21982] The build doors refuse a KEY a builtin node's executor contract does
 * not declare — the key half of the executor-contract arm of
 * `flowNodeConfigRefusals`, beside the value half (#21898) and the presence
 * half (#20316) — and that arm is the ONE judge of a builtin's undeclared key.
 *
 * Pass 1 covered `script` and `subflow`, which publish no descriptor
 * `configSchema`, so no door before the run judged their keys. The remainder
 * covers every other builtin but `try_catch`: a `notify` node carrying
 * `bogusKey` passed `FlowSchema`, `objectstack validate` and `objectstack
 * compile`, and `registerFlow`'s descriptor walk then refused the whole flow at
 * boot. The spec now refuses it at every door, and the walk stands aside for
 * every type `builtinNodeConfigKeysJudged` names (pinned in
 * `service-automation` `builtin/config-unknown-keys.test.ts`). The controls
 * hold what stays as it was:
 *
 *  - a valid node of each type, and the measured node without its extra key;
 *  - `try_catch`, whose contract's `retry` strips an unknown key where its
 *    descriptor closes it: its keys stay registration's;
 *  - a key at or under a region slot, which is `validateControlFlow`'s;
 *  - a key inside a free-form map (author data);
 *  - `decision`, schemaless with no executor contract;
 *  - a tombstoned retired `script` key, which keeps the path it had.
 */

import { describe, expect, it } from 'vitest';

import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';
import { ArtifactStagePackageBodySchema, ObjectStackDefinitionSchema, defineStack } from '../stack.zod';
import { builtinNodeConfigKeysJudged, flowNodeConfigRefusals, getBuiltinNodeConfigContracts } from './flow-node-config-refusals';
import { FlowSchema } from './flow.zod';

const ENTRY_ID = 'flow-script-subflow-config-undeclared-keys-refused';
const REMAINDER_ENTRY_ID = 'flow-builtin-node-config-undeclared-keys-refused';

type Config = Record<string, unknown>;

/** The measured node: `summarize` in the showcase's `showcase_task_completed`. */
const MEASURED: Config = { function: 'summarizeCompletedTask', inputs: { taskId: '{record.id}' }, outputVariable: 'summary' };
const SUBFLOW: Config = { flowName: 'child_flow', input: { id: '{record.id}' }, outputVariable: 'out' };
/** The remainder's measured node: a `notify` with `bogusKey` (#21982's pass-1 report). */
const NOTIFY: Config = { recipients: '{record.owner}', title: 'Done', message: '{summary}' };

/** A valid config of every builtin the key arm judges — the controls each type is probed against. */
const VALID: Readonly<Record<string, Config>> = {
  get_record: { objectName: 'task', filter: { status: 'open' }, limit: 5, outputVariable: 'rows' },
  create_record: { objectName: 'task', fields: { title: 'X' }, outputVariable: 'created' },
  update_record: { objectName: 'task', filter: { id: '{recordId}' }, fields: { title: 'X' } },
  delete_record: { objectName: 'task', filter: { id: '{recordId}' } },
  notify: NOTIFY,
  http: { url: 'https://example.test/hook', method: 'POST', headers: { 'X-Any': 'y' } },
  screen: { title: 'T', fields: [{ name: 'a', type: 'select', options: [{ label: 'A', value: 'a' }] }] },
  script: MEASURED,
  subflow: SUBFLOW,
  map: { collection: '{rows}', flowName: 'child_flow', input: { id: '{item.id}' } },
  loop: { collection: '{rows}', body: { nodes: [], edges: [] } },
  parallel: { branches: [{ name: 'a', nodes: [], edges: [] }, { name: 'b', nodes: [], edges: [] }] },
};

/** start → one node of `type` → end. */
function flowWith(type: string, config: unknown, name = 'key_probe') {
  return {
    name,
    label: 'Key probe',
    type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'summarize', type, label: 'N', config },
      { id: 'done', type: 'end', label: 'Done' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'summarize' },
      { id: 'e2', source: 'summarize', target: 'done' },
    ],
  };
}

interface IssueSig { code: string; path: string; message: string }

function issuesOf(flow: unknown): IssueSig[] {
  const r = FlowSchema.safeParse(flow);
  return r.success ? [] : r.error.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
}

/** The contract's own unknown-key sentence for a config — read, never re-spelled. */
function contractSentence(type: string, config: Config): string {
  const own = getBuiltinNodeConfigContracts().get(type)!.schema.safeParse(config);
  return own.success ? '' : own.error?.issues.find((i) => i.code === 'unrecognized_keys')?.message ?? '';
}

describe('the measured node: refused at save, with its location', () => {
  it('a script node with bogusKey is refused at nodes.1.config.bogusKey, in the contract\'s own words', () => {
    const config = { ...MEASURED, bogusKey: 1 };
    const issues = issuesOf(flowWith('script', config));
    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([{ code: 'custom', path: 'nodes.1.config.bogusKey' }]);
    expect(issues[0]!.message).toBe(flowNodeConfigRefusals('script', config)[0]!.message);
    expect(contractSentence('script', config)).toMatch(/`bogusKey`/);
    expect(issues[0]!.message).toContain(contractSentence('script', config));
  });

  it('the judge answers with the closed-set code, its params and the key as path', () => {
    const refusals = flowNodeConfigRefusals('script', { ...MEASURED, bogusKey: 1 });
    expect(refusals.map(({ code, params, path, source }) => ({ code, params, path, source }))).toEqual([
      { code: 'node-config-refused-by-contract', params: { nodeType: 'script', key: 'bogusKey' }, path: 'bogusKey', source: '' },
    ]);
  });

  it('the same for subflow', () => {
    const config = { ...SUBFLOW, bogusKey: 1 };
    expect(issuesOf(flowWith('subflow', config)).map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'custom', path: 'nodes.1.config.bogusKey' },
    ]);
    expect(flowNodeConfigRefusals('subflow', config).map(({ code, params }) => ({ code, params }))).toEqual([
      { code: 'node-config-refused-by-contract', params: { nodeType: 'subflow', key: 'bogusKey' } },
    ]);
  });

  it('one refusal per undeclared key, each anchored at its own key', () => {
    expect(flowNodeConfigRefusals('script', { ...MEASURED, bogusKey: 1, other: 2 }).map(({ path }) => path))
      .toEqual(['bogusKey', 'other']);
  });

  it('a known slip carries the contract\'s own prescription: subflow timeoutMs belongs on the node', () => {
    const [refusal] = flowNodeConfigRefusals('subflow', { ...SUBFLOW, timeoutMs: 30000 });
    expect(refusal!.path).toBe('timeoutMs');
    expect(refusal!.message).toContain(contractSentence('subflow', { ...SUBFLOW, timeoutMs: 30000 }));
    expect(refusal!.message).toMatch(/belongs on the NODE/);
  });

  it('a key beside a refused value: each keeps its own refusal', () => {
    expect(flowNodeConfigRefusals('script', { ...MEASURED, function: '', bogusKey: 1 }).map(({ path }) => path).sort())
      .toEqual(['bogusKey', 'function']);
  });

  it('a node inside an ADR-0031 region body is refused at the path the author wrote', () => {
    const body = { nodes: [{ id: 'inner', type: 'script', label: 'Inner', config: { function: 'f', bogusKey: 1 } }], edges: [] };
    expect(issuesOf(flowWith('loop', { collection: '{rows}', body })).map(({ path }) => path))
      .toEqual(['nodes.1.config.body.nodes.0.config.bogusKey']);
  });
});

describe('the remainder: every other builtin but try_catch, refused at save', () => {
  it('a notify node with bogusKey is refused at nodes.1.config.bogusKey, with the rename-or-remove remedy', () => {
    const config = { ...NOTIFY, bogusKey: 1 };
    const issues = issuesOf(flowWith('notify', config));
    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([{ code: 'custom', path: 'nodes.1.config.bogusKey' }]);
    const [refusal] = flowNodeConfigRefusals('notify', config);
    expect({ code: refusal!.code, params: refusal!.params, path: refusal!.path }).toEqual({
      code: 'node-config-refused-by-contract', params: { nodeType: 'notify', key: 'bogusKey' }, path: 'bogusKey',
    });
    expect(issues[0]!.message).toBe(refusal!.message);
    expect(refusal!.message).toContain(contractSentence('notify', config));
    // The remedy the descriptor walk's rejection carried, kept: rename or remove.
    expect(refusal!.message).toMatch(/Rename the key .* or remove it/);
  });

  it('CONTROL: the measured notify node without its extra key parses clean', () => {
    expect(issuesOf(flowWith('notify', NOTIFY))).toEqual([]);
  });

  it('every judged type refuses a top-level bogusKey on an otherwise valid config, anchored at the key', () => {
    for (const [type, config] of Object.entries(VALID)) {
      expect(flowNodeConfigRefusals(type, { ...config, bogusKey: 1 }).map(({ code, path }) => ({ code, path })), type)
        .toEqual([{ code: 'node-config-refused-by-contract', path: 'bogusKey' }]);
    }
  });

  it('the walk\'s per-key prescriptions live on in the contracts\' own sentences', () => {
    for (const [type, config, path, prescription] of [
      ['create_record', { objectName: 'task', fieldValues: { a: 1 } }, 'fieldValues', /The write map is `fields`/],
      ['update_record', { objectName: 'task', filter: { id: 'x' }, bulk: true }, 'bulk', /`multi: true`/],
      ['delete_record', { objectName: 'task', filter: { id: 'x' }, options: { multi: true } }, 'options', /`multi: true`/],
      ['screen', { fields: [{ name: 'qty', visibleIf: 'x' }] }, 'fields[0].visibleIf', /`visibleWhen`/],
    ] as const) {
      const refusals = flowNodeConfigRefusals(type, config);
      expect(refusals.map((r) => r.path), type).toEqual([path]);
      expect(refusals[0]!.message, type).toMatch(prescription);
    }
  });

  it('a key on a screen field or one of its options is refused where the author wrote it', () => {
    const config = { fields: [{ name: 'a', type: 'select', options: [{ label: 'A', value: 'a', bogusKey: 1 }], other: 2 }] };
    expect(flowNodeConfigRefusals('screen', config).map((r) => r.path).sort())
      .toEqual(['fields[0].options[0].bogusKey', 'fields[0].other']);
    expect(issuesOf(flowWith('screen', config)).map((i) => i.path).sort())
      .toEqual(['nodes.1.config.fields.0.options.0.bogusKey', 'nodes.1.config.fields.0.other']);
  });

  it('a body-less legacy loop is judged on key membership alone, as registration judged it', () => {
    // Keys: refused, whatever `parsedWhen` says.
    const [refusal] = flowNodeConfigRefusals('loop', { collection: 'rows', bogusKey: 1 });
    expect({ code: refusal!.code, path: refusal!.path }).toEqual({ code: 'node-config-refused-by-contract', path: 'bogusKey' });
    // The run does not parse this form, so the sentence names registration, not a failing run.
    expect(refusal!.message).toContain('registration refuses the whole flow');
    expect(issuesOf(flowWith('loop', { flowName: 'x' })).map((i) => i.path)).toEqual(['nodes.1.config.flowName']);
    // Presence and values keep `parsedWhen`: a marker loop with no collection, or a value the
    // contract would refuse, is not judged.
    expect(flowNodeConfigRefusals('loop', {})).toEqual([]);
    expect(flowNodeConfigRefusals('loop', { collection: 5 })).toEqual([]);
  });

  it('a pre-conversion alias is converted first where the door converts, and refused at a direct parse', () => {
    const config = { objectName: 'task', filters: { id: '{recordId}' }, fields: { title: 'X' } };
    expect(issuesOf(flowWith('update_record', config)).map((i) => i.path)).toEqual(['nodes.1.config.filters']);
    const stack = {
      manifest: { id: 'com.example.alias', name: 'alias', version: '1.0.0', type: 'app', namespace: 'als' },
      objects: [{ name: 'als_task', label: 'Task', fields: { title: { type: 'text', label: 'Title' } } }],
      flows: [flowWith('update_record', { ...config, objectName: 'als_task' }, 'alias_flow')],
    };
    expect(() => defineStack(stack as never)).not.toThrow();
  });
});

describe('what stays as it was (lit controls)', () => {
  it('CONTROL: the measured node without its extra key, and a valid subflow, parse clean', () => {
    for (const [type, config] of [['script', MEASURED], ['subflow', SUBFLOW]] as const) {
      expect(getBuiltinNodeConfigContracts().get(type)!.schema.safeParse(config).success, type).toBe(true);
      expect(flowNodeConfigRefusals(type, config), type).toEqual([]);
      expect(issuesOf(flowWith(type, config)), type).toEqual([]);
    }
  });

  it('the key-judged builtins are every executor contract but try_catch, and the predicate says so', () => {
    const judged = [...getBuiltinNodeConfigContracts().keys()]
      .filter((type) => flowNodeConfigRefusals(type, { bogusKey: 1 }).some((r) => r.path === 'bogusKey'));
    expect(judged.sort()).toEqual([
      'create_record', 'delete_record', 'get_record', 'http', 'loop', 'map', 'notify', 'parallel', 'screen',
      'script', 'subflow', 'update_record',
    ]);
    // The predicate the descriptor walk reads names exactly the types the judge judges — one judge per type.
    for (const type of getBuiltinNodeConfigContracts().keys()) {
      expect(builtinNodeConfigKeysJudged(type), type).toBe(judged.includes(type));
    }
    for (const type of ['try_catch', 'approval', 'decision', 'assignment', 'wait', 'some_plugin_node']) {
      expect(builtinNodeConfigKeysJudged(type), type).toBe(false);
    }
  });

  it('CONTROL: each judged type\'s valid config draws no refusal', () => {
    for (const [type, config] of Object.entries(VALID)) {
      expect(builtinNodeConfigKeysJudged(type), type).toBe(true);
      expect(flowNodeConfigRefusals(type, config), type).toEqual([]);
    }
  });

  it('CONTROL: try_catch keeps its undeclared key at registration — its contract\'s retry strips one', () => {
    const tryRegion = { nodes: [{ id: 'inner', type: 'assignment', label: 'A', config: { assignments: { a: 1 } } }], edges: [] };
    // The measured difference: the contract's `retry` accepts (strips) a key the descriptor closes.
    expect(getBuiltinNodeConfigContracts().get('try_catch')!.schema
      .safeParse({ try: tryRegion, retry: { maxRetries: 1, bogusKey: 1 } }).success).toBe(true);
    for (const config of [{ try: tryRegion, bogusKey: 1 }, { try: tryRegion, retry: { maxRetries: 1, bogusKey: 1 } }]) {
      expect(flowNodeConfigRefusals('try_catch', config)).toEqual([]);
    }
  });

  it('CONTROL: a key at or under a region slot is the region\'s, never the container\'s', () => {
    const node = { id: 'inner', type: 'assignment', label: 'A', config: { assignments: { a: 1 } } };
    for (const [type, config] of [
      ['loop', { collection: '{rows}', body: { nodes: [node], edges: [], bogusKey: 1 } }],
      ['loop', { collection: '{rows}', body: { nodes: [{ ...node, bogusKey: 1 }], edges: [] } }],
      ['parallel', { branches: [{ name: 'a', nodes: [node], edges: [], bogusKey: 1 }, { name: 'b', nodes: [node], edges: [] }] }],
    ] as const) {
      // The region contract refuses it — `validateControlFlow` names it at registration.
      expect(getBuiltinNodeConfigContracts().get(type)!.schema.safeParse(config).success, type).toBe(false);
      expect(flowNodeConfigRefusals(type, config), type).toEqual([]);
    }
  });

  it('CONTROL: a key inside a free-form map is author data', () => {
    for (const [type, config] of [
      ['get_record', { objectName: 'task', filter: { status: 'stale', anythingAtAll: true } }],
      ['create_record', { objectName: 'task', fields: { title: 'X', any_field: 1 } }],
      ['http', { url: 'https://example.test/hook', headers: { 'X-Anything': 'y' } }],
      ['screen', { objectName: 'task', defaults: { anything: 1 } }],
      ['map', { collection: '{rows}', flowName: 'child_flow', input: { anything: 1 } }],
    ] as const) {
      expect(flowNodeConfigRefusals(type, config), type).toEqual([]);
    }
  });

  it('CONTROL: decision is schemaless but its executor parses nothing, so its keys stay unjudged', () => {
    expect(flowNodeConfigRefusals('decision', { condition: 'a == b', whateverElse: 1 })).toEqual([]);
  });

  it('CONTROL: a tombstoned retired script key keeps its existing path', () => {
    const config = { ...MEASURED, actionType: 'email' };
    const own = getBuiltinNodeConfigContracts().get('script')!.schema.safeParse(config);
    expect(own.success ? [] : own.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.') }))).toEqual([
      { code: 'invalid_type', path: 'actionType' },
    ]);
    expect(own.success ? '' : own.error!.issues[0]!.message).toMatch(/was removed in @objectstack\/spec 17/);
    expect(flowNodeConfigRefusals('script', config)).toEqual([]);
    expect(issuesOf(flowWith('script', config))).toEqual([]);
  });
});

describe('every door that parses a flow refuses it', () => {
  const stackWith = (flows: unknown[]) => ({
    manifest: { id: 'com.example.keys', name: 'keys', version: '1.0.0', type: 'app', namespace: 'key' },
    objects: [{ name: 'key_task', label: 'Task', fields: { title: { type: 'text', label: 'Title' } } }],
    flows,
  });
  const refused = flowWith('script', { ...MEASURED, bogusKey: 1 }, 'key_refused');
  const subflowRefused = flowWith('subflow', { ...SUBFLOW, bogusKey: 1 }, 'key_subflow');
  const accepted = flowWith('script', MEASURED, 'key_ok');
  const notifyRefused = flowWith('notify', { ...NOTIFY, bogusKey: 1 }, 'key_notify');

  it('defineStack wraps the refusal in its ADR-0112 envelope, at flows.1.nodes.1.config.bogusKey', () => {
    let refusal: { code?: unknown; status?: unknown; issues?: Array<{ path: unknown[]; code: string }> } | undefined;
    try {
      defineStack(stackWith([accepted, refused]) as never);
    } catch (e) {
      refusal = e as typeof refusal;
    }
    expect(refusal, 'defineStack must refuse the flow').toBeDefined();
    expect({ code: refusal!.code, status: refusal!.status }).toEqual({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    expect(refusal!.issues!.map((i) => ({ path: i.path.join('.'), code: i.code }))).toEqual([
      { path: 'flows.1.nodes.1.config.bogusKey', code: 'custom' },
    ]);
  });

  it('CONTROL: defineStack accepts the measured node without its extra key', () => {
    expect(() => defineStack(stackWith([accepted]) as never)).not.toThrow();
  });

  it('ObjectStackDefinitionSchema — the stack parse validate and compile run — refuses both types', () => {
    const r = ObjectStackDefinitionSchema.safeParse(stackWith([refused, subflowRefused]));
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toEqual([
      'flows.0.nodes.1.config.bogusKey',
      'flows.1.nodes.1.config.bogusKey',
    ]);
    expect(ObjectStackDefinitionSchema.safeParse(stackWith([accepted])).success).toBe(true);
  });

  it('the registered `flow` type schema — what the metadata save door validates against — refuses it too', () => {
    const schema = getMetadataTypeSchema('flow') as unknown as typeof FlowSchema;
    expect(schema).toBeDefined();
    const r = schema.safeParse(subflowRefused);
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toEqual(['nodes.1.config.bogusKey']);
    expect(schema.safeParse(accepted).success).toBe(true);
  });

  it('an artifact\'s parse refuses it', () => {
    const body = { id: 'com.example.keys', name: 'keys', version: '1.0.0', type: 'app' };
    const r = ArtifactStagePackageBodySchema.safeParse({ ...body, flows: [refused] });
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toEqual(['flows.0.nodes.1.config.bogusKey']);
    const ok = ArtifactStagePackageBodySchema.safeParse({ ...body, flows: [accepted] });
    expect(ok.success, JSON.stringify(ok.error?.issues ?? [])).toBe(true);
  });
  it('ObjectStackDefinitionSchema and the save door\'s flow type schema refuse the remainder\'s notify node', () => {
    const r = ObjectStackDefinitionSchema.safeParse(stackWith([accepted, notifyRefused]));
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toEqual(['flows.1.nodes.1.config.bogusKey']);
    const schema = getMetadataTypeSchema('flow') as unknown as typeof FlowSchema;
    const saved = schema.safeParse(notifyRefused);
    expect(saved.success ? [] : saved.error.issues.map((i) => i.path.join('.'))).toEqual(['nodes.1.config.bogusKey']);
  });
});

describe('the ADR-0087 ledger', () => {
  it('registers one D3 entry at protocol 18, with no D2 conversion', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((e) => e.id === ENTRY_ID);
    expect(entries, 'the narrowing needs its own D3 entry').toHaveLength(1);
    const [entry] = entries;
    expect(entry!.conversionIds ?? []).toEqual([]);
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  it('names the step-18 rationale fragment for it', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.rationale).toContain(ENTRY_ID);
  });

  it('registers the remainder\'s D3 entry at protocol 18, with no D2 conversion, and its rationale fragment', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((e) => e.id === REMAINDER_ENTRY_ID);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.conversionIds ?? []).toEqual([]);
    expect(MIGRATIONS_BY_MAJOR[18]!.rationale).toContain(REMAINDER_ENTRY_ID);
  });
});
