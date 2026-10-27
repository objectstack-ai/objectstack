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
 * every door that parses a flow — (#23260) a `{token}` value in a typed slot
 * included, judged for its type like any literal now that every builtin parses
 * its config as authored — and the controls hold what stays accepted:
 *
 *  - a valid node of every builtin type, and a literal of the right type where
 *    a token is refused;
 *  - the places the build cannot know what the run parses, or another judge
 *    owns the finding (key membership, a region slot, a `predicate` / `value`
 *    ledger slot, a value or text slot whose own judge refuses its token,
 *    `http`'s run-resolved `signingSecret`, a legacy `loop` with no `body`).
 */

import { describe, expect, it } from 'vitest';

import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';
import { ArtifactStagePackageBodySchema, ObjectStackDefinitionSchema, defineStack } from '../stack.zod';
import { flowNodeConfigRefusals, getBuiltinNodeConfigContracts } from './flow-node-config-refusals';
import { flowNodeTextSlotSources, textSlotTemplateRefusal } from './flow-text-slot-template';
import { flowNodeValueTemplateRefusals } from './flow-value-slot-template';
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
  update_record: { objectName: 'task', filter: { id: { dialect: 'cel', source: 'record.id' } }, fields: { status: 'done' }, multi: false },
  delete_record: { objectName: 'task', filter: { id: { dialect: 'cel', source: 'record.id' } }, multi: false },
  notify: { recipients: ['u1'], title: 'Hello', severity: 'info', channels: ['inbox'] },
  http: { url: 'https://example.test/hook', method: 'POST', headers: { 'X-Kind': 'probe' }, durable: false, timeoutMs: 5000 },
  screen: {
    title: 'How many?',
    fields: [{ name: 'qty', label: 'Qty', type: 'number', required: true, min: 1, max: 10 }],
    waitForInput: true,
  },
  // [#19939] `inputs.*` / `input.*` are value slots: the id is a CEL envelope.
  script: { function: 'score_lead', inputs: { leadId: { dialect: 'cel', source: 'record.id' } }, outputVariable: 'score' },
  subflow: { flowName: 'child_flow', input: { id: { dialect: 'cel', source: 'record.id' } }, outputVariable: 'out' },
  map: { collection: { dialect: 'cel', source: 'rows' }, flowName: 'per_item', iteratorVariable: 'item' },
  loop: { collection: { dialect: 'cel', source: 'rows' }, iteratorVariable: 'row', maxIterations: 50, body: REGION },
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
    const issues = issuesOf(flowWith('loop', { collection: { dialect: 'cel', source: 'rows' }, body }));
    expect(issues.map(({ path }) => path)).toEqual(['nodes.1.config.body.nodes.0.config.outputVariable']);
  });
});

