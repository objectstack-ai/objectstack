#!/usr/bin/env node
// check-i18n-coverage — declared-label translation ratchet for the examples AND
// every package that owns a translation bundle.
//
// #3370 made `os lint` gate the WHOLE declared surface (inline object actions,
// action params / resultDialog, listViews, apps / dashboards / pages), not just
// object and field labels. That surfaced real pre-existing debt: the examples
// declare `i18n.supportedLocales: ['en', 'zh-CN', …]` and then leave a few
// hundred declared strings untranslated.
//
// So `os lint --i18n-strict` — the honest "these locales must be complete"
// gate — reports ~100-450 errors per example today. Turning it on as-is would
// paint CI red on day one and get switched back off, which is how a gate stops
// being a gate. This is the shippable middle: the debt is FROZEN, and the build
// fails the moment it grows.
//
// Mirrors scripts/check-role-word.mjs. Fails when:
//   • an example config is not in the baseline (translate it, or ratchet it in), or
//   • a baselined count INCREASES — a newly untranslated declared string, or
//   • a baselined count DECREASED / the example vanished (improvement!) —
//     run with --update to ratchet down and commit the baseline.
//
//   node scripts/check-i18n-coverage.mjs [--update]
//   node scripts/check-i18n-coverage.mjs --self-test  # prove the classifiers go red
//
// Counts only what `os lint` shows a user: the platform metadata-form baseline
// is folded away (it is owned and translated by platform-objects), so this
// tracks the example's OWN declared surface. Severity is ignored on purpose —
// warning-vs-error moves with --i18n-strict, but the SET of untranslated keys
// does not, and that set is what must not grow.
//
// Requires the workspace build (it runs the built CLI), so it belongs after the
// build step with the other consumer gates. `--self-test` does not: it drives the
// pure classifiers against recorded samples, no build and no CLI.
//
// WHAT THIS GATE CANNOT SEE, stated because two other comments once assumed it
// could (#5750). It lints STATIC stack configs, so it measures exactly what a
// config DECLARES. Metadata assembled at RUNTIME is outside it by construction —
// most consequentially the Setup app's navigation, which is a shell of empty
// group anchors filled in by `SETUP_NAV_CONTRIBUTIONS` and by capability
// plugins (ADR-0029 D7). `platform-objects`' extract config and
// `app-nav-translation-parity.test.ts` each excluded those labels and named the
// other side as the owner; the ratchet's 0 for this package was "not looked at
// here", and four Setup nav ids sat untranslated in `zh-CN` under a green run of
// this very script. That half now has its own gate — `pnpm check:app-nav-i18n`
// (`packages/cli/scripts/check-app-nav-i18n.mjs`), which boots the composition
// and judges the merged app. Do not extend this script to cover it: the two ask
// different questions of different inputs, and folding a kernel boot into an
// `os lint` loop would make neither readable.
//
// That requirement is now CHECKED, not merely declared (#5862). It used to be the
// sentence above and nothing else, and in an installed-but-unbuilt worktree the
// gate answered with an uncaught exception plus a node stack:
//
//     Error: os lint produced no output for examples/app-crm/objectstack.config.ts
//         at countI18nIssues (…/check-i18n-coverage.mjs:101:28)
//
// — which names an entirely innocent example config. There is exactly one cause,
// and it is not in that file: this gate runs the BUILT CLI, oclif resolves
// `os lint` from `dist/commands`, and an unbuilt CLI prints nothing at all. The
// first config to be processed simply took the blame for the environment.
//
// CI never sees this (lint.yml's `typecheck` job runs `Build workspace packages`
// well before `pnpm check:i18n-coverage`), which is exactly why it survived: the
// only people who meet it are the ones reproducing a red i18n CI locally, at the
// moment a wrong first diagnosis costs the most. `checkCliBuildPrerequisite()`
// now answers it once, before the per-config loop.
//
// Same shape as the neighbouring `check-i18n-bundles.mjs` step (#5217), sharing
// its two pure classifiers from `scripts/cli-build-prerequisite.mjs` rather than
// copying them. "Prefer failing to falling back" (AGENTS.md, route & surface
// ownership §3): the prerequisite verdict is a HARD failure that states it
// measured nothing — never a skip, and never anything a reader can mistake for
// "no config declares an untranslated label".
//
// That answered ONE prerequisite. The OTHER one — an example's own workspace
// dependencies unbuilt — kept the original shape until #6033: three bare `throw`s
// inside the per-config measurement, an uncaught exception, and a node stack:
//
//     Error: os lint failed for examples/app-showcase/objectstack.config.ts:
//       Cannot find module '…/@objectstack/connector-mcp/dist/index.mjs'
//         at countI18nIssues (…/check-i18n-coverage.mjs:185:29)
//
// That diagnosis did NOT lie — the missing module is real and actionable, which is
// why #6033 was filed as an observation rather than a defect. What it cost was the
// other eleven configs: the loop died at the second one, so the remaining ten were
// never attempted and their causes — which need not be this one — were never seen.
// #5217's rule is "one cause must not be reported as N results"; this is its
// converse, and one discipline serves both: measure EVERY config, then report every
// DISTINCT cause once, with the configs it covers. A config that cannot be linted is
// now collected (`measureI18nIssues` returns a failure), never thrown.
//
// Both of those are about a config that could not be MEASURED. #10907 is about
// the population itself, and it is the failure this gate could not report at all:
// every path here was resolved CWD-RELATIVELY — `examples`, `packages`, the
// baseline, the CLI stub — so run from anywhere but the repo root the gate found
// no configs, compared nothing, and printed
//
//     check-i18n-coverage: OK (0 config(s), 0 baselined untranslated string(s), none new).
//     exit 0
//
// — the same sentence, and the same exit code, a real pass uses. What makes that
// silent rather than merely wrong is an INTERLOCK: this is a two-sided ratchet, so
// a config that vanishes is normally caught by the DOWN direction ("baselined
// config is gone"). But the population and the baseline were resolved the same
// way, so a wrong root emptied them TOGETHER and left the comparison with nothing
// to disagree about. Anchoring one side alone would not have been a fix — it would
// have turned the silence into twelve spurious errors.
//
// Two halves, and the file keeps both. (1) Every read is anchored to a root
// derived from `import.meta.url`, as `check-skills-token-ratchet.mjs` and
// `check-ratchet-remedy-authority.mjs` do; the repo-relative spellings stay, since
// they are the committed baseline's KEYS and the text a reader acts on, and `at()`
// is the one seam between the two. (2) An empty population is REFUSED rather than
// returned — zero is a broken scan, not a repo with nothing to translate (#4690),
// the same rule `trackedFiles` states in `scripts/pm/dispatch-gates.mjs`. Half 1
// makes the off-root run correct; half 2 is what keeps "green over nothing"
// unreachable by the routes half 1 does not know about.
//
// #11395 is #5217's rule failing INSIDE the machinery written to keep it. The
// grouping keys a cause on its CONCLUSION — `[reason, fix]` — which holds only
// while `fix` is a shared remedy. It was not: three of the five failure branches
// set `fix` to `rerunFix(configPath)`, a string embedding the config path, so each
// config got a unique key and one shared cause was split into one group per
// config. Measured on an unbuilt worktree with the CLI probe deferring — all
// twelve configs failed for ONE environment fact and the report read
//
//     check-i18n-coverage: COULD NOT MEASURE — 12 of 12 config(s) failed to lint (12 distinct causes)
//
// — twelve blocks, twelve identical `why:` lines, while its own closing paragraph
// asserted "a cause shared by several configs is stated once, not once per config
// (#5217)". Note WHERE that hid: CI builds the workspace first, so CI reaches this
// report only over a green tree, and the environment that produces it is the one
// nobody runs the gate from twice.
//
// Fixed at the IDENTITY, not by normalising the path back out of the key: the
// classifiers no longer receive a config path at all, so no per-config string is
// in reach of a cause. The rerun command is a per-config remedy DETAIL and
// `reportUnmeasuredConfigs` renders it per config inside the block. The other half
// of the key had the same defect one branch over — the non-JSON verdict
// interpolated the byte count and the parser's message into `reason` — and a fix
// addressing only `fix` would have left it splitting; readings belong in
// `evidence`, which is not keyed. The classified branches (`WORKSPACE_BUILD_FIX` /
// `INSTALL_THEN_BUILD_FIX`) group byte-for-byte as they did before.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  CLI,
  CLI_BUILD_FIX,
  closureBuildFix,
  looksLikeMissingCliCommand,
  oclifCommandFileFor,
  owningPackageOf,
  resolveCliCommandFile,
} from './cli-build-prerequisite.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** This script lives in `scripts/`, so the repo root is one level up (#10907). */
const REPO_ROOT = resolve(HERE, '..');

