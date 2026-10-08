// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21898] The build doors refuse a VALUE a builtin node's executor contract
 * refuses — the value half of the executor-contract arm of
 * `flowNodeConfigRefusals`, beside the presence half (#20316) and the declared
 * approval contract judged whole (#21850).
 *
 * Every builtin executor parses its config against the contract in
 * `getBuiltinNodeConfigContracts()` before it acts, and refuses the node on any
 * finding. A present value the contract refuses — `create_record`'s
 * `outputVariable: 42`, a screen field's `min: '1'` — used to pass
 * `FlowSchema`, `objectstack validate` and `objectstack compile`, register, and
 * then fail every run that reached the node. The pins below hold the refusal at
 * every door that parses a flow, and the controls hold what stays accepted:
 *
 *  - a valid node of every builtin type;
 *  - a `{token}` value in a typed slot, in each spelling an author writes —
 *    never refused for its pre-interpolation type;
 *  - the places the build cannot know what the run parses, or another judge
 *    owns the finding (key membership, a region slot, a `predicate` / `value`
 *    ledger slot, `http`'s run-resolved `signingSecret`, a legacy `loop` with
 *    no `body`).
 */

import { describe, expect, it } from 'vitest';

import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';
import { ArtifactStagePackageBodySchema, ObjectStackDefinitionSchema, defineStack } from '../stack.zod';
import { flowNodeConfigRefusals, getBuiltinNodeConfigContracts } from './flow-node-config-refusals';
import { FlowSchema } from './flow.zod';

const ENTRY_ID = 'flow-builtin-node-config-values-refused';

type Config = Record<string, unknown>;

/** A one-node region body a container probe can hold — node ids are one space across the flow. */
const region = (id: string) => ({ nodes: [{ id, type: 'assignment', label: 'Inner', config: { assignments: { x: 1 } } }], edges: [] });
const REGION = region('inner');

/** A config each builtin's contract accepts — the accept controls, and the base every probe edits. */
const VALID: Readonly<Record<string, Config>> = {
  get_record: { objectName: 'account', filter: { status: 'open' }, fields: ['name'], limit: 10, outputVariable: 'rows' },
  create_record: { objectName: 'task', fields: { title: 'X' }, outputVariable: 'taskId' },
  update_record: { objectName: 'task', filter: { id: '{record.id}' }, fields: { status: 'done' }, multi: false },
  delete_record: { objectName: 'task', filter: { id: '{record.id}' }, multi: false },
  notify: { recipients: ['u1'], title: 'Hello', severity: 'info', channels: ['inbox'] },
  http: { url: 'https://example.test/hook', method: 'POST', headers: { 'X-Kind': 'probe' }, durable: false, timeoutMs: 5000 },
  screen: {
    title: 'How many?',
    fields: [{ name: 'qty', label: 'Qty', type: 'number', required: true, min: 1, max: 10 }],
    waitForInput: true,
  },
  script: { function: 'score_lead', inputs: { leadId: '{record.id}' }, outputVariable: 'score' },
  subflow: { flowName: 'child_flow', input: { id: '{record.id}' }, outputVariable: 'out' },
  map: { collection: '{rows}', flowName: 'per_item', iteratorVariable: 'item' },
  loop: { collection: '{rows}', iteratorVariable: 'row', maxIterations: 50, body: REGION },
  parallel: { branches: [{ name: 'a', ...region('inner_a') }, { name: 'b', ...region('inner_b') }] },
  try_catch: { try: REGION, errorVariable: 'err', retry: { maxRetries: 2, backoffMs: 100 } },
};

/** start → one node of `type` → end. */
function flowWith(type: string, config: unknown, name = 'value_probe') {
  return {
    name,
    label: 'Value probe',
    type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'n', type, label: 'N', ...(config === undefined ? {} : { config }) },
      { id: 'done', type: 'end', label: 'Done' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'n' },
      { id: 'e2', source: 'n', target: 'done' },
    ],
  };
}

interface IssueSig { code: string; path: string; message: string }

function issuesOf(flow: unknown): IssueSig[] {
  const r = FlowSchema.safeParse(flow);
  return r.success ? [] : r.error.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
}

/** The builtin contract's own sentence at one issue path — read, never re-spelled. */
function contractSentence(type: string, config: unknown, path: string): string {
  const own = getBuiltinNodeConfigContracts().get(type)!.schema.safeParse(config);
  return own.success ? '' : own.error?.issues.find((i) => i.path.join('.') === path)?.message ?? '';
}

