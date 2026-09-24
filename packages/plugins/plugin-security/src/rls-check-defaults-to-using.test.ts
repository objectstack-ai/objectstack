// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0058 D4] A policy that declares no `check` holds the write post-image to
 * its `using`, which is what `RowLevelSecurityPolicySchema.check` publishes:
 * "defaults to USING clause if not specified". It is also PostgreSQL's rule for
 * a policy without `WITH CHECK`.
 *
 * ## What was measured before the change
 *
 * On driver-sql, through the real `SecurityPlugin` and engine, a policy carrying
 * only `using: "record.status != 'closed'"` did not stop an INSERT of
 * `status = 'closed'`. The row was admitted and stored, and it was a row the
 * caller could then not read. The write gate compiled only the policies that
 * declared `check`, so with none declared it compiled nothing.
 *
 * ## What this file pins, on both SQL driver families
 *
 * - the repro: the USING-only policy refuses the INSERT of a row outside it,
 *   on the ADR-0112 envelope, and stores nothing; it admits a row inside it;
 * - the UPDATE new row: the same policy refuses an update that moves the row
 *   outside it, and the stored row does not move;
 * - a tenant-style USING-only policy refuses an INSERT that names another
 *   organization. The Layer 0 wall is not armed in this harness (no
 *   organizations plugin), so the refusal can only come from the defaulted
 *   check;
 * - the control: a policy that declares `check` is judged on its `check`, not
 *   on its `using`, exactly as before;
 * - the composition: when any applicable policy declares `check`, a USING-only
 *   sibling adds nothing to the check (see `writeCheckPolicies` in
 *   `security-plugin.ts` for why the narrower reading was taken).
 *
 * Ground truth is read off the table under a system context: "the gate
 * refused" and "nothing was stored" are separate facts, and both are asserted.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const OWN_ORG = 'org_a';
const OTHER_ORG = 'org_b';

const OBJECTS = [
  {
    name: 'qa_ticket',
    label: 'Ticket',
    sharingModel: 'public_read_write',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      title: { name: 'title', type: 'text' },
      status: { name: 'status', type: 'text' },
      organization_id: { name: 'organization_id', type: 'text' },
    },
  },
  // An object whose OWD says nothing about writes, so `member_default`'s
  // ownership floor (`owner_only_writes`, `created_by == current_user.id`,
  // positions `org_member`) applies to an `org_member` caller.
  {
    name: 'qa_deal',
    label: 'Deal',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      stage: { name: 'stage', type: 'text' },
      created_by: { name: 'created_by', type: 'text' },
    },
  },
];

/** The repro's predicate, verbatim. */
const NOT_CLOSED = "record.status != 'closed'";
/** A tenant-isolation predicate, the shape the triage names. */
const OWN_TENANT = 'organization_id == current_user.organization_id';

type Policy = { name: string; operation: string; using?: string; check?: string };

function permissionSet(policies: Array<Policy & { object?: string }>): PermissionSet {
  return PermissionSetSchema.parse({
    name: 'qa_writer',
    objects: {
      qa_ticket: { allowRead: true, allowCreate: true, allowEdit: true },
      qa_deal: { allowRead: true, allowCreate: true, allowEdit: true },
    },
    rowLevelSecurity: policies.map((p) => ({ object: 'qa_ticket', ...p })),
  });
}

const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const CALLER = {
  userId: 'usr_a',
  email: 'a@e.example',
  tenantId: OWN_ORG,
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

async function boot(makeDriver: () => unknown, ps: PermissionSet): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver() as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.rls-check-defaults-to-using',
    name: 'RLS check defaults to using',
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
  return engine;
}

const DRIVERS: Array<[string, () => unknown]> = [
  ['driver-sql (better-sqlite3 :memory:)',
    () => new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never)],
  ['driver-sqlite-wasm (:memory:)', () => new SqliteWasmDriver({ filename: ':memory:' } as never)],
];

interface Outcome { ok: boolean; code?: string; status?: number }

const attempt = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try {
    await run();
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; statusCode?: number; status?: number };
    return { ok: false, code: err.code, status: err.statusCode ?? err.status };
  }
};

