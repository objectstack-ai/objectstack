// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19886 stage 2e] A row-level policy that ORDERS a field against a bound fails
 * closed on the write when that field holds a list or an object on the record,
 * through the real plugin, the real engine and two SQL-family drivers.
 *
 * `record.tags > 'a'` lowers to `{ tags: { $gt: 'a' } }` — a legal shape. The
 * list arrives on the post-image, and the write-check evaluator used to compare
 * its JavaScript string form: `['m'] > 'a'` is `'m' > 'a'`, and `{ a: 1 } < 'a'`
 * is `'[object Object]' < 'a'`. Measured before the fix through this same stack
 * on driver-sql and on driver-memory:
 *
 * | predicate | list on the post-image | check insert, before | now |
 * |---|---|---|---|
 * | `record.tags > 'a'` / `< 'z'` / `>= 'a'` / `<= 'z'` (`tags` json) | `['m']` | admitted, stored | 400 |
 * | `record.tags > 'n'` | `['a', 'z']` | 403 (`'a,z' > 'n'` is false) | 400 |
 * | `record.meta < 'a'` (`meta` json) | `{ a: 1 }` | admitted, stored | 400 |
 * | `record.meta > 'a'` | `{ a: 1 }` | 403 | 400 |
 * | `record.watchers > 'a'` / `< 'p2'` (`multiple` lookup) | `['p1']` | admitted, stored | 400 |
 * | `record.status > 'a'` (`text`) | `['m']` | admitted, driver-sql stored the text `'["m"]'` | 400 |
 * | `record.amount > 10` (`number`) | `[500]` | admitted, driver-sql stored `'[500]'` | 400 |
 *
 * The by-id update door answers the same: a change set carrying the list, and
 * an edit of another field on a row whose stored json column holds one (the
 * post-image merges the stored row). The `using` read is the norm this follows:
 * driver-sql refuses an ordering comparison on a column it stores as JSON text,
 * by declared type (`INVALID_FILTER` / 400), and did so before this change.
 *
 * Not pinned here, and why: driver-memory's read compares a stored list element
 * by element and keeps returning those rows, so its write and read part (the
 * test driver's half, declared on #15104). `@objectstack/driver-memory` cannot
 * be declared by this package without a `driver-memory-census` ledger
 * disposition, so its cells were measured out of tree and reported on the PR.
 *
 * The controls — the same predicate over a record holding one scalar, `null`,
 * and a `Date`; and equality against a stored list (stage 2a) — answer exactly
 * as before. Ground truth is read past every scope.
 *
 * [#21254] On a column the object DECLARES JSON-stored (`tags` and `meta` are
 * `json`, `watchers` a `multiple` lookup) the write check now refuses an
 * operator the read refuses before any record is read, with the read's
 * `INVALID_FILTER` / 400 (`rls-check-stored-form.ts`). So on those columns the
 * ordering is refused whatever the record holds: the list as before, and now
 * the scalar too (`O1`–`O9`'s scalar cells, which this stage compared). The
 * write and the `using` read, which the driver refuses on those columns, now
 * answer alike. This stage's value rule still decides wherever the column is
 * not declared JSON-stored (`C1`, `C2`), so its `null` control and stage 2a's
 * equality control sit on the `text` column `status`, where they still reach
 * the evaluator.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const OBJ = 'qa_ticket';
const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const DRIVERS: Array<[string, () => unknown]> = [
  ['driver-sql (better-sqlite3)', () =>
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })],
  ['driver-sqlite-wasm', () => new SqliteWasmDriver({ filename: ':memory:' })],
];

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(makeDriver: () => unknown, clause: 'using' | 'check', predicate: string) {
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver() as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.rls-stored-list-ordering-19886',
    name: 'RLS stored-list ordering',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      {
        name: 'qa_person',
        label: 'Person',
        sharingModel: 'public_read_write',
        fields: { id: { name: 'id', type: 'text', primaryKey: true }, name: { name: 'name', type: 'text' } },
      },
      {
        name: OBJ,
        label: 'Ticket',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          status: { name: 'status', type: 'text' },
          amount: { name: 'amount', type: 'number' },
          due: { name: 'due', type: 'datetime' },
          tags: { name: 'tags', type: 'json' },
          meta: { name: 'meta', type: 'json' },
          watchers: { name: 'watchers', type: 'lookup', reference: 'qa_person', multiple: true },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  engines.push(engine);
  await engine.insert('qa_person', [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }], { context: SYS_CTX } as never);

  const set = PermissionSetSchema.parse({
    name: 'qa_ticket_guard',
    objects: { [OBJ]: { allowRead: true, allowCreate: true, allowEdit: true }, qa_person: { allowRead: true } },
    rowLevelSecurity: [{ name: 'guard', object: OBJ, operation: 'all', [clause]: predicate }],
  });
  let security: { explain: (req: unknown, ctx: unknown) => Promise<unknown> } | undefined;
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
    registerService: (name: string, impl: unknown) => {
      if (name === 'security') security = impl as typeof security;
    },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
  if (!security) throw new Error('SecurityPlugin did not register the security service');

  const caller = { userId: 'usr_member', positions: ['qa_pos'], permissions: [set.name], posture: 'MEMBER' };
  const stored = async () =>
    ((await engine.find(OBJ, { context: SYS_CTX } as never)) as Array<Record<string, unknown>>)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { engine, caller, stored, explain: security.explain };
}

