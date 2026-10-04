// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21109, ruling A] The row-level write `check` judges a `date`, `datetime` or
 * `time` column in its STORED form, so the write and the read the same policy
 * scopes give one answer for one row.
 *
 * Driven through the real engine, the real plugin and two SQL driver families,
 * as a member who resolves a permission set. Each cell writes one value under a
 * policy whose `using` and `check` are the same predicate, then asks the read:
 * the write is admitted exactly when the read shows the row that value is
 * stored as. Measured on `main` before the step (`rls-check-stored-form.ts`):
 *
 * | `check` | written | write, before | stored | read |
 * |---|---|---|---|---|
 * | `record.due_on == '2026-01-05'` | `'2026-01-05T15:00:00Z'`, a `Date` | 403 | `2026-01-05` | shown |
 * | `record.due_on > '2026-01-05'` | `'2026-01-05T15:00:00Z'` | admitted | `2026-01-05` | hidden |
 * | `record.start_time == '09:00'` | `'09:00:00'` | 403 | `09:00:00` | shown |
 * | `record.due_at == '2026-01-05T10:00:00Z'` | `'2026-01-05T18:00:00+08:00'` | 403 | `2026-01-05T10:00:00.000Z` | shown |
 *
 * [#21238] The same holds for a lone scalar written to a declared multi-valued
 * column, which the write door stores as a one-member list (`tags`, and a
 * `select` flagged `multiple`; the insert, a by-id update and a predicate
 * update). Measured on `main` before the fold:
 *
 * | `check` | written | write, before | stored | read |
 * |---|---|---|---|---|
 * | `record.tags.contains('x')` | `'x'` | 403 | `["x"]` | shown |
 * | `!record.tags.contains('x')` | `'x'` | admitted | `["x"]` | hidden |
 * | `record.tags.contains('x')`, a by-id update | `'x'` | 403 | `["x"]` | shown |
 *
 * [#21254] An operator the read refuses on a declared JSON-stored column
 * (`@objectstack/core`'s `JSON_COLUMN_INCOMPATIBLE_OPERATORS`, or implicit
 * equality) is refused by the write check too, with the read's
 * `INVALID_FILTER` / 400 and core's words. Measured on `main` before the step:
 *
 * | `check` | written | write, before | stored | read |
 * |---|---|---|---|---|
 * | `record.tags != 'x'` | `['x']` or `'x'` | admitted | `["x"]` | 400 |
 * | `!(record.tags in ['x'])` | `['x']` | admitted | `["x"]` | 400 |
 * | `record.tags == 'x'` | `['x']` | 403 | — | 400 |
 * | `record.tags in ['x']` | `['x']` | 403 | — | 400 |
 * | `record.tags > 'a'` | `['x']` | 400 | — | 400 |
 * | `record.meta != 'x'` / `record.meta == 'x'` (`json`) | `'y'` / `'x'` | admitted | the scalar | 400 |
 *
 * The membership pair and the presence predicates answer as before, and so
 * does every operator on a column declared neither way.
 *
 * ## formula's whole-day copy is out of reach here
 *
 * `@objectstack/formula`'s matcher carries its own copy of the whole-day upper
 * bound (a bare-day `$lte` read as "through that day"), which today is what
 * admits a `due_on` written as an instant or a `Date` on the boundary day under
 * `record.due_on <= '2026-01-05'`. Ruling A retires that copy once the check
 * judges the stored form, so these cells must pass WITHOUT it: the matcher is
 * wrapped so a `$lte` reaches it as `$lt` or `$eq`, and a `$between` as `$gte`
 * plus that, and the copy never runs. The first cell pins that the wrapper is
 * live.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
// The mocked module (see `vi.mock` below), loaded at module top.
import { matchesFilterCondition } from '@objectstack/formula';
import { JSON_COLUMN_INCOMPATIBLE_OPERATORS, jsonColumnOperatorRefusalText } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import {
  declaredJsonStoredColumns,
  declaredMultiValueColumns,
  declaredTemporalColumns,
  findJsonColumnCheckRefusal,
  jsonColumnCheckRefusalCarriedBy,
  storedFormCheckFilter,
  storedFormCheckJudge,
  storedFormImage,
} from './rls-check-stored-form.js';

/** A plain object — a filter node or an operator map. */
function isPlain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

/** `$lte` as `$lt` or `$eq`, so the matcher's whole-day copy is never reached. */
const plainLte = (column: string, bound: unknown) => ({
  $or: [{ [column]: { $lt: bound } }, { [column]: { $eq: bound } }],
});

/** The filter with every `$lte` and `$between` spelled without the operators the copy serves. */
function withoutWholeDayCopy(node: unknown): unknown {
  if (!isPlain(node)) return node;
  const conjuncts: unknown[] = [];
  for (const [key, value] of Object.entries(node)) {
    if ((key === '$and' || key === '$or') && Array.isArray(value)) {
      conjuncts.push({ [key]: value.map(withoutWholeDayCopy) });
    } else if (key === '$not') {
      conjuncts.push({ $not: withoutWholeDayCopy(value) });
    } else if (key.startsWith('$') || !isPlain(value) || !('$lte' in value || '$between' in value)) {
      conjuncts.push({ [key]: value });
    } else {
      const { $lte, $between, ...rest } = value;
      if (Object.keys(rest).length > 0) conjuncts.push({ [key]: rest });
      if ($lte !== undefined) conjuncts.push(plainLte(key, $lte));
      if (Array.isArray($between)) conjuncts.push({ [key]: { $gte: $between[0] } }, plainLte(key, $between[1]));
    }
  }
  return conjuncts.length === 1 ? conjuncts[0] : { $and: conjuncts };
}

vi.mock('@objectstack/formula', async (importOriginal) => {
  const real = await importOriginal<typeof import('@objectstack/formula')>();
  return {
    ...real,
    matchesFilterCondition: ((record, filter, options) =>
      real.matchesFilterCondition(record, withoutWholeDayCopy(filter) as never, options)) as typeof real.matchesFilterCondition,
  };
});

const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

type Driver = { disconnect?: () => Promise<void> };
const DRIVERS: Array<[name: string, make: () => Driver]> = [
  ['driver-sql (better-sqlite3)', () =>
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })],
  ['driver-sqlite-wasm', () => new SqliteWasmDriver({ filename: ':memory:' })],
];

