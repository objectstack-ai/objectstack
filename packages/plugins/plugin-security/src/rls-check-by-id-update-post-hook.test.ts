// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19989] A by-id UPDATE's row-level `check` holds for the row that is STORED,
 * after the `beforeUpdate` chain — as the insert and the predicate update
 * already do.
 *
 * ## The guarantee
 *
 * `RowLevelSecurityPolicySchema.check` (declared, or defaulted from `using`)
 * is the write-side half of a row-level policy: a row the check refuses is
 * never stored. ADR-0058 D4 enforces it on the by-id write path and on the
 * bulk path. The insert judges the row the `beforeInsert` chain produced, and
 * the predicate update judges each matched row merged with the FINAL payload,
 * both through `OperationContext.postHookWriteImageCheck`, run by the engine.
 *
 * The by-id update was judged only inside the security middleware, on the
 * caller's pre-image merged with the change set AS SENT, before `next()` runs
 * the `beforeUpdate` chain. A hook that rewrote a checked field after that
 * point was never judged, so the row it produced was stored unjudged.
 *
 * ## What this file pins, on both SQL driver families
 *
 * - each reproduced shape, failing first: the by-id update is refused on the
 *   ADR-0112 envelope (`PERMISSION_DENIED` / 403), and the stored row, read
 *   under a system context, did not move;
 * - the controls: an in-scope by-id update is admitted and stored; a hook
 *   that touches no checked field changes nothing; the judgement the
 *   middleware already made on the change set as sent still refuses (the fix
 *   only ever refuses MORE); the predicate update gives the same answer as
 *   its by-id twin;
 * - fail-closed: a host that never runs the installed judgement on a by-id
 *   update is refused rather than vouched for;
 * - one row address: a FALSY payload id beside a truthy `where.id` makes the
 *   engine write the `where.id` row while the middleware judged the payload
 *   id. That write used to reach the store and be refused only afterwards;
 *   it is now refused before anything is stored.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { RLS_MEMBERSHIP_RESOLVER_SERVICE } from '@objectstack/spec/contracts';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

/** The organization the caller holds. */
const OWN_ORG = 'org_a';
/** An organization the caller does NOT hold. */
const OTHER_ORG = 'org_b';

const OBJECTS = [
  {
    name: 'qa_employer',
    label: 'Employer',
    sharingModel: 'public_read_write',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      name: { name: 'name', type: 'text' },
      employer_org: { name: 'employer_org', type: 'text' },
    },
  },
  {
    name: 'qa_employer_member',
    label: 'Employer member',
    sharingModel: 'public_read_write',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      employer: { name: 'employer', type: 'lookup', reference: 'qa_employer' },
      employer_org: { name: 'employer_org', type: 'text' },
      role: { name: 'role', type: 'text' },
    },
  },
  {
    name: 'qa_ticket',
    label: 'Ticket',
    sharingModel: 'public_read_write',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      title: { name: 'title', type: 'text' },
      status: { name: 'status', type: 'text' },
      priority: { name: 'priority', type: 'text' },
    },
  },
];

const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

/**
 * Two policies, one per shape:
 * - the organization shape: `using` + `check` twins over a resolver-owned
 *   membership key, naming the DENORMALISED scoping field an app stamps from
 *   the parent (ADR-0055: a predicate cannot traverse the lookup);
 * - the plain shape: a check-only policy over a field a hook derives.
 */
const WRITER: PermissionSet = PermissionSetSchema.parse({
  name: 'qa_writer',
  objects: {
    qa_employer: { allowRead: true, allowCreate: true, allowEdit: true },
    qa_employer_member: { allowRead: true, allowCreate: true, allowEdit: true },
    qa_ticket: { allowRead: true, allowCreate: true, allowEdit: true },
  },
  rowLevelSecurity: [
    {
      name: 'members_in_my_orgs',
      object: 'qa_employer_member',
      operation: 'all',
      using: 'record.employer_org in current_user.employer_org_ids',
      check: 'record.employer_org in current_user.employer_org_ids',
    },
    {
      name: 'tickets_not_closed',
      object: 'qa_ticket',
      operation: 'update',
      check: "record.status != 'closed'",
    },
  ],
});

const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const CALLER = {
  userId: 'usr_a',
  email: 'a@e.example',
  positions: ['writer'],
  permissions: ['qa_writer'],
  posture: 'MEMBER',
};

