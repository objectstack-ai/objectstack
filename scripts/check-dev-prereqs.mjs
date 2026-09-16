#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Note on gate derivation (#10542), because this file looks like it needs a
// population declaration and does not. It enumerates the workspace at runtime
// out of pnpm-workspace.yaml, which is the shape that card is about — but two
// facts make a declaration the wrong move here, and both were read off the
// source rather than assumed:
//
//   - lint.yml runs `--self-test` ONLY, and says so in the step name. The
//     EXISTENCE and FRESHNESS scans below are for `pnpm dev`, a local preflight
//     no pull request schedules. A workspace-wide declaration would name this
//     gate for every packages/ card in the tree for a scan CI never runs.
//   - the one hint this file does contribute is honest and load-bearing: the
//     FRESHNESS half really does read the spec package's dist, so a card there
//     names this gate for a read it genuinely performs. It scores `silent` for
//     cards elsewhere, and that is the correct verdict rather than a blind spot.
//
// So there is nothing to declare and no marker to carry: a `no-path-population`
// declaration would contradict the hint above, and dispatch-gates' self-test
// asserts exactly that pair cannot coexist.

/**
 * check:dev-prereqs — confirm the workspace is BUILT, and that the one artifact
 * whose staleness lies is CURRENT, before `pnpm dev` boots it.
 *
 * ONE precondition, ONE fix. That framing is the whole point of this gate: an
 * unbuilt workspace is a single unmet precondition, and booting into it reports
 * that one fact as anything but (#5726).
 *
 * What #5726 recorded, and what is left of it TODAY — measured on this branch,
 * because a gate that describes a symptom nobody sees any more is the same
 * misdirection it is trying to prevent:
 *
 *   - GONE. 12 MODULE_NOT_FOUND segments for commands nobody ran (oclif's
 *     findCommand import()s every command module on every CLI invocation, so one
 *     broken import chain warned for all 6 commands sharing it, twice, because
 *     `dev` forks a child). PR #5789 made that import lazy; removing a driver's
 *     dist and booting now prints ZERO such segments (verified, not assumed).
 *   - STILL LIVE. The only actionable line suggests two fixes that are both
 *     WRONG for this cause: "Fix the datasource configuration, or set
 *     OS_ALLOW_DRIVER_CONNECT_FAILURE=1 to boot anyway" — the config is fine,
 *     and the flag merely boots a half-built workspace that serves errors.
 *     A separate services-lane issue off #5726 teaches that message to
 *     recognise the unbuilt cause; this gate stops `dev` before it is reached.
 *   - ADDRESSED HERE SINCE #5864. Hand-building the failing package prints 20+ TS
 *     errors that read exactly like real contract drift and are pure artefact of
 *     a stale `packages/spec/dist` (#5726 keeps that transcript as a vaccine).
 *     That is the FRESHNESS half below.
 *
 * A 30-second build was packaged as an investigation. `dev` is the first local
 * entry point, so the cheapest place to answer it is here, before boot.
 *
 * ── WHAT IT CHECKS (1/2): EXISTENCE, for every workspace package ─────────────
 *   (criterion: declared = enforced)
 *   Every workspace package whose resolved entry point — `exports["."]`, else
 *   `main` — points INTO `dist/` must have that file on disk. A package that
 *   declares `dist/index.js` and has no `dist/index.js` is unbuilt by its own
 *   declaration, and `pnpm build` is exactly the fix. No hand-maintained list
 *   of "important" packages: membership comes from pnpm-workspace.yaml, so a
 *   package added tomorrow is covered tomorrow (same reason check:i18n derives
 *   its coverage from a walk instead of a manifest).
 *
 *   The criterion is calibrated on #5726's real blast radius: `packages/cli`'s
 *   dist (the oclif command table the `objectstack` bin loads), the driver dists
 *   under `packages/drivers/*` (the actual missing artifact there), and
 *   `packages/spec/dist` (the fake-drift amplifier). All three declare dist
 *   entry points, so all three are covered by the one rule.
 *
 *   Reading membership out of pnpm-workspace.yaml rather than hardcoding those
 *   paths is load-bearing, not tidiness: `packages/drivers/*` is a workspace glob
 *   whose contents differ across branches, so a hand-written driver path would
 *   have silently stopped covering the one package #5726 was actually about.
 *
 * ── WHAT IT CHECKS (2/2): FRESHNESS, for the declared AMPLIFIERS ─────────────
 *   (criterion: build-time content stamp, never mtime — #5864)
 *   Existence answers "was this ever built". It does not answer "was it built
 *   from the sources on disk now", and those are different failures: a MISSING
 *   dist fails loudly, a STALE one LIES. #5726's 20+ convincing type errors were
 *   all the second kind — `isAppResolvedDefaultToken` was exported from `src/`
 *   the whole time and merely absent from a stale `packages/spec/dist`.
 *
 *   THE DEFINITION, so a gate can decide it:
 *     stale(pkg)  ⇔  sha256(build inputs of pkg, now) ≠ contents of
 *                    <pkg>/dist/.build-input-hash
 *   The stamp is written by the package's OWN build script, as its last step
 *   (`node ../../scripts/check-dev-prereqs.mjs --stamp`), so the fact "this dist
 *   was produced from these bytes" is authored where it is true and read here.
 *   `scripts/check-console-sha.mjs` is the same shape one artifact along
 *   (`packages/console/dist/.objectui-sha` against the committed `.objectui-sha`).
 *
 *   THE INPUT SET, and why each part is in it:
 *     - every file under `<pkg>/src/` — what the build compiles;
 *     - every file under `<pkg>/scripts/` when it has any (#16175) — the
 *       package's own generators. `packages/spec`'s build opens with
 *       `gen:schema && gen:openapi`, both of them scripts there, so an edited
 *       generator that left this digest unmoved let a stamp written by the OLD
 *       one vouch for output the new one emits differently;
 *     - `<pkg>/package.json` — entry points, exports map, build script itself;
 *     - `<pkg>/tsconfig.json`, `<pkg>/tsup.config.ts` when present — how it compiles;
 *     - turbo.json's own `globalDependencies` — READ from turbo.json, not copied
 *       here, so the build's declaration of what is a global build input is also
 *       this gate's, and the two cannot drift apart silently.
 *   Absent files are hashed as absent, so *creating* a tsconfig is a change too.
 *
 *   WHY CONTENT AND NOT mtime. PR #5863 rejected mtime and #5864 recorded why:
 *   a checkout rewrites source mtimes, so `src newer than dist` fires for reasons
 *   that have nothing to do with the build, and a gate that false-reds on day one
 *   is disabled by the first person it inconveniences. A content hash is immune
 *   to all of it — `git worktree add`, `git checkout`, restored backups, clock
 *   skew, NFS timestamps, `touch` — because none of them change file bytes.
 *
 *   WHAT THIS DEFINITION GETS WRONG. Stated in both directions, because an
 *   unstated failure mode is how a gate loses its readers:
 *
 *   FALSE GREEN — says fresh, is not:
 *     - DEPENDENCY DRIFT. `pnpm-lock.yaml` is deliberately NOT an input. A
 *       lockfile moves on most merges, and hashing it would demand a full
 *       rebuild of the amplifier every time — the routine false red this design
 *       exists to avoid — while the failure it would catch (a dependency's types
 *       changing under a dist that is otherwise current) is not the #5726 shape.
 *       `pnpm install --frozen-lockfile && pnpm build` (AGENTS.md §9) stays the
 *       remedy for that one.
 *     - TOOLCHAIN DRIFT. A dist emitted by an older tsup/tsc from byte-identical
 *       sources reads fresh. Same argument: node_modules is not hashable at this
 *       price, and the lie it produces is not the one #5726 documented.
 *     - `OS_SKIP_DTS=1`. That build emits JS and leaves whatever `.d.ts` was
 *       there before, then stamps. The JS is genuinely fresh and the stamp says
 *       so; the declarations may not be. This gate has never probed `.d.ts`
 *       (dev boot needs JS), and AGENTS.md §9 already names the flag as the one
 *       that cannot serve `gen:api-surface`. Recorded, not silently inherited.
 *       STILL TRUE OF THIS GATE, and it stays that way: `pnpm dev` boots JS, so
 *       narrowing THIS verdict on account of the declarations would be a false
 *       red on the documented fast local build. What changed is that the hole is
 *       no longer unattended — `--stamp` now writes a SECOND file next door,
 *       `dist/.build-input-hash-dts`, which it skips under this flag exactly so
 *       that a `.d.ts` reader can tell the two builds apart. Nothing here reads
 *       it; see DTS_STAMP_BASENAME and `declarationStampState` below.
 *       ⚠ That conditionality is on the FLAG, not on the EMIT — measured: a run
 *       that emitted nothing at all, with the flag unset, refreshes BOTH files.
 *       The entry below is the one that answers that shape.
 *     - A RUN THAT EMITTED NOTHING. NARROWED, and the residue is stated rather
 *       than inherited (#16529). `--stamp` is an ASSERTION about the tree, not
 *       an OBSERVATION of the build, and its preconditions were "this package is
 *       an amplifier" and "a `dist/` DIRECTORY exists". Measured on the real
 *       tree: `--stamp` into an EMPTY `dist/` exited 0 and wrote both stamps,
 *       which then read `match` over a dist holding nothing at all. It now also
 *       requires the entry point the package's own manifest declares — the same
 *       criterion the EXISTENCE half applies to all 68 packages — and the
 *       coverage check below requires the invocation to be the build script's
 *       LAST step, reached through `&&`, so every SCRIPTED path to a stamp runs
 *       after a step that emitted and succeeded.
 *       WHAT REMAINS, deliberately: a HAND-RUN `--stamp` against an
 *       already-built dist whose sources have since moved still writes a stamp
 *       that reads fresh. That is not observable from the artifact side — the
 *       bytes it would inspect are real, merely old — so it is the same class as
 *       the hand-edited dist below rather than a build shape. ⛔ Nor is it
 *       closed by "refuse when the output bytes did not change": an idempotent
 *       rebuild legitimately emits byte-identical output, so that rule would red
 *       the very build this gate exists to ask for.
 *     - A HAND-EDITED dist. The hash covers inputs, not outputs. Nothing here
 *       can see someone editing `dist/index.mjs` directly, and nothing should
 *       have to.
 *     - A TURBO CACHE HIT is NONE of the above, measured rather than assumed:
 *       the build script does not run, so `--stamp` does not run either, and
 *       `dist/**` — the stamp included, which is why it lives there — is
 *       restored as one set, so the pair stays consistent. ⚠ The replayed log
 *       still PRINTS the `✓ …/.build-input-hash ← …` line from the cached run,
 *       so a build log is never evidence that a stamp was written.
 *
 *   FALSE RED — says stale, is fine:
 *     - A COMMENT-ONLY or formatting-only edit under `src/` changes the hash
 *       while the emitted JS is identical. Accepted: the remedy is the build the
 *       developer owes anyway, it is seconds, and the alternative (comparing
 *       emitted output) makes the gate cost more than the build it guards.
 *     - EDITING THE AMPLIFIER, THEN RUNNING `pnpm dev`. The gate reds. This is
 *       the case worth being sure about, and it is not a false red at all: dev
 *       boots the workspace from `dist`, so an edited-but-unbuilt `packages/spec`
 *       genuinely serves the old contract. Rebuild, or run the example directly
 *       (`pnpm --filter @objectstack/example-showcase dev`) to bypass on purpose.
 *
 *   AN UNSTAMPED dist IS RED, NOT A WARNING — the one place this departs from
 *   check-console-sha, deliberately:
 *     check-console-sha warns on an unstamped console dist because its subject is
 *     OPTIONAL (the CLI degrades without it) and its rebuild is a slow, separate
 *     `pnpm objectui:build`. Neither is true here: an amplifier's dist is
 *     mandatory for booting at all (its ABSENCE is already a red), and the fix is
 *     the `pnpm build` a developer is one command away from. Degrading to a
 *     warning would also exempt exactly the tree that produced #5726 — a dist
 *     built by a build that predates this stamp — which is the whole subject.
 *     Absence of the freshness input is not licence to exit 0 (#4690).
 *     This costs one red per already-built worktree on the day it lands, and not
 *     even that in practice: this commit changes `packages/spec/package.json`,
 *     which is both a turbo build input and a hash input, so the amplifier had to
 *     be rebuilt anyway.
 *
 *   WHY A DECLARED LIST INSTEAD OF EVERY PACKAGE. Measured on this repo: hashing
 *   `packages/spec/src` costs ~30ms (687 files, 9.7MB); hashing every package's
 *   sources costs ~125ms. Cost is therefore NOT the reason. The reason is the
 *   stamping side: freshness can only be asserted for a package whose build
 *   writes the stamp, and rolling that line into 60+ build scripts is a change to
 *   how every package builds, for packages whose stale dist fails loudly instead
 *   of lying. AGENTS.md §9's stale-artefact table names exactly one dist that
 *   presents as *other people's* contract drift, and it is `packages/spec`.
 *   Adding the next amplifier is two lines: its path in AMPLIFIERS, and `--stamp`
 *   at the end of its build script — and NEITHER half can be forgotten, because
 *   a listed package whose build script does not stamp fails this gate as a
 *   coverage error, and `--stamp` from an unlisted package exits 1.
 *   ⚠ "At the end" is now MECHANICAL and not a convention (#16529). The
 *   coverage error used to be `buildScript.includes(STAMP_INVOCATION)` while its
 *   own text said "no longer ends with" — so `tsup ; node …--stamp` (stamps
 *   after a FAILED tsup), `tsup || node …--stamp` (stamps only when tsup failed)
 *   and `node …--stamp && tsup` (stamps before anything is emitted) all passed.
 *   That laxity is exactly what scaling this list multiplies, which is why it is
 *   closed BEFORE the list grows: see `stampStepOrderProblem`.
 *
 * ── WHAT IT DELIBERATELY DOES NOT CHECK ─────────────────────────────────────
 *   - Freshness of the other ~60 packages. Existence only, as before; the pass
 *     line says so in those words, and AGENTS.md §9 remains the standing remedy.
 *   - Type declarations. Only the JS entry is probed, never `.d.ts`, so a fast
 *     `OS_SKIP_DTS=1` build stays green — dev boot needs JS, not declarations.
 *   - packages/console/dist. It is built by scripts/build-console.sh, NOT by
 *     `turbo run build`, so demanding it here would print a red whose fix
 *     (`pnpm build`) does not work. It is excluded structurally rather than by
 *     name: @objectstack/console declares no entry point under dist/ at all,
 *     and its freshness already has a gate on this same dev path
 *     (check:console-sha, whose fix line is `pnpm objectui:build`).
 *     Same structural exclusion covers @objectstack/docs (no entry point, and
 *     `pnpm build` filters it out) and the examples (their entry is a .ts
 *     source file, not a build artifact).
 *
 * WHERE THE SCAN RUNS. The scan is wired into the root `dev` / `dev:*` scripts
 * only — never into a workflow, and it must stay that way. CI builds before it
 * runs anything that could trip this, so in a job that just built the scan is a
 * tautological green, and in a job that has not built it is a hard false red
 * about a precondition CI does not have; #5726 and #5217 are both
 * local/worktree-only shapes.
 *
 * WHERE THE SELF-TEST RUNS — since #8170, a different answer to a different
 * question. `--self-test` is hermetic (synthetic workspaces in a temp dir, no
 * network, no git, no node_modules), so lint.yml runs THAT half, on its own, by
 * invoking this file with `node`. The `check:dev-prereqs` npm script keeps the
 * conventional self-test-then-scan shape and is still for humans only: running
 * it in CI would drag the scan half back in, which is the whole thing being
 * avoided. The split is deliberate on both sides — see the step's comment.
 *
 * No env escape hatch, deliberately (check:console-sha has none either). To
 * boot a deliberately half-built workspace, call the underlying command
 * directly: `pnpm --filter @objectstack/example-showcase dev`.
 *
 * Usage:
 *   node scripts/check-dev-prereqs.mjs             # gate the workspace
 *   node scripts/check-dev-prereqs.mjs --self-test # prove it can go both ways
 *   node scripts/check-dev-prereqs.mjs --stamp     # write dist/.build-input-hash
 *                                                  # for the package in cwd —
 *                                                  # the LAST '&&' step of its
 *                                                  # own build, never by hand
 *   pnpm check:dev-prereqs                         # self-test, then gate
 *
 * WHY THE `dev` CHAIN CALLS THIS WITH `node` AND NOT `pnpm check:dev-prereqs`
 *   A pnpm script hop costs ~0.7s before any of our code runs (measured on this
 *   repo: `pnpm check:console-sha` 0.74s total for ~0.04s of work). A guard whose
 *   entire value is being cheap should not spend that on the hot path, so the
 *   `dev` / `dev:*` chains invoke this file directly (~0.06s existence, plus
 *   ~0.03s for the one amplifier's hash, no self-test) while
 *   `pnpm check:dev-prereqs` keeps the conventional self-test-then-run shape for
 *   humans and for any future non-dev caller. The existing `pnpm check:console-sha`
 *   link keeps its form — it is not this change's business.
 *
 * WHY IT RUNS BEFORE check:console-sha, NOT AFTER
 *   In an unbuilt worktree check:console-sha exits 0 with
 *   "ℹ No console dist … Build it with: pnpm objectui:build" — correct for its own
 *   subject, and a *competing wrong fix* for this cause: `objectui:build` will not
 *   make the workspace bootable. Running this gate first means the developer reads
 *   one precondition with one fix and stops, which is the entire lesson of #5726.
 *
 * Exit codes:
 *   0  built, and every amplifier's dist matches its sources (or nothing declares
 *      a dist entry point — nothing to verify)
 *   1  not built; or an amplifier's dist is stale/unstamped; or the workspace
 *      layout, an amplifier or its build inputs could not be read (a gate that
 *      cannot enumerate members must fail loudly, not pass vacuously — #4690);
 *      or, under `--stamp`, this package is not a declared amplifier, has no
 *      `dist/`, or has a `dist/` without the artifact its manifest declares —
 *      a build that emitted nothing does not get to record that it did
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'url';
import {
  CoverageError,
  DTS_STAMP_BASENAME,
  STAMP_BASENAME,
  buildInputHash,
  inspectDeclarationStamp,
  posixRel,
  rel,
} from './build-input-hash.mjs';
import {
  WorkspaceEnumerationError,
  selfTest as workspaceEnumeratorSelfTest,
  workspaceEnumeratorFloorFailures,
  workspaceMemberDirs,
} from './workspace-enumerator.mjs';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures.length === 0` used to be this self-test's ONLY success condition, so
// "every case held" and "the cases never ran" printed the same line. Closed the
// way PR #13487 validated on check-doc-authoring: what is pinned is the
// registered NAMES, not a number. Every section opens with `battery('<name>')`,
// every assertion is attributed to the battery most recently opened, and the
// floor requires the OPENED set to equal the DECLARED set with each battery at
// or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The counts are a FLOOR, not an equality — adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  '1. Built workspace → green, and the count reflects what was inspected.': 3,
  '2. Unbuilt package → red, named, with the plain build fix.': 10,
  '3. Dependencies absent → the one-line fix has to install first.': 1,
  '4. Exclusions: a package is only judged on an entry point under dist/.': 2,
  '5. Nested and literal member patterns both expand.': 2,
  '6. A member pattern this gate cannot expand must fail loudly, never': 1,
  '7. No pnpm-workspace.yaml at all → same loud failure.': 1,
  '8. Stamped by its own build → fresh, and the pass line says what it now': 6,
  '9. THE POINT OF THE WHOLE CHANGE: a source edit after the build is stale,': 6,
  '10. mtime is NOT the criterion — the whole reason PR #5863 refused to do': 1,
  '11. Absence of the freshness input is red, not a shrug (#4690): a dist': 4,
  '12. A stamp that is not a sha256 (truncated, hand-written, half-flushed)': 1,
  '13. Declared = enforced, in BOTH directions. An amplifier whose build': 2,
  '14. Every other way the freshness half can lose its subject is red too.': 4,
  '15. The hash reads the inputs it claims to. A global build input (from': 3,
  '16. Existence outranks freshness: a workspace that is not built reports': 4,
  '17. The DECLARATIONS stamp (#14985), whose only job is to be written by a': 9,
  '18. --stamp vouches for an ARTIFACT, not for a directory (#16529). The': 8,
  "19. The ORDER the stamp's soundness rests on is now mechanical (#16529).": 8,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 19;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Packages whose dist is checked for FRESHNESS and not merely existence, as
 * workspace-relative POSIX paths. See the header for the admission criterion
 * ("a stale dist that presents as somebody else's contract drift") and for why
 * this is a declared list rather than every package.
 *
 * Every entry MUST end its `build` script with STAMP_INVOCATION; a listed
 * package that does not is a coverage error, not a silent pass.
 */
