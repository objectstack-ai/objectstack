// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **A screen's three positions that hand a value to the client are value
 * slots** — an object form's `defaults.*`, a field's `defaultValue` and an
 * object form's `recordId` (#19939, the rider positions' second stage; #11182
 * ruling D; ADR-0032 Decision 2, a computed value is whole-field CEL).
 * Declared in the expression ledger and evaluated in the same change.
 *
 * Before this, the executor handed each to the 17.x `interpolate()`: a `{token}`
 * resolved, an envelope written at `defaults.*` or `defaultValue` went on the
 * wire as the object `{ dialect: 'cel', source: '…' }` it spells, and
 * `recordId` was `String(resolved)` of whatever the token found. Pinned
 * through the shipped `AutomationEngine`, on the screen the paused run serves:
 *
 *  1. **Refused at every door.** A `{token}` at each position stops the flow
 *     registering, located at `config.<path>` and naming its CEL envelope; the
 *     executor's contract parse refuses the same token as a guard.
 *  2. **Evaluated before the screen goes on the wire.** Each envelope is
 *     evaluated in the run's scope, and the client receives the value — a
 *     record stays a map, a list a list, the id is a string — never the
 *     envelope.
 *  3. **Absent and `null`.** A whole token that resolved to nothing served
 *     nothing (the key left off the wire). Under CEL an absent value fails the
 *     run at the screen, with its source; the guarded form serves `null` at
 *     `defaults.*` and `defaultValue`. `recordId` must evaluate to the record's
 *     id, a non-blank string: anything else, `null` included, fails the run —
 *     ⛔ never `String(value)`, never an `edit` form served with no record.
 */

import { describe, expect, it } from 'vitest';
import { VALUE_ENVELOPE_REFUSAL, VALUE_SLOT_TEMPLATE_REFUSAL } from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
import { installBuiltinNodes } from './index.js';

function silentLogger(): any {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}
function ctx(): any {
  return { logger: silentLogger(), getService() { return undefined; } };
}

function makeEngine(): AutomationEngine {
  const engine = new AutomationEngine(silentLogger());
  installBuiltinNodes(engine, ctx());
  return engine;
}

/** The builtin executors themselves — the run-time door, reached without `registerFlow`. */
function screenExecutor(): { execute: (...args: any[]) => Promise<any> } {
  const executors = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
  const engine = new AutomationEngine(silentLogger());
  const recorder = new Proxy(engine, {
    get(target, key, receiver) {
      if (key === 'registerNodeExecutor') return (e: any) => { executors.set(e.type, e); };
      return Reflect.get(target, key, receiver);
    },
  });
  installBuiltinNodes(recorder as AutomationEngine, ctx());
  return executors.get('screen')!;
}

const VARIABLES = [
  { name: 'rec', type: 'object', isInput: true },
  { name: 'rows', type: 'list', isInput: true },
  { name: 'account_id', type: 'text', isInput: true },
];

/** start → a `screen` node carrying `config` → end. */
function screenFlow(name: string, config: Record<string, unknown>): any {
  return {
    name, label: name, type: 'screen', variables: VARIABLES,
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'form', type: 'screen', label: 'Form', config },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'form' }, { id: 'e2', source: 'form', target: 'end' }],
  };
}

const REC = { id: 'acc_1', name: 'Acme', tier: 'gold' };
const ROWS = [{ id: 'c1' }, { id: 'c2' }];
const PARAMS = { params: { rec: REC, rows: ROWS, account_id: 'acc_9' } } as any;
const CEL = (source: string) => ({ dialect: 'cel', source });

/** Run `config` as a one-screen flow and hand back what the paused run serves — or the failed run. */
async function serve(config: Record<string, unknown>, context: any = PARAMS): Promise<any> {
  const engine = makeEngine();
  engine.registerFlow('screen_probe', screenFlow('screen_probe', config));
  return engine.execute('screen_probe', context);
}

