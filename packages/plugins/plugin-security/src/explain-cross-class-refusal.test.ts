// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20431] `security.explain` answers what enforcement answers for a row-level
 * policy that compares two fields of no shared comparison class: the request
 * is REFUSED, with the find's own envelope (`INVALID_FILTER` / 400), and no
 * record verdict is reported.
 *
 * `record.status != record.amount` lowers to `{ status: { $ne: { $field:
 * 'amount' } } }`. driver-sql refuses to compile a column-to-column comparison
 * across comparison classes, so the caller's find answers `INVALID_FILTER` /
 * 400, and a by-id update or delete fails closed at its row-level gate (403),
 * whose pre-image re-read is that same refused read (#20355's table). The
 * explain engine's record matcher was handed no declared columns, so it
 * compared the two raw values. Measured on this stack before the fix:
 *
 * | policy | find | by-id update / delete | explain read / update / delete, `record` |
 * |---|---|---|---|
 * | `record.status != record.amount` | 400 | 403 | `visible: true`, `decidedBy: 'rls'`, rls `admitted` |
 * | `record.amount > record.status` | 400 | 403 | `visible: false`, `decidedBy: 'rls'`, rls `excluded` |
 * | `record.status != record.title` (control) | the row | admitted | `visible: true`, `decidedBy: 'rls'` |
 *
 * The matcher is now handed the object's declared columns (the write check's
 * `options.fields`, #20355), refuses the comparison, and explain answers with
 * that refusal: the envelope the find answers with, the message naming the
 * policy and both columns. That is the answer explain already gives the
 * matcher's other `INVALID_FILTER` refusals, a `{ $field }` comparison against
 * a list-holding column among them (`rls-stored-list-ordering-fails-closed.test.ts`).
 *
 * Every refused cell asserts both halves: explain's answer, and the real
 * request through the real `SecurityPlugin`, `ObjectQL` and SQL driver. A
 * future fork between the two turns a cell here red. The control, a same-class
 * comparison, keeps its row verdict on both sides.
 *
 * PostgreSQL runs when `OS_TEST_POSTGRES_URL` names a server (CI does not run
 * this package against a live server, so there it is skipped).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { ExplainDecision } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
const PG_URL = process.env.OS_TEST_POSTGRES_URL;
const POLICY = 'deal_guard';

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

type ExplainOp = 'read' | 'update' | 'delete';

let seq = 0;
async function boot(makeDriver: () => Driver, predicate: string) {
  const OBJ = `qa_deal_20431_${process.pid}_${++seq}`;
  const driver = makeDriver();
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerApp({
    id: `com.objectstack.qa.explain-cross-class-20431-${seq}`,
    name: 'Explain: RLS cross-class field comparison',
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
    rowLevelSecurity: [{ name: POLICY, object: OBJ, operation: 'all', using: predicate }],
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
  /** The service method `POST /api/v1/security/explain` calls, for the caller's own access. */
  const explain = (operation: ExplainOp, recordId: string): Promise<ExplainDecision> =>
    plugin.explainAccessForCaller({ object: OBJ, operation, recordId }, caller);
  /** The caller's own request for the one record, through the real middleware and driver. */
  const request = (operation: ExplainOp, recordId: string): Promise<unknown> =>
    operation === 'read'
      ? engine.find(OBJ, { where: { id: recordId }, context: caller } as never)
      : operation === 'update'
        ? engine.update(OBJ, { title: 'y' }, { where: { id: recordId }, context: caller } as never)
        : engine.delete(OBJ, { where: { id: recordId }, context: caller } as never);
  const stored = async () =>
    ((await engine.find(OBJ, { context: SYS_CTX } as never)) as Array<Record<string, unknown>>)
      .map((r) => ({ id: r.id, status: r.status, title: r.title, amount: r.amount }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { OBJ, engine, caller, explain, request, stored };
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
/** A refusal's envelope and message, or `'answered'` for an explanation that came back. */
const refusalOf = (p: Promise<unknown>): Promise<'answered' | (Envelope & { message: string })> =>
  p.then(
    () => 'answered' as const,
    (e: unknown) => ({ ...envelopeOf(e), message: String((e as Error)?.message) }),
  );

/** What enforcement answers the caller's own request with, per operation. */
const ENFORCED: Record<ExplainOp, Envelope> = { read: INVALID, update: DENIED, delete: DENIED };

const ROW = { id: 'r1', status: 'open', title: 'x', amount: 5 };

const rlsRecordOf = (d: ExplainDecision) => d.layers.find((l) => l.layer === 'rls')?.record;

/**
 * The remedy explain's refusal leads with. It comes before the policy names and
 * the diagnostic, which have no length bound, because the REST door keeps only
 * a long message's first 499 characters.
 */
const REMEDY =
  'Compare a field only with a field of the same class, or fix the declaration of the one that is declared with ' +
  'the wrong type.';

/**
 * Explain's answer is the find's refusal: the same envelope, no decision and so
 * no record verdict, and a message that leads with the remedy and names the
 * policy and both columns.
 */
async function expectExplainRefuses(p: Promise<unknown>, columns: [string, string]): Promise<void> {
  const r = await refusalOf(p);
  expect(r).not.toBe('answered');
  if (r === 'answered') return;
  expect({ code: r.code, status: r.status }).toEqual(INVALID);
  expect(r.message.startsWith(`${REMEDY} `), r.message).toBe(true);
  expect(r.message).toContain(`'${POLICY}'`);
  for (const column of columns) expect(r.message).toContain(`"${column}"`);
}

interface Case {
  id: string;
  predicate: string;
  /** The two columns of the refused comparison. */
  columns: [string, string];
}

/** X1 and X5 are the two orderings of one pair; X2–X4 are the no-class columns. */
const REFUSED: Case[] = [
  { id: 'X1 text vs number', predicate: 'record.status != record.amount', columns: ['status', 'amount'] },
  { id: 'X2 text vs image', predicate: 'record.status != record.photo', columns: ['status', 'photo'] },
  { id: 'X3 text vs formula', predicate: 'record.status != record.is_open', columns: ['status', 'is_open'] },
  { id: 'X4 text vs json', predicate: 'record.status != record.meta', columns: ['status', 'meta'] },
  { id: 'X5 number vs text', predicate: 'record.amount > record.status', columns: ['amount', 'status'] },
];

for (const [driverName, makeDriver, available] of DRIVERS) {
  describe.skipIf(!available)(`[#20431] ${driverName}: explain reports the refusal enforcement gives a cross-class field comparison`, () => {
    for (const c of REFUSED) {
      it(`${c.id} \`${c.predicate}\` — read, update and delete: enforcement refuses, explain answers INVALID_FILTER / 400 and no row verdict`, async () => {
        const w = await boot(makeDriver, c.predicate);
        await w.engine.insert(w.OBJ, [ROW], { context: SYS_CTX } as never);
        const before = await w.stored();

        for (const op of ['read', 'update', 'delete'] as const) {
          expect(await outcome(w.request(op, 'r1')), `${op}: enforcement`).toEqual(ENFORCED[op]);
          await expectExplainRefuses(w.explain(op, 'r1'), c.columns);
        }
        expect(await w.stored()).toEqual(before);
      });
    }

    it('the two orderings of one pair (`status != amount`, `amount > status`) get one answer from explain, as from the find', async () => {
      const answers: unknown[] = [];
      for (const predicate of ['record.status != record.amount', 'record.amount > record.status']) {
        const w = await boot(makeDriver, predicate);
        await w.engine.insert(w.OBJ, [ROW], { context: SYS_CTX } as never);
        answers.push({
          find: await outcome(w.request('read', 'r1')),
          explain: await outcome(w.explain('read', 'r1')),
        });
      }
      expect(answers[0]).toEqual({ find: INVALID, explain: INVALID });
      expect(answers[1]).toEqual(answers[0]);
    });

    it('the control `record.status != record.title` (text vs text) keeps its row verdict on both sides', async () => {
      const w = await boot(makeDriver, 'record.status != record.title');
      await w.engine.insert(w.OBJ, [ROW, { ...ROW, id: 'r2', title: 'open' }], { context: SYS_CTX } as never);

      const rows = (await w.engine.find(w.OBJ, { context: w.caller } as never)) as Array<{ id: string }>;
      expect(rows.map((x) => x.id)).toEqual(['r1']);

      const admitted = await w.explain('read', 'r1');
      expect(admitted.record).toEqual({ recordId: 'r1', visible: true, decidedBy: 'rls' });
      expect(rlsRecordOf(admitted)).toMatchObject({ outcome: 'admitted', matchesRecord: true });

      const excluded = await w.explain('read', 'r2');
      expect(excluded.record).toEqual({ recordId: 'r2', visible: false, decidedBy: 'rls' });
      expect(rlsRecordOf(excluded)).toMatchObject({ outcome: 'excluded', matchesRecord: false });

      expect(await outcome(w.request('update', 'r1'))).toBe('admitted');
      expect((await w.explain('update', 'r1')).record).toEqual({ recordId: 'r1', visible: true, decidedBy: 'rls' });
      expect(await outcome(w.request('update', 'r2'))).toEqual(DENIED);
      expect((await w.explain('update', 'r2')).record).toEqual({ recordId: 'r2', visible: false, decidedBy: 'rls' });
    });
  });
}
