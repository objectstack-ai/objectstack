// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A vitest FILE FILTER that selects nothing must say so — even when the rest
 * of the same run selects something (#17853).
 *
 * ## The defect this closes, and the half vitest already covers
 *
 * `vitest run` reads bare positional arguments as FILE FILTERS. When EVERY
 * filter selects nothing, vitest is already loud and this module adds nothing:
 * `printNoTestFound()` prints `No test files found, exiting with code 1`
 * together with the filters and the projects, and the run is red. Measured on
 * this tree, vitest 4.1.11:
 *
 *     pnpm --filter @objectstack/cli exec vitest run --project unit \
 *       test/i18n-extract-companion-orphan.test.ts
 *     => exit 1, `No test files found, exiting with code 1`
 *
 * ⭐ THE GAP IS THE PARTIAL CASE, and it is the one that costs dispatch rounds.
 * Once at least one filter selects a file, the filters that selected NOTHING
 * are dropped with no diagnostic of any kind. Measured on this tree, same
 * binary, two unit-tier files plus one integration-tier file, `--project unit`:
 * the run prints the same `Test Files (2)` summary as the run naming only the
 * two, and `diff` over the two captures is empty but for timestamps and
 * durations. The discarded path's name appears NOWHERE in vitest's own output
 * — the one occurrence in a captured terminal is pnpm's echo of the argv in
 * `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`, which pnpm prints only when the run was
 * already red and which is therefore absent from exactly the green run that
 * needed it.
 *
 * ⇒ "I named three paths and one was silently discarded" is byte-identical to
 * "I named two paths", which is indistinguishable from "ran and passed" — the
 * failure direction AGENTS.md ranks BELOW having no verifier at all (Route &
 * surface ownership §3: a verifier that silently degrades reports success).
 *
 * ⚠️ It has been paid for once already. #16872's delivering dev verified with
 * `--project unit` over a named set, read green, pushed, and CI went red on
 * `Test Core` with the failing assertion inside an integration-tier file that
 * the local run had discarded.
 *
 * ## ⛔ WHY THIS IS NOT A REPORTER, which was the first thing tried
 *
 * A reporter is the obvious seam — `Vitest.filenamePattern` is the CLI filter
 * list and `onTestRunStart(specifications)` is the resolved set, both read from
 * vitest rather than derived. It was built that way first and MEASURED, and the
 * measurement rejected it: naming `test.reporters` at all replaces vitest's own
 * defaulting rather than extending it, and that defaulting is not a constant.
 * `resolveConfig` does this ONLY when `reporters` is left empty:
 *
 *     if (!resolved.reporters.length) {
 *       resolved.reporters.push([isAgent ? 'agent' : 'default', {}]);
 *       if (process.env.GITHUB_ACTIONS === 'true')
 *         resolved.reporters.push(['github-actions', {}]);
 *     }
 *
 * So `reporters: ['default', preflight]` has two costs, one measured here and
 * one that would only have shown up in CI:
 *   - it pins `default` where an agent terminal would have got `agent`, which
 *     changed a control run's output by two lines — a direct violation of the
 *     requirement that a healthy narrowed run stay byte-identical; and
 *   - it would have DROPPED the `github-actions` reporter on every CI run,
 *     silently removing the failure annotations, in the one environment the
 *     control run above cannot observe.
 *
 * ⇒ The reporter list belongs to vitest. This preflight runs at CONFIG LOAD
 * instead and touches no vitest seam at all.
 *
 * ## What it reads, and why nothing here parses argv by hand
 *
 * `process.argv` is parsed by `parseCLI` from `vitest/node` — vitest's OWN
 * exported parser, the same one the `vitest` binary uses — so which flags
 * consume a following token is vitest's business and stays vitest's business.
 * ⛔ A hand-rolled scan cannot be made correct without restating vitest's option
 * table, and a predicate built on a guess is exactly the artifact this card was
 * filed about.
 *
 * The other input is the two tier arrays the config already derives and hands
 * to the projects as their `include`. That is what makes the derivation exact
 * rather than approximate: each project's `include` IS an exact-path list (the
 * config header's `:613`) and the two are a partition (`:583`), so what a run
 * will collect for a filter is computable from the same arrays vitest is about
 * to be given. ⛔ No second derivation and no second walk — a copy of a fact
 * already on disk is how the frozen tier list went stale before #14554.
 *
 * `matchesVitestFilter` is a transcription of `TestProject.filterFiles` as
 * shipped in vitest 4.1.11 (`dist/chunks/cli-api.*.js`), and the `:LINE` suffix
 * is stripped exactly as `parseFilter` strips it. Transcribed, not invented:
 * the whole value of this preflight is that its idea of "selected" equals
 * vitest's. On a vitest upgrade, re-read those two functions.
 *
 * ## ⛔ Every uncertainty resolves to SILENCE, never to a guess
 *
 * The preflight declines — printing nothing, leaving the run exactly as it was
 * — whenever it cannot model the invocation: an argv `parseCLI` refuses, a
 * `--project` value that is not one of the tier names (a negation or a glob),
 * or a `--changed` / `--related` run, where nothing was named by hand. Silence
 * is the status quo, so declining can never make a run worse than it is today;
 * a guess could.
 *
 * ## Direction ②, the half that makes this accurate rather than merely loud
 *
 * `renderLostFilterNotice` returns the EMPTY STRING when no filter was lost,
 * and nothing is written in that case. A normal run — no filters, or filters
 * that all selected something — contributes zero bytes of new output.
 * `test/vitest-project-filter-preflight.test.ts` pins both directions and pins
 * that this module is still wired into `vitest.config.ts`, because a preflight
 * nobody invoked is the same phantom check in a new place.
 */

import { isAbsolute, join, relative, resolve } from 'node:path';

/** Populations to match a filter against, by name — `{ unit, integration }`. */
export type Populations = Readonly<Record<string, readonly string[]>>;

/** One positional filter: what the caller typed, and the path vitest matches with. */
export interface CliFilter {
  /** Exactly as spelled on the command line, `:LINE` suffix included. */
  readonly spelled: string;
  /** The filename half, which is what vitest matches against. */
  readonly path: string;
}

/** What this preflight could make of the command line. */
export interface Invocation {
  readonly filters: readonly CliFilter[];
  /** Project names selected by `--project`; empty means every project. */
  readonly projects: readonly string[];
  /**
   * True when the invocation is scoped by something this preflight does not
   * model. ⛔ An opaque invocation is reported on by staying silent.
   */
  readonly opaque: boolean;
}

/** A filter that selected nothing, and where its target actually lives. */
export interface LostFilter {
  readonly filter: CliFilter;
  /**
   * Population names that DO hold a file this filter would have selected.
   * Empty means it matches nothing in this package at all — a typo, or a path
   * that moved.
   */
  readonly foundIn: readonly string[];
}

const EMPTY: Invocation = { filters: [], projects: [], opaque: true };

/** `parseFilter`, vitest 4.1.11: a trailing `:<digits>` is a line number. */
export function splitLineSuffix(filter: string): CliFilter {
  const colon = filter.lastIndexOf(':');
  if (colon === -1) return { spelled: filter, path: filter };
  const tail = filter.slice(colon + 1);
  return /^\d+$/.test(tail)
    ? { spelled: filter, path: filter.slice(0, colon) }
    : { spelled: filter, path: filter };
}

/**
 * `TestProject.filterFiles`, vitest 4.1.11, transcribed. `relFile` is a
 * project-root-relative test path; `root` is that project root.
 *
 * ⚠️ The win32 `slash()` normalisation vitest applies to filters is NOT
 * mirrored — this repo's CI and containers are Linux, and the omission could
 * only ever mis-aim a diagnostic, never a run.
 */
export function matchesVitestFilter(relFile: string, filter: string, root: string): boolean {
  const testFile = relFile.toLocaleLowerCase();
  if (isAbsolute(filter) && resolve(root, relFile).startsWith(filter)) return true;
  const relativePath = filter.endsWith('/')
    ? join(relative(root, filter), '/')
    : relative(root, filter);
  return (
    testFile.includes(filter.toLocaleLowerCase()) ||
    testFile.includes(relativePath.toLocaleLowerCase())
  );
}

/**
 * Read the command line with vitest's own parser.
 *
 * ⛔ Any refusal returns an OPAQUE invocation rather than a partial reading:
 * `parseCLI` throws on an argv it does not recognise, and a preflight that
 * guessed past that would be the very defect this module exists to report.
 */
export function parseInvocation(argv: readonly string[], parse: CliParse): Invocation {
  let parsed: { filter: string[]; options: CliParseResultOptions };
  try {
    parsed = parse(['vitest', ...argv.slice(2)], { allowUnknownOptions: true });
  } catch {
    return EMPTY;
  }
  const { filter, options } = parsed;
  // `--changed` / `--related` select by provenance, not by a path anyone typed.
  if (options.changed || options.related) return EMPTY;
  const project = options.project;
  const projects =
    project === undefined ? [] : (Array.isArray(project) ? project : [project]).map(String);
  return { filters: filter.map(splitLineSuffix), projects, opaque: false };
}

/**
 * The three `parseCLI` options this module reads, typed STRUCTURALLY so that
 * vitest's own `CliOptions` satisfies it without a cast.
 *
 * ⛔ Not `Record<string, unknown>`: an interface has no index signature, so
 * vitest's `CliOptions` is not assignable to one, and the cast that would paper
 * over it is exactly what stops a vitest upgrade from reporting a renamed
 * option here as a type error. `packages/cli/test/…preflight.test.ts` passes the
 * real `parseCLI` in unaltered, so this compatibility is pinned, not assumed.
 */
export interface CliParseResultOptions {
  readonly project?: string | string[] | undefined;
  readonly changed?: boolean | string | undefined;
  readonly related?: string | string[] | undefined;
}

/** The shape of `parseCLI` from `vitest/node` that this module uses. */
export type CliParse = (
  argv: string[],
  config?: { allowUnknownOptions?: boolean },
) => { filter: string[]; options: CliParseResultOptions };

/**
 * Which of the invocation's filters will select no test file at all, and which
 * population each of those would have matched instead.
 *
 * Pure: `node:path` only, no filesystem, no vitest, no process. Returns the
 * empty array whenever the invocation is opaque or names a project this
 * preflight cannot place — ⛔ declining is a verdict about the preflight, never
 * about the run.
 */
export function lostFilters(
  invocation: Invocation,
  populations: Populations,
  root: string,
): LostFilter[] {
  const { filters, projects, opaque } = invocation;
  if (opaque || filters.length === 0) return [];
  const names = Object.keys(populations);
  const selected = projects.length ? projects : names;
  // A `--project` value that is not a plain tier name (a negation, a glob) is
  // not modelled here. ⛔ Decline rather than half-answer.
  if (selected.some((name) => !names.includes(name))) return [];

  const inSelected = selected.flatMap((name) => populations[name] ?? []);
  return filters
    .filter(({ path }) => !inSelected.some((rel) => matchesVitestFilter(rel, path, root)))
    .map((filter) => ({
      filter,
      foundIn: names.filter((name) =>
        (populations[name] ?? []).some((rel) => matchesVitestFilter(rel, filter.path, root)),
      ),
    }));
}

/**
 * The diagnostic, or the EMPTY STRING when nothing was lost.
 *
 * ⛔ The empty string is the contract, not an implementation detail: it is what
 * keeps a healthy run byte-identical. Anything that would print on a healthy
 * run belongs somewhere else.
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
    `  !! FILTER SELECTED NOTHING — ${lost.length} of the ${totalFilters} path(s) you named will run no tests.`,
    '',
  ];

  for (const { filter, foundIn } of lost) {
    lines.push(`     ${filter.spelled}`);
    lines.push(
      foundIn.length
        ? `       lives in the ${foundIn.map((n) => `\`${n}\``).join(' / ')} tier; this run selected ${selected}.`
        : '       matches no test file in this package at all — check the path.',
    );
    if (foundIn.length) {
      lines.push(
        `       run it:  pnpm --filter @objectstack/cli exec vitest run --project ${foundIn[0]} ${filter.path}`,
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
 * The once-guard key. ⛔ It lives on a SCOPE OBJECT (`globalThis` in a real
 * run), never in a module-level binding: vitest loads this config once per
 * project, each load gets its own module instance, and a module-level flag
 * therefore guards nothing. Measured before this existed — three projects'
 * worth of loads printed the notice three times at the top and three more at
 * exit, six copies of one diagnostic.
 */
const ANNOUNCED = '__objectstackCliFilterPreflightAnnounced';

/**
 * Run the preflight for this process and, if anything will be lost, say so
 * twice: once now — config load, so it precedes vitest's banner — and once from
 * an `exit` listener, so it also lands BELOW the summary, which is where a
 * reader looks for `Test Files N passed`. Writes nothing at all, and registers
 * no listener, when nothing is lost.
 *
 * ⛔ `process.on('exit')` rather than a reporter hook: see this file's header
 * on what naming `test.reporters` costs.
 *
 * `scope` is the once-guard's home and defaults to `globalThis`, so repeated
 * config loads in ONE process announce once. A caller passing a fresh object
 * gets a fresh process's behaviour, which is how the pin exercises both a first
 * announcement and a repeat.
 */
export function runFilterPreflight(options: {
  argv: readonly string[];
  root: string;
  populations: Populations;
  parse: CliParse;
  write?: (text: string) => void;
  scope?: Record<string, unknown>;
}): string {
  const { argv, root, populations, parse } = options;
  const write = options.write ?? ((text: string) => void process.stderr.write(text));
  const scope = options.scope ?? (globalThis as unknown as Record<string, unknown>);
  const invocation = parseInvocation(argv, parse);
  const notice = renderLostFilterNotice(
    lostFilters(invocation, populations, root),
    invocation.filters.length,
    invocation.projects,
  );
  if (!notice) return '';
  if (scope[ANNOUNCED]) return notice;
  scope[ANNOUNCED] = true;
  write(notice);
  process.on('exit', () => write(notice));
  return notice;
}
