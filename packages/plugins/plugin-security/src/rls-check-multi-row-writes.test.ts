// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0058 D4] A row-level `check` judges EVERY row a write stores — on the
 * multi-row write shapes as on the single-row ones.
 *
 * ## The guarantee
 *
 * `RowLevelSecurityPolicySchema.check` (declared, or defaulted from `using`) is
 * the write-side half of a row-level policy: a row the check refuses is never
 * stored. ADR-0058 D4 publishes it "on the write pre-image path that already
 * exists for by-id writes … and on the AST-injected bulk path". PostgreSQL's
 * `WITH CHECK` holds the same line: every new row version, bulk or not.
 *
 * Two multi-row shapes escaped it, both at step 3.6 of the security middleware,
 * which assumed one row per write:
 *
 * - a bulk UPDATE (`update(object, changes, { where, multi: true })`) took the
 *   "no single id" branch, which skipped the post-image check on the
 *   assumption that a `using`-scoped `where` governed it. Nothing scopes the
 *   `where` for a policy that declares only `check`, and nothing ever judged the
 *   NEW row for any policy;
 * - an ARRAY insert (`insert(object, [rows])`, which `createManyData` calls)
 *   was excluded by a non-array guard, so no judgement was installed at all.
 *
 * ## What this file pins, on both SQL driver families
 *
 * - each repro, failing first: the multi-row write is refused on the ADR-0112
 *   envelope (`PERMISSION_DENIED` / 403) and NOTHING is stored or moved;
 * - per ROW, not per change set: a bulk update is judged on each matched row
 *   merged with the change set, so a row whose UNCHANGED field fails the check
 *   refuses the whole write — a change-set-only judgement would admit it;
 * - the over-fix controls: a multi-row write whose every row passes is admitted
 *   and stored; a `using`-scoped bulk update still touches only its rows; the
 *   by-id update and the single insert answer exactly as before;
 * - the configurations that refuse EVERY single insert refuse the array insert
 *   too (an unresolvable sole `using`, an unresolvable declared `check`);
 * - fail-closed: a bulk update is judged by the engine, over the rows the
 *   composed AST selects, so a host that never runs the installed judgement
 *   is refused rather than vouched for; and a falsy payload `id`, which the
 *   engine does not read as a row address, cannot route a bulk update around
 *   it.
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

/** The #19950 repro's predicate. */
const NOT_CLOSED = "record.status != 'closed'";
/** The #19964 repro's predicate. */
const NOT_ARCHIVED = "record.status != 'archived'";
/**
 * A predicate over a field the bulk change set does NOT carry: a high-priority
 * ticket may not be closed. Judged on the change set alone (`{ status }`), the
 * missing `priority` makes the right arm vacuously true and the write passes;
 * judged on each matched row merged with the change set, the high-priority row
 * fails. That difference is what makes the per-row cell below a pin.
 */
const HIGH_STAYS_OPEN = "record.status != 'closed' || record.priority != 'high'";
const OWN_ROWS = 'record.owner == current_user.email';
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

const bulkUpdate = (engine: ObjectQL, changes: Record<string, unknown>, where: Record<string, unknown>) =>
  engine.update('qa_ticket', changes as never, { where, multi: true, context: CALLER } as never);

/** Every row, id → the columns under test, read past every scope. */
const stored = async (engine: ObjectQL) => {
  const rows = (await engine.find('qa_ticket', { context: SYS_CTX } as never)) as Array<Record<string, unknown>>;
  return Object.fromEntries(
    rows.map((r) => [r.id, { title: r.title, status: r.status, owner: r.owner }]),
  ) as Record<string, { title: unknown; status: unknown; owner: unknown }>;
};

const SEEDED = Object.fromEntries(SEED.map((r) => [r.id, { title: r.title, status: r.status, owner: r.owner }]));