/** The phrase the plain-shape hook reads: a ticket so titled is closed by the app. */
const CLOSING_TITLE = 'wrap up';

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

interface Booted {
  engine: ObjectQL;
  /** Every parent id the stamp read, so "the stamp ran" is measured. */
  stampReads: string[];
  /** Every ticket id the closing hook rewrote, so "the hook ran" is measured. */
  closings: unknown[];
  /** A table's rows read straight off the driver, past every scope. */
  table: (name: string, columns: string[]) => Promise<Array<Record<string, unknown>>>;
}

async function boot(makeDriver: () => unknown): Promise<Booted> {
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver() as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.rls-check-by-id-update-post-hook',
    name: 'RLS check on a by-id update, after beforeUpdate',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  // The organization shape's stamp: it reads the parent OUTSIDE RLS and
  // overwrites the scoping field from it, whatever the caller sent.
  const stampReads: string[] = [];
  engine.on('beforeUpdate', 'qa_employer_member', (async (ctx: { input: { data: Record<string, unknown> } }) => {
    const employerId = ctx.input.data.employer;
    if (typeof employerId !== 'string' || employerId === '') return;
    stampReads.push(employerId);
    const parent = (await engine.findOne('qa_employer', {
      where: { id: employerId },
      context: SYS_CTX,
    } as never)) as Record<string, unknown> | null;
    if (parent?.employer_org != null) ctx.input.data.employer_org = parent.employer_org;
  }) as never);

  // The plain shape's hook: it derives a checked field from another one.
  const closings: unknown[] = [];
  engine.on('beforeUpdate', 'qa_ticket', (async (ctx: { input: { id?: unknown; data: Record<string, unknown> } }) => {
    if (ctx.input.data.title !== CLOSING_TITLE) return;
    closings.push(ctx.input.id ?? null);
    ctx.input.data.status = 'closed';
  }) as never);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, WRITER],
    },
    [RLS_MEMBERSHIP_RESOLVER_SERVICE]: {
      keys: ['employer_org_ids'],
      resolve: vi.fn(async () => ({ employer_org_ids: [OWN_ORG] })),
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

  await engine.insert(
    'qa_employer',
    [
      { id: 'emp_a', name: 'A', employer_org: OWN_ORG },
      { id: 'emp_b', name: 'B', employer_org: OTHER_ORG },
    ],
    { context: SYS_CTX } as never,
  );
  await engine.insert(
    'qa_employer_member',
    { id: 'mem_1', employer: 'emp_a', employer_org: OWN_ORG, role: 'admin' },
    { context: SYS_CTX } as never,
  );
  await engine.insert(
    'qa_ticket',
    [
      { id: 't1', title: 'one', status: 'open', priority: 'low' },
      { id: 't2', title: 'two', status: 'open', priority: 'low' },
    ],
    { context: SYS_CTX } as never,
  );

  const table = async (name: string, columns: string[]) => {
    const driver = (engine as unknown as { getDriver(o: string): { knex: unknown } }).getDriver(name);
    const knex = driver.knex as (t: string) => { select: (...c: string[]) => Promise<Array<Record<string, unknown>>> };
    const rows = await knex(name).select(...columns);
    return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };

  return { engine, stampReads, closings, table };
}

const DRIVERS: Array<[string, () => unknown]> = [
  ['driver-sql (better-sqlite3 :memory:)', () =>
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never)],
  ['driver-sqlite-wasm (:memory:)', () => new SqliteWasmDriver({ filename: ':memory:' } as never)],
];

interface Outcome { ok: boolean; code?: string; status?: number; message?: string; developerMessage?: string }

const attempt = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try {
    await run();
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; statusCode?: number; status?: number; message?: string; developerMessage?: string };
    return {
      ok: false,
      code: err.code,
      status: err.statusCode ?? err.status,
      message: String(err.message ?? e),
      developerMessage: err.developerMessage,
    };
  }
};

