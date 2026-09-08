// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16608] The write `check` judges THE ROW THAT WILL BE STORED — on `insert`
 * as on `update`.
 *
 * ## What was measured, on `origin/main` @ `941232040` (already carrying
 * #16607's membership staging, PR #16722)
 *
 * The app stamps a denormalised scoping field in `beforeInsert` — an
 * organization copied from the parent, read OUTSIDE RLS under `runAs: 'system'`
 * — precisely so a caller cannot choose it. That is the shape ADR-0055 forces:
 * a predicate cannot traverse a lookup, so the field an RLS policy compares is
 * the denormalised one, and the denormalised one is what an app stamps.
 *
 * The security middleware runs BEFORE the engine's operation, so for an insert
 * its post-image was `opCtx.data` — the caller's payload as it arrived, before
 * `applyFieldDefaults` and before any hook. Both directions were measured, same
 * identity, same object, same second:
 *
 *   • the derived value is NOT on that image, so the ONLY way to pass a `check`
 *     over it was to SEND the value the hook exists to make un-sendable:
 *     payload WITH the stamped field 201, payload WITHOUT it 403, stored row
 *     identical either way;
 *   • the sent value IS on that image and is then overwritten, so an insert
 *     naming an IN-SCOPE organization while pointing at a parent in ANOTHER
 *     organization PASSED the check and stored the parent's organization — a
 *     row whose stored scope the caller does not hold. Measured here as the
 *     second cell: admitted, `employer_org` stored as `org_b` for a caller
 *     holding only `org_a`. That is a cross-organization write, and it is why
 *     this change is a NARROWING with a BREAKING banner rather than a widening.
 *
 * Ruled 2026-09-07 (maintainer, verbatim 「同意」, director seat, summon #17,
 * decision batch #3): the insert post-image becomes the hook-mutated payload.
 * ⛔ The refused alternative — keep the order and write the contract that a
 * checked field must arrive from the caller, plus an `os validate` rule — is
 * refused, not deferred: it institutionalises the contradiction and needs a
 * permanent lint to hold it in place.
 *
 * ## What this file pins
 *
 * ONE conformance cell, written once and run for BOTH verbs and BOTH driver
 * families, because "insert and update judge the same thing" is a property that
 * only means something if a single assertion holds on both sides:
 *
 *   IN scope  ⇒ admitted, and the STORED row carries the in-scope value;
 *   OUT of scope ⇒ refused on the ADR-0112 check envelope, and NOTHING moved.
 *
 * The stamped value is always the parent's, never the caller's, on every cell —
 * so a cell can only pass by judging the post-hook row. The insert arm's
 * out-of-scope cell carries an IN-scope value in the payload and differs from
 * its in-scope twin by the PARENT alone: it is admitted by the pre-hook image
 * and refused by the post-hook one, which is what makes it the ablation of this
 * whole change rather than a restatement of it.
 *
 * ⚠️ WHAT THIS FILE DOES NOT CLAIM. The two verbs still diverge on one route:
 * an UPDATE that repoints the parent so the `beforeUpdate` stamp rewrites the
 * checked field AFTER the middleware merged its pre-image is admitted, and the
 * row is stored in an organization the caller does not hold. Measured on this
 * branch, both drivers; filed as #16790, which is this card's defect one verb
 * over. It is deliberately NOT pinned here — a test asserting today's answer
 * there would advertise a guarantee the runtime does not deliver (PD #10).
 *
 * Ground truth is read straight off the driver's own table, past every scope —
 * "the check refused" and "nothing was stored" are separate facts and both are
 * asserted, because a gate that refuses AFTER the row lands is not a gate.
 *
 * The seam itself is welded by running both packages together: the plugin
 * installs `OperationContext.postHookWriteImageCheck` and the engine calls it.
 * Each package spells that member in its own file (plugin-security declares the
 * structural type locally — it depends on the engine only as a devDependency),
 * so a drift between the two spellings would leave both unit suites green and
 * the seam dead. Only a run through both catches it: here, as a silently
 * ungated insert. The fail-closed leg below pins the other half — an engine
 * that does NOT honour the seam must not have its writes vouched for.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { RLS_MEMBERSHIP_RESOLVER_SERVICE } from '@objectstack/spec/contracts';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

// ── the app, transcribed from the card ─────────────────────────────────────

/** The organization the caller holds. */
const OWN_ORG = 'org_a';
/** An organization the caller does NOT hold — the parent's, on the bypass cell. */
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
];

/** The real platform baseline, as the app runs under it. */
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

/**
 * The card's policy: `using` + `check` twins over a resolver-owned membership
 * key. The `check` names the DENORMALISED scoping field — the only shape
 * ADR-0055 leaves an author (a predicate cannot traverse `employer`).
 */
const EMPLOYER_ADMIN: PermissionSet = PermissionSetSchema.parse({
  name: 'qa_employer_admin',
  objects: {
    qa_employer: { allowRead: true, allowCreate: true, allowEdit: true },
    qa_employer_member: { allowRead: true, allowCreate: true, allowEdit: true },
  },
  rowLevelSecurity: [
    {
      name: 'employer_admin_members',
      object: 'qa_employer_member',
      operation: 'all',
      using: 'record.employer_org in current_user.employer_org_ids',
      check: 'record.employer_org in current_user.employer_org_ids',
    },
  ],
});

const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const CALLER = {
  userId: 'usr_admin_a',
  email: 'admin@a.example',
  positions: ['employer_admin'],
  permissions: ['qa_employer_admin'],
  posture: 'MEMBER',
};

// ── the stack ──────────────────────────────────────────────────────────────

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

interface Booted {
  engine: ObjectQL;
  /** Every parent id the stamp read — so "the stamp ran" is measured, not assumed. */
  stampReads: string[];
  /** The stored rows, read past every scope, straight off the driver's table. */
  stored: () => Promise<Array<Record<string, unknown>>>;
}

async function boot(makeDriver: () => unknown): Promise<Booted> {
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver() as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.insert-check-post-image-16608',
    name: 'Insert check post-image',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  // The app's stamp, on BOTH write events — the card's `runAs: 'system'` shape:
  // it reads the parent OUTSIDE RLS and overwrites the scoping field from it,
  // whatever the caller sent. This is what makes the caller's value on the
  // payload a value that never lands.
  const stampReads: string[] = [];
  const stamp = async (ctx: { input: { data: Record<string, unknown> } }) => {
    const employerId = ctx.input.data.employer;
    if (typeof employerId !== 'string' || employerId === '') return;
    stampReads.push(employerId);
    const parent = (await engine.findOne('qa_employer', {
      where: { id: employerId },
      context: SYS_CTX,
    } as never)) as Record<string, unknown> | null;
    if (parent?.employer_org != null) ctx.input.data.employer_org = parent.employer_org;
  };
  engine.on('beforeInsert', 'qa_employer_member', stamp as never);
  engine.on('beforeUpdate', 'qa_employer_member', stamp as never);

  const resolver = {
    keys: ['employer_org_ids'],
    resolve: vi.fn(async () => ({ employer_org_ids: [OWN_ORG] })),
  };
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, EMPLOYER_ADMIN],
    },
    [RLS_MEMBERSHIP_RESOLVER_SERVICE]: resolver,
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
  // The expected check refusals log at WARN through the engine's own logger.
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn')
    .mockImplementation(() => undefined);

  await engine.insert(
    'qa_employer',
    [
      { id: 'emp_a', name: 'A', employer_org: OWN_ORG },
      { id: 'emp_b', name: 'B', employer_org: OTHER_ORG },
    ],
    { context: SYS_CTX } as never,
  );

  return {
    engine,
    stampReads,
    stored: async () => {
      const driver = (engine as unknown as { getDriver(o: string): { knex: (t: string) => Promise<unknown> } })
        .getDriver('qa_employer_member');
      return (await (driver.knex as unknown as (t: string) => { select: (...c: string[]) => Promise<Array<Record<string, unknown>>> })(
        'qa_employer_member',
      ).select('id', 'employer', 'employer_org')) as Array<Record<string, unknown>>;
    },
  };
}