// Repo-relative ON PURPOSE — these spellings are the committed baseline's KEYS,
// the paths in every error message, and the commands `rerunCommand` tells a reader
// to run. Making them absolute would silently re-key all twelve baseline entries.
// `at()` below is the ONE seam that turns a repo-relative path into a path on
// disk, so the vocabulary stays relative while every READ is anchored (#10907).
// NOTE: covers both `examples/*` and every package with an extract config.
const EXAMPLES_DIR = 'examples';
const PACKAGES_DIR = 'packages';
const BASELINE_PATH = 'scripts/i18n-coverage-baseline.json';

// ⛔ Neither root above is declared to the dispatch derivation, and that is a
// recorded REFUSAL rather than an omission. Both populations are FILENAME
// filters — one `objectstack.config.ts` per example directory (3 of 240), and
// files named `i18n-extract.config.ts` beneath a `scripts` segment (9 of 5035).
// The `ROOT_DIR_WATCH_HINTS` idiom can only name a whole subtree, so the only
// spellable claim here would name this gate for 5035 files to reach 9 — the
// costlier error, per `hintCovers`. Both verdicts are recorded as
// REFUSE-UNSPELLABLE in the triage that `scripts/pm/bare-root-worklist.mjs`
// self-tests on every PR; giving `PACKAGES_DIR` a population-constant name is
// what made this root visible to that sweep at all.

/** A repo-relative path, resolved against the module-derived root. */
const at = (rel) => join(REPO_ROOT, rel);
/** The one command this gate invokes per config, as oclif topic/command parts. */
const LINT_COMMAND_ID = ['lint'];

/**
 * This gate's WHOLE build prerequisite, named once (#12564) — the CLI plus the
 * build closure of every config in the population, derived from the population
 * itself rather than written down.
 *
 * Computed at module scope on purpose: it is one command for the ROUND, not one
 * per config, which is what keeps it eligible for `SHARED_REMEDIES` below. A
 * remedy narrowed to the configs that actually failed would have to reach a
 * classifier, and a classifier that can see the population is a classifier that
 * can put per-round detail in a cause's identity — the #11395 hole, re-opened
 * from the other side. Round-constant, so `groupFailuresByCause` keys exactly as
 * it did before.
 */
const POPULATION_CLOSURE = closureBuildFix([...discoverExamples(), ...discoverPackages()]);

/**
 * The remedy when a config's OWN workspace dependencies were never built (#6033) —
 * distinct from `CLI_BUILD_FIX`, which clears only the CLI. An example config
 * imports workspace packages by name, so a tree with just the CLI built still
 * cannot be linted, and the two remedies must not be confused for each other.
 *
 * ⭐ It used to say `pnpm build`, which is CORRECT and is not what a reader does
 * (#12564). Sitting directly under it is a `why:` line naming ONE package, and
 * that line is the specific, actionable-looking one — so a reader builds that
 * package, re-runs, and is told the next one, because node stops resolving a
 * config's imports at the first missing `dist/` (the mechanism is written out
 * over `closureBuildFix`). Measured: four locked build rounds to get one reading,
 * and the walk was six rounds long — the reporter escaped at four only by
 * abandoning the diagnosis and building an owning package's closure instead.
 * Naming the closure here is what makes the specific line and the remedy agree.
 *
 * Falls back to the coarser `pnpm build` when the closure cannot be derived: a
 * strict superset costs time, never coverage, and a PARTIAL closure would be this
 * card's own defect wearing a derivation's clothes (see `closureBuildFix`).
 */
const WORKSPACE_BUILD_FIX = POPULATION_CLOSURE.command ?? 'pnpm build';
/** …and when the package is not on disk at all, a build alone cannot help. */
const INSTALL_THEN_BUILD_FIX = `pnpm install && ${WORKSPACE_BUILD_FIX}`;

const update = process.argv.includes('--update');

/** Every bundled example that has a stack config. Root-anchored, repo-relative out. */
function discoverExamples() {
  if (!existsSync(at(EXAMPLES_DIR))) return [];
  return readdirSync(at(EXAMPLES_DIR), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(EXAMPLES_DIR, e.name, 'objectstack.config.ts'))
    .filter((p) => existsSync(at(p)))
    .sort();
}

/**
 * Every package that owns a translation bundle, via the same
 * `scripts/i18n-extract.config.ts` its drift gate uses.
 *
 * These matter more than the examples: an example is a demo, but a platform
 * package's untranslated label is what a customer actually reads in Setup /
 * Studio. Covering only `examples/` is how `platform-objects` sat on 77
 * untranslated navigation and widget labels per locale without anything saying so.
 */
