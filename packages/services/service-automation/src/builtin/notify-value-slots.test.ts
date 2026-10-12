// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **A `notify` node's computed values are value slots, its link is a text
 * slot, and the rest are literals** (#19939, the rider positions' fourth
 * stage; #11182 ruling D; ADR-0032 Decisions 2 and 3). Declared in the
 * expression ledger and evaluated in the same change: `recipients` (the value,
 * or each entry of a list), `templateData.*` and `sourceId` take a CEL value
 * envelope or a literal; `actionUrl` renders `{{ }}` holes. `sourceObject`,
 * `actorId` and `payload` are literals, read as written: the 17.x
 * interpolator resolved them too, but no flow computed one, so no slot is
 * built there (the S4 ruling) and a `{…}` token or an envelope there is
 * refused with the literal's remedy.
 *
 * Before this, the executor ran each of them through the single-brace
 * `interpolate()` (measured on the base through this engine, the shipped
 * builtins and a recording messaging service):
 *
 *  - `recipients: ['{owners}']` with `owners = ['u1', 'u2']` reached the
 *    messaging service as ONE recipient, `'u1,u2'` — the run reported
 *    success and the notification addressed nobody; `['{owner}']` holding a
 *    record reached it as `'[object Object]'`;
 *  - `actionUrl: '{obj}'` holding a map sent the link `[object Object]`, a
 *    `Date` in `'/x/{when}'` was written JSON-quoted, and `'/x/{{ id }}'`
 *    became `'/x/{42}'`;
 *  - an envelope at `recipients`, `sourceObject`, `sourceId` or `actorId` was
 *    refused at `registerFlow`, and one in `templateData` was handed to the
 *    template as the object it spells.
 *
 * Pinned through the shipped `AutomationEngine`:
 *
 *  1. **Refused at every door.** A `{…}` token stops the flow registering,
 *     located at the position and naming its CEL spelling (its hole spelling
 *     at `actionUrl`); the executor's contract parse refuses it as a guard.
 *  2. **Evaluated in the run's scope.** Each envelope is evaluated; a literal
 *     is handed on as written.
 *  3. **A list-valued recipient adds each recipient** — the family finding:
 *     never one recipient joined with commas.
 *  4. **Absent, `null`, not a recipient.** An absent variable fails the run
 *     with an evaluation fault naming it; `null` drops a recipient, and a node
 *     left with none fails, naming the expressions that evaluated to nothing;
 *     a map or a number fails the node, naming what it evaluated to.
 *  5. **`actionUrl` is a text slot.** A `{{ }}` hole renders; an explicit link
 *     still wins over the synthesized one, and a link that renders nothing
 *     yields to it.
 *  6. **`sourceObject`, `actorId` and `payload` are literals.** A literal is
 *     handed on as written; a `{…}` token and an envelope are refused at
 *     `registerFlow` and by the executor's contract parse, with the literal's
 *     remedy (`objectstack validate` is pinned in the lint).
 */

import { describe, expect, it } from 'vitest';
import { TEXT_SLOT_TEMPLATE_REFUSAL, VALUE_SLOT_TEMPLATE_REFUSAL } from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
import { installBuiltinNodes } from './index.js';

function silentLogger(): any {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}

const CEL = (source: string) => ({ dialect: 'cel', source });

/** An engine with the builtins and a messaging service that records each emit. */
function makeEngine(): { engine: AutomationEngine; emitted: any[] } {
  const emitted: any[] = [];
  const messaging = {
    async emit(n: any) {
      emitted.push(n);
      return { notificationId: 'evt_1', delivered: n.audience.length, failed: 0 };
    },
  };
  const engine = new AutomationEngine(silentLogger());
  installBuiltinNodes(engine, {
    logger: silentLogger(),
    getService(name: string) { return name === 'messaging' ? messaging : undefined; },
  } as any);
  return { engine, emitted };
}

/** start → notify → end, with the notify config `title: 'T'` plus `config`. */
function flowOf(name: string, config: Record<string, unknown>): any {
  return {
    name, label: name, type: 'autolaunched',
    variables: [
      { name: 'owners', type: 'list', isInput: true },
      { name: 'owner', type: 'text', isInput: true },
      { name: 'obj', type: 'object', isInput: true },
      { name: 'id', type: 'text', isInput: true },
    ],
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'node', type: 'notify', label: 'Notify', config: { title: 'T', ...config } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'node' },
      { id: 'e2', source: 'node', target: 'end' },
    ],
  };
}

function registerError(config: Record<string, unknown>): string {
  try {
    makeEngine().engine.registerFlow('refused', flowOf('refused', config));
  } catch (e) {
    return (e as Error).message;
  }
  return '';
}

