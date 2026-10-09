// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #22474 — a `validate()` preview binds the master-detail header the write
// binds: `parent` in both modes and, in `update` mode, `previousParent`.
//
// ## The defect
//
// The preview's one `evaluateValidationRules` call bound no `parent`, while
// every write call binds it. So a field rule reading the header —
// `requiredWhen: "parent.status == 'sent'"` — faulted in the preview
// (`Unknown variable: parent`) and refused the row as unevaluable, while the
// insert or update it predicts admitted it. The import dry run rides on the
// preview, so a detail import was refused for a rule fault that is not one.
//
// ## The fix
//
// The preview resolves the header the way the write resolves it: from the
// row's master-detail reference (payload first, then the stored row) and only
// when the object declares a parent-scoped `requiredWhen`, the write's own
// gate. For a repointing update it also binds the stored row's own header as
// `previousParent`, as the write does for the ADR-0113 pre-check.
//
// ⛔ Read under the caller's access. The write reads the header elevated; the
// preview asks the READ DOOR first, under the caller's own context. A header
// the caller cannot read gets the verdict a missing header gets, and a header
// column is kept only where the read door served the caller that very value,
// so a hidden or masked column is judged as empty.
//
// ## Pins
//
//  (a) insert and update: admitted under a draft header and refused under a
//      sent header, exactly as the write;
//  (b) a repoint reads the prior header for the pre-check, as the write does;
//  (c) control: an object with no parent-scoped rule reads no header;
//  (d) a caller who cannot read the header, or is served a header column
//      hidden or masked, gets a verdict identical whatever the stored header
//      holds; a caller who reads it in full gets the write's verdict;
//  (e) the real door: the import dry run, through the protocol, of a created
//      and of a matched row;
//  (f) parity: every input a write-side `evaluateValidationRules` call passes
//      is passed by the preview's call too (read from `engine.ts` itself).
//
// (a), (b) and (e) were red before the fix.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import { ObjectKernel, runImport, type ImportProtocolLike } from '@objectstack/core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';
import { ValidationError } from './validation/record-validator.js';

const HEADER = 'pv_invoice';
const LINE = 'pv_invoice_line';
const PLAIN_LINE = 'pv_plain_line';

const HEADER_OBJECT = {
  name: HEADER,
  label: 'Preview Invoice',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' },
    owner_name: { name: 'owner_name', label: 'Owner', type: 'text' },
    status: {
      name: 'status', label: 'Status', type: 'select',
      options: [{ label: 'Draft', value: 'draft' }, { label: 'Sent', value: 'sent' }],
    },
  },
};

const LINE_OBJECT = {
  name: LINE,
  label: 'Preview Invoice Line',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' },
    invoice: { name: 'invoice', label: 'Invoice', type: 'master_detail', reference: HEADER },
    // The card's subject: once the header is sent, every line carries a description.
    description: { name: 'description', label: 'Description', type: 'text', requiredWhen: "parent.status == 'sent'" },
    quantity: { name: 'quantity', label: 'Quantity', type: 'number' },
  },
};

/** The control: the same relation, and only a row-scoped requirement. */
const PLAIN_LINE_OBJECT = {
  name: PLAIN_LINE,
  label: 'Preview Plain Line',
  fields: {
    invoice: { name: 'invoice', label: 'Invoice', type: 'master_detail', reference: HEADER },
    description: { name: 'description', label: 'Description', type: 'text', requiredWhen: 'record.quantity > 100' },
    quantity: { name: 'quantity', label: 'Quantity', type: 'number' },
  },
};

