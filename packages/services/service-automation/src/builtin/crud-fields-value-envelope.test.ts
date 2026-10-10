// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **The CEL value envelope in `create_record` / `update_record` `fields.*`** —
 * the executor half of #11182 ruling D, landing with the ledger declaration
 * #19938 makes (maintainer ruling B: one change, so the slot is never declared
 * without being evaluated).
 *
 * Before this, both executors handed the whole `fields` map to `interpolate()`,
 * which recursed into an envelope as plain data: a text or JSON column received
 * the literal `{"dialect":"cel","source":"…"}` with the run reporting success,
 * and a number column was refused by the data engine. Measured on the base
 * tree before this change; the assertions below are on what reaches the STORE,
 * through a real ObjectQL engine over a recording driver.
 *
 * Pinned:
 *  1. **Evaluate** — a valid envelope in `fields.*` is evaluated by the same
 *     engine call the `assignment` executor makes, and its value is written,
 *     type kept.
 *  2. **Preserve** — every literal writes exactly what the old whole-map
 *     `interpolate()` wrote. (A `{…}` template no longer reaches a write:
 *     #19939, ruling D's v18 half, refuses it — pinned below, with the CEL
 *     spelling that writes the same value.)
 *  3. **Refuse at registration** — a malformed envelope stops the flow
 *     registering, located at `config.fields.<field>` and led by the
 *     slot-neutral sentence; the evaluator refuses the same set.
 *  4. **Fault loudly** — an envelope that parses but cannot evaluate on the
 *     live values fails the run with its source, and writes nothing.
 *  5. **The date macros' parity** (#19939 pass 3) — the live cross-dialect
 *     pin: for each date macro, the 17.x interpolator and the CEL envelope the
 *     refusal names run over the SAME instants, and the store receives the
 *     same bytes from both; the edges where they part are pinned as the
 *     refusal names them.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { VALUE_ENVELOPE_REFUSAL, VALUE_SLOT_TEMPLATE_REFUSAL, valueSlotTemplateRefusals } from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
import { registerCrudNodes } from './crud-nodes.js';
import { interpolate, interpolateString } from './template.js';

function makeLogger(): any {
  const l: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {} };
  l.child = () => l;
  return l;
}

/** Records every row that reaches the store — the row is the verdict. */
function makeRecordingDriver() {
  const writes: Array<{ op: 'create' | 'update'; data: Record<string, unknown> }> = [];
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return []; },
    async findOne() { return { id: 'q1' }; },
    async create(_o: string, data: Record<string, unknown>) { writes.push({ op: 'create', data: { ...data } }); return { id: 'q1', ...data }; },
    async update(_o: string, id: string, data: Record<string, unknown>) { writes.push({ op: 'update', data: { ...data } }); return { id, ...data }; },
    async updateMany() { return 0; },
    async delete() { return true; }, async deleteMany() { return 0; }, async count() { return 0; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => driver.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, writes };
}

async function makeStack() {
  const logger = makeLogger();
  const ql = new ObjectQL({ logger });
  const { driver, writes } = makeRecordingDriver();
  ql.registerDriver(driver, true);
  await ql.init();
  ql.registry.registerObject({
    name: 'quote',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      total: { name: 'total', type: 'number' },
      subject: { name: 'subject', type: 'text' },
      payload: { name: 'payload', type: 'json' },
    },
  } as any, 'test');
  const automation = new AutomationEngine(logger);
  registerCrudNodes(automation, { logger, getService: (n: string) => (n === 'data' ? ql : undefined) } as any);
  return { automation, writes };
}