interface Outcome {
  ok: boolean;
  code?: string;
  status?: number;
  message?: string;
  developerMessage?: string;
}

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

/**
 * The 3.6 gate's refusal, asserted on its ADR-0112 envelope — never on a bare
 * `toThrow()`, which a driver throwing a raw `Error` would also satisfy.
 */
function expectCheckDenial(outcome: Outcome, verb: 'insert' | 'update') {
  expect(outcome.ok, `expected a refusal, got a completed ${verb}`).toBe(false);
  expect(outcome.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
  expect(outcome.status, 'ADR-0112 HTTP status').toBe(403);
  expect(outcome.message, 'the user half is the localized catalog sentence')
    .toBe(BUILTIN_OPERATION_MESSAGES.en.record_change_not_allowed);
  expect(outcome.developerMessage, 'the developer half names the gate and the verb')
    .toContain(`the ${verb} would violate a row-level CHECK`);
}

const DRIVERS: Array<[string, () => unknown]> = [
  ['driver-sql (better-sqlite3 :memory:)', () =>
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })],
  ['driver-sqlite-wasm (:memory:)', () => new SqliteWasmDriver({ filename: ':memory:' })],
];

// ── THE CONFORMANCE CELL, one proposition, both verbs, both drivers ────────

/**
 * ONE proposition — **the scoping field's LANDING decides**: it lands inside the
 * caller's scope, the write is admitted and that value is what is stored; it
 * lands outside, the write is refused and nothing moves. Written once, asserted
 * for both verbs on both drivers, because "insert and update judge the same
 * thing" is only worth saying if a single assertion holds on both sides.
 *
 * Each verb supplies only HOW to reach each landing, and the two routes differ
 * for a reason worth stating rather than hiding:
 *
 *   • INSERT reaches the out-of-scope landing through the HOOK. The payload
 *     carries an IN-scope `employer_org` and differs from the in-scope cell by
 *     the PARENT alone — so the two payloads are indistinguishable to the
 *     pre-hook image, and no green here can come from it. This is the measured
 *     bypass: admitted before this change with `org_b` stored, refused after.
 *
 *   • UPDATE reaches it through the CHANGE SET, on a write that touches no
 *     parent (so the stamp early-returns and the merged pre-image IS the
 *     landing). That is the update path's long-standing behaviour and it is
 *     what this change makes insert agree with.
 *
 * ⚠️ The route the update arm does NOT take — repointing the parent so the
 * `beforeUpdate` stamp rewrites the checked field after the merge — is the same
 * defect one verb over, and it is still open: measured on this branch as
 * ADMITTED with the row stored in an organization the caller does not hold, and
 * filed as #16790. It is deliberately not pinned here: this file asserts what
 * the runtime guarantees, and ⛔ a test that pinned today's answer there would
 * be advertising a guarantee the runtime does not deliver.
 */