describe('one refusal per judged builtin, at each typed key', () => {
  // [type, the edit onto its VALID config, the key the refusal names]
  const PROBES: ReadonlyArray<readonly [string, Config, string]> = [
    ['get_record', { limit: '10' }, 'limit'],
    // [#25302] The executor hands `limit` to the driver as the LIMIT as written.
    ['get_record', { limit: 2.5 }, 'limit'],
    ['get_record', { limit: 0 }, 'limit'],
    ['get_record', { limit: -1 }, 'limit'],
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
    // [#19939] `recordId` is a value slot whose literal is a string: a literal
    // the contract refuses for its type has no other judge, so it stays here.
    ['screen', { recordId: 42 }, 'recordId'],
    ['script', { function: '' }, 'function'],
    ['script', { inputs: 'leadId' }, 'inputs'],
    ['subflow', { flowName: '' }, 'flowName'],
    ['subflow', { input: ['x'] }, 'input'],
    ['map', { flowName: 7 }, 'flowName'],
    ['map', { collection: 5 }, 'collection'],
    ['loop', { collection: 5 }, 'collection'],
    // [#19939] `collection` is a value slot whose literal is a list: a string
    // with no token — a variable's bare name, the arm the contract declared and
    // the structured executors never read — has no other judge, so it is here.
    ['map', { collection: 'rows' }, 'collection'],
    ['loop', { collection: 'rows' }, 'collection'],
    ['map', { collection: null }, 'collection'],
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

  it('[#19939] a bare-name collection is refused in the contract\'s words, naming that variable in an envelope', () => {
    for (const type of ['loop', 'map'] as const) {
      const [refusal] = flowNodeConfigRefusals(type, { ...VALID[type], collection: 'rows' });
      expect(refusal!.message).toContain(`This \`${type}\` node's config is refused at \`collection\` by the ${type} contract: `
        + '`collection` is the list the node iterates');
      expect(refusal!.message).toContain("A variable's bare name, `rows`, is not one");
      expect(refusal!.message).toContain("`{ dialect: 'cel', source: 'rows' }`");
    }
    const [five] = flowNodeConfigRefusals('map', { ...VALID.map, collection: 5 });
    expect(five!.message).toContain('`collection` is the list the node iterates: a CEL value envelope that evaluates to one');
    expect(five!.message).toContain('This one is a number.');
  });

  it('a type finding closes on what to write at the key', () => {
    const [refusal] = flowNodeConfigRefusals('create_record', { ...VALID.create_record, outputVariable: 42 });
    expect(refusal!.message).toMatch(/Write a value the create_record contract accepts at `outputVariable`\.$/);
  });
});

/**
 * Every finding the three judges `registerFlow` and `objectstack validate` call
 * on one node's config raise — this arm, the value-slot judge and the
 * text-slot judge — each tagged with its judge and located at its path.
 */
function judgedAtTheDoors(type: string, config: Config): string[] {
  return [
    ...flowNodeConfigRefusals(type, config).map(({ path }) => `contract:${path}`),
    ...flowNodeValueTemplateRefusals(type, config).map(({ path }) => `value-slot:${path}`),
    ...flowNodeTextSlotSources(type, config)
      .filter(({ source }) => textSlotTemplateRefusal(source) !== undefined)
      .map(({ path }) => `text-slot:${path}`),
  ];
}

describe('[#23260] a value carrying a `{token}` is judged for its type, like any literal', () => {
  // Every builtin executor parses its config as authored since #19939 deleted
  // the flow interpolator, so the run's contract sees the token the build's
  // sees, and refuses it there at every run that reaches the node.

  it('the probe: get_record limit {x} is refused at nodes.1.config.limit, in the contract\'s words', () => {
    const config = { ...VALID.get_record, limit: '{x}' };
    const issues = issuesOf(flowWith('get_record', config));
    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([{ code: 'custom', path: 'nodes.1.config.limit' }]);
    expect(issues[0]!.message).toBe(flowNodeConfigRefusals('get_record', config)[0]!.message);
    expect(issues[0]!.message).toContain(contractSentence('get_record', config, 'limit'));
    expect(contractSentence('get_record', config, 'limit')).toMatch(/expected number, received string/);
    expect(flowNodeConfigRefusals('get_record', config).map(({ code, params, path }) => ({ code, params, path }))).toEqual([
      { code: 'node-config-refused-by-contract', params: { nodeType: 'get_record', key: 'limit' }, path: 'limit' },
    ]);
  });

  it('defineStack refuses the probe in its ADR-0112 envelope, at flows.0.nodes.1.config.limit', () => {
    const stack = {
      manifest: { id: 'com.example.tokens', name: 'tokens', version: '1.0.0', type: 'app', namespace: 'tok' },
      objects: [{ name: 'tok_account', label: 'Account', fields: { name: { type: 'text', label: 'Name' } } }],
      flows: [flowWith('get_record', { objectName: 'tok_account', limit: '{x}' }, 'tok_probe')],
    };
    let refusal: { code?: unknown; status?: unknown; issues?: Array<{ path: unknown[]; code: string }> } | undefined;
    try {
      defineStack(stack as never);
    } catch (e) {
      refusal = e as typeof refusal;
    }
    expect(refusal, 'defineStack must refuse the flow').toBeDefined();
    expect({ code: refusal!.code, status: refusal!.status }).toEqual({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    expect(refusal!.issues!.map((i) => ({ path: i.path.join('.'), code: i.code }))).toEqual([
      { path: 'flows.0.nodes.1.config.limit', code: 'custom' },
    ]);
  });

  it('CONTROL: a literal of the right type is unchanged', () => {
    const config = { ...VALID.get_record, limit: 25 };
    expect(flowNodeConfigRefusals('get_record', config)).toEqual([]);
    expect(issuesOf(flowWith('get_record', config))).toEqual([]);
  });

  it('in every spelling an author writes, at each typed key', () => {
    const TOKENS: ReadonlyArray<readonly [string, Config, string]> = [
      ['get_record', { limit: '{page.size}' }, 'limit'],
      ['get_record', { limit: '{{ page.size }}' }, 'limit'],
      ['screen', { fields: [{ name: 'qty', min: '${minimum}' }] }, 'fields[0].min'],
      ['update_record', { multi: '{bulk}' }, 'multi'],
      ['notify', { severity: '{level}' }, 'severity'],
      ['loop', { maxIterations: '{cap}' }, 'maxIterations'],
      ['try_catch', { retry: { maxRetries: '{tries}' } }, 'retry.maxRetries'],
    ];
    for (const [type, edit, key] of TOKENS) {
      const config = { ...VALID[type], ...edit };
      expect(flowNodeConfigRefusals(type, config).map(({ code, path }) => ({ code, path })), JSON.stringify(edit))
        .toEqual([{ code: 'node-config-refused-by-contract', path: key }]);
      expect(issuesOf(flowWith(type, config)), JSON.stringify(edit)).toHaveLength(1);
    }
  });

  it('one token at a value slot is reported once — by the value-slot judge, never beside it by this arm', () => {
    // The contracts compose the value-slot judge, so each of these configs is
    // refused by its contract at the slot (a collection's through its union's
    // message); the arm exempts that refusal and the judge alone reports it.
    const CASES: ReadonlyArray<readonly [string, Config, string]> = [
      ['create_record', { ...VALID.create_record, fields: { title: '{record.name}' } }, 'fields.title'],
      ['screen', { objectName: 'account', mode: 'edit', recordId: '{record.id}' }, 'recordId'],
      ['screen', { fields: [{ name: 'qty', type: 'number', defaultValue: '{qty}' }] }, 'fields[0].defaultValue'],
      ['loop', { ...VALID.loop, collection: '{rows}' }, 'collection'],
      ['notify', { ...VALID.notify, recipients: '{owner}' }, 'recipients'],
      ['http', { ...VALID.http, body: '{payload}' }, 'body'],
    ];
    for (const [type, config, key] of CASES) {
      expect(getBuiltinNodeConfigContracts().get(type)!.schema.safeParse(config).success, `${type} ${key}`).toBe(false);
      expect(judgedAtTheDoors(type, config), `${type} ${key}`).toEqual([`value-slot:${key}`]);
    }
  });

  it('one token at a text slot is reported once — by the text-slot judge, never beside it by this arm', () => {
    const CASES: ReadonlyArray<readonly [string, Config, string]> = [
      ['notify', { title: { dialect: 'template', source: 'Deal {deal.name} won' } }, 'title'],
      ['notify', { title: { dialect: 'template', source: 'Hi {{ $User.Id }}' } }, 'title'],
      ['notify', { actionUrl: '/crm_deal/{record.id}' }, 'actionUrl'],
      ['http', { url: 'https://example.test/{id}' }, 'url'],
      ['http', { headers: { 'X-Kind': '{kind}' } }, 'headers.X-Kind'],
      ['screen', { description: 'Order {order.no}' }, 'description'],
    ];
    for (const [type, edit, key] of CASES) {
      const config = { ...VALID[type], ...edit };
      expect(getBuiltinNodeConfigContracts().get(type)!.schema.safeParse(config).success, `${type} ${key}`).toBe(false);
      expect(judgedAtTheDoors(type, config), `${type} ${key}`).toEqual([`text-slot:${key}`]);
    }
  });

  it('a literal the executor reads as written is refused once, in the literal\'s words, never its type\'s', () => {
    // [#19939] The contract refuses `timeoutMs: '{t}'` twice — its type, and the
    // literal's own refusal marked READ_AS_WRITTEN_PARAM; the key is refused once.
    const CASES: ReadonlyArray<readonly [Config, string, string]> = [
      [{ timeoutMs: '{t}' }, 'timeoutMs', '`timeoutMs` is the per-request timeout in milliseconds, a number, a literal the executor reads as written'],
      [{ headers: '{h}' }, 'headers', '`headers` is a map of header name to text, read as written'],
    ];
    for (const [edit, key, lead] of CASES) {
      const config = { ...VALID.http, ...edit };
      const refusals = flowNodeConfigRefusals('http', config);
      expect(refusals.map(({ path }) => path), key).toEqual([key]);
      expect(refusals[0]!.message, key).toContain(lead);
      expect(refusals[0]!.message, key).not.toMatch(/expected (number|record), received string/);
      expect(judgedAtTheDoors('http', config), key).toEqual([`contract:${key}`]);
    }
  });
});

/**
 * [#25302] `get_record`'s `limit` is a positive integer. The executor does not
 * read through `findData`, so the Data API's page-window normalizer never
 * judges it: `limit > 1` is handed to `data.find` as the LIMIT as written
 * (`2.5` included), and anything else (`0`, `-1`, `0.5`) silently became a
 * single-record `findOne`. The contract now refuses the value at every door.
 */
describe('[#25302] get_record limit is a positive integer', () => {
  it('a fraction is refused at nodes.1.config.limit, in the contract\'s words', () => {
    const config = { ...VALID.get_record, limit: 2.5 };
    const issues = issuesOf(flowWith('get_record', config));
    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([{ code: 'custom', path: 'nodes.1.config.limit' }]);
    expect(contractSentence('get_record', config, 'limit')).not.toBe('');
    expect(issues[0]!.message).toContain(contractSentence('get_record', config, 'limit'));
  });

  it.each([[2.5], [0], [-1], [0.5], [Number.MAX_SAFE_INTEGER + 2]])(
    'defineStack refuses limit %s in its ADR-0112 envelope, at flows.0.nodes.1.config.limit',
    (limit) => {
      let refusal: { code?: unknown; status?: unknown; issues?: Array<{ path: unknown[]; code: string }> } | undefined;
      try {
        defineStack({
          manifest: { id: 'com.example.limit', name: 'limit', version: '1.0.0', type: 'app', namespace: 'lim' },
          objects: [{ name: 'lim_account', label: 'Account', fields: { name: { type: 'text', label: 'Name' } } }],
          flows: [flowWith('get_record', { objectName: 'lim_account', limit }, 'lim_probe')],
        } as never);
      } catch (e) {
        refusal = e as typeof refusal;
      }
      expect(refusal, 'defineStack must refuse the flow').toBeDefined();
      expect({ code: refusal!.code, status: refusal!.status }).toEqual({ code: 'STACK_SCHEMA_INVALID', status: 422 });
      expect(refusal!.issues!.map((i) => ({ path: i.path.join('.'), code: i.code }))).toEqual([
        { path: 'flows.0.nodes.1.config.limit', code: 'custom' },
      ]);
    },
  );

  it('the registered `flow` type schema — what the metadata save door validates against — refuses it', () => {
    const schema = getMetadataTypeSchema('flow') as unknown as typeof FlowSchema;
    const r = schema.safeParse(flowWith('get_record', { ...VALID.get_record, limit: 0 }));
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toEqual(['nodes.1.config.limit']);
  });

  it.each([[1], [2], [200]])('CONTROL: limit %s parses, and the judge says nothing', (limit) => {
    const config = { ...VALID.get_record, limit };
    expect(flowNodeConfigRefusals('get_record', config)).toEqual([]);
    const r = FlowSchema.safeParse(flowWith('get_record', config));
    expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
  });

  it('CONTROL: a node with no limit parses unchanged', () => {
    const { limit: _omitted, ...config } = VALID.get_record;
    expect(flowNodeConfigRefusals('get_record', config)).toEqual([]);
    expect(FlowSchema.safeParse(flowWith('get_record', config)).success).toBe(true);
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

  it('CONTROL: a token-free sibling does not shield a refused value (http judges each slot on its own)', () => {
    const config = { ...VALID.http, url: 'https://example.test/{path}', timeoutMs: '5000' };
    expect(flowNodeConfigRefusals('http', config).map(({ path }) => path)).toEqual(['timeoutMs']);
  });

  it('CONTROL: key membership is not this arm\'s — an undeclared key and an aged-out retired one', () => {
    // [#21982] An undeclared key on these builtins draws the KEY arm's one
    // refusal at its location; this arm adds nothing beside it. [#22343] So
    // does a retired key the key arm judges — `try_catch`'s `retry.retryDelayMs`
    // and, since its tombstone aged out at 18 (#25767), `script`'s `actionType`
    // too: each is an unknown key now, and neither draws a second refusal here.
    for (const [type, config, key] of [
      ['http', { ...VALID.http, bogusKey: 1 }, 'bogusKey'],
      ['screen', { fields: [{ name: 'qty', visible: 'x' }] }, 'fields[0].visible'],
      ['try_catch', { ...VALID.try_catch, retry: { retryDelayMs: 500 } }, 'retry.retryDelayMs'],
      ['script', { ...VALID.script, actionType: 'email' }, 'actionType'],
    ] as const) {
      expect(flowNodeConfigRefusals(type, config).map(({ code, path }) => ({ code, path })), type)
        .toEqual([{ code: 'node-config-refused-by-contract', path: key }]);
    }
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
    // [#19939] …at a screen's value slots too, a single value and one under the
    // `fields[]` repeater included — never re-judged, nor read as a key left out.
    for (const config of [
      { objectName: 'a', mode: 'edit', recordId: { dialect: 'cel' } },
      { objectName: 'a', defaults: { k: { dialect: 'cel' } } },
      { fields: [{ name: 'qty', defaultValue: { dialect: 'cel' } }] },
      { fields: [{ name: 'qty', defaultValue: { dialect: 'template', source: 'x' } }] },
    ]) {
      expect(getBuiltinNodeConfigContracts().get('screen')!.schema.safeParse(config).success, JSON.stringify(config)).toBe(false);
      expect(flowNodeConfigRefusals('screen', config), JSON.stringify(config)).toEqual([]);
    }
    // [#19939] …and at a `loop`'s and a `map`'s collection: a malformed envelope
    // is the envelope pass's, a `{token}` the value-slot judge's, an inline
    // array is accepted as written — none is judged here.
    for (const [type, collection] of [
      ['map', { dialect: 'cel' }],
      ['loop', { dialect: 'template', source: 'rows' }],
      ['map', '{rows}'],
      ['loop', '{rows}'],
      ['map', ['{rows}', 1]],
    ] as const) {
      const config = { ...VALID[type], collection };
      expect(flowNodeConfigRefusals(type, config), JSON.stringify(collection)).toEqual([]);
    }
    // A region slot: `validateControlFlow` judges a region's shape at registration.
    expect(flowNodeConfigRefusals('try_catch', { try: 5 })).toEqual([]);
    expect(flowNodeConfigRefusals('parallel', { branches: [{ name: 'a', ...REGION }] })).toEqual([]);
    // http's signing secret: the credential channel may hold the value the run parses.
    expect(flowNodeConfigRefusals('http', { ...VALID.http, signingSecret: 7 })).toEqual([]);
  });

  it('CONTROL: a legacy loop with no body is not parsed by its executor, so nothing is judged', () => {
    expect(getBuiltinNodeConfigContracts().get('loop')!.parsedWhen!({ collection: 5 })).toBe(false);
    expect(flowNodeConfigRefusals('loop', { collection: 5, maxIterations: 0 })).toEqual([]);
    // [#19939] Its bare variable name is the one spelling that form reads.
    expect(flowNodeConfigRefusals('loop', { collection: 'rows' })).toEqual([]);
    expect(issuesOf(flowWith('loop', { collection: 'rows' }))).toEqual([]);
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