/** The 3.6 gate's refusal, on the ADR-0112 envelope, never a bare throw. */
const expectCheckRefusal = (outcome: Outcome) => {
  expect(outcome.ok, 'expected a refusal, got a completed update').toBe(false);
  expect(outcome.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
  expect(outcome.status, 'ADR-0112 HTTP status').toBe(403);
  expect(outcome.developerMessage, 'the developer half names the check gate and the verb')
    .toContain('the update would violate a row-level CHECK');
};

const byId = (b: Booted, object: string, data: Record<string, unknown>) =>
  b.engine.update(object, data as never, { context: CALLER } as never);

const MEMBER_COLUMNS = ['id', 'employer', 'employer_org', 'role'];
const TICKET_COLUMNS = ['id', 'title', 'status', 'priority'];
const SEEDED_MEMBER = [{ id: 'mem_1', employer: 'emp_a', employer_org: OWN_ORG, role: 'admin' }];
const SEEDED_TICKETS = [
  { id: 't1', title: 'one', status: 'open', priority: 'low' },
  { id: 't2', title: 'two', status: 'open', priority: 'low' },
];

for (const [driverName, makeDriver] of DRIVERS) {
  describe(`[#19989] a by-id UPDATE is judged on the row the beforeUpdate chain produced — ${driverName}`, () => {
    it('the organization shape: re-pointing the parent so the stamp lands an organization the caller does not hold is refused, and nothing moves', async () => {
      const b = await boot(makeDriver);

      const outcome = await attempt(() => byId(b, 'qa_employer_member', { id: 'mem_1', employer: 'emp_b' }));

      expectCheckRefusal(outcome);
      expect(b.stampReads, 'the stamp ran and read the re-pointed parent').toContain('emp_b');
      const rows = await b.table('qa_employer_member', MEMBER_COLUMNS);
      expect(rows).toEqual(SEEDED_MEMBER);
      expect(rows.some((r) => r.employer_org === OTHER_ORG), 'no row may carry an organization the caller does not hold')
        .toBe(false);
    });

    it('the plain shape: a hook that rewrites a checked field to a value the check refuses is refused, and nothing moves', async () => {
      const b = await boot(makeDriver);

      const outcome = await attempt(() => byId(b, 'qa_ticket', { id: 't1', title: CLOSING_TITLE }));

      expectCheckRefusal(outcome);
      expect(b.closings, 'the hook ran and rewrote the checked field').toEqual(['t1']);
      expect(await b.table('qa_ticket', TICKET_COLUMNS)).toEqual(SEEDED_TICKETS);
    });
  });

  describe(`[#19989] controls — ${driverName}`, () => {
    it('⭐ an in-scope by-id update is admitted, and the stored row is the one the stamp produced', async () => {
      const b = await boot(makeDriver);

      const outcome = await attempt(() => byId(b, 'qa_employer_member', { id: 'mem_1', employer: 'emp_a', role: 'lead' }));

      expect(outcome.ok, `expected the update to be admitted: ${outcome.developerMessage ?? outcome.message}`).toBe(true);
      expect(b.stampReads).toContain('emp_a');
      expect(await b.table('qa_employer_member', MEMBER_COLUMNS))
        .toEqual([{ id: 'mem_1', employer: 'emp_a', employer_org: OWN_ORG, role: 'lead' }]);
    });

    it('⭐ a hook that touches no checked field changes nothing: the update is admitted and stored', async () => {
      const b = await boot(makeDriver);

      const outcome = await attempt(() => byId(b, 'qa_ticket', { id: 't1', title: 'renamed', priority: 'high' }));

      expect(outcome.ok, `expected the update to be admitted: ${outcome.developerMessage ?? outcome.message}`).toBe(true);
      expect(b.closings, 'the hook did not fire its rewrite').toEqual([]);
      expect((await b.table('qa_ticket', TICKET_COLUMNS))[0])
        .toEqual({ id: 't1', title: 'renamed', status: 'open', priority: 'high' });
    });

    it('the judgement on the change set AS SENT still refuses, as before', async () => {
      const b = await boot(makeDriver);

      expectCheckRefusal(await attempt(() => byId(b, 'qa_ticket', { id: 't1', status: 'closed' })));
      expect(await b.table('qa_ticket', TICKET_COLUMNS)).toEqual(SEEDED_TICKETS);
    });

    it('only refuses MORE: a caller value the check refuses stays refused even when the stamp would have replaced it with an in-scope one', async () => {
      const b = await boot(makeDriver);

      // The stamp lands `org_a` (emp_a's), which the check admits; the change
      // set as sent carries `org_b`, which it refuses. The existing judgement
      // on the change set as sent keeps refusing it.
      expectCheckRefusal(await attempt(() =>
        byId(b, 'qa_employer_member', { id: 'mem_1', employer: 'emp_a', employer_org: OTHER_ORG })));
      expect(await b.table('qa_employer_member', MEMBER_COLUMNS)).toEqual(SEEDED_MEMBER);
    });

    it('⭐ the predicate update gives its by-id twin’s answer: the same hook-closed row is refused, and an unrelated rename is admitted', async () => {
      const b = await boot(makeDriver);
      const bulk = (changes: Record<string, unknown>) =>
        b.engine.update('qa_ticket', changes as never, { where: { priority: 'low' }, multi: true, context: CALLER } as never);

      expectCheckRefusal(await attempt(() => bulk({ title: CLOSING_TITLE })));
      expect(await b.table('qa_ticket', TICKET_COLUMNS)).toEqual(SEEDED_TICKETS);

      expect((await attempt(() => bulk({ title: 'renamed' }))).ok).toBe(true);
      expect((await b.table('qa_ticket', TICKET_COLUMNS)).map((r) => r.title)).toEqual(['renamed', 'renamed']);
    });
  });

  describe(`[#19989] fail-closed — ${driverName}`, () => {
    it('a host that never runs the installed check does not have its by-id update vouched for', async () => {
      const b = await boot(makeDriver);
      // A middleware INSIDE the security one takes the installed judgement off
      // the operation before the engine sees it: the shape of a host that
      // executes the write without the seam. The payload would PASS the check,
      // so a refusal here is about the check not running, not about values.
      let seen: { honoured?: boolean } | undefined;
      b.engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
        if (opCtx.operation === 'update' && opCtx.postHookWriteImageCheck) {
          seen = opCtx.postHookWriteImageCheck;
          delete opCtx.postHookWriteImageCheck;
        }
        await next();
      });

      const outcome = await attempt(() => byId(b, 'qa_ticket', { id: 't1', title: 'renamed' }));

      expect(outcome.ok, 'an unjudged by-id write must not be reported as an allowed one').toBe(false);
      expect(outcome.code).toBe('PERMISSION_DENIED');
      expect(outcome.status).toBe(403);
      expect(outcome.developerMessage).toContain(
        "the update on 'qa_ticket' was executed without the row-level CHECK being evaluated",
      );
      expect(seen, 'the judgement was installed for the by-id update').toBeTruthy();
      expect(seen?.honoured).not.toBe(true);
    });
  });

  describe(`[#19989] one row address — ${driverName}`, () => {
    // The engine reads a falsy payload id as no row address and writes the row
    // a truthy `where.id` names; the middleware's by-id gates read the payload
    // id. Measured before this change: refused with the "executed without the
    // row-level CHECK" 403 AFTER the driver had stored the row.
    const FALSY_IDS: Array<[string, unknown]> = [["''", ''], ['0', 0]];
    for (const [label, falsyId] of FALSY_IDS) {
      it(`a payload id of ${label} beside a truthy where.id is refused before anything is stored`, async () => {
        const b = await boot(makeDriver);

        const outcome = await attempt(() =>
          b.engine.update('qa_ticket', { id: falsyId, title: 'renamed' } as never, { where: { id: 't1' }, context: CALLER } as never));

        expect(outcome.ok, 'the row the gate judged is not the row the engine writes').toBe(false);
        expect(outcome.code).toBe('PERMISSION_DENIED');
        expect(outcome.status).toBe(403);
        expect(outcome.developerMessage).toContain('the row this gate judged is not the row that would be stored');
        expect(await b.table('qa_ticket', TICKET_COLUMNS), 'refused BEFORE the store, so nothing moved').toEqual(SEEDED_TICKETS);
      });
    }

    it('⭐ control: a falsy payload id with NO where.id is still a predicate update, judged per matched row', async () => {
      const b = await boot(makeDriver);

      const outcome = await attempt(() =>
        b.engine.update('qa_ticket', { id: '', title: 'renamed' } as never, { where: { priority: 'low' }, multi: true, context: CALLER } as never));

      expect(outcome.ok, `expected the predicate update to be admitted: ${outcome.developerMessage ?? outcome.message}`).toBe(true);
      expect((await b.table('qa_ticket', TICKET_COLUMNS)).map((r) => r.title)).toEqual(['renamed', 'renamed']);
    });
  });
}