/** The CRUD executors themselves, over the same recording store — for the run-time twin. */
async function captureExecutors() {
  const logger = makeLogger();
  const ql = new ObjectQL({ logger });
  const { driver, writes } = makeRecordingDriver();
  ql.registerDriver(driver, true);
  await ql.init();
  const executors = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
  const engine = new AutomationEngine(logger);
  const recorder = new Proxy(engine, {
    get(target, key, receiver) {
      if (key === 'registerNodeExecutor') return (e: any) => { executors.set(e.type, e); };
      return Reflect.get(target, key, receiver);
    },
  });
  registerCrudNodes(recorder as AutomationEngine, { logger, getService: (n: string) => (n === 'data' ? ql : undefined) } as any);
  return { writes, executors };
}

type WriteNode = 'create_record' | 'update_record';

function writeFlow(nodeType: WriteNode, fields: Record<string, unknown>) {
  const config: Record<string, unknown> = { objectName: 'quote', fields };
  if (nodeType === 'update_record') config.filter = { id: 'q1' };
  return {
    name: 'price_quote', label: 'Price Quote', type: 'autolaunched',
    variables: [
      { name: 'price', type: 'number', isInput: true },
      { name: 'rows', type: 'text', isInput: true },
      { name: 'name', type: 'text', isInput: true },
    ],
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'w', type: nodeType, label: 'Write', config },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'w' },
      { id: 'e2', source: 'w', target: 'end' },
    ],
  } as any;
}

const PARAMS = { price: 1234.5678, rows: [{ subject: 'Renewal' }, { subject: '' }, { subject: 'Invoice' }], name: 'ada' };
const run = (automation: AutomationEngine) => automation.execute('price_quote', { userId: 'u1', params: PARAMS } as any);

const NODE_TYPES: readonly WriteNode[] = ['create_record', 'update_record'];

/** Every way an envelope can be malformed — the assignment slot's own list. */
const MALFORMED: ReadonlyArray<{ label: string; envelope: Record<string, unknown> }> = [
  { label: 'no `source`', envelope: { dialect: 'cel' } },
  { label: 'an empty `source`', envelope: { dialect: 'cel', source: '' } },
  { label: 'a whitespace-only `source`', envelope: { dialect: 'cel', source: '   ' } },
  { label: 'an `ast`-only envelope', envelope: { dialect: 'cel', ast: { op: 'value' } } },
  { label: 'a non-`cel` dialect', envelope: { dialect: 'template', source: 'Hi {name}' } },
  { label: 'CEL that does not parse', envelope: { dialect: 'cel', source: 'price *' } },
  { label: 'an unknown function', envelope: { dialect: 'cel', source: 'nosuchfn(price)' } },
];

describe.each(NODE_TYPES)('%s `fields.*` — a CEL value envelope is EVALUATED (#11182 ruling D)', (nodeType) => {
  it('writes the evaluated value into a number column — the money case, `/ 100.0` keeping the cents', async () => {
    const { automation, writes } = await makeStack();
    automation.registerFlow('price_quote', writeFlow(nodeType, {
      total: { dialect: 'cel', source: 'round(price * 100.0) / 100.0' },
    }));
    const res = await run(automation);
    expect(res.success, res.error).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.data.total).toBe(1234.57);
  });

  it('writes the evaluated value into a text column — the CEL stdlib is reachable from a field value', async () => {
    const { automation, writes } = await makeStack();
    automation.registerFlow('price_quote', writeFlow(nodeType, {
      subject: { dialect: 'cel', source: 'joinNonEmpty(rows.map(r, r.subject), ", ")' },
    }));
    const res = await run(automation);
    expect(res.success, res.error).toBe(true);
    expect(writes[0]!.data.subject).toBe('Renewal, Invoice');
  });

  it('this is a CHANGE: the same field used to be written as the envelope object', async () => {
    // The pre-change behaviour, reproduced through the old code path itself:
    // `interpolate()` over the whole map recursed into the envelope as data.
    const envelope = { dialect: 'cel', source: 'upper(name)' };
    expect(interpolate({ payload: envelope }, new Map(Object.entries(PARAMS)), {} as any)).toEqual({ payload: envelope });

    const { automation, writes } = await makeStack();
    automation.registerFlow('price_quote', writeFlow(nodeType, { payload: envelope }));
    const res = await run(automation);
    expect(res.success, res.error).toBe(true);
    expect(writes[0]!.data.payload).toBe('ADA');
  });
});

