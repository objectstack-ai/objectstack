// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20355] A row-level policy that compares two fields of no shared comparison
 * class gets ONE answer on both sides of a write: the read it scopes and the
 * write its `check` judges are both refused with `INVALID_FILTER` / 400,
 * through the real plugin, the real engine and the SQL drivers.
 *
 * `record.status != record.amount` lowers to `{ status: { $ne: { $field:
 * 'amount' } } }`, a legal shape. driver-sql refuses to compile it (a
 * column-to-column comparison has one meaning only within one comparison
 * class), so the read answered 400. The write check evaluated the same filter
 * in-process against the post-image and compared the two raw values, so the
 * write was ADMITTED and stored. Both sides now read the spec's
 * `crossFieldComparisonVerdict`. Measured through this same stack on
 * better-sqlite3, sqlite-wasm and PostgreSQL 16:
 *
 * | policy | read (`using`) | by-id update / delete (`using`) | insert, `using` as the check | `check` insert | `check` by-id update |
 * |---|---|---|---|---|---|
 * | `record.status != record.amount` (text vs number) | 400 | 403 | admitted, stored → **400** | admitted, stored → **400** | admitted → **400** |
 * | `record.status != record.photo` (text vs image) | 400 | 403 | admitted, stored → **400** | admitted, stored → **400** | admitted → **400** |
 * | `record.status != record.is_open` (text vs formula) | 400 | 403 | admitted, stored → **400** | admitted, stored → **400** | admitted → **400** |
 * | `record.status != record.meta` (text vs json holding one value) | 400 | 403 | admitted, stored → **400** | admitted, stored → **400** | admitted → **400** |
 * | `record.amount > record.status` (number vs text) | 400 | 403 | 403 (`5 > 'open'` is false) → **400** | 403 → **400** | 403 → **400** |
 * | `record.status != record.title` (text vs text, the control) | rows | admitted | admitted | admitted | admitted |
 *
 * The read and the by-id update / delete columns did not move: the read is
 * driver-sql's refusal, and a by-id update or delete it scopes fails closed at
 * the pre-image gate (403) before any check runs.
 *
 * PostgreSQL runs when `OS_TEST_POSTGRES_URL` names a server (CI's live-dialect
 * job does not run this package, so there it is skipped; it was measured
 * locally on PostgreSQL 16). driver-memory's cells were measured out of tree —
 * this package cannot declare `@objectstack/driver-memory` without a
 * `driver-memory-census` disposition — and are reported on the PR: its write
 * answers as here (the check is evaluated in-process, before any driver), and
 * its read, which has no `{ $field }` arm, is unchanged.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
const PG_URL = process.env.OS_TEST_POSTGRES_URL;

type Driver = { disconnect?: () => Promise<void> };
const DRIVERS: Array<[name: string, make: () => Driver, available: boolean]> = [
  ['driver-sql (better-sqlite3)', () =>
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true],
  ['driver-sqlite-wasm', () => new SqliteWasmDriver({ filename: ':memory:' }), true],
  ['driver-sql (PostgreSQL)', () => new SqlDriver({ client: 'pg', connection: PG_URL! }), !!PG_URL],
];

const booted: Array<{ engine: ObjectQL; driver: Driver; table: string }> = [];
afterEach(async () => {
  while (booted.length) {
    const { engine, driver, table } = booted.pop()!;
    // A live server outlives the run: drop what this file created.
    const knex = (driver as { knex?: { schema: { dropTableIfExists: (t: string) => Promise<unknown> } } }).knex;
    if (PG_URL && knex && driver instanceof SqlDriver) {
      try { await knex.schema.dropTableIfExists(table); } catch { /* noop */ }
    }
    try { await engine.destroy(); } catch { /* noop */ }
  }
});