/** A store-backed driver over several objects: what is stored is what a later read answers. */
function makeStoreDriver() {
  const stores = new Map<string, Map<string, Record<string, any>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k.startsWith('$')) throw new Error(`store driver: unsupported combinator ${k}`);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        return Object.entries(v).every(([op, target]) => {
          if (op === '$eq') return row?.[k] === target;
          if (op === '$in') return Array.isArray(target) && target.includes(row?.[k]);
          throw new Error(`store driver: unsupported operator ${op}`);
        });
      }
      return row?.[k] === v;
    });
  };
  let n = 0;
  const driver: any = {
    name: 'pv-parent-store', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async syncSchema() {},
    async find(o: string, ast: any) {
      const hits = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      return (typeof ast?.limit === 'number' ? hits.slice(0, ast.limit) : hits).map((r) => ({ ...r }));
    },
    async findOne(o: string, ast: any) {
      for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(o: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `rec_${n}`;
      const row = { ...data, id };
      storeFor(o).set(id, row);
      return { ...row };
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const row = { ...storeFor(o).get(id), ...data, id };
      storeFor(o).set(id, row);
      return { ...row };
    },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async count(o: string, ast: any) {
      return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)).length;
    },
  };
  return { driver, storeFor };
}

function makeEngine() {
  const store = makeStoreDriver();
  const engine = new ObjectQL();
  engine.registerDriver(store.driver, true);
  engine.registerApp({ id: 'pv', name: 'Preview Parent', objects: [HEADER_OBJECT, LINE_OBJECT, PLAIN_LINE_OBJECT] } as any);
  const headers = store.storeFor(HEADER);
  headers.set('h_draft', { id: 'h_draft', name: 'draft one', owner_name: 'alice', status: 'draft' });
  headers.set('h_sent', { id: 'h_sent', name: 'sent one', owner_name: 'alice', status: 'sent' });
  return { engine, ...store };
}

type Finding = { field: string; code: string };
type Verdict = { valid: boolean; errors: Finding[] };

/** The one row's preview verdict, reduced to what a caller branches on. */
async function preview(
  engine: ObjectQL,
  object: string,
  data: Record<string, unknown>,
  mode: 'insert' | 'update',
  context?: Record<string, unknown>,
): Promise<Verdict> {
  const out = await engine.validate(object, data, { mode, ...(context ? { context: context as any } : {}) });
  expect(out.results).toHaveLength(1);
  const row = out.results![0]!;
  return { valid: row.valid, errors: row.errors.map((e) => ({ field: e.field, code: e.code })) };
}

/** The write's verdict in the same shape: admitted, or the findings it refused with. */
async function write(run: () => Promise<unknown>): Promise<Verdict> {
  try {
    await run();
    return { valid: true, errors: [] };
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    const err = e as ValidationError;
    expect(err.code).toBe('VALIDATION_FAILED');
    return { valid: false, errors: err.fields.map((f) => ({ field: f.field, code: f.code })) };
  }
}

const ADMITTED: Verdict = { valid: true, errors: [] };
const REQUIRED: Verdict = { valid: false, errors: [{ field: 'description', code: 'required' }] };

