// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19886 stage 2d] A row-level policy whose comparison is handed something
 * other than ONE value fails closed on both clauses, through the real plugin,
 * the real engine and two SQL-family drivers.
 *
 * Each row below was measured before the fix through this same stack — on
 * driver-sql and on driver-memory — admitting and STORING the insert its
 * `check` was written to refuse, or folding to "no restriction" and reading
 * every row:
 *
 * | leak | predicate | refused where | a `check` insert now | a `using` read now |
 * |---|---|---|---|---|
 * | a | `record.status != record.tags` (`tags` json), its negated `==`, the mirror | the write-check evaluator, on the record | `INVALID_FILTER` / 400 | driver-sql's own cross-field refusal (400) |
 * | b | `!(record.status in [['closed', 'archived']])`, and a membership set with a list member | the CEL lowering | `PERMISSION_DENIED` / 403 | zero rows |
 * | c | `record.status > ['m']`, `> current_user.org_user_ids`, `current_user.org_user_ids > 'a'` | the CEL lowering | 403 | zero rows |
 * | d | `record.reviewer > current_user` | the CEL lowering | 403 | zero rows |
 * | e | `current_user.org_user_ids != 'x'` | the CEL lowering | 403 | zero rows |
 *
 * A lowering refusal makes `RLSCompiler.compileFilter` drop the policy, so with
 * nothing else applicable it answers `RLS_DENY_FILTER` — the filter the
 * analytics read-scope bridge (`getReadFilter`) hands on too. The write-check
 * refusal for (a) is judged on the post-image's VALUES, because the lowering
 * sees the predicate's text and not the object's field types.
 *
 * The controls are the one-value spellings of each, accepted and enforced.
 * Ground truth is read past every scope.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { RLS_DENY_FILTER } from './rls-compiler.js';
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
    id: 'com.objectstack.qa.rls-one-value-19886',
    name: 'RLS one-value comparand',
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
          reviewer: { name: 'reviewer', type: 'text' },
          tags: { name: 'tags', type: 'json' },
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

  const caller = {
    userId: 'usr_member',
    positions: ['qa_pos'],
    permissions: [set.name],
    posture: 'MEMBER',
    org_user_ids: ['usr_member', 'usr_peer'],
    // A membership set a host staged with a list member (the ExecutionContext
    // contract declares string members; this is the host violating it).
    rlsMembership: { nested_set: [['closed', 'archived']] },
  };
  const stored = async () =>
    ((await engine.find(OBJ, { context: SYS_CTX } as never)) as Array<{ id: string }>).map((r) => r.id).sort();
  const readFilter = () =>
    (plugin as unknown as { getReadFilter: (o: string, c: unknown) => Promise<unknown> }).getReadFilter(OBJ, caller);
  return { engine, caller, stored, readFilter };
}

type Envelope = { code: string; status: number };
const DENIED: Envelope = { code: 'PERMISSION_DENIED', status: 403 };
const INVALID: Envelope = { code: 'INVALID_FILTER', status: 400 };

interface Leak {
  leak: string;
  predicate: string;
  /** A row the policy was written to refuse, and one it was written to admit. */
  forbidden: Record<string, unknown>;
  allowed: Record<string, unknown>;
  /** What BOTH inserts now get: the policy cannot be evaluated, so nothing is admitted. */
  write: Envelope;
  /** The `using` read: zero rows, or the driver's own refusal. */
  read: 'no rows' | Envelope;
  /** Whether the lowering drops the policy — then the analytics scope is the deny sentinel. */
  dropped: boolean;
}

const LEAKS: Leak[] = [
  { leak: '(a) != a json column', predicate: 'record.status != record.tags',
    forbidden: { status: 'closed', tags: ['closed', 'archived'] }, allowed: { status: 'open', tags: ['closed'] },
    write: INVALID, read: INVALID, dropped: false },
  { leak: '(a) a negated == against a json column', predicate: '!(record.status == record.tags)',
    forbidden: { status: 'closed', tags: ['closed', 'archived'] }, allowed: { status: 'open', tags: ['closed'] },
    write: INVALID, read: INVALID, dropped: false },
  { leak: '(a) the mirror, the json column on the left', predicate: 'record.tags != record.status',
    forbidden: { status: 'closed', tags: ['closed', 'archived'] }, allowed: { status: 'open', tags: ['closed'] },
    write: INVALID, read: INVALID, dropped: false },
  { leak: '(a) != a multiple lookup', predicate: 'record.reviewer != record.watchers',
    forbidden: { reviewer: 'p1', watchers: ['p1'] }, allowed: { reviewer: 'p2', watchers: ['p1'] },
    write: INVALID, read: INVALID, dropped: false },
  { leak: '(b) not-in with a nested list', predicate: "!(record.status in [['closed', 'archived']])",
    forbidden: { status: 'closed' }, allowed: { status: 'open' },
    write: DENIED, read: 'no rows', dropped: true },
  { leak: '(b) a membership set with a list member', predicate: '!(record.status in current_user.nested_set)',
    forbidden: { status: 'closed' }, allowed: { status: 'open' },
    write: DENIED, read: 'no rows', dropped: true },
  { leak: '(c) > a list literal', predicate: "record.status > ['m']",
    forbidden: { status: 'archived' }, allowed: { status: 'open' },
    write: DENIED, read: 'no rows', dropped: true },
  { leak: '(c) a negated <= a list literal', predicate: "!(record.status <= ['m'])",
    forbidden: { status: 'archived' }, allowed: { status: 'open' },
    write: DENIED, read: 'no rows', dropped: true },
  { leak: '(c) > a membership set', predicate: 'record.status > current_user.org_user_ids',
    forbidden: { status: 'archived' }, allowed: { status: 'zzz' },
    write: DENIED, read: 'no rows', dropped: true },
  { leak: '(c) a constant ordering of a membership set', predicate: "current_user.org_user_ids > 'a'",
    forbidden: { status: 'closed' }, allowed: { status: 'open' },
    write: DENIED, read: 'no rows', dropped: true },
  { leak: '(d) > the variable root', predicate: 'record.reviewer > current_user',
    forbidden: { reviewer: 'aaa' }, allowed: { reviewer: 'zzz' },
    write: DENIED, read: 'no rows', dropped: true },
  { leak: '(e) a constant != of a membership set', predicate: "current_user.org_user_ids != 'x'",
    forbidden: { status: 'closed' }, allowed: { status: 'open' },
    write: DENIED, read: 'no rows', dropped: true },
];

