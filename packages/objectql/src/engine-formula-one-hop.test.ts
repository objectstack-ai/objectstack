// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24197] A formula field reads ONE hop through a reference field — driven
 * through the real engine and a driver that really projects, bounds and pages.
 *
 * Before this, `planFormulaProjection` gave a formula the row's own columns, so
 * `record.book.title` met the stored id and every row read `null`, while the
 * lint admitted the expression. The formula read path now preloads the hop the
 * way validation predicates do (one loader, `resolveOneHopRelated`), and these
 * pins hold what only a call site can show:
 *
 *  - the composed title of a junction object reads both names on every row of
 *    a page, with ONE related read per reference field per page — never one per
 *    row — and the row the read returns still holds the foreign KEY;
 *  - the hop is read as the CALLER: a related row the caller's read does not
 *    return, and a related column it masks, never reach the formula's value;
 *  - a related record that is not there reads `null` WITH a reason (the
 *    validation path's verdict), never a value computed in its place, while an
 *    EMPTY reference is the author's to give a value to;
 *  - one hop is the depth: a second hop is refused with the lint's words, a
 *    formula read through a hop serves no hop of its own, and two objects
 *    whose titles read each other terminate;
 *  - a write's response is the same materialization;
 *  - a formula title stays unsortable (the sort answer the ruling leaves to
 *    measurement: a formula value is stored nowhere a sort reads).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ObjectQL } from './engine.js';
import { resolveRecordTitle, resolveServedRecordTitle, servedRecordTitle } from './record-title.js';

type Rec = Record<string, unknown>;

/** A logger that records `warn` — the level the engine reports a formula fault at. */
function makeRecordingLogger() {
  const warns: Array<{ message: string; meta: Rec | undefined }> = [];
  const l: any = {
    trace() {}, debug() {}, info() {}, error() {}, fatal() {},
    warn(message: string, meta?: Rec) { warns.push({ message: String(message), meta }); },
    child() { return l; },
  };
  return { logger: l, warns };
}

