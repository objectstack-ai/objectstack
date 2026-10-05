// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21319] `security.explain` answers what enforcement answers for a row-level
 * policy that aims an operator the read refuses at a column the object
 * declares JSON-stored: the request is REFUSED, with the find's own envelope
 * (`INVALID_FILTER` / 400), and no verdict is reported.
 *
 * A multi-valued field (`tags`, a `select` or `lookup` flagged `multiple`) and
 * a structured-JSON type (`json`) are stored as JSON. driver-sql refuses
 * `@objectstack/core`'s `JSON_COLUMN_INCOMPATIBLE_OPERATORS`, and implicit
 * equality, on such a column, so the caller's find answers `INVALID_FILTER` /
 * 400 whatever the rows; a by-id update or delete fails closed at its
 * row-level gate (403), whose pre-image re-read is that refused read; and the
 * RLS write check refuses an insert with the read's 400 (#21254). The explain
 * engine's record matcher evaluated the operators in JS instead. Measured on
 * this stack before the fix, on both SQLite families:
 *
 * | `using` | stored | find | by-id update / delete | explain, every operation |
 * |---|---|---|---|---|
 * | `record.tags != 'x'` | `['y']` | 400 | 403 | `visible: true`, `decidedBy: 'rls'` |
 * | `record.meta == 'x'` | `'x'` | 400 | 403 | `visible: true`, `decidedBy: 'rls'` |
 * | `!(record.tags in ['x'])` | `['y']` | 400 | 403 | `visible: true`, `decidedBy: 'rls'` |
 * | `record.owners != 'x'` (`select`, `multiple`) | `['y']` | 400 | 403 | `visible: true`, `decidedBy: 'rls'` |
 * | `record.refs != 'x'` (`lookup`, `multiple`) | `['y']` | 400 | 403 | `visible: true`, `decidedBy: 'rls'` |
 *
 * The object-level report (no `recordId`) said `allowed: true` with `rls`
 * `narrows`, and a record id no row carries was reported `visible: false`.
 * `POST /api/v1/security/explain` relayed the same 200.
 *
 * The explain engine now judges each row filter by the rule the write check
 * applies (`findJsonColumnCheckRefusal`, imported, so the operator set is
 * core's and is copied nowhere), before the matcher reads a record, and
 * answers with the refusal: the shape it gives a cross-class comparison
 * (`explain-cross-class-refusal.test.ts`), a thrown envelope with no decision.
 * Its `cause` is the read's refusal: core's message, which the find answers
 * byte for byte. Its message is core's diagnostic, naming the field and the
 * operator, then the policy that carries them.
 *
 * Every refused cell asserts both halves: explain's answer, and the real
 * request through the real `SecurityPlugin`, `ObjectQL` and SQL driver. The
 * controls are the operators that still answer on such a column (the
 * membership pair and presence) and a column declared neither way, which keep
 * their row verdict on both sides.
 *
 * PostgreSQL runs when `OS_TEST_POSTGRES_URL` names a server (CI does not run
 * this package against a live server, so there it is skipped).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { jsonColumnOperatorRefusalText } from '@objectstack/core';
import { truncateClientMessage } from '@objectstack/types';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { ExplainDecision } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
const PG_URL = process.env.OS_TEST_POSTGRES_URL;
const POLICY = 'tag_guard';

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

type ExplainOp = 'read' | 'create' | 'update' | 'delete';

let seq = 0;
/** One engine and plugin, with the policies `predicates` names, each scoping every operation. */
async function boot(makeDriver: () => Driver, predicates: Record<string, string>) {
  const OBJ = `qa_deal_21319_${process.pid}_${++seq}`;
  const driver = makeDriver();
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerApp({
    id: `com.objectstack.qa.explain-json-column-21319-${seq}`,
    name: 'Explain: RLS operator on a JSON-stored column',
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
          title: { name: 'title', type: 'text' },
          tags: { name: 'tags', type: 'tags' },
          owners: {
            name: 'owners',
            type: 'select',
            multiple: true,
            options: [{ label: 'X', value: 'x' }, { label: 'Y', value: 'y' }],
          },
          refs: { name: 'refs', type: 'lookup', reference: OBJ, multiple: true },
          meta: { name: 'meta', type: 'json' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  booted.push({ engine, driver, table: OBJ });

  const set = PermissionSetSchema.parse({
    name: 'qa_tag_guard',
    objects: { [OBJ]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    rowLevelSecurity: Object.entries(predicates).map(([name, using]) => ({ name, object: OBJ, operation: 'all', using })),
  });
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, set],
    },
  };
  const registerService = vi.fn();
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  /** The registered `security` service: what `POST /api/v1/security/explain` dispatches to. */
  const security = registerService.mock.calls.find((c) => c[0] === 'security')?.[1] as {
    explain: (request: Record<string, unknown>, callerContext: unknown) => Promise<ExplainDecision>;
  };
  expect(security?.explain, 'the security service is registered with explain').toBeTypeOf('function');

  const caller = { userId: 'usr_member', positions: ['qa_pos'], permissions: [set.name], posture: 'MEMBER' };
  /** The caller's own access, for one record or (no id) for the object. */
  const explain = (operation: ExplainOp, recordId?: string): Promise<ExplainDecision> =>
    security.explain({ object: OBJ, operation, ...(recordId ? { recordId } : {}) }, caller);
  /** The caller's own request for the one record, through the real middleware and driver. */
  const request = (operation: ExplainOp, recordId: string): Promise<unknown> =>
    operation === 'read'
      ? engine.find(OBJ, { where: { id: recordId }, context: caller } as never)
      : operation === 'create'
        ? engine.insert(OBJ, { id: recordId, title: 'n' }, { context: caller } as never)
        : operation === 'update'
          ? engine.update(OBJ, { title: 'z' }, { where: { id: recordId }, context: caller } as never)
          : engine.delete(OBJ, { where: { id: recordId }, context: caller } as never);
  const visibleIds = async (): Promise<string[]> =>
    ((await engine.find(OBJ, { context: caller } as never)) as Array<{ id: string }>).map((r) => r.id).sort();
  const stored = async () =>
    ((await engine.find(OBJ, { context: SYS_CTX } as never)) as Array<Record<string, unknown>>)
      .map((r) => ({ id: r.id, title: r.title }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { OBJ, engine, explain, request, visibleIds, stored };
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
const thrown = (p: Promise<unknown>): Promise<unknown> =>
  p.then(() => 'answered' as const, (e: unknown) => e);

/** What enforcement answers the caller's own request with, per operation. */
const ENFORCED: Record<ExplainOp, Envelope> = { read: INVALID, create: INVALID, update: DENIED, delete: DENIED };

type Refused = [field: string, op: string, bare: boolean];

/**
 * Explain's answer is the read's refusal: the find's envelope, no decision and
 * so no verdict; core's diagnostic first, which names the field and the
 * operator and holds the remedy, then the policy; and, as its `cause`, the
 * read's own refusal, whose message is the find's byte for byte.
 */
async function expectExplainRefuses(p: Promise<unknown>, refused: Refused, findMessage: string, policies = [POLICY]) {
  const e = await thrown(p);
  expect(e, 'explain answered a decision').not.toBe('answered');
  expect(envelopeOf(e)).toEqual(INVALID);
  const words = jsonColumnOperatorRefusalText(...refused);
  const message = String((e as Error).message);
  expect(message.startsWith(`${words.diagnostic} `), message).toBe(true);
  for (const policy of policies) expect(message).toContain(`'${policy}'`);
  // The REST door keeps a 4xx message's head: the diagnostic, remedy included, survives its bound.
  expect(truncateClientMessage(message).startsWith(words.diagnostic)).toBe(true);
  const cause = (e as { cause?: unknown }).cause;
  expect(envelopeOf(cause)).toEqual(INVALID);
  expect((cause as Error).message).toBe(words.message);
  expect((cause as Error).message).toBe(findMessage);
}

interface Case {
  id: string;
  predicate: string;
  /** The stored row: a list on a multi-valued column, a scalar on the `json` one. */
  row: Record<string, unknown>;
  refused: Refused;
}

/** The card's three rows (J1–J3), then a `select` and a `lookup` flagged `multiple`. */
const REFUSED: Case[] = [
  { id: 'J1 multi-valued !=', predicate: "record.tags != 'x'", row: { tags: ['y'] }, refused: ['tags', '$ne', false] },
  { id: 'J2 json ==', predicate: "record.meta == 'x'", row: { meta: 'x' }, refused: ['meta', '=', true] },
  { id: 'J3 negated in', predicate: "!(record.tags in ['x'])", row: { tags: ['y'] }, refused: ['tags', '$in', false] },
  { id: 'J4 select multiple !=', predicate: "record.owners != 'x'", row: { owners: ['y'] }, refused: ['owners', '$ne', false] },
  { id: 'J5 lookup multiple !=', predicate: "record.refs != 'x'", row: { refs: ['y'] }, refused: ['refs', '$ne', false] },
];

interface Control {
  id: string;
  predicate: string;
  rows: Array<Record<string, unknown>>;
  /** The rows the caller's find returns under the policy. */
  visible: string[];
}

const CONTROLS: Control[] = [
  {
    id: 'membership `contains`',
    predicate: "record.tags.contains('x')",
    rows: [{ id: 'r1', tags: ['x'] }, { id: 'r2', tags: ['y'] }],
    visible: ['r1'],
  },
  {
    id: 'membership `!contains`',
    predicate: "!record.tags.contains('x')",
    rows: [{ id: 'r1', tags: ['x'] }, { id: 'r2', tags: ['y'] }],
    visible: ['r2'],
  },
  {
    id: 'presence `!= null`',
    predicate: 'record.tags != null',
    rows: [{ id: 'r1', tags: ['x'] }, { id: 'r2', tags: null }],
    visible: ['r1'],
  },
  {
    id: 'a column declared neither way, `!=`',
    predicate: "record.title != 'x'",
    rows: [{ id: 'r1', title: 'y' }, { id: 'r2', title: 'x' }],
    visible: ['r1'],
  },
];

for (const [driverName, makeDriver, available] of DRIVERS) {
  describe.skipIf(!available)(`[#21319] ${driverName}: explain reports the refusal enforcement gives an operator the read refuses on a JSON-stored column`, () => {
    for (const c of REFUSED) {
      it(`${c.id} \`${c.predicate}\` — every operation: enforcement refuses, explain answers the read's INVALID_FILTER / 400 and no verdict`, async () => {
        const w = await boot(makeDriver, { [POLICY]: c.predicate });
        await w.engine.insert(w.OBJ, [{ id: 'r1', title: 't', ...c.row }], { context: SYS_CTX } as never);
        const before = await w.stored();
        const findError = await thrown(w.request('read', 'r1'));
        const findMessage = String((findError as Error)?.message);

        for (const op of ['read', 'create', 'update', 'delete'] as const) {
          const id = op === 'create' ? 'r_new' : 'r1';
          expect(await outcome(w.request(op, id)), `${op}: enforcement`).toEqual(ENFORCED[op]);
          await expectExplainRefuses(w.explain(op, id), c.refused, findMessage);
        }
        // The object-level report, and a record id no row carries: the find refuses both, whatever the rows.
        await expectExplainRefuses(w.explain('read'), c.refused, findMessage);
        expect(await outcome(w.request('read', 'r_absent'))).toEqual(INVALID);
        await expectExplainRefuses(w.explain('read', 'r_absent'), c.refused, findMessage);
        expect(await w.stored()).toEqual(before);
      });
    }

    it('two policies, one refusing: explain names only the one that carries the refused operator, and the find refuses both', async () => {
      const w = await boot(makeDriver, { [POLICY]: "record.tags != 'x'", title_guard: "record.title == 't'" });
      await w.engine.insert(w.OBJ, [{ id: 'r1', title: 't', tags: ['y'] }], { context: SYS_CTX } as never);
      const findError = await thrown(w.request('read', 'r1'));
      expect(envelopeOf(findError)).toEqual(INVALID);
      for (const p of [w.explain('read', 'r1'), w.explain('read')]) {
        const e = await thrown(p);
        await expectExplainRefuses(Promise.reject(e), ['tags', '$ne', false], String((findError as Error).message));
        expect(String((e as Error).message)).not.toContain("'title_guard'");
      }
    });

    for (const c of CONTROLS) {
      it(`control — ${c.id} \`${c.predicate}\` keeps its row verdict on both sides`, async () => {
        const w = await boot(makeDriver, { [POLICY]: c.predicate });
        await w.engine.insert(w.OBJ, c.rows.map((r) => ({ title: 't', ...r })), { context: SYS_CTX } as never);
        expect(await w.visibleIds()).toEqual(c.visible);

        const object = await w.explain('read');
        expect(object.allowed).toBe(true);
        expect(object.readFilter).toBeTruthy();
        for (const { id } of c.rows as Array<{ id: string }>) {
          const visible = c.visible.includes(id);
          expect((await w.explain('read', id)).record, `read ${id}`).toEqual({ recordId: id, visible, decidedBy: 'rls' });
          // [#21771] A row the caller cannot read answers, on the write side,
          // what a nonexistent id answers: the missing-record shape.
          expect((await w.explain('update', id)).record, `update ${id}`)
            .toEqual(visible ? { recordId: id, visible, decidedBy: 'rls' } : { recordId: id, visible: false });
        }
      });
    }
  });
}