interface VerbArm {
  verb: 'insert' | 'update';
  /** Puts the row in place, inside the caller's scope, before the cell runs. */
  seed: (b: Booted) => Promise<void>;
  /** A write whose scoping field LANDS inside the caller's scope. */
  landsInScope: (b: Booted) => Promise<unknown>;
  /** The same write, reaching a landing OUTSIDE the caller's scope. */
  landsOutOfScope: (b: Booted) => Promise<unknown>;
  /** The parent id the stamp must be seen to have read on the out-of-scope cell. */
  outOfScopeStampRead?: string;
}

const VERBS: VerbArm[] = [
  {
    verb: 'insert',
    seed: async () => { /* an insert needs no row in place */ },
    landsInScope: (b) =>
      b.engine.insert(
        'qa_employer_member',
        { id: 'mem_1', employer: 'emp_a', employer_org: OWN_ORG, role: 'admin' },
        { context: CALLER } as never,
      ),
    landsOutOfScope: (b) =>
      b.engine.insert(
        'qa_employer_member',
        { id: 'mem_1', employer: 'emp_b', employer_org: OWN_ORG, role: 'admin' },
        { context: CALLER } as never,
      ),
    outOfScopeStampRead: 'emp_b',
  },
  {
    verb: 'update',
    // The row starts inside the caller's scope, so the `using` pre-image gate
    // lets the caller touch it and the CHECK is the gate under test.
    seed: async (b) =>
      void (await b.engine.insert(
        'qa_employer_member',
        { id: 'mem_1', employer: 'emp_a', employer_org: OWN_ORG, role: 'admin' },
        { context: SYS_CTX } as never,
      )),
    landsInScope: (b) =>
      b.engine.update(
        'qa_employer_member',
        { id: 'mem_1', employer: 'emp_a', role: 'lead' },
        { context: CALLER } as never,
      ),
    landsOutOfScope: (b) =>
      b.engine.update(
        'qa_employer_member',
        { id: 'mem_1', employer_org: OTHER_ORG, role: 'lead' },
        { context: CALLER } as never,
      ),
  },
];