const AMPLIFIERS = ['packages/spec'];

/** What an amplifier's build script must END WITH for its stamp to be maintained. */
const STAMP_INVOCATION = 'check-dev-prereqs.mjs --stamp';

/**
 * Is `--stamp` reachable ONLY from a build that got all the way to the end?
 *
 * This predicate mechanises a sentence the whole scheme rests on, written in
 * `inspectBuildStamp`'s docblock in scripts/build-input-hash.mjs:
 *
 *   "What makes the vouching sound is the build script's ORDER, not the flag:
 *    `packages/spec`'s `build` runs the unconditional `tsup` (the JS pass)
 *    before `--stamp` in the same `&&` chain, so this file is never written by
 *    a run that did not emit bundles."
 *
 * That sentence was true of the one amplifier's spelling and enforced by
 * NOTHING: the coverage check below was `buildScript.includes(...)`, a substring
 * test that three lying spellings satisfy —
 *
 *   `tsup ; node …--stamp`   stamps after a tsup that FAILED;
 *   `tsup || node …--stamp`  stamps ONLY when tsup failed;
 *   `node …--stamp && tsup`  stamps BEFORE anything is emitted.
 *
 * Its own failure text already claimed "no longer ends with", so this is the
 * declared-equals-enforced repair of a message that promised more than the code
 * checked. It is also what makes GROWING `AMPLIFIERS` safe: every new entry is
 * another hand-written build script that has to be spelled in the one order that
 * makes its stamp true, and a convention does not survive being copied 60 times.
 *
 * Returns `null` when the spelling is sound, else the reason it is not.
 */