async function run(config: Record<string, unknown>, params: Record<string, unknown> = {}) {
  const { engine, emitted } = makeEngine();
  engine.registerFlow('probe', flowOf('probe', config));
  const result = await engine.execute('probe', { params } as any);
  const runs = await engine.listRuns('probe');
  const step = runs[0]?.steps.find((s) => s.nodeId === 'node');
  return { result, emitted, step };
}

/** The builtin `notify` executor itself — the run-time door, reached without `registerFlow`. */
function notifyExecutor(): { execute: (...args: any[]) => Promise<any> } {
  const executors = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
  const engine = new AutomationEngine(silentLogger());
  const recorder = new Proxy(engine, {
    get(target, key, receiver) {
      if (key === 'registerNodeExecutor') return (e: any) => { executors.set(e.type, e); };
      return Reflect.get(target, key, receiver);
    },
  });
  installBuiltinNodes(recorder as AutomationEngine, { logger: silentLogger(), getService() { return undefined; } } as any);
  return executors.get('notify')!;
}

/** Each value position: the config holding `value` there, and where a refusal locates it. */
const VALUE_POSITIONS = [
  ['recipients (the value)', (value: unknown) => ({ recipients: value }), 'notify recipient at config.recipients'],
  ['recipients (a list entry)', (value: unknown) => ({ recipients: ['u1', value] }), 'notify recipient at config.recipients[1]'],
  ['templateData', (value: unknown) => ({ recipients: 'u1', title: undefined, template: 'crm.t', templateData: { who: value } }), 'notify templateData value at config.templateData.who'],
  ['sourceId', (value: unknown) => ({ recipients: 'u1', sourceObject: 'o', sourceId: value }), 'notify sourceId at config.sourceId'],
] as const;

/**
 * Each LITERAL position: the config holding `value` there, the path the
 * contract's refusal names, and the sentence it leads with.
 */
const LITERAL_POSITIONS = [
  ['sourceObject', (value: unknown) => ({ recipients: 'u1', sourceObject: value, sourceId: 'r1' }), 'sourceObject', '`sourceObject` is the name of the object the notification links to, a literal the executor reads as written:'],
  ['actorId', (value: unknown) => ({ recipients: 'u1', actorId: value }), 'actorId', '`actorId` is the id of the user who caused the event, a literal the executor reads as written:'],
  ['payload', (value: unknown) => ({ recipients: 'u1', payload: { who: value } }), 'payload.who', '`payload.who` is a value merged into the notification payload, a literal the executor reads as written:'],
] as const;

const LITERAL_TOKEN_REMEDY = 'a single-brace token is not resolved here; write the value.';
const LITERAL_ENVELOPE_REMEDY = 'a CEL value envelope is not evaluated here; write the value.';

describe('1. a `{…}` token is refused at every door', () => {
  it.each(VALUE_POSITIONS)('%s: `registerFlow` refuses a token, located, naming its CEL spelling', (_label, configOf, where) => {
    const message = registerError(configOf('{owner}'));
    expect(message).toContain(`${where}: ${VALUE_SLOT_TEMPLATE_REFUSAL}`);
    expect(message).toContain("Write `{owner}` as { dialect: 'cel', source: 'owner' }.");
  });

  it.each(VALUE_POSITIONS)('%s: the executor\'s contract parse refuses it as a guard', async (_label, configOf) => {
    const result = await notifyExecutor().execute(
      { id: 'node', type: 'notify', label: 'Notify', config: { title: 'T', ...configOf('{owner}') } },
      new Map<string, unknown>([['owner', 'u9']]),
      {},
    );
    expect(result.success).toBe(false);
    expect(result.errorClass).toBe('guard');
    expect(result.error).toContain(VALUE_SLOT_TEMPLATE_REFUSAL);
  });

  it('recipients: the refusal says what a `null` and a list add to the audience', () => {
    const message = registerError({ recipients: ['{owner}'] });
    expect(message).toContain(
      '`recipients[0]` names who the notification goes to: an envelope there that evaluates to `null` or a blank '
      + 'string adds no recipient, as a token that resolved to nothing did, and one that evaluates to a list adds '
      + 'each of its recipients.',
    );
  });

  it('actionUrl: `registerFlow` refuses a single-brace token, naming its hole spelling', () => {
    const message = registerError({ recipients: 'u1', actionUrl: '/x/{id}' });
    expect(message).toContain(`notify actionUrl at config.actionUrl: ${TEXT_SLOT_TEMPLATE_REFUSAL}`);
    expect(message).toContain('Write `/x/{id}` as `/x/{{ id }}`.');
  });

  it('actionUrl: the executor\'s contract parse refuses it as a guard', async () => {
    const result = await notifyExecutor().execute(
      { id: 'node', type: 'notify', label: 'Notify', config: { title: 'T', recipients: 'u1', actionUrl: '/x/{id}' } },
      new Map<string, unknown>([['id', '42']]),
      {},
    );
    expect(result.success).toBe(false);
    expect(result.errorClass).toBe('guard');
    expect(result.error).toContain(TEXT_SLOT_TEMPLATE_REFUSAL);
  });
});