for (const [driverName, makeDriver] of DRIVERS) {
  for (const arm of VERBS) {
    describe(`[#16608] ${arm.verb} on ${driverName} — the check judges the row that will be stored`, () => {
      it('the scoping field lands IN scope — admitted, and that value is what is stored', async () => {
        const booted = await boot(makeDriver);
        await arm.seed(booted);

        const outcome = await attempt(() => arm.landsInScope(booted));

        expect(outcome.ok, `expected the ${arm.verb} to be admitted: ${outcome.developerMessage ?? outcome.message}`).toBe(true);
        // The stamp ran, and it read the parent — recorded, not assumed.
        expect(booted.stampReads).toContain('emp_a');
        const rows = await booted.stored();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.employer).toBe('emp_a');
        expect(rows[0]!.employer_org, 'the STORED scope is the parent’s, and it is in scope').toBe(OWN_ORG);
      });

      it('the scoping field lands OUT of scope — refused, and nothing moved', async () => {
        const booted = await boot(makeDriver);
        await arm.seed(booted);
        const before = await booted.stored();

        const outcome = await attempt(() => arm.landsOutOfScope(booted));

        expectCheckDenial(outcome, arm.verb);
        if (arm.outOfScopeStampRead) {
          expect(booted.stampReads, 'the stamp ran and read the out-of-scope parent').toContain(arm.outOfScopeStampRead);
        }
        // Refused AND nothing landed: two facts, both asserted. A gate that
        // refuses after the row has moved is not a gate.
        const after = await booted.stored();
        expect(after).toEqual(before);
        expect(
          after.some((r) => r.employer_org === OTHER_ORG),
          'no row may carry an organization the caller does not hold',
        ).toBe(false);
      });
    });
  }

  describe(`[#16608] ${driverName} — the caller's own value is neither required nor sufficient`, () => {
    it('a bare payload, the scoping field left entirely to the hook, is admitted (the card’s row 2)', async () => {
      const booted = await boot(makeDriver);

      const outcome = await attempt(() =>
        booted.engine.insert(
          'qa_employer_member',
          { id: 'mem_bare', employer: 'emp_a', role: 'admin' },
          { context: CALLER } as never,
        ),
      );

      expect(outcome.ok, `a caller must not have to send the value the hook exists to make un-sendable: ${outcome.developerMessage}`).toBe(true);
      const rows = await booted.stored();
      expect(rows.map((r) => r.employer_org)).toEqual([OWN_ORG]);
    });

    it('a payload duplicating the stamp with an in-scope value is still admitted (the card’s row 1 — unchanged)', async () => {
      const booted = await boot(makeDriver);

      const outcome = await attempt(() =>
        booted.engine.insert(
          'qa_employer_member',
          { id: 'mem_dup', employer: 'emp_a', employer_org: OWN_ORG, role: 'admin' },
          { context: CALLER } as never,
        ),
      );

      expect(outcome.ok).toBe(true);
      const rows = await booted.stored();
      expect(rows.map((r) => r.employer_org)).toEqual([OWN_ORG]);
    });
  });
}