describe.each(NODE_TYPES)('%s `fields.*` — every literal writes exactly what it wrote before', (nodeType) => {
  it('literals, arrays and nested envelope-shaped JSON: byte-identical to the whole-map `interpolate()`', async () => {
    const fields = {
      subject: '2026-10-17',                              // an ISO date, as it is (a date macro is refused, #19939)
      total: 42,
      payload: {
        note: 'for the record',
        inner: { dialect: 'cel', source: 'price * 2' },   // NESTED envelope shape — data, not evaluated
        list: [{ dialect: 'cel', source: 'x' }, 'plain'],
        weird: { dialect: 1 },
      },
    };
    const before = interpolate(fields, new Map(Object.entries(PARAMS)), {} as any);

    const { automation, writes } = await makeStack();
    automation.registerFlow('price_quote', writeFlow(nodeType, fields));
    const res = await run(automation);
    expect(res.success, res.error).toBe(true);
    const written = { ...writes[0]!.data };
    for (const k of Object.keys(written)) if (!(k in fields)) delete written[k];   // platform stamps
    expect(written).toEqual(before);
    expect((written.payload as { inner: unknown }).inner, 'a nested envelope is DATA').toEqual({ dialect: 'cel', source: 'price * 2' });
  });
});

/**
 * [#19939] The `{…}` template dialect is retired from `fields.*` (the C half
 * of #11182 ruling D) — refused at registration, and by the executor's own
 * `parseNodeConfig` for a flow that never went through registration. Nothing
 * is written either way: the template used to write what the CEL envelope
 * named in the refusal now writes.
 */