let seq = 0;
async function boot(makeDriver: () => Driver, clause: 'using' | 'check', predicate: string) {
  const OBJ = `qa_deal_20355_${process.pid}_${++seq}`;
  const driver = makeDriver();
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerApp({
    id: `com.objectstack.qa.rls-cross-class-20355-${seq}`,
    name: 'RLS cross-class field comparison',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      {
        name: OBJ,
        label: 'Deal',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          status: { name: 'status', type: 'text' },
          title: { name: 'title', type: 'text' },
          amount: { name: 'amount', type: 'number' },
          photo: { name: 'photo', type: 'image' },
          meta: { name: 'meta', type: 'json' },
          is_open: {
            name: 'is_open',
            type: 'formula',
            expression: { dialect: 'cel', source: "record.status != 'closed'" },
            returnType: 'boolean',
          },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  booted.push({ engine, driver, table: OBJ });

  const set = PermissionSetSchema.parse({
    name: 'qa_deal_guard',
    objects: { [OBJ]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    rowLevelSecurity: [{ name: 'deal_guard', object: OBJ, operation: 'all', [clause]: predicate }],
  });
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, set],
    },
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ctx = {
    logger,
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
  const stored = async () =>
    ((await engine.find(OBJ, { context: SYS_CTX } as never)) as Array<Record<string, unknown>>)
      .map((r) => ({ id: r.id, status: r.status, amount: r.amount }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const refusalLines = () =>
    logger.warn.mock.calls.map((c) => String(c[0])).filter((line) => line.includes('RLS check REFUSED'));
  return { OBJ, engine, caller, stored, refusalLines };
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
const messageOf = (p: Promise<unknown>): Promise<string> => p.then(() => '', (e: unknown) => String((e as Error)?.message));

const ROW = { id: 'r1', status: 'open', title: 'x', amount: 5 };
const NEW = { id: 'n1', status: 'open', title: 'x', amount: 5 };

interface Case {
  id: string;
  predicate: string;
  /** The two columns the refusal must name in the server log, and never on the wire. */
  columns: [string, string];
}

const REFUSED: Case[] = [
  { id: 'X1 text vs number', predicate: 'record.status != record.amount', columns: ['status', 'amount'] },
  { id: 'X2 text vs image', predicate: 'record.status != record.photo', columns: ['status', 'photo'] },
  { id: 'X3 text vs formula', predicate: 'record.status != record.is_open', columns: ['status', 'is_open'] },
  { id: 'X4 text vs json', predicate: 'record.status != record.meta', columns: ['status', 'meta'] },
  { id: 'X5 number vs text', predicate: 'record.amount > record.status', columns: ['amount', 'status'] },
];

for (const [driverName, makeDriver, available] of DRIVERS) {
  describe.skipIf(!available)(`[#20355] ${driverName}: a policy comparing two fields of no shared class is refused on read and write`, () => {
    for (const c of REFUSED) {
      it(`${c.id} \`${c.predicate}\` — using: the read 400, by-id update and delete 403, the insert it stands in as the check for 400 with nothing stored`, async () => {
        const w = await boot(makeDriver, 'using', c.predicate);
        await w.engine.insert(w.OBJ, [ROW], { context: SYS_CTX } as never);
        const before = await w.stored();

        expect(await outcome(w.engine.find(w.OBJ, { context: w.caller } as never))).toEqual(INVALID);
        expect(await outcome(w.engine.update(w.OBJ, { title: 'y' }, { where: { id: 'r1' }, context: w.caller } as never))).toEqual(DENIED);
        expect(await outcome(w.engine.delete(w.OBJ, { where: { id: 'r1' }, context: w.caller } as never))).toEqual(DENIED);
        expect(await outcome(w.engine.insert(w.OBJ, NEW, { context: w.caller } as never))).toEqual(INVALID);
        expect(await w.stored()).toEqual(before);
      });

      it(`${c.id} \`${c.predicate}\` — check: the insert and the by-id update are refused 400, nothing stored or changed`, async () => {
        const w = await boot(makeDriver, 'check', c.predicate);
        await w.engine.insert(w.OBJ, [ROW], { context: SYS_CTX } as never);
        const before = await w.stored();

        expect(await outcome(w.engine.insert(w.OBJ, NEW, { context: w.caller } as never))).toEqual(INVALID);
        expect(await outcome(w.engine.insert(w.OBJ, [{ ...NEW, id: 'n2' }], { context: w.caller } as never))).toEqual(INVALID);
        expect(await outcome(w.engine.update(w.OBJ, { amount: 6 }, { where: { id: 'r1' }, context: w.caller } as never))).toEqual(INVALID);
        expect(await w.stored()).toEqual(before);
      });

      it(`${c.id} \`${c.predicate}\` — the 400 names neither column; the server log names the policy and both`, async () => {
        const w = await boot(makeDriver, 'check', c.predicate);
        const message = await messageOf(w.engine.insert(w.OBJ, NEW, { context: w.caller } as never));
        // The remedy leads: the REST door cuts a long message's tail, never its head.
        expect(message).toMatch(/^In a row-level policy, compare a field only with a field of the same class/);
        for (const column of c.columns) expect(message).not.toContain(column);

        const lines = w.refusalLines();
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("policy 'deal_guard'");
        for (const column of c.columns) expect(lines[0]).toContain(`"${column}"`);
      });
    }

    it('the control `record.status != record.title` (text vs text) is compared on both sides: the read returns the row, the writes are admitted and stored', async () => {
      const r = await boot(makeDriver, 'using', 'record.status != record.title');
      await r.engine.insert(r.OBJ, [ROW, { ...ROW, id: 'r2', title: 'open' }], { context: SYS_CTX } as never);
      const rows = (await r.engine.find(r.OBJ, { context: r.caller } as never)) as Array<{ id: string }>;
      expect(rows.map((x) => x.id)).toEqual(['r1']);
      expect(await outcome(r.engine.insert(r.OBJ, NEW, { context: r.caller } as never))).toBe('admitted');

      const w = await boot(makeDriver, 'check', 'record.status != record.title');
      await w.engine.insert(w.OBJ, [ROW], { context: SYS_CTX } as never);
      expect(await outcome(w.engine.insert(w.OBJ, NEW, { context: w.caller } as never))).toBe('admitted');
      expect(await outcome(w.engine.update(w.OBJ, { amount: 6 }, { where: { id: 'r1' }, context: w.caller } as never))).toBe('admitted');
      expect(await outcome(w.engine.insert(w.OBJ, { ...NEW, id: 'n2', title: 'open' }, { context: w.caller } as never))).toEqual(DENIED);
      expect((await w.stored()).map((x) => x.id)).toEqual(['n1', 'r1']);
      expect(w.refusalLines()).toEqual([]);
    });
  });
}
