// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A vitest CLI TIMEOUT OVERRIDE that cannot reach a project must REFUSE the run
 * — never pass it (#18788).
 *
 * ## The defect, measured on vitest 4.1.11
 *
 * `vitest run --hookTimeout=1` is the instrument this repo's own prior art
 * reaches for to WITNESS that a cold load has left every clocked window:
 * `packages/plugins/plugin-dev/src/dev-plugin-security-enforcement-warning.test.ts`
 * says, in its header, that the file "stays green even under `--hookTimeout=1`
 * -- there is no hook time left to clock". That sentence is a reading only
 * because the flag can redden the run when hook time IS being spent.
 *
 * ⭐ In a package that declares `test.projects` the flag reddens nothing,
 * because it never arrives. `resolveProjects` (`dist/chunks/cli-api.*.js`)
 * builds each project's test config as
 *
 *     test: { ...options.test, ...cliOverrides }
 *
 * where `cliOverrides` is a CLOSED ALLOWLIST of twenty CLI option names —
 * `VITEST_PROJECT_CLI_OVERRIDES` below. Every other CLI option is applied to the
 * ROOT config and stops there. `testTimeout` is on that list. `hookTimeout` and
 * `teardownTimeout` are not.
 *
 * ## The reading this module was built from, with its LIT CONTROLS
 *
 * A probe `beforeAll` sleeping 500ms, on this tree, vitest 4.1.11:
 *
 *   | run                                                              | result |
 *   |------------------------------------------------------------------|--------|
 *   | `@objectstack/cli`, `--project unit`, `--hookTimeout=1`           | exit 0, 1 passed, `tests 505ms` |
 *   | `@objectstack/cli`, no `--project`, `--hookTimeout=1`             | exit 0, 1 passed, `tests 505ms` |
 *   | ⭐ `@objectstack/plugin-dev` (no `projects`), `--hookTimeout=1`   | exit 1, `Hook timed out in 1ms.` |
 *   | ⭐ `@objectstack/cli`, `--testTimeout=1`, 500ms in the test BODY  | exit 1, `Test timed out in 1ms.` |
 *   | ⭐ `@objectstack/cli`, `beforeAll(fn, 1)`, no flags               | exit 1, `Hook timed out in 1ms.` |
 *   | ⭐ `@objectstack/cli`, root `test.hookTimeout: 1` in the config   | exit 1, `Hook timed out in 1ms.` |
 *
 * ⛔ The first two zeros are READINGS, not a dead instrument — the four lit
 * controls below them are what make them so, and each is a separate leg:
 *
 *   - `plugin-dev` proves the FLAG works where no `projects` narrowing exists;
 *   - `--testTimeout` proves the CLI-to-project path is ALIVE in this very
 *     package, under the same config and the same invocation shape, so the
 *     defect is ALLOWLIST MEMBERSHIP and nothing wider;
 *   - the per-hook argument and the config-file value prove the VALUE reaches
 *     the hook by both other spellings, so `hookTimeout` is not somehow
 *     unenforceable here — only the CLI spelling of it is inert.
 *
 * ⇒ In a `projects` package the flag returns GREEN HAVING MEASURED NOTHING, and
 * a green that cannot fail is indistinguishable from one that passed. That is
 * the failure direction AGENTS.md ranks BELOW having no verifier at all (Route &
 * surface ownership §3: a verifier that silently degrades reports success).
 *
 * ## The three routes, and why this one
 *
 * ### ⛔ Route 1 — stop relying on the flag, rewrite the witness
 *
 * Available, and MEASURED to work: in `packages/cli` a 500ms `beforeAll` is
 * reddened by `beforeAll(fn, 1)` and by a root `test.hookTimeout: 1`, both exit
 * 1 with `Hook timed out in 1ms.` (rows 5 and 6 of the table above). What it
 * cannot do is stop the NEXT reader reaching for the flag — this repo's own
 * prior art reaches for it, and a dispatching seat handed it over as a
 * suggestion on the round that filed this card. A remedy that is a habit is not
 * a remedy. ⭐ So route 1 is not discarded: it is what the refusal text NAMES,
 * which is the one way a convention gets enforced rather than recommended.
 *
 * ### ⛔ Route 2 — forward the value into the projects
 *
 * The cheapest spelling is not even per-project: every one of these configs
 * declares `extends: true`, so writing the parsed value into the ROOT `test`
 * block reaches all of them (row 6 measures exactly that, by hand). It works.
 * It was rejected on three counts:
 *
 *   - **it invents a precedence rule vitest does not have, and then hides the
 *     day vitest acquires one.** For an ALLOWLISTED name vitest spreads the CLI
 *     value last — `test: { ...options.test, ...cliOverrides }` in
 *     `resolveProjects` — so the CLI wins over the project's own block. For a
 *     name vitest never carries there is no rule at all, so a forward has to
 *     pick one, for eight packages, on this repo's authority. ⭐ And the pick
 *     goes stale silently: the day a vitest bump adds `hookTimeout` to
 *     `cliOverrides`, vitest's own override and the forward are BOTH live, and
 *     nothing reddens. The refusal has the opposite failure mode — its
 *     transcription pin equals-checks the installed array, so that same bump
 *     turns it RED and a human reads the diff;
 *   - **it fixes exactly the names it enumerates.** The allowlist is twenty
 *     names long and vitest's CLI surface is not; every other option reaches the
 *     root config and stops. A forward built for three names leaves the rest
 *     handing out the same false greens — the identical defect, narrower, and
 *     now behind something called a fix. ⛔ Widening the forward to "every CLI
 *     option" is a second transcription of vitest's option table, which is the
 *     multiplication this package exists to stop;
 *   - **it is a lenient consumer-side accommodation for an upstream contract**,
 *     which Prime Directive #12 refuses in the form it usually takes (a `??`
 *     alias) for the reason that applies here unchanged: one strict contract
 *     beats N dialects, and the dialect drifts silently green on the next bump.
 *
 * ### ⭐ Route 3 — refuse the run, and name the spellings that do bite
 *
 * Chosen. Refusing costs nothing that was working: the flag measures nothing
 * today, so no run loses a capability, and a run that names no such flag is
 * byte-identical to the run it is today. What it buys is that the false
 * clearance becomes impossible to READ — and, because the notice carries route
 * 1's two measured spellings, the reader leaves with the instrument they came
 * for rather than a bare refusal.
 *
 * ## ⛔ Why the judged family is CLOSED, and why it is not a set invented here
 *
 * This module judges exactly three option names, and they are the three this
 * repo already names as a closed set in its own words, independently, in four
 * places — `packages/plugins/plugin-dev/src/dev-plugin-security-enforcement-warning.test.ts`
 * ("`vitest --help` … offers exactly three timeout knobs -- `testTimeout`,
 * `hookTimeout`, `teardownTimeout`"), `packages/cli/src/commands/datasource/envelope-unwrap.test.ts`,
 * `packages/plugins/plugin-auth/src/durability-swallow-repair.test.ts` and
 * `scripts/check-test-source-alias.mjs`. They share one property nothing else on
 * the CLI has: **their whole purpose is to make a run FAIL that would otherwise
 * pass.** A dropped `--reporters` produces the wrong output and a reader sees
 * it; a dropped `--hookTimeout` produces the RIGHT output for a run that
 * measured nothing.
 *
 * ⛔ Every name outside that family resolves to SILENCE, exactly as the sibling
 * preflight in this package resolves its own uncertainties. Silence is the
 * status quo, so declining can never make a run worse than it is today; judging
 * `--watch` or `--reporters` here would break healthy runs for a diagnostic
 * nobody asked for. Widening the family is its own card, and it owes the same
 * two lit controls per name that the three above have.
 *
 * ## ⛔ Why the allowlist is transcribed ONCE, here
 *
 * `VITEST_PROJECT_CLI_OVERRIDES` is a transcription of a private vitest code
 * path, the second one this package owns (`matchesVitestFilter` in `index.ts` is
 * the first) and for the same reason: eight packages in this repo declare
 * vitest `projects`, every one of them has this defect, and eight copies of a
 * reading of vitest's internals drift from vitest and from each other with every
 * drift failing SILENTLY GREEN — the same direction as the defect.
 *
 * ⭐ THE POPULATION IS EIGHT, SO ALL EIGHT ARE WIRED. The card was filed against
 * `packages/cli`, and `packages/cli` is where the cold-boot cost lives — but the
 * defect is a property of declaring `projects`, not of that package, and it was
 * measured in a second one to prove it: in `@objectstack/types` a 500ms
 * `beforeAll` passes under `--hookTimeout=1` (exit 0) and reddens under
 * `beforeAll(fn, 1)` (exit 1, `Hook timed out in 1ms.`) — the same two-legged
 * reading as `packages/cli`. Wiring one and leaving seven would ship this file's
 * own sentence above as a documented, unfixed defect in seven places, and
 * `test/config-wiring-sweep.test.ts` — which DERIVES its population rather than
 * listing it — would then have had to carry a maintained exemption list for
 * them, which is the artefact #17978 removed. So the sweep requires this call in
 * every config that declares `projects`, and spawns a real vitest child per
 * package to prove the refusal is a behaviour and not a spelling.
 *
 * ⭐ Unlike the first transcription, this one is PINNED AGAINST ITS SOURCE:
 * `test/project-cli-override-preflight.test.ts` extracts the real array out of
 * the INSTALLED `vitest/dist/chunks/cli-api.*.js` and asserts this constant
 * equals it, and it FAILS LOUDLY when the extraction finds nothing rather than
 * skipping. So a vitest bump that edits the allowlist reddens that pin instead
 * of quietly changing what this module refuses.
 */

/**
 * `cliOverrides` in `resolveProjects`, vitest 4.1.11, transcribed — the CLOSED
 * set of CLI option names that reach a project's own test config. Order is the
 * source's.
 *
 * ⛔ Re-read `dist/chunks/cli-api.*.js` on a vitest bump; the pin named in this
 * file's header does that reading for you and reddens on any difference.
 */
export const VITEST_PROJECT_CLI_OVERRIDES: readonly string[] = [
  'logHeapUsage',
  'detectAsyncLeaks',
  'allowOnly',
  'sequence',
  'testTimeout',
  'pool',
  'update',
  'globals',
  'expandSnapshotDiff',
  'disableConsoleIntercept',
  'retry',
  'testNamePattern',
  'passWithNoTests',
  'bail',
  'isolate',
  'printConsoleTrace',
  'inspect',
  'inspectBrk',
  'fileParallelism',
  'tagsFilter',
];

/**
 * The closed family this module judges: vitest's three timeout knobs, the only
 * CLI options whose sole purpose is to make a passing run fail. See this file's
 * header for why the set is these three and no others.
 */
export const TIMEOUT_OVERRIDE_OPTIONS = ['testTimeout', 'hookTimeout', 'teardownTimeout'] as const;

export type TimeoutOverrideOption = (typeof TIMEOUT_OVERRIDE_OPTIONS)[number];

/**
 * The three `parseCLI` options this module reads, typed STRUCTURALLY so that
 * vitest's own `CliOptions` satisfies it without a cast — same discipline, and
 * same reason, as `CliParseResultOptions` in `index.ts`: a vitest upgrade that
 * renames one of them is a type error here instead of a silent decline.
 */
export interface TimeoutCliOptions {
  readonly testTimeout?: number | undefined;
  readonly hookTimeout?: number | undefined;
  readonly teardownTimeout?: number | undefined;
}

/** The shape of `parseCLI` from `vitest/node` that this module uses. */
export type TimeoutCliParse = (
  argv: string[],
  config?: { allowUnknownOptions?: boolean },
) => { options: TimeoutCliOptions };

/**
 * Which timeout overrides this command line names that vitest will NOT carry
 * into a project config — in `TIMEOUT_OVERRIDE_OPTIONS` order, so the notice is
 * stable.
 *
 * ⛔ Returns the empty array on any argv `parseCLI` refuses. A preflight that
 * guessed past its own parser would be the very defect this module reports.
 */
export function inertTimeoutOverrides(
  argv: readonly string[],
  parse: TimeoutCliParse,
): TimeoutOverrideOption[] {
  let options: TimeoutCliOptions;
  try {
    options = parse(['vitest', ...argv.slice(2)], { allowUnknownOptions: true }).options;
  } catch {
    return [];
  }
  return TIMEOUT_OVERRIDE_OPTIONS.filter(
    (name) => options[name] !== undefined && !VITEST_PROJECT_CLI_OVERRIDES.includes(name),
  );
}

/**
 * The refusal text, or the EMPTY STRING when nothing was named that vitest will
 * drop.
 *
 * ⛔ The empty string is the contract, not an implementation detail: a run that
 * names no inert override contributes zero bytes of new output and is
 * byte-identical to the run it is today.
 *
 * ⚠️ `packageName` is a PARAMETER for the reason #17978 recorded against the
 * sibling preflight: a shared notice hardcoded to one package's name sends the
 * reader to a command that runs the wrong suite, and a wrong answer is worse
 * here than no answer. Every remedy this text names is measured — see the table
 * in this file's header.
 */
export function renderInertOverrideNotice(
  inert: readonly TimeoutOverrideOption[],
  packageName: string,
): string {
  if (inert.length === 0) return '';
  const flags = inert.map((name) => `--${name}`).join(' ');
  return [
    '',
    `  !! TIMEOUT OVERRIDE CANNOT REACH THIS PACKAGE — refusing to run: ${flags}`,
    '',
    `     ${packageName} declares vitest \`test.projects\`, and vitest carries only a`,
    '     closed allowlist of CLI options into a project config. These are not on it,',
    '     so the run would have used the DEFAULT budget and reported a pass that',
    '     measured nothing — a green that cannot fail, which reads exactly like a',
    '     green that passed.',
    '',
    '     Spellings that DO bite here, each measured in this package:',
    '',
    `       1. the same key in the \`test\` block of this package's vitest.config.ts,`,
    '          which every project inherits through `extends: true`. Covers all three',
    '          knobs, and it is the spelling to use for a budget that should persist.',
    '       2. for a hook budget, the per-hook argument — `beforeAll(fn, 1)`. The',
    '          number lands in the file, where the next reader sees it, and no project',
    '          resolution is involved.',
    '       3. `--testTimeout`, which IS on vitest\'s allowlist — but it bounds test',
    '          BODIES only; a hook inherits `hookTimeout`, never `testTimeout`.',
    '',
    '     ⛔ Nothing about this is a budget problem in your test. Re-running with a',
    '        larger number changes nothing, because no number arrives.',
    '',
  ].join('\n');
}

/**
 * Refuse this run when it names a timeout override vitest will drop on the way
 * into a project; do nothing whatever otherwise.
 *
 * Invoked at CONFIG LOAD, like the sibling preflight and for the same measured
 * reason: a `test.reporters` entry replaces vitest's reporter defaulting instead
 * of extending it, which changes a healthy run's output and drops the
 * `github-actions` reporter in CI. This touches no vitest seam at all.
 *
 * The notice goes to stderr FIRST, so it is the first thing on screen and is
 * rendered unindented; the throw that follows carries a one-line summary, which
 * vitest reports as `failed to load config from …` plus a `Startup Error`, exit
 * 1. ⛔ Writing without throwing was rejected: a warning above a green summary
 * is still a green summary, and the whole point is that this run must not be
 * readable as a pass.
 *
 * Returns the notice (for the pin) when it refuses; returns `''` and writes
 * nothing when the command line is clean.
 */
export function runProjectCliOverridePreflight(options: {
  argv: readonly string[];
  /** The name a `pnpm --filter` takes for the package being run. */
  packageName: string;
  parse: TimeoutCliParse;
  write?: (text: string) => void;
  /** Throw on refusal. Only the pin passes `false`, to read the text. */
  refuse?: boolean;
}): string {
  const { argv, packageName, parse } = options;
  const write = options.write ?? ((text: string) => void process.stderr.write(text));
  const inert = inertTimeoutOverrides(argv, parse);
  const notice = renderInertOverrideNotice(inert, packageName);
  if (!notice) return '';
  write(notice);
  if (options.refuse === false) return notice;
  throw new Error(
    `${inert.map((n) => `--${n}`).join(' ')} cannot reach a project config in ${packageName}; ` +
      'see the refusal printed above for the spellings that do.',
  );
}