function stampStepOrderProblem(buildScript) {
  const script = buildScript.trimEnd().replace(/;+$/, '').trimEnd();
  if (!script.endsWith(STAMP_INVOCATION)) {
    return script.includes(STAMP_INVOCATION)
      ? `'${STAMP_INVOCATION}' is not its LAST step — a stamp written mid-chain vouches for output the steps after it have not emitted yet`
      : `'${STAMP_INVOCATION}' does not appear in it at all`;
  }
  // The separator that introduces the stamp step, read off the text before it.
  const head = script.slice(0, script.length - STAMP_INVOCATION.length);
  let separator = null;
  for (const m of head.matchAll(/\|\||&&|;|\|/g)) separator = m[0];
  if (separator === null) return `nothing runs before it — a build whose only step is the stamp has emitted nothing to vouch for`;
  if (separator !== '&&') return `the step before it is joined by '${separator}', not '&&' — so the stamp is written even when that step failed`;
  return null;
}

/**
 * Workspace member directories, from pnpm-workspace.yaml — the workspace's own
 * declaration of what it contains.
 *
 * The parse and the glob expansion come from
 * `scripts/workspace-enumerator.mjs` (#11510), this repo's one reading of that
 * file. Its refusals are the ones this gate already made — a pattern richer
 * than `<dir>` or `<dir>/*` throws rather than quietly covering fewer packages,
 * which is what would make this gate pass vacuously — and they are re-thrown as
 * `CoverageError` so this file's own failure vocabulary is unchanged.
 *
 * Importing it does not give this gate a path population: the enumerator
 * declares none, deliberately, so the reasoning in this file's header (CI runs
 * `--self-test` only, so a workspace-wide declaration here would name this gate
 * for every packages/ card in the tree) still holds exactly as written.
 */