const booted: ObjectQL[] = [];
afterEach(async () => {
  while (booted.length) {
    try { await booted.pop()!.destroy(); } catch { /* noop */ }
  }
});

let seq = 0;
/**
 * One engine and plugin, with ONE policy whose `using` and `check` are the same
 * predicate — or, given `using`, a policy whose `using` is that one instead.
 */
async function boot(makeDriver: () => Driver, predicate: string, using: string = predicate) {
  const OBJ = `qa_due_stored_${process.pid}_${++seq}`;
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver() as never, true);
  await engine.init();
  engine.registerApp({
    id: `com.objectstack.qa.rls-check-stored-form-${seq}`,
    name: 'RLS check stored form',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      {
        name: OBJ,
        label: 'Duty',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          title: { name: 'title', type: 'text' },
          due_on: { name: 'due_on', type: 'date' },
          due_at: { name: 'due_at', type: 'datetime' },
          start_time: { name: 'start_time', type: 'time' },
          tags: { name: 'tags', type: 'tags' },
          owners: { name: 'owners', type: 'select', multiple: true, options: [{ label: 'X', value: 'x' }, { label: 'XY', value: 'xy' }] },
          meta: { name: 'meta', type: 'json' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  booted.push(engine);

  const set = PermissionSetSchema.parse({
    name: 'qa_due_guard',
    objects: { [OBJ]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    rowLevelSecurity: [{ name: 'due_guard', object: OBJ, operation: 'all', using, check: predicate }],
  });
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, set],
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  const caller = { userId: 'usr_member', positions: ['qa_pos'], permissions: [set.name], posture: 'MEMBER' };
  const storedRow = async (id: string) =>
    ((await engine.find(OBJ, { where: { id }, context: SYS_CTX } as never)) as Array<Record<string, unknown>>)[0];
  const shownTo = async (id: string) =>
    ((await engine.find(OBJ, { where: { id }, context: caller } as never)) as unknown[]).length > 0;
  return { OBJ, engine, caller, storedRow, shownTo, logger: ctx.logger };
}

type Envelope = { code: string; status: number };
const DENIED: Envelope = { code: 'PERMISSION_DENIED', status: 403 };
const envelopeOf = (e: unknown): Envelope => {
  const x = e as { code?: string; status?: number; statusCode?: number };
  return { code: String(x?.code), status: Number(x?.statusCode ?? x?.status) };
};
const outcome = (p: Promise<unknown>): Promise<'admitted' | Envelope> =>
  p.then(() => 'admitted' as const, (e: unknown) => envelopeOf(e));

const show = (v: unknown): string => (v instanceof Date ? `Date(${v.toISOString()})` : JSON.stringify(v));

type Cell = { predicate: string; column: string; value: unknown; stored: unknown; admitted: boolean };
const CELLS: Cell[] = [
  // `date`, the boundary day under a bare-day `$lte`: the three ways an SDK writes it.
  { predicate: "record.due_on <= '2026-01-05'", column: 'due_on', value: '2026-01-05T15:00:00Z', stored: '2026-01-05', admitted: true },
  { predicate: "record.due_on <= '2026-01-05'", column: 'due_on', value: new Date('2026-01-05T15:00:00Z'), stored: '2026-01-05', admitted: true },
  { predicate: "record.due_on <= '2026-01-05'", column: 'due_on', value: '2026-01-05', stored: '2026-01-05', admitted: true },
  { predicate: "record.due_on <= '2026-01-05'", column: 'due_on', value: '2026-01-06T01:00:00Z', stored: '2026-01-06', admitted: false },
  // `date` equality: refused before for an instant or a `Date` on the day.
  { predicate: "record.due_on == '2026-01-05'", column: 'due_on', value: '2026-01-05T15:00:00Z', stored: '2026-01-05', admitted: true },
  { predicate: "record.due_on == '2026-01-05'", column: 'due_on', value: new Date('2026-01-05T15:00:00Z'), stored: '2026-01-05', admitted: true },
  { predicate: "record.due_on == '2026-01-05'", column: 'due_on', value: '2026-01-06', stored: '2026-01-06', admitted: false },
  // `date`, strictly after the day: ADMITTED before, while the read hid the stored day.
  { predicate: "record.due_on > '2026-01-05'", column: 'due_on', value: '2026-01-05T15:00:00Z', stored: '2026-01-05', admitted: false },
  // `datetime`: one instant in two zones, and a comparand the policy spells unlike the stored form.
  { predicate: "record.due_at == '2026-01-05T10:00:00Z'", column: 'due_at', value: '2026-01-05T18:00:00+08:00', stored: '2026-01-05T10:00:00.000Z', admitted: true },
  { predicate: "record.due_at == '2026-01-05T10:00:00Z'", column: 'due_at', value: '2026-01-05T10:00:01Z', stored: '2026-01-05T10:00:01.000Z', admitted: false },
  { predicate: "record.due_at >= '2026-01-05T10:00:00Z'", column: 'due_at', value: '2026-01-05T10:00:00Z', stored: '2026-01-05T10:00:00.000Z', admitted: true },
  // `time`: a wall clock written with and without seconds.
  { predicate: "record.start_time == '09:00'", column: 'start_time', value: '09:00:00', stored: '09:00:00', admitted: true },
  { predicate: "record.start_time == '09:00'", column: 'start_time', value: '09:00', stored: '09:00:00', admitted: true },
  { predicate: "record.start_time == '09:00'", column: 'start_time', value: '09:01', stored: '09:01:00', admitted: false },
  // Control: a TEXT column is judged as written, whatever its value looks like.
  { predicate: "record.title == '2026-01-05'", column: 'title', value: '2026-01-05T15:00:00Z', stored: '2026-01-05T15:00:00Z', admitted: false },
  { predicate: "record.title > '2026-01-05'", column: 'title', value: '2026-01-05T15:00:00Z', stored: '2026-01-05T15:00:00Z', admitted: true },
  // [#21238] A declared multi-valued column: a lone scalar is stored as a one-member list.
  { predicate: "record.tags.contains('x')", column: 'tags', value: 'x', stored: ['x'], admitted: true },
  { predicate: "record.tags.contains('x')", column: 'tags', value: 'xy', stored: ['xy'], admitted: false },
  { predicate: "record.tags.contains('x')", column: 'tags', value: ['x'], stored: ['x'], admitted: true },
  { predicate: "!record.tags.contains('x')", column: 'tags', value: 'x', stored: ['x'], admitted: false },
  { predicate: "record.owners.contains('x')", column: 'owners', value: 'x', stored: ['x'], admitted: true },
  { predicate: "record.owners.contains('x')", column: 'owners', value: 'xy', stored: ['xy'], admitted: false },
  // Control: a TEXT column keeps its scalar, and `contains` stays a substring test.
  { predicate: "record.title == 'x'", column: 'title', value: 'x', stored: 'x', admitted: true },
  { predicate: "record.title.contains('x')", column: 'title', value: 'xy', stored: 'xy', admitted: true },
];

describe("formula's whole-day copy is out of reach in this file", () => {
  it('a bare-day $lte no longer admits an instant later on that day', () => {
    expect(matchesFilterCondition({ d: '2026-01-05T15:00:00Z' }, { d: { $lte: '2026-01-05' } } as never)).toBe(false);
    expect(matchesFilterCondition({ d: '2026-01-05' }, { d: { $lte: '2026-01-05' } } as never)).toBe(true);
  });
});

for (const [driverName, makeDriver] of DRIVERS) {
  describe(`${driverName}: the write check and the read give one answer for one stored row`, () => {
    for (const cell of CELLS) {
      const verdict = cell.admitted ? 'admitted and shown' : 'refused 403 and hidden';
      it(`${cell.predicate}, ${cell.column} written as ${show(cell.value)}: ${verdict}`, async () => {
        const r = await boot(makeDriver, cell.predicate);
        const written = await outcome(r.engine.insert(r.OBJ, { id: 'w', [cell.column]: cell.value }, { context: r.caller } as never));
        expect(written).toEqual(cell.admitted ? 'admitted' : DENIED);
        // The read under the same predicate, over the same value stored by the system.
        await r.engine.insert(r.OBJ, { id: 'r', [cell.column]: cell.value }, { context: SYS_CTX } as never);
        expect((await r.storedRow('r'))?.[cell.column]).toEqual(cell.stored);
        expect(await r.shownTo('r')).toBe(cell.admitted);
        // A refused write stored nothing; an admitted one stored the same row.
        const w = await r.storedRow('w');
        expect(w === undefined ? undefined : w[cell.column]).toEqual(cell.admitted ? cell.stored : undefined);
      });
    }

    it("a by-id update judges the stored form too: onto the day as an instant 'admitted', onto the next day 403 and unchanged", async () => {
      const r = await boot(makeDriver, "record.due_on == '2026-01-05'");
      await r.engine.insert(r.OBJ, { id: 'u', due_on: '2026-01-05' }, { context: SYS_CTX } as never);
      expect(await outcome(r.engine.update(r.OBJ, { due_on: '2026-01-05T23:30:00Z' }, { where: { id: 'u' }, context: r.caller } as never)))
        .toBe('admitted');
      expect(await outcome(r.engine.update(r.OBJ, { due_on: new Date('2026-01-06T00:30:00Z') }, { where: { id: 'u' }, context: r.caller } as never)))
        .toEqual(DENIED);
      expect((await r.storedRow('u'))?.due_on).toBe('2026-01-05');
    });

    it("[#21238] a by-id update judges a lone scalar on a multi-valued column as its stored list: 'x' admitted, 'xy' 403 and unchanged", async () => {
      const r = await boot(makeDriver, "record.tags.contains('x')");
      await r.engine.insert(r.OBJ, { id: 'u', tags: ['x', 'z'] }, { context: SYS_CTX } as never);
      expect(await outcome(r.engine.update(r.OBJ, { tags: 'x' }, { where: { id: 'u' }, context: r.caller } as never)))
        .toBe('admitted');
      expect((await r.storedRow('u'))?.tags).toEqual(['x']);
      expect(await outcome(r.engine.update(r.OBJ, { tags: 'xy' }, { where: { id: 'u' }, context: r.caller } as never)))
        .toEqual(DENIED);
      expect((await r.storedRow('u'))?.tags).toEqual(['x']);
      expect(await r.shownTo('u')).toBe(true);
    });

    it("[#21238] a predicate update judges a lone scalar on a multi-valued column as its stored list: 'x' admitted, 'xy' 403 and unchanged", async () => {
      const r = await boot(makeDriver, "record.tags.contains('x')");
      await r.engine.insert(r.OBJ, { id: 'p', title: 'batch', tags: ['x'] }, { context: SYS_CTX } as never);
      expect(await outcome(r.engine.update(r.OBJ, { tags: 'x' }, { where: { title: 'batch' }, multi: true, context: r.caller } as never)))
        .toBe('admitted');
      expect((await r.storedRow('p'))?.tags).toEqual(['x']);
      expect(await outcome(r.engine.update(r.OBJ, { tags: 'xy' }, { where: { title: 'batch' }, multi: true, context: r.caller } as never)))
        .toEqual(DENIED);
      expect((await r.storedRow('p'))?.tags).toEqual(['x']);
    });
  });
}

// [#21254] The card's table at the engine write door, beside the read the same
// policy scopes. A refused cell names what the withheld diagnostic names: the
// column, the operator, and whether it is the bare equality spelling.
const REFUSED: Envelope = { code: 'INVALID_FILTER', status: 400 };
type JsonColumnCell = {
  predicate: string;
  column: string;
  value: unknown;
  refused?: [field: string, op: string, bare: boolean];
  /** A cell the check still evaluates: whether it admits, the read shows the row, and what is stored. */
  admitted?: boolean;
  stored?: unknown;
};
const JSON_COLUMN_CELLS: JsonColumnCell[] = [
  // The card's rows 1–2: admitted before, while the read refused the policy.
  { predicate: "record.tags != 'x'", column: 'tags', value: ['x'], refused: ['tags', '$ne', false] },
  { predicate: "record.tags != 'x'", column: 'tags', value: 'x', refused: ['tags', '$ne', false] },
  { predicate: "!(record.tags in ['x'])", column: 'tags', value: ['x'], refused: ['tags', '$in', false] },
  // Rows 3–5: refused before (403, 403, 400). Nothing is stored, as before; the answer is now the read's.
  { predicate: "record.tags == 'x'", column: 'tags', value: ['x'], refused: ['tags', '=', true] },
  { predicate: "record.tags in ['x']", column: 'tags', value: ['x'], refused: ['tags', '$in', false] },
  { predicate: "record.tags > 'a'", column: 'tags', value: ['x'], refused: ['tags', '$gt', false] },
  // A `select` flagged `multiple`, and a structured-JSON column holding a scalar.
  { predicate: "record.owners != 'x'", column: 'owners', value: ['x'], refused: ['owners', '$ne', false] },
  { predicate: "record.meta != 'x'", column: 'meta', value: 'y', refused: ['meta', '$ne', false] },
  { predicate: "record.meta == 'x'", column: 'meta', value: 'x', refused: ['meta', '=', true] },
  // Control: the membership pair — `contains` and its negation — answers on the stored list as before.
  { predicate: "record.tags.contains('x')", column: 'tags', value: ['x'], admitted: true, stored: ['x'] },
  { predicate: "record.tags.contains('x')", column: 'tags', value: ['y'], admitted: false, stored: ['y'] },
  { predicate: "!record.tags.contains('x')", column: 'tags', value: ['x'], admitted: false, stored: ['x'] },
  { predicate: "!record.tags.contains('x')", column: 'tags', value: ['y'], admitted: true, stored: ['y'] },
  // Control: presence answers on such a column.
  { predicate: 'record.tags != null', column: 'tags', value: ['x'], admitted: true, stored: ['x'] },
  // Control: a column declared neither way keeps every operator, the refused rows' among them.
  { predicate: "record.title != 'x'", column: 'title', value: 'y', admitted: true, stored: 'y' },
  { predicate: "record.title != 'x'", column: 'title', value: 'x', admitted: false, stored: 'x' },
  { predicate: "record.title in ['x']", column: 'title', value: 'x', admitted: true, stored: 'x' },
];

/** The write gate's server-log lines for this refusal. */
const refusalLines = (logger: { warn: unknown }): string[] =>
  (logger.warn as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).filter((l) => l.includes('RLS check REFUSED'));

for (const [driverName, makeDriver] of DRIVERS) {
  describe(`[#21254] ${driverName}: an operator the read refuses on a declared JSON-stored column is refused by the write check, with the read's answer`, () => {
    for (const cell of JSON_COLUMN_CELLS) {
      const verdict = cell.refused ? 'refused 400 INVALID_FILTER, as the read is' : cell.admitted ? 'admitted and shown' : 'refused 403 and hidden';
      it(`${cell.predicate}, ${cell.column} written as ${show(cell.value)}: ${verdict}`, async () => {
        const r = await boot(makeDriver, cell.predicate);
        const written = await r.engine
          .insert(r.OBJ, { id: 'w', [cell.column]: cell.value }, { context: r.caller } as never)
          .then(() => 'admitted' as const, (e: unknown) => e);
        await r.engine.insert(r.OBJ, { id: 'r', [cell.column]: cell.value }, { context: SYS_CTX } as never);
        if (!cell.refused) {
          expect(written === 'admitted' ? written : envelopeOf(written)).toEqual(cell.admitted ? 'admitted' : DENIED);
          expect((await r.storedRow('r'))?.[cell.column]).toEqual(cell.stored);
          expect(await r.shownTo('r')).toBe(cell.admitted);
          expect(refusalLines(r.logger)).toEqual([]);
          return;
        }
        const [field, op, bare] = cell.refused;
        const words = jsonColumnOperatorRefusalText(field, op, bare);
        // The write: the read's code and status, and core's words, which withhold the field and the operator.
        expect(envelopeOf(written)).toEqual(REFUSED);
        expect((written as Error).message).toBe(words.message);
        expect(await r.storedRow('w')).toBeUndefined();
        // The diagnostic the message points to is in the server log, beside the policy.
        const lines = refusalLines(r.logger);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("policy 'due_guard'");
        expect(lines[0]).toContain(words.diagnostic);
        // The read the same policy scopes, over the same value stored by the system: the same answer.
        const read = await r.engine
          .find(r.OBJ, { where: { id: 'r' }, context: r.caller } as never)
          .then(() => 'answered' as const, (e: unknown) => e);
        expect(envelopeOf(read)).toEqual(REFUSED);
        expect((read as Error).message).toBe(words.message);
      });
    }

    // The `using` here is a column declared neither way: under the same
    // predicate an update's pre-image read is refused first, by the driver,
    // and its gate fails closed 403 before any check runs.
    it("record.tags != 'x' as the check: a by-id update and a predicate update are refused 400 too, and change nothing", async () => {
      const r = await boot(makeDriver, "record.tags != 'x'", "record.title == 'batch'");
      await r.engine.insert(r.OBJ, { id: 'u', title: 'batch', tags: ['y'] }, { context: SYS_CTX } as never);
      expect(await outcome(r.engine.update(r.OBJ, { tags: 'x' }, { where: { id: 'u' }, context: r.caller } as never)))
        .toEqual(REFUSED);
      expect(await outcome(r.engine.update(r.OBJ, { tags: ['x'] }, { where: { title: 'batch' }, multi: true, context: r.caller } as never)))
        .toEqual(REFUSED);
      expect((await r.storedRow('u'))?.tags).toEqual(['y']);
    });
  });
}

describe('[#21254] the JSON-column refusal reads the declaration, never the record', () => {
  const DECLARED = {
    fields: {
      tags: { type: 'tags', multiple: false },
      labels: { type: 'multiselect', multiple: false },
      owners: { type: 'select', multiple: true },
      meta: { type: 'json', multiple: false },
      home: { type: 'address', multiple: false },
      status: { type: 'select', multiple: false },
      title: { type: 'text', multiple: false },
      due_on: { type: 'date', multiple: false },
    },
  };
  const JSON_STORED = declaredJsonStoredColumns(DECLARED);
  /** The refusal a judgement raised, with everything a caller and the log read from it. */
  const refusalOf = (judge: (image: Record<string, unknown>) => boolean, image: Record<string, unknown>) => {
    try {
      judge(image);
    } catch (e) {
      const x = e as Error & { code?: string; status?: number; httpStatus?: number };
      return { envelope: { code: x.code, status: x.status, httpStatus: x.httpStatus }, message: x.message, carried: jsonColumnCheckRefusalCarriedBy(e), error: e };
    }
    return null;
  };
  const IMAGES = [{ tags: ['x'] }, { tags: 'x' }, { tags: null }, {}, { tags: ['y'], meta: 'x', owners: ['x'] }];

  it('names exactly the multi-valued and structured-JSON columns, and none without a declaration', () => {
    expect([...JSON_STORED].sort()).toEqual(['home', 'labels', 'meta', 'owners', 'tags']);
    expect(declaredJsonStoredColumns(undefined).size).toBe(0);
  });

  it("refuses every operator in core's set on such a column, with the read's envelope and core's words, for every image", () => {
    expect(JSON_COLUMN_INCOMPATIBLE_OPERATORS.size).toBeGreaterThan(0);
    for (const op of JSON_COLUMN_INCOMPATIBLE_OPERATORS) {
      const judge = storedFormCheckJudge([{ tags: { [op]: 'x' } }], DECLARED);
      const words = jsonColumnOperatorRefusalText('tags', op, false);
      for (const image of IMAGES) {
        const got = refusalOf(judge, image);
        expect(got?.envelope, op).toEqual({ code: 'INVALID_FILTER', status: 400, httpStatus: 400 });
        expect(got?.message, op).toBe(words.message);
        expect(got?.carried, op).toMatchObject({ field: 'tags', operator: op, path: `check[0].tags.${op}`, diagnostic: words.diagnostic });
      }
    }
  });

  it('refuses implicit equality on such a column whatever the comparand, as the bare spelling', () => {
    for (const comparand of ['x', null, ['x'], new Date('2026-01-05T00:00:00Z'), 5]) {
      const got = refusalOf(storedFormCheckJudge([{ meta: comparand }], DECLARED), { meta: 'x' });
      expect(got?.carried).toMatchObject({ field: 'meta', operator: '=', path: 'check[0].meta', diagnostic: jsonColumnOperatorRefusalText('meta', '=', true).diagnostic });
    }
  });

  it('finds it at any depth under $and / $or / $not and in any part, and names where', () => {
    const nested = findJsonColumnCheckRefusal(
      [{ $and: [{ title: 'x' }, { $or: [{ tags: { $null: true } }, { $not: { home: { $eq: 'x' } } }] }] }],
      JSON_STORED,
    );
    expect(nested).toMatchObject({ field: 'home', operator: '$eq', path: 'check[0].$and[1].$or[1].$not.home.$eq' });
    expect(findJsonColumnCheckRefusal([{ title: { $ne: 'x' } }, { labels: { $nin: ['a'] } }], JSON_STORED))
      .toMatchObject({ field: 'labels', operator: '$nin', path: 'check[1].labels.$nin' });
  });

  it('leaves the membership pair, the presence predicates and every column declared neither way to the evaluator', () => {
    const parts = [
      { tags: { $contains: 'x' } },
      { tags: { $notContains: 'x' } },
      { $not: { owners: { $contains: 'x' } } },
      { tags: { $null: true } },
      { meta: { $exists: true } },
      { home: { $empty: false } },
      { title: { $ne: 'x' } },
      { title: 'x' },
      { status: { $in: ['x'] } },
      { due_on: { $gt: '2026-01-05' } },
    ];
    for (const part of parts) expect(findJsonColumnCheckRefusal([part], JSON_STORED), JSON.stringify(part)).toBeNull();
    const contains = storedFormCheckJudge([{ tags: { $contains: 'x' } }], DECLARED);
    const notContains = storedFormCheckJudge([{ tags: { $notContains: 'x' } }], DECLARED);
    expect([contains({ tags: ['x'] }), contains({ tags: ['y'] })]).toEqual([true, false]);
    expect([notContains({ tags: ['x'] }), notContains({ tags: ['y'] })]).toEqual([false, true]);
    const scalar = storedFormCheckJudge([{ title: { $ne: 'x' } }], DECLARED);
    expect([scalar({ title: 'y' }), scalar({ title: 'x' })]).toEqual([true, false]);
  });

  it('refuses nothing where the object hands over no declaration: judged as before', () => {
    expect(findJsonColumnCheckRefusal([{ tags: { $ne: 'x' } }], declaredJsonStoredColumns(undefined))).toBeNull();
    expect(storedFormCheckJudge([{ tags: { $ne: 'y' } }], undefined)({ tags: 'x' })).toBe(true);
  });

  it('keeps the field and the operator off the wire: they travel on the error only for the server log', () => {
    const got = refusalOf(storedFormCheckJudge([{ owners: { $ne: 'secret_member' } }], DECLARED), {});
    const wire = JSON.stringify({ ...(got!.error as object), message: got!.message });
    expect(wire).not.toContain('owners');
    expect(wire).not.toContain('$ne');
    expect(got?.carried?.diagnostic).toContain('"owners"');
    expect(jsonColumnCheckRefusalCarriedBy(new Error('other'))).toBeNull();
    expect(jsonColumnCheckRefusalCarriedBy(null)).toBeNull();
  });
});

describe('the stored-form step reads the declaration, never the values', () => {
  const COLUMNS = declaredTemporalColumns({
    fields: {
      due_on: { type: 'date', multiple: false },
      due_at: { type: 'datetime', multiple: false },
      start_time: { type: 'time', multiple: false },
      title: { type: 'text', multiple: false },
    },
  });

  it('names exactly the declared date / datetime / time columns, and none without a declaration', () => {
    expect([...COLUMNS.entries()]).toEqual([['due_on', 'date'], ['due_at', 'datetime'], ['start_time', 'time']]);
    expect(declaredTemporalColumns(undefined).size).toBe(0);
  });

  it('puts every value comparand on a temporal column into its form, and leaves everything else as written', () => {
    const filter = {
      $and: [
        { due_on: '2026-01-05T15:00:00Z' },
        { due_on: { $in: ['2026-01-05T15:00:00Z', '2026-01-06'], $null: false } },
        { start_time: { $between: ['09:00', '17:30'] } },
        { due_at: { $gte: '2026-01-05T18:00:00+08:00', $contains: '2026' } },
        { due_on: { $lte: { $field: 'title' } } },
        { title: '2026-01-05T15:00:00Z' },
      ],
    };
    const before = JSON.stringify(filter);
    expect(storedFormCheckFilter(filter, COLUMNS)).toEqual({
      $and: [
        { due_on: '2026-01-05' },
        { due_on: { $in: ['2026-01-05', '2026-01-06'], $null: false } },
        { start_time: { $between: ['09:00:00', '17:30:00'] } },
        { due_at: { $gte: '2026-01-05T10:00:00.000Z', $contains: '2026' } },
        { due_on: { $lte: { $field: 'title' } } },
        { title: '2026-01-05T15:00:00Z' },
      ],
    });
    expect(JSON.stringify(filter)).toBe(before);
  });

  it('hands back the same filter and image when nothing is temporal (copy-on-write)', () => {
    const filter = { $or: [{ title: '2026-01-05T15:00:00Z' }, { due_on: { $null: true } }] };
    expect(storedFormCheckFilter(filter, COLUMNS)).toBe(filter);
    const image = { title: '2026-01-05T15:00:00Z', due_on: '2026-01-05' };
    expect(storedFormImage(image, COLUMNS)).toBe(image);
    expect(storedFormImage({ due_on: new Date('2026-01-05T15:00:00Z') }, COLUMNS)).toEqual({ due_on: '2026-01-05' });
  });
});

describe('[#21238] the multi-valued half reads the declaration, never the values', () => {
  const DECLARED = {
    fields: {
      tags: { type: 'tags', multiple: false },
      labels: { type: 'multiselect', multiple: false },
      owners: { type: 'select', multiple: true },
      watchers: { type: 'user', multiple: true },
      status: { type: 'select', multiple: false },
      owner: { type: 'lookup', multiple: false },
      title: { type: 'text', multiple: false },
      due_on: { type: 'date', multiple: false },
    },
  };
  const MULTI = declaredMultiValueColumns(DECLARED);
  const TEMPORAL = declaredTemporalColumns(DECLARED);

  it('names exactly the declared multi-valued columns, and none without a declaration', () => {
    expect([...MULTI]).toEqual(['tags', 'labels', 'owners', 'watchers']);
    expect(declaredMultiValueColumns(undefined).size).toBe(0);
  });

  it('stores a lone scalar on a multi-valued column as a one-member list, and nothing else', () => {
    const image = { tags: 'x', owners: 'x', labels: ['a'], watchers: '', status: 'x', owner: 'x', title: 'x', due_on: '2026-01-05T15:00:00Z' };
    const before = JSON.stringify(image);
    const stored = storedFormImage(image, TEMPORAL, MULTI);
    expect(stored).toEqual({ tags: ['x'], owners: ['x'], labels: ['a'], watchers: '', status: 'x', owner: 'x', title: 'x', due_on: '2026-01-05' });
    expect(stored.labels).toBe(image.labels);
    expect(JSON.stringify(image)).toBe(before);
    const settled = { tags: ['x'], title: 'x', owners: null };
    expect(storedFormImage(settled, TEMPORAL, MULTI)).toBe(settled);
  });

  it('gives a lone scalar the verdict its stored list gets, and leaves the comparands as written', () => {
    for (const part of [
      { tags: { $contains: 'x' } },
      { $not: { tags: { $contains: 'x' } } },
      { tags: { $notContains: 'x' } },
      { $or: [{ tags: { $contains: 'y' } }, { owners: { $contains: 'x' } }] },
    ]) {
      const judge = storedFormCheckJudge([part], DECLARED);
      expect(judge({ tags: 'x', owners: 'x' })).toBe(judge({ tags: ['x'], owners: ['x'] }));
      expect(judge({ tags: 'xy', owners: 'xy' })).toBe(judge({ tags: ['xy'], owners: ['xy'] }));
      expect(storedFormCheckFilter(part, TEMPORAL)).toBe(part);
    }
    const contains = storedFormCheckJudge([{ tags: { $contains: 'x' } }], DECLARED);
    expect([contains({ tags: 'x' }), contains({ tags: 'xy' })]).toEqual([true, false]);
  });
});