describe.each(NODE_TYPES)('%s `fields.*` — the retired `{…}` template dialect is refused, and nothing is written', (nodeType) => {
  const TEMPLATED: ReadonlyArray<[string, Record<string, unknown>, string, string]> = [
    ['a sole token', { total: '{price}' }, 'config.fields.total', "source: 'price'"],
    ['text with holes', { subject: 'Quote for {name} at {price}' }, 'config.fields.subject', `"'Quote for ' + name + ' at ' + price"`],
    ['a string inside a literal — the whole value as a CEL literal', { payload: { note: 'for {name}' } }, 'config.fields.payload.note', `"{'note': 'for ' + name}"`],
    ['a template expression', { total: '{round(price * 100) / 100}' }, 'config.fields.total', "source: 'round(price * 100) / 100.0'"],
  ];

  it.each(TEMPLATED)('%s: registerFlow refuses it, located, with the CEL spelling', (_what, fields, at, spelling) => {
    const automation = new AutomationEngine(makeLogger());
    registerCrudNodes(automation, { logger: makeLogger(), getService: () => undefined } as any);
    let thrown: Error | undefined;
    try {
      automation.registerFlow('price_quote', writeFlow(nodeType, fields));
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown, 'a template in a value slot must not register').toBeDefined();
    expect(thrown!.message).toContain(`node 'w' (${nodeType}) ${nodeType} field value at ${at}`);
    expect(thrown!.message).toContain(VALUE_SLOT_TEMPLATE_REFUSAL);
    expect(thrown!.message).toContain(spelling);
  });

  it('the run-time twin: the executor refuses the same value at its own contract parse, and writes nothing', async () => {
    const { writes, executors } = await captureExecutors();
    const variables = new Map<string, unknown>(Object.entries(PARAMS));
    const config: Record<string, unknown> = { objectName: 'quote', fields: { subject: 'ok', total: '{price}' } };
    if (nodeType === 'update_record') config.filter = { id: 'q1' };
    const result = await executors.get(nodeType)!.execute({ id: 'w', type: nodeType, config } as any, variables, { userId: 'u1' } as any);
    expect(result.success).toBe(false);
    expect((result as { errorClass?: string }).errorClass).toBe('guard');
    expect(String((result as { error?: string }).error)).toContain('config.fields.total');
    expect(String((result as { error?: string }).error)).toContain(VALUE_SLOT_TEMPLATE_REFUSAL);
    expect(writes).toEqual([]);
  });

  it('the CEL spelling the refusal names writes the value the template wrote', async () => {
    const before = interpolate({ total: '{price}', subject: 'Quote for {name}' }, new Map(Object.entries(PARAMS)), {} as any);
    const { automation, writes } = await makeStack();
    automation.registerFlow('price_quote', writeFlow(nodeType, {
      total: { dialect: 'cel', source: 'price' },
      subject: { dialect: 'cel', source: "'Quote for ' + name" },
    }));
    const res = await run(automation);
    expect(res.success, res.error).toBe(true);
    expect(writes[0]!.data.total).toBe(before.total);
    expect(writes[0]!.data.subject).toBe(before.subject);
  });

  // #19939 pass 2 — `{$User.Id}` is refused; `current_user.id` writes the
  // run user, the value the template wrote, and the guard writes `null` in a
  // run with no user, where the template wrote nothing (the key absent).
  it('`{$User.Id}` is refused; `current_user.id` writes the run user the template wrote, and the guard writes `null` without one', async () => {
    const automation = new AutomationEngine(makeLogger());
    registerCrudNodes(automation, { logger: makeLogger(), getService: () => undefined } as any);
    expect(() => automation.registerFlow('price_quote', writeFlow(nodeType, { subject: '{$User.Id}' })))
      .toThrow("{ dialect: 'cel', source: 'current_user.id' }");

    const before = interpolate({ subject: '{$User.Id}' }, new Map(), { userId: 'u1' } as any);
    const withUser = await makeStack();
    withUser.automation.registerFlow('price_quote', writeFlow(nodeType, { subject: { dialect: 'cel', source: 'current_user.id' } }));
    const res = await run(withUser.automation);
    expect(res.success, res.error).toBe(true);
    expect(writes0(withUser.writes).subject).toBe(before.subject);
    expect(before.subject).toBe('u1');

    // A user-less run writes data only under an explicit `runAs: 'system'` (ADR-0049).
    const userless = await makeStack();
    userless.automation.registerFlow('price_quote', {
      ...writeFlow(nodeType, { subject: { dialect: 'cel', source: 'current_user != null ? current_user.id : null' } }),
      runAs: 'system',
    });
    const res2 = await userless.automation.execute('price_quote', { params: PARAMS } as any);
    expect(res2.success, res2.error).toBe(true);
    expect(interpolate({ subject: '{$User.Id}' }, new Map(), {} as any).subject).toBeUndefined();
    // The guarded form sends `null` — on `update_record` that clears the stored value.
    expect(writes0(userless.writes)).toHaveProperty('subject', null);
  });

  // #19939 pass 3 (carry from pass 2): a string NESTED in an object literal sits
  // where an envelope is data, so the refusal names the whole value built as a
  // CEL map literal — and that spelling, put back in the slot, writes what the
  // template wrote. The envelope at the nested position itself is stored as
  // the object it spells (the reason the remedy names none there).
  it('a string nested in an object literal: the whole-value CEL literal the refusal names writes what the template wrote', async () => {
    const fields = { payload: { note: 'for {name}' } };
    const [refusal] = valueSlotTemplateRefusals(fields.payload);
    const literal = /for this string alone, \{ dialect: 'cel', source: (?:'([^']*)'|("(?:[^"\\]|\\.)*")) \}/.exec(refusal!.message);
    expect(literal, refusal!.message).not.toBeNull();
    const source = literal![1] ?? (JSON.parse(literal![2]!) as string);
    expect(source).toBe("{'note': 'for ' + name}");
    expect(refusal!.message).not.toContain(`{ dialect: 'cel', source: "'for ' + name" }`);

    const before = interpolate(fields, new Map(Object.entries(PARAMS)), {} as any);
    const remedied = await makeStack();
    remedied.automation.registerFlow('price_quote', writeFlow(nodeType, { payload: { dialect: 'cel', source } }));
    const res = await run(remedied.automation);
    expect(res.success, res.error).toBe(true);
    expect(writes0(remedied.writes).payload).toEqual(before.payload);
    expect(before.payload).toEqual({ note: 'for ada' });

    // Why the remedy names no envelope at the nested position: one there is data.
    const nestedEnvelope = await makeStack();
    nestedEnvelope.automation.registerFlow('price_quote', writeFlow(nodeType, {
      payload: { note: { dialect: 'cel', source: "'for ' + name" } },
    }));
    const res2 = await run(nestedEnvelope.automation);
    expect(res2.success, res2.error).toBe(true);
    expect(writes0(nestedEnvelope.writes).payload).toEqual({ note: { dialect: 'cel', source: "'for ' + name" } });
  });
});