describe('the measured pair: refused at save, with its location', () => {
  it('create_record with outputVariable 42 is refused at nodes.1.config.outputVariable', () => {
    const config = { ...VALID.create_record, outputVariable: 42 };
    const issues = issuesOf(flowWith('create_record', config));
    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'custom', path: 'nodes.1.config.outputVariable' },
    ]);
    // The judge's own words, carrying the contract's own sentence.
    expect(issues[0]!.message).toBe(flowNodeConfigRefusals('create_record', config)[0]!.message);
    expect(issues[0]!.message).toContain(contractSentence('create_record', config, 'outputVariable'));
    expect(contractSentence('create_record', config, 'outputVariable')).toMatch(/expected string, received number/);
  });

  it('a screen field with a string min is refused at nodes.1.config.fields.0.min', () => {
    const config = { ...VALID.screen, fields: [{ name: 'qty', type: 'number', min: '1' }] };
    const issues = issuesOf(flowWith('screen', config));
    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'custom', path: 'nodes.1.config.fields.0.min' },
    ]);
    expect(issues[0]!.message).toContain(contractSentence('screen', config, 'fields.0.min'));
  });

  it('the judge answers both with the closed-set code, its params and the path', () => {
    const refusals = [
      ...flowNodeConfigRefusals('create_record', { ...VALID.create_record, outputVariable: 42 }),
      ...flowNodeConfigRefusals('screen', { fields: [{ name: 'qty', min: '1' }] }),
    ];
    expect(refusals.map(({ code, params, path, source }) => ({ code, params, path, source }))).toEqual([
      { code: 'node-config-refused-by-contract', params: { nodeType: 'create_record', key: 'outputVariable' }, path: 'outputVariable', source: '' },
      { code: 'node-config-refused-by-contract', params: { nodeType: 'screen', key: 'fields[0].min' }, path: 'fields[0].min', source: '' },
    ]);
  });

  it('a node inside an ADR-0031 region body is refused at the path the author wrote', () => {
    const body = { nodes: [{ id: 'mk', type: 'create_record', label: 'Mk', config: { objectName: 'task', outputVariable: 42 } }], edges: [] };
    const issues = issuesOf(flowWith('loop', { collection: '{rows}', body }));
    expect(issues.map(({ path }) => path)).toEqual(['nodes.1.config.body.nodes.0.config.outputVariable']);
  });
});

describe('one refusal per judged builtin, at each typed key', () => {
  // [type, the edit onto its VALID config, the key the refusal names]
  const PROBES: ReadonlyArray<readonly [string, Config, string]> = [
    ['get_record', { limit: '10' }, 'limit'],
    ['get_record', { fields: 'name' }, 'fields'],
    ['create_record', { objectName: 5 }, 'objectName'],
    ['update_record', { multi: 'true' }, 'multi'],
    ['delete_record', { multi: 1 }, 'multi'],
    ['notify', { severity: 'loud' }, 'severity'],
    ['notify', { recipients: [5] }, 'recipients'],
    ['notify', { template: 'crm.deal_won' }, 'template'],
    ['http', { timeoutMs: '5000' }, 'timeoutMs'],
    ['http', { durable: 'yes' }, 'durable'],
    ['http', { headers: { 'X-Kind': 5 } }, 'headers.X-Kind'],
    ['screen', { waitForInput: 'yes' }, 'waitForInput'],
    ['screen', { mode: 'view' }, 'mode'],
    ['screen', { fields: [{ name: 'qty', required: 'yes' }] }, 'fields[0].required'],
    ['script', { function: '' }, 'function'],
    ['script', { inputs: 'leadId' }, 'inputs'],
    ['subflow', { flowName: '' }, 'flowName'],
    ['subflow', { input: ['x'] }, 'input'],
    ['map', { flowName: 7 }, 'flowName'],
    ['map', { collection: 5 }, 'collection'],
    ['loop', { collection: 5 }, 'collection'],
    ['loop', { maxIterations: 0 }, 'maxIterations'],
    ['try_catch', { errorVariable: 5 }, 'errorVariable'],
    ['try_catch', { retry: { maxRetries: 99 } }, 'retry.maxRetries'],
  ];

  for (const [type, edit, key] of PROBES) {
    it(`${type} ${JSON.stringify(edit)} is refused at ${key}`, () => {
      const config = { ...VALID[type], ...edit };
      const refusals = flowNodeConfigRefusals(type, config);
      expect(refusals.map(({ code, path }) => ({ code, path }))).toEqual([{ code: 'node-config-refused-by-contract', path: key }]);
      expect(refusals[0]!.params).toEqual({ nodeType: type, key });
      expect(issuesOf(flowWith(type, config)).map(({ path }) => path)).toHaveLength(1);
    });
  }

  it('a rule finding carries the rule\'s own words and no closing instruction', () => {
    const config = { ...VALID.notify, template: 'crm.deal_won' };
    const [refusal] = flowNodeConfigRefusals('notify', config);
    expect(refusal!.message).toContain(contractSentence('notify', config, 'template'));
    expect(refusal!.message).not.toMatch(/Write a value the notify contract accepts/);
  });

  it('a type finding closes on what to write at the key', () => {
    const [refusal] = flowNodeConfigRefusals('create_record', { ...VALID.create_record, outputVariable: 42 });
    expect(refusal!.message).toMatch(/Write a value the create_record contract accepts at `outputVariable`\.$/);
  });
});

