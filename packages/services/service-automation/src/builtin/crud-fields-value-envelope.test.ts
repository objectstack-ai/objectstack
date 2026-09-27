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
 *  2. **Preserve** — every non-envelope value writes exactly what the old
 *     whole-map `interpolate()` wrote: ruling D, no spelling changes meaning.
 *  3. **Refuse at registration** — a malformed envelope stops the flow
 *     registering, located at `config.fields.<field>` and led by the
 *     slot-neutral sentence; the evaluator refuses the same set.
 *  4. **Fault loudly** — an envelope that parses but cannot evaluate on the
 *     live values fails the run with its source, and writes nothing.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { VALUE_ENVELOPE_REFUSAL } from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
import { registerCrudNodes } from './crud-nodes.js';
import { interpolate } from './template.js';

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

describe.each(NODE_TYPES)('%s `fields.*` — every non-envelope value writes exactly what it wrote before', (nodeType) => {
  it('templates, literals, arrays and nested envelope-shaped JSON: byte-identical to the whole-map `interpolate()`', async () => {
    const fields = {
      total: '{price}',                                   // sole token keeps its type
      subject: 'Quote for {name} at {price}',             // text with holes
      payload: {
        note: 'for {name}',                               // strings inside a literal still interpolate
        inner: { dialect: 'cel', source: 'price * 2' },   // NESTED envelope shape — data, not evaluated
        list: [{ dialect: 'cel', source: 'x' }, '{price}'],
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

describe.each(NODE_TYPES)('%s `fields.*` — a malformed envelope is refused at registration, and by the evaluator', (nodeType) => {
  it.each(MALFORMED)('$label: registerFlow refuses it, located at the field and led by the slot-neutral sentence', ({ envelope }) => {
    const { automation } = { automation: new AutomationEngine(makeLogger()) };
    registerCrudNodes(automation, { logger: makeLogger(), getService: () => undefined } as any);
    let thrown: Error | undefined;
    try {
      automation.registerFlow('price_quote', writeFlow(nodeType, { subject: '{name}', total: envelope }));
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
      subject: '{name}', n: 3, ok: true, nothing: null, payload: { dialect: 1 }, list: [{ dialect: 'cel' }],
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
