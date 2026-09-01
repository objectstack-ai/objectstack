// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What ACTUALLY happens when a write names a field the object never declares
 * (#4271) — pinned against both driver families, because the answer differs.
 *
 * This file exists to stop one sentence from drifting back. The
 * `hook-body-write-unknown-field` / `action-body-write-unknown-field` lint
 * messages used to tell authors the unknown column "silently never lands in
 * the stored record". That is wrong in BOTH directions, and a lint that
 * misdescribes the failure it is warning about teaches the wrong debugging
 * instinct — an author told "it silently vanishes" will not connect the
 * driver-level error they actually see to the typo that caused it.
 *
 * Nothing between the body and the driver filters the key:
 *
 *   1. `applyMutationsToInput` (./body-runner.ts) is a plain `Object.assign` —
 *      the sandbox's mutated input is copied onto the payload verbatim.
 *   2. `validateRecord` (objectql/src/validation/record-validator.ts) walks
 *      DECLARED fields on insert, and on update does `if (!def) continue`.
 *      It neither rejects the unknown key nor strips it.
 *   3. `engine.ts` hands the row to `driver.create` / the driver's update.
 *
 * ...and, until #13657, the driver decided — so the two families disagreed:
 *
 *   • SQL — the stray column reached the statement and the WHOLE write failed.
 *     Nothing was stored, and the error named a column, not a field, far from
 *     the body that wrote it.
 *   • Schemaless (memory, and MongoDB on the same `...data` spread) — the key
 *     WAS persisted, as an undeclared column nothing downstream reads.
 *
 * [#13657] That divergence is CLOSED. The declared-field door now has a
 * POST-hook half (`undeclaredWriteFieldErrors`, run again over the payload the
 * `before*` hooks produced, before any statement is built), so a body-written
 * undeclared key is refused by the object's FIELD MAP — `INVALID_FIELD` / 400,
 * identically on both families, with no driver reached and therefore none left
 * to disagree. Link 3 above is the one that changed; links 1 and 2 are intact
 * and this file still proves them, because the door sits BELOW them.
 *
 * The lint messages, the `ScriptBodySchema` / `ActionSchema.body` notes and
 * `content/docs/automation/hook-bodies.mdx` all describe what happens here; if
 * any of them drifts back to "silently never lands" — or forward to "the
 * answer depends on your driver" — this file fails.
 *
 * Every case runs the FULL chain — real QuickJS sandbox, real hook body, real
 * engine, real driver — so link 1 is proved rather than assumed: if
 * `applyMutationsToInput` ever learned to filter, the SQL write would stop
 * throwing.
 *
 * [#8738] The update cases used to go straight at the engine instead, on the
 * reasoning that a `beforeUpdate` body "would only add the flat-input envelope
 * to the thing under test". That equivalence is gone, and its loss is what this
 * file now has to say out loud: the DECLARED-FIELD DOOR (#8682 on insert,
 * #8738 on update) refuses a key the CALLER names before any hook runs, so a
 * caller payload no longer stands in for a body mutation. Both update cases
 * therefore carry a real `beforeUpdate` body, matching the insert arm, and the
 * caller-payload case is pinned separately at the foot of the file — where the
 * answer is a schema refusal on BOTH families and there is no split at all.
 *
 * Which half is which matters for reading the three prose surfaces above: they
 * describe what a BODY write does, and a body write is exactly the half the
 * door does not touch.
 */

/**
 * ⚠️ `@objectstack/driver-memory` is imported here ON PURPOSE, and this is the
 * test consumer of it that #5704 RULED permanent. It is NOT a migration
 * leftover — do not "finish the job" by deleting or replacing it.
 *
 * #6664 census: 2 ruled consumers — this file, and
 * `../autonumber-seed-cross-side-parity.integration.test.ts` (#6468's
 * engine-vs-driver autonumber convergence pin, ruled permanent on #6664 by
 * maintainer 2026-08-08, inheriting the same Q2 = B). That block carries its own
 * ruling; read it there rather than assuming this one covers it.
 *
 * This block used to say "the only permanent test consumer in the repository",
 * and that census expired without anyone editing it — the autonumber test
 * arrived after #5704's survey and nothing was watching. So the count stopped
 * being prose: `pnpm check:driver-memory-census` reads
 * `scripts/driver-memory-census.ledger.json` and fails on any declaration of the
 * driver the ledger does not cover, in either direction. A third arrival is now
 * refused at the gate, and changing the ruled SET makes both files' census
 * sentences fail until they are rewritten — which is the half a sentence could
 * never do for itself (#6664, ruling C).
 *
 * Why it has to stay — and the reason survives #13657 intact, one word over.
 * This file used to pin a PRODUCT DIVERGENCE between two driver families
 * (rejected as a whole statement by SQL, accepted verbatim by the schemaless
 * family); it now pins the CONVERGENCE that replaced it. Either way the claim
 * is about both families at once, so it needs both arms. The SQL arm is
 * `SqlDriver`; the schemaless arm needs a backend that has no schema to check
 * the key against, and `InMemoryDriver` is the cheapest honest one (MongoDB
 * behaves the same on the same `...data` spread, but would put a real database
 * in CI's path). Delete this arm and the guardrail silently becomes a one-sided
 * assertion about SQL — and "identical on every driver", the whole point of
 * #13657, stops being pinned at all. ⚠️ If anything, the schemaless arm matters
 * MORE now: it is the family that used to accept the key, so it is the arm that
 * would witness a regression first.
 *
 * Why the freeze does not forbid it: #5499 froze *investment* in driver-memory
 * (defect fixes, feature work). Using it as a reference implementation is not
 * investment, and nothing here fixes or extends it. Ruling: #5704, maintainer
 * 2026-08-06, Q2 = B ("keep, in this one place, with a comment saying so").
 * Consequence, also ruled there: 「runtime 的 driver-memory devDep 长期保留(仅
 * 此一个消费点)」. Two words of that consequence have since moved, and the ledger
 * records both rather than leaving them to be re-derived: the declaration is in
 * `packages/runtime`'s `dependencies`, not `devDependencies` (beside `driver-sql`
 * and `driver-sqlite-wasm`, which this package declares for the same reason — the
 * datasource factory resolves them by dynamic import), and it now serves TWO
 * ruled consumers in this package rather than one, so removing this file's import
 * alone would not drop it.
 *
 * Everything else that used to look like a driver-memory test consumer was a
 * hand-written local stub whose NAME merely said "memory" — in packages that
 * do not even depend on the driver. #5704/#5784 renamed them all to
 * `makeStubDriver`, precisely so that grepping for the driver lands on real
 * consumers only.
 *
 * [#5830 / #5893] The identity lane's two arrivals are gone. Two consumers
 * appeared in plugin-auth AFTER #5704's survey (#5812 and #5844); both have
 * since been migrated to sqlite `:memory:`, and plugin-auth's
 * `@objectstack/driver-memory` devDep is gone with them:
 *
 *   - `plugin-auth/src/auth-where-operator-coverage.test.ts` — migrated by
 *     #5830 (PR #5880). Its defect (#5813) was a DROPPED predicate, which any
 *     backend that really executes the filter witnesses.
 *   - `plugin-auth/src/auth-contains-filter.test.ts` — migrated by #5893, on
 *     the expiry condition #5830 wrote for it rather than on a second opinion.
 *     Its pin is #5710's `contains` → `$regex` flip, and while driver-sql still
 *     routed `$regex` through the same `applyContainsLike` as `$contains` (the
 *     `case '$regex':` fallthrough) a SQL witness answered identically either
 *     way — measured in #5830: with the defect restored, memory failed 3
 *     behavioural pins and sqlite passed all 4, so migrating then would have
 *     produced pins that are green because nothing distinguishes them. #5702
 *     (PR #6549) deleted that fallthrough and RETIRED the spelling: driver-sql
 *     now refuses `$regex` by name in the ADR-0112 envelope
 *     (`INVALID_FILTER` / 400), so the SQL arm witnesses the defect again — as
 *     a refusal rather than a different row set, which is the better reason
 *     #5830's expiry clause predicted. The migrated file carries its own guard
 *     for that property, so it cannot silently revert to an always-green pin.
 *
 * What a grep for the driver's DECLARATIONS finds in `packages/` after that
 * migration: this file, and #6468's `autonumber-seed-cross-side-parity`
 * integration test — both ruled, both ledgered. Nothing in plugin-auth. The
 * prose MENTIONS that remain there — the identity-lane files explain the history
 * above in their own comments, because a pin has to say what it used to be
 * wrong about — are not consumers: retirement verification counts declarations,
 * not mentions. That distinction is what made the grep usable at all, and it is
 * now the gate's rule too: `check:driver-memory-census` classifies by module
 * position (AST, not text), so a comment naming the package and the bundler
 * externals entry in `packages/runtime/tsup.config.ts` are reported as mentions
 * and never as arrivals.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { InMemoryDriver } from '@objectstack/driver-memory';
import { hookBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import {
  captureExpectedReadRefusals,
  type ExpectedReadRefusalCapture,
} from '../expected-read-refusal-noise.js';

/**
 * The read-back query, TYPED rather than cast. The `as any` reads elsewhere in
 * this file predate the `query-options-erasure` ratchet and are counted as
 * grandfathered residue; new ones are not, and there is no reason for these
 * two to be erased — the options bag is an ordinary `where`.
 */
const rowById = (id: unknown): EngineQueryOptions => ({ where: { id } });

/** `stagee` is the typo under test; `stage` is the field that exists. */
const DEAL = {
  name: 'deal',
  fields: {
    stage: { type: 'text', name: 'stage' },
    amount: { type: 'number', name: 'amount' },
  },
};

/** The #4271 authoring mistake, in the shape the hook rule flags. */
const TYPO_HOOK = {
  name: 'deal_stage_typo',
  object: 'deal',
  events: ['beforeInsert'],
  body: { language: 'js', source: `ctx.input.stagee = 'won';` },
};

/** The same body with the field name spelled correctly — the control. */
const CORRECT_HOOK = {
  name: 'deal_stage_ok',
  object: 'deal',
  events: ['beforeInsert'],
  body: { language: 'js', source: `ctx.input.stage = 'won';` },
};

/**
 * [#8738] The same authoring mistake on the UPDATE verb, and it has to be a
 * BODY rather than a caller payload — which is a change of METHOD, not of
 * subject.
 *
 * These two cases used to call `engine.update(...)` with the typo in the
 * caller's own payload, on the file's stated reasoning that "a `beforeUpdate`
 * body would only add the flat-input envelope to the thing under test". The
 * declared-field door falsifies that equivalence: since #8682 on insert and
 * #8738 on update, a key the CALLER names is refused by the schema before any
 * hook runs, so a caller payload no longer stands in for a body mutation — it
 * tests the door instead, and the driver split it is supposed to reach is
 * never exercised.
 *
 * The subject is unchanged and still measured on both families: a key a BODY
 * writes is added AFTER the PRE-hook door, so `applyMutationsToInput` →
 * `validateRecord`'s `if (!def) continue` is still intact and still proved
 * here. [#13657] What it reaches is no longer the driver: the POST-hook half of
 * the door refuses it first, on both families. The caller-payload half has its
 * own cases below, pinning the pre-hook door — which #13657 deliberately did
 * NOT move, since #8737 put it ahead of the hooks so a refused payload consumes
 * no autonumber.
 */
const UPDATE_TYPO_HOOK = {
  name: 'deal_stage_typo_update',
  object: 'deal',
  events: ['beforeUpdate'],
  body: { language: 'js', source: `ctx.input.stagee = 'won';` },
};

/**
 * [#10629] The SQL half of this fixture provisions `deal` and nothing else, so
 * the engine's single-tenant probe (`ObjectQL.probeInstallOrganizations`,
 * memoised once per engine) reads a `sys_organization` that was never created.
 * The probe is fail-soft by construction — it catches `isMissingTableError` and
 * only that — but the driver and the engine each log the fault on the way out.
 * The schemaless half has no missing table and so declares NOTHING expected:
 * its capture withholds nothing and asserts nothing, which is the honest
 * reading rather than a skipped assertion. `expected-read-refusal-noise.ts`
 * says why this withholds instead of muting.
 */
const ABSENT_TENANCY_TABLE = 'sys_organization';

describe('#4271 / #13657 an undeclared field written by an L2 body — one answer on both families', () => {
  let engine: ObjectQL | null = null;
  let dir: string | null = null;
  /** [#10629] The expected-noise capture belonging to the latest boot. */
  let noise: ExpectedReadRefusalCapture | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
    // [#10629] The capture is a PIN, not a mute — asserted after teardown so a
    // failure here can never leave the engine running. Unconditional on purpose:
    // a memory boot declares an EMPTY expectation, so this still fails loudly if
    // a boot ever forgets to install a capture at all.
    //
    // [#13657] `required` is narrowed to nothing — the documented remedy for
    // "a table read on only SOME of a file's paths", which is what
    // `sys_organization` became here. The single-tenant probe runs on the way
    // to the STATEMENT, and the post-hook door now refuses the body-written
    // typo before that: the refusal paths never read the table, while the
    // control and the pre-image read on update still do. Requiring it would
    // redden the refusal cases for a read they are correct not to perform.
    // ⛔ Narrowed, NOT relaxed: the capture still withholds the refusal
    // wherever it does fire, and a capture that was never installed still
    // fails through the `??` branch below.
    expect(noise?.silentChannels([]) ?? ['no capture was installed']).toEqual([]);
    noise = null;
  });

  async function bootSql(hook?: unknown) {
    dir = mkdtempSync(join(tmpdir(), 'os-4271-'));
    const driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: join(dir, 'data.sqlite') },
      useNullAsDefault: true,
    });
    // [#10629] Installed before the driver runs a statement — the sink the
    // expected refusal's first half travels out on.
    noise = captureExpectedReadRefusals([ABSENT_TENANCY_TABLE]);
    noise.captureDriver(driver);
    await driver.initObjects([DEAL]); // a REAL table, with only the declared columns
    return boot(driver, hook);
  }

  async function bootMemory(hook?: unknown) {
    // [#10629] A schemaless driver never refuses a read on a missing table, so
    // this family expects no noise at all — an EMPTY declaration rather than a
    // skipped one, which keeps the shared `afterEach` assertion honest.
    noise = captureExpectedReadRefusals([]);
    return boot(new InMemoryDriver(), hook);
  }

  async function boot(driver: unknown, hook?: unknown) {
    engine = new ObjectQL();
    // [#10629] The engine frame that sits directly above the driver's refusal.
    noise?.captureEngine(engine);
    engine.registerDriver(driver as any, true);
    await engine.init();
    engine.registry.registerObject(DEAL as any);
    engine.setDefaultBodyRunner(
      hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: 'deal' }),
    );
    if (hook) bindHooksToEngine(engine, [hook as any], { packageId: 'deal' });
    return engine;
  }

  // ─── [#13657] Both families, one answer ───────────────────────────────────

  /**
   * [#13657] What this block used to pin, and why it does not any more.
   *
   * Until #13657 these were two arms because the runtime gave two answers to
   * one question. A key an L2 body wrote was added AFTER the declared-field
   * door (#8682 / #8738, moved ahead of the hooks by #8737), so nothing between
   * `applyMutationsToInput` and the driver judged it, and the DRIVER decided:
   *
   *   SQL          the stray column entered the statement and the WHOLE write
   *                failed — a raw `SQLITE_ERROR`, no `status`, and the bound
   *                statement AND its values quoted back in the message;
   *   schemaless   `InMemoryDriver.create` spread `...data`, so the key was
   *                PERSISTED as an undeclared column nothing downstream reads —
   *                and, because `fieldPermissions` is keyed by declared field
   *                name, one that field-level security can never gate.
   *
   * One app, one body, two meanings decided by which driver a deployment
   * happened to run — and nothing in the app could tell which. #13657 added the
   * POST-hook half of the door, so the key is now refused by the object's FIELD
   * MAP before any statement is built. There is no driver left to disagree.
   *
   * ⚠️ The file's purpose is unchanged: it still exists to stop one sentence
   * from drifting, and it still runs the FULL chain — real QuickJS sandbox,
   * real body, real engine, real driver — on BOTH families. What changed is the
   * sentence. `it.each` over the two boots is deliberate: writing the assertion
   * ONCE and running it on both is what makes "identical on every driver" a
   * property this file can state, rather than two arms a reader has to compare
   * by eye.
   */
  const FAMILIES: Array<[string, (hook?: unknown) => Promise<ObjectQL>]> = [
    ['SQL (better-sqlite3, real table)', (h) => bootSql(h)],
    ['schemaless (memory)', (h) => bootMemory(h)],
  ];

  describe('an L2 BODY-written undeclared key — refused identically on both families', () => {
    it.each(FAMILIES)('%s: insert answers the ADR-0112 envelope', async (_name, bootFamily) => {
      const e = await bootFamily(TYPO_HOOK);

      const err: any = await e.insert('deal', { stage: 'open', amount: 10 }).catch((x: unknown) => x);

      // The caller path's answer, on both families. Before #13657 this read
      // `code: 'SQLITE_ERROR', status: undefined` on SQL and no error at all on
      // memory.
      expect(err?.code).toBe('INVALID_FIELD');
      expect(err?.status).toBe(400);
      expect(err?.field).toBe('stagee');
      expect(err?.message).toBe("Unknown field 'stagee' on object 'deal'");
    }, 30000);

    it.each(FAMILIES)('%s: insert stores NOTHING — no row, and no shadow column', async (_name, bootFamily) => {
      const e = await bootFamily(TYPO_HOOK);

      await expect(e.insert('deal', { stage: 'open', amount: 10 })).rejects.toThrow();

      // Both halves the old wording got wrong, now one fact: SQL loses the
      // write (as it always did) and memory no longer keeps the stray key.
      expect(await e.find('deal', { where: {} } as any)).toHaveLength(0);
    }, 30000);

    it.each(FAMILIES)('%s: update is refused too, and the row is untouched', async (_name, bootFamily) => {
      const e = await bootFamily(UPDATE_TYPO_HOOK);
      const row = await e.insert('deal', { stage: 'open', amount: 10 });

      // The caller's payload is entirely DECLARED, so the PRE-hook door passes
      // it; the body then adds the typo, and the POST-hook door is what refuses
      // it — on both families, before any driver is consulted.
      const err: any = await e.update('deal', { id: row.id, stage: 'negotiating' } as any)
        .catch((x: unknown) => x);

      expect(err?.code).toBe('INVALID_FIELD');
      expect(err?.status).toBe(400);
      const after: any = (await e.find('deal', rowById(row.id)))[0];
      expect(after.stage).toBe('open');
      expect(after).not.toHaveProperty('stagee');
    }, 30000);

    it.each(FAMILIES)('%s: the refusal quotes no statement and no values', async (_name, bootFamily) => {
      const e = await bootFamily(TYPO_HOOK);

      const err: any = await e.insert('deal', { stage: 'open', amount: 10 }).catch((x: unknown) => x);

      // #8682's Half B survived on this path: the SQL refusal carried the full
      // bound INSERT with its values in the message. Refusing pre-statement is
      // what puts it out of reach — pinned on both families so the property is
      // about the ENGINE's answer, not about one driver's error string.
      expect(String(err?.message)).not.toMatch(/insert into/i);
      expect(String(err?.message)).not.toMatch(/\bvalues\b/i);
    }, 30000);

    it.each(FAMILIES)('%s: CONTROL — the same body spelled right writes normally', async (_name, bootFamily) => {
      const e = await bootFamily(CORRECT_HOOK);

      const row = await e.insert('deal', { stage: 'open', amount: 10 });

      // Proves the refusals above are about the undeclared column and not a
      // broken fixture — and that `applyMutationsToInput` still reaches the
      // driver, which is the link the whole file exists to keep proved.
      expect((await e.find('deal', rowById(row.id)))[0].stage).toBe('won');
    }, 30000);
  });

  // ─── The other half of the same question: who refuses a CALLER's typo ──────

  /**
   * [#8682 / #8738] The declared-field door, and the reason the cases above had
   * to move to bodies.
   *
   * The driver split is a fact about keys that arrive BELOW the engine's own
   * validation — which is what a body mutation is, and what a caller payload
   * has stopped being. A key the caller names is now refused by the object's
   * FIELD MAP, before the hooks, before the statement, and — the point that
   * decides these two cases — before any driver is consulted at all. So there
   * is no split to observe: the verdict is a schema verdict, and both families
   * get the identical ADR-0112 envelope.
   *
   * Pinned here rather than left implicit because this file is where a reader
   * comes to learn what happens to an undeclared write, and half an answer
   * ("SQL fails, schemaless persists") is what sent the old lint message
   * wrong in the first place.
   */
  describe('a CALLER-supplied undeclared key — the schema refuses, on both families', () => {
    it('SQL: refused before the driver, and the row is untouched', async () => {
      const e = await bootSql();
      const row = await e.insert('deal', { stage: 'open', amount: 10 });

      const err: any = await e.update('deal', { id: row.id, stagee: 'won' } as any).catch((x: unknown) => x);

      expect(err?.code).toBe('INVALID_FIELD');
      expect(err?.status).toBe(400);
      const after: any = (await e.find('deal', rowById(row.id)))[0];
      expect(after.stage).toBe('open');
    }, 30000);

    it('schemaless: refused too — the door is a schema verdict, not a driver one', async () => {
      // The one case in this file where the two families AGREE, and it is not
      // a coincidence: nothing here ever reaches a driver to disagree.
      const e = await bootMemory();
      const row = await e.insert('deal', { stage: 'open', amount: 10 });

      const err: any = await e.update('deal', { id: row.id, stagee: 'won' } as any).catch((x: unknown) => x);

      expect(err?.code).toBe('INVALID_FIELD');
      expect(err?.status).toBe(400);
      const stored: any = (await e.find('deal', rowById(row.id)))[0];
      expect(stored).not.toHaveProperty('stagee');
    }, 30000);
  });
});