describe('#22474 — the preview binds the master-detail header the write binds', () => {
  let engine: ObjectQL;
  let storeFor: (o: string) => Map<string, Record<string, any>>;

  beforeEach(() => {
    ({ engine, storeFor } = makeEngine());
  });

  describe('(a) insert: admitted under a draft header, refused under a sent one, as the insert', () => {
    it.each([
      ['a draft header', 'h_draft', ADMITTED],
      ['a sent header', 'h_sent', REQUIRED],
    ])('%s', async (_label, invoice, expected) => {
      const row = { name: 'l', invoice, quantity: 1 };
      expect(await preview(engine, LINE, row, 'insert')).toEqual(expected);
      expect(await write(() => engine.insert(LINE, row))).toEqual(expected);
    });

    it('a supplied description is admitted under a sent header', async () => {
      const row = { name: 'l', invoice: 'h_sent', description: 'seat', quantity: 1 };
      expect(await preview(engine, LINE, row, 'insert')).toEqual(ADMITTED);
    });
  });

  describe('(a) update by id: the header is read off the stored row, as the by-id update reads it', () => {
    it.each([
      ['a draft header', 'h_draft', ADMITTED],
      ['a sent header', 'h_sent', REQUIRED],
    ])('clearing the description under %s', async (_label, invoice, expected) => {
      storeFor(LINE).set('l1', { id: 'l1', name: 'l', invoice, description: 'seat', quantity: 1 });
      const patch = { description: null, id: 'l1' };
      expect(await preview(engine, LINE, patch, 'update')).toEqual(expected);
      expect(await write(() => engine.update(LINE, patch))).toEqual(expected);
    });

    it('an unrelated edit under a draft header is admitted', async () => {
      storeFor(LINE).set('l1', { id: 'l1', name: 'l', invoice: 'h_draft', quantity: 1 });
      expect(await preview(engine, LINE, { quantity: 2, id: 'l1' }, 'update')).toEqual(ADMITTED);
    });
  });

  describe('(b) a rule reading the prior header behaves the same in update mode', () => {
    it('a repoint from a draft onto a sent header is refused: the stored row complied', async () => {
      storeFor(LINE).set('l2', { id: 'l2', name: 'l', invoice: 'h_draft', quantity: 1 });
      const patch = { invoice: 'h_sent', id: 'l2' };
      // Judged against the header it lands on, and pre-checked against the one it leaves.
      expect(await write(() => engine.update(LINE, patch))).toEqual(REQUIRED);
      expect(await preview(engine, LINE, patch, 'update')).toEqual(REQUIRED);
    });

    it('a legacy row under a sent header rests through a repoint onto another sent header', async () => {
      storeFor(HEADER).set('h_sent2', { id: 'h_sent2', name: 'sent two', owner_name: 'alice', status: 'sent' });
      storeFor(LINE).set('l3', { id: 'l3', name: 'l', invoice: 'h_sent', quantity: 1 });
      const patch = { invoice: 'h_sent2', id: 'l3' };
      expect(await write(() => engine.update(LINE, patch))).toEqual(ADMITTED);
      expect(await preview(engine, LINE, patch, 'update')).toEqual(ADMITTED);
    });
  });

  describe('(c) control: an object with no parent-scoped rule reads no header', () => {
    /** Counts every read of the header object, through the read door, under any context. */
    function countHeaderReads(ql: ObjectQL) {
      const count = { reads: 0 };
      ql.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
        if (ctx.object === HEADER && ['find', 'findOne'].includes(ctx.operation)) count.reads += 1;
        await next();
      });
      return count;
    }

    it('insert and update previews of a plain line issue no read of the header object', async () => {
      storeFor(PLAIN_LINE).set('p1', { id: 'p1', invoice: 'h_sent', quantity: 1 });
      const count = countHeaderReads(engine);
      expect(await preview(engine, PLAIN_LINE, { invoice: 'h_sent', quantity: 1 }, 'insert')).toEqual(ADMITTED);
      expect(await preview(engine, PLAIN_LINE, { quantity: 2, id: 'p1' }, 'update')).toEqual(ADMITTED);
      expect(count.reads).toBe(0);
    });

    it('positive control: the parent-scoped line does read it', async () => {
      const count = countHeaderReads(engine);
      await preview(engine, LINE, { invoice: 'h_draft', quantity: 1 }, 'insert');
      expect(count.reads).toBeGreaterThan(0);
    });
  });

  describe('(d) the header is read under the caller\'s access', () => {
    /** Read scoping shaped like the security/sharing middlewares: a caller reads only its own headers. */
    function scopeHeaderReadsToOwner(ql: ObjectQL) {
      ql.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
        const userId = ctx.context?.userId;
        if (ctx.object === HEADER && userId && !ctx.context?.isSystem && ['find', 'findOne'].includes(ctx.operation)) {
          const scoped = { owner_name: userId };
          const ast: any = ctx.ast ?? { object: ctx.object };
          ast.where = ast.where ? { $and: [ast.where, scoped] } : scoped;
          ctx.ast = ast;
        }
        await next();
      });
    }

    /**
     * A field-level read rule on the header's `status`, shaped like the
     * security middleware's result mask: `hide` deletes the key, `mask` keeps
     * it and replaces the value (`field-masker.ts` `maskRecord`). A system
     * read is not masked, as the security middleware does not mask one.
     */
    function restrictStatusFor(ql: ObjectQL, userId: string, how: 'hide' | 'mask') {
      ql.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
        await next();
        if (ctx.object !== HEADER || ctx.context?.isSystem || ctx.context?.userId !== userId) return;
        if (!['find', 'findOne'].includes(ctx.operation)) return;
        const apply = (r: any) => {
          if (!r || typeof r !== 'object') return;
          if (how === 'hide') delete r.status;
          else if (typeof r.status === 'string') r.status = '*'.repeat(r.status.length);
        };
        if (Array.isArray(ctx.result)) ctx.result.forEach(apply);
        else apply(ctx.result);
      });
    }

    const setHeaderStatus = (status: string) => {
      storeFor(HEADER).set('h_x', { id: 'h_x', name: 'x', owner_name: 'alice', status });
    };

    it('a caller who cannot read the header gets the verdict a missing header gets, whatever it holds', async () => {
      scopeHeaderReadsToOwner(engine);
      const bob = { userId: 'bob' };
      // An update over a stored line naming a header id no row has: the header is missing.
      storeFor(LINE).set('l_gone', { id: 'l_gone', name: 'l', invoice: 'nowhere', description: 'seat', quantity: 1 });
      const missing = await preview(engine, LINE, { description: null, id: 'l_gone' }, 'update', bob);
      expect(missing.valid).toBe(false);
      for (const status of ['draft', 'sent']) {
        setHeaderStatus(status);
        storeFor(LINE).set('l_x', { id: 'l_x', name: 'l', invoice: 'h_x', description: 'seat', quantity: 1 });
        expect(await preview(engine, LINE, { description: null, id: 'l_x' }, 'update', bob)).toEqual(missing);
        // Insert mode answers one verdict too.
        expect(await preview(engine, LINE, { name: 'l', invoice: 'h_x', quantity: 1 }, 'insert', bob))
          .toEqual(await preview(engine, LINE, { name: 'l', invoice: 'nowhere', quantity: 1 }, 'insert', bob));
      }
    });

    it.each(['hide', 'mask'] as const)('a header column served %s is judged as empty, whatever it holds', async (how) => {
      restrictStatusFor(engine, 'erin', how);
      const erin = { userId: 'erin' };
      const verdicts: Verdict[] = [];
      for (const status of ['draft', 'sent']) {
        setHeaderStatus(status);
        // Precondition: the read door serves the header to erin, with `status` restricted.
        const served = await engine.findOne(HEADER, { where: { id: 'h_x' }, context: erin } as any);
        expect(served).toMatchObject({ id: 'h_x' });
        expect(served?.status === status).toBe(false);
        verdicts.push(await preview(engine, LINE, { name: 'l', invoice: 'h_x', quantity: 1 }, 'insert', erin));
        storeFor(LINE).set('l_x', { id: 'l_x', name: 'l', invoice: 'h_x', description: 'seat', quantity: 1 });
        verdicts.push(await preview(engine, LINE, { description: null, id: 'l_x' }, 'update', erin));
      }
      // Identical per mode whatever the header holds: [insert, update] for draft equals it for sent.
      expect(verdicts.slice(2)).toEqual(verdicts.slice(0, 2));
      // Judged as empty: `null == 'sent'` is a clean false, so nothing is required.
      expect(verdicts.slice(0, 2)).toEqual([ADMITTED, ADMITTED]);
    });

    it('control: a caller who reads the header in full gets the write\'s verdict', async () => {
      scopeHeaderReadsToOwner(engine);
      restrictStatusFor(engine, 'erin', 'mask');
      const alice = { userId: 'alice' };
      for (const [status, expected] of [['draft', ADMITTED], ['sent', REQUIRED]] as const) {
        setHeaderStatus(status);
        const row = { name: 'l', invoice: 'h_x', quantity: 1 };
        expect(await preview(engine, LINE, row, 'insert', alice)).toEqual(expected);
        expect(await write(() => engine.insert(LINE, row, { context: alice } as any))).toEqual(expected);
        storeFor(LINE).set('l_x', { id: 'l_x', name: 'l', invoice: 'h_x', description: 'seat', quantity: 1 });
        const patch = { description: null, id: 'l_x' };
        expect(await preview(engine, LINE, patch, 'update', alice)).toEqual(expected);
        expect(await write(() => engine.update(LINE, patch, { context: alice } as any))).toEqual(expected);
      }
    });
  });
});