describe('2. an envelope is evaluated in the run\'s scope; a literal is handed on as written', () => {
  it('recipients: a literal string, a literal list, an envelope and envelope entries', async () => {
    expect((await run({ recipients: 'team:ops' })).emitted[0].audience).toEqual(['team:ops']);
    expect((await run({ recipients: ['u1', 'u2'] })).emitted[0].audience).toEqual(['u1', 'u2']);
    expect((await run({ recipients: CEL('owner') }, { owner: 'u9' })).emitted[0].audience).toEqual(['u9']);
    expect((await run({ recipients: ['team:ops', CEL('owner')] }, { owner: 'u9' })).emitted[0].audience)
      .toEqual(['team:ops', 'u9']);
  });

  it('a string is the literal it spells — no longer split, no longer interpolated', async () => {
    expect((await run({ recipients: 'u1,u2' })).emitted[0].audience).toEqual(['u1,u2']);
  });

  it('templateData: each envelope evaluated, each literal handed on', async () => {
    const template = await run(
      { recipients: 'u1', title: undefined, template: 'crm.t', templateData: { who: CEL('owner'), n: 3, label: 'lit' } },
      { owner: 'u9' },
    );
    expect(template.result.success).toBe(true);
    expect(template.emitted[0].payload.templateData).toEqual({ who: 'u9', n: 3, label: 'lit' });
  });

  it('sourceId: an envelope evaluates to the string', async () => {
    const { emitted } = await run({ recipients: 'u1', sourceObject: 'crm_case', sourceId: CEL('id') }, { id: 'c_42' });
    expect(emitted[0].source).toEqual({ object: 'crm_case', id: 'c_42' });
  });
});

describe('3. a list-valued recipient adds each of its recipients (the family finding)', () => {
  it('an entry that evaluates to a list adds each recipient — never one joined with commas', async () => {
    const { result, emitted } = await run({ recipients: [CEL('owners'), 'team:ops'] }, { owners: ['u1', 'u2'] });
    expect(result.success).toBe(true);
    expect(emitted[0].audience).toEqual(['u1', 'u2', 'team:ops']);
    expect(emitted[0].audience).not.toContain('u1,u2');
  });

  it('the whole value evaluating to a list is the list; `null` and blank entries in it add none', async () => {
    const { emitted } = await run({ recipients: CEL('owners') }, { owners: ['u1', null, ' ', 'u2'] });
    expect(emitted[0].audience).toEqual(['u1', 'u2']);
  });
});

describe('4. absent, `null`, not a recipient', () => {
  it('an absent variable fails the run with an evaluation fault naming the position', async () => {
    const { result, step } = await run({ recipients: ['u1', CEL('owner')] });
    expect(result.success).toBe(false);
    expect(step?.error?.code).toBe('EXECUTION_ERROR');
    expect(step?.error?.message).toContain('recipients[1]: value expression failed to evaluate as CEL: Unknown variable: owner');
  });

  it('a guarded `null` drops the recipient, as the template dropped one that resolved to nothing', async () => {
    const { result, emitted } = await run({ recipients: ['u1', CEL('has(vars.owner) ? vars.owner : null')] });
    expect(result.success).toBe(true);
    expect(emitted[0].audience).toEqual(['u1']);
  });

  it('a node left with no recipient fails, naming the expressions that evaluated to nothing', async () => {
    const { result, step, emitted } = await run({ recipients: [CEL('has(vars.owner) ? vars.owner : null'), CEL('owners')] }, { owners: [] });
    expect(result.success).toBe(false);
    expect(step?.error?.code).toBe('NODE_FAILURE');
    expect(step?.error?.message).toContain(
      'notify: at least one recipient is required, but every recipient value expression evaluated to nothing: '
      + '`has(vars.owner) ? vars.owner : null`, `owners`.',
    );
    expect(emitted).toHaveLength(0);
  });

  it('a recipient that evaluates to a map fails the node, naming it — never `[object Object]`', async () => {
    const { result, step, emitted } = await run({ recipients: [CEL('obj')] }, { obj: { id: 'u9' } });
    expect(result.success).toBe(false);
    expect(step?.error?.code).toBe('NODE_FAILURE');
    expect(step?.error?.message).toContain('notify: recipients[0] evaluated to a map, not a recipient');
    expect(step?.error?.message).toContain('source: `obj`');
    expect(emitted).toHaveLength(0);
  });

  it('a list holding something that is not a recipient fails the node, naming the entry', async () => {
    const { step } = await run({ recipients: CEL("[dyn('u1'), dyn(42)]") });
    expect(step?.error?.code).toBe('NODE_FAILURE');
    expect(step?.error?.message).toContain('notify: recipients evaluated to a list whose entry [1] is a number (`42`), not a recipient');
  });

  it('sourceId: `null` drops the click-through pair; a map fails the node', async () => {
    const dropped = await run({ recipients: 'u1', sourceObject: 'o', sourceId: CEL('has(vars.id) ? vars.id : null') });
    expect(dropped.result.success).toBe(true);
    expect(dropped.emitted[0].source).toBeUndefined();
    const refused = await run({ recipients: 'u1', sourceObject: 'o', sourceId: CEL('obj') }, { obj: { a: 1 } });
    expect(refused.step?.error?.code).toBe('NODE_FAILURE');
    expect(refused.step?.error?.message).toContain('notify: sourceId evaluated to a map, not a string');
  });
});

