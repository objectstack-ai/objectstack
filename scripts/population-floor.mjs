// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * population-floor -- the ONE row-walk, the ONE refusal wording and the ONE
 * provenance line the gates that floor a DERIVED population share.
 *
 * ## What this module is for
 *
 * A gate that sweeps a population and reports findings cannot tell "swept
 * everything, found nothing" from "swept nothing". Both are the ABSENCE of a
 * finding, and both print the line a clean tree prints. The repair is a floor
 * on the derived population plus a provenance line on every green run, and
 * three gates now carry it:
 *
 *   check-engine-double-contract.mjs   4 rows   walk -> parse -> pin
 *   check-type-check-coverage.mjs      3 rows   enumeration -> walk (x2)
 *   check-dual-build-cjs-loads.mjs     5 rows   manifests -> entries -> parse
 *
 * The mechanism was hand-typed in each, under two names (`floorProblem` in the
 * precedent, `populationFloorProblem` in the two copied from it), and the
 * REFUSAL WORDING was re-typed with it. That wording is the thing an operator
 * acts on, so three hand-written copies of it are three places for it to drift
 * -- invisibly, because each gate's `--self-test` asserts only its own text.
 *
 * ## ⛔ The row tables are NOT here, deliberately
 *
 * What is shared is the row-WALK and the refusal FORMATTING. The rows are not:
 * the three tables have no row in common, and each `why` is a specific claim
 * about that gate's internals ("`walk()` swallows a readdir failure ...",
 * "SOURCES_COVERED is decided against this half of the same walk ..."). Pulling
 * the tables in here would throw away each gate's own knowledge and replace it
 * with prose that is true of nothing in particular. Each gate declares its own
 * rows and hands them over; this module decides nothing about which populations
 * matter.
 *
 * ## Inert on import
 *
 * No CLI, no top-level statement that runs anything, per `check:entry-guard`'s
 * second rule -- a `scripts/**` file that exports a binding AND runs on import
 * makes its whole top level run inside the importer. Two of the three gates
 * keep their floor functions module-local for exactly that reason (their top
 * level IS their dispatch); a module that only ever exports is what lets them
 * share one implementation without either of them growing an entry guard.
 *
 * ## ⛔ No `--self-test` of its own, and why that is not the usual answer
 *
 * The shared `scripts/` modules that lint.yml runs a self-test for
 * (`invoked-as`, `ts-parse`, `js-comment-mask`, `import-prerequisite`) are
 * pinned at the module because the gates routing to them assert ROUTING and
 * never behaviour -- nothing downstream checks that `ts-parse` still refuses.
 * That is not the shape here. All three importers drive these two functions as
 * pure functions over their own row tables and assert the OUTPUT: the refusal
 * text, the ref it cites, which row wins, that a missing count is zero, and the
 * provenance deltas in both directions -- 60+ assertions in three batteries,
 * each with a pinned case floor, all run by `package.json`'s own `check:*`
 * scripts. After this extraction every one of them exercises THIS code. A
 * fifth `run_self_test` line would add a workflow file to the change and buy
 * coverage that already exists three times over. Recorded as a considered
 * omission, not an oversight.
 */

/**
 * The tail of every refusal. One wording, spelled once.
 *
 * It says WHICH population fell and nothing about why the others stand,
 * because a message that listed every way a scan can collapse would put causes
 * that did not occur in front of the reader. True of every gate here: each
 * walks several rows and reports the first to fall.
 */
const REFUSAL_TAIL = '  ⛔ NOT a pass: nothing, or nearly nothing, was read. This says WHICH population fell and\n'
  + '  nothing about why the others stand — they are reported by their own rows.';

/**
 * The tail of every provenance line. The delta is INFORMATION, never a verdict:
 * these populations move in both directions for good reasons -- a package
 * leaving the workspace, a fake engine replaced by a real one -- and only the
 * floors decide.
 */
const PROVENANCE_TAIL = '  ⚠ The delta is information, not a verdict — this population grows AND shrinks for good'
  + ' reasons, and only the floors decide.';