function workspaceDirs(root) {
  try {
    return workspaceMemberDirs(root).map((dir) => path.join(root, dir));
  } catch (err) {
    if (err instanceof WorkspaceEnumerationError) throw new CoverageError(err.message);
    throw err;
  }
}

/** The entry point Node resolves for `import '<pkg>'`: exports["."], else main. */
function declaredEntry(pkg) {
  const dot = pkg.exports && typeof pkg.exports === 'object' ? pkg.exports['.'] : pkg.exports;
  const candidates = [];
  if (typeof dot === 'string') candidates.push(dot);
  else if (dot && typeof dot === 'object') candidates.push(dot.import, dot.default, dot.require);
  candidates.push(pkg.main);
  for (const c of candidates) {
    if (typeof c === 'string' && c) return c;
  }
  return '';
}

const isBuildArtifact = (entry) => /(^|\/)dist\//.test(entry.replace(/^\.\//, ''));
/**
 * The freshness verdict for the declared amplifiers. Every way of NOT being able
 * to answer throws (#4690): a listed package that is not a workspace member, has
 * no manifest, has no `src/`, or whose build script no longer stamps, is a
 * coverage error — never a quiet "nothing to check".
 */
function inspectFreshness(root, amplifiers, memberDirs) {
  const results = [];
  for (const relDir of amplifiers) {
    const dir = path.join(root, relDir);
    if (!memberDirs.has(path.resolve(dir))) {
      throw new CoverageError(
        `${relDir} is declared an amplifier in scripts/check-dev-prereqs.mjs but is not a workspace member.\n` +
          `  Either it moved (update AMPLIFIERS) or the workspace list did — a freshness check with no\n` +
          `  subject would pass forever without checking anything.`,
      );
    }
    const manifest = path.join(dir, 'package.json');
    if (!existsSync(manifest)) throw new CoverageError(`${relDir}/package.json is missing — cannot judge the freshness of its dist.`);
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(manifest, 'utf-8'));
    } catch (err) {
      throw new CoverageError(`${relDir}/package.json is not readable as JSON (${err.message}) — cannot judge the freshness of its dist.`);
    }
    const buildScript = typeof pkg.scripts?.build === 'string' ? pkg.scripts.build : '';
    const orderProblem = stampStepOrderProblem(buildScript);
    if (orderProblem !== null) {
      throw new CoverageError(
        `${relDir} is a declared amplifier but its build script does not end with '${STAMP_INVOCATION}':\n` +
          `  ${orderProblem}.\n` +
          `  ${relDir}/dist/${STAMP_BASENAME} is only evidence because the steps that EMIT the dist run\n` +
          `  before it in the same '&&' chain — a stamp reached any other way vouches for a dist this\n` +
          `  build did not produce, and this check would then pass on any dist, however old.\n` +
          `  Restore the stamp as the last '&&'-joined step, or drop ${relDir} from AMPLIFIERS on purpose.`,
      );
    }

    const expected = buildInputHash(root, dir);
    const stampFile = path.join(dir, 'dist', STAMP_BASENAME);
    const common = { name: pkg.name || relDir, dir: relDir, stamp: posixRel(root, stampFile), expected };
    if (!existsSync(stampFile)) {
      results.push({ ...common, state: 'unstamped', stamped: '' });
      continue;
    }
    const stamped = readFileSync(stampFile, 'utf-8').trim();
    if (!/^[0-9a-f]{64}$/.test(stamped)) {
      results.push({ ...common, state: 'unstamped', stamped: '' });
      continue;
    }
    results.push({ ...common, state: stamped === expected ? 'fresh' : 'stale', stamped });
  }
  return results;
}

/**
 * The verdict, as data: which declared build artifacts are absent, which
 * amplifiers no longer match their sources, and which single command fixes it.
 * Split from the printing so --self-test can drive it.
 */
function inspect(root, amplifiers = AMPLIFIERS) {
  const missing = [];
  const memberDirs = new Set();
  let checked = 0;

  for (const dir of workspaceDirs(root)) {
    memberDirs.add(path.resolve(dir));
    const manifest = path.join(dir, 'package.json');
    if (!existsSync(manifest)) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(manifest, 'utf-8'));
    } catch {
      continue; // unparseable manifest is another gate's business
    }
    if (!pkg.name) continue;

    const entry = declaredEntry(pkg);
    if (!entry || !isBuildArtifact(entry)) continue; // not built by `pnpm build` — see header

    checked++;
    const target = path.join(dir, entry.replace(/^\.\//, ''));
    if (!existsSync(target)) missing.push({ name: pkg.name, artifact: rel(root, target) });
  }

  // Freshness is only meaningful once existence holds: with no dist there is no
  // stamp either, and reporting both would break the one-precondition-one-fix
  // shape that is this gate's entire reason for existing.
  const freshness = missing.length === 0 ? inspectFreshness(root, amplifiers, memberDirs) : [];

  // A workspace with no dependencies installed cannot run `pnpm build` at all
  // (turbo is not there), so the one-line fix has to include the install.
  const installed = existsSync(path.join(root, 'node_modules'));
  return { checked, missing, freshness, fix: installed ? 'pnpm build' : 'pnpm install && pnpm build' };
}

function report(verdict) {
  const { checked, missing, freshness, fix } = verdict;

  if (missing.length > 0) {
    const shown = missing.slice(0, 3);
    const width = Math.max(...shown.map((m) => m.name.length));
    const list = shown.map((m) => `      ${m.name.padEnd(width)}  ${m.artifact}`).join('\n');
    const more = missing.length > shown.length ? `\n      … and ${missing.length - shown.length} more` : '';

    console.error(
      `\n✗ The workspace is not built — 1 unmet precondition, not a list of problems.\n\n` +
        `    ${missing.length} of ${checked} workspace packages declare an entry point under dist/ that is not on disk:\n\n` +
        `${list}${more}\n\n` +
        `  Booting anyway never names this. Where that led once it was chased\n` +
        `  (objectstack-ai/objectstack#5726): a 'datasource: connect failed' whose two\n` +
        `  suggested fixes are both wrong for this cause — neither editing the datasource\n` +
        `  config nor OS_ALLOW_DRIVER_CONNECT_FAILURE=1 builds a missing artifact — and then\n` +
        `  20+ TS errors from hand-building the package, reading exactly like real contract\n` +
        `  drift while being nothing but a stale dist.\n\n` +
        `  Fix:\n\n` +
        `      ${fix}\n`,
    );
    return 1;
  }

  const notFresh = freshness.filter((f) => f.state !== 'fresh');
  if (notFresh.length > 0) {
    const stale = notFresh.filter((f) => f.state === 'stale');
    const detail = notFresh
      .map((f) =>
        f.state === 'stale'
          ? `      ${f.name}  (${f.stamp})\n` +
            `        built from sources hashing  ${f.stamped.slice(0, 16)}…\n` +
            `        the sources on disk hash    ${f.expected.slice(0, 16)}…`
          : `      ${f.name}  (${f.stamp})\n` + `        no readable build stamp — this dist predates the freshness stamp, so nothing can vouch for it.`,
      )
      .join('\n');

    console.error(
      `\n✗ ${notFresh.length === 1 ? "A built package's dist no longer matches its sources" : "Built packages' dists no longer match their sources"} — 1 unmet precondition, not a list of problems.\n\n` +
        `    All ${checked} declared build artifacts are present. ${stale.length > 0 ? 'They are not all current:' : 'Their currency cannot be established:'}\n\n` +
        `${detail}\n\n` +
        `  A stale dist does not fail — it LIES, and it lies about somebody else's code.\n` +
        `  (objectstack-ai/objectstack#5726): 20+ TS errors that read exactly like real contract\n` +
        `  drift, every one of them an artefact of a stale packages/spec/dist — the export they\n` +
        `  named was in src/ the whole time. Chasing that is how correct code gets "fixed".\n\n` +
        `  Fix:\n\n` +
        `      ${fix}\n`,
    );
    return 1;
  }

  console.log(`✓ ${checked} package build artifacts present (existence, not freshness).`);
  if (freshness.length > 0) {
    console.log(`✓ ${freshness.map((f) => f.name).join(', ')} built from the sources on disk — the only freshness claim this line makes; everything else above is existence only.`);
  }
  return 0;
}