const ROWS = [
  { id: 'r_closed', status: 'closed', reviewer: 'closed', tags: ['closed', 'archived'], watchers: ['p1'] },
  { id: 'r_open', status: 'open', reviewer: 'x', tags: ['closed'], watchers: ['p2'] },
  { id: 'r_archived', status: 'archived', reviewer: 'y', tags: ['z'], watchers: ['p2'] },
];

const envelopeOf = (e: unknown): Envelope => {
  const x = e as { code?: string; status?: number; statusCode?: number };
  return { code: String(x?.code), status: Number(x?.statusCode ?? x?.status) };
};

for (const [driverName, makeDriver] of DRIVERS) {
  describe(`[#19886 stage 2d] ${driverName}: a comparand that is not one value fails closed`, () => {
    for (const row of LEAKS) {
      it(`${row.leak} — \`${row.predicate}\`: both inserts refused ${row.write.code} / ${row.write.status}, nothing stored`, async () => {
        for (const rec of [row.forbidden, row.allowed]) {
          const { engine, caller, stored } = await boot(makeDriver, 'check', row.predicate);
          const err = await engine.insert(OBJ, { id: 'ins', ...rec }, { context: caller } as never)
            .then(() => null, (e: unknown) => e);
          expect(err, 'expected the insert to be refused, but it was admitted').not.toBeNull();
          expect(envelopeOf(err)).toEqual(row.write);
          expect(await stored()).toEqual([]);
        }
      });

      it(`${row.leak} — \`${row.predicate}\`: the using read ${row.read === 'no rows' ? 'returns no rows' : `is refused ${row.read.code} / ${row.read.status}`}`, async () => {
        const { engine, caller, stored, readFilter } = await boot(makeDriver, 'using', row.predicate);
        await engine.insert(OBJ, ROWS, { context: SYS_CTX } as never);

        const read = await engine.find(OBJ, { context: caller } as never).then(
          (rows) => ({ rows: (rows as Array<{ id: string }>).map((r) => r.id) }),
          (e: unknown) => ({ error: envelopeOf(e) }),
        );
        if (row.read === 'no rows') expect(read).toEqual({ rows: [] });
        else expect(read).toEqual({ error: row.read });
        // The analytics read-scope bridge is handed the same compiled filter.
        if (row.dropped) expect(await readFilter()).toEqual(RLS_DENY_FILTER);
        expect(await stored()).toEqual(['r_archived', 'r_closed', 'r_open']);
      });
    }
  });

  describe(`[#19886 stage 2d] ${driverName}: the one-value spellings are accepted and enforced`, () => {
    const CONTROLS: Array<[string, Record<string, unknown>, Record<string, unknown>, string[]]> = [
      ['record.status != record.reviewer', { status: 'closed', reviewer: 'closed' }, { status: 'open', reviewer: 'closed' }, ['r_archived', 'r_open']],
      ["!(record.status in ['closed', 'archived'])", { status: 'closed' }, { status: 'open' }, ['r_open']],
      ["record.status > 'm'", { status: 'archived' }, { status: 'open' }, ['r_open']],
      ["!(record.status in current_user.org_user_ids) && record.status > 'm'", { status: 'archived' }, { status: 'open' }, ['r_open']],
    ];
    for (const [predicate, forbidden, allowed, visible] of CONTROLS) {
      it(`\`${predicate}\`: refuses the forbidden insert (403), stores the allowed one, reads ${JSON.stringify(visible)}`, async () => {
        const w1 = await boot(makeDriver, 'check', predicate);
        const err = await w1.engine.insert(OBJ, { id: 'ins_bad', ...forbidden }, { context: w1.caller } as never)
          .then(() => null, (e: unknown) => e);
        expect(envelopeOf(err)).toEqual(DENIED);
        expect(await w1.stored()).toEqual([]);

        const w2 = await boot(makeDriver, 'check', predicate);
        await w2.engine.insert(OBJ, { id: 'ins_ok', ...allowed }, { context: w2.caller } as never);
        expect(await w2.stored()).toEqual(['ins_ok']);

        const r = await boot(makeDriver, 'using', predicate);
        await r.engine.insert(OBJ, ROWS, { context: SYS_CTX } as never);
        const rows = (await r.engine.find(OBJ, { context: r.caller } as never)) as Array<{ id: string }>;
        expect(rows.map((x) => x.id).sort()).toEqual(visible);
      });
    }
  });
}