function makeDriver() {
  const stores = new Map<string, Map<string, Rec>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const matches = (row: Rec, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('$in' in v) return Array.isArray(v.$in) && v.$in.includes(row?.[k]);
        if ('$eq' in v) return row?.[k] === v.$eq;
      }
      return row?.[k] === v;
    });
  };
  const project = (r: Rec, fields: string[] | undefined): Rec => {
    if (!fields) return { ...r };
    const out: Rec = {};
    for (const f of fields) if (r[f] !== undefined) out[f] = r[f];
    return out;
  };
  const calls: Array<{ object: string; ast: any; options?: any }> = [];
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any, options?: any) {
      calls.push({ object, ast, options });
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      // Hold the caller's page: `offset` then `limit`, as a real driver does.
      const offset = typeof ast?.offset === 'number' ? ast.offset : 0;
      const paged = typeof ast?.limit === 'number' ? rows.slice(offset, offset + ast.limit) : rows.slice(offset);
      return paged.map((r) => project(r, ast?.fields));
    },
    async findOne(object: string, ast: any) {
      calls.push({ object, ast });
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return project(r, ast?.fields);
      return null;
    },
    async create(object: string, data: Rec) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Rec) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return { ...row };
    },
    async updateMany() { return 0; },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Rec[]) { return Promise.all(rows.map((r) => this.create(object, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor, calls };
}

const TITLE = "record.book.title + ' · ' + record.reader.name";
const READER = { userId: 'u1', tenantId: 'org_1', positions: ['member'] } as any;

describe('#24197 — a formula field reads one hop through a reference', () => {
  let engine: ObjectQL;
  let d: ReturnType<typeof makeDriver>;
  let warns: ReturnType<typeof makeRecordingLogger>['warns'];

  const registerLoan = (expression: string, extra: Rec = {}) => engine.registry.registerObject({
    name: 'lib_loan',
    fields: {
      book: { type: 'lookup', reference: 'lib_book' },
      reader: { type: 'lookup', reference: 'lib_reader' },
      due: { type: 'date' },
      title: { type: 'formula', expression },
      ...extra,
    },
  } as any, 'test-package');
  const relatedReads = (object: string) => d.calls.filter((c) => c.object === object).length;
  const faultsOn = (object: string, field: string) =>
    warns.filter((w) => w.meta?.object === object && w.meta?.field === field);

  beforeEach(async () => {
    const rec = makeRecordingLogger();
    warns = rec.warns;
    engine = new ObjectQL({ logger: rec.logger });
    d = makeDriver();
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'lib_shelf', fields: { code: { type: 'text' } },
    } as any, 'test-package');
    engine.registry.registerObject({
      name: 'lib_book',
      fields: {
        title: { type: 'text' },
        shelf: { type: 'lookup', reference: 'lib_shelf' },
        // A formula over the book's OWN columns: computed on a hop read.
        shout: { type: 'formula', expression: 'record.title.upperAscii()' },
        // A formula that reads a hop of ITS own: a second hop from a loan.
        shelf_code: { type: 'formula', expression: 'record.shelf.code' },
      },
    } as any, 'test-package');
    engine.registry.registerObject({
      name: 'lib_reader',
      fields: { name: { type: 'text' }, visible: { type: 'boolean' } },
    } as any, 'test-package');
    registerLoan(TITLE);
    d.storeFor('lib_shelf').set('s1', { id: 's1', code: 'A-1' });
    for (const [id, title] of [['b1', 'Dune'], ['b2', 'Emma'], ['b3', 'Ulysses']]) {
      d.storeFor('lib_book').set(id, { id, title, shelf: 's1' });
    }
    d.storeFor('lib_reader').set('r1', { id: 'r1', name: 'Ann', visible: true });
    d.storeFor('lib_reader').set('r2', { id: 'r2', name: 'Bo', visible: true });
    d.storeFor('lib_reader').set('r_hidden', { id: 'r_hidden', name: 'Hidden Person', visible: false });
    const loans: Array<[string, string, string]> = [
      ['l1', 'b1', 'r1'], ['l2', 'b2', 'r1'], ['l3', 'b3', 'r2'], ['l4', 'b1', 'r2'], ['l5', 'b2', 'r2'],
    ];
    for (const [id, book, reader] of loans) d.storeFor('lib_loan').set(id, { id, book, reader });
  });

  it('reads both names over a page, one related read per reference field — never one per row', async () => {
    d.calls.length = 0;
    const rows = await engine.find('lib_loan', { limit: 4, context: READER });
    expect(rows.map((r) => r.title)).toEqual(['Dune · Ann', 'Emma · Ann', 'Ulysses · Bo', 'Dune · Bo']);
    // 4 rows, 3 distinct books and 2 distinct readers: ONE read each.
    expect(relatedReads('lib_book')).toBe(1);
    expect(relatedReads('lib_reader')).toBe(1);
    const bookRead = d.calls.find((c) => c.object === 'lib_book')!;
    expect([...bookRead.ast.where.id.$in].sort()).toEqual(['b1', 'b2', 'b3']);
    // Only the columns the formula names (plus `id`) are read.
    expect([...bookRead.ast.fields].sort()).toEqual(['id', 'title']);
    // The row the read returns still holds the foreign KEY, never the related row.
    expect(rows.map((r) => r.book)).toEqual(['b1', 'b2', 'b3', 'b1']);
    expect(faultsOn('lib_loan', 'title')).toEqual([]);
  });

  it('pages the hop: the next page reads only its own related ids', async () => {
    d.calls.length = 0;
    const rows = await engine.find('lib_loan', { limit: 2, offset: 3, context: READER });
    expect(rows.map((r) => r.title)).toEqual(['Dune · Bo', 'Emma · Bo']);
    const bookRead = d.calls.find((c) => c.object === 'lib_book')!;
    expect([...bookRead.ast.where.id.$in].sort()).toEqual(['b1', 'b2']);
  });

  it('reads the hop for a projection naming only the formula, and cuts the widening back off', async () => {
    const rows = await engine.find('lib_loan', { fields: ['title'], limit: 1, context: READER });
    expect(rows).toEqual([{ title: 'Dune · Ann' }]);
  });

  it('serves findOne', async () => {
    const row = await engine.findOne('lib_loan', { where: { id: 'l3' }, context: READER });
    expect(row?.title).toBe('Ulysses · Bo');
  });

  it("serves a write's response", async () => {
    const created = await engine.insert('lib_loan', { book: 'b3', reader: 'r1' }, { context: READER });
    expect((created as Rec).title).toBe('Ulysses · Ann');
    expect((created as Rec).book).toBe('b3');
  });

  describe('the hop is read as the caller', () => {
    beforeEach(() => {
      // Row-level security on the reader object: a caller that is not SYSTEM
      // sees only visible readers. The same composition plugin-security makes.
      engine.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
        if (ctx.object === 'lib_reader' && ['find', 'findOne'].includes(ctx.operation) && !ctx.context?.isSystem) {
          const scoped = { visible: true };
          ctx.ast = { ...(ctx.ast ?? {}), where: ctx.ast?.where ? { $and: [ctx.ast.where, scoped] } : scoped };
        }
        await next();
      });
      d.storeFor('lib_loan').set('l_hidden', { id: 'l_hidden', book: 'b1', reader: 'r_hidden' });
    });

    it('a related row the caller may not read is not read through, and the formula says so', async () => {
      // The caller's own read of that reader returns nothing…
      expect(await engine.find('lib_reader', { where: { id: 'r_hidden' }, context: READER })).toEqual([]);
      // …so the formula over it has no value, and no part of the hidden row leaks.
      const row = await engine.findOne('lib_loan', { where: { id: 'l_hidden' }, context: READER });
      expect(row?.title).toBeNull();
      expect(JSON.stringify(row)).not.toContain('Hidden Person');
      const fault = faultsOn('lib_loan', 'title');
      expect(fault).toHaveLength(1);
      expect(fault[0].message).toContain("`reader` (object 'lib_reader')");
      expect(fault[0].message).toContain('was not found by this read (it does not exist, or this reader may not read it)');
    });

    it('SYSTEM reads it, as SYSTEM reads the reader directly', async () => {
      const row = await engine.findOne('lib_loan', { where: { id: 'l_hidden' }, context: { isSystem: true } });
      expect(row?.title).toBe('Dune · Hidden Person');
    });

    it('a related column the caller may not read never reaches the value', async () => {
      // Field-level security: the reader's `name` is masked for a member.
      engine.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
        await next();
        if (ctx.object === 'lib_reader' && Array.isArray(ctx.result) && !ctx.context?.isSystem) {
          ctx.result = ctx.result.map((r: Rec) => { const { name: _masked, ...rest } = r; return rest; });
        }
      });
      const rows = await engine.find('lib_loan', { limit: 1, context: READER });
      expect(rows[0].title).toBeNull();
      expect(JSON.stringify(rows)).not.toContain('Ann');
    });
  });

  describe('a related record that is not there', () => {
    it('a dangling reference reads null WITH a reason — no value is computed in its place', async () => {
      registerLoan("record.book.title + ' · ' + record.reader.?name.orValue('—')");
      d.storeFor('lib_loan').set('l_gone', { id: 'l_gone', book: 'b_gone', reader: 'r1' });
      const row = await engine.findOne('lib_loan', { where: { id: 'l_gone' }, context: READER });
      expect(row?.title).toBeNull();
      expect(faultsOn('lib_loan', 'title')[0].message).toContain("`book` (object 'lib_book')");
    });

    it('an EMPTY reference is the author\'s to give a value to', async () => {
      registerLoan("record.book.title + ' · ' + record.reader.?name.orValue('—')");
      d.storeFor('lib_loan').set('l_open', { id: 'l_open', book: 'b2', reader: null });
      const row = await engine.findOne('lib_loan', { where: { id: 'l_open' }, context: READER });
      expect(row?.title).toBe('Emma · —');
      expect(faultsOn('lib_loan', 'title')).toEqual([]);
    });

    it('a plain read through an EMPTY reference faults and names the optional read', async () => {
      d.storeFor('lib_loan').set('l_open', { id: 'l_open', book: 'b2', reader: null });
      const row = await engine.findOne('lib_loan', { where: { id: 'l_open' }, context: READER });
      expect(row?.title).toBeNull();
      const fault = faultsOn('lib_loan', 'title');
      expect(fault).toHaveLength(1);
      expect(fault[0].message).toContain('`reader` holds no single reference on this record');
      expect(fault[0].message).toContain("`record.reader.?<related field>.orValue('…')`");
    });

    it('a related field the related object does not declare is named, on the right object', async () => {
      registerLoan('record.book.isbn');
      const row = await engine.findOne('lib_loan', { where: { id: 'l1' }, context: READER });
      expect(row?.title).toBeNull();
      expect(faultsOn('lib_loan', 'title')[0].message).toContain("'lib_book' declares no such field");
    });
  });

  describe('one hop is the depth', () => {
    it('a second hop written out is not evaluated, reads null, and says so in the lint\'s words — with no related read', async () => {
      registerLoan('record.book.shelf.code');
      d.calls.length = 0;
      const row = await engine.findOne('lib_loan', { where: { id: 'l1' }, context: READER });
      expect(row?.title).toBeNull();
      expect(relatedReads('lib_book')).toBe(0);
      expect(faultsOn('lib_loan', 'title')[0].message).toContain('A formula resolves ONE hop');
    });

    it("the related object's own-column formulas are computed on the hop read", async () => {
      registerLoan('record.book.shout');
      const row = await engine.findOne('lib_loan', { where: { id: 'l1' }, context: READER });
      expect(row?.title).toBe('DUNE');
    });

    it('a formula read through a hop serves no hop of its own (a second hop, reached through a formula)', async () => {
      // One hop from the book: served.
      const book = await engine.findOne('lib_book', { where: { id: 'b1' }, context: READER });
      expect(book?.shelf_code).toBe('A-1');
      // Two hops from the loan: not served — the book's formula reads null on the hop read and says why.
      registerLoan('record.book.shelf_code');
      const row = await engine.findOne('lib_loan', { where: { id: 'l1' }, context: READER });
      expect(row?.title).toBeNull();
      expect(faultsOn('lib_book', 'shelf_code')[0].message).toContain('a formula resolves ONE hop');
    });

    it('two objects whose titles read each other terminate', async () => {
      engine.registry.registerObject({
        name: 'lib_ping',
        fields: { pong: { type: 'lookup', reference: 'lib_pong' }, label: { type: 'formula', expression: 'record.pong.label' } },
      } as any, 'test-package');
      engine.registry.registerObject({
        name: 'lib_pong',
        fields: { ping: { type: 'lookup', reference: 'lib_ping' }, label: { type: 'formula', expression: 'record.ping.label' } },
      } as any, 'test-package');
      d.storeFor('lib_ping').set('p1', { id: 'p1', pong: 'q1' });
      d.storeFor('lib_pong').set('q1', { id: 'q1', ping: 'p1' });
      const rows = await engine.find('lib_ping', { context: READER });
      expect(rows).toHaveLength(1);
      expect(rows[0].label).toBeNull();
    });
  });

  it('a formula title over lookups stays unsortable: refused by name, never silently dropped', async () => {
    await expect(
      engine.find('lib_loan', { orderBy: [{ field: 'title', order: 'asc' }], context: READER }),
    ).rejects.toMatchObject({ code: 'INVALID_SORT', status: 400, field: 'title' });
  });

  // [#24197] The record a hook fires on was never read back, so nothing served
  // its title: `serveFormulaField` is the read path's evaluation over a record
  // in hand, reached through a channel (`ScopedContext`) that carries the
  // reader's own context. The hook body's `ctx.title()` is built on it.
  describe('serveFormulaField — a record in hand, served as a read serves it', () => {
    const LOAN_SCHEMA = { name: 'lib_loan', nameField: 'title' };

    it('reads the hop through the IN-HAND foreign keys, one batched read per reference field', async () => {
      d.calls.length = 0;
      // Stored l1 names b1; the in-flight state names b2.
      const value = await engine.createContext(READER).serveFormulaField('lib_loan', { id: 'l1', book: 'b2', reader: 'r1' }, 'title');
      expect(value).toBe('Emma · Ann');
      expect(relatedReads('lib_book')).toBe(1);
      expect(relatedReads('lib_reader')).toBe(1);
      expect(relatedReads('lib_loan')).toBe(0);
      expect(d.calls.find((c) => c.object === 'lib_book')!.ast.where).toEqual({ id: { $in: ['b2'] } });
    });

    it('answers the title a read of the same record answers, where the synchronous evaluator answers none', async () => {
      const read = await engine.findOne('lib_loan', { where: { id: 'l3' }, context: READER });
      const inHand = { id: 'l3', book: 'b3', reader: 'r2' };
      expect(await resolveServedRecordTitle(LOAN_SCHEMA, inHand, engine.createContext(READER))).toBe(read?.title);
      expect(read?.title).toBe('Ulysses · Bo');
      // The before-state of this seam: no hop, no title.
      expect(resolveRecordTitle({ ...LOAN_SCHEMA, fields: engine.getObject('lib_loan')!.fields }, inHand)).toBeUndefined();
    });

    it('a formula over the record\'s own columns reads nothing', async () => {
      d.calls.length = 0;
      expect(await engine.createContext(READER).serveFormulaField('lib_book', { id: 'b1', title: 'dune' }, 'shout')).toBe('DUNE');
      expect(d.calls).toEqual([]);
    });

    it('a field that is not a formula answers undefined, so the stored column is read instead', async () => {
      expect(await engine.createContext(READER).serveFormulaField('lib_loan', { id: 'l1', book: 'b1' }, 'book')).toBeUndefined();
    });

    it('reads the hop on the transaction the channel carries', async () => {
      const trx = { __trx: 'body' };
      d.calls.length = 0;
      await engine.createContext({ ...READER, transaction: trx }).serveFormulaField('lib_loan', { id: 'l1', book: 'b1', reader: 'r1' }, 'title');
      const hops = d.calls.filter((c) => c.object === 'lib_book' || c.object === 'lib_reader');
      expect(hops).toHaveLength(2);
      for (const c of hops) expect(c.options?.transaction).toBe(trx);
    });

    it('a related record the channel may not read leaves it null with the read\'s reason, and leaks nothing', async () => {
      engine.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
        if (ctx.object === 'lib_reader' && ['find', 'findOne'].includes(ctx.operation) && !ctx.context?.isSystem) {
          const scoped = { visible: true };
          ctx.ast = { ...(ctx.ast ?? {}), where: ctx.ast?.where ? { $and: [ctx.ast.where, scoped] } : scoped };
        }
        await next();
      });
      const inHand = { id: 'lx', book: 'b1', reader: 'r_hidden' };
      expect(await engine.createContext(READER).serveFormulaField('lib_loan', inHand, 'title')).toBeNull();
      expect(await resolveServedRecordTitle(LOAN_SCHEMA, inHand, engine.createContext(READER))).toBeUndefined();
      expect(faultsOn('lib_loan', 'title')[0].message).toContain('was not found by this read');
      // CONTROL — the SYSTEM channel reads the reader.
      expect(await engine.createContext({ isSystem: true }).serveFormulaField('lib_loan', inHand, 'title')).toBe('Dune · Hidden Person');
    });

    it('a second hop reached through the related object\'s formula is not served', async () => {
      registerLoan('record.book.shelf_code');
      d.calls.length = 0;
      expect(await engine.createContext(READER).serveFormulaField('lib_loan', { id: 'l1', book: 'b1' }, 'title')).toBeNull();
      expect(relatedReads('lib_shelf')).toBe(0);
    });

    it('servedRecordTitle reads the title a read served off the row, never re-derived', async () => {
      const book = { name: 'lib_book', nameField: 'shelf_code', fields: engine.getObject('lib_book')!.fields };
      // A row a read returned with its one-hop title served…
      expect(servedRecordTitle(book, { id: 'b1', title: 'Dune', shelf: 's1', shelf_code: 'A-1' })).toBe('A-1');
      // …which the synchronous re-derivation throws away.
      expect(resolveRecordTitle(book, { id: 'b1', title: 'Dune', shelf: 's1', shelf_code: 'A-1' })).toBeUndefined();
      // A row the read served no title on has none.
      expect(servedRecordTitle(book, { id: 'b1', title: 'Dune', shelf: 's1', shelf_code: null })).toBeUndefined();
    });
  });
});
