// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24197] `ctx.title()` answers a title formula that reads ONE hop through a
// reference — the composed title of a junction object,
// `record.book.title + ' · ' + record.reader.name` — the way a read of the
// same record answers it the same caller.
//
// Before this, both forms of the accessor evaluated a formula title with the
// synchronous `evaluateFormulaField`, which preloads no hop, so a title over
// lookups answered `undefined` inside a hook body while every read of the same
// record showed it. Everything here runs a REAL {@link ObjectQL} engine on the
// REAL `SqlDriver` (better-sqlite3, on disk — one pooled connection, the
// `objectstack dev` default) through the REAL {@link QuickJSScriptRunner}, so
// what is measured is what a body sees in the VM, on the connection it reads on.
//
// What only a call site can show, and is pinned here:
//
//  - THIS record's title follows the IN-FLIGHT foreign key: a `beforeInsert`
//    names the payload's book, a `beforeUpdate` that moves `book` names the new
//    book, an `afterUpdate` names the row's state after the write;
//  - the hop costs one batched read per reference field the title reads
//    through, and a title over the row's own columns still costs none;
//  - the hop rides the transaction a body opened (`ctx.api.transaction`), on
//    the one SQLite connection, instead of asking the pool for a second;
//  - the hop is read as the CALLER: a related record the caller's read does not
//    return leaves the title absent, as the read of the junction row shows it —
//    never a partial string, never the hidden name;
//  - one hop is the depth: a title reaching a second hop is absent here as it
//    is `null` on the read;
//  - `ctx.title('book')` answers the related record's own one-hop title, read
//    off the row its `findOne` served.
//
// ## ⚠️ REBUILD IS LOAD-BEARING FOR THIS FILE
//
// `@objectstack/objectql` is not aliased to source for this package
// (`KNOWN_UNALIASED_TEST_IMPORTS`, `scripts/check-test-source-alias.mjs`), so
// the engine below AND the record-title imports inside `body-runner.ts` resolve
// to `objectql/dist`. Run `pnpm --filter @objectstack/objectql build` first.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { hookBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';

const TITLE = "record.book.title + ' · ' + record.reader.name";

const SHELF = { name: 'lib_shelf', nameField: 'code', fields: { code: { type: 'text' } } };
/** The book's OWN title reads one hop of its own (the shelf). */
const BOOK = {
  name: 'lib_book',
  nameField: 'label',
  fields: {
    title: { type: 'text' },
    shelf: { type: 'lookup', reference: 'lib_shelf' },
    label: { type: 'formula', expression: "record.title + ' @ ' + record.shelf.code" },
  },
};
const READER = {
  name: 'lib_reader',
  nameField: 'name',
  fields: { name: { type: 'text' }, visible: { type: 'boolean' } },
};
/** The junction object: its title is composed from both lookups. */
const LOAN = {
  name: 'lib_loan',
  nameField: 'title',
  fields: {
    book: { type: 'lookup', reference: 'lib_book' },
    reader: { type: 'lookup', reference: 'lib_reader' },
    note: { type: 'text' },
    title: { type: 'formula', expression: TITLE },
  },
};
/** A title over the row's OWN columns — the control that reads nothing. */
const STAMP = {
  name: 'lib_stamp',
  nameField: 'label',
  fields: {
    code: { type: 'text' },
    note: { type: 'text' },
    label: { type: 'formula', expression: "'#' + record.code" },
  },
};
/** A title reading the book's own one-hop title: a SECOND hop from here. */
const COPY = {
  name: 'lib_copy',
  nameField: 'label',
  fields: {
    book: { type: 'lookup', reference: 'lib_book' },
    note: { type: 'text' },
    label: { type: 'formula', expression: 'record.book.label' },
  },
};
/** Where an after-hook body writes what it resolved. */
const LOG = { name: 'lib_log', fields: { event: { type: 'text' }, msg: { type: 'text' } } };

const OBJECTS = [SHELF, BOOK, READER, LOAN, STAMP, COPY, LOG];

/** A caller who is not SYSTEM; row-level security below scopes its reader reads. */
const LIMITED = { userId: 'u_limited', positions: ['member'] } as any;
const SYS = { isSystem: true } as any;

/** The body every hook below runs: it writes what `ctx.title()` answered. */
const WRITE_TITLE = "ctx.input.note = String(await ctx.title());";