/**
 * --stamp — record, at the END of a package's own build, the hash of the inputs
 * that build just consumed. Writing it INSIDE dist is load-bearing: `dist/**` is
 * a turbo output, so the stamp is cached, restored and cleaned together with the
 * artifact it describes. A stamp kept anywhere else would survive a cache
 * restore or a `rm -rf dist` and start lying in the other direction.
 */
function stamp(root, cwd, amplifiers = AMPLIFIERS) {
  const dir = path.resolve(cwd);
  const relDir = posixRel(root, dir);
  if (!amplifiers.includes(relDir)) {
    console.error(
      `\n✗ ${relDir} is not a declared freshness amplifier, so a stamp written here would be read by nobody.\n\n` +
        `  Add '${relDir}' to AMPLIFIERS in scripts/check-dev-prereqs.mjs, or drop the --stamp step\n` +
        `  from its build script.\n`,
    );
    return 1;
  }
  const dist = path.join(dir, 'dist');
  if (!existsSync(dist)) {
    console.error(`\n✗ ${relDir}/dist does not exist, so there is no build to stamp. --stamp runs as the LAST step of the build, not before it.\n`);
    return 1;
  }

  // "There is no build to stamp" is what the refusal above SAYS. What it used
  // to check is that a DIRECTORY exists — and an empty `dist/` satisfies that,
  // measured: `--stamp` into an empty directory exited 0 and wrote both stamps,
  // which then read FRESH to every consumer over a dist holding nothing at all.
  // So the same criterion the EXISTENCE half applies to all 68 packages is
  // applied here to the one package about to make a freshness claim: the entry
  // point this package's OWN manifest promises has to be on disk. Same shape as
  // scripts/check-dts-emitted.mjs one artifact over — a build does not get to
  // report success, or to stamp, over output it did not emit.
  //
  // ⛔ NOT an mtime comparison, and deliberately not a "did the bytes change"
  // one either: an idempotent rebuild legitimately emits byte-identical output,
  // so refusing on unchanged bytes would red the build this gate exists to ask
  // for. Presence of the declared artifact is the observation available here.
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf-8'));
  } catch (err) {
    console.error(`\n✗ ${relDir}/package.json is not readable (${err.message}), so nothing here can say which artifact a stamp would vouch for.\n`);
    return 1;
  }
  const entry = declaredEntry(pkg);
  const entryPath = entry.replace(/^\.\//, '');
  if (isBuildArtifact(entry) && !existsSync(path.join(dir, entryPath))) {
    console.error(
      `\n✗ ${relDir}/${entryPath} is not on disk, so this run emitted nothing for a stamp to vouch for.\n\n` +
        `  --stamp records "this dist was built from these sources". A dist without the entry point\n` +
        `  ${relDir}'s own manifest declares is not a build, and ${STAMP_BASENAME} written over it\n` +
        `  reads FRESH to every consumer of it.\n\n` +
        `  Fix:\n\n      pnpm --filter ${pkg.name || relDir} build\n`,
    );
    return 1;
  }

  const hash = buildInputHash(root, dir);
  writeFileSync(path.join(dist, STAMP_BASENAME), `${hash}\n`);
  console.log(`✓ ${relDir}/dist/${STAMP_BASENAME} ← ${hash.slice(0, 16)}…`);

  // The declarations half, written ONLY by a build that actually emitted them.
  // Under OS_SKIP_DTS=1 the previous file is left exactly as it was: whatever
  // `.d.ts` are on disk still came from the build that wrote it, so the old
  // digest is the true one and refreshing it here is precisely the false green
  // this stamp exists to avoid.
  if (process.env.OS_SKIP_DTS) {
    console.log(
      `ℹ ${relDir}/dist/${DTS_STAMP_BASENAME} left as-is — OS_SKIP_DTS=1 skipped the declaration pass,\n` +
        `  so this build cannot vouch for ${relDir}/dist/**/*.d.ts.`,
    );
    return 0;
  }
  writeFileSync(path.join(dist, DTS_STAMP_BASENAME), `${hash}\n`);
  console.log(`✓ ${relDir}/dist/${DTS_STAMP_BASENAME} ← ${hash.slice(0, 16)}…`);
  return 0;
}


/**
 * --self-test — a gate only ever observed green is indistinguishable from a gate
 * that matches nothing (#4690). These fixtures drive `inspect` to every verdict
 * and pin the exclusions that keep it from printing a red whose fix is wrong.
 */

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798). The self-test's own exit code stays load-bearing, so the
// handshake is a flag rather than a returned sentinel.
let selfTestReachedVerdict = false;

