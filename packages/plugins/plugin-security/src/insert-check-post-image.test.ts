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
import {
  assertEngineDeleteDispatch,
  assertEngineUpdateDispatch,
  assertEngineFindOnePredicate,
  type EngineFindOneQueryInput,
  type EngineUpdateDispatchData,
  type EngineUpdateDispatchInput,
  type EngineDeleteDispatchInput,
} from '@objectstack/metadata-core';
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
  // ── the contract review's F1 subject ────────────────────────────────────
  //
  // The SAME object, except that the checked scoping field is declared static
  // `readonly` — which is not an exotic decoration but the natural shape for a
  // column the server stamps and a caller may not choose. That is the whole
  // point of the field: ADR-0055 forces the predicate onto the denormalised
  // column, and `readonly: true` is how an author says "not yours to send".
  //
  // It is also what turns `engine.insert`'s static-`readonly` strip into a
  // second writer of the checked field, AFTER the middleware has had its say.
  {
    name: 'qa_ro_member',
    label: 'Employer member, readonly scope',
    sharingModel: 'public_read_write',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      employer: { name: 'employer', type: 'lookup', reference: 'qa_employer' },
      employer_org: { name: 'employer_org', type: 'text', readonly: true },
      role: { name: 'role', type: 'text' },
    },
  },
  // The same again, with a `defaultValue` the caller does NOT hold — the strip's
  // re-default (#3043's contract: every key this pass takes is re-derived) then
  // puts a FOREIGN organization on the row rather than leaving it empty.
  {
    name: 'qa_ro_member_default',
    label: 'Employer member, readonly scope with a foreign default',
    sharingModel: 'public_read_write',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      employer: { name: 'employer', type: 'lookup', reference: 'qa_employer' },
      employer_org: { name: 'employer_org', type: 'text', readonly: true, defaultValue: OTHER_ORG },
      role: { name: 'role', type: 'text' },
    },
  },
  // F4 (i): governed by a policy whose `check` cannot be compiled.
  {
    name: 'qa_unevaluable_member',
    label: 'Employer member, unevaluable check',
    sharingModel: 'public_read_write',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      employer: { name: 'employer', type: 'lookup', reference: 'qa_employer' },
      employer_org: { name: 'employer_org', type: 'text' },
      role: { name: 'role', type: 'text' },
    },
  },
  // F4 (ii): the two producers a refusal must not pay for — a sequence number
  // and a `sys_secret` row.
  {
    name: 'qa_cost_member',
    label: 'Employer member, with an autonumber and a secret',
    sharingModel: 'public_read_write',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      employer: { name: 'employer', type: 'lookup', reference: 'qa_employer' },
      employer_org: { name: 'employer_org', type: 'text' },
      code: { name: 'code', type: 'autonumber', autonumberFormat: 'C-{0000}', format: 'C-{0000}' },
      token: { name: 'token', type: 'secret' },
    },
  },
  // The contract review's F1 reorder moves both strips ahead of the credential
  // channel. These two columns are where that is OBSERVABLE rather than argued:
  // an author-declared `readonly` on a credential field.
  {
    name: 'qa_ro_cred',
    label: 'Readonly credential columns',
    sharingModel: 'public_read_write',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      name: { name: 'name', type: 'text' },
      token: { name: 'token', type: 'secret', readonly: true },
      pw: { name: 'pw', type: 'password', readonly: true },
    },
  },
  // The secret store the credential channel writes into, declared here so
  // `syncSchemas()` creates a real table for it and "no secret was minted" can
  // be READ rather than inferred.
  {
    name: 'sys_secret',
    label: 'Secret',
    sharingModel: 'public_read_write',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      namespace: { name: 'namespace', type: 'text' },
      key: { name: 'key', type: 'text' },
      kms_key_id: { name: 'kms_key_id', type: 'text' },
      alg: { name: 'alg', type: 'text' },
      version: { name: 'version', type: 'number' },
      ciphertext: { name: 'ciphertext', type: 'text' },
      created_at: { name: 'created_at', type: 'datetime' },
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
    qa_ro_member: { allowRead: true, allowCreate: true, allowEdit: true },
    qa_ro_member_default: { allowRead: true, allowCreate: true, allowEdit: true },
    qa_unevaluable_member: { allowRead: true, allowCreate: true, allowEdit: true },
    qa_cost_member: { allowRead: true, allowCreate: true, allowEdit: true },
    // No `rowLevelSecurity` policy for this one on purpose: its cells are about
    // the ENGINE's pass order, not about the check gate.
    qa_ro_cred: { allowRead: true, allowCreate: true, allowEdit: true },
  },
  rowLevelSecurity: [
    {
      name: 'employer_admin_members',
      object: 'qa_employer_member',
      operation: 'all',
      using: 'record.employer_org in current_user.employer_org_ids',
      check: 'record.employer_org in current_user.employer_org_ids',
    },
    {
      name: 'employer_admin_ro_members',
      object: 'qa_ro_member',
      operation: 'all',
      using: 'record.employer_org in current_user.employer_org_ids',
      check: 'record.employer_org in current_user.employer_org_ids',
    },
    {
      name: 'employer_admin_ro_members_default',
      object: 'qa_ro_member_default',
      operation: 'all',
      using: 'record.employer_org in current_user.employer_org_ids',
      check: 'record.employer_org in current_user.employer_org_ids',
    },
    {
      // The `check` names a `current_user.*` key NO resolver publishes, so the
      // compiler cannot evaluate it and drops the policy — which upstream is
      // `RLS_DENY_FILTER`, the fail-closed sentinel that matches no row. `using`
      // stays evaluable so the read leg is not what is under test.
      name: 'employer_admin_unevaluable',
      object: 'qa_unevaluable_member',
      operation: 'all',
      using: 'record.employer_org in current_user.employer_org_ids',
      check: 'record.employer_org in current_user.no_such_membership_key',
    },
    {
      name: 'employer_admin_cost',
      object: 'qa_cost_member',
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
  /** The same, for any table — ground truth for the cells below. */
  table: (name: string, columns: string[]) => Promise<Array<Record<string, unknown>>>;
  /** How many times the credential channel actually minted a secret. */
  crypto: { encrypt: number; decrypt: number };
}

/**
 * A reversible stub `ICryptoProvider`, so `encryptSecretFields` runs its REAL
 * path — mint a handle, write a `sys_secret` row, put an opaque ref on the row —
 * and both halves of "a refusal costs nothing" become readable facts rather than
 * an argument about ordering.
 */
function makeFakeCrypto() {
  let n = 0;
  const calls = { encrypt: 0, decrypt: 0 };
  const provider = {
    async encrypt(plain: string) {
      calls.encrypt += 1;
      n += 1;
      return {
        id: `sec_${n}`,
        kmsKeyId: 'local',
        alg: 'test-b64',
        version: 1,
        ciphertext: Buffer.from(plain, 'utf8').toString('base64'),
      };
    },
    async decrypt(handle: { ciphertext: string }) {
      calls.decrypt += 1;
      return Buffer.from(handle.ciphertext, 'base64').toString('utf8');
    },
    async rotateKey(handle: { version: number }) { return { ...handle, version: handle.version + 1 }; },
    digest(plain: string) { return `d:${plain.length}`; },
  };
  return { provider, calls };
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
  for (const object of [
    'qa_employer_member',
    'qa_ro_member',
    'qa_ro_member_default',
    'qa_unevaluable_member',
    'qa_cost_member',
  ]) {
    engine.on('beforeInsert', object, stamp as never);
    engine.on('beforeUpdate', object, stamp as never);
  }
  const crypto = makeFakeCrypto();
  engine.setCryptoProvider(crypto.provider as never);

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

  const table = async (name: string, columns: string[]) => {
    const driver = (engine as unknown as { getDriver(o: string): { knex: (t: string) => Promise<unknown> } })
      .getDriver(name);
    return (await (driver.knex as unknown as (t: string) => { select: (...c: string[]) => Promise<Array<Record<string, unknown>>> })(
      name,
    ).select(...columns)) as Array<Record<string, unknown>>;
  };

  return {
    engine,
    stampReads,
    crypto: crypto.calls,
    table,
    stored: () => table('qa_employer_member', ['id', 'employer', 'employer_org']),
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
      // The write verbs route through the real engine's dispatch predicates —
      // a double looser than `ObjectQL` turns a green suite into no suite
      // (`check:engine-double-contract`, from #4434). This double refuses a
      // call the engine refuses even though the leg below never makes one.
      async findOne(object: string, query: EngineFindOneQueryInput) {
        assertEngineFindOnePredicate(object, query);
        return null;
      },
      async insert(_object: string, data: Record<string, unknown>) { rows.push({ ...data }); return data; },
      async update(_object: string, data: EngineUpdateDispatchData, options?: EngineUpdateDispatchInput | null) {
        assertEngineUpdateDispatch(data, options);
        return data;
      },
      async delete(_object: string, options?: EngineDeleteDispatchInput | null) {
        assertEngineDeleteDispatch(options);
        return true;
      },
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

// ── the contract review's cells, on the same both-drivers footing ──────────

/**
 * [contract review of PR #16805, F1 — BLOCKING] **The row the seam judges must
 * be the row that is stored.**
 *
 * The first delivery of this card put the judgement immediately after the
 * post-hook declared-field door — ahead of every producer with a side effect,
 * which was the right rule — but two VALUE-CHANGING passes still ran after it:
 * `stripRuntimeOwnedFields` and the static-`readonly` strip with its re-default
 * (`engine.insert`). For a `readonly` scoping field, which is what an author
 * declares precisely so a caller cannot choose it, that left the old defect
 * intact one layer down:
 *
 *   caller sends an IN-scope value → the seam judges it and admits → the strip
 *   removes it (caller-supplied, no hook wrote it) → `applyFieldDefaults`
 *   re-derives the key → the STORE receives a value the seam never saw.
 *
 * With no `defaultValue` the stored row simply violates the `check`. With a
 * `defaultValue` naming another organization it is the card's own headline
 * defect verbatim: a row stored in an organization the caller does not hold.
 *
 * The fix moves both strips AHEAD of the seam, so the seam judges the row after
 * every pass that can change a value a caller could steer and before every pass
 * with a side effect. These two cells are what that fix is measured by: they are
 * RED on the reviewed head `cd09d3b99` and green after.
 *
 * ⛔ Note what is NOT asserted: that the caller's value survives. It must not —
 * the field is `readonly`. The invariant is the disjunction the review named:
 * either the insert is refused, or the STORED row satisfies the check. Both
 * cells assert the disjunction over the driver's own table first, and only then
 * pin the answer the runtime actually gives.
 */
for (const [driverName, makeDriver] of DRIVERS) {
  describe(`[#16608 F1] ${driverName} — a static \`readonly\` scoping field: the seam judges what the STRIP leaves`, () => {
    it('no default — the caller’s in-scope value is stripped, so the insert is refused and nothing is stored', async () => {
      const booted = await boot(makeDriver);

      // No `employer`, so the stamp early-returns and writes nothing: the only
      // author of `employer_org` on this payload is the CALLER, and the strip
      // is the only thing that touches it afterwards.
      const outcome = await attempt(() =>
        booted.engine.insert(
          'qa_ro_member',
          { id: 'ro_1', employer_org: OWN_ORG, role: 'admin' },
          { context: CALLER } as never,
        ),
      );

      const rows = await booted.table('qa_ro_member', ['id', 'employer_org']);
      // THE INVARIANT, asserted before any verdict is pinned: a stored row
      // satisfies the check, or there is no stored row.
      for (const row of rows) {
        expect(
          row.employer_org,
          'a stored row must satisfy the insert check the seam claims to enforce',
        ).toBe(OWN_ORG);
      }
      // And the answer the runtime gives: refused, on the gate's own envelope.
      expectCheckDenial(outcome, 'insert');
      expect(rows, 'nothing was stored').toEqual([]);
    });

    it('a `defaultValue` OUTSIDE the caller’s scope — refused, and no row lands in an organization the caller does not hold', async () => {
      const booted = await boot(makeDriver);

      const outcome = await attempt(() =>
        booted.engine.insert(
          'qa_ro_member_default',
          { id: 'rod_1', employer_org: OWN_ORG, role: 'admin' },
          { context: CALLER } as never,
        ),
      );

      const rows = await booted.table('qa_ro_member_default', ['id', 'employer_org']);
      expect(
        rows.some((r) => r.employer_org === OTHER_ORG),
        'the strip’s re-default must not be able to store an organization the caller does not hold',
      ).toBe(false);
      for (const row of rows) {
        expect(row.employer_org, 'a stored row must satisfy the insert check').toBe(OWN_ORG);
      }
      expectCheckDenial(outcome, 'insert');
      expect(rows, 'nothing was stored').toEqual([]);
    });
  });

  /**
   * [contract review F4 (i)] An `check` the compiler cannot evaluate compiles to
   * `RLS_DENY_FILTER` — the fail-closed sentinel that matches no row — and the
   * seam must REFUSE on it rather than wave the write through.
   *
   * The claim was argued in the first delivery and never pinned. It is pinned
   * here through the seam specifically: the `beforeInsert` stamp is observed to
   * have RUN, which it can only have done if the middleware handed the write to
   * the engine — so the refusal below is `evaluate`'s, not the middleware's.
   */
  describe(`[#16608 F4] ${driverName} — an unevaluable \`check\` refuses`, () => {
    it('refuses the insert through the seam, on the ADR-0112 envelope, with nothing stored', async () => {
      const booted = await boot(makeDriver);

      const outcome = await attempt(() =>
        booted.engine.insert(
          'qa_unevaluable_member',
          // In-scope in every readable sense: the parent is the caller's own,
          // so the stamp lands `org_a`. Only the UNEVALUABLE check refuses it.
          { id: 'unev_1', employer: 'emp_a', employer_org: OWN_ORG, role: 'admin' },
          { context: CALLER } as never,
        ),
      );

      expectCheckDenial(outcome, 'insert');
      expect(
        booted.stampReads,
        'the hook ran, so the write reached the engine and the refusal is the seam’s',
      ).toContain('emp_a');
      expect(await booted.table('qa_unevaluable_member', ['id', 'employer_org'])).toEqual([]);
    });
  });

  /**
   * [contract review F4 (ii)] **A refusal costs nothing** — the rule #8682 wrote
   * for the declared-field door, now owed by this seam because it moved the
   * judgement into the engine's own timeline.
   *
   * Two producers sit downstream of the seam and both are irreversible in the
   * way that matters: `applyAutonumbers` (or the driver's native sequence)
   * CONSUMES a number, and `encryptSecretFields` MINTS a `sys_secret` row. The
   * PR body claimed both are safe. Neither was pinned.
   *
   * The autonumber half is asserted format-agnostically, against a control boot
   * that never refuses anything: if the refused insert had drawn a number, the
   * survivor's number would differ from the control's.
   */
  describe(`[#16608 F4] ${driverName} — a refusal consumes no autonumber and mints no secret`, () => {
    it('the refused insert draws no sequence value and writes no sys_secret row', async () => {
      // The control: the very first admitted insert on a fresh engine.
      const control = await boot(makeDriver);
      await control.engine.insert(
        'qa_cost_member',
        { id: 'cost_ctl', employer: 'emp_a', employer_org: OWN_ORG, token: 'sekrit' },
        { context: CALLER } as never,
      );
      const baseline = (await control.table('qa_cost_member', ['id', 'code']))[0]!.code;
      expect(baseline, 'the control drew a sequence value').toBeTruthy();
      expect(control.crypto.encrypt, 'the control minted its secret — the field IS on the credential path').toBe(1);

      // The subject: one refusal, then the same admitted insert.
      const booted = await boot(makeDriver);
      const refused = await attempt(() =>
        booted.engine.insert(
          'qa_cost_member',
          // In-scope on the payload, out-of-scope parent — the measured bypass.
          { id: 'cost_bad', employer: 'emp_b', employer_org: OWN_ORG, token: 'sekrit' },
          { context: CALLER } as never,
        ),
      );
      expectCheckDenial(refused, 'insert');
      expect(await booted.table('qa_cost_member', ['id', 'code'])).toEqual([]);
      // MINTED NOTHING: the credential channel never ran for the refused row.
      expect(booted.crypto.encrypt, 'a refused insert must not mint a secret').toBe(0);
      expect(await booted.table('sys_secret', ['id']), 'no sys_secret row for a refused insert').toEqual([]);

      const admitted = await attempt(() =>
        booted.engine.insert(
          'qa_cost_member',
          { id: 'cost_ok', employer: 'emp_a', employer_org: OWN_ORG, token: 'sekrit' },
          { context: CALLER } as never,
        ),
      );
      expect(admitted.ok, `expected the follow-up insert to be admitted: ${admitted.developerMessage ?? admitted.message}`).toBe(true);

      const survivors = await booted.table('qa_cost_member', ['id', 'code']);
      expect(survivors).toHaveLength(1);
      // CONSUMED NOTHING: the survivor gets exactly the number the control got,
      // so the refused attempt left the sequence where it found it.
      expect(survivors[0]!.code, 'the refusal consumed no sequence value').toBe(baseline);
      expect(booted.crypto.encrypt, 'exactly one mint, for the one write that happened').toBe(1);
      expect(await booted.table('sys_secret', ['id'])).toHaveLength(1);
    });
  });
}

/**
 * [contract review F1, the reorder's OWN consequences — measured, both legs]
 *
 * Moving the two strips ahead of the seam also moves them ahead of the
 * credential loop (`refuseEmptyPasswordFields` + `encryptSecretFields`), which
 * used to run first. That is not a detail to wave at: it changes what happens
 * to a caller-supplied value on a `readonly` CREDENTIAL column, in two
 * different directions, and both were measured on `cd09d3b99` (the reviewed
 * head, `engine.ts` checked out over this tree) and on the fix.
 *
 * ⚠️ These cells run without a `check` policy and outside the RLS gate
 * entirely — they are about the ENGINE's pass order, which is what the F1 fix
 * moved. They live here because this file is where that reorder is justified.
 */
for (const [credDriverName, makeCredDriver] of DRIVERS) {
describe(`[#16608 F1] ${credDriverName} — what moving the strips ahead of the credential channel changes`, () => {
  const OBJ = 'qa_ro_cred';
  // The same non-system caller the cells above use — granted create on this
  // object, and governed by NO `check`, so nothing here is the RLS gate's doing.

  it('a caller-forged `readonly` `secret` field is stripped, so nothing is stored and no secret is minted', async () => {
    // MEASURED on the reviewed head cd09d3b99, same harness:
    //   stored `token: "secret:sec_1"` · encrypt calls 1 · sys_secret rows 1
    // The forgery REACHED THE STORE. `encryptSecretFields` ran first and
    // replaced the row's value with a reference, so the strip's `Object.is`
    // value test then compared a REF against the caller's plaintext, read the
    // difference as "a hook rewrote this key", and KEPT it — the one input
    // where that test inverts. Pre-existing on 17.3.0, closed by the reorder.
    const booted = await boot(makeCredDriver);

    const outcome = await attempt(() =>
      booted.engine.insert(
        OBJ,
        { id: 'cred_1', name: 'n', token: 'forged-plaintext' },
        { context: CALLER } as never,
      ),
    );
    expect(outcome.ok, `expected the insert to be admitted with the forgery dropped: ${outcome.message}`).toBe(true);

    const rows = await booted.table(OBJ, ['id', 'token']);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token, 'a caller may not seed a `readonly` credential column').toBeNull();
    expect(booted.crypto.encrypt, 'nothing was encrypted for a value the strip discards').toBe(0);
    expect(await booted.table('sys_secret', ['id']), 'and no sys_secret row was minted').toEqual([]);
  });

  it('an empty string on a `readonly` `password` field is stripped rather than refused — and `""` still never reaches the store', async () => {
    // ⚠️ THE ONE DIRECTION OF THE REORDER THAT IS NOT A NARROWING, recorded
    // here so it is visible rather than discovered. MEASURED on the reviewed
    // head cd09d3b99, same harness:
    //   VALIDATION_ERROR — 'Empty string refused for password field
    //   "qa_ro_cred.pw"' · nothing stored
    // and on the fix: admitted, `pw` stored as NULL.
    //
    // What the 2026-08-13 ruling guarantees is that a masked credential column
    // never holds `""` while every read reports "a password is set". That
    // guarantee is INTACT — `""` is discarded on both orders; only which
    // refusal a caller sees moved, on a payload the caller was never allowed to
    // send. ⛔ The seam's 403 deliberately still precedes this: moving
    // `refuseEmptyPasswordFields` up too would let a field-level validation
    // verdict answer a write that RLS refuses, which is the wrong precedence
    // for a security gate.
    const booted = await boot(makeCredDriver);

    const outcome = await attempt(() =>
      booted.engine.insert(OBJ, { id: 'cred_2', name: 'n', pw: '' }, { context: CALLER } as never),
    );
    expect(outcome.ok).toBe(true);

    const rows = await booted.table(OBJ, ['id', 'pw']);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pw, 'the empty credential is not stored — the ruling’s guarantee, unchanged').toBeNull();
  });
});
}