/**
 * One floor row: a count this gate derives, the floor it must clear, and the
 * measurement the floor came from.
 *
 * @typedef {object} PopulationFloorRow
 * @property {string} key    The name of this count in the `counts` object, and
 *                           its column name on the provenance line.
 * @property {number} min    The floor. ⛔ Never above `measured` -- a floor over
 *                           its own record reds a healthy tree.
 * @property {number} measured  What the census recorded for this count.
 * @property {string} what   What the count counts, as the refusal names it.
 * @property {string} why    Why a run below the floor is a refusal and not a
 *                           pass -- a claim about THIS gate's internals, which
 *                           is why it lives in the gate and not in here.
 * @property {string} [at]   The ref `measured` was taken on, when this row's
 *                           number comes from a DIFFERENT census than the
 *                           gate's main record. Defaults to `spec.ref`.
 */

/**
 * Bind the row-walk and the provenance line to one gate's row table.
 *
 * Returns the two functions the gate calls, under the one spelling all three
 * use, so every existing call site and every self-test case reads unchanged.
 *
 * @param {object} spec
 * @param {string} spec.ref  The commit the census was taken on. Read from the
 *   frozen record rather than restated, so a count and its provenance cannot be
 *   edited apart.
 * @param {PopulationFloorRow[]} spec.rows  Walked in order; the FIRST row below
 *   its floor is the one reported.
 * @param {string[]} [spec.provenance]  The keys to print on the provenance
 *   line, when that is not every row -- a count can be worth a floor without
 *   being worth a column (`check-dual-build-cjs-loads`'s `typedJudged` comes
 *   from a second census and would put a second ref on a one-ref line).
 *   Defaults to every row, in row order.
 * @param {string} [spec.reproduce]  One sentence appended to the provenance
 *   tail, pointing at where THIS gate records how to reproduce its census.
 * @returns {{populationFloorProblem: (counts?: Record<string, number>) => string | null,
 *            populationProvenanceLine: (counts?: Record<string, number>) => string}}
 */
export function definePopulationFloor(spec) {
  const { ref, rows } = spec;
  const columns = spec.provenance ?? rows.map((row) => row.key);
  const byKey = new Map(rows.map((row) => [row.key, row]));
  for (const key of columns) {
    if (!byKey.has(key)) {
      // A provenance column naming no row would print `undefined` into the one
      // line a reader checks the record against. Loud here, at module load, so
      // it can never be a runtime surprise inside a refusal.
      throw new Error(`population-floor: provenance column "${key}" names no floor row`);
    }
  }
  const reproduce = spec.reproduce ? ` ${spec.reproduce}` : '';

  /**
   * The first floor a run falls below, as a refusal message -- or `null` when
   * every count clears. Pure, so a `--self-test` drives every row with no tree.
   *
   * ⛔ A missing count is ZERO, never "unmeasured but fine": a collector that
   * stopped reporting is exactly the failure the floor exists for.
   */
  function populationFloorProblem(counts) {
    for (const row of rows) {
      const got = counts?.[row.key] ?? 0;
      if (got >= row.min) continue;
      return `measured only ${got} ${row.what}, below the floor of ${row.min} `
        + `(${row.measured} on ${row.at ?? ref}).\n`
        + `  ${row.why}\n`
        + REFUSAL_TAIL;
    }
    return null;
  }

  /**
   * The provenance footer for a PASSING run: what this run read, the floors it
   * cleared, and the census those floors were derived from, side by side.
   *
   * The floors are inequalities on purpose, so no passing run can contradict
   * the record. Without this line the record could stop describing the tree
   * with nothing anywhere saying so, and every green log would look identical
   * either way. Pure.
   */
  function populationProvenanceLine(counts) {
    const got = columns.map((key) => counts?.[key] ?? 0);
    const rec = columns.map((key) => byKey.get(key).measured);
    const floors = columns.map((key) => byKey.get(key).min);
    const delta = got.map((g, i) => (g === rec[i] ? '=' : `${g > rec[i] ? '+' : ''}${g - rec[i]}`));
    return `  provenance — ${columns.join('/')}: this run ${got.join('/')}`
      + ` · floors ${floors.join('/')} · derived from ${rec.join('/')} measured on ${ref}`
      + ` (${delta.join('/')} vs the record).\n`
      + PROVENANCE_TAIL + reproduce;
  }

  return { populationFloorProblem, populationProvenanceLine };
}