/** The three positions: what an author writes there, and where the refusal locates it. */
const POSITIONS = [
  ['recordId', (v: unknown) => ({ objectName: 'account', mode: 'edit', recordId: v }), 'recordId'],
  ['defaults.*', (v: unknown) => ({ objectName: 'account', defaults: { account: v } }), 'defaults.account'],
  ['fields[].defaultValue', (v: unknown) => ({ fields: [{ name: 'email', type: 'text', defaultValue: v }] }), 'fields[0].defaultValue'],
] as const;

describe('1. a `{token}` at a screen\'s value slots is refused at every door', () => {
  it.each(POSITIONS)('%s: `registerFlow` refuses it at its path, naming the envelope and what the client is served', (_what, configOf, at) => {
    let message = '';
    try {
      makeEngine().registerFlow('refused', screenFlow('refused', configOf('{account_id}')));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain(`at config.${at}: ${VALUE_SLOT_TEMPLATE_REFUSAL}`);
    expect(message).toContain("{ dialect: 'cel', source: 'account_id' }");
    expect(message).toMatch(/prefills (the object form's `account` field|this screen field)|names the record an `edit` form opens/);
  });

  it.each(POSITIONS)('%s: the executor\'s contract parse refuses it too, as a guard', async (_what, configOf, at) => {
    const result = await screenExecutor().execute(
      { id: 'form', type: 'screen', label: 'Form', config: configOf('{account_id}') },
      new Map<string, unknown>([['account_id', 'acc_9']]),
      {},
    );
    expect(result.success).toBe(false);
    expect(result.errorClass).toBe('guard');
    expect(result.error).toContain(`config.${at}: ${VALUE_SLOT_TEMPLATE_REFUSAL}`);
  });

  it.each(POSITIONS)('%s: an envelope whose source is not CEL is refused at `registerFlow` — the ledger routes it to the envelope pass', (_what, configOf, at) => {
    let message = '';
    try {
      makeEngine().registerFlow('refused', screenFlow('refused', configOf(CEL('rec.name +'))));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain(`at config.${at}: ${VALUE_ENVELOPE_REFUSAL}`);
  });
});

describe('2. each envelope is evaluated before the screen goes on the wire — the client receives the value', () => {
  it('object form: `recordId` is served as the string id, `defaults` as the values — a record a map, a list a list', async () => {
    const paused = await serve({
      objectName: 'account', mode: 'edit',
      recordId: CEL('rec.id'),
      defaults: { parent: CEL('rec'), contacts: CEL('rows'), label: CEL("'Hi ' + rec.name"), stage: 'qualification', n: 3 },
    });
    expect(paused.status, paused.error).toBe('paused');
    expect(paused.screen.kind).toBe('object-form');
    expect(paused.screen.recordId).toBe('acc_1');
    expect(paused.screen.defaults).toEqual({ parent: REC, contacts: ROWS, label: 'Hi Acme', stage: 'qualification', n: 3 });
    expect(Array.isArray(paused.screen.defaults.contacts)).toBe(true);
    // What goes on the wire carries no envelope at all.
    expect(JSON.stringify(paused.screen)).not.toContain('"dialect"');
  });

  it('flat screen: each field\'s `defaultValue` is served as the value it computes, literals as written', async () => {
    const paused = await serve({
      fields: [
        { name: 'tier', type: 'text', defaultValue: CEL('rec.tier') },
        { name: 'contacts', type: 'text', defaultValue: CEL('rows') },
        { name: 'record', type: 'text', defaultValue: CEL('rec') },
        { name: 'priority', type: 'text', defaultValue: 'normal' },
        { name: 'none', type: 'text' },
      ],
    });
    expect(paused.status, paused.error).toBe('paused');
    expect(paused.screen.fields.map((f: { defaultValue: unknown }) => f.defaultValue))
      .toEqual(['gold', ROWS, REC, 'normal', undefined]);
    expect(JSON.stringify(paused.screen)).not.toContain('"dialect"');
  });

  it('a literal `recordId` is served as written', async () => {
    const paused = await serve({ objectName: 'account', mode: 'edit', recordId: 'acc_7' });
    expect(paused.screen.recordId).toBe('acc_7');
  });

  it('a pass-through screen goes on no wire, so nothing on it is evaluated', async () => {
    const run = await serve({ waitForInput: false, fields: [{ name: 'x', type: 'text', defaultValue: CEL('nope') }] });
    expect(run.success, run.error).toBe(true);
    expect(run.status).not.toBe('paused');
  });
});

describe('3. absent and `null` — what each position serves, and where the run fails', () => {
  const GUARDED = CEL('has(vars.nope) ? vars.nope : null');

  it('what the template did: a whole token that resolved to nothing served nothing — the key leaves the wire', () => {
    // The 17.x interpolator served `{ account: '{nope}' }` as `{ account: undefined }`.
    const served: Record<string, unknown> = { account: undefined };
    expect(JSON.parse(JSON.stringify(served))).toEqual({});
  });

  it.each(POSITIONS)('%s: an unguarded absent value fails the run at the screen, naming its source — nothing is served', async (_what, configOf, at) => {
    const run = await serve(configOf(CEL('nope')));
    expect(run.success).toBe(false);
    expect(run.status).not.toBe('paused');
    expect(run.error).toContain(`${at}: value expression failed to evaluate as CEL`);
    expect(run.error).toContain('source: `nope`');
  });

  it('defaults: the guarded form serves `null` — a value on the wire, where the template served no key', async () => {
    const paused = await serve({ objectName: 'account', defaults: { account: GUARDED, stage: 'new' } });
    expect(paused.screen.defaults).toEqual({ account: null, stage: 'new' });
    expect(JSON.parse(JSON.stringify(paused.screen.defaults))).toEqual({ account: null, stage: 'new' });
  });

  it('defaults: writing the default in the guard serves it', async () => {
    const paused = await serve({ objectName: 'account', defaults: { stage: CEL("has(vars.nope) ? vars.nope : 'prospecting'") } });
    expect(paused.screen.defaults).toEqual({ stage: 'prospecting' });
  });

  it('a field\'s defaultValue: the guarded form serves `null`', async () => {
    const paused = await serve({ fields: [{ name: 'email', type: 'text', defaultValue: GUARDED }] });
    expect(paused.screen.fields[0].defaultValue).toBeNull();
    expect(JSON.parse(JSON.stringify(paused.screen.fields[0]))).toHaveProperty('defaultValue', null);
  });

  it.each([
    ['`null` — the guarded form', GUARDED, '`null`'],
    ['a map', CEL('rec'), 'a map'],
    ['a list', CEL('rows'), 'a list'],
    ['a blank string', CEL("' '"), 'a blank string'],
  ] as const)('recordId: an envelope that evaluates to %s fails the run at the screen — never `String(value)`, never an edit form with no record', async (_what, envelope, kind) => {
    const run = await serve({ objectName: 'account', mode: 'edit', recordId: envelope });
    expect(run.success).toBe(false);
    expect(run.status).not.toBe('paused');
    expect(run.error).toContain(`recordId: the value expression evaluated to ${kind}, not a record id.`);
    expect(run.error).toContain('route around this screen with a `decision` on the value');
    expect(run.error).toContain(`source: \`${envelope.source}\``);
    expect(run.error).not.toContain('[object Object]');
  });

  it('recordId: the template\'s `String(resolved)` is gone — a record the token found is no id', async () => {
    // The 17.x reader stringified whatever the token resolved to: `[object Object]` for a record.
    expect(String(REC)).toBe('[object Object]');
    const run = await serve({ objectName: 'account', mode: 'edit', recordId: CEL('rec') });
    expect(run.success).toBe(false);
  });
});