/** ⚠️ A SINGLE object, never an array: step 3.6 skips a bulk payload. */
const insert = (engine: ObjectQL, row: Record<string, unknown>) =>
  engine.insert('qa_ticket', { id: 't1', title: 't', ...row } as never, { context: CALLER } as never);

const storedRow = async (engine: ObjectQL, id = 't1') => {
  const rows = (await engine.find('qa_ticket', { where: { id }, context: SYS_CTX } as never)) as Array<
    Record<string, unknown>
  >;
  return rows[0];
};

const expectCheckRefusal = (outcome: Outcome) => {
  // The ADR-0112 envelope, never a bare throw: a driver raising a raw `Error`
  // would satisfy `toThrow()` and prove nothing.
  expect(outcome.ok).toBe(false);
  expect(outcome.code).toBe('PERMISSION_DENIED');
  expect(outcome.status).toBe(403);
};

for (const [driverName, makeDriver] of DRIVERS) {
  describe(`a USING-only policy gates INSERT — ${driverName}`, () => {
    const usingOnly = () => permissionSet([{ name: 'not_closed', operation: 'all', using: NOT_CLOSED }]);

    it("the repro: status 'closed' is refused on the check envelope, and nothing is stored", async () => {
      const engine = await boot(makeDriver, usingOnly());
      expectCheckRefusal(await attempt(() => insert(engine, { status: 'closed' })));
      expect(await storedRow(engine)).toBeUndefined();
    });

    it("⭐ status 'open' is admitted and stored — the over-fix control", async () => {
      const engine = await boot(makeDriver, usingOnly());
      expect((await attempt(() => insert(engine, { status: 'open' }))).ok).toBe(true);
      expect((await storedRow(engine))?.status).toBe('open');
    });

    it('an insert-class USING-only policy gates INSERT the same way', async () => {
      const engine = await boot(
        makeDriver,
        permissionSet([{ name: 'not_closed_insert', operation: 'insert', using: NOT_CLOSED }]),
      );
      expectCheckRefusal(await attempt(() => insert(engine, { status: 'closed' })));
      expect(await storedRow(engine)).toBeUndefined();
    });
  });

  describe(`a USING-only policy gates the UPDATE new row — ${driverName}`, () => {
    const seedOpen = (engine: ObjectQL) =>
      engine.insert('qa_ticket', { id: 't1', title: 't', status: 'open' } as never, { context: SYS_CTX } as never);

    it("moving an in-scope row to 'closed' is refused, and the stored row does not move", async () => {
      const engine = await boot(
        makeDriver,
        permissionSet([{ name: 'not_closed_update', operation: 'update', using: NOT_CLOSED }]),
      );
      await seedOpen(engine);
      expectCheckRefusal(
        await attempt(() => engine.update('qa_ticket', { id: 't1', status: 'closed' } as never, { context: CALLER } as never)),
      );
      expect((await storedRow(engine))?.status).toBe('open');
    });

    it("⭐ an update that stays in scope is admitted — the over-fix control", async () => {
      const engine = await boot(
        makeDriver,
        permissionSet([{ name: 'not_closed_update', operation: 'update', using: NOT_CLOSED }]),
      );
      await seedOpen(engine);
      const outcome = await attempt(() =>
        engine.update('qa_ticket', { id: 't1', status: 'pending' } as never, { context: CALLER } as never),
      );
      expect(outcome.ok).toBe(true);
      expect((await storedRow(engine))?.status).toBe('pending');
    });
  });

  describe(`a tenant-style USING-only policy refuses a cross-organization INSERT — ${driverName}`, () => {
    const tenantOnly = () => permissionSet([{ name: 'own_tenant', operation: 'all', using: OWN_TENANT }]);

    it('an insert naming another organization is refused, and nothing is stored', async () => {
      const engine = await boot(makeDriver, tenantOnly());
      expectCheckRefusal(await attempt(() => insert(engine, { status: 'open', organization_id: OTHER_ORG })));
      expect(await storedRow(engine)).toBeUndefined();
    });

    it("⭐ an insert naming the caller's own organization is admitted", async () => {
      const engine = await boot(makeDriver, tenantOnly());
      expect((await attempt(() => insert(engine, { status: 'open', organization_id: OWN_ORG }))).ok).toBe(true);
      expect((await storedRow(engine))?.organization_id).toBe(OWN_ORG);
    });
  });

  describe(`a declared check is judged exactly as before — ${driverName}`, () => {
    it('the policy is held to its check, not its using', async () => {
      const engine = await boot(
        makeDriver,
        permissionSet([
          { name: 'declared', operation: 'all', using: NOT_CLOSED, check: "record.status != 'archived'" },
        ]),
      );
      // Outside `using`, inside `check`: admitted — `check` is the write rule.
      expect((await attempt(() => insert(engine, { status: 'closed' }))).ok).toBe(true);
      expect((await storedRow(engine))?.status).toBe('closed');
      // Outside `check`: refused.
      expectCheckRefusal(
        await attempt(() =>
          engine.insert('qa_ticket', { id: 't2', title: 't', status: 'archived' } as never, { context: CALLER } as never),
        ),
      );
      expect(await storedRow(engine, 't2')).toBeUndefined();
    });

    it('a USING-only sibling adds nothing to a declared check (the composition)', async () => {
      const engine = await boot(
        makeDriver,
        permissionSet([
          { name: 'declared', operation: 'insert', check: "record.status != 'archived'" },
          { name: 'using_only', operation: 'insert', using: NOT_CLOSED },
        ]),
      );
      // The declared check alone decides: 'closed' passes it, so it is admitted
      // even though it is outside the sibling's `using` — today's answer.
      expect((await attempt(() => insert(engine, { status: 'closed' }))).ok).toBe(true);
      // …and the sibling's `using` does not widen it: 'archived' is inside the
      // sibling's `using` and outside the declared check, and it is refused.
      expectCheckRefusal(
        await attempt(() =>
          engine.insert('qa_ticket', { id: 't2', title: 't', status: 'archived' } as never, { context: CALLER } as never),
        ),
      );
      expect(await storedRow(engine, 't2')).toBeUndefined();
    });
  });

  describe(`a USING-only update widener composes with the ownership floor — ${driverName}`, () => {
    // "Anyone may update a deal still open" — an app-authored widener, OR-ed at
    // the pre-image with the platform floor `created_by == current_user.id`.
    // The defaulted check is that same OR on the new row.
    const widener = () =>
      permissionSet([{ name: 'open_deals', object: 'qa_deal', operation: 'update', using: "stage == 'open'" }]);
    const MEMBER = { ...CALLER, positions: ['writer', 'org_member'] };
    const seed = (engine: ObjectQL, id: string, stage: string, createdBy: string) =>
      engine.insert('qa_deal', { id, stage, created_by: createdBy } as never, { context: SYS_CTX } as never);
    const dealStage = async (engine: ObjectQL, id: string) =>
      ((await engine.find('qa_deal', { where: { id }, context: SYS_CTX } as never)) as Array<Record<string, unknown>>)[0]
        ?.stage;

    it("⭐ the creator still updates their own deal out of 'open' — the floor stays in the check", async () => {
      const engine = await boot(makeDriver, widener());
      await seed(engine, 'd_mine', 'open', MEMBER.userId);
      const outcome = await attempt(() =>
        engine.update('qa_deal', { id: 'd_mine', stage: 'won' } as never, { context: MEMBER } as never),
      );
      expect(outcome.ok).toBe(true);
      expect(await dealStage(engine, 'd_mine')).toBe('won');
    });

    it("a non-creator admitted only by the widener cannot move the deal out of 'open'", async () => {
      const engine = await boot(makeDriver, widener());
      await seed(engine, 'd_theirs', 'open', 'usr_other');
      expectCheckRefusal(
        await attempt(() =>
          engine.update('qa_deal', { id: 'd_theirs', stage: 'won' } as never, { context: MEMBER } as never),
        ),
      );
      expect(await dealStage(engine, 'd_theirs')).toBe('open');
    });
  });
}
