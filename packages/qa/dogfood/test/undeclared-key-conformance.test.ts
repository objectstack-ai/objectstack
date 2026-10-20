// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Undeclared-key driver conformance — a key the object does not declare is
// refused by the ENGINE, as one envelope, on every SQL driver arm this suite
// runs, whether the caller wrote it or a `before*` hook did. And the table,
// read straight past the engine, holds nothing the refused write carried.
//
// What a misspelled key costs, per writer and per driver, is the engine's and
// the drivers' fact, not an app's (#15953's classification table, row 10).
// hotcrm pinned it by hand in `test/undeclared-key-probe.test.ts` over its two
// line-item objects; this file is the platform's own pin, so that one can go.
//
// The engine runs one door, `undeclaredWriteFieldErrors` (objectql
// `engine.ts`), twice per write: over the caller's keys ahead of the hooks,
// and again over the post-hook payload ahead of the statement. Before the
// second run existed, ONE hook writing `tax_rate` onto an object that does not
// declare it meant a different thing per driver (objectql's suite records the
// 17.1.0 reading): the memory driver stored a shadow column outside
// field-level security, driver-sql threw a raw `SQLITE_ERROR` with no
// `status`, and sqlite-wasm a bare `Error` with neither. objectql pins the
// door against driver DOUBLES (`engine-post-hook-undeclared-field.test.ts`,
// and the caller path in `engine-undeclared-key-caller-path.test.ts`) and
// says so: it depends on no real driver. This file is the other half, the
// shipped drivers under the engine.
//
// The arms. The table's "memory" is the suite's in-memory SQL arm: the
// `driver-memory` arm left the conformance files in #5704, and `driver-sql` on
// better-sqlite3 `:memory:` is the arm `read-coercion-conformance.test.ts`
// runs. It is also the table's "sqlite". `sqlite-wasm` is the arm
// `date-bucket-parity-conformance.test.ts` runs beside it.
//
// The envelope is read off the engine, never rebuilt here. The caller path is
// pinned to the code and status the table names, `INVALID_FIELD` / 400, which
// is what both arms answer today. The hook path must answer the SAME envelope
// the caller path answers on the same arm, compared field for field. Two
// controls keep a red-free run from measuring nothing: a declared key
// round-trips, and the same hook DOES store the same key on an object that
// declares it, so a refusal can never be "hooks never ran on this arm".

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { installDefaultOrganization } from './default-organization.testkit.js';

const DRIVERS = [
  {
    name: 'driver-sql (better-sqlite3 :memory:)',
    make: (): SqlDriver =>
      new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      }),
  },
  {
    name: 'driver-sqlite-wasm (:memory:)',
    make: (): SqlDriver => new SqliteWasmDriver({ filename: ':memory:' }),
  },
];

const SYS = { context: { isSystem: true, userId: 'usr_system' } };

/** hotcrm's pair: `probe_quote` declares the key, `probe_quote_line` does not. */
const KEY = 'tax_rate';
const QUOTE = 'probe_quote';
const LINE = 'probe_quote_line';

/** What the probe hook stamps onto a `probe_quote_line` payload: a key that object does not declare. */
const LINE_HOOK_WRITES = { [KEY]: 7 };
/** What the same hook stamps onto a `probe_quote` payload: the same key, declared there. */
const QUOTE_HOOK_WRITES = { [KEY]: 7 };

/** The caller path's answer, as the table names it and as both arms answer it today. */
const CALLER_PATH = { code: 'INVALID_FIELD', status: 400 };

const APP = {
  id: 'com.objectstack.dogfood.undeclared-key-conformance',
  name: 'Undeclared key conformance',
  version: '1.0.0',
  type: 'plugin',
  scope: 'system',
  objects: [
    {
      name: QUOTE,
      label: 'Probe quote',
      fields: {
        id: { name: 'id', type: 'text', primaryKey: true },
        name: { name: 'name', type: 'text' },
        [KEY]: { name: KEY, type: 'number' },
      },
    },
    {
      name: LINE,
      label: 'Probe quote line',
      fields: {
        id: { name: 'id', type: 'text', primaryKey: true },
        name: { name: 'name', type: 'text' },
        unit_price: { name: 'unit_price', type: 'number' },
      },
    },
  ],
};

/** The fields of a refusal a caller reads. Projected from the engine's error, never constructed. */
interface Refusal {
  code?: unknown;
  status?: unknown;
  field?: unknown;
  object?: unknown;
}
const envelope = (e: Refusal): Refusal => ({ code: e.code, status: e.status, field: e.field, object: e.object });

async function refusalOf(run: () => Promise<unknown>): Promise<Refusal> {
  try {
    await run();
  } catch (e) {
    return e as Refusal;
  }
  throw new Error('expected the engine to refuse, and it answered');
}