/** The first row that reached the store. */
function writes0(writes: Array<{ data: Record<string, unknown> }>): Record<string, unknown> {
  expect(writes.length).toBeGreaterThan(0);
  return writes[0]!.data;
}

describe.each(NODE_TYPES)('%s `fields.*` — a malformed envelope is refused at registration, and by the evaluator', (nodeType) => {
  it.each(MALFORMED)('$label: registerFlow refuses it, located at the field and led by the slot-neutral sentence', ({ envelope }) => {
    const { automation } = { automation: new AutomationEngine(makeLogger()) };
    registerCrudNodes(automation, { logger: makeLogger(), getService: () => undefined } as any);
    let thrown: Error | undefined;
    try {
      automation.registerFlow('price_quote', writeFlow(nodeType, { subject: 'name', total: envelope }));
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown, 'a malformed envelope must not register').toBeDefined();
    // `registerFlow` answers every expression refusal with one aggregated
    // message (no ADR-0112 code/status on this door) — so the pin is the
    // message's substance: which node, which slot, which rule.
    expect(thrown!.message).toContain(`node 'w' (${nodeType}) ${nodeType} field value at config.fields.total`);
    expect(thrown!.message).toContain(VALUE_ENVELOPE_REFUSAL);
    // Q2 (the seat's reading): a refused FIELD value is not told it is an assignment.
    expect(thrown!.message).not.toMatch(/assignment/i);
    // One notion of malformed: the evaluator refuses the same envelope.
    expect(() => automation.evaluateValueEnvelope(envelope, new Map(), 'fields.total')).toThrow(VALUE_ENVELOPE_REFUSAL);
  });

  it('a valid envelope beside every non-envelope shape registers', () => {
    const automation = new AutomationEngine(makeLogger());
    registerCrudNodes(automation, { logger: makeLogger(), getService: () => undefined } as any);
    expect(() => automation.registerFlow('price_quote', writeFlow(nodeType, {
      total: { dialect: 'cel', source: 'price * 2' },
      subject: 'name', due: '2026-10-17', n: 3, ok: true, nothing: null, payload: { dialect: 1 }, list: [{ dialect: 'cel' }],
    }))).not.toThrow();
  });
});

describe.each(NODE_TYPES)('%s `fields.*` — a value that cannot be computed fails the run loudly and writes nothing', (nodeType) => {
  it('an envelope that parses but faults on the live values', async () => {
    const { automation, writes } = await makeStack();
    automation.registerFlow('price_quote', writeFlow(nodeType, {
      subject: { dialect: 'cel', source: 'missing_var.subject' },
    }));
    const res = await run(automation);
    expect(res.success).toBe(false);
    expect(res.error).toContain('fields.subject');
    expect(res.error).toContain('missing_var.subject');
    expect(writes, 'ADR-0032 §1c: no silent default is written in its place').toEqual([]);
  });
});

