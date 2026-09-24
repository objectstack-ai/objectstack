// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0058 D4] A row-level `check` judges EVERY row a write stores — on an
 * ARRAY insert as on a single-row one.
 *
 * ## The guarantee
 *
 * `RowLevelSecurityPolicySchema.check` (declared, or defaulted from `using`) is
 * the write-side half of a row-level policy: a row the check refuses is never
 * stored. An ARRAY insert (`insert(object, [rows])`, which `createManyData`
 * calls) escaped it: step 3.6 of the security middleware excluded an array
 * payload, so no judgement was installed at all.
 *
 * ## What this file pins, on both SQL driver families
 *
 * - the repro, failing first: `[admitted, refused]` is refused on the ADR-0112
 *   envelope (`PERMISSION_DENIED` / 403) and NOTHING is stored;
 * - the over-fix controls: an array whose every row passes is admitted and
 *   stored; the single insert answers exactly as before;
 * - the configurations that refuse EVERY single insert refuse the array insert
 *   too (an unresolvable sole `using`, an unresolvable declared `check`).
 *
 * Ground truth is read under a system context: "the gate refused" and "nothing
 * was stored" are separate facts, and both are asserted.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const OBJECTS = [
  {
    name: 'qa_ticket',
    label: 'Ticket',
    sharingModel: 'public_read_write',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      title: { name: 'title', type: 'text' },
      status: { name: 'status', type: 'text' },
      priority: { name: 'priority', type: 'text' },
      owner: { name: 'owner', type: 'text' },
    },
  },
];

const ME = 'a@e.example';
const SOMEONE_ELSE = 'b@e.example';

/** The #19964 repro's predicate. */
const NOT_ARCHIVED = "record.status != 'archived'";
/**
 * A `current_user.*` key no resolver publishes: the compiler cannot resolve it,
 * drops the policy, and the gate falls back to the deny sentinel — so every
 * single insert under it is refused.
 */
const UNRESOLVABLE = 'record.status in current_user.no_such_membership_key';

type Policy = { name: string; operation: string; using?: string; check?: string };

function permissionSet(policies: Policy[]): PermissionSet {
  return PermissionSetSchema.parse({
    name: 'qa_writer',
    objects: { qa_ticket: { allowRead: true, allowCreate: true, allowEdit: true } },
    rowLevelSecurity: policies.map((p) => ({ object: 'qa_ticket', ...p })),
  });
}

const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const CALLER = {
  userId: 'usr_a',
  email: ME,
  positions: ['writer'],
  permissions: ['qa_writer'],
  posture: 'MEMBER',
};

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

const SEED = [
  { id: 't1', title: 'one', status: 'open', priority: 'low', owner: ME },
  { id: 't2', title: 'two', status: 'open', priority: 'high', owner: ME },
  { id: 't3', title: 'three', status: 'open', priority: 'low', owner: SOMEONE_ELSE },
];

async function boot(makeDriver: () => unknown, ps: PermissionSet): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver() as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.rls-check-multi-row-writes',
    name: 'RLS check on multi-row writes',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  engines.push(engine);
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, ps],
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
  // The expected refusals log at WARN through the engine's own logger.
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
  await engine.insert('qa_ticket', SEED.map((r) => ({ ...r })) as never, { context: SYS_CTX } as never);
  return engine;
}

const DRIVERS: Array<[string, () => unknown]> = [
  ['driver-sql (better-sqlite3 :memory:)',
    () => new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never)],
  ['driver-sqlite-wasm (:memory:)', () => new SqliteWasmDriver({ filename: ':memory:' } as never)],
];

interface Outcome { ok: boolean; code?: string; status?: number; developerMessage?: string }

const attempt = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try {
    await run();
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; statusCode?: number; status?: number; developerMessage?: string };
    return { ok: false, code: err.code, status: err.statusCode ?? err.status, developerMessage: err.developerMessage };
  }
};