type Envelope = { code: string; status: number };
const DENIED: Envelope = { code: 'PERMISSION_DENIED', status: 403 };
const INVALID: Envelope = { code: 'INVALID_FILTER', status: 400 };

const envelopeOf = (e: unknown): Envelope => {
  const x = e as { code?: string; status?: number; statusCode?: number };
  return { code: String(x?.code), status: Number(x?.statusCode ?? x?.status) };
};
const outcome = (p: Promise<unknown>): Promise<'admitted' | Envelope> =>
  p.then(() => 'admitted' as const, (e: unknown) => envelopeOf(e));
const verdictWords = (v: 'admitted' | Envelope): string =>
  v === 'admitted' ? 'is admitted' : `is ${v.code === 'INVALID_FILTER' ? 'refused 400' : 'denied 403'}`;

interface Case {
  id: string;
  predicate: string;
  /** The column the predicate orders. */
  field: string;
  /** A post-image value that is a list or an object — refused. */
  list: unknown;
  /** The same field holding one value (or none) — compared as before, unless the column is declared JSON-stored. */
  scalar: unknown;
  scalarVerdict: 'admitted' | Envelope;
  /** Whether the driver reads this column back as the list it was given (json / multiple). */
  readsBackAsList: boolean;
}

const CASES: Case[] = [
  // [#21254] Each scalar cell on a column declared JSON-stored is refused by the
  // declaration, as the read is; before, it was compared (O1–O4, O7 admitted,
  // O5, O6, O8, O9 denied 403).
  { id: 'O1', predicate: "record.tags > 'a'", field: 'tags', list: ['m'], scalar: 'm', scalarVerdict: INVALID, readsBackAsList: true },
  { id: 'O2', predicate: "record.tags < 'z'", field: 'tags', list: ['m'], scalar: 'm', scalarVerdict: INVALID, readsBackAsList: true },
  { id: 'O3', predicate: "record.tags >= 'a'", field: 'tags', list: ['m'], scalar: 'm', scalarVerdict: INVALID, readsBackAsList: true },
  { id: 'O4', predicate: "record.tags <= 'z'", field: 'tags', list: ['m'], scalar: 'm', scalarVerdict: INVALID, readsBackAsList: true },
  { id: 'O5', predicate: "record.tags > 'n'", field: 'tags', list: ['a', 'z'], scalar: 'm', scalarVerdict: INVALID, readsBackAsList: true },
  { id: 'O6', predicate: "record.meta < 'a'", field: 'meta', list: { a: 1 }, scalar: 'm', scalarVerdict: INVALID, readsBackAsList: true },
  { id: 'O7', predicate: "record.meta > 'a'", field: 'meta', list: { a: 1 }, scalar: 'm', scalarVerdict: INVALID, readsBackAsList: true },
  { id: 'O8', predicate: "record.watchers > 'a'", field: 'watchers', list: ['p1'], scalar: null, scalarVerdict: INVALID, readsBackAsList: true },
  { id: 'O9', predicate: "record.watchers < 'p2'", field: 'watchers', list: ['p1'], scalar: null, scalarVerdict: INVALID, readsBackAsList: true },
  { id: 'C1', predicate: "record.status > 'a'", field: 'status', list: ['m'], scalar: 'm', scalarVerdict: 'admitted', readsBackAsList: false },
  { id: 'C2', predicate: 'record.amount > 10', field: 'amount', list: [500], scalar: 500, scalarVerdict: 'admitted', readsBackAsList: false },
];

