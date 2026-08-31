// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11224] The UPDATE door's `updated_at` stamp must carry the SAME precision
 * the audit column was created with — measured as the ordering invariant a
 * delta cursor depends on, not as a string shape.
 *
 * ## The mismatch this closes
 *
 * `createAuditTimestampColumn` builds the audit columns on MySQL as
 * `DATETIME(3)` defaulted with `now(3)`, and its docblock says why in as many
 * words ("`CURRENT_TIMESTAMP` has to carry matching precision for a
 * `DATETIME(3)` default", #3942). `updatedAtStamp()` — the value every UPDATE
 * door writes into that same column — was a bare `knex.fn.now()`, which
 * compiles to an unqualified `CURRENT_TIMESTAMP` that MySQL truncates to whole
 * seconds. So the column was created at millisecond precision on purpose and
 * then written at second precision.
 *
 * Measured on live MySQL 8.0.46 against the exact schema the driver produces:
 *
 * ```
 * created_at   11:59:33.357
 * update()     11:59:33.000   ← updated_at 357 ms EARLIER than created_at
 * ```
 *
 * ## Not #11176, and not a second derivation of the right answer
 *
 * #11176 landed `upsertUpdatedAtStamp()` — the precision-matched form — for the
 * UPSERT door only, deliberately leaving the UPDATE door's emitted SQL alone
 * because that card had not measured it. This one measures it, so the two
 * expressions collapse into ONE helper. §4 pins that collapse behaviourally:
 * whatever the upsert door puts in its payload is what the UPDATE door stamps,
 * character for character.
 *
 * ## Why the ordering invariant rather than the rendered SQL
 *
 * `updated_at >= created_at` is the property a consumer actually reads: an
 * audit answer comparing the two, a "modified since creation?" badge, and above
 * all a millisecond-precision delta cursor (`updated_at > cursor`), which
 * SKIPS every row whose stamp was truncated back below it — the same
 * silent-wrong-answer family as #11067 / #11176 / #11223, reached by a fourth
 * mechanism. §2 asserts that skip is gone by issuing the cursor comparison as
 * real SQL on the server rather than comparing numbers in JS.
 *
 * ## Non-vacuity
 *
 * Truncation is only OBSERVABLE on a row whose `created_at` carried a non-zero
 * millisecond component — roughly 999 inserts in 1000, but not all of them. So
 * every ordering cell runs {@link ROUNDS} independent create+update pairs and
 * asserts at least one of them carried sub-second digits. Without that guard a
 * run in which every `created_at` happened to land on `.000` would report a
 * green that no truncation could have perturbed.
 *
 * Every cell runs on SQLite AND on live Postgres / MySQL through
 * `declareDialectCell`, because "the other dialects do not regress" is a
 * measurement here and not an assumption: Postgres' `CURRENT_TIMESTAMP` is
 * `transaction_timestamp()` at microsecond precision and SQLite's stamp is a
 * JS ISO-8601 string with millis, so neither has anything to truncate — and the
 * emitted SQL on both is asserted UNCHANGED by §5.
 *
 * ## [#11572] §3's instrument is driven, not raced
 *
 * §3 originally fired {@link ROUNDS} updates back to back and required that at
 * least two of them landed on different values. That needs the wall clock to
 * tick at least once during the run — a property of the MACHINE, not of the
 * code — so on a fast enough runner it went red with entirely correct stamping,
 * which is what happened to PR #11570 (a diff touching no file under
 * `packages/drivers/`).
 *
 * What made that expensive rather than merely annoying: **its failure output
 * was byte-identical to the defect it exists to catch.** Truncation collapsing
 * every update in one second onto one value produces exactly one distinct
 * stamp — the same observation a fast runner produces. The discrimination
 * existed only as folklore: a genuine regression reds §1, §2 and §3, a fast run
 * reds only §3, and a reader had to know that and go compare.
 *
 * Measured before rebuilding it, because the frequency was never counted:
 * {@link ROUNDS} sqlite round-trips complete in a MEDIAN of 0.63 ms on the
 * container this was rebuilt on, and back to back on a warm path 41.9% of 2000
 * trials produced a single distinct stamp. Across 40 runs of this file as it
 * actually executes, the cell never went red — but its entire margin was ONE
 * clock tick, with 30% of runs observing exactly two distinct stamps spanning
 * exactly 1 ms. A guard whose margin is one tick is a guard that reds on
 * somebody else's faster machine, which is precisely what CI reported.
 *
 * So the gap is now FORCED and, more importantly, VERIFIED — see
 * {@link awaitClockAdvance}, which re-reads the clock rather than trusting a
 * timer, and {@link MIN_GAP_MS}, which is five times the declared column
 * resolution and three orders of magnitude below the second truncation would
 * need. §3 keeps every part of the real path (the real update door, the real
 * dialect stamp, a real read-back out of storage) and loses only the race. Two
 * consequences worth stating plainly:
 *
 *  - The assertion got STRONGER, not weaker: `ROUNDS` spaced updates must yield
 *    `ROUNDS` distinct stamps, where the old cell asked for two out of six.
 *  - What was traded away is the back-to-back WRITE RATE — §3 no longer fires
 *    its updates as fast as the machine allows. That coverage did not leave the
 *    file: §1, §1b and §2 still create and update with no sleep between them
 *    ("No sleep and no backdating", §1), so the same-millisecond path stays
 *    measured where it belongs. Resolution, §3's actual subject, is not a rate
 *    property.
 *
 * And the folklore is gone: §3's failure message now carries the measured gaps,
 * the measured span and the arithmetic that rules a fast runner out, so the red
 * discriminates itself instead of requiring a reader to check §1 and §2 first.
 *
 * ## [#13691] §3's validity ceiling had to move with §3's conclusion
 *
 * The `span` bound sitting above §3's distinctness assertion is a VALIDITY
 * PRECONDITION, not a claim about the product: it establishes that truncation
 * could not have produced the distinctness §3 then concludes from. Its correct
 * value is therefore whatever the CONCLUSION needs — and #11572 changed the
 * conclusion.
 *
 * #11224's §3 asked for two distinct stamps out of {@link ROUNDS}, and two
 * truncated values need one whole second, so `span < 1000` was the TIGHT bound
 * for it. #11572 strengthened the conclusion to `ROUNDS` distinct stamps —
 * `ROUNDS` multiples of a second cannot span less than `ROUNDS - 1` of them —
 * and wrote exactly that arithmetic into {@link MIN_GAP_MS}'s note in the same
 * commit ("the 5 whole SECONDS second-precision stamps would need to yield
 * `ROUNDS` distinct values"), while leaving the executable bound on the
 * superseded number. From then on this file's prose and its code disagreed by
 * a factor of `ROUNDS - 1`.
 *
 * The cost of that is one-sided, which is what makes it worth a section rather
 * than a comment. An over-strict validity precondition cannot fail in a way
 * that says anything about the product; it can only red on time this test did
 * not have, on somebody else's PR. It did: a merge-queue build on a diff
 * touching no file under `packages/drivers/` reported `span = 1006` — six
 * milliseconds over — while the real invariant (monotonicity, asserted on the
 * line above) HELD, and the same commit passed on a re-queue with nothing
 * changed. Meanwhile #11572's fix spends real wall-clock time inside that same
 * budget by design, so the two guards had come to bound §3 from both sides.
 *
 * {@link MAX_SPAN_MS} is now DERIVED from `ROUNDS` and the truncation grain
 * instead of written as a literal, and the derivation is pinned by arithmetic
 * at the foot of this file, so the two halves cannot drift apart in silence
 * again. ⛔ Nothing #11572 established was traded for it: the clock is still
 * DRIVEN, both gap assertions still run, and the conclusion is still `ROUNDS`
 * distinct stamps.
 *
 * ## Reverse verification (direction predicted before running)
 *
 * Restoring `main`'s `updatedAtStamp()` body turns §1, §2 and §3 red on the
 * live MySQL cell ONLY — with `updated_at` reading a few hundred ms EARLIER
 * than `created_at`, the defect itself as the received value — and turns §4 red
 * on that cell too (`CURRENT_TIMESTAMP` vs `CURRENT_TIMESTAMP(3)`). The SQLite
 * and Postgres cells stay green throughout: the asymmetry, observed rather than
 * argued.
 *
 * ⚠️ [#11572] That ablation says nothing about a runner without a live MySQL.
 * #11224 changed only the NON-sqlite branch, so restoring `main`'s body is a
 * no-op on the SQLite cell — and a green there is not evidence this file
 * guards anything. The ablation that discriminates on the SQLite cell is the
 * defect class written into the branch that cell executes: truncating
 * `new Date().toISOString()` to `.000Z`. Run on the rebuilt file, it reds §1,
 * §2 and §3 and leaves §4/§5 green (the `ISO_Z` shape admits `.000Z`), which is
 * the same three-section signature the MySQL ablation produces.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from './index.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

/** Driver options every write here uses — these fixtures are not tenant-scoped. */
const OPTS = { bypassTenantAudit: true } as any;

/**
 * How many independent create+update pairs each ordering cell measures.
 *
 * Sized for the non-vacuity guard above rather than for coverage: the chance
 * that all six `created_at` defaults land on an exact `.000` millisecond is
 * ~1e-18, so a run that cannot observe truncation fails loudly instead of
 * passing vacuously.
 */
const ROUNDS = 6;

/**
 * [#11572] The real-clock gap §3 forces between two consecutive updates.
 *
 * Sized against the two bounds §3 sits between — and both bounds are ASSERTED
 * in the cell rather than assumed here:
 *
 *  - five times ABOVE the millisecond the audit columns are declared at
 *    (`DATETIME(3)` on MySQL, an ISO string carrying millis on SQLite), so a
 *    stamp that KEPT its resolution cannot put two of these updates on one
 *    value;
 *  - far BELOW the second a truncated stamp would need to tell any two of them
 *    apart. `ROUNDS - 1` gaps of this size span ~25 ms, against the 5 whole
 *    SECONDS second-precision stamps would need to yield `ROUNDS` distinct
 *    values — which is what makes §3's distinctness unreachable by truncation
 *    instead of merely unlikely under it.
 *
 * ⚠️ [#13691] `ROUNDS - 1` gaps of this size is the FLOOR of what the spacing
 * costs, never an estimate of it. {@link awaitClockAdvance} waits with
 * `setTimeout`, whose delivery is bounded by the event loop rather than by the
 * clock, so the spacing is `>= 25 ms` and grows with load with no upper bound
 * in the code. Measured on the container #13691 was fixed on, over 300 trials
 * of the five gaps §3 takes: 26 ms median (64 ms max) on an idle loop, and
 * 60 ms median (86 ms max) with the loop held by a re-scheduling 12 ms hog.
 * That is why {@link MAX_SPAN_MS} is derived from the truncation arithmetic and
 * not from this floor — a budget sized on `ROUNDS * MIN_GAP_MS` would be a
 * budget sized on a number the machine is free to exceed.
 */
const MIN_GAP_MS = 5;

/**
 * [#13691] The grain a SECOND-precision stamp truncates to — the defect class
 * §3 exists to catch, on every cell it runs on.
 *
 * One grain covers the whole matrix because the defect has one shape wherever
 * it can occur: on MySQL an unqualified `CURRENT_TIMESTAMP` truncates to whole
 * seconds (#11224 itself), and the SQLite ablation this file's head note
 * prescribes is that same truncation written into the branch that cell
 * executes (`new Date().toISOString()` forced to `.000Z`). Postgres stamps at
 * microsecond precision and has nothing to truncate, so the bound is vacuous
 * there rather than wrong.
 */
const TRUNCATED_STAMP_GRAIN_MS = 1_000;

/**
 * [#13691] §3's validity ceiling: the span at or above which second-precision
 * truncation could ITSELF have produced the distinctness §3 concludes from.
 *
 * Derived, not chosen. {@link ROUNDS} truncated stamps are `ROUNDS` multiples
 * of {@link TRUNCATED_STAMP_GRAIN_MS}, so they cannot span less than
 * `ROUNDS - 1` whole grains; below that, truncation cannot reach `ROUNDS`
 * distinct values at all, which is precisely what makes §3's distinctness
 * assertion readable as a statement about resolution.
 *
 * ⛔ This is not a raised ceiling. The literal it replaces was the TIGHT bound
 * for the assertion §3 used to make — see the `[#13691]` section of the head
 * note for the drift, and `maxDistinctUnderTruncation` at the foot of this file
 * for the pin that keeps this constant and §3's conclusion from parting company
 * again.
 */
const MAX_SPAN_MS = (ROUNDS - 1) * TRUNCATED_STAMP_GRAIN_MS;

/**
 * [#11572] Block until the process clock has ADVANCED by at least `ms`, and
 * return the advance actually observed.
 *
 * The difference from `await sleep(ms)` is the entire subject of #11572: a
 * timer is a request, and what §3 needs is a fact. This re-reads the clock and
 * keeps waiting until the clock itself agrees, so §3 never assumes a tick
 * happened — it measures the ones it got and quotes them in its own failure
 * message. That is what lets a §3 red be read as a regression without anyone
 * consulting a docblock or comparing which other sections failed.
 *
 * On the live cells the stamp is read from the SERVER's clock rather than this
 * process's. Waiting here still spaces those stamps: the two clocks may sit at
 * different offsets — the matrix insists they do — but they advance through the
 * same real time, so `ms` of elapsed wall time here is `ms` of elapsed wall
 * time there.
 */
async function awaitClockAdvance(ms: number): Promise<number> {
  const start = Date.now();
  for (;;) {
    const observed = Date.now() - start;
    if (observed >= ms) return observed;
    await new Promise((resolve) => setTimeout(resolve, ms - observed));
  }
}

const MANAGED = 'os11224_stamp';
const BULK = 'os11224_bulk';

/** ISO-8601 with an explicit `Z` — the shape SQLite's stamp must keep (#3493 lineage). */
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function managedObject(name: string) {
  return {
    name,
    fields: {
      id: { type: 'text' },
      title: { type: 'string' },
      status: { type: 'string' },
    },
  } as any;
}

/** Whatever the dialect handed back for an audit column, as epoch ms. */
function asInstant(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const text = String(value);
  // SQLite stores TEXT. The canonical form already carries `Z`; a zone-naive
  // legacy form is read as UTC here rather than as host-local, matching what
  // `repairNaiveUtcAuditTimestamp` does on the read path.
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
}

/** Read the audit columns straight out of storage, past every read-side coercion. */
async function readAudit(driver: SqlDriver, table: string, id: string) {
  const row: any = await (driver as any).knex(table).where('id', id).first();
  return {
    createdAt: asInstant(row.created_at),
    updatedAt: asInstant(row.updated_at),
    /** The stored value in the dialect's OWN shape — what a cursor round-trips. */
    rawCreatedAt: row.created_at,
    row,
  };
}

function measure(cell: DialectCell): void {
  describe(`#11224 — the UPDATE door stamps at the audit column's precision (${cell.label})`, () => {
    let driver: SqlDriver;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      // The DDL path, so the audit columns are the ones
      // `createAuditTimestampColumn` produces — `DATETIME(3) default now(3)` on
      // MySQL. That pairing is the whole defect.
      await driver.initObjects([managedObject(MANAGED), managedObject(BULK)]);
    });

    afterAll(async () => {
      await driver?.disconnect();
    });

    // ── §1 The ordering invariant, on a row updated inside its first second ──

    it('§1 never leaves `updated_at` EARLIER than `created_at`', async () => {
      const seen: { id: string; createdAt: number; updatedAt: number }[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const id = `s${i}`;
        await driver.create(MANAGED, { id, title: 'one', status: 'open' }, OPTS);
        // No sleep and no backdating: the row is updated inside the same second
        // it was created in, which is exactly where a truncated stamp lands
        // BEHIND the column's own `now(3)` default.
        await driver.update(MANAGED, id, { title: 'two' }, OPTS);
        seen.push({ id, ...(await readAudit(driver, MANAGED, id)) });
      }

      // Non-vacuity: truncation is invisible on a `created_at` of exactly `.000`.
      const withMillis = seen.filter((r) => r.createdAt % 1000 !== 0);
      expect(
        withMillis.length,
        'no `created_at` in this run carried sub-second digits, so nothing here could ' +
          'have observed a truncated stamp — the cell measured nothing',
      ).toBeGreaterThan(0);

      for (const r of seen) {
        // The defect: on MySQL this was `created_at` truncated to the second,
        // i.e. up to 999 ms in the PAST of a row that had just been created.
        expect(
          r.updatedAt,
          `${r.id}: updated_at ${new Date(r.updatedAt).toISOString()} is EARLIER than ` +
            `created_at ${new Date(r.createdAt).toISOString()}`,
        ).toBeGreaterThanOrEqual(r.createdAt);
      }
    });

    it('§1b holds for the BULK door too — one helper, every UPDATE path', async () => {
      // `update`, `updateMany` and `rotatedUpdateById` all read the same
      // `updatedAtStamp()`, so fixing the expression fixes every one of them.
      // This is the door that would silently keep the old value if a future
      // change gave it a private copy.
      const ids: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const id = `b${i}`;
        ids.push(id);
        await driver.create(BULK, { id, title: 'one', status: 'open' }, OPTS);
      }
      const affected = await driver.updateMany(BULK, { where: { status: 'open' } }, { title: 'two' }, OPTS);
      expect(affected).toBe(ROUNDS);

      const rows = await Promise.all(ids.map((id) => readAudit(driver, BULK, id)));
      expect(rows.filter((r) => r.createdAt % 1000 !== 0).length).toBeGreaterThan(0);
      for (const r of rows) expect(r.updatedAt).toBeGreaterThanOrEqual(r.createdAt);
    });

    // ── §2 The delta cursor, issued as real SQL on the server ────────────────

    it('§2 a millisecond-precision delta cursor does not SKIP the updated row', async () => {
      // The consequence that makes this a silent wrong answer rather than a
      // cosmetic one. The comparison is deliberately made BY THE SERVER, in the
      // column's own type, because that is where an incremental sync makes it —
      // comparing two JS numbers here would measure this test's own parsing.
      const knex = (driver as any).knex;
      const missed: string[] = [];
      let observable = 0;

      for (let i = 0; i < ROUNDS; i++) {
        const id = `c${i}`;
        await driver.create(MANAGED, { id, title: 'one', status: 'sync' }, OPTS);
        // The cursor a delta sync would be holding: the last instant it saw for
        // this row, at the full precision the column stores.
        const before = await readAudit(driver, MANAGED, id);
        if (before.createdAt % 1000 !== 0) observable++;

        await driver.update(MANAGED, id, { title: 'two' }, OPTS);

        const found = await knex(MANAGED).where('id', id).where('updated_at', '>=', before.rawCreatedAt).first();
        if (!found) missed.push(id);
      }

      expect(
        observable,
        'no cursor in this run sat at a sub-second offset, so no truncation could have ' +
          'moved a row below it — the cell measured nothing',
      ).toBeGreaterThan(0);
      // The defect: every row whose `created_at` carried millis was invisible to
      // its own cursor after being updated, so a delta sync silently dropped it.
      expect(missed, `rows skipped by their own delta cursor after update(): ${missed.join(', ')}`).toEqual([]);
    });

    // ── §3 Two updates in the same second stay distinguishable ───────────────

    it('§3 keeps sub-second resolution, so same-second updates are ordered', async () => {
      // Truncation collapses every update inside one second onto one value, so
      // an `order by updated_at` over them is unstable exactly where it matters.
      //
      // [#11572] The clock is DRIVEN here, not raced. This cell used to fire
      // `ROUNDS` updates back to back and require that at least two of them
      // landed on different values — which needs the wall clock to tick at
      // least once during the run, a property of the MACHINE rather than of the
      // code. Measured on the container this was rebuilt on: `ROUNDS` sqlite
      // round-trips complete in a median of 0.63 ms, and over 40 runs of this
      // file the cell's whole margin was ONE tick — 30% of runs observed
      // exactly two distinct stamps spanning exactly 1 ms. It had already gone
      // red on CI (PR #11570, a diff touching nothing under `packages/drivers/`)
      // with entirely correct stamping.
      //
      // Forcing a VERIFIED sub-second gap removes the race without removing the
      // measurement: the write still goes through the real door, the real
      // dialect stamp and a real read-back out of storage. What changes is that
      // the distinctness below is now ENTAILED by the gaps rather than hoped
      // for — so a red is a statement about the code, and says so in its own
      // message instead of leaving the reader to compare which sections failed.
      const id = 'd1';
      await driver.create(MANAGED, { id, title: 'one', status: 'seq' }, OPTS);
      const stamps: number[] = [];
      const gaps: number[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        if (i > 0) gaps.push(await awaitClockAdvance(MIN_GAP_MS));
        await driver.update(MANAGED, id, { title: `t${i}` }, OPTS);
        stamps.push((await readAudit(driver, MANAGED, id)).updatedAt);
      }

      // The INSTRUMENT's own validity, settled before anything is concluded
      // from it: these are the gaps the clock reported back, not the ones the
      // timer was asked for. Nothing below is readable until this holds — an
      // unspaced run is exactly the probabilistic instrument this replaced.
      //
      // The COUNT first, so the bound below cannot pass vacuously: `Math.min()`
      // of an empty list is `Infinity`, so a loop that stopped spacing its
      // updates would satisfy the gap assertion instead of failing it.
      expect(
        gaps.length,
        `[#11572] §3 spaced ${gaps.length} of the ${ROUNDS - 1} intervals between its ${ROUNDS} ` +
          `updates — every update after the first must be preceded by a verified gap, or the ` +
          `distinctness below is racing the machine again for the unspaced ones.`,
      ).toBe(ROUNDS - 1);
      expect(
        Math.min(...gaps),
        `[#11572] §3 could not space its updates: it required ${MIN_GAP_MS} ms of real clock ` +
          `between each of the ${ROUNDS} updates and the clock reported ${gaps.join('/')} ms. ` +
          `Until this holds the distinctness assertion below is racing the machine again.`,
      ).toBeGreaterThanOrEqual(MIN_GAP_MS);

      // Monotone regardless (the invariant), and — the point — the run spans
      // less than the `ROUNDS - 1` whole grains a truncated stamp would need to
      // reach the `ROUNDS` distinct values concluded below. See
      // {@link MAX_SPAN_MS} for why that is `ROUNDS - 1` grains and not one.
      for (let i = 1; i < stamps.length; i++) expect(stamps[i]).toBeGreaterThanOrEqual(stamps[i - 1]);
      const span = stamps[stamps.length - 1] - stamps[0];
      // [#13691] Reported in the failure, because the first question a reader
      // has is which half of the budget went where — and neither half is a
      // product signal.
      const deliberate = gaps.reduce((total, gap) => total + gap, 0);
      expect(
        span,
        `[#13691] §3's VALIDITY PRECONDITION failed, which says nothing about the product: the ` +
          `run spanned ${span} ms, at or above the ${MAX_SPAN_MS} ms (${ROUNDS} - 1 grains of ` +
          `${TRUNCATED_STAMP_GRAIN_MS} ms) a second-precision stamp would need to reach the ` +
          `${ROUNDS} distinct values asserted below — so truncation is no longer ruled out and ` +
          `the distinctness below is unreadable, whichever way it lands. Of that span, ` +
          `${deliberate} ms was clock-advance spacing this cell spent ON PURPOSE ` +
          `(${gaps.join('/')} ms) and ${span - deliberate} ms was everything else (round-trips ` +
          `and scheduling). The ordering invariant asserted on the line above is unaffected ` +
          `either way — read this as a slow runner, not as a regression.`,
      ).toBeLessThan(MAX_SPAN_MS);

      // The property, now entailed rather than raced: with every update spaced
      // by a measured gap five times the declared resolution, a stamp that kept
      // that resolution has to produce one value per update.
      const distinct = new Set(stamps).size;
      expect(
        distinct,
        `[#11572] the ${ROUNDS} updates collapsed onto ${distinct} instant(s) — and a fast ` +
          `runner CANNOT explain it. Each update was spaced by a clock-verified gap ` +
          `(${gaps.join('/')} ms, every one at or above ${MIN_GAP_MS} ms) across a total span of ` +
          `${span} ms, so a stamp holding the millisecond resolution its audit column is declared ` +
          `at must produce ${ROUNDS} distinct values here; second-precision truncation produces 1 ` +
          `and would need whole SECONDS, not ${span} ms, to produce more. Stamps: ` +
          `${stamps.join(', ')}. Read this as a resolution regression in updatedAtStamp() — not ` +
          `as a timing artifact, and without comparing which other sections failed.`,
      ).toBe(ROUNDS);
    });

    // ── §4 The two stamp helpers collapsed into one ──────────────────────────

    it('§4 stamps the UPSERT door and the UPDATE door with the identical expression', async () => {
      // #11176 carried the precision-matched form as a SECOND helper
      // (`upsertUpdatedAtStamp`) so it could fix the upsert door without
      // changing the SQL every `update()` emits. This card measured that SQL, so
      // there is one helper again — and this is the assertion that stays red if
      // a future change re-forks them.
      const upsertPayload: Record<string, any> = {};
      (driver as any).stampUpsertUpdatedAt(MANAGED, upsertPayload);
      const updateStamp = (driver as any).updatedAtStamp();

      if (cell.id === 'sqlite') {
        // Both are JS-side ISO strings, so they differ by the millisecond they
        // were taken in; the SHAPE is what has to agree.
        expect(String(upsertPayload.updated_at)).toMatch(ISO_Z);
        expect(String(updateStamp)).toMatch(ISO_Z);
      } else {
        // Rendered SQL, character for character. Before this card the MySQL cell
        // read `CURRENT_TIMESTAMP(3)` here and `CURRENT_TIMESTAMP` there.
        expect(String(upsertPayload.updated_at)).toBe(String(updateStamp));
      }
    });

    // ── §5 The other dialects' emitted SQL is UNCHANGED ──────────────────────

    it('§5 emits the expression this dialect defaults its audit column with', async () => {
      // Not a restatement of §1: this pins WHICH form each dialect gets, so a
      // future "just add (3) everywhere" cannot pass §1 while changing the SQL
      // Postgres and SQLite emit.
      const stamp = String((driver as any).updatedAtStamp());
      switch (cell.id) {
        case 'mysql':
          // Matched to `createAuditTimestampColumn`'s `DATETIME(3) default now(3)` (#3942).
          expect(stamp).toBe('CURRENT_TIMESTAMP(3)');
          break;
        case 'pg':
          // Unchanged: `CURRENT_TIMESTAMP` is `transaction_timestamp()` at
          // microsecond precision against a `timestamptz` column — nothing to match.
          expect(stamp).toBe('CURRENT_TIMESTAMP');
          break;
        default:
          // Unchanged: SQLite has no temporal type, and the stamp is the same
          // zone-EXPLICIT ISO-8601 string the insert paths write.
          expect(stamp).toMatch(ISO_Z);
      }
    });

    // ── §6 #3493's historical import still wins ──────────────────────────────

    it('§6 still preserves a caller-supplied `updated_at` under `preserveAudit`', async () => {
      // The precision change must not reach the one caller allowed to pin the
      // value — otherwise a historical import silently starts being force-advanced.
      const id = 'e1';
      const supplied = new Date(Date.parse('2020-01-01T00:00:00.000Z'));
      await driver.create(MANAGED, { id, title: 'one', status: 'import' }, OPTS);
      await driver.update(
        MANAGED,
        id,
        { title: 'two', updated_at: (driver as any).isSqlite ? supplied.toISOString() : supplied },
        { ...OPTS, preserveAudit: true },
      );
      const after = await readAudit(driver, MANAGED, id);
      expect(after.updatedAt).toBe(supplied.getTime());
      expect(after.row.title).toBe('two');
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'update stamp precision (#11224)', measure);
}

/**
 * [#13691] The most distinct values SECOND-precision truncation can show across
 * a span of `ms` — the model {@link MAX_SPAN_MS} is derived from.
 *
 * Truncated stamps are multiples of {@link TRUNCATED_STAMP_GRAIN_MS}, so a span
 * of `ms` covers at most `floor(ms / grain) + 1` of them.
 */
function maxDistinctUnderTruncation(ms: number): number {
  return Math.floor(ms / TRUNCATED_STAMP_GRAIN_MS) + 1;
}

// ── The coupling #11572 broke, asserted instead of commented ─────────────────
//
// §3's ceiling and §3's conclusion are two halves of one argument, and they
// drifted apart in silence: #11572 strengthened the conclusion from "at least
// two distinct" to "`ROUNDS` distinct" and left the ceiling on the number that
// had been tight for the OLD conclusion. Nothing failed at the time — the
// precondition merely became `ROUNDS - 1` times stricter than its own argument
// needed, and stayed that way until a slow runner paid for it on an unrelated
// PR.
//
// So the relationship is pinned. It runs on every runner with no server and no
// clock: this is arithmetic about the defect class, not a measurement of the
// machine, and it is the assertion that reds if the ceiling is ever put back on
// a literal belonging to a superseded conclusion.
describe("#13691 — §3's span ceiling is the tight bound for §3's conclusion", () => {
  it('rules truncation out below the ceiling, and is not stricter than that above it', () => {
    // SOUND — one millisecond under the ceiling, truncation cannot reach the
    // `ROUNDS` distinct values §3 concludes from. This is the whole reason the
    // precondition exists, and it is the leg a LOOSENED ceiling reds.
    expect(
      maxDistinctUnderTruncation(MAX_SPAN_MS - 1),
      `a span of ${MAX_SPAN_MS - 1} ms must leave second-precision truncation unable to reach ` +
        `${ROUNDS} distinct stamps, or §3's distinctness assertion concludes nothing`,
    ).toBeLessThan(ROUNDS);

    // TIGHT — at the ceiling truncation CAN reach them, so the ceiling is not
    // stricter than the argument requires. This is the leg a ceiling restored
    // to `1_000` reds, and over-strictness here is not conservatism: a validity
    // precondition cannot fail informatively, so every millisecond of slack it
    // demands is a false red carrying no product signal.
    expect(
      maxDistinctUnderTruncation(MAX_SPAN_MS),
      `the ceiling is ${MAX_SPAN_MS} ms, but second-precision truncation still cannot reach ` +
        `${ROUNDS} distinct stamps at that span — so the precondition is stricter than §3's own ` +
        `argument needs, and the excess can only ever red on time the run did not have`,
    ).toBeGreaterThanOrEqual(ROUNDS);
  });

  it("is the number #11224's superseded conclusion needed, one grain for two stamps", () => {
    // Why `1_000` was right until #11572 and wrong after it, kept executable so
    // the head note's history is checkable rather than remembered: the original
    // §3 asked for TWO distinct stamps, and two need exactly one grain.
    expect(maxDistinctUnderTruncation(TRUNCATED_STAMP_GRAIN_MS - 1)).toBe(1);
    expect(maxDistinctUnderTruncation(TRUNCATED_STAMP_GRAIN_MS)).toBe(2);
  });
});
