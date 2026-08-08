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
 * So the driver decides, and the two families disagree:
 *
 *   • SQL — the stray column reaches the statement and the WHOLE write fails.
 *     Nothing is stored, and the error names a column, not a field, far from
 *     the body that wrote it.
 *   • Schemaless (memory, and MongoDB on the same `...data` spread) — the key
 *     IS persisted, as an undeclared column nothing downstream reads.
 *
 * The lint messages, the `ScriptBodySchema` / `ActionSchema.body` notes and
 * `content/docs/automation/hook-bodies.mdx` all describe this split; if any of
 * them drifts back to "silently never lands", one half of this file fails.
 *
 * The insert cases run the FULL chain — real QuickJS sandbox, real hook body,
 * real engine, real driver — so link 1 is proved rather than assumed: if
 * `applyMutationsToInput` ever learned to filter, the SQL insert would stop
 * throwing. The update cases go straight at the engine, because that is where
 * `validateRecord`'s update branch lives and a `beforeUpdate` body would only
 * add the flat-input envelope to the thing under test.
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
 * Why it has to stay: the whole point of this file is a PRODUCT divergence
 * between two driver families — writing an undeclared field is rejected as a
 * WHOLE statement by the SQL family, and accepted verbatim by the schemaless
 * family. Pinning a divergence needs both arms. The SQL arm is `SqlDriver`; the
 * schemaless arm needs a backend that has no schema to check the key against,
 * and `InMemoryDriver` is the cheapest honest one (MongoDB behaves the same on
 * the same `...data` spread, but would put a real database in CI's path).
 * Delete this arm and the guardrail silently becomes a one-sided assertion
 * about SQL — the divergence stops being pinned at all.
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

describe('#4271 an undeclared field written by an L2 body — the real runtime split', () => {
  let engine: ObjectQL | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  });

  async function bootSql(hook?: unknown) {
    dir = mkdtempSync(join(tmpdir(), 'os-4271-'));
    const driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: join(dir, 'data.sqlite') },
      useNullAsDefault: true,
    });
    await driver.initObjects([DEAL]); // a REAL table, with only the declared columns
    return boot(driver, hook);
  }

  async function bootMemory(hook?: unknown) {
    return boot(new InMemoryDriver(), hook);
  }

  async function boot(driver: unknown, hook?: unknown) {
    engine = new ObjectQL();
    engine.registerDriver(driver as any, true);
    await engine.init();
    engine.registry.registerObject(DEAL as any);
    engine.setDefaultBodyRunner(
      hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: 'deal' }),
    );
    if (hook) bindHooksToEngine(engine, [hook as any], { packageId: 'deal' });
    return engine;
  }

  // ─── SQL: a loud failure that loses the whole write ────────────────────────

  describe('SQL driver (better-sqlite3, real table)', () => {
    it('fails the WHOLE insert at the driver — it is not a silent no-op', async () => {
      const e = await bootSql(TYPO_HOOK);
      // The body runs clean in the sandbox; the throw comes from the database.
      await expect(e.insert('deal', { stage: 'open', amount: 10 }))
        .rejects.toThrow(/stagee/);
    }, 30000);

    it('stores NOTHING — the declared columns of that row are lost too', async () => {
      const e = await bootSql(TYPO_HOOK);
      await expect(e.insert('deal', { stage: 'open', amount: 10 })).rejects.toThrow();
      // The half that makes "silently never lands" actively misleading: an
      // author told the column vanishes would expect a row with `amount: 10`.
      expect(await e.find('deal', { where: {} } as any)).toHaveLength(0);
    }, 30000);

    it('fails an UPDATE the same way, and leaves the row untouched', async () => {
      const e = await bootSql();
      const row = await e.insert('deal', { stage: 'open', amount: 10 });
      // `validateRecord`'s update branch `continue`s past the unknown key
      // rather than rejecting it, so the driver is what refuses the write.
      await expect(e.update('deal', { id: row.id, stagee: 'won' } as any))
        .rejects.toThrow(/stagee/);
      const after: any = (await e.find('deal', { where: { id: row.id } } as any))[0];
      expect(after.stage).toBe('open');
      expect(after).not.toHaveProperty('stagee');
    }, 30000);

    it('control: the same body with the field spelled right writes normally', async () => {
      const e = await bootSql(CORRECT_HOOK);
      const row = await e.insert('deal', { stage: 'open', amount: 10 });
      // Proves the failures above are about the undeclared column and not a
      // broken fixture — and that `applyMutationsToInput` does reach the driver.
      expect((await e.find('deal', { where: { id: row.id } } as any))[0].stage).toBe('won');
    }, 30000);
  });

  // ─── Schemaless: the stray key is persisted, not dropped ───────────────────

  // `InMemoryDriver.create` spreads `...data`; `MongoDbDriver.create` spreads
  // `...toStorageForms(object, rest)`. Neither consults the declared field set,
  // so memory stands in for the whole schemaless family here.
  describe('schemaless driver (memory)', () => {
    it('accepts the insert and PERSISTS the undeclared key', async () => {
      const e = await bootMemory(TYPO_HOOK);
      const row = await e.insert('deal', { stage: 'open', amount: 10 });
      const stored: any = (await e.find('deal', { where: { id: row.id } } as any))[0];
      // The other direction the old wording got wrong: it lands.
      expect(stored.stagee).toBe('won');
      expect(stored.stage).toBe('open');
      expect(stored.amount).toBe(10);
    }, 30000);

    it('persists it on UPDATE too', async () => {
      const e = await bootMemory();
      const row = await e.insert('deal', { stage: 'open', amount: 10 });
      await e.update('deal', { id: row.id, stagee: 'won' } as any);
      const stored: any = (await e.find('deal', { where: { id: row.id } } as any))[0];
      expect(stored.stagee).toBe('won');
    }, 30000);
  });
});
