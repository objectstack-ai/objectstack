// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21982] The build doors refuse a KEY a builtin node's executor contract does
 * not declare, where no other door before the run judges it — the key half of
 * the executor-contract arm of `flowNodeConfigRefusals`, beside the value half
 * (#21898) and the presence half (#20316).
 *
 * `script` and `subflow` publish no descriptor `configSchema`, so
 * `registerFlow`'s undeclared-key walk skips them, while their executors parse
 * the strict contract and refuse the node on an undeclared key at every run. A
 * `script` node carrying `bogusKey` passed `FlowSchema`, `objectstack validate`,
 * `objectstack compile` and `registerFlow`, and then failed every run. The pins
 * below hold the refusal at every door that parses a flow; the controls hold
 * what stays as it was:
 *
 *  - a valid `script` / `subflow` node, and the measured node without its extra key;
 *  - a builtin WITH a descriptor `configSchema`: its undeclared key stays
 *    registration's, judged against the descriptor;
 *  - `decision`, schemaless but with no executor contract;
 *  - a tombstoned retired `script` key, which keeps the path it had.
 */

import { describe, expect, it } from 'vitest';

import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';
import { ArtifactStagePackageBodySchema, ObjectStackDefinitionSchema, defineStack } from '../stack.zod';
import { flowNodeConfigRefusals, getBuiltinNodeConfigContracts } from './flow-node-config-refusals';
import { FlowSchema } from './flow.zod';
import { SCHEMALESS_NODE_CONFIG_SCHEMAS } from './schemaless-node-config.zod';

const ENTRY_ID = 'flow-script-subflow-config-undeclared-keys-refused';

type Config = Record<string, unknown>;

/** The measured node: `summarize` in the showcase's `showcase_task_completed`. */
const MEASURED: Config = { function: 'summarizeCompletedTask', inputs: { taskId: '{record.id}' }, outputVariable: 'summary' };
const SUBFLOW: Config = { flowName: 'child_flow', input: { id: '{record.id}' }, outputVariable: 'out' };

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

describe('what stays as it was (lit controls)', () => {
  it('CONTROL: the measured node without its extra key, and a valid subflow, parse clean', () => {
    for (const [type, config] of [['script', MEASURED], ['subflow', SUBFLOW]] as const) {
      expect(getBuiltinNodeConfigContracts().get(type)!.schema.safeParse(config).success, type).toBe(true);
      expect(flowNodeConfigRefusals(type, config), type).toEqual([]);
      expect(issuesOf(flowWith(type, config)), type).toEqual([]);
    }
  });

  it('CONTROL: the key-judged builtins are exactly the schemaless ones with an executor contract', () => {
    const judged = [...getBuiltinNodeConfigContracts().keys()]
      .filter((type) => flowNodeConfigRefusals(type, { bogusKey: 1 }).some((r) => r.path === 'bogusKey'));
    expect(judged.sort()).toEqual(['script', 'subflow']);
    expect(judged.every((type) => Object.prototype.hasOwnProperty.call(SCHEMALESS_NODE_CONFIG_SCHEMAS, type))).toBe(true);
  });

  it('CONTROL: a builtin with a descriptor configSchema keeps its undeclared key at registration', () => {
    for (const [type, config] of [
      ['http', { url: 'https://example.test/hook', method: 'POST', bogusKey: 1 }],
      ['create_record', { objectName: 'task', fields: { title: 'X' }, bogusKey: 1 }],
      ['screen', { fields: [{ name: 'qty', visibleIf: 'x' }] }],
    ] as const) {
      // The contract refuses it — the build arm holds back, registration judges it.
      expect(getBuiltinNodeConfigContracts().get(type)!.schema.safeParse(config).success, type).toBe(false);
      expect(flowNodeConfigRefusals(type, config), type).toEqual([]);
      expect(issuesOf(flowWith(type, config)), type).toEqual([]);
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
});