function discoverPackages(dir = PACKAGES_DIR, out = []) {
  if (!existsSync(at(dir))) return out;
  for (const e of readdirSync(at(dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) discoverPackages(p, out);
    else if (e.name === 'i18n-extract.config.ts' && p.includes('/scripts/')) out.push(p);
  }
  return out.sort();
}

/**
 * The gate's content classifier: how many of a report's issues are i18n ones.
 * Pure, so `--self-test` can drive it with a recorded report instead of a build.
 *
 * The `i18n/` prefix is the contract with `os lint --json`; everything else in
 * the report belongs to other rules and must not move this number.
 */
function countI18nRuleIssues(report) {
  const issues = report?.issues ?? [];
  if (!Array.isArray(issues)) return 0;
  return issues.filter((i) => typeof i?.rule === 'string' && i.rule.startsWith('i18n/')).length;
}

/**
 * The remedy for a failure this gate cannot prescribe one shared command for:
 * nothing can be run once that clears every config, so the reader reproduces one
 * by hand and reads `os lint`'s own words.
 *
 * A CONSTANT, and that is the entire point (#11395). This slot used to hold
 * `rerunFix(configPath)` — a per-config string — and `groupFailuresByCause` keys
 * on it, so every config reaching one of these three branches got a unique key and
 * one shared cause was split into one group per config: exactly the "one cause
 * reported as N results" shape the grouping exists to prevent (#5217).
 *
 * The per-config command is a remedy DETAIL, not part of the identity of a cause,
 * so `reportUnmeasuredConfigs` renders `rerunCommand(configPath)` for each config
 * INSIDE the block. What keeps the hole shut is not this constant but what it let
 * us remove: no classifier in this file is handed a config path any more, so a
 * per-config string is not in reach of a cause. A later `rerunFix`-shaped helper
 * cannot re-open it without re-plumbing the config path into a classifier — a
 * visible change, and one the `#11395` property assertions in `selfTest` red on.
 */
const RERUN_BY_HAND = 'no single command clears these — reproduce each config by hand and read `os lint`\'s own words:';

/**
 * Every remedy this gate can prescribe. `fix` is half of a cause's IDENTITY, so
 * the set is CLOSED and every member is a constant (#11395) — a `fix` from
 * outside it is a per-config string in the grouping key, which is the defect.
 */
const SHARED_REMEDIES = [WORKSPACE_BUILD_FIX, INSTALL_THEN_BUILD_FIX, RERUN_BY_HAND];

/**
 * The command that reproduces ONE config's failure by hand, for the reader.
 *
 * Called only by the REPORT, never by a classifier — see `RERUN_BY_HAND`. Its
 * output is per-config by construction, which is why it must stay on the
 * rendering side of the line.
 */
function rerunCommand(configPath) {
  return `node ${CLI} lint ${configPath} --json`;
}

/**
 * One bounded, readable line of evidence. A conclusion needs a reading to stand on,
 * but a reading is not a stack: multi-line output is flattened the way
 * `looksLikeMissingCliCommand` flattens oclif's wrapping, and a long one is cut.
 */
function evidenceLine(text, max = 200) {
  const flat = String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ');
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * The per-config failure classifier (#6033): WHY one config could not be linted,
 * as a conclusion plus the command that clears it. Pure — string in, verdict out —
 * so `--self-test` drives it with recorded CLI output instead of a build.
 *
 * The one classification worth making is module resolution. On a tree where only
 * the CLI was built, an example whose config imports a workspace package by name
 * fails with node's `Cannot find module`, and the useful thing to say is WHICH
 * package and that the remedy is a build. Everything else keeps the CLI's own
 * words and sends the reader to run the same command by hand: claiming "not built"
 * over a genuinely broken config would be the #5862 defect — a confident diagnosis
 * pointing somewhere innocent — rebuilt one layer down.
 *
 * ⛔ Deliberately does NOT take the config path (#11395). What it returns is a
 * CAUSE, and `groupFailuresByCause` keys on that — so a classifier able to name
 * the config is a classifier able to put a per-config string in the key and split
 * one cause into N. It took `configPath` for exactly one purpose, the rerun
 * command, and that is a remedy detail the REPORT renders per config.
 *
 * @param {string} text the CLI's own failure text (`report.error`, or a thrown message)
 * @returns {{ reason: string, evidence: string, fix: string }}
 */
function explainConfigFailure(text) {
  const evidence = evidenceLine(text);
  const missing = String(text ?? '').match(/Cannot find (?:module|package) '([^']+)'/);
  if (missing) {
    const pkg = packageNameFromSpecifier(missing[1]);
    // A specifier that reaches INTO a package's build output is installed but
    // unbuilt; one that names the package alone was never installed at all.
    if (pkg && /(?:^|\/)dist\//.test(missing[1])) {
      return {
        reason: `\`os lint\` could not load the config: \`${pkg}\` is installed but has no build output in this worktree`,
        evidence,
        fix: WORKSPACE_BUILD_FIX,
      };
    }
    return {
      reason: `\`os lint\` could not load the config: ${pkg ? `\`${pkg}\`` : 'a module it imports'} cannot be resolved from this worktree`,
      evidence,
      fix: INSTALL_THEN_BUILD_FIX,
    };
  }
  return {
    reason: '`os lint` failed on this config — the reading below is the CLI\'s own words, not this gate\'s',
    evidence,
    fix: RERUN_BY_HAND,
  };
}

/**
 * `os lint` wrote nothing at all — the second of the three ways one config can
 * fail to yield a number.
 *
 * Pure, and lifted out of `measureI18nIssues` for that reason (#11395): CI builds
 * the workspace before this gate runs, so CI never reaches this branch, and a
 * verdict constructed inline inside a function that spawns a CLI cannot be pinned
 * by `--self-test`. It is the branch the twelve-way split was measured on.
 *
 * @param {string} stderr the only reading there is when stdout was empty
 */
function emptyOutputFailure(stderr) {
  return {
    reason: '`os lint` produced no output at all — no JSON payload to count',
    // stderr is the only reading there is when stdout was empty. It was already
    // captured for the signature net in `measureI18nIssues`; discarding it here
    // would leave the reader a verdict with nothing under it.
    evidence: evidenceLine(stderr),
    fix: RERUN_BY_HAND,
  };
}

/**
 * `os lint` wrote something that is not JSON — the third way, pure for the same
 * reason as above.
 *
 * The byte count and the parser's message are a READING, so they belong in
 * `evidence`. They used to be interpolated into `reason`, which is the OTHER half
 * of the grouping key — so two configs whose non-JSON output differed by a byte,
 * or which tripped the parser at different offsets, were one cause reported as
 * two. Same #5217 defect as `fix`'s, arriving through the other half, and it would
 * have survived a fix that only addressed `fix` (#11395).
 *
 * @param {string} raw what landed in the capture file
 * @param {unknown} parseError what `JSON.parse` said about it
 */
function nonJsonOutputFailure(raw, parseError) {
  const said = parseError instanceof Error ? parseError.message : String(parseError);
  return {
    reason: '`os lint` wrote output that is not JSON — no payload to count',
    evidence: evidenceLine(`${said} — ${raw.length} byte(s), beginning: ${raw}`, 160),
    fix: RERUN_BY_HAND,
  };
}

/**
 * The package a failed specifier belongs to, or '' when it names none. Handles the
 * two shapes node produces: a resolved absolute path (`…/node_modules/@scope/name/
 * dist/index.mjs`) and a bare specifier (`@scope/name/sub`).
 */
function packageNameFromSpecifier(specifier) {
  const marker = 'node_modules/';
  const at = String(specifier ?? '').lastIndexOf(marker);
  const tail = at === -1 ? String(specifier ?? '') : specifier.slice(at + marker.length);
  if (!tail || tail.startsWith('/') || tail.startsWith('.')) return '';
  const parts = tail.split('/');
  const name = parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return name.endsWith('.mjs') || name.endsWith('.js') || name.endsWith('.ts') ? '' : name;
}

/**
 * The POPULATION classifier (#10907): is there anything to judge at all?
 *
 * Pure — list in, verdict out — so `--self-test` drives both directions. That
 * matters more here than for any other classifier in this file: an empty
 * population is the one failure that RENDERS AS A PASS, so a gate that had only
 * ever observed its own green path could not tell the two apart. That is #4690
 * exactly, and `trackedFiles` in `scripts/pm/dispatch-gates.mjs` refuses an empty
 * listing on the same grounds — "zero is a broken scan, not a clean repo".
 *
 * Judged on the UNION, deliberately, not per half. A single vanished config is
 * already this gate's business: the two-sided ratchet reports it as a DOWN and
 * tells the reader to `--update`. Refusing on an empty HALF would preempt that
 * legitimate path — the last example being retired is a real event, not a broken
 * scan. Only a total wipe is indistinguishable from a scan that read nothing, and
 * only a total wipe is refused here.
 *
 * @param {string[]} configPaths the discovered population, repo-relative
 * @returns {{ headline: string, detail: string[] } | null} null when there is work to do
 */
function emptyPopulationVerdict(configPaths) {
  if (configPaths.length > 0) return null;
  return {
    headline: 'the config population came back EMPTY — there is nothing to measure',
    detail: [
      `Neither \`${EXAMPLES_DIR}/*/objectstack.config.ts\` nor any`,
      `\`${PACKAGES_DIR}/**/scripts/i18n-extract.config.ts\` was found under the root this`,
      `script derives from its own location:`,
      ``,
      `  ${REPO_ROOT}`,
      ``,
      `Zero is a broken scan, not a repo with nothing to translate (#4690). Note what`,
      `an empty population costs THIS gate specifically: it is a two-sided ratchet, so`,
      `a config that really did vanish is caught by the DOWN direction — but the`,
      `population and the baseline are read the same way, so a tree this script cannot`,
      `read empties BOTH, leaving the comparison with nothing to disagree about and a`,
      `verdict identical to a real pass. Refusing rather than reporting OK over nothing.`,
    ],
  };
}

/**
 * Distinct CAUSES, each carrying the configs it explains. Keyed on the CONCLUSION
 * (reason + fix) rather than the raw reading, because one unbuilt package produces
 * a different absolute path per config and those are the same fact told twelve
 * times — exactly the "one cause reported as N results" shape #5217 closed on the
 * neighbouring gate. The first reading is kept as the group's evidence.
 *
 * ⚠️ The key is only as good as its two halves, and #11395 is what happens when
 * either one carries per-config detail: whatever a producer interpolates into
 * `reason` or `fix` becomes part of a cause's identity, silently, and the grouping
 * degrades into a per-config list while still printing "N distinct causes". So the
 * invariant lives upstream of this function, in what the producers are ABLE to
 * say: no classifier receives a config path, and `fix` is drawn from the closed
 * `SHARED_REMEDIES` set. Both are pinned as properties over every failure branch
 * in `selfTest` — ⛔ do not "fix" a future split by normalising a path back out of
 * the key here, which restores the symptom's cure and leaves the next helper free
 * to re-open it.
 *
 * @param {{configPath: string, reason: string, evidence: string, fix: string}[]} failures
 */
function groupFailuresByCause(failures) {
  const groups = new Map();
  for (const f of failures) {
    const key = JSON.stringify([f.reason, f.fix]);
    const group = groups.get(key) ?? { reason: f.reason, fix: f.fix, evidence: f.evidence, configPaths: [] };
    group.configPaths.push(f.configPath);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * Untranslated declared strings `os lint` would show for one config — or WHY that
 * could not be measured.
 *
 * Returns `{ count }` or `{ failure }` and never throws for a per-config problem
 * (#6033), so one unlintable example cannot hide the eleven configs behind it. The
 * one thing that still stops the round from in here is the missing-CLI
 * prerequisite, deliberately: every remaining config would fail for that same
 * single reason (#5862), so continuing would print one environment fact N times.
 *
 * Captured to a FILE rather than a pipe. Node writes stdout synchronously to a
 * file and asynchronously to a pipe, so a command that exits right after a
 * large `console.log` can hand a pipe reader a payload cut off at one 64 KiB
 * buffer — which is exactly what `os lint --json` did on `platform-objects`
 * until the `emitJson` fix. A gate must never be able to read a truncated
 * payload and quietly report a smaller number, so it does not use a pipe at all.
 */
function measureI18nIssues(configPath) {
  const tmp = join(tmpdir(), `os-lint-${randomUUID()}.json`);
  const fd = openSync(tmp, 'w');
  try {
    let stderr = '';
    try {
      // `CLI` and `configPath` are both REPO-RELATIVE, so the child's cwd is what
      // resolves them — anchoring it here is what makes an off-root run measure the
      // real population instead of failing twelve times (#10907). It also keeps
      // `os lint`'s own workspace resolution pointed at the repo, not at wherever
      // the caller happened to stand.
      execFileSync(process.execPath, [CLI, 'lint', configPath, '--json'], {
        cwd: REPO_ROOT,
        stdio: ['ignore', fd, 'pipe'],
      });
    } catch (err) {
      // `os lint` exits non-zero whenever the config has errors of any kind;
      // the JSON payload is still what we want. A run that produced no output
      // is a hard failure — never silently a zero.
      //
      // stderr is kept, not discarded: oclif reports an unresolvable command
      // there, and that text is the difference between "this config is broken"
      // and "your workspace is not built". `execFileSync` surfaces it only on
      // the throw path, which is the only path this can arrive on — a command
      // oclif cannot find always exits non-zero (measured: 2).
      stderr = String(err?.stderr ?? '');
    }
    closeSync(fd);
    const raw = readFileSync(tmp, 'utf8');

    // The prerequisite's safety net, checked BEFORE the empty-output failure
    // below — otherwise a missing build reports as "no output for <config>" and
    // sends the reader into a config that is not at fault (#5862). It fires on
    // what the pre-loop probe cannot see: a stale build whose command surface no
    // longer answers to this id, a partial dist that satisfies the file check, or
    // a package.json shape the derivation could not read. Aborting on the FIRST
    // config is the point — every remaining one fails for the same one reason.
    const signature = looksLikeMissingCliCommand(`${raw}\n${stderr}`);
    if (signature) {
      reportPrerequisiteNotMet('the built CLI cannot resolve the command this gate runs', [
        `\`os ${LINT_COMMAND_ID.join(' ')}\` exited with oclif's own "command not found":`,
        ``,
        `  ${signature.length > 160 ? `${signature.slice(0, 160)}…` : signature}`,
        ``,
        `${configPath} is NOT at fault — it is simply the first config this gate`,
        `reached. Every remaining one would fail the same way for the same reason,`,
        `so the loop stopped here rather than blaming an example.`,
      ]);
    }

    // The three ways one config can fail to yield a number. Each is that config's
    // OWN cause, so each comes back as a collected failure rather than an
    // exception: the round continues, and the reader gets all of them at once.
    if (!raw.trim()) return { failure: emptyOutputFailure(stderr) };
    let report;
    try {
      report = JSON.parse(raw);
    } catch (err) {
      return { failure: nonJsonOutputFailure(raw, err) };
    }
    if (report.error) return { failure: explainConfigFailure(report.error) };
    return { count: countI18nRuleIssues(report) };
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone */ }
  }
}

/**
 * The round: measure every config, collect the ones that could not be measured,
 * and never let one of them end the round (#6033).
 *
 * `measure` is injected so `--self-test` can prove the collecting behaviour with no
 * CLI and no build — the behaviour CI can never observe, because CI builds the whole
 * workspace before this gate runs and therefore only ever sees the green path.
 *
 * The try/catch is the outer net, not the mechanism: `measureI18nIssues` reports its
 * own failures as values, and anything that still throws (a spawn that fails, an
 * unreadable temp file) is one more config-shaped failure — never a reason for the
 * other eleven to go unmeasured.
 *
 * @param {string[]} configPaths
 * @param {(configPath: string) => {count: number} | {failure: {reason: string, evidence: string, fix: string}}} measure
 */
function measureAllConfigs(configPaths, measure) {
  const current = {};
  const failures = [];
  for (const configPath of configPaths) {
    let result;
    try {
      result = measure(configPath);
    } catch (err) {
      result = { failure: explainConfigFailure(err?.message ?? String(err)) };
    }
    if (result?.failure) failures.push({ configPath, ...result.failure });
    else current[configPath] = result.count;
  }
  return { current, failures };
}

// ---------------------------------------------------------------------------
// Self-test — the proof that each classifier can go red. A gate observed only
// green is indistinguishable from a gate that matches nothing (#4690), and the
// prerequisite classifier is the one that can never be observed red in CI: CI
// always builds first, so nothing else would ever exercise it.
// ---------------------------------------------------------------------------

function selfTest() {
  const failures = [];
  const expect = (name, cond, detail) => {
    if (!cond) failures.push(`${name} — ${detail}`);
  };

  // Both recorded VERBATIM from `node packages/cli/bin/run.js lint <config> --json`
  // in an installed-but-unbuilt worktree at f192981fe — the run reproduced in
  // #5862. oclif wraps its one-sentence error at a width that depends on the
  // config path, so the same failure arrives in two shapes: the examples' short
  // paths stay on one line, while the package extract configs `discoverPackages()`
  // feeds this same gate wrap across three. Keep both — a per-line regex passes
  // the first and fails the second, which is the implementation this corpus
  // exists to reject.
  const OCLIF_LINT_UNWRAPPED = ' ›   Error: command lint:examples/app-crm/objectstack.config.ts not found';
  const OCLIF_LINT_WRAPPED_3_LINE =
    ' ›   Error: command \n ›   lint:packages/plugins/plugin-approvals/scripts/i18n-extract.config.ts not \n ›   found';

  expect('#5862 unwrapped form', !!looksLikeMissingCliCommand(OCLIF_LINT_UNWRAPPED), 'the single-line form must match');
  expect('#5862 wrapped 3-line', !!looksLikeMissingCliCommand(OCLIF_LINT_WRAPPED_3_LINE), 'oclif line wrapping must not hide the signature');
  expect(
    '#5862 flattens for the message',
    looksLikeMissingCliCommand(OCLIF_LINT_WRAPPED_3_LINE) ===
      'Error: command lint:packages/plugins/plugin-approvals/scripts/i18n-extract.config.ts not found',
    `the evidence line must come back as one readable sentence; got ${JSON.stringify(looksLikeMissingCliCommand(OCLIF_LINT_WRAPPED_3_LINE))}`,
  );

  // Must not contaminate — or be contaminated by — the content verdict. A real
  // untranslated-label result on a correctly built workspace must never be
  // reported as "your workspace is not built", which would send the reader to run
  // a build that changes nothing and hide the actual coverage regression.
  const REAL_LINT_REPORT = {
    issues: [
      { rule: 'i18n/missing-translation', severity: 'warning', message: "object 'contacts' label is untranslated for zh-CN" },
      { rule: 'i18n/missing-translation', severity: 'warning', message: "field 'contacts.email' label is untranslated for ja-JP" },
      { rule: 'schema/unknown-key', severity: 'error', message: "'foo' is not a declared object key" },
    ],
  };
  expect(
    '#5862 a real report is not a missing build',
    !looksLikeMissingCliCommand(JSON.stringify(REAL_LINT_REPORT)),
    'lint output leaked into the prerequisite verdict',
  );
  expect(
    '#5862 empty output is not a missing build',
    !looksLikeMissingCliCommand(''),
    'no output at all is a different failure and keeps its own message',
  );
  expect(
    '#5862 unrelated failure is not a missing build',
    !looksLikeMissingCliCommand("Error: Cannot find module 'node:fs/promises'\n  at ModuleJob.run"),
    'only oclif command resolution may claim this verdict',
  );

  // The probe derives its path from the CLI's own declaration; pin the derivation
  // against the real oclif block so a moved `target` is caught here rather than by
  // a probe that quietly checks a path nothing writes any more. `lint` is a
  // SINGLE-segment id — the topic-less shape #5217's corpus never exercised.
  const derived = oclifCommandFileFor(
    { oclif: { commands: { strategy: 'pattern', target: './dist/commands', glob: '**/*.js' } } },
    LINT_COMMAND_ID,
  );
  expect('#5862 derives the command file', derived.file === 'packages/cli/dist/commands/lint.js', `got ${JSON.stringify(derived)}`);
  const undeclaredTarget = oclifCommandFileFor({ oclif: {} }, LINT_COMMAND_ID);
  expect(
    '#5862 unreadable shape defers, loudly',
    !!undeclaredTarget.unknown && !undeclaredTarget.file,
    `an unreadable oclif block must yield a reason, not a guessed path; got ${JSON.stringify(undeclaredTarget)}`,
  );

  // The content classifier. Its silent-failure mode is narrower than the
  // prerequisite's — a classifier that stopped matching would drive every count
  // to 0 and the ratchet's DOWN direction fails on that — but the `i18n/` prefix
  // is a contract with `os lint --json`, so pin it rather than infer it.
  expect('#5862 counts i18n rules', countI18nRuleIssues(REAL_LINT_REPORT) === 2, `got ${countI18nRuleIssues(REAL_LINT_REPORT)}`);
  expect(
    '#5862 ignores other rules',
    countI18nRuleIssues({ issues: [{ rule: 'schema/unknown-key' }, { rule: 'i18nx/not-ours' }] }) === 0,
    'only the `i18n/` namespace counts',
  );
  expect('#5862 tolerates an issue-less report', countI18nRuleIssues({}) === 0, 'a clean report is 0, never a crash');

  // -------------------------------------------------------------------------
  // The per-config failure classifier and the collecting round (#6033). Pinned
  // here or nowhere, for the same reason as the prerequisite above: CI builds the
  // whole workspace before this gate runs, so nothing in CI ever reaches this path.
  // -------------------------------------------------------------------------

  // Recorded VERBATIM from `os lint examples/app-showcase/objectstack.config.ts
  // --json` on a tree where ONLY `@objectstack/cli` had been built (the #6033
  // repro), with the absolute worktree prefix normalised to `/repo`. This exact
  // string is what the CLI puts in `report.error` — i.e. what the gate used to
  // interpolate into a thrown Error and hand to node as a stack.
  const REAL_UNBUILT_DEP_ERROR =
    "Cannot find module '/repo/examples/app-showcase/node_modules/@objectstack/connector-mcp/dist/index.mjs' " +
    "imported from /repo/examples/app-showcase/objectstack.config.bundled_yqbr4ytyonb.mjs";

  const unbuilt = explainConfigFailure(REAL_UNBUILT_DEP_ERROR);
  expect('#6033 blames the package, not the config', unbuilt.reason.includes('@objectstack/connector-mcp'), `got ${JSON.stringify(unbuilt.reason)}`);
  expect('#6033 concludes "installed but not built"', /has no build output/.test(unbuilt.reason), `got ${JSON.stringify(unbuilt.reason)}`);
  expect('#6033 prescribes the workspace build', unbuilt.fix === WORKSPACE_BUILD_FIX, `got ${JSON.stringify(unbuilt.fix)}`);
  expect('#6033 keeps the CLI reading as evidence', unbuilt.evidence.includes('Cannot find module'), 'a conclusion with no reading under it is not auditable');
  expect('#6033 evidence is one line', !unbuilt.evidence.includes('\n'), 'evidence must be a line, not a stack');

  // A package that is not installed at all cannot be fixed by a build alone.
  const uninstalled = explainConfigFailure("Cannot find package '@objectstack/nope' imported from /repo/x/y.ts");
  expect('#6033 uninstalled is not unbuilt', uninstalled.fix === INSTALL_THEN_BUILD_FIX, `got ${JSON.stringify(uninstalled.fix)}`);

  // A genuinely broken config must NOT be told to run a build: sending a reader to
  // a build that changes nothing, over a config that really is at fault, is the
  // #5862 defect (a confident diagnosis pointing somewhere innocent) inverted.
  const brokenConfig = explainConfigFailure("Duplicate object name 'contacts'");
  expect('#6033 a config error is not a missing build', brokenConfig.fix !== WORKSPACE_BUILD_FIX, `got ${JSON.stringify(brokenConfig.fix)}`);
  expect('#6033 a config error keeps the CLI words', brokenConfig.evidence.includes("Duplicate object name 'contacts'"), `got ${JSON.stringify(brokenConfig.evidence)}`);

  // Anti-#4690 applied to the fallback branch: an unrecognised cause must still
  // yield a COMPLETE verdict. A collected failure with a blank reason or no fix is
  // how this path would go quiet — the report would render an empty bullet and the
  // round would still exit 1 with nothing for the reader to act on.
  for (const [name, sample] of [['unknown wording', 'something nobody has recorded yet'], ['empty', ''], ['absent', undefined]]) {
    const verdict = explainConfigFailure(sample);
    expect(`#6033 complete verdict (${name})`, !!verdict.reason && !!verdict.fix, `got ${JSON.stringify(verdict)}`);
  }

  // The round itself: one config's failure must not end it. Injected `measure`, so
  // this runs with no CLI and no build. Configs 1 and 3 fail with DIFFERENT causes
  // (one thrown, one returned), 2 and 4 measure.
  const visited = [];
  const round = measureAllConfigs(['a.ts', 'b.ts', 'c.ts', 'd.ts'], (p) => {
    visited.push(p);
    if (p === 'a.ts') throw new Error("Cannot find module '/repo/a/node_modules/@objectstack/spec/dist/index.mjs'");
    if (p === 'c.ts') return { failure: explainConfigFailure("Cannot find module '/repo/c/node_modules/@objectstack/connector-rest/dist/index.mjs'") };
    return { count: 7 };
  });
  expect('#6033 attempts every config', visited.length === 4, `the round stopped after ${visited.length} of 4 config(s)`);
  expect('#6033 collects both failures', round.failures.length === 2, `got ${round.failures.length}`);
  expect('#6033 a thrown failure is collected, not escaped', round.failures.some((f) => f.configPath === 'a.ts'), 'an exception ended the round');
  expect(
    '#6033 keeps the configs that did measure',
    Object.keys(round.current).length === 2 && round.current['b.ts'] === 7 && round.current['d.ts'] === 7,
    `got ${JSON.stringify(round.current)}`,
  );

  // Two different causes stay two; ONE cause shared by several configs is stated
  // once, with the configs it covers — #5217's rule, which the collecting shape
  // must not undo on its way to satisfying #6033.
  expect('#6033 distinct causes stay distinct', groupFailuresByCause(round.failures).length === 2, `got ${groupFailuresByCause(round.failures).length}`);
  const sharedCause = groupFailuresByCause(
    ['a.ts', 'b.ts', 'c.ts'].map((p) => ({
      configPath: p,
      // Same missing package, different absolute path per config — the same fact
      // told three times, which must not become three verdicts.
      ...explainConfigFailure(`Cannot find module '/repo/${p}/node_modules/@objectstack/spec/dist/index.mjs'`),
    })),
  );
  expect('#6033 one cause is stated once', sharedCause.length === 1, `got ${sharedCause.length} cause(s) for one missing package`);
  expect('#6033 …carrying every config it covers', sharedCause[0]?.configPaths.length === 3, `got ${JSON.stringify(sharedCause[0]?.configPaths)}`);

  // -------------------------------------------------------------------------
  // #11395 — the same rule, pinned over EVERY failure branch instead of one.
  //
  // The assertion directly above passed throughout the defect: it drives the
  // CLASSIFIED branch, whose `fix` was already a constant. Three other branches
  // set `fix` to `rerunFix(configPath)`, so each config got a unique key and the
  // report printed `12 of 12 config(s) failed to lint (12 distinct causes)` over
  // one environment fact — twelve blocks, twelve identical `why:` lines. A fourth
  // put the byte count and the parser's offset in `reason`, the other half of the
  // key. One example per defect would have missed the second; this is written as a
  // PROPERTY over every branch that can produce a failure, so a branch added later
  // is a line in the table rather than a hole.
  //
  // Each branch is driven with THREE configs failing the SAME way, with per-config
  // detail in the CLI's words — the shape a real round produces.
  // -------------------------------------------------------------------------

  const SAME_CAUSE_CONFIGS = [
    'examples/app-crm/objectstack.config.ts',
    'examples/app-todo/objectstack.config.ts',
    'packages/plugins/plugin-audit/scripts/i18n-extract.config.ts',
  ];
  /** @type {[string, (configPath: string, i: number) => {reason: string, evidence: string, fix: string}][]} */
  const FAILURE_BRANCHES = [
    ['unbuilt dependency', (p) => explainConfigFailure(`Cannot find module '/repo/${p}/node_modules/@objectstack/spec/dist/index.mjs'`)],
    ['uninstalled package', (p) => explainConfigFailure(`Cannot find package '@objectstack/nope' imported from /repo/${p}`)],
    ['unrecognised CLI failure', (p) => explainConfigFailure(`os lint gave up while reading /repo/${p}`)],
    ['no output at all', (p) => emptyOutputFailure(`Error [ERR_MODULE_NOT_FOUND]: nothing resolved for /repo/${p}`)],
    // Different LENGTHS and different parser offsets on purpose: those were the
    // per-config strings `reason` used to carry.
    ['output that is not JSON', (p, i) => nonJsonOutputFailure(`<!DOCTYPE html>${'!'.repeat(i * 17)}`, new SyntaxError(`Unexpected token < in JSON at position ${i}`))],
  ];
  for (const [branch, make] of FAILURE_BRANCHES) {
    const grouped = groupFailuresByCause(SAME_CAUSE_CONFIGS.map((p, i) => ({ configPath: p, ...make(p, i) })));
    expect(
      `#11395 one cause is stated once (${branch})`,
      grouped.length === 1,
      `three configs failing the same way produced ${grouped.length} cause(s) — a per-config string reached the key: ${JSON.stringify(grouped.map((g) => [g.reason, g.fix]))}`,
    );
    expect(
      `#11395 …carrying every config it covers (${branch})`,
      grouped[0]?.configPaths.length === 3,
      `got ${JSON.stringify(grouped[0]?.configPaths)}`,
    );
    expect(
      `#11395 …with no config path in the cause's identity (${branch})`,
      SAME_CAUSE_CONFIGS.every((p) => !grouped[0]?.reason.includes(p) && !grouped[0]?.fix.includes(p)),
      `\`reason\`/\`fix\` are the grouping key and must name no config; got ${JSON.stringify([grouped[0]?.reason, grouped[0]?.fix])}`,
    );
    expect(
      `#11395 …prescribing a remedy from the closed set (${branch})`,
      SHARED_REMEDIES.includes(grouped[0]?.fix),
      `\`fix\` is half the key, so it must be one of this gate's constants; got ${JSON.stringify(grouped[0]?.fix)}`,
    );
  }

  // The converse, and the reason the above is a property rather than "collapse
  // everything": DIFFERENT causes must stay different. A `groupFailuresByCause`
  // that keyed on nothing at all would satisfy every assertion above and destroy
  // the report — this is the assertion that makes them mean something.
  const sixDistinct = groupFailuresByCause([
    { configPath: 'a.ts', ...explainConfigFailure("Cannot find module '/repo/a/node_modules/@objectstack/spec/dist/index.mjs'") },
    { configPath: 'b.ts', ...explainConfigFailure("Cannot find module '/repo/b/node_modules/@objectstack/core/dist/index.mjs'") },
    { configPath: 'c.ts', ...explainConfigFailure("Cannot find package '@objectstack/nope' imported from /repo/c") },
    { configPath: 'd.ts', ...explainConfigFailure('something nobody has recorded yet') },
    { configPath: 'e.ts', ...emptyOutputFailure('') },
    { configPath: 'f.ts', ...nonJsonOutputFailure('<html>', new SyntaxError('Unexpected token <')) },
  ]);
  expect('#11395 different causes stay different', sixDistinct.length === 6, `six distinct causes collapsed to ${sixDistinct.length}`);

  // The classified branches must group EXACTLY as they did before this change —
  // their `fix` was never per-config, so nothing about them was broken and nothing
  // about them may move. Pinned as the literal remedy strings a reader acts on.
  expect(
    '#11395 the classified branches are untouched',
    explainConfigFailure(REAL_UNBUILT_DEP_ERROR).fix === WORKSPACE_BUILD_FIX &&
      explainConfigFailure("Cannot find package '@objectstack/nope' imported from /repo/x/y.ts").fix ===
        INSTALL_THEN_BUILD_FIX,
    'the two classified remedies are the text a reader runs; they must not move',
  );

  // The two remedies are still DISTINCT and still say what they used to say
  // about each other: a package that is on disk but unbuilt needs a build, and
  // one that is not there at all needs an install FIRST. #12564 changed what the
  // build half spells, not which branch prescribes it.
  expect(
    '#12564 the two classified remedies stay distinct',
    WORKSPACE_BUILD_FIX !== INSTALL_THEN_BUILD_FIX &&
      INSTALL_THEN_BUILD_FIX === `pnpm install && ${WORKSPACE_BUILD_FIX}` &&
      WORKSPACE_BUILD_FIX !== CLI_BUILD_FIX,
    'the unbuilt / not-installed / CLI-only remedies must not collapse into one another',
  );

  // -------------------------------------------------------------------------
  // Root anchoring and the population classifier (#10907). These are the only
  // assertions in this file that can fail over a CORRECT tree in a WRONG place,
  // and that is the whole point: every other classifier here is proven red with a
  // recorded string, but "did this gate look at anything at all?" can only be
  // proven by looking.
  // -------------------------------------------------------------------------

  // The derivation must land on THIS repo's root — one level off would still find
  // a `scripts/` directory, so pin files only the root has, this gate's own two
  // included.
  expect(
    '#10907 derives the repo root',
    existsSync(at('package.json')) && existsSync(at(BASELINE_PATH)) && existsSync(at('scripts/check-i18n-coverage.mjs')),
    `REPO_ROOT does not look like this repo's root: ${REPO_ROOT}`,
  );

  // The anchoring itself, proven the only way that means anything: from a cwd that
  // is NOT the repo root. This single assertion is the #10907 defect — before the
  // fix both discoveries read a bare `examples` / `packages`, came back empty from
  // anywhere else, and the gate printed `OK (0 config(s))` and exited 0. cwd is
  // restored in a `finally`: it is process-global state, and a self-test that
  // leaves it moved would corrupt every measurement after it.
  const cwdBefore = process.cwd();
  let offRoot;
  try {
    process.chdir(tmpdir());
    offRoot = [...discoverExamples(), ...discoverPackages()];
  } finally {
    process.chdir(cwdBefore);
  }
  const onRoot = [...discoverExamples(), ...discoverPackages()];
  expect(
    '#10907 discovery is CWD-independent',
    offRoot.length > 0,
    `discovery from ${tmpdir()} found ${offRoot.length} config(s) — the population is still resolved CWD-relatively, ` +
      'which is the whole defect: an empty population renders as a pass',
  );
  expect(
    '#10907 …and finds exactly the population the root does',
    offRoot.join('\n') === onRoot.join('\n'),
    `off-root found ${offRoot.length} config(s), on-root ${onRoot.length} — anchoring must not change WHAT is scanned`,
  );
  expect(
    '#10907 …spelled repo-relative, as the baseline keys are',
    offRoot.every((p) => !p.startsWith('/') && !p.includes(REPO_ROOT)),
    `absolute paths would silently re-key every baseline entry; got ${JSON.stringify(offRoot.slice(0, 2))}`,
  );

  // -------------------------------------------------------------------------
  // The build-prerequisite CLOSURE (#12564). What makes the remedy worth naming
  // is that ONE round of it clears the whole population — so the property to pin
  // is COMPLETENESS, and the failure to refuse is a closure that names SOME of
  // the population. A partial closure is the worse half of this card's defect: it
  // looks derived, it is specific, and it still does not converge.
  // -------------------------------------------------------------------------
  const derivedClosure = closureBuildFix(onRoot);
  expect(
    '#12564 the live population yields a closure',
    typeof derivedClosure.command === 'string' && derivedClosure.command.length > 0,
    `no closure could be named for ${onRoot.length} config(s): ${derivedClosure.unknown ?? '(no reason given)'}`,
  );
  // Every config's OWN owner must be in the command. Compared per config against
  // the same manifests the derivation read, not against a list written here — a
  // list would be the hand-maintained note this derivation exists to avoid.
  const missingOwners = onRoot
    .map((configPath) => owningPackageOf(configPath))
    .filter((owner) => !owner || !(derivedClosure.command ?? '').includes(`--filter=${owner}`));
  expect(
    '#12564 …naming every config in the population',
    missingOwners.length === 0,
    `${missingOwners.length} owner(s) absent from the closure (${missingOwners.join(', ')}) — a closure that ` +
      'misses one config leaves the reader exactly the round-trip this remedy exists to remove',
  );
  // The CLI is in it too. Without that, the command printed under PREREQUISITE
  // NOT MET would not clear the prerequisite it is printed for — a remedy whose
  // success condition it cannot itself reach.
  expect(
    '#12564 …and the CLI the gate spawns',
    (derivedClosure.command ?? '').includes('--filter=@objectstack/cli'),
    'the closure must clear the CLI prerequisite it is offered as the remedy for',
  );
  // ⛔ ALL-OR-NOTHING. A broken scan is the sharp case: with the CLI always
  // seeded, an EMPTY population would render as `--filter=@objectstack/cli`
  // alone — byte-for-byte the CLI-only remedy this card exists to replace,
  // presented as though it were the whole closure. That is a guard whose
  // total-failure output is indistinguishable from a plausible success. One
  // unowned config is the same defect part-way. Both must come back as a REASON,
  // never a command — the rule `emptyPopulationVerdict` states for the verdict.
  const emptyClosure = closureBuildFix([]);
  const partialClosure = closureBuildFix([...onRoot, 'no/such/place/objectstack.config.ts']);
  expect(
    '#12564 an empty population names no closure',
    emptyClosure.command === undefined && typeof emptyClosure.unknown === 'string',
    `an empty population produced a command (${emptyClosure.command}) — a broken scan must not render as the ` +
      'CLI-only remedy wearing the closure\'s name',
  );
  expect(
    '#12564 …and one unowned config refuses the WHOLE closure',
    partialClosure.command === undefined && typeof partialClosure.unknown === 'string',
    'a closure missing one config is this card\'s own defect wearing a derivation\'s clothes',
  );
  // The refusals this gate is CREDITED for do not move (#12564 fence 2). The
  // remedy got longer; nothing about it may turn a refusal into a pass, so the
  // two headlines stay reachable and the partial round still declines to judge.
  expect(
    '#12564 the refusal semantics did not move',
    measureAllConfigs(['x.ts', 'y.ts'], (c) =>
      c === 'x.ts' ? { failure: explainConfigFailure(REAL_UNBUILT_DEP_ERROR) } : { count: 0 },
    ).failures.length === 1,
    'a partial round must still collect a failure — a round that reports green over an unmeasured config is ' +
      'strictly worse than the four rounds this card is about',
  );

  // The SHARED probe's own anchoring (#11394). #10907 anchored this FILE; the
  // module it asks "is the CLI built?" kept reading `packages/cli/package.json`
  // CWD-relatively, so from any other cwd the probe ENOENTed and deferred — and
  // every off-root run was preceded by a line about a workspace that was fine.
  // Pinned here rather than in the shared module because the module has no
  // self-test of its own: both of its consumers pin its classifiers, and this is
  // the one property of it that a recorded string cannot prove.
  const probeCwdBefore = process.cwd();
  let offRootProbe;
  try {
    process.chdir(tmpdir());
    offRootProbe = resolveCliCommandFile(LINT_COMMAND_ID);
  } finally {
    process.chdir(probeCwdBefore);
  }
  const onRootProbe = resolveCliCommandFile(LINT_COMMAND_ID);
  expect(
    '#11394 the shared CLI probe answers a path, not a deferral',
    !!onRootProbe.file && !onRootProbe.unknown,
    `over this repo the probe must derive the command file; got ${JSON.stringify(onRootProbe)}`,
  );
  expect(
    '#11394 …and answers the same from any cwd',
    JSON.stringify(offRootProbe) === JSON.stringify(onRootProbe),
    `off-root the probe said ${JSON.stringify(offRootProbe)}, on-root ${JSON.stringify(onRootProbe)} — ` +
      'the read behind it is CWD-relative again',
  );
  expect(
    '#11394 …spelled repo-relative, as every message and rerun command is',
    typeof onRootProbe.file === 'string' && !onRootProbe.file.startsWith('/') && !onRootProbe.file.includes(REPO_ROOT),
    `anchoring the READ must not leak into the vocabulary; got ${JSON.stringify(onRootProbe)}`,
  );
  // …and the consumer side of the same seam: this gate asks the FILESYSTEM about
  // that repo-relative answer, and `at()` is what makes the question land on the
  // repo rather than the cwd. Unanchored it would report "the workspace CLI is not
  // built" from a foreign cwd over a built one — which is why the probe resolving
  // and this check being anchored are one change, not two.
  //
  // Proven with a read that is true on ANY tree rather than by comparing
  // `existsSync` on the command file: `--self-test` runs with no build, where that
  // file is absent from both cwds and the comparison would agree over nothing.
  let anchoredReadOffRoot;
  let bareReadOffRoot;
  try {
    process.chdir(tmpdir());
    anchoredReadOffRoot = existsSync(at('scripts/check-i18n-coverage.mjs'));
    bareReadOffRoot = existsSync('scripts/check-i18n-coverage.mjs');
  } finally {
    process.chdir(probeCwdBefore);
  }
  expect(
    '#11394 an anchored read lands on the repo from a foreign cwd',
    anchoredReadOffRoot,
    `at() did not reach this repo from ${tmpdir()} — REPO_ROOT is ${REPO_ROOT}`,
  );
  expect(
    '#11394 …and the bare spelling demonstrably would not have',
    !bareReadOffRoot,
    'the bare spelling resolved off-root too, so this assertion proves nothing about anchoring',
  );

  // Anti-#4690 on the population itself. Red on nothing is the assertion that
  // matters — this is the one verdict whose failure mode is a green line.
  expect('#10907 an empty population is refused', !!emptyPopulationVerdict([]), 'zero configs must never be a pass');
  expect(
    '#10907 …with a complete verdict',
    !!emptyPopulationVerdict([])?.headline && (emptyPopulationVerdict([])?.detail?.length ?? 0) > 0,
    `a refusal with no reading under it is not auditable; got ${JSON.stringify(emptyPopulationVerdict([]))}`,
  );
  expect(
    '#10907 a real population is not refused',
    emptyPopulationVerdict(['examples/app-crm/objectstack.config.ts']) === null,
    'one config is work to do, not a broken scan — refusing it would preempt the ratchet-DOWN path',
  );
  expect(
    '#10907 the live population is not refused',
    emptyPopulationVerdict(onRoot) === null,
    `the real tree resolved to ${onRoot.length} config(s) and must be judged, not refused`,
  );

  if (failures.length) {
    console.error(`✗ check:i18n-coverage --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(
    `✓ check:i18n-coverage --self-test — the missing-CLI-build, i18n-rule and per-config-failure classifiers all go red, ` +
      `stay distinct, and a failing config does not end the round; all ${FAILURE_BRANCHES.length} failure branches state ` +
      `one shared cause ONCE, with no config path in the key; the population resolves to ${onRoot.length} config(s) ` +
      `from outside the repo root as well as inside it, and an empty one is refused rather than reported OK; ` +
      `the build-prerequisite closure names all ${onRoot.length} of them plus the CLI, and refuses whole rather ` +
      `than naming some.`,
  );
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// The prerequisite: this gate runs the BUILT CLI (#5862).
// ---------------------------------------------------------------------------

/**
 * ONE prerequisite and ONE command to satisfy it — never per config, and never
 * phrased so it can be mistaken for a verdict about a config's translations.
 *
 * Exits 1, the same code the real verdict uses: any wrapper that treats non-zero
 * as failure keeps behaving identically, and inventing a second failure code
 * would be a new contract nobody asked for.
 *
 * The remedy is stated at TWO widths on purpose. `CLI_BUILD_FIX` is the command
 * that clears exactly what was checked, and nothing more — this probe measures the
 * CLI and may not claim anything about the rest of the tree. But unlike the
 * neighbouring bundles gate, this one also lints `examples/*`, whose configs import
 * other workspace packages by name; on a never-built tree, clearing only the CLI
 * just moves the wall (measured: `Cannot find module '…/@objectstack/connector-mcp/
 * dist/index.mjs'` from app-showcase). Naming the fuller command as the fuller
 * remedy costs one line and keeps this message from under-prescribing — which is
 * the same defect, one step later, as the diagnosis it replaces.
 */
function reportPrerequisiteNotMet(headline, detail) {
  console.error(
    `\ncheck-i18n-coverage: PREREQUISITE NOT MET — ${headline}\n\n` +
      detail.map((l) => (l ? `  ${l}` : '')).join('\n') +
      `\n\n  Fix:  ${WORKSPACE_BUILD_FIX}\n\n` +
      `        That is this gate's WHOLE prerequisite in ONE command (#12564) — the CLI,\n` +
      `        plus the build closure of every config in its population. Clearing only\n` +
      `        the CLI (\`${CLI_BUILD_FIX}\`)\n` +
      `        moves the wall rather than removing it: this gate also lints \`examples/*\`,\n` +
      `        whose configs import workspace packages by name.\n` +
      `        ⛔ And clearing it one package at a time does NOT converge. node stops\n` +
      `        resolving a config's imports at the FIRST one with no \`dist/\`, so each\n` +
      `        round can name exactly one more, however many are missing — measured at\n` +
      `        six rounds down a single config's import list. Run the closure once.\n\n` +
      `  Nothing was measured: no config was linted and no count was compared, so this\n` +
      `  result says NOTHING about whether any declared label went untranslated — and\n` +
      `  the baseline was left exactly as committed (\`--update\` included).\n` +
      `  (Exit code 1 — capture it BEFORE any pipe:\n` +
      `  \`pnpm check:i18n-coverage > /tmp/i18n-coverage.log 2>&1; echo "EXIT=$?"\`.\n` +
      `  Piped, \`$?\` is the LAST command's status, and \`head\`/\`tail\` essentially never fail — that\n` +
      `  is the false green, and no pipe shape repairs it. \`\${PIPESTATUS[0]}\`/\`pipefail\` do recover\n` +
      `  this gate's own code: \`| tail\` reads to EOF and forwards it, while \`| head -N\` closes the\n` +
      `  read end early — the gate takes EPIPE, its verdict text is TRUNCATED, and a producer that\n` +
      `  dies on SIGPIPE reports 141 rather than what it meant to say.)`,
  );
  process.exit(1);
}

/**
 * The collected verdict for configs that could not be measured (#6033) — one
 * entry per DISTINCT cause, each naming the configs it covers.
 *
 * Reached only after the whole round has been attempted, which is the point: the
 * reader gets every cause at once instead of the first one plus a node stack.
 *
 * It preempts the ratchet comparison, and that is deliberate rather than lazy. A
 * partial round cannot judge this gate's question: an unmeasured config is
 * indistinguishable from a deleted one, so the DOWN direction would tell the reader
 * to `--update` — and `--update` runs before any comparison, so it would freeze the
 * survivors and silently drop the rest, ratcheting real debt out of the baseline.
 * The same invariant `reportPrerequisiteNotMet` states: nothing measured, nothing
 * written.
 *
 * Exits 1, the same code every other verdict here uses.
 */
function reportUnmeasuredConfigs(failures, measuredCount) {
  const groups = groupFailuresByCause(failures);
  const total = failures.length + measuredCount;
  const blocks = groups.map((g, i) =>
    [
      `Cause ${i + 1} of ${groups.length} — ${g.configPaths.length} config(s):`,
      ...g.configPaths.map((p) => `  ${p}`),
      ``,
      `  why:  ${g.reason}`,
      ...(g.evidence ? [`  saw:  ${g.evidence}`] : []),
      `  fix:  ${g.fix}`,
      // The per-config remedy detail, rendered HERE — inside the block, once per
      // config — precisely so it stays out of the cause's identity (#11395). Every
      // other remedy is one command that clears every config it covers; this one
      // is the branch where there is no such command, so the reader gets theirs.
      ...(g.fix === RERUN_BY_HAND ? g.configPaths.map((p) => `        ${rerunCommand(p)}`) : []),
    ]
      .map((l) => (l ? `  ${l}` : ''))
      .join('\n'),
  );
  console.error(
    `\ncheck-i18n-coverage: COULD NOT MEASURE — ${failures.length} of ${total} config(s) failed to lint ` +
      `(${groups.length} distinct cause${groups.length === 1 ? '' : 's'})\n\n` +
      blocks.join('\n\n') +
      `\n\n  Every config was attempted, so the list above is EVERY one that failed — not\n` +
      `  merely the first. One config's failure no longer ends the round (#6033), and a\n` +
      `  cause shared by several configs is stated once, not once per config (#5217).\n\n` +
      `  Nothing was compared: ${measuredCount} config(s) did lint, but a partial round cannot judge\n` +
      `  the ratchet — an unmeasured config is indistinguishable from a deleted one, and\n` +
      `  \`--update\` would freeze the survivors while silently dropping the rest. So this\n` +
      `  result says NOTHING about whether any declared label went untranslated, and the\n` +
      `  baseline was left exactly as committed (\`--update\` included).\n` +
      `  (Exit code 1 — capture it BEFORE any pipe:\n` +
      `  \`pnpm check:i18n-coverage > /tmp/i18n-coverage.log 2>&1; echo "EXIT=$?"\`.\n` +
      `  Piped, \`$?\` is the LAST command's status, and \`head\`/\`tail\` essentially never fail — that\n` +
      `  is the false green, and no pipe shape repairs it. \`\${PIPESTATUS[0]}\`/\`pipefail\` do recover\n` +
      `  this gate's own code: \`| tail\` reads to EOF and forwards it, while \`| head -N\` closes the\n` +
      `  read end early — the gate takes EPIPE, its verdict text is TRUNCATED, and a producer that\n` +
      `  dies on SIGPIPE reports 141 rather than what it meant to say.)`,
  );
  process.exit(1);
}

/**
 * The refusal for an empty population (#10907) — reached before a single CLI is
 * spawned and before `--update` can write, which is the point on both counts.
 *
 * `--update` is the sharper of the two: it runs BEFORE any comparison, so over an
 * empty population it would write `{}` and ratchet all twelve baselined configs
 * out of existence — real, frozen debt discarded by a command whose whole purpose
 * is to record it. Same invariant the two reports above state, and for the same
 * reason: nothing measured, nothing written.
 *
 * Exits 1, the code every other verdict here uses.
 *
 * @param {{ headline: string, detail: string[] }} verdict
 */
function reportEmptyPopulation(verdict) {
  console.error(
    `\ncheck-i18n-coverage: POPULATION EMPTY — ${verdict.headline}\n\n` +
      verdict.detail.map((l) => (l ? `  ${l}` : '')).join('\n') +
      `\n\n  Fix:  run this gate from a complete checkout of the repo. \`pnpm check:i18n-coverage\`\n` +
      `        is the invocation CI uses, and pnpm runs it from the repo root.\n\n` +
      `  Nothing was measured: no config was linted and no count was compared, so this\n` +
      `  result says NOTHING about whether any declared label went untranslated — and\n` +
      `  the baseline was left exactly as committed (\`--update\` included).\n` +
      `  (Exit code 1 — capture it BEFORE any pipe:\n` +
      `  \`pnpm check:i18n-coverage > /tmp/i18n-coverage.log 2>&1; echo "EXIT=$?"\`.\n` +
      `  Piped, \`$?\` is the LAST command's status, and \`head\`/\`tail\` essentially never fail — that\n` +
      `  is the false green, and no pipe shape repairs it. \`\${PIPESTATUS[0]}\`/\`pipefail\` do recover\n` +
      `  this gate's own code: \`| tail\` reads to EOF and forwards it, while \`| head -N\` closes the\n` +
      `  read end early — the gate takes EPIPE, its verdict text is TRUNCATED, and a producer that\n` +
      `  dies on SIGPIPE reports 141 rather than what it meant to say.)`,
  );
  process.exit(1);
}

/**
 * Answered once, before the per-config loop — so a missing build costs one
 * verdict instead of an exception thrown from inside the first example, and
 * costs zero CLI spawns.
 *
 * Probes the exact command FILE the loop needs, not merely `dist/`: an
 * interrupted or partial build leaves the directory behind, and a `dist/` that
 * exists without `commands/lint.js` reproduces the very stack trace this check
 * exists to prevent.
 *
 * When the CLI's package.json shape moves out from under the derivation, this
 * says so on stderr and defers to the in-loop signature net rather than failing:
 * a probe that cannot read the declaration must not turn a correctly-built
 * workspace red. It stays audible either way — the net is the enforcement, this
 * is only the cheap early answer.
 */
function checkCliBuildPrerequisite() {
  const resolved = resolveCliCommandFile(LINT_COMMAND_ID);
  if (resolved.unknown) {
    console.error(`check-i18n-coverage: ${resolved.unknown} — build prerequisite not pre-checked`);
    return;
  }
  // `resolved.file` is repo-relative (`packages/cli/dist/commands/lint.js`), so it
  // needs the same anchoring as everything else — unanchored, an off-root run that
  // got this far would report "the workspace CLI is not built" about a CLI that is
  // built, which is the #5862 defect (a confident diagnosis pointing somewhere
  // innocent) rebuilt one layer down.
  if (existsSync(at(resolved.file))) return;
  reportPrerequisiteNotMet('the workspace CLI is not built', [
    `This gate counts what \`os lint\` reports, and it runs the BUILT CLI.`,
    `${CLI} is only a source stub that hands off to oclif, which`,
    `resolves \`os ${LINT_COMMAND_ID.join(' ')}\` from the compiled output — and that command`,
    `is not there:`,
    ``,
    `  ${resolved.file}`,
  ]);
}

checkCliBuildPrerequisite();

const configPaths = [...discoverExamples(), ...discoverPackages()];
// Before a single CLI is spawned, and before `--update` can write: a round with no
// population has no verdict to give and no baseline to rewrite (#10907).
const emptyPopulation = emptyPopulationVerdict(configPaths);
if (emptyPopulation) reportEmptyPopulation(emptyPopulation);

const { current, failures: unmeasured } = measureAllConfigs(configPaths, measureI18nIssues);
// Before `--update` writes anything, and before any comparison: a round that could
// not measure every config has no verdict to give and no baseline to rewrite.
if (unmeasured.length) reportUnmeasuredConfigs(unmeasured, Object.keys(current).length);

if (update) {
  writeFileSync(at(BASELINE_PATH), JSON.stringify(current, null, 2) + '\n');
  console.log(`i18n coverage baseline updated: ${Object.keys(current).length} config(s).`);
  process.exit(0);
}

const baseline = existsSync(at(BASELINE_PATH)) ? JSON.parse(readFileSync(at(BASELINE_PATH), 'utf8')) : {};

const errors = [];
for (const [file, count] of Object.entries(current)) {
  const allowed = baseline[file];
  if (allowed === undefined) {
    errors.push(
      `${file}: not baselined (${count} untranslated declared string(s)). ` +
        `Translate them, or run \`node scripts/check-i18n-coverage.mjs --update\` to freeze the debt.`,
    );
  } else if (count > allowed) {
    errors.push(
      `${file}: untranslated declared strings grew ${allowed} → ${count}. ` +
        `Something declared a label without translating it for a locale this example claims to support ` +
        `(see \`i18n.supportedLocales\`). Run \`node scripts/check-i18n-bundles.mjs --write\` to scaffold the new keys, then translate them; \`os lint ${file}\` lists them.`,
    );
  }
}
for (const [file, allowed] of Object.entries(baseline)) {
  const now = current[file];
  if (now === undefined) {
    errors.push(
      `${file}: baselined config is gone (was ${allowed}) — ratchet DOWN: ` +
        `run \`node scripts/check-i18n-coverage.mjs --update\` and commit the baseline.`,
    );
  } else if (now < allowed) {
    errors.push(
      `${file}: untranslated declared strings improved ${allowed} → ${now} — ratchet DOWN: ` +
        `run \`node scripts/check-i18n-coverage.mjs --update\` and commit the baseline.`,
    );
  }
}

if (errors.length) {
  console.error(`check-i18n-coverage: ${errors.length} problem(s)\n`);
  for (const e of errors) console.error('  • ' + e);
  process.exit(1);
}
const total = Object.values(current).reduce((a, b) => a + b, 0);
console.log(
  `check-i18n-coverage: OK (${Object.keys(current).length} config(s), ${total} baselined untranslated string(s), none new).`,
);