describe('5. `actionUrl` is a text slot', () => {
  it('a `{{ }}` hole renders, and the explicit link wins over the synthesized one', async () => {
    const { emitted } = await run({ recipients: 'u1', sourceObject: 'o', sourceId: 'r1', actionUrl: '/crm_case/{{ id }}' }, { id: 'c_42' });
    expect(emitted[0].payload.url).toBe('/crm_case/c_42');
    expect(emitted[0].source).toEqual({ object: 'o', id: 'r1' });
  });

  it('a whole hole holding a map renders JSON, never `[object Object]`', async () => {
    const { emitted } = await run({ recipients: 'u1', actionUrl: '{{ obj }}' }, { obj: { a: 1 } });
    expect(emitted[0].payload.url).toBe('{"a":1}');
  });

  it('a link that renders nothing is no link: the synthesized one still applies downstream', async () => {
    const { emitted } = await run({ recipients: 'u1', sourceObject: 'o', sourceId: 'r1', actionUrl: '{{ id }}' });
    expect(emitted[0].payload.url).toBeUndefined();
    expect(emitted[0].source).toEqual({ object: 'o', id: 'r1' });
  });
});

describe('6. `sourceObject`, `actorId` and `payload` are literals, read as written', () => {
  it('a literal is handed on as written — the object, the actor and the payload\'s data, nested data included', async () => {
    const { result, emitted } = await run(
      {
        recipients: 'u1', sourceObject: 'crm_case', sourceId: CEL('id'), actorId: 'usr_boss',
        payload: { kind: 'case', meta: { tags: ['a', 'b'], inner: CEL('id') }, n: 3 },
      },
      { id: 'c_42' },
    );
    expect(result.success).toBe(true);
    expect(emitted[0].source).toEqual({ object: 'crm_case', id: 'c_42' });
    expect(emitted[0].actorId).toBe('usr_boss');
    // An envelope deeper in a value is data, handed on as the object it spells.
    expect(emitted[0].payload).toMatchObject({ kind: 'case', meta: { tags: ['a', 'b'], inner: CEL('id') }, n: 3 });
  });

  it.each(LITERAL_POSITIONS)('%s: `registerFlow` refuses a `{…}` token with the literal remedy, at the key', (_label, configOf, at, lead) => {
    const message = registerError(configOf('{owner}'));
    expect(message).toContain(`refused at \`${at}\` by the notify contract: ${lead} ${LITERAL_TOKEN_REMEDY}`);
    expect(message).toContain('Read as written, `{owner}` would reach the messaging service with its braces.');
    expect(message).not.toContain(VALUE_SLOT_TEMPLATE_REFUSAL);
  });

  it.each(LITERAL_POSITIONS)('%s: `registerFlow` refuses a CEL value envelope — nothing evaluates it there', (_label, configOf, at, lead) => {
    const message = registerError(configOf(CEL('owner')));
    expect(message).toContain(`refused at \`${at}\` by the notify contract: ${lead} ${LITERAL_ENVELOPE_REMEDY}`);
  });

  it.each(LITERAL_POSITIONS)('%s: the executor\'s contract parse refuses a token and an envelope as a guard', async (_label, configOf, _at, lead) => {
    for (const value of ['{owner}', CEL('owner')]) {
      const result = await notifyExecutor().execute(
        { id: 'node', type: 'notify', label: 'Notify', config: { title: 'T', ...configOf(value) } },
        new Map<string, unknown>([['owner', 'u9']]),
        {},
      );
      expect(result.success, JSON.stringify(value)).toBe(false);
      expect(result.errorClass).toBe('guard');
      expect(result.error).toContain(lead);
      expect(result.error).toContain(typeof value === 'string' ? LITERAL_TOKEN_REMEDY : LITERAL_ENVELOPE_REMEDY);
    }
  });
});