/** Stored by the system for the `using` reads. */
const ROWS = [
  { id: 'r_list', status: 's', amount: 50, tags: ['m'], meta: null, watchers: ['p1'] },
  { id: 'r_obj', status: 's', amount: 50, tags: null, meta: { a: 1 }, watchers: null },
  { id: 'r_scalar', status: 's', amount: 5, tags: 'm', meta: 'm', watchers: null },
];

/** The `using` read: the json-column cases are refused by the driver itself; the scalar columns compare. */
const READ: Record<string, 'driver refuses' | string[]> = {
  C1: ['r_list', 'r_obj', 'r_scalar'],
  C2: ['r_list', 'r_obj'],
};

for (const [driverName, makeDriver] of DRIVERS) {
  describe(`[#19886 stage 2e] ${driverName}: an ordering check over a field holding a list or an object fails closed`, () => {
    for (const c of CASES) {
      it(`${c.id} \`${c.predicate}\` — check insert: the list-holding write is refused 400 and nothing is stored; the scalar control ${verdictWords(c.scalarVerdict)}`, async () => {
        const w1 = await boot(makeDriver, 'check', c.predicate);
        expect(await outcome(w1.engine.insert(OBJ, { id: 'ins_list', status: 's', [c.field]: c.list }, { context: w1.caller } as never)))
          .toEqual(INVALID);
        expect(await w1.stored()).toEqual([]);

        const w2 = await boot(makeDriver, 'check', c.predicate);
        expect(await outcome(w2.engine.insert(OBJ, { id: 'ins_scalar', status: 's', [c.field]: c.scalar }, { context: w2.caller } as never)))
          .toEqual(c.scalarVerdict);
        expect((await w2.stored()).map((r) => r.id)).toEqual(c.scalarVerdict === 'admitted' ? ['ins_scalar'] : []);
      });

      it(`${c.id} \`${c.predicate}\` — by-id update: a change set carrying the list is refused 400 and the row is unchanged`, async () => {
        const w = await boot(makeDriver, 'check', c.predicate);
        await w.engine.insert(OBJ, { id: 'u_base', status: 's', [c.field]: c.scalar }, { context: SYS_CTX } as never);
        const before = await w.stored();
        expect(await outcome(w.engine.update(OBJ, { [c.field]: c.list }, { where: { id: 'u_base' }, context: w.caller } as never)))
          .toEqual(INVALID);
        expect(await w.stored()).toEqual(before);
      });

      if (c.readsBackAsList) {
        it(`${c.id} \`${c.predicate}\` — by-id update of ANOTHER field on a row whose stored column holds the list: refused 400, row unchanged`, async () => {
          const w = await boot(makeDriver, 'check', c.predicate);
          await w.engine.insert(OBJ, { id: 'u_stored', status: 's', [c.field]: c.list }, { context: SYS_CTX } as never);
          const before = await w.stored();
          expect(await outcome(w.engine.update(OBJ, { amount: 7 }, { where: { id: 'u_stored' }, context: w.caller } as never)))
            .toEqual(INVALID);
          expect(await w.stored()).toEqual(before);
        });
      }

      const read = READ[c.id] ?? 'driver refuses';
      it(`${c.id} \`${c.predicate}\` — the using read ${read === 'driver refuses' ? 'is refused by the driver itself (400, json column)' : `returns ${JSON.stringify(read)}`}`, async () => {
        const r = await boot(makeDriver, 'using', c.predicate);
        await r.engine.insert(OBJ, ROWS, { context: SYS_CTX } as never);
        const got = await r.engine.find(OBJ, { context: r.caller } as never).then(
          (rows) => ({ rows: (rows as Array<{ id: string }>).map((x) => x.id).sort() }),
          (e: unknown) => ({ error: envelopeOf(e) }),
        );
        expect(got).toEqual(read === 'driver refuses' ? { error: INVALID } : { rows: read });
        expect((await r.stored()).map((x) => x.id)).toEqual(['r_list', 'r_obj', 'r_scalar']);
      });
    }
  });

  describe(`[#19886 stage 2e] ${driverName}: the controls answer exactly as before`, () => {
    it('null in the ordered field is no value — compared, denied 403, not refused', async () => {
      const w = await boot(makeDriver, 'check', "record.status > 'a'");
      expect(await outcome(w.engine.insert(OBJ, { id: 'ins_null', status: null }, { context: w.caller } as never)))
        .toEqual(DENIED);
      expect(await w.stored()).toEqual([]);
    });

    it('a Date in the ordered field is a value — compared against the bound as an instant', async () => {
      const w1 = await boot(makeDriver, 'check', "record.due > '2026-01-01T00:00:00.000Z'");
      expect(await outcome(w1.engine.insert(OBJ, { id: 'ins_late', status: 's', due: new Date('2026-06-01T00:00:00.000Z') }, { context: w1.caller } as never)))
        .toBe('admitted');
      const w2 = await boot(makeDriver, 'check', "record.due > '2026-01-01T00:00:00.000Z'");
      expect(await outcome(w2.engine.insert(OBJ, { id: 'ins_early', status: 's', due: new Date('2025-06-01T00:00:00.000Z') }, { context: w2.caller } as never)))
        .toEqual(DENIED);
      expect(await w2.stored()).toEqual([]);
    });

    it("C3 `record.status == 'm'` — equality against a stored list is untouched (stage 2a): the list is denied 403, the scalar admitted", async () => {
      const w1 = await boot(makeDriver, 'check', "record.status == 'm'");
      expect(await outcome(w1.engine.insert(OBJ, { id: 'ins_list', status: ['m'] }, { context: w1.caller } as never)))
        .toEqual(DENIED);
      expect(await w1.stored()).toEqual([]);
      const w2 = await boot(makeDriver, 'check', "record.status == 'm'");
      expect(await outcome(w2.engine.insert(OBJ, { id: 'ins_scalar', status: 'm' }, { context: w2.caller } as never)))
        .toBe('admitted');
    });
  });

  describe(`[#19886 stage 2e] ${driverName}: security/explain answers 400 on a list-holding record, beside what enforcement answers`, () => {
    // Explain evaluates the business predicate in-process on the fetched row,
    // so both 400 paths reach it: this stage's stored list under an ordering
    // operator, and stage 2d's `{ $field }` comparison against a list-holding
    // column. On this driver family the enforced read refuses with the same
    // envelope; the enforced by-id update is refused 403 by its pre-image gate,
    // which fails closed on the driver's 400. Both deny.
    for (const predicate of ["record.tags > 'a'", 'record.status != record.tags']) {
      it(`\`${predicate}\`: explain read 400 = find 400; explain update 400, the by-id update 403`, async () => {
        const r = await boot(makeDriver, 'using', predicate);
        await r.engine.insert(OBJ, ROWS, { context: SYS_CTX } as never);

        expect(await outcome(r.explain({ object: OBJ, operation: 'read', recordId: 'r_list' }, { ...r.caller }))).toEqual(INVALID);
        expect(await outcome(r.engine.find(OBJ, { where: { id: 'r_list' }, context: { ...r.caller } } as never))).toEqual(INVALID);

        expect(await outcome(r.explain({ object: OBJ, operation: 'update', recordId: 'r_list' }, { ...r.caller }))).toEqual(INVALID);
        const before = await r.stored();
        expect(await outcome(r.engine.update(OBJ, { amount: 7 }, { where: { id: 'r_list' }, context: { ...r.caller } } as never)))
          .toEqual(DENIED);
        expect(await r.stored()).toEqual(before);
      });
    }
  });
}