/** A `beforeInsert` + `beforeUpdate` hook on `object` that stamps `writes` onto the payload. */
function armStampHook(engine: ObjectQL, object: string, writes: Record<string, unknown>): void {
  const stamp = (ctx: { input: Record<string, unknown> }) => {
    Object.assign(ctx.input.data as Record<string, unknown>, writes);
  };
  engine.registerHook('beforeInsert', stamp, { object });
  engine.registerHook('beforeUpdate', stamp, { object });
}

describe.each(DRIVERS)('undeclared-key conformance: $name', ({ make }) => {
  let driver: SqlDriver;
  let engine: ObjectQL;

  beforeEach(async () => {
    driver = make();
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registerApp(APP);
    await engine.syncSchemas();
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);
  });

  afterEach(async () => {
    await engine.destroy();
  });

  /** Ground truth, read off the table through knex: past every engine layer. */
  async function stored(object: string, column: string): Promise<string[]> {
    const knex = (driver as unknown as {
      knex: (t: string) => { select: (...c: string[]) => Promise<Array<Record<string, unknown>>> };
    }).knex;
    const rows = await knex(object).select('id', 'name', column);
    return rows.map((r) => `${String(r.id)}:${String(r.name)}:${String(r[column])}`).sort();
  }

  it('control: a declared key round-trips through insert, update and read', async () => {
    await engine.insert(QUOTE, { id: 'q1', name: 'Q', [KEY]: 10 }, SYS);
    expect((await engine.findOne(QUOTE, { where: { id: 'q1' } }, SYS))?.[KEY]).toBe(10);

    await engine.update(QUOTE, { id: 'q1', [KEY]: 12 }, SYS);
    expect((await engine.findOne(QUOTE, { where: { id: 'q1' } }, SYS))?.[KEY]).toBe(12);
    expect(await stored(QUOTE, KEY)).toEqual(['q1:Q:12']);
  });

  it('control: the same hook stamping the same key on an object that DECLARES it is stored', async () => {
    armStampHook(engine, QUOTE, QUOTE_HOOK_WRITES);

    await engine.insert(QUOTE, { id: 'q1', name: 'Q' }, SYS);

    expect(await stored(QUOTE, KEY)).toEqual(['q1:Q:7']);
  });

  it(`caller path: an insert carrying an undeclared key is ${CALLER_PATH.code} / ${CALLER_PATH.status}, and nothing is stored`, async () => {
    const err = await refusalOf(() => engine.insert(LINE, { id: 'l1', name: 'L', unit_price: 1, [KEY]: 5 }, SYS));

    expect(envelope(err)).toEqual({ ...CALLER_PATH, field: KEY, object: LINE });
    expect(await stored(LINE, 'unit_price')).toEqual([]);
  });

  it(`caller path: an update carrying an undeclared key is ${CALLER_PATH.code} / ${CALLER_PATH.status}, and the row is unchanged`, async () => {
    await engine.insert(LINE, { id: 'l1', name: 'L', unit_price: 100 }, SYS);

    const err = await refusalOf(() => engine.update(LINE, { id: 'l1', unit_price: 200, [KEY]: 5 }, SYS));

    expect(envelope(err)).toEqual({ ...CALLER_PATH, field: KEY, object: LINE });
    expect(await stored(LINE, 'unit_price')).toEqual(['l1:L:100']);
  });

  it('hook path: a beforeInsert-written undeclared key is refused as the caller-path envelope, and nothing is stored', async () => {
    const callerAnswer = envelope(
      await refusalOf(() => engine.insert(LINE, { id: 'c1', name: 'C', unit_price: 1, [KEY]: 5 }, SYS)),
    );
    armStampHook(engine, LINE, LINE_HOOK_WRITES);

    const err = await refusalOf(() => engine.insert(LINE, { id: 'l1', name: 'L', unit_price: 1 }, SYS));

    expect(err).toMatchObject(CALLER_PATH);
    expect(envelope(err)).toEqual(callerAnswer);
    expect(await stored(LINE, 'unit_price')).toEqual([]);
  });

  it('hook path: a beforeUpdate-written undeclared key is refused the same way, by id and by predicate, and no row changes', async () => {
    await engine.insert(LINE, { id: 'l1', name: 'L', unit_price: 100 }, SYS);
    await engine.insert(LINE, { id: 'l2', name: 'L', unit_price: 100 }, SYS);
    const callerAnswer = envelope(await refusalOf(() => engine.update(LINE, { id: 'l1', [KEY]: 5 }, SYS)));
    armStampHook(engine, LINE, LINE_HOOK_WRITES);

    const byId = await refusalOf(() => engine.update(LINE, { id: 'l1', unit_price: 200 }, SYS));
    const byPredicate = await refusalOf(() =>
      engine.update(LINE, { unit_price: 300 }, { ...SYS, where: { name: 'L' }, multi: true }),
    );

    expect(byId).toMatchObject(CALLER_PATH);
    expect(envelope(byId)).toEqual(callerAnswer);
    expect(byPredicate).toMatchObject(CALLER_PATH);
    expect(envelope(byPredicate)).toEqual(callerAnswer);
    expect(await stored(LINE, 'unit_price')).toEqual(['l1:L:100', 'l2:L:100']);
  });
});
