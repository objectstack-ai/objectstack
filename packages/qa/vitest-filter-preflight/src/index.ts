// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A vitest FILE FILTER that selects nothing must say so — even when the rest
 * of the same run selects something (#17853, #17978).
 *
 * ## The defect this closes, and the half vitest already covers
 *
 * `vitest run` reads bare positional arguments as FILE FILTERS. When EVERY
 * filter selects nothing, vitest is already loud and this module adds nothing:
 * `printNoTestFound()` prints `No test files found, exiting with code 1`
 * together with the filters and the projects, and the run is red.
 *
 * ⭐ THE GAP IS THE PARTIAL CASE, and it is the one that costs dispatch rounds.
 * Once at least one filter selects a file, the filters that selected NOTHING
 * are dropped with no diagnostic of any kind. The run prints the same
 * `Test Files N passed` summary as the run that named only the surviving paths,
 * and `diff` over the two captures is empty but for timestamps and durations.
 * The discarded path's name appears NOWHERE in vitest's own output — the one
 * occurrence in a captured terminal is pnpm's echo of the argv in
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
 * ⭐ AND IT IS NOT `--project`-SPECIFIC. A bare `vitest run <real> <typo>` with
 * no `--project` at all takes the same code path: exit 0, `Test Files 1 passed`,
 * the typo named nowhere. Detecting that needs exactly what detecting the
 * narrowed case needs — knowledge of the package's FULL test population — which
 * is why both live here rather than in two mechanisms.
 *
 * ## ⛔ WHY THERE IS EXACTLY ONE COPY OF THIS FILE (#17978)
 *
 * `matchesVitestFilter` below is a TRANSCRIPTION of a private vitest code path.
 * Eight packages in this repo declare vitest `projects` and every one of them
 * needs it. Copying the transcription per package means eight readings of
 * vitest's internals drifting from vitest and from each other, and every drift
 * fails SILENTLY GREEN — the same failure direction as the defect. One copy is
 * the only version of this that survives a vitest bump: on an upgrade, re-read
 * `TestProject.filterFiles` and `parseFilter` in `dist/chunks/cli-api.*.js`
 * ONCE, here.
 *
 * ## ⛔ WHY CONSUMERS IMPORT THIS FILE BY RELATIVE PATH, not by its package name
 *
 * This package's `exports` points straight at `src`, so the obvious call site
 * would be `import { … } from '@objectstack/vitest-filter-preflight'`. MEASURED
 * on this tree and rejected:
 *
 *   - Vite bundles a config's RELATIVE imports through esbuild, which transpiles
 *     TypeScript. It EXTERNALISES bare specifiers instead, resolving them to a
 *     real path and leaving Node to load it. Resolved here, that path is a
 *     `.ts` file.
 *   - Node ≥ 22.18 strips types by default, so the bare form loads — with no
 *     warning, which is exactly what makes it dangerous. Re-run with
 *     `NODE_OPTIONS=--no-experimental-strip-types` and the config does not load
 *     at all: `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension
 *     ".ts"`, `failed to load config from …`. That is EVERY test in the
 *     consuming package, not a degraded diagnostic.
 *   - This repo declares `engines.node: ">=22.0.0"`. So on a supported Node the
 *     bare form turns a silent-drop defect into a total harness outage.
 *
 * ⛔ The other two escapes are worse, not better. Building this package to
 * `dist` would make eight test harnesses' CONFIG LOAD depend on build state —
 * and `pnpm --filter <pkg> exec vitest run <file>`, the very invocation this
 * card is about, runs no build, so a missing `dist` is again a config-load
 * crash. Authoring it as plain `.mjs` would drop the types, and the types are
 * load-bearing: `CliParseResultOptions` is declared STRUCTURALLY so that a
 * vitest upgrade renaming one of the three options it reads is a type error
 * here instead of a silent decline.
 *
 * ⇒ Each consumer spells a relative path to `src/index.js`, which esbuild
 * inlines and transpiles. The same mechanism `packages/cli/vitest-tiers.ts`
 * already uses for `../../scripts/nightly-tiers.mjs`.
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
 * So `reporters: ['default', preflight]` has two costs, one measured and one
 * that would only have shown up in CI:
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
 * The other input is each project's POPULATION. How a caller obtains one is the
 * one thing that differs across the eight packages, and it is the reason a
 * straight port of the `packages/cli` original could not serve any of the other
 * seven — see `exactAndGlobPopulations` below.
 *
 * ## ⛔ Every uncertainty resolves to SILENCE, never to a guess
 *
 * The preflight declines — printing nothing, leaving the run exactly as it was
 * — whenever it cannot model the invocation: an argv `parseCLI` refuses, a
 * `--project` value that is not one of the population names (a negation or a
 * glob), or a `--changed` / `--related` run, where nothing was named by hand.
 * Silence is the status quo, so declining can never make a run worse than it is
 * today; a guess could.
 *
 * ## Direction ②, the half that makes this accurate rather than merely loud
 *
 * `renderLostFilterNotice` returns the EMPTY STRING when no filter was lost,
 * and nothing is written in that case. A normal run — no filters, or filters
 * that all selected something — contributes zero bytes of new output.
 * `test/filter-preflight.test.ts` pins both directions and
 * `test/config-wiring-sweep.test.ts` pins that every config that declares
 * `projects` still invokes this module, because a preflight nobody invoked is
 * the same phantom check in a new place.
 */

import { readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

/** Populations to match a filter against, by project name — `{ repo, local }`. */
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

/**
 * The test-file family vitest's own `configDefaults.include` names —
 * `**\/*.{test,spec}.?(c|m)[jt]s?(x)` — as a basename predicate.
 *
 * ⛔ Deliberately NOT vitest's glob engine: see `testFilesUnder`.
 */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Directory names never walked. Both are in vitest's default `exclude` too. */
const NEVER_WALKED: readonly string[] = ['node_modules', 'dist'];

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
 * Every test file under `root`, package-root-relative, POSIX-separated, sorted.
 *
 * ⭐ THIS IS DELIBERATELY A SUPERSET of what any one glob project will collect,
 * and the superset direction is the whole safety argument (#17978). A population
 * that is too BIG can only ever make this preflight say LESS than it could: a
 * filter is reported lost only when it matches NOTHING in the population, and
 * matching nothing in a superset implies matching nothing in the real set. ⇒ a
 * false accusation against a healthy run is structurally impossible, and any
 * drift between this walk and vitest's collection can only under-report. A
 * population that were too SMALL would have the opposite, unacceptable failure
 * mode.
 *
 * ⛔ NOT vitest's own glob engine (tinyglobby) with the project's own patterns.
 * That would be a SECOND inheritance of vitest's internals — the exact thing
 * this module exists to stop multiplying — and it would buy nothing, because the
 * superset already cannot accuse.
 *
 * Only `node_modules` and `dist` are skipped. Both are in vitest's default
 * `exclude`, so skipping them cannot drop a file vitest would collect; skipping
 * FEWER directories than vitest is always safe here, skipping more is not.
 */
export function testFilesUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (NEVER_WALKED.includes(entry.name)) continue;
        walk(join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.isFile() && TEST_FILE.test(entry.name)) {
        found.push(prefix ? `${prefix}/${entry.name}` : entry.name);
      }
    }
  };
  walk(root, '');
  return found.sort();
}