/**
 * [#19939 pass 3] **The live cross-dialect parity pin.** The date macros are
 * refused in a value slot with their CEL string form (`isoDate` / `isoDatetime`
 * in `@objectstack/formula`'s stdlib, UTC). `stdlib-timestamp-text.test.ts`
 * there measures the CEL half against hand-written bytes; THIS pin is the one
 * that runs both dialects live, in one test, over the same instants: the 17.x
 * interpolator (`interpolateString`, the template's own resolver) and the
 * envelope the spec's refusal names, evaluated by the engine and written
 * through a real ObjectQL engine to the store. `Date` is frozen per instant,
 * so both read the same `now`.
 *
 * The instants are the cells where a calendar mistake shows: a spring-forward
 * and a fall-back DST transition day, the last millisecond of a month, a year
 * end and a leap day.
 */
describe('the date macros — the envelope each refusal names writes the bytes the template wrote, over the same instants', () => {
  afterEach(() => { vi.useRealTimers(); });

  const INSTANTS = [
    '2026-03-08T09:30:00.000Z',
    '2026-10-25T00:30:00.000Z',
    '2026-01-31T23:59:59.999Z',
    '2026-12-31T12:00:00.000Z',
    '2028-02-29T00:00:00.000Z',
  ];
  const VARS = { name: 'ada', days: 5 };
  const CONTEXT = { userId: 'u1', params: VARS } as any;

  /** A `create_record` writing `subject`, with `name` and `days` as inputs. */
  function macroFlow(subject: unknown) {
    return {
      name: 'macro_parity', label: 'Macro parity', type: 'autolaunched',
      variables: [
        { name: 'name', type: 'text', isInput: true },
        { name: 'days', type: 'number', isInput: true },
      ],
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'w', type: 'create_record', label: 'Write', config: { objectName: 'quote', fields: { subject } } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'w' }, { id: 'e2', source: 'w', target: 'end' }],
    } as any;
  }

  /** The envelope source the refusal of `authored` names — read off the refusal itself, never re-spelled. */
  function remedyOf(authored: string): string {
    const refusals = valueSlotTemplateRefusals(authored);
    expect(refusals, authored).toHaveLength(1);
    const found = /\{ dialect: 'cel', source: (?:'([^']*)'|("(?:[^"\\]|\\.)*")) \}/.exec(refusals[0]!.message.slice(VALUE_SLOT_TEMPLATE_REFUSAL.length));
    expect(found, refusals[0]!.message).not.toBeNull();
    return found![1] ?? (JSON.parse(found![2]!) as string);
  }

  /** What the store receives for `subject` at `instant` — the remedy through the engine. */
  async function written(subject: unknown, instant: string): Promise<unknown> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(instant));
    const { automation, writes } = await makeStack();
    automation.registerFlow('macro_parity', macroFlow(subject));
    const res = await automation.execute('macro_parity', CONTEXT);
    expect(res.success, res.error).toBe(true);
    return writes0(writes).subject;
  }

  /** What the 17.x interpolator wrote for `authored` at `instant`. */
  function templated(authored: string, instant: string): unknown {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(instant));
    return interpolateString(authored, new Map(Object.entries(VARS)), CONTEXT);
  }

  it.each([
    ['{TODAY()}', 'isoDate(today())'],
    ['{TODAY() + 7}', 'isoDate(daysFromNow(7))'],
    ['{TODAY() - 3}', 'isoDate(daysAgo(3))'],
    ['{NOW()}', 'isoDatetime(now())'],
    ['{NOW() + 2}', 'isoDatetime(addDays(now(), 2))'],
    ['{NOW() - 1}', 'isoDatetime(addDays(now(), -1))'],
    ['{TODAY() + days}', 'isoDate(addDays(today(), days))'],
    ['{TODAY() - days}', 'isoDate(addDays(today(), -days))'],
    ['{NOW() + days}', 'isoDatetime(addDays(now(), days))'],
    ['{TODAY() + 1.5}', 'isoDate(addDays(today(), 1.5))'],
    ['{TODAY() + 3d}', 'isoDate(today())'],
    ['Due {TODAY() + 7} for {name}', "'Due ' + isoDate(daysFromNow(7)) + ' for ' + name"],
    ['Due {TODAY()} by {$User.Id}', "'Due ' + isoDate(today()) + ' by ' + current_user.id"],
  ])('%s → %s', async (authored, source) => {
    expect(remedyOf(authored)).toBe(source);
    for (const instant of INSTANTS) {
      const template = templated(authored, instant);
      expect(typeof template, `${authored} @ ${instant}`).toBe('string');
      expect(await written({ dialect: 'cel', source }, instant), `${authored} @ ${instant}`).toBe(template);
    }
  });

  // The edges the refusal names, each pinned as it names it.
  it('a negative fraction: the template truncated the day sum, `addDays` truncates the offset — one day apart past the 1st', async () => {
    const authored = '{TODAY() - 1.5}';
    const source = remedyOf(authored);
    expect(source).toBe('isoDate(addDays(today(), -1.5))');
    // Past the day of the month the offset exceeds: the template moved 2 days back, `addDays` 1.
    expect(templated(authored, '2026-03-08T09:30:00.000Z')).toBe('2026-03-06');
    expect(await written({ dialect: 'cel', source }, '2026-03-08T09:30:00.000Z')).toBe('2026-03-07');
    // On the 1st the template's sum truncates to 0, the last day of the month before: the two agree.
    expect(templated(authored, '2026-03-01T09:30:00.000Z')).toBe('2026-02-28');
    expect(await written({ dialect: 'cel', source }, '2026-03-01T09:30:00.000Z')).toBe('2026-02-28');
  });

  it('`daysAgo(1.5)` is refused at build — `daysFromNow` / `daysAgo` take a whole number', () => {
    const automation = new AutomationEngine(makeLogger());
    registerCrudNodes(automation, { logger: makeLogger(), getService: () => undefined } as any);
    expect(() => automation.registerFlow('macro_parity', macroFlow({ dialect: 'cel', source: 'isoDate(daysAgo(1.5))' })))
      .toThrow(VALUE_ENVELOPE_REFUSAL);
  });

  it('an offset variable the template read as 0 — not a number, or absent — fails the run loudly under CEL, and writes nothing', async () => {
    const source = remedyOf('{TODAY() + days}');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-08T09:30:00.000Z'));
    for (const params of [{ name: 'ada', days: 'soon' }, { name: 'ada' }]) {
      // The template moved 0 days, silently.
      expect(interpolateString('{TODAY() + days}', new Map(Object.entries(params)), CONTEXT)).toBe('2026-03-08');
      const { automation, writes } = await makeStack();
      automation.registerFlow('macro_parity', macroFlow({ dialect: 'cel', source }));
      const res = await automation.execute('macro_parity', { userId: 'u1', params } as any);
      expect(res.success, JSON.stringify(params)).toBe(false);
      expect(res.error).toContain(source);
      expect(writes).toEqual([]);
    }
  });

  it('the date macros are refused at registration, located, naming the same form', () => {
    const automation = new AutomationEngine(makeLogger());
    registerCrudNodes(automation, { logger: makeLogger(), getService: () => undefined } as any);
    let thrown: Error | undefined;
    try {
      automation.registerFlow('macro_parity', macroFlow('{TODAY() + 7}'));
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toContain("node 'w' (create_record) create_record field value at config.fields.subject");
    expect(thrown?.message).toContain(VALUE_SLOT_TEMPLATE_REFUSAL);
    expect(thrown?.message).toContain("{ dialect: 'cel', source: 'isoDate(daysFromNow(7))' }");
  });
});