for (const [driverName, makeDriver] of DRIVERS) {
  describe(`[#19950] a bulk UPDATE is judged row by row — ${driverName}`, () => {
    it('the repro: a check-only policy refuses a `multi` update that stores a row its check refuses, and nothing moves', async () => {
      const engine = await boot(makeDriver, permissionSet([{ name: 'not_closed', operation: 'update', check: NOT_CLOSED }]));
      expectCheckRefusal(await attempt(() => bulkUpdate(engine, { status: 'closed' }, { status: 'open' })), 'update');
      expect(await stored(engine)).toEqual(SEEDED);
    });

    it('per row, not per change set: one matched row failing on an UNCHANGED field refuses the whole write', async () => {
      const engine = await boot(makeDriver, permissionSet([{ name: 'high_stays_open', operation: 'update', check: HIGH_STAYS_OPEN }]));
      // t1 (low) would pass; t2 (high) fails on the merged image only.
      expectCheckRefusal(await attempt(() => bulkUpdate(engine, { status: 'closed' }, { owner: ME })), 'update');
      expect(await stored(engine)).toEqual(SEEDED);
    });

    it('⭐ over-fix control: a `multi` update whose every new row passes is admitted, and exactly its rows move', async () => {
      const engine = await boot(makeDriver, permissionSet([{ name: 'high_stays_open', operation: 'update', check: HIGH_STAYS_OPEN }]));
      expect((await attempt(() => bulkUpdate(engine, { status: 'closed' }, { priority: 'low' }))).ok).toBe(true);
      const after = await stored(engine);
      expect(after.t1.status).toBe('closed');
      expect(after.t2.status).toBe('open');
      expect(after.t3.status).toBe('closed');
    });

    it('a declared `check` that differs from `using` is judged on the bulk path too', async () => {
      const engine = await boot(makeDriver, permissionSet([
        { name: 'own_not_closed', operation: 'update', using: OWN_ROWS, check: NOT_CLOSED },
      ]));
      expectCheckRefusal(await attempt(() => bulkUpdate(engine, { status: 'closed' }, {})), 'update');
      expect(await stored(engine)).toEqual(SEEDED);
    });

    it('fail-closed: a host that never runs the installed check does not have its bulk update vouched for', async () => {
      const engine = await boot(makeDriver, permissionSet([{ name: 'not_closed', operation: 'update', check: NOT_CLOSED }]));
      // A middleware INSIDE the security one takes the installed judgement off
      // the operation before the engine sees it — the shape of a host that
      // executes the write without the seam. The payload would PASS the check,
      // so a refusal here is about the check not running, not about values.
      let seen: { honoured?: boolean } | undefined;
      engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
        if (opCtx.operation === 'update' && opCtx.postHookWriteImageCheck) {
          seen = opCtx.postHookWriteImageCheck;
          delete opCtx.postHookWriteImageCheck;
        }
        await next();
      });
      const outcome = await attempt(() => bulkUpdate(engine, { title: 'renamed' }, { status: 'open' }));
      expect(outcome.ok, 'an unjudged bulk write must not be reported as an allowed one').toBe(false);
      expect(outcome.code).toBe('PERMISSION_DENIED');
      expect(outcome.status).toBe(403);
      expect(outcome.developerMessage).toContain(
        "the update on 'qa_ticket' was executed without the row-level CHECK being evaluated",
      );
      expect(seen, 'the judgement was installed for the predicate update').toBeTruthy();
      expect(seen?.honoured).not.toBe(true);
    });

    it('a falsy payload `id` does not route a bulk update around the per-row judgement', async () => {
      const engine = await boot(makeDriver, permissionSet([{ name: 'high_stays_open', operation: 'update', check: HIGH_STAYS_OPEN }]));
      const outcome = await attempt(() => bulkUpdate(engine, { id: '', status: 'closed' }, { owner: ME }));
      expect(outcome.ok, 'a falsy id is not a row address; the write is a bulk update and is judged per row').toBe(false);
      expect(outcome.code).toBe('PERMISSION_DENIED');
      expect(outcome.status).toBe(403);
      expect(await stored(engine)).toEqual(SEEDED);
    });
  });

  describe(`[#19950] controls — a using-declared policy and the by-id path — ${driverName}`, () => {
    it('⭐ a USING-only policy: an in-scope bulk update is admitted and still touches only the rows its `using` selects', async () => {
      const engine = await boot(makeDriver, permissionSet([{ name: 'own_rows', operation: 'update', using: OWN_ROWS }]));
      expect((await attempt(() => bulkUpdate(engine, { title: 'renamed' }, {}))).ok).toBe(true);
      const after = await stored(engine);
      expect(after.t1.title).toBe('renamed');
      expect(after.t2.title).toBe('renamed');
      expect(after.t3.title, 'a row outside the using is not touched').toBe('three');
    });

    it('⭐ a declared `check` with a `using`: an in-scope bulk update whose new rows pass is admitted', async () => {
      const engine = await boot(makeDriver, permissionSet([
        { name: 'own_not_closed', operation: 'update', using: OWN_ROWS, check: NOT_CLOSED },
      ]));
      expect((await attempt(() => bulkUpdate(engine, { title: 'renamed' }, {}))).ok).toBe(true);
      const after = await stored(engine);
      expect([after.t1.title, after.t2.title, after.t3.title]).toEqual(['renamed', 'renamed', 'three']);
    });

    it('a USING-only policy: moving rows OUT of the `using` is refused — the defaulted check, the answer the by-id path gives', async () => {
      const engine = await boot(makeDriver, permissionSet([{ name: 'own_rows', operation: 'update', using: OWN_ROWS }]));
      expectCheckRefusal(await attempt(() => bulkUpdate(engine, { owner: SOMEONE_ELSE }, {})), 'update');
      expect(await stored(engine)).toEqual(SEEDED);
      // The by-id twin of the same write, unchanged: refused on the same envelope.
      expectCheckRefusal(
        await attempt(() => engine.update('qa_ticket', { id: 't1', owner: SOMEONE_ELSE } as never, { context: CALLER } as never)),
        'update',
      );
      expect(await stored(engine)).toEqual(SEEDED);
    });

    it('⭐ the by-id update under a check-only policy answers exactly as before: refused out of check, admitted in it', async () => {
      const engine = await boot(makeDriver, permissionSet([{ name: 'not_closed', operation: 'update', check: NOT_CLOSED }]));
      expectCheckRefusal(
        await attempt(() => engine.update('qa_ticket', { id: 't1', status: 'closed' } as never, { context: CALLER } as never)),
        'update',
      );
      expect((await stored(engine)).t1.status).toBe('open');
      expect(
        (await attempt(() => engine.update('qa_ticket', { id: 't1', title: 'renamed' } as never, { context: CALLER } as never))).ok,
      ).toBe(true);
      expect((await stored(engine)).t1.title).toBe('renamed');
    });
  });

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