function selfTest() {
  // The battery ledger this self-test's floor is evaluated against (#13489).
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };

  const failures = [];
  const expect = (label, actual, wanted) => {
    registerCase();
    if (actual !== wanted) failures.push(`${label}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`);
  };

  /** Run `fn` with console output captured, so the fixtures stay quiet. */
  const capture = (fn) => {
    const chunks = [];
    const sink = (...args) => chunks.push(args.join(' '));
    const [log, error] = [console.log, console.error];
    console.log = sink;
    console.error = sink;
    try {
      return { code: fn(), text: chunks.join('\n') };
    } finally {
      console.log = log;
      console.error = error;
    }
  };

  const tmp = mkdtempSync(path.join(tmpdir(), 'check-dev-prereqs-'));
  const write = (rootDir, file, body) => {
    mkdirSync(path.join(rootDir, path.dirname(file)), { recursive: true });
    writeFileSync(path.join(rootDir, file), body);
  };
  const fixture = (name, { members = ['packages/*'], installed = false, turbo = { globalDependencies: ['tsconfig.json'] } } = {}) => {
    const rootDir = path.join(tmp, name);
    mkdirSync(rootDir, { recursive: true });
    writeFileSync(path.join(rootDir, 'pnpm-workspace.yaml'), `packages:\n${members.map((m) => `  - ${m}\n`).join('')}\nonlyBuiltDependencies:\n  - esbuild\n`);
    if (turbo) writeFileSync(path.join(rootDir, 'turbo.json'), JSON.stringify(turbo));
    if (installed) mkdirSync(path.join(rootDir, 'node_modules'), { recursive: true });
    return rootDir;
  };
  /** A workspace whose `packages/spec` is a stamped, buildable amplifier. */
  const amplifierFixture = (name, { build = `tsup && node ../../scripts/${STAMP_INVOCATION}`, src = 'export const token = 1;\n' } = {}) => {
    const rootDir = fixture(name, { members: ['packages/*'], installed: true });
    write(rootDir, 'tsconfig.json', '{ "compilerOptions": {} }');
    write(rootDir, 'packages/spec/package.json', JSON.stringify({ name: '@f/spec', main: 'dist/index.js', scripts: { build } }));
    write(rootDir, 'packages/spec/src/index.ts', src);
    write(rootDir, 'packages/spec/dist/index.js', 'module.exports = {};');
    return rootDir;
  };
  const threwCoverage = (fn) => {
    try {
      fn();
      return 'nothing';
    } catch (err) {
      return err instanceof CoverageError ? 'CoverageError' : 'other';
    }
  };
  /** The refusal's own TEXT, for cases that pin what a developer is told to fix. */
  const threwCoverageMessage = (fn) => {
    try {
      fn();
      return '(nothing was thrown)';
    } catch (err) {
      return err instanceof CoverageError ? err.message : `(not a CoverageError: ${err.message})`;
    }
  };

  try {
    // 1. Built workspace → green, and the count reflects what was inspected.
    battery('1. Built workspace → green, and the count reflects what was inspected.');
    const built = fixture('built', { installed: true });
    write(built, 'packages/a/package.json', JSON.stringify({ name: '@f/a', exports: { '.': { types: './dist/index.d.mts', default: './dist/index.mjs' } } }));
    write(built, 'packages/a/dist/index.mjs', 'export {};');
    write(built, 'packages/b/package.json', JSON.stringify({ name: '@f/b', main: 'dist/index.js' }));
    write(built, 'packages/b/dist/index.js', 'module.exports = {};');
    let v = inspect(built, []);
    expect('built/missing', v.missing.length, 0);
    expect('built/checked', v.checked, 2);
    expect('built/fix', v.fix, 'pnpm build');

    // 2. Unbuilt package → red, named, with the plain build fix.
    battery('2. Unbuilt package → red, named, with the plain build fix.');
    const unbuilt = fixture('unbuilt', { installed: true });
    write(unbuilt, 'packages/a/package.json', JSON.stringify({ name: '@f/a', exports: { '.': './dist/index.mjs' } }));
    write(unbuilt, 'packages/b/package.json', JSON.stringify({ name: '@f/b', main: 'dist/index.js' }));
    write(unbuilt, 'packages/b/dist/index.js', 'module.exports = {};');
    v = inspect(unbuilt, []);
    expect('unbuilt/missing', v.missing.length, 1);
    expect('unbuilt/name', v.missing[0]?.name, '@f/a');
    expect('unbuilt/artifact', v.missing[0]?.artifact, path.join('packages', 'a', 'dist', 'index.mjs'));
    expect('unbuilt/fix', v.fix, 'pnpm build');

    // The reported shape is the contract, not just the exit code: one verdict
    // line, the named artifact, and exactly one command to run.
    const red = capture(() => report(v));
    expect('unbuilt/exit-code', red.code, 1);
    expect('unbuilt/verdict-lines', red.text.split('\n').filter((l) => l.startsWith('✗')).length, 1);
    expect('unbuilt/names-artifact', red.text.includes(path.join('packages', 'a', 'dist', 'index.mjs')), true);
    expect('unbuilt/one-fix', (red.text.match(/pnpm build/g) || []).length, 1);
    const green = capture(() => report(inspect(built, [])));
    expect('built/exit-code', green.code, 0);
    expect('built/one-line', green.text.trim().split('\n').length, 1);

    // 3. Dependencies absent → the one-line fix has to install first.
    battery('3. Dependencies absent → the one-line fix has to install first.');
    const fresh = fixture('fresh');
    write(fresh, 'packages/a/package.json', JSON.stringify({ name: '@f/a', main: 'dist/index.js' }));
    expect('fresh/fix', inspect(fresh, []).fix, 'pnpm install && pnpm build');

    // 4. Exclusions: a package is only judged on an entry point under dist/.
    //    Pins the three shapes that must NEVER produce a red here, because
    //    `pnpm build` is not their fix: @objectstack/console (dist built by
    //    build-console.sh; declares no entry but package.json), @objectstack/docs
    //    (no entry point, filtered out of `pnpm build`), and the examples
    //    (entry is a .ts source file). See header.
    battery('4. Exclusions: a package is only judged on an entry point under dist/.');
    const excluded = fixture('excluded', { installed: true });
    write(excluded, 'packages/console/package.json', JSON.stringify({ name: '@f/console', exports: { './package.json': './package.json' }, files: ['dist'] }));
    write(excluded, 'packages/docs/package.json', JSON.stringify({ name: '@f/docs', scripts: { build: 'next build' } }));
    write(excluded, 'packages/example/package.json', JSON.stringify({ name: '@f/example', main: './objectstack.config.ts', exports: { '.': './objectstack.config.ts' } }));
    v = inspect(excluded, []);
    expect('excluded/checked', v.checked, 0);
    expect('excluded/missing', v.missing.length, 0);

    // 5. Nested and literal member patterns both expand.
    battery('5. Nested and literal member patterns both expand.');
    const nested = fixture('nested', { members: ['packages/plugins/*', 'packages/spec'], installed: true });
    write(nested, 'packages/plugins/driver-sql/package.json', JSON.stringify({ name: '@f/driver-sql', main: 'dist/index.js' }));
    write(nested, 'packages/spec/package.json', JSON.stringify({ name: '@f/spec', main: 'dist/index.js' }));
    v = inspect(nested, []);
    expect('nested/checked', v.checked, 2);
    expect('nested/missing', v.missing.length, 2);

    // 6. A member pattern this gate cannot expand must fail loudly, never
    //    silently cover fewer packages.
    battery('6. A member pattern this gate cannot expand must fail loudly, never');
    const opaque = fixture('opaque', { members: ['packages/**'], installed: true });
    expect('opaque/throws', threwCoverage(() => inspect(opaque, [])), 'CoverageError');

    // 7. No pnpm-workspace.yaml at all → same loud failure.
    battery('7. No pnpm-workspace.yaml at all → same loud failure.');
    const rootless = path.join(tmp, 'rootless');
    mkdirSync(rootless, { recursive: true });
    expect('rootless/throws', threwCoverage(() => inspect(rootless, [])), 'CoverageError');

    // ── FRESHNESS (#5864) ────────────────────────────────────────────────────

    // 8. Stamped by its own build → fresh, and the pass line says what it now
    //    vouches for AND what it still does not.
    battery('8. Stamped by its own build → fresh, and the pass line says what it now');
    const stampedRoot = amplifierFixture('stamped');
    expect('stamp/exit-code', capture(() => stamp(stampedRoot, path.join(stampedRoot, 'packages/spec'), ['packages/spec'])).code, 0);
    v = inspect(stampedRoot, ['packages/spec']);
    expect('stamped/state', v.freshness[0]?.state, 'fresh');
    const stampedGreen = capture(() => report(v));
    expect('stamped/exit-code', stampedGreen.code, 0);
    expect('stamped/claims-existence', stampedGreen.text.includes('existence, not freshness'), true);
    expect('stamped/claims-freshness', stampedGreen.text.includes('built from the sources on disk'), true);
    expect('stamped/bounds-its-claim', stampedGreen.text.includes('existence only'), true);

    // 9. THE POINT OF THE WHOLE CHANGE: a source edit after the build is stale,
    //    red, and named — with one fix, and #5726 named as the reason.
    battery('9. THE POINT OF THE WHOLE CHANGE: a source edit after the build is stale,');
    write(stampedRoot, 'packages/spec/src/index.ts', 'export const token = 2;\n');
    v = inspect(stampedRoot, ['packages/spec']);
    expect('stale/state', v.freshness[0]?.state, 'stale');
    const staleRed = capture(() => report(v));
    expect('stale/exit-code', staleRed.code, 1);
    expect('stale/verdict-lines', staleRed.text.split('\n').filter((l) => l.startsWith('✗')).length, 1);
    expect('stale/names-package', staleRed.text.includes('@f/spec'), true);
    expect('stale/one-fix', (staleRed.text.match(/pnpm build/g) || []).length, 1);
    expect('stale/says-it-lies', staleRed.text.includes('LIES'), true);

    // 10. mtime is NOT the criterion — the whole reason PR #5863 refused to do
    //     this half. A source file touched into the future with byte-identical
    //     content stays fresh; an mtime comparison would red here, and reds like
    //     that are how gates get switched off.
    battery('10. mtime is NOT the criterion — the whole reason PR #5863 refused to do');
    const untouched = amplifierFixture('untouched');
    capture(() => stamp(untouched, path.join(untouched, 'packages/spec'), ['packages/spec']));
    const touched = path.join(untouched, 'packages/spec/src/index.ts');
    const future = new Date(Date.now() + 3_600_000);
    writeFileSync(touched, readFileSync(touched)); // rewrite: new mtime, same bytes
    utimesSync(touched, future, future);
    expect('mtime/still-fresh', inspect(untouched, ['packages/spec']).freshness[0]?.state, 'fresh');

    // 11. Absence of the freshness input is red, not a shrug (#4690): a dist
    //     built before this stamp existed is exactly #5726's tree.
    battery('11. Absence of the freshness input is red, not a shrug (#4690): a dist');
    const unstamped = amplifierFixture('unstamped');
    v = inspect(unstamped, ['packages/spec']);
    expect('unstamped/state', v.freshness[0]?.state, 'unstamped');
    const unstampedRed = capture(() => report(v));
    expect('unstamped/exit-code', unstampedRed.code, 1);
    expect('unstamped/names-stamp', unstampedRed.text.includes(STAMP_BASENAME), true);
    expect('unstamped/one-fix', (unstampedRed.text.match(/pnpm build/g) || []).length, 1);

    // 12. A stamp that is not a sha256 (truncated, hand-written, half-flushed)
    //     is unverifiable, and unverifiable is red — never "close enough".
    battery('12. A stamp that is not a sha256 (truncated, hand-written, half-flushed)');
    const garbled = amplifierFixture('garbled');
    capture(() => stamp(garbled, path.join(garbled, 'packages/spec'), ['packages/spec']));
    write(garbled, 'packages/spec/dist/' + STAMP_BASENAME, 'not-a-hash\n');
    expect('garbled/state', inspect(garbled, ['packages/spec']).freshness[0]?.state, 'unstamped');

    // 13. Declared = enforced, in BOTH directions. An amplifier whose build
    //     script stopped stamping must fail loudly (otherwise this gate passes
    //     on any dist forever), and --stamp from an unlisted package must refuse
    //     (otherwise a stamp is written that nobody reads).
    battery('13. Declared = enforced, in BOTH directions. An amplifier whose build');
    const unstamping = amplifierFixture('unstamping', { build: 'tsup' });
    expect('drift/build-script-lost-stamp', threwCoverage(() => inspect(unstamping, ['packages/spec'])), 'CoverageError');
    expect('drift/stamp-refuses-unlisted', capture(() => stamp(stampedRoot, path.join(stampedRoot, 'packages/spec'), [])).code, 1);

    // 14. Every other way the freshness half can lose its subject is red too.
    battery('14. Every other way the freshness half can lose its subject is red too.');
    const noMember = amplifierFixture('no-member');
    expect('coverage/not-a-member', threwCoverage(() => inspect(noMember, ['packages/nonexistent'])), 'CoverageError');
    const noSrc = amplifierFixture('no-src');
    rmSync(path.join(noSrc, 'packages/spec/src'), { recursive: true, force: true });
    expect('coverage/no-src', threwCoverage(() => inspect(noSrc, ['packages/spec'])), 'CoverageError');
    const noTurbo = amplifierFixture('no-turbo');
    rmSync(path.join(noTurbo, 'turbo.json'), { force: true });
    expect('coverage/no-turbo-json', threwCoverage(() => inspect(noTurbo, ['packages/spec'])), 'CoverageError');
    const globbedTurbo = amplifierFixture('globbed-turbo');
    write(globbedTurbo, 'turbo.json', JSON.stringify({ globalDependencies: ['configs/**'] }));
    expect('coverage/turbo-glob', threwCoverage(() => inspect(globbedTurbo, ['packages/spec'])), 'CoverageError');

    // 15. The hash reads the inputs it claims to. A global build input (from
    //     turbo.json) and the package manifest both move it; the stamp file
    //     itself, living inside dist, does not — otherwise stamping would
    //     invalidate the stamp it just wrote.
    battery('15. The hash reads the inputs it claims to. A global build input (from');
    const inputs = amplifierFixture('inputs');
    const specDir = path.join(inputs, 'packages/spec');
    const base = buildInputHash(inputs, specDir);
    write(inputs, 'tsconfig.json', '{ "compilerOptions": { "strict": true } }');
    const afterGlobal = buildInputHash(inputs, specDir);
    expect('hash/global-input-moves-it', afterGlobal !== base, true);
    write(inputs, 'packages/spec/package.json', JSON.stringify({ name: '@f/spec', main: 'dist/index.js', version: '2.0.0', scripts: { build: `tsup && node ../../scripts/${STAMP_INVOCATION}` } }));
    expect('hash/manifest-moves-it', buildInputHash(inputs, specDir) !== afterGlobal, true);
    const beforeStamp = buildInputHash(inputs, specDir);
    capture(() => stamp(inputs, specDir, ['packages/spec']));
    expect('hash/own-stamp-does-not-move-it', buildInputHash(inputs, specDir), beforeStamp);

    // 16. Existence outranks freshness: a workspace that is not built reports
    //     ONE precondition, and it is the build — not two.
    battery('16. Existence outranks freshness: a workspace that is not built reports');
    const halfBuilt = amplifierFixture('half-built');
    capture(() => stamp(halfBuilt, path.join(halfBuilt, 'packages/spec'), ['packages/spec']));
    write(halfBuilt, 'packages/other/package.json', JSON.stringify({ name: '@f/other', main: 'dist/index.js' }));
    v = inspect(halfBuilt, ['packages/spec']);
    expect('precedence/missing', v.missing.length, 1);
    expect('precedence/freshness-not-consulted', v.freshness.length, 0);
    const halfRed = capture(() => report(v));
    expect('precedence/verdict-lines', halfRed.text.split('\n').filter((l) => l.startsWith('✗')).length, 1);
    expect('precedence/is-the-build-one', halfRed.text.includes('The workspace is not built'), true);

    // 17. The DECLARATIONS stamp (#14985), whose only job is to be written by a
    //     build that emitted `.d.ts` and NOT by one that skipped them. Nothing
    //     in this file reads it — `distIsStale` does — so its whole value is
    //     that OS_SKIP_DTS=1 leaves it alone. A stamp written unconditionally
    //     here would restore, one file over, exactly the false green the mtime
    //     rule was chosen over `.build-input-hash` to avoid.
    battery('17. The DECLARATIONS stamp (#14985), whose only job is to be written by a');
    const dts = amplifierFixture('dts');
    const dtsSpec = path.join(dts, 'packages/spec');
    capture(() => stamp(dts, dtsSpec, ['packages/spec']));
    expect('dts/full-build-stamps', inspectDeclarationStamp(dts, dtsSpec).state, 'match');
    expect('dts/reports-both-digests', inspectDeclarationStamp(dts, dtsSpec).recorded, buildInputHash(dts, dtsSpec));

    write(dts, 'packages/spec/src/index.ts', 'export const token = 3;\n');
    const moved = inspectDeclarationStamp(dts, dtsSpec);
    expect('dts/source-edit-is-mismatch', moved.state, 'mismatch');
    expect('dts/mismatch-shows-both', moved.recorded !== moved.actual && moved.actual !== null, true);

    // The whole point: re-stamping under the flag must NOT adopt the new digest.
    const previousFlag = process.env.OS_SKIP_DTS;
    try {
      process.env.OS_SKIP_DTS = '1';
      capture(() => stamp(dts, dtsSpec, ['packages/spec']));
    } finally {
      if (previousFlag === undefined) delete process.env.OS_SKIP_DTS;
      else process.env.OS_SKIP_DTS = previousFlag;
    }
    expect('dts/skip-dts-does-not-refresh', inspectDeclarationStamp(dts, dtsSpec).state, 'mismatch');
    // …while the JS half, which that build really did re-emit, is refreshed.
    expect('dts/skip-dts-still-stamps-js', inspect(dts, ['packages/spec']).freshness[0]?.state, 'fresh');

    // No evidence and unreadable evidence are the same answer, and it is never
    // an acquittal (#4690).
    const noDts = amplifierFixture('no-dts-stamp');
    const noDtsSpec = path.join(noDts, 'packages/spec');
    expect('dts/absent-is-unstamped', inspectDeclarationStamp(noDts, noDtsSpec).state, 'unstamped');
    expect('dts/absent-computes-nothing', inspectDeclarationStamp(noDts, noDtsSpec).actual, null);
    write(noDts, 'packages/spec/dist/' + DTS_STAMP_BASENAME, 'not-a-hash\n');
    expect('dts/garbled-is-unstamped', inspectDeclarationStamp(noDts, noDtsSpec).state, 'unstamped');

    // 18. --stamp vouches for an ARTIFACT, not for a directory (#16529). The
    //     refusal above it has always SAID "there is no build to stamp" while
    //     checking that `dist/` exists — and an empty directory passes that,
    //     measured on the real tree: exit 0, both stamps written, every consumer
    //     reading FRESH over a dist holding nothing. Both legs, because a red
    //     that is never seen green is a gate nobody can trust and vice versa.
    battery('18. --stamp vouches for an ARTIFACT, not for a directory (#16529). The');
    const emptyDist = amplifierFixture('empty-dist');
    const emptyDistSpec = path.join(emptyDist, 'packages/spec');
    rmSync(path.join(emptyDistSpec, 'dist/index.js'), { force: true });
    const emptyRed = capture(() => stamp(emptyDist, emptyDistSpec, ['packages/spec']));
    expect('emit/empty-dist-refuses', emptyRed.code, 1);
    expect('emit/empty-dist-names-the-artifact', emptyRed.text.includes('packages/spec/dist/index.js'), true);
    expect('emit/empty-dist-one-fix', (emptyRed.text.match(/ build\n/g) || []).length, 1);
    // The load-bearing half of the red leg: it refused BEFORE writing anything.
    // A refusal that still leaves the stamp behind is not a refusal at all.
    expect('emit/empty-dist-wrote-no-stamp', existsSync(path.join(emptyDistSpec, 'dist', STAMP_BASENAME)), false);
    expect('emit/empty-dist-wrote-no-dts-stamp', existsSync(path.join(emptyDistSpec, 'dist', DTS_STAMP_BASENAME)), false);
    // …and it is a DIFFERENT refusal from "no dist at all", which keeps its own
    // wording — one precondition, one fix, and the developer reads which.
    expect('emit/distinct-from-absent-dist', emptyRed.text.includes('does not exist, so there is no build to stamp'), false);
    // GREEN LEG: put the emitted artifact back and the same call stamps.
    write(emptyDist, 'packages/spec/dist/index.js', 'module.exports = {};');
    expect('emit/emitted-dist-stamps', capture(() => stamp(emptyDist, emptyDistSpec, ['packages/spec'])).code, 0);
    expect('emit/emitted-dist-is-fresh', inspect(emptyDist, ['packages/spec']).freshness[0]?.state, 'fresh');

    // 19. The ORDER the stamp's soundness rests on is now mechanical (#16529).
    //     `inspectBuildStamp`'s docblock says the vouching is sound because the
    //     emitting step runs before `--stamp` in the same `&&` chain. That was
    //     a property of one hand-written string, checked by `includes()`. Every
    //     spelling below satisfies a substring test and lies.
    battery('19. The ORDER the stamp\'s soundness rests on is now mechanical (#16529).');
    const ordered = (name, build) => threwCoverage(() => inspect(amplifierFixture(name, { build }), ['packages/spec']));
    expect('order/semicolon-stamps-after-failure', ordered('ord-semi', `tsup ; node ../../scripts/${STAMP_INVOCATION}`), 'CoverageError');
    expect('order/or-stamps-only-on-failure', ordered('ord-or', `tsup || node ../../scripts/${STAMP_INVOCATION}`), 'CoverageError');
    expect('order/pipe-is-not-a-chain', ordered('ord-pipe', `tsup | node ../../scripts/${STAMP_INVOCATION}`), 'CoverageError');
    expect('order/stamp-before-the-emit', ordered('ord-first', `node ../../scripts/${STAMP_INVOCATION} && tsup`), 'CoverageError');
    expect('order/stamp-is-the-whole-build', ordered('ord-only', `node ../../scripts/${STAMP_INVOCATION}`), 'CoverageError');
    // The green leg, and the reason none of the above is vacuous: the shape the
    // one real amplifier uses — a multi-step `&&` chain ending in the stamp,
    // with a shell `if … ; fi` step in the middle whose internal `;` must NOT
    // be mistaken for the separator that introduces the stamp step.
    expect(
      'order/real-shape-passes',
      stampStepOrderProblem(`pnpm gen:schema && tsup && if [ -z "$OS_SKIP_DTS" ]; then BUILD_DTS=true tsup; fi && node ../../scripts/${STAMP_INVOCATION}`),
      null,
    );
    expect('order/trailing-semicolon-is-not-a-separator', stampStepOrderProblem(`tsup && node ../../scripts/${STAMP_INVOCATION};`), null);
    // The refusal has to say which spelling it found, or the fix is a guess.
    expect('order/names-the-separator', threwCoverageMessage(() => inspect(amplifierFixture('ord-msg', { build: `tsup ; node ../../scripts/${STAMP_INVOCATION}` }), ['packages/spec'])).includes("joined by ';'"), true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // The shared workspace enumerator is a plain module with no CI invocation of
  // its own (#11510 — being a gate is exactly what it must not be); every gate
  // that consolidated onto it folds in its checks.
  failures.push(...workspaceEnumeratorSelfTest({ root: ROOT }));
  failures.push(...workspaceEnumeratorFloorFailures());

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ───
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  const floorFailure = (message) => {
    failures.push(message);
  };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the ' +
        'number. Find what stopped registering (an early return, a deleted block, a guard that now ' +
        'skips) and restore it.',
    );
  }

  if (failures.length > 0) {
    console.error(`\n✗ check:dev-prereqs --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`    ${f}`);
    console.error('');
    return 1;
  }
  // Derived, not typed: this line read "(17 cases)" as a literal while the
  // roster it describes had grown past it, which is the same "the text promises
  // what the code does not check" shape this change repairs one function over.
  console.log(
    `✓ check:dev-prereqs --self-test — every verdict reachable, exclusions and freshness coverage pinned ` +
      `(${batterySeen.size} batteries, ${[...batterySeen.values()].reduce((a, b) => a + b, 0)} cases), plus the shared workspace enumerator.`,
  );
  selfTestReachedVerdict = true;
  return 0;
}

if (process.argv.includes('--self-test')) {
  const selfTestCode = selfTest();
  if (!selfTestReachedVerdict) {
      console.error(
          '\n✗ check-dev-prereqs self-test: selfTest() returned without reaching its verdict,\n'
              + 'so no success line was printed. Exiting 0 here would report a self-test\n'
              + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
  }
  process.exit(selfTestCode);
}

try {
  if (process.argv.includes('--stamp')) {
    process.exit(stamp(ROOT, process.cwd()));
  }
  process.exit(report(inspect(ROOT)));
} catch (err) {
  if (err instanceof CoverageError) {
    console.error(`\n✗ check:dev-prereqs cannot enumerate the workspace, so it cannot vouch for the build.\n\n  ${err.message}\n`);
    process.exit(1);
  }
  throw err;
}