describe('what stays accepted (lit controls)', () => {
  it('CONTROL: a valid node of every builtin type parses, and the judge says nothing', () => {
    expect(Object.keys(VALID).sort()).toEqual([...getBuiltinNodeConfigContracts().keys()].sort());
    for (const [type, config] of Object.entries(VALID)) {
      expect(getBuiltinNodeConfigContracts().get(type)!.schema.safeParse(config).success, type).toBe(true);
      expect(flowNodeConfigRefusals(type, config), type).toEqual([]);
      expect(issuesOf(flowWith(type, config)), type).toEqual([]);
    }
  });

  it('CONTROL: a token value in a typed slot is never refused for its pre-interpolation type', () => {
    const TOKENS: ReadonlyArray<readonly [string, Config]> = [
      ['get_record', { limit: '{page.size}' }],
      ['http', { timeoutMs: '{timeout}' }],
      ['http', { durable: '{{durable_flag}}' }],
      ['http', { headers: '{headers}' }],
      ['screen', { fields: [{ name: 'qty', min: '${minimum}', max: '{maximum}' }] }],
      ['update_record', { multi: '{bulk}' }],
      ['loop', { maxIterations: '{cap}' }],
      ['try_catch', { retry: { maxRetries: '{tries}' } }],
    ];
    for (const [type, edit] of TOKENS) {
      const config = { ...VALID[type], ...edit };
      // The contract itself refuses the string — only the judge holds back.
      expect(getBuiltinNodeConfigContracts().get(type)!.schema.safeParse(config).success, JSON.stringify(edit)).toBe(false);
      expect(flowNodeConfigRefusals(type, config), JSON.stringify(edit)).toEqual([]);
      expect(issuesOf(flowWith(type, config)), JSON.stringify(edit)).toEqual([]);
    }
  });

  it('CONTROL: a token-free sibling does not shield a refused value (http judges each slot on its own)', () => {
    const config = { ...VALID.http, url: 'https://example.test/{path}', timeoutMs: '5000' };
    expect(flowNodeConfigRefusals('http', config).map(({ path }) => path)).toEqual(['timeoutMs']);
  });

  it('CONTROL: key membership is not this arm\'s — an undeclared key and a tombstoned one', () => {
    // [#21982] An undeclared key on these builtins draws the KEY arm's one
    // refusal at its location; this arm adds nothing beside it. [#22343] So
    // does a tombstoned key on a type the key arm judges it for — `try_catch`'s
    // `retry.retryDelayMs` — while a retired `script` key keeps the scope it
    // had (the lint names it): neither draws a second refusal from this arm.
    for (const [type, config, key] of [
      ['http', { ...VALID.http, bogusKey: 1 }, 'bogusKey'],
      ['screen', { fields: [{ name: 'qty', visible: 'x' }] }, 'fields[0].visible'],
      ['try_catch', { ...VALID.try_catch, retry: { retryDelayMs: 500 } }, 'retry.retryDelayMs'],
    ] as const) {
      expect(flowNodeConfigRefusals(type, config).map(({ code, path }) => ({ code, path })), type)
        .toEqual([{ code: 'node-config-refused-by-contract', path: key }]);
    }
    expect(flowNodeConfigRefusals('script', { ...VALID.script, actionType: 'email' })).toEqual([]);
    // CONTROL: the contracts refuse all four — the arm holds back, the contract does not.
    for (const [type, config] of [
      ['http', { ...VALID.http, bogusKey: 1 }],
      ['screen', { fields: [{ name: 'qty', visible: 'x' }] }],
      ['script', { ...VALID.script, actionType: 'email' }],
      ['try_catch', { ...VALID.try_catch, retry: { retryDelayMs: 500 } }],
    ] as const) {
      expect(getBuiltinNodeConfigContracts().get(type)!.schema.safeParse(config).success, type).toBe(false);
    }
  });

  it('CONTROL: a slot another judge owns is not re-judged here', () => {
    // A `predicate` ledger slot: `predicateSlotRefusal` judges it at the other two doors.
    expect(flowNodeConfigRefusals('screen', { fields: [{ name: 'qty', visibleWhen: { dialect: 'cel', source: 'x' } }] })).toEqual([]);
    // A `value` ledger slot: the value-envelope pass judges it.
    expect(flowNodeConfigRefusals('create_record', { objectName: 'task', fields: { title: { dialect: 'cel', source: 1 } } })).toEqual([]);
    // A region slot: `validateControlFlow` judges a region's shape at registration.
    expect(flowNodeConfigRefusals('try_catch', { try: 5 })).toEqual([]);
    expect(flowNodeConfigRefusals('parallel', { branches: [{ name: 'a', ...REGION }] })).toEqual([]);
    // http's signing secret: the credential channel may hold the value the run parses.
    expect(flowNodeConfigRefusals('http', { ...VALID.http, signingSecret: 7 })).toEqual([]);
  });

  it('CONTROL: a legacy loop with no body is not parsed by its executor, so nothing is judged', () => {
    expect(getBuiltinNodeConfigContracts().get('loop')!.parsedWhen!({ collection: 5 })).toBe(false);
    expect(flowNodeConfigRefusals('loop', { collection: 5, maxIterations: 0 })).toEqual([]);
  });

  it('CONTROL: a key left out keeps its presence code beside a refused value', () => {
    const refusals = flowNodeConfigRefusals('create_record', { outputVariable: 42 });
    expect(refusals.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'node-config-key-missing', path: 'objectName' },
      { code: 'node-config-refused-by-contract', path: 'outputVariable' },
    ]);
  });
});