// ── the fail-closed leg: a seam that never runs is not an allowed write ────

/**
 * The insert judgement is installed on the operation context and executed by
 * the engine. That seam has a failure mode the behavioural cells above cannot
 * reach, because a real engine always honours it: a HOST that executes the
 * operation itself, or an engine that does not implement the member, would
 * carry the write past a gate that never ran.
 *
 * ⛔ The wrong answer is to let it pass and log. This asserts the right one:
 * the middleware refuses, on the same ADR-0112 envelope, with a developer half
 * that says the check was not evaluated rather than that it failed — the two
 * are different facts and an operator debugging one must not be handed the
 * other.
 */
describe('[#16608] fail-closed — an engine that does not run the installed check', () => {
  it('refuses the insert instead of vouching for it', async () => {
    const middlewares: Array<(opCtx: unknown, next: () => Promise<void>) => Promise<void>> = [];
    const rows: Array<Record<string, unknown>> = [];
    const engine = {
      registerMiddleware: (mw: (opCtx: unknown, next: () => Promise<void>) => Promise<void>) => middlewares.push(mw),
      getSchema: (name: string) => OBJECTS.find((o) => o.name === name),
      async find() { return []; },
      async findOne() { return null; },
      async insert(_object: string, data: Record<string, unknown>) { rows.push({ ...data }); return data; },
      async update(_object: string, data: unknown) { return data; },
      async delete() { return true; },
    };
    const services: Record<string, unknown> = {
      manifest: { register: vi.fn() },
      objectql: engine,
      metadata: {
        get: async (_type: string, name: string) => OBJECTS.find((o) => o.name === name) ?? null,
        list: async () => [MEMBER_DEFAULT, EMPLOYER_ADMIN],
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

    const opCtx: Record<string, unknown> = {
      object: 'qa_employer_member',
      operation: 'insert',
      // An in-scope payload: it would PASS the check. The refusal below is
      // therefore about the seam never running, not about the values.
      data: { id: 'mem_x', employer: 'emp_a', employer_org: OWN_ORG },
      context: CALLER,
    };
    // The engine double never touches `opCtx.postHookWriteImageCheck`.
    const outcome = await attempt(() =>
      middlewares[0]!(opCtx, async () => {
        await engine.insert('qa_employer_member', opCtx.data as Record<string, unknown>);
      }),
    );

    expect(outcome.ok, 'an unjudged write must not be reported as an allowed one').toBe(false);
    expect(outcome.code).toBe('PERMISSION_DENIED');
    expect(outcome.status).toBe(403);
    expect(outcome.developerMessage).toContain('without the row-level CHECK being evaluated');
    expect(outcome.developerMessage).toContain('postHookWriteImageCheck');
    // The seam WAS installed — this is a host that ignored it, not a write the
    // gate declined to cover.
    expect(opCtx.postHookWriteImageCheck, 'the judgement was installed').toBeTruthy();
    expect((opCtx.postHookWriteImageCheck as { honoured?: boolean }).honoured).not.toBe(true);
    // Logged at ERROR, not WARN: this is an enforcement outage, not a denial.
    expect(ctx.logger.error).toHaveBeenCalled();
  });
});