describe('#24197 ctx.title() serves a title formula\'s one hop (real engine, real SQLite, real QuickJS)', () => {
  let engine: ObjectQL | null = null;
  let dir: string | null = null;
  /** Every driver read: the object and the transaction handle it ran on. */
  let reads: Array<{ object: string; trx: unknown; ast: any }> = [];
  let begins: unknown[] = [];

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  });

  async function boot(hooks: Array<Record<string, unknown>>): Promise<ObjectQL> {
    dir = mkdtempSync(join(tmpdir(), 'os-title-one-hop-'));
    const driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: join(dir, 'data.sqlite') },
      useNullAsDefault: true,
    });
    await driver.initObjects(OBJECTS as any);
    reads = [];
    begins = [];
    const d = driver as any;
    for (const verb of ['find', 'findOne'] as const) {
      const original = d[verb].bind(driver);
      d[verb] = (object: string, ast: any, options?: any) => {
        reads.push({ object, trx: options?.transaction, ast });
        return original(object, ast, options);
      };
    }
    const begin = d.beginTransaction.bind(driver);
    d.beginTransaction = async (...args: unknown[]) => {
      const trx = await begin(...args);
      begins.push(trx);
      return trx;
    };
    const e = new ObjectQL();
    e.registerDriver(driver, true);
    await e.init();
    for (const o of OBJECTS) e.registry.registerObject(o as any, 'test');
    // Row-level security on the reader object, the shape plugin-security
    // composes: a caller that is not SYSTEM reads only visible readers.
    e.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
      if (ctx.object === 'lib_reader' && ['find', 'findOne'].includes(ctx.operation) && !ctx.context?.isSystem) {
        const scoped = { visible: true };
        ctx.ast = { ...(ctx.ast ?? {}), where: ctx.ast?.where ? { $and: [ctx.ast.where, scoped] } : scoped };
      }
      await next();
    });
    e.setDefaultBodyRunner(hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: e, appId: 'lib' }));
    bindHooksToEngine(e, hooks as any, { packageId: 'lib' });

    await e.insert('lib_shelf', { id: 's1', code: 'A-1' }, { context: SYS });
    await e.insert('lib_book', { id: 'b1', title: 'Dune', shelf: 's1' }, { context: SYS });
    await e.insert('lib_book', { id: 'b2', title: 'Emma', shelf: 's1' }, { context: SYS });
    await e.insert('lib_reader', { id: 'r1', name: 'Ann', visible: true }, { context: SYS });
    await e.insert('lib_reader', { id: 'r_hidden', name: 'Hidden Person', visible: false }, { context: SYS });
    engine = e;
    return e;
  }

  const hook = (object: string, events: string[], source: string, capabilities: string[] = []) => ({
    name: `title_${object}_${events.join('_')}`,
    object,
    events,
    body: { language: 'js', source, capabilities },
  });

  /** The read of the same record by the same caller — the answer the accessor owes. */
  const readTitle = async (object: string, id: string, context: any) =>
    ((await engine!.findOne(object, { where: { id }, context })) as any)?.[object === 'lib_loan' ? 'title' : 'label'];

  it('beforeUpdate: the composed title over both lookups, equal to the read of the row', async () => {
    const e = await boot([hook('lib_loan', ['beforeUpdate'], WRITE_TITLE)]);
    await e.insert('lib_loan', { id: 'l1', book: 'b1', reader: 'r1' }, { context: SYS });
    const updated: any = await e.update('lib_loan', { id: 'l1', note: 'x' }, { context: LIMITED });
    expect(updated.note).toBe('Dune · Ann');
    expect(await readTitle('lib_loan', 'l1', LIMITED)).toBe('Dune · Ann');
  }, 30000);

  it('H1 — beforeUpdate that MOVES the book names the new book, not the stored one', async () => {
    const e = await boot([hook('lib_loan', ['beforeUpdate'], WRITE_TITLE)]);
    await e.insert('lib_loan', { id: 'l1', book: 'b1', reader: 'r1' }, { context: SYS });
    const updated: any = await e.update('lib_loan', { id: 'l1', book: 'b2' }, { context: LIMITED });
    expect(updated.note).toBe('Emma · Ann');
    expect(updated.note).not.toContain('Dune');
  }, 30000);

  it('H1 — beforeInsert names the payload\'s book (there is no stored row)', async () => {
    const e = await boot([hook('lib_loan', ['beforeInsert'], WRITE_TITLE)]);
    const created: any = await e.insert('lib_loan', { id: 'l2', book: 'b2', reader: 'r1' }, { context: LIMITED });
    expect(created.note).toBe('Emma · Ann');
  }, 30000);

  it('H1 — afterUpdate names the row after the write', async () => {
    const e = await boot([hook(
      'lib_loan', ['afterUpdate'],
      "await ctx.api.object('lib_log').insert({ event: ctx.event, msg: String(await ctx.title()) });",
      ['api.write'],
    )]);
    await e.insert('lib_loan', { id: 'l1', book: 'b1', reader: 'r1' }, { context: SYS });
    await e.update('lib_loan', { id: 'l1', book: 'b2' }, { context: LIMITED });
    const log = await e.find('lib_log', { context: SYS }) as any[];
    expect(log.map((r) => r.msg)).toEqual(['Emma · Ann']);
  }, 30000);

  it('MEASUREMENT — the hop costs one batched read per reference field, on the related objects only', async () => {
    const e = await boot([hook('lib_loan', ['beforeUpdate'], WRITE_TITLE)]);
    await e.insert('lib_loan', { id: 'l1', book: 'b1', reader: 'r1' }, { context: SYS });
    reads.length = 0;
    await e.update('lib_loan', { id: 'l1', note: 'x' }, { context: LIMITED });
    const withTitle = reads.map((r) => r.object);
    const bookRead = reads.find((r) => r.object === 'lib_book');

    const e2 = await boot([hook('lib_loan', ['beforeUpdate'], "ctx.input.note = 'x';")]);
    await e2.insert('lib_loan', { id: 'l1', book: 'b1', reader: 'r1' }, { context: SYS });
    reads.length = 0;
    await e2.update('lib_loan', { id: 'l1', note: 'x' }, { context: LIMITED });
    const baseline = reads.map((r) => r.object);

    // Exactly two reads more than the same write with a body that never asks:
    // one of `lib_book`, one of `lib_reader` — never one per field named.
    expect(withTitle.length - baseline.length).toBe(2);
    expect(withTitle.filter((o) => o === 'lib_book').length - baseline.filter((o) => o === 'lib_book').length).toBe(1);
    expect(withTitle.filter((o) => o === 'lib_reader').length - baseline.filter((o) => o === 'lib_reader').length).toBe(1);
    // The book read is the one hop: by the in-flight id, projecting only `id`
    // and the column the formula names.
    expect(bookRead?.ast?.where).toEqual({ id: { $in: ['b1'] } });
    expect([...(bookRead?.ast?.fields ?? [])].sort()).toEqual(['id', 'title']);
  }, 30000);

  it('CONTROL — a title over the row\'s own columns still costs no read', async () => {
    const e = await boot([hook('lib_stamp', ['beforeUpdate'], WRITE_TITLE)]);
    await e.insert('lib_stamp', { id: 'st1', code: '42' }, { context: SYS });
    reads.length = 0;
    const updated: any = await e.update('lib_stamp', { id: 'st1', note: 'x' }, { context: LIMITED });
    const withTitle = reads.length;
    expect(updated.note).toBe('#42');

    const e2 = await boot([hook('lib_stamp', ['beforeUpdate'], "ctx.input.note = 'x';")]);
    await e2.insert('lib_stamp', { id: 'st1', code: '42' }, { context: SYS });
    reads.length = 0;
    await e2.update('lib_stamp', { id: 'st1', note: 'x' }, { context: LIMITED });
    expect(withTitle).toBe(reads.length);
  }, 30000);

  it('H2 — inside a transaction the BODY opened, the hop rides it on the one SQLite connection', async () => {
    // A before-hook with no after-hook bound: the write opens no unit of work
    // of its own, so `ctx.api.transaction` OPENS one, and SQLite's single
    // pooled connection is held by it until it commits. A hop read on any
    // other channel would wait for a second connection that never comes.
    const e = await boot([hook(
      'lib_loan', ['beforeUpdate'],
      `await ctx.api.transaction(async () => { ctx.input.note = String(await ctx.title()); });`,
      ['api.transaction'],
    )]);
    await e.insert('lib_loan', { id: 'l1', book: 'b1', reader: 'r1' }, { context: SYS });
    reads.length = 0;
    begins.length = 0;
    const updated: any = await e.update('lib_loan', { id: 'l1', note: 'x' }, { context: LIMITED });

    expect(updated.note).toBe('Dune · Ann');
    expect(begins).toHaveLength(1);
    // The title's two hop reads — one of each related object — and nothing
    // else ran on the body's transaction.
    expect(reads.filter((r) => r.trx === begins[0]).map((r) => r.object).sort()).toEqual(['lib_book', 'lib_reader']);
  }, 30000);

  it('H2 — in an after-hook the body JOINS the write\'s own unit of work, and the hop reads on it', async () => {
    const e = await boot([hook(
      'lib_loan', ['afterUpdate'],
      `await ctx.api.transaction(async () => {
         const t = await ctx.title();
         await ctx.api.object('lib_log').insert({ event: 'tx', msg: String(t) });
       });`,
      ['api.write', 'api.transaction'],
    )]);
    await e.insert('lib_loan', { id: 'l1', book: 'b1', reader: 'r1' }, { context: SYS });
    reads.length = 0;
    begins.length = 0;
    await e.update('lib_loan', { id: 'l1', note: 'x' }, { context: LIMITED });

    const log = await e.find('lib_log', { context: SYS }) as any[];
    expect(log.map((r) => r.msg)).toEqual(['Dune · Ann']);
    // ONE transaction for the whole write (the engine's, which the body joined),
    // and every read of it — the title's hops among them — ran on that handle.
    expect(begins).toHaveLength(1);
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads.filter((x) => x.object !== 'lib_log')) expect(r.trx).toBe(begins[0]);
  }, 30000);

  it('H4 — a related record the caller may not read: no title, as the read of the row shows none', async () => {
    const e = await boot([hook('lib_loan', ['beforeUpdate'], WRITE_TITLE)]);
    await e.insert('lib_loan', { id: 'l3', book: 'b1', reader: 'r_hidden' }, { context: SYS });
    const updated: any = await e.update('lib_loan', { id: 'l3', note: 'x' }, { context: LIMITED });
    // Absent (the VM hands `undefined` across as `null`) — never the readable
    // half passed off as whole, never the hidden name.
    expect(updated.note).toBe('null');
    expect(updated.note).not.toContain('Dune');
    expect(updated.note).not.toContain('Hidden');
    // The read of the same junction row by the same caller shows no title either.
    expect(await readTitle('lib_loan', 'l3', LIMITED)).toBeNull();
    // CONTROL — SYSTEM reads the reader, so both answer the whole title.
    const asSystem: any = await e.update('lib_loan', { id: 'l3', note: 'y' }, { context: SYS });
    expect(asSystem.note).toBe('Dune · Hidden Person');
    expect(await readTitle('lib_loan', 'l3', SYS)).toBe('Dune · Hidden Person');
  }, 30000);

  it('H5 — a title reaching a SECOND hop is absent, as the read answers it null', async () => {
    const e = await boot([hook('lib_copy', ['beforeUpdate'], WRITE_TITLE)]);
    await e.insert('lib_copy', { id: 'c1', book: 'b1' }, { context: SYS });
    reads.length = 0;
    const updated: any = await e.update('lib_copy', { id: 'c1', note: 'x' }, { context: SYS });
    expect(updated.note).toBe('null');
    expect(await readTitle('lib_copy', 'c1', SYS)).toBeNull();
    // The shelf — the second hop — is never read for the title.
    expect(reads.filter((r) => r.object === 'lib_shelf')).toEqual([]);
  }, 30000);

  it('H3 — ctx.title(\'book\') answers the related record\'s own one-hop title, as its read serves it', async () => {
    const e = await boot([hook(
      'lib_loan', ['beforeUpdate'], "ctx.input.note = String(await ctx.title('book'));", ['api.read'],
    )]);
    await e.insert('lib_loan', { id: 'l1', book: 'b1', reader: 'r1' }, { context: SYS });
    const updated: any = await e.update('lib_loan', { id: 'l1', note: 'x' }, { context: LIMITED });
    expect(updated.note).toBe('Dune @ A-1');
    expect(await readTitle('lib_book', 'b1', LIMITED)).toBe('Dune @ A-1');
  }, 30000);
});