describe('every door that parses a flow refuses it', () => {
  const stackWith = (flows: unknown[]) => ({
    manifest: { id: 'com.example.values', name: 'values', version: '1.0.0', type: 'app', namespace: 'val' },
    objects: [{ name: 'val_task', label: 'Task', fields: { title: { type: 'text', label: 'Title' } } }],
    flows,
  });
  const refused = flowWith('create_record', { objectName: 'val_task', outputVariable: 42 }, 'val_refused');
  const screenRefused = flowWith('screen', { fields: [{ name: 'qty', type: 'number', min: '1' }] }, 'val_screen');
  const accepted = flowWith('create_record', { objectName: 'val_task', outputVariable: 'taskId' }, 'val_ok');

  it('defineStack wraps the refusal in its ADR-0112 envelope, at flows.1.nodes.1.config.outputVariable', () => {
    let refusal: { code?: unknown; status?: unknown; issues?: Array<{ path: unknown[]; code: string }> } | undefined;
    try {
      defineStack(stackWith([accepted, refused]) as never);
    } catch (e) {
      refusal = e as typeof refusal;
    }
    expect(refusal, 'defineStack must refuse the flow').toBeDefined();
    expect({ code: refusal!.code, status: refusal!.status }).toEqual({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    expect(refusal!.issues!.map((i) => ({ path: i.path.join('.'), code: i.code }))).toEqual([
      { path: 'flows.1.nodes.1.config.outputVariable', code: 'custom' },
    ]);
  });

  it('CONTROL: defineStack accepts the valid flow alone', () => {
    expect(() => defineStack(stackWith([accepted]) as never)).not.toThrow();
  });

  it('ObjectStackDefinitionSchema — the stack parse validate and compile run — refuses both pins', () => {
    const r = ObjectStackDefinitionSchema.safeParse(stackWith([refused, screenRefused]));
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toEqual([
      'flows.0.nodes.1.config.outputVariable',
      'flows.1.nodes.1.config.fields.0.min',
    ]);
    expect(ObjectStackDefinitionSchema.safeParse(stackWith([accepted])).success).toBe(true);
  });

  it('the registered `flow` type schema — what the metadata save door validates against — refuses it too', () => {
    const schema = getMetadataTypeSchema('flow') as unknown as typeof FlowSchema;
    expect(schema).toBeDefined();
    const r = schema.safeParse(screenRefused);
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toEqual(['nodes.1.config.fields.0.min']);
    expect(schema.safeParse(accepted).success).toBe(true);
  });

  it('an artifact\'s parse refuses it', () => {
    const body = { id: 'com.example.values', name: 'values', version: '1.0.0', type: 'app' };
    const r = ArtifactStagePackageBodySchema.safeParse({ ...body, flows: [refused] });
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toEqual(['flows.0.nodes.1.config.outputVariable']);
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
