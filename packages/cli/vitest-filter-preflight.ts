// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A vitest FILE FILTER that selected nothing must say so — even when the rest
 * of the same run selected something (#17853).
 *
 * ## The defect this closes, and the half vitest already covers
 *
 * `vitest run` reads bare positional arguments as FILE FILTERS. When EVERY
 * filter selects nothing, vitest is already loud, and this module adds nothing
 * to that case: `printNoTestFound()` prints `No test files found, exiting with
 * code 1` together with the filters and the projects, and the run is red.
 * Measured on this tree with vitest 4.1.11:
 *
 *     pnpm --filter @objectstack/cli exec vitest run --project unit \
 *       test/i18n-extract-companion-orphan.test.ts
 *     => exit 1, `No test files found, exiting with code 1`
 *
 * ⭐ THE GAP IS THE PARTIAL CASE, and it is the one that costs dispatch rounds.
 * Once at least one filter selects a file, the filters that selected NOTHING
 * are dropped with no diagnostic of any kind. Measured on this tree, same
 * binary, four unit-tier files plus one integration-tier file, `--project
 * unit`:
 *
 *     Test Files  3 failed | 1 passed (4)      <- FIVE paths named, four counted
 *          Tests  4 passed (4)
 *
 * The run naming only the FOUR unit-tier paths prints those same two lines.
 * `diff` over the two captures is empty but for timestamps, durations and file
 * ordering, and the discarded path's name appears NOWHERE in vitest's own
 * output — the one occurrence in a captured terminal is pnpm's own echo of the
 * argv in `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`, which pnpm prints only when the
 * run was already red and which is therefore absent from exactly the green run
 * that needed it.
 *
 * ⇒ "I named five paths and one was silently discarded" is byte-identical to
 * "I named four paths", which is indistinguishable from "ran and passed". That
 * is the failure direction AGENTS.md ranks BELOW having no verifier at all
 * (Route & surface ownership §3, "Absence must be loud"): a verifier that
 * silently degrades reports success.
 *
 * ⚠️ It has been paid for once already. #16872's delivering dev verified with
 * `--project unit` over a named set, read green, pushed, and CI went red on
 * `Test Core` with the failing assertion inside an integration-tier file that
 * the local run had discarded.
 *
 * ## The seam, and why it is a reporter rather than an argv parse
 *
 * The obvious implementation — parse `process.argv` in `vitest.config.ts` —
 * cannot be made correct without restating vitest's option table: a bare token
 * is a filter only if the token before it did not consume it, and which flags
 * consume a value is vitest's business and changes with vitest. A predicate
 * built on a guess is exactly the artifact this card was filed about.
 *
 * So nothing is guessed. Vitest hands both halves over:
 *
 *   - `Vitest.filenamePattern` IS the CLI filter list. `Vitest.start(filters)`
 *     assigns it before resolving any specification, so it is already set when
 *     reporters are called.
 *   - `onTestRunStart(specifications)` IS the resolved set — what vitest
 *     actually collected, after `include`, after `--project`, after filtering.
 *
 * ⛔ `onInit` is TOO EARLY and must not be used for the reading: `start()`
 * reports `onInit` in a `finally` block that runs BEFORE `filenamePattern` is
 * assigned, so a reporter that reads it there sees the previous run's value or
 * nothing at all. `onInit` here only captures the Vitest instance.
 *
 * `vitest list` does not go through `start()` and runs no reporters, so this
 * module is inert for it — which is what keeps `test/vitest-tiers-partition.test.ts`,
 * whose whole instrument is `vitest list --filesOnly`, reading exactly what it
 * read before.
 *
 * ## The matcher is vitest's own, mirrored rather than approximated
 *
 * `matchesVitestFilter` below is a transcription of `TestProject.filterFiles`
 * as shipped in vitest 4.1.11 (`dist/chunks/cli-api.*.js`): case-insensitive
 * substring of the project-relative path, plus the absolute-prefix and
 * relative-spelling arms. It is transcribed, not invented, because the whole
 * value of this preflight is that its idea of "selected" equals vitest's. When
 * vitest is upgraded, re-read that function; a divergence here can only ever
 * produce a wrong diagnostic, never a wrong run.
 *
 * ⚠️ Two boundaries, stated rather than discovered later:
 *   - The win32 `slash()` normalisation vitest applies to filters is NOT
 *     mirrored; this repo's CI and containers are Linux, and the omission can
 *     only mis-attribute a diagnostic on a platform the suite is not run on.
 *   - `--changed` / `--related` runs set no `filenamePattern`, so they are
 *     outside this preflight entirely, which is correct: nothing was named.
 *
 * ## Direction ②, which is the half that makes this accurate rather than loud
 *
 * `renderLostFilterNotice` returns the EMPTY STRING when no filter was lost,
 * and the reporter writes nothing at all in that case. A normal run — no
 * filters, or filters that all selected something — therefore contributes zero
 * bytes of new output. `test/vitest-project-filter-preflight.test.ts` pins both
 * directions of that, and pins that this module is still wired into
 * `vitest.config.ts`'s `reporters`, because a preflight nobody registered is
 * the same phantom check in a new place.
 */

import { isAbsolute, join, relative, resolve } from 'node:path';

/** The shape of a vitest `TestSpecification` this module reads. */
export interface SpecificationLike {
  readonly moduleId: string;
}

/** The shape of a vitest `TestProject` this module reads. */
export interface ProjectLike {
  readonly name?: string | undefined;
}

/** The shape of the `Vitest` instance this module reads. */
export interface VitestLike {
  readonly filenamePattern?: readonly string[] | undefined;
  readonly projects?: readonly ProjectLike[] | undefined;
}

/** A CLI filter that selected no test file, and where its target actually lives. */
export interface LostFilter {
  /** The filter exactly as the caller spelled it on the command line. */
  readonly filter: string;
  /**
   * Names of the declared populations (here: tier / project names) that DO
   * contain a file this filter would have selected. Empty means the filter
   * matches nothing in this package at all — a typo, or a path that moved.
   */
  readonly foundIn: readonly string[];
}

/** Populations to attribute a lost filter to, by name — `{ unit, integration }`. */
export type Populations = Readonly<Record<string, readonly string[]>>;

/**
 * `TestProject.filterFiles`, vitest 4.1.11, transcribed. `absFile` is an
 * absolute module id; `root` is the project root the paths are relative to.
 */
export function matchesVitestFilter(absFile: string, filter: string, root: string): boolean {
  const testFile = relative(root, absFile).toLocaleLowerCase();
  if (isAbsolute(filter) && absFile.startsWith(filter)) return true;
  const relativePath = filter.endsWith('/')
    ? join(relative(root, filter), '/')
    : relative(root, filter);
  return (
    testFile.includes(filter.toLocaleLowerCase()) ||
    testFile.includes(relativePath.toLocaleLowerCase())
  );
}

/**
 * Which of `filters` selected none of `collected`, and which declared
 * population each of those would have matched instead.
 *
 * Pure: `node:path` only, no filesystem and no vitest. `collected` is the
 * absolute module id of every specification vitest actually resolved;
 * `populations` maps a name to package-root-relative paths.
 */
export function lostFilters(
  filters: readonly string[],
  collected: readonly string[],
  populations: Populations,
  root: string,
): LostFilter[] {
  return filters
    .filter((f) => !collected.some((abs) => matchesVitestFilter(abs, f, root)))
    .map((f) => ({
      filter: f,
      foundIn: Object.entries(populations)
        .filter(([, rels]) => rels.some((rel) => matchesVitestFilter(resolve(root, rel), f, root)))
        .map(([name]) => name),
    }));
}

/**
 * The diagnostic, or the EMPTY STRING when nothing was lost.
 *
 * ⛔ The empty string is the contract, not an implementation detail: it is what
 * makes a normal run byte-identical. Anything that would print on a healthy run
 * belongs somewhere else.
 */
export function renderLostFilterNotice(
  lost: readonly LostFilter[],
  totalFilters: number,
  selectedProjects: readonly string[],
): string {
  if (lost.length === 0) return '';

  const selected = selectedProjects.length
    ? `project ${selectedProjects.map((p) => `\`${p}\``).join(' + ')}`
    : 'every project';
  const lines: string[] = [
    '',
    `  !! FILTER SELECTED NOTHING — ${lost.length} of the ${totalFilters} path(s) you named ran no tests.`,
    '',
  ];

  for (const { filter, foundIn } of lost) {
    lines.push(`     ${filter}`);
    lines.push(
      foundIn.length
        ? `       lives in the ${foundIn.map((n) => `\`${n}\``).join(' / ')} tier; this run selected ${selected}.`
        : `       matches no test file in this package at all — check the path.`,
    );
    if (foundIn.length) {
      lines.push(
        `       run it:  pnpm --filter @objectstack/cli exec vitest run --project ${foundIn[0]} ${filter}`,
      );
    }
    lines.push('');
  }

  lines.push(
    '     ⛔ Nothing below counts the path(s) above: the file count, the pass/fail',
    '        totals and the exit code are about the OTHER named paths only.',
    '        To run every tier, which is what CI runs:',
    '          pnpm --filter @objectstack/cli test',
    '',
  );
  return lines.join('\n');
}

/**
 * The vitest reporter. Writes the notice to stderr at the START of the run (so
 * it precedes the results) and again at the END (so it survives the summary,
 * which is where a reader looks for `Test Files N passed`). Writes nothing —
 * not one byte — when no filter was lost.
 */
export function tierFilterPreflight(options: { root: string; populations: Populations }): {
  onInit(vitest: VitestLike): void;
  onTestRunStart(specifications: readonly SpecificationLike[]): void;
  onTestRunEnd(): void;
} {
  const { root, populations } = options;
  let vitest: VitestLike | undefined;
  let notice = '';

  return {
    onInit(v) {
      // ⛔ `filenamePattern` is NOT readable yet — see this file's header.
      vitest = v;
    },
    onTestRunStart(specifications) {
      const filters = vitest?.filenamePattern ?? [];
      notice = '';
      if (filters.length === 0) return;
      const collected = [...new Set(specifications.map((s) => s.moduleId))];
      // ⛔ Read the selected projects from vitest, never from what was collected:
      // when EVERY filter is lost nothing is collected, and an inferred list
      // would then report "every project" for a run that named one.
      // `--project X` narrows `Vitest.projects` itself — `printNoTestFound`
      // reads the same array to print its own `|unit|` block.
      const selectedProjects = (vitest?.projects ?? [])
        .map((p) => p.name)
        .filter((n): n is string => Boolean(n));
      notice = renderLostFilterNotice(
        lostFilters(filters, collected, populations, root),
        filters.length,
        selectedProjects,
      );
      if (notice) process.stderr.write(notice);
    },
    onTestRunEnd() {
      if (notice) process.stderr.write(notice);
    },
  };
}