describe('#22474 (e) — the import dry run of a detail row, through the protocol', () => {
  let kernel: ObjectKernel;
  let objectql: ObjectQL;
  let store: ReturnType<typeof makeStoreDriver>;

  beforeEach(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    store = makeStoreDriver();
    await kernel.use({
      name: 'pv-parent-store-plugin', type: 'driver', version: '1.0.0',
      init: async (ctx: any) => { ctx.registerService('driver.pv-parent-store', store.driver); },
    } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    objectql = kernel.getService<ObjectQL>('objectql');
    for (const obj of [HEADER_OBJECT, LINE_OBJECT]) {
      objectql.registry.registerObject({ ...obj, datasource: 'pv-parent-store' } as any, 'test', 'test');
    }
    store.storeFor(HEADER).set('h_draft', { id: 'h_draft', name: 'draft one', status: 'draft' });
    store.storeFor(HEADER).set('h_sent', { id: 'h_sent', name: 'sent one', status: 'sent' });
  });

  afterEach(async () => {
    if (kernel.getState() === 'running') await kernel.shutdown();
  });

  // The FK cell carries the header id itself: no `reference` in the column
  // meta, so the importer hands it to the engine as written.
  const metaMap = new Map<string, any>([
    ['name', { name: 'name', type: 'text' }],
    ['invoice', { name: 'invoice', type: 'master_detail' }],
    ['description', { name: 'description', type: 'text' }],
    ['quantity', { name: 'quantity', type: 'number' }],
  ]);

  const importLines = (rowsIn: Record<string, unknown>[], writeMode: 'insert' | 'update', dryRun: boolean) => runImport({
    p: new ObjectStackProtocolImplementation(objectql as never) as unknown as ImportProtocolLike,
    objectName: LINE,
    metaMap,
    writeMode,
    ...(writeMode === 'update' ? { matchFields: ['name'] } : {}),
    dryRun,
    runAutomations: false,
    trimWhitespace: true,
    createMissingOptions: false,
    skipBlankMatchKey: false,
    context: { userId: 'usr_importer' },
    rows: rowsIn,
  } as any);

  const outcome = (s: Awaited<ReturnType<typeof importLines>>) =>
    s.results.map((r) => ({ ok: r.ok, action: r.action, ...(r.ok ? {} : { field: r.field, code: r.code }) }));

  it.each([
    ['a draft header', 'h_draft', [{ ok: true, action: 'created' }]],
    ['a sent header', 'h_sent', [{ ok: false, action: 'failed', field: 'description', code: 'required' }]],
  ])('a created line under %s — the dry run answers what the import does', async (_label, invoice, expected) => {
    const cells = { name: 'new line', invoice, quantity: '1' };
    const dry = await importLines([cells], 'insert', true);
    expect(outcome(dry)).toEqual(expected);
    expect(store.storeFor(LINE).size).toBe(0);
    const real = await importLines([cells], 'insert', false);
    expect(outcome(real)).toEqual(outcome(dry));
  });

  // A matched line with no description, under a draft header: an edit keeps it
  // there, and a repoint moves it onto a sent header, which the stored row's
  // own header (`previousParent`) shows it did not violate before.
  it.each([
    ['an edit under its draft header', { name: 'line', quantity: '2' }, [{ ok: true, action: 'updated' }]],
    ['a repoint onto a sent header', { name: 'line', invoice: 'h_sent' },
      [{ ok: false, action: 'failed', field: 'description', code: 'required' }]],
  ])('a matched line, %s — the dry run answers what the import does', async (_label, cells, expected) => {
    store.storeFor(LINE).set('rec_l', { id: 'rec_l', name: 'line', invoice: 'h_draft', quantity: 1 });
    const dry = await importLines([cells], 'update', true);
    expect(outcome(dry)).toEqual(expected);
    expect(store.storeFor(LINE).get('rec_l')).toEqual({ id: 'rec_l', name: 'line', invoice: 'h_draft', quantity: 1 });
    const real = await importLines([cells], 'update', false);
    expect(outcome(real)).toEqual(outcome(dry));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (f) PARITY — every input a write binds, the preview binds.
//
// Read from `engine.ts` itself, so a NEW input added to a write-side
// `evaluateValidationRules` call and not to the preview's fails here. Each call
// site is found by its callee name in the TypeScript AST and attributed to its
// enclosing class method: the one in `validate` is the preview, every other is
// a write. A call's inputs are the keys of its options object literal,
// including the keys of an object literal spread into it (`...(c ? { k } : {})`).
// An options argument this reader cannot see into is a failure, never a pass.
// ─────────────────────────────────────────────────────────────────────────────

type RuleCall = { method: string; mode: string; keys: string[]; line: number };

function ruleCallsIn(source: string): RuleCall[] {
  const sf = ts.createSourceFile('engine.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: RuleCall[] = [];
  const keysOf = (expr: ts.Expression, line: number): string[] => {
    if (ts.isParenthesizedExpression(expr)) return keysOf(expr.expression, line);
    if (ts.isConditionalExpression(expr)) return [...keysOf(expr.whenTrue, line), ...keysOf(expr.whenFalse, line)];
    if (!ts.isObjectLiteralExpression(expr)) {
      throw new Error(`engine.ts:${line}: an evaluateValidationRules options value this test cannot read: ${expr.getText(sf)}`);
    }
    const keys: string[] = [];
    for (const p of expr.properties) {
      if (ts.isSpreadAssignment(p)) keys.push(...keysOf(p.expression, line));
      else if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name)) keys.push(p.name.text);
      else throw new Error(`engine.ts:${line}: an options member this test cannot read: ${p.getText(sf)}`);
    }
    return keys;
  };
  const visit = (node: ts.Node, method: string | undefined): void => {
    const here = ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) ? node.name.text : method;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'evaluateValidationRules') {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const [, , modeArg, optsArg] = node.arguments;
      if (!here || !modeArg || !optsArg) throw new Error(`engine.ts:${line}: a call this test cannot attribute`);
      const mode = ts.isStringLiteral(modeArg) ? modeArg.text : modeArg.getText(sf);
      calls.push({ method: here, mode, keys: [...new Set(keysOf(optsArg, line))].sort(), line });
    }
    ts.forEachChild(node, (child) => visit(child, here));
  };
  visit(sf, undefined);
  return calls;
}

describe('#22474 (f) — parity: the preview passes every input a write passes', () => {
  const calls = ruleCallsIn(readFileSync(new URL('./engine.ts', import.meta.url), 'utf8'));
  const previews = calls.filter((c) => c.method === 'validate');
  const writes = calls.filter((c) => c.method !== 'validate');

  it('finds the one preview call and the write calls of both modes', () => {
    expect(previews).toHaveLength(1);
    // The preview evaluates the caller's mode; the writes name theirs.
    expect(previews[0]!.mode).toBe('mode');
    expect(writes.length).toBeGreaterThanOrEqual(4);
    expect(new Set(writes.map((w) => w.mode))).toEqual(new Set(['insert', 'update']));
  });

  it('every key a write call passes, the preview passes', () => {
    const previewKeys = new Set(previews[0]!.keys);
    const missing = writes.flatMap((w) => w.keys
      .filter((k) => !previewKeys.has(k))
      .map((k) => `${k} (passed by ${w.method}'s ${w.mode} call at engine.ts:${w.line})`));
    expect(missing).toEqual([]);
  });

  it('the preview passes no input that no write passes', () => {
    const writeKeys = new Set(writes.flatMap((w) => w.keys));
    expect(previews[0]!.keys.filter((k) => !writeKeys.has(k))).toEqual([]);
  });
});