/**
 * Populations for the shape SEVEN of the eight packages have: one project whose
 * `include` is an EXPLICIT LIST `L`, paired with one project whose `include` is
 * a GLOB that excludes `L`.
 *
 * ⚠️ This is the component the `packages/cli` original had no need of and could
 * not express, which is why porting that file was not an option for any of the
 * other seven: its `Populations` is a record of CONCRETE paths and a glob
 * pattern cannot be a member of one. `packages/cli` satisfies the concrete-path
 * contract only as a by-product of a tier walk it already performed for
 * unrelated reasons (#13504 / #14554), so it passes its two exact arrays to
 * `runFilterPreflight` directly and never calls this function.
 *
 * The exact project's population is `L` itself — exact, not a superset, because
 * `L` IS the `include`. The glob project's is `testFilesUnder(root)` minus every
 * exact list, which is a superset of whatever the glob collects for the reason
 * that function's docblock gives.
 */
export function exactAndGlobPopulations(options: {
  readonly root: string;
  /** The exact-`include` projects, by name — usually `{ repo: REPO_TESTS }`. */
  readonly exact: Populations;
  /** The name of the glob project, e.g. `'local'`. */
  readonly globProject: string;
}): Populations {
  const { root, exact, globProject } = options;
  const claimed = new Set(Object.values(exact).flat());
  return {
    ...exact,
    [globProject]: testFilesUnder(root).filter((rel) => !claimed.has(rel)),
  };
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
 * option here as a type error. `test/filter-preflight.test.ts` passes the real
 * `parseCLI` in unaltered, so this compatibility is pinned, not assumed.
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
  // A `--project` value that is not a plain project name (a negation, a glob) is
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
 *
 * ⚠️ `packageName` is a PARAMETER because the original hardcoded
 * `@objectstack/cli` in the `run it:` line (#17978 carries that finding): a
 * shared notice that prints another package's filter name would send the reader
 * to a command that runs the wrong suite — a wrong answer, which is worse here
 * than no answer.
 */
export function renderLostFilterNotice(
  lost: readonly LostFilter[],
  totalFilters: number,
  selectedProjects: readonly string[],
  packageName: string,
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
        ? `       lives in the ${foundIn.map((n) => `\`${n}\``).join(' / ')} project; this run selected ${selected}.`
        : '       matches no test file in this package at all — check the path.',
    );
    if (foundIn.length) {
      lines.push(
        `       run it:  pnpm --filter ${packageName} exec vitest run --project ${foundIn[0]} ${filter.path}`,
      );
    }
    lines.push('');
  }

  lines.push(
    '     ⛔ Nothing below counts the path(s) above: the file count, the pass/fail',
    '        totals and the exit code are about the OTHER named paths only.',
    '        To run every project, which is what CI runs:',
    `          pnpm --filter ${packageName} test`,
    '',
  );
  return lines.join('\n');
}

/**
 * The once-guard key. ⛔ It lives on a SCOPE OBJECT (`globalThis` in a real
 * run), never in a module-level binding: vitest loads a config once per project,
 * each load gets its own module instance, and a module-level flag therefore
 * guards nothing. Measured before this existed — three projects' worth of loads
 * printed the notice three times at the top and three more at exit, six copies
 * of one diagnostic.
 *
 * ⚠️ The key is deliberately NOT package-scoped even though the module is now
 * shared: one `vitest run` process loads the config of exactly one package, so
 * a per-package key would only add a way for the guard to miss.
 */
const ANNOUNCED = '__objectstackVitestFilterPreflightAnnounced';

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
  /** The name a `pnpm --filter` takes for the package being run. */
  packageName: string;
  parse: CliParse;
  write?: (text: string) => void;
  scope?: Record<string, unknown>;
}): string {
  const { argv, root, populations, packageName, parse } = options;
  const write = options.write ?? ((text: string) => void process.stderr.write(text));
  const scope = options.scope ?? (globalThis as unknown as Record<string, unknown>);
  const invocation = parseInvocation(argv, parse);
  const notice = renderLostFilterNotice(
    lostFilters(invocation, populations, root),
    invocation.filters.length,
    invocation.projects,
    packageName,
  );
  if (!notice) return '';
  if (scope[ANNOUNCED]) return notice;
  scope[ANNOUNCED] = true;
  write(notice);
  process.on('exit', () => write(notice));
  return notice;
}

/**
 * The SECOND preflight this package owns, re-exported here so every consumer
 * keeps exactly one relative import line (`config-wiring-sweep.test.ts` asserts
 * that spelling, and its header carries the measurement behind it).
 *
 * Different defect, same shape and same seam: `runFilterPreflight` catches a
 * positional filter that a `projects` narrowing silently discarded, and
 * `runProjectCliOverridePreflight` catches a CLI TIMEOUT OVERRIDE that the same
 * narrowing silently discards (#18788). Both fail in the one direction AGENTS.md
 * ranks below having no verifier at all — green, having measured nothing — and
 * both are available in exactly the packages that declare `projects`, which is
 * why the two transcriptions of vitest's project resolution live in one package
 * rather than in eight configs.
 */
export {
  TIMEOUT_OVERRIDE_OPTIONS,
  PROJECT_CLI_OVERRIDES,
  inertTimeoutOverrides,
  renderInertOverrideNotice,
  runProjectCliOverridePreflight,
} from './project-cli-override-preflight.js';
export type {
  TimeoutCliOptions,
  TimeoutCliParse,
  TimeoutOverrideOption,
} from './project-cli-override-preflight.js';