/** The 3.6 gate's refusal, on the ADR-0112 envelope — never a bare throw. */
const expectCheckRefusal = (outcome: Outcome, verb: 'insert' | 'update') => {
  expect(outcome.ok, `expected a refusal, got a completed ${verb}`).toBe(false);
  expect(outcome.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
  expect(outcome.status, 'ADR-0112 HTTP status').toBe(403);
  expect(outcome.developerMessage, 'the developer half names the check gate and the verb')
    .toContain(`the ${verb} would violate a row-level CHECK`);
};

/** Every row, id → the columns under test, read past every scope. */
const stored = async (engine: ObjectQL) => {
  const rows = (await engine.find('qa_ticket', { context: SYS_CTX } as never)) as Array<Record<string, unknown>>;
  return Object.fromEntries(
    rows.map((r) => [r.id, { title: r.title, status: r.status, owner: r.owner }]),
  ) as Record<string, { title: unknown; status: unknown; owner: unknown }>;
};

for (const [driverName, makeDriver] of DRIVERS) {
  describe(`[#19964] an ARRAY insert is judged row by row — ${driverName}`, () => {
    const insertMany = (engine: ObjectQL, rows: Array<Record<string, unknown>>) =>
      engine.insert('qa_ticket', rows as never, { context: CALLER } as never);
    const insertOne = (engine: ObjectQL, row: Record<string, unknown>) =>
      engine.insert('qa_ticket', row as never, { context: CALLER } as never);

    it('the repro: `[admitted, refused]` is refused on the check envelope, and neither row is stored', async () => {
      const engine = await boot(makeDriver, permissionSet([{ name: 'not_archived', operation: 'insert', check: NOT_ARCHIVED }]));
      expectCheckRefusal(
        await attempt(() => insertMany(engine, [
          { id: 'n1', title: 'n1', status: 'closed' },
          { id: 'n2', title: 'n2', status: 'archived' },
        ])),
        'insert',
      );
      expect(Object.keys(await stored(engine)).sort()).toEqual(['t1', 't2', 't3']);
    });

    it('⭐ over-fix control: an array whose every row passes is admitted and stored', async () => {
      const engine = await boot(makeDriver, permissionSet([{ name: 'not_archived', operation: 'all', check: NOT_ARCHIVED }]));
      expect((await attempt(() => insertMany(engine, [
        { id: 'n1', title: 'n1', status: 'closed' },
        { id: 'n2', title: 'n2', status: 'open' },
      ]))).ok).toBe(true);
      const after = await stored(engine);
      expect([after.n1?.status, after.n2?.status]).toEqual(['closed', 'open']);
    });

    it('⭐ the single insert answers exactly as before', async () => {
      const engine = await boot(makeDriver, permissionSet([{ name: 'not_archived', operation: 'insert', check: NOT_ARCHIVED }]));
      expectCheckRefusal(await attempt(() => insertOne(engine, { id: 'n2', title: 'n2', status: 'archived' })), 'insert');
      expect((await attempt(() => insertOne(engine, { id: 'n1', title: 'n1', status: 'closed' }))).ok).toBe(true);
      expect(Object.keys(await stored(engine)).sort()).toEqual(['n1', 't1', 't2', 't3']);
    });

    const REFUSE_EVERY_INSERT: Array<[string, Policy]> = [
      ['an unresolvable sole `using` on `insert`', { name: 'bad_using', operation: 'insert', using: UNRESOLVABLE }],
      ['an unresolvable sole `using` on `all`', { name: 'bad_using', operation: 'all', using: UNRESOLVABLE }],
      ['an unresolvable declared `check`', { name: 'bad_check', operation: 'insert', check: UNRESOLVABLE }],
    ];
    for (const [label, policy] of REFUSE_EVERY_INSERT) {
      it(`${label}: every single insert is refused, and so is the array insert`, async () => {
        const engine = await boot(makeDriver, permissionSet([policy]));
        expectCheckRefusal(await attempt(() => insertOne(engine, { id: 'n1', title: 'n1', status: 'open' })), 'insert');
        expectCheckRefusal(
          await attempt(() => insertMany(engine, [
            { id: 'n1', title: 'n1', status: 'open' },
            { id: 'n2', title: 'n2', status: 'closed' },
          ])),
          'insert',
        );
        expect(Object.keys(await stored(engine)).sort()).toEqual(['t1', 't2', 't3']);
      });
    }
  });
}
