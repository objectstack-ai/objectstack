#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The other half of the `merge=os-regen` driver (#4675): make the deferred
 * regeneration **mandatory** instead of remembered.
 *
 * The driver resolves generator-owned artifacts without text-merging them and
 * records each one in `$GIT_DIR/os-regen-pending`. It cannot regenerate them
 * itself — git runs merge drivers before the sources are merged, so anything
 * computed there describes a half-merged tree (see `git-merge-regen.mjs`). This
 * runs from `pre-commit`, where the merged tree finally exists, and refuses the
 * commit while any pending artifact is still stale.
 *
 * It **verifies, then clears** — it does not regenerate. Blanket regeneration
 * from a hook would rewrite artifacts whose staleness nobody saw, which is the
 * signal-destroying behaviour `check:generated` already refuses for the same
 * reason. And a marker cannot get stuck: the moment the artifacts check clean,
 * whether you regenerated them or the merge simply did not change them, the
 * marker is removed and the commit proceeds.
 *
 * ## The deferred merge (#8047)
 *
 * One commit is exempt from the refusal above, and only one: the MERGE commit
 * itself. `scripts/pm/os-regen-merge.sh` — the sanctioned landing sequence, and
 * the in-repo authority for it — takes main's side of every generated path and
 * **commits the merge before regenerating anything**, deliberately, because the
 * driver exits 0 while silently dropping one side: a clean merge and a lost
 * baseline are indistinguishable, and only a separate regeneration commit on a
 * known-good base lets a reviewer read "what main brought" apart from "what my
 * change produces". Refusing that commit made one in-repo authority forbid what
 * another in-repo tool deliberately produces, and the way out people learned was
 * to skip the ENTIRE pre-commit hook — trading one false positive for a blanket
 * bypass. Measured on PR #7851, ruled 2026-08-12.
 *
 * So a merge commit whose artifacts are stale is **deferred, not passed**: the
 * deferral is recorded in the marker (`deferred-at <head> <merge-head>`) and the
 * commit proceeds. Two properties make that a split rather than an escape hatch:
 *
 *   - **It is one commit deep, by construction.** A deferral is only ever entered
 *     while `MERGE_HEAD` exists, and a second merge attempted while one is still
 *     outstanding is refused. Every non-merge commit after it is refused too — by
 *     the ordinary staleness check, unchanged — so nothing can land between the
 *     merge and its discharge. "The immediately following commit" is enforced by
 *     there being no other commit it could be.
 *   - **The discharge is checked where it becomes knowable.** At the instant the
 *     merge commit is created, the commit that discharges it does not exist yet,
 *     so `pre-commit` can only RECORD the deferral. The two events that can
 *     follow are the next commit (this same check, which refuses while stale) and
 *     the push (`.githooks/pre-push`, which runs this with `--pre-push`). A
 *     deferral that is never discharged therefore cannot leave the machine.
 *
 * ## The dist trap
 *
 * `gen:api-surface` reads the BUILT `dist/*.d.ts`. On a stale dist it does not
 * fail — it emits a plausible surface missing every export added since the last
 * build. So for `readsDist` artifacts this refuses to even run the gate unless
 * the build is newer than the sources, because a phantom "breaking removal" has
 * cost real triage time before (#4687, and the trap is recorded in AGENTS.md).
 *
 * Usage:
 *   node scripts/check-regen-pending.mjs              # pre-commit
 *   node scripts/check-regen-pending.mjs --pre-push   # pre-push: never defers
 *   node scripts/check-regen-pending.mjs --self-test  # fixtures only, no repo state
 */

import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PENDING_MARKER, entryForPath, ownerDir, ownerOf, ownerRunCommand } from './regen-artifacts.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import {
  EXIT_PREREQUISITE_NOT_MET,
  INSTALL_FIX,
  classifyImportFailure,
  reportPrerequisiteNotMet,
} from './import-prerequisite.mjs';
import { workspacePackages } from './workspace-enumerator.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_DIR = join(REPO_ROOT, 'packages/spec');

/**
 * Overrides where the `check:*` gates are spawned. `--self-test`'s fixtures point
 * this at a throwaway package so the two-commit sequence can be replayed without
 * spawning the real spec gates; nothing else sets it.
 */
const GATE_CWD_OVERRIDE = process.env.OS_REGEN_GATE_CWD || null;

/**
 * Where ONE artifact's gate is spawned: the directory of the package that declares
 * it (#13585).
 *
 * This was `packages/spec` for every row unconditionally, and it is the half of the
 * single-manifest assumption a lookup-only fix would have left standing. A
 * root-owned row would have reconciled clean in `check:merge-driver` and then been
 * spawned here in a directory that does not define its script — measured, `pnpm -s
 * check:sdui-lockstep` exits 254 in this directory and 0 at the repo root — so the
 * artifact reads as permanently stale and `pre-commit` refuses every commit from
 * then on. Registered and unreconcilable is a worse defect than unregisterable,
 * which is why the owner is read here and not only by the gate.
 *
 * A mistake still fails SAFE, in the direction it always did: a directory without
 * the script makes pnpm exit non-zero, which reads as stale rather than as current.
 */
function gateCwd(entry, workspace) {
  if (GATE_CWD_OVERRIDE) return GATE_CWD_OVERRIDE;
  const dir = ownerDir(ownerOf(entry), workspace);
  return dir === null || dir === '.' ? REPO_ROOT : join(REPO_ROOT, dir);
}

/**
 * Marker line recording a deferral, distinguished from the driver's path lines by
 * a prefix no repo path can have (it contains a space; `%P` pathnames do not).
 * An unrecognised line would be reported as an unknown pending path — blocked,
 * the conservative direction — rather than silently ignored.
 */
const DEFERRAL_PREFIX = 'deferred-at ';

/** Newest mtime under `dir` for files matching `pred`, or 0 when there are none. */
function newestMtime(dir, pred, depth = 0) {
  if (depth > 12 || !existsSync(dir)) return 0;
  let newest = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) newest = Math.max(newest, newestMtime(p, pred, depth + 1));
    else if (pred(e.name)) newest = Math.max(newest, statSync(p).mtimeMs);
  }
  return newest;
}

/**
 * Is `packages/spec/dist` older than the sources it claims to describe? Missing
 * counts as stale. Deliberately conservative: a false "stale" costs a build, a
 * false "fresh" costs a silently wrong artifact.
 */
export function distIsStale(specDir = SPEC_DIR) {
  const dist = newestMtime(join(specDir, 'dist'), (n) => n.endsWith('.d.ts'));
  if (!dist) return true;
  return newestMtime(join(specDir, 'src'), (n) => n.endsWith('.ts')) > dist;
}

/**
 * The same question for the OTHER build artifact a gate reads: is
 * `packages/spec/json-schema` older than the sources it was generated from?
 *
 * `build-docs.ts` reads that tree — it is the input the reference docs are
 * rendered from — and the tree is gitignored, so nothing in a checkout carries
 * it. Until #4723 the question could not arise: `check:docs` ran `gen:schema` as
 * its first step, so the tree was regenerated on every run. That is also what
 * made `check:docs` a "check" that WROTE two tracked artifacts (json-schema.manifest/
 * and authorable-surface/, whenever they were behind), which is the defect
 * #4711 removed from `--check` and #4723 removed from this composition. With the
 * generation gone, the freshness it silently guaranteed has to be ASSERTED, or
 * `check:docs` reports a verdict about a tree that predates the edit under test —
 * a FALSE GREEN on exactly the change (`.describe()` added, key renamed) the gate
 * exists to catch. Same trap, same conservative direction, as `readsDist` above.
 *
 * Two deliberate differences from `distIsStale`:
 *   - `.test.ts` is excluded from the source side. Test files are not inputs to
 *     `build-schemas.ts` (it imports the namespace barrels), so counting them
 *     would send every test-only spec PR to a `gen:schema` it does not need —
 *     and a guard that cries wolf is a guard someone deletes.
 *   - the artifact side matches `.json`, the tree's only content.
 */
export function schemaTreeIsStale(specDir = SPEC_DIR) {
  const tree = newestMtime(join(specDir, 'json-schema'), (n) => n.endsWith('.json'));
  if (!tree) return true;
  return newestMtime(join(specDir, 'src'), (n) => n.endsWith('.ts') && !n.endsWith('.test.ts')) > tree;
}

/**
 * The same question for the THIRD build artifact a gate reads: are
 * `packages/spec`'s emitted **JS bundles** older than the sources they were
 * bundled from?
 *
 * `check:browser-reachable-entries` (#10199) reads `dist/<entry>/index.mjs` and
 * `index.js` — the module a consumer's `import` actually loads — to assert that
 * a declared browser-reachable entry links no zod. That is a different artifact
 * from the one `distIsStale` measures, and reusing it would be wrong **in the
 * dangerous direction**: `packages/spec`'s build is two tsup passes, and the
 * second (`BUILD_DTS=true tsup`, `dts: { only: true }`) refreshes the
 * declarations WITHOUT re-emitting a single `.mjs`. A `.d.ts`-fresh tree can
 * therefore carry bundles that predate the edit under test, and a zod-link
 * verdict computed over those bundles is a FALSE GREEN on exactly the import
 * the gate exists to catch.
 *
 * It is also wrong in the merely annoying direction: `OS_SKIP_DTS=1` — the
 * documented local build flag — emits fresh JS and skips the declarations, so
 * `distIsStale` reports stale for a tree whose bundles are exactly current, and
 * this gate would refuse a build that could have answered.
 *
 * Three deliberate differences from `distIsStale`:
 *   - the artifact side matches `.mjs`/`.js`, the emitted bundles (`.d.ts` and
 *     `.d.mts` end in `.ts`/`.mts`, and sourcemaps in `.map`, so neither is
 *     counted);
 *   - `.test.ts` is excluded from the source side, on `schemaTreeIsStale`'s
 *     reasoning: a test file is not an input to any entry's bundle graph, so
 *     counting it would send every test-only spec PR to a rebuild it does not
 *     need, and a guard that cries wolf is a guard someone deletes;
 *   - `tsup.config.ts` IS counted, though it sits outside `src/`. It is the one
 *     input whose edit invalidates this gate's measurement most directly —
 *     `entry`, `splitting` and the external set are all decided there — so an
 *     edited-but-unbuilt bundler config must read as stale rather than as a
 *     tree the gate may believe.
 *
 * Missing counts as stale, and the direction is the same conservative one its
 * two siblings take: a false "stale" costs a build, a false "fresh" costs a
 * verdict nobody can trust.
 */
export function bundlesAreStale(specDir = SPEC_DIR) {
  const bundles = newestMtime(
    join(specDir, 'dist'),
    (n) => n.endsWith('.mjs') || n.endsWith('.js'),
  );
  if (!bundles) return true;
  const src = newestMtime(
    join(specDir, 'src'),
    (n) => n.endsWith('.ts') && !n.endsWith('.test.ts'),
  );
  const configPath = join(specDir, 'tsup.config.ts');
  const config = existsSync(configPath) ? statSync(configPath).mtimeMs : 0;
  return Math.max(src, config) > bundles;
}

/**
 * This worktree's git dir — `--absolute-git-dir` resolves to `.git/worktrees/<name>`
 * in a linked worktree, so the marker and its deferral are per-worktree state and
 * two agents merging in parallel cannot collect each other's debt.
 */
function gitDirPath() {
  return execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
}

/** The marker's two kinds of line: the driver's deferred paths, and our deferral record. */
export function readMarker(marker) {
  if (!existsSync(marker)) return { paths: [], deferral: null };
  const lines = readFileSync(marker, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const record = lines.find((l) => l.startsWith(DEFERRAL_PREFIX));
  const [head, ...mergeHeads] = record ? record.slice(DEFERRAL_PREFIX.length).trim().split(/\s+/) : [];
  return {
    paths: [...new Set(lines.filter((l) => !l.startsWith(DEFERRAL_PREFIX)))],
    deferral: record ? { head, mergeHeads } : null,
  };
}

/** Append the deferral record. Appended, never rewritten — the driver owns the path lines. */
export function recordDeferral(marker, { head, mergeHeads }) {
  appendFileSync(marker, `${DEFERRAL_PREFIX}${[head, ...mergeHeads].join(' ')}\n`);
}

/**
 * Is a merge commit being created right now? `MERGE_HEAD` exists only between a
 * stopped merge and the commit that completes it, which is exactly the window
 * `pre-commit` runs in for a merge commit.
 *
 * ⚠️ A merge that completes WITHOUT stopping never reaches this file: git does not
 * run `pre-commit` for the commit it makes itself (verified, git 2.43). Such a
 * merge lands with the marker set and untouched, and the refusal falls on the next
 * commit — which is the deferral's discharge point either way.
 */
export function mergeInProgress(gitDir) {
  const file = join(gitDir, 'MERGE_HEAD');
  if (!existsSync(file)) return null;
  const mergeHeads = readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  let head = '';
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    head = '(root)'; // A merge as the first commit has no HEAD. Vanishingly rare, not an error.
  }
  return { head, mergeHeads };
}

/**
 * The whole state machine, as a pure function — five cases, no I/O, so the
 * self-test can pin every one of them including the ones a fixture cannot reach.
 *
 * `blocked` is how many artifacts failed their gate; `merging` is `MERGE_HEAD`
 * present; `deferral` is a record already outstanding; `allowDefer` is false on
 * `--pre-push`, where deferring would defeat the point of checking at all.
 */
export function decide({ blocked, merging, deferral, allowDefer = true }) {
  if (!blocked) return deferral ? 'discharged' : 'clear';
  if (merging && deferral) return 'refuse-second-deferral';
  if (merging && allowDefer) return 'defer';
  if (deferral) return 'refuse-undischarged';
  return 'refuse-stale';
}

/**
 * A gate that could not RUN is not a verdict about the artifact (#15722).
 *
 * This check does not regenerate and does not compare bytes: it SPAWNS the
 * artifact's `check:` gate and reads its exit status. So every reason that gate
 * has for exiting non-zero arrives here wearing the same clothes, and until this
 * function existed they were all printed as one word — `stale` — with three
 * lines of whatever the child said underneath. On a checkout with no
 * `node_modules` that produced a verdict about a file nothing read: measured on
 * #15722, `content/docs/permissions/system-context.mdx` byte-identical to main's
 * copy, reported `stale` over a raw `ERR_MODULE_NOT_FOUND` stack.
 *
 * That is the class #11557 closed for the derived gates, at this site. The frame,
 * the wording and the exit code are #11824's — `reportPrerequisiteNotMet` and
 * `EXIT_PREREQUISITE_NOT_MET`, imported, never restated — because a second
 * spelling of "nothing was measured" is the defect one level up.
 *
 * ## Three shapes, all live, measured on an uninstalled tree
 *
 * Fourteen registered paths / thirteen gates, `pnpm install` never run:
 *
 *   - **10** — `sh: 1: tsx: not found`. Six of the eight distinct `check:` scripts
 *     run through `tsx`, which lives in `node_modules/.bin`. The RUNNER is the
 *     missing piece; the gate's own module graph never got as far as being linked.
 *   - **1** — a raw `ERR_MODULE_NOT_FOUND` stack (`check:system-context-census`,
 *     via `scripts/isystem-census.mjs`'s bare `import ts from 'typescript'`). node
 *     links the whole graph before any body runs, so a gate cannot preflight its
 *     own missing dependency — #11824's thunks are what make that reportable, and
 *     this gate has not adopted them.
 *   - **1** — the child ALREADY refused in #11557's landed frame and exited
 *     `EXIT_PREREQUISITE_NOT_MET` (`check:platform-object-tenancy-census`, whose
 *     `ts-parse` dependency is thunked). A gate that says `PREREQUISITE NOT MET`
 *     in so many words was still being relabelled `stale` by its caller — the
 *     landed fix undone one process boundary out.
 *
 * The remaining 2 are this file's OWN prerequisite refusals (`readsDist`,
 * `readsSchemaTree`), which never spawn anything and are deliberately untouched
 * here: they already print what is unmet and what clears it.
 *
 * ⚠️ The dangerous direction is unchanged. Nothing here makes a push cheaper: a
 * refusal is still a refusal (`.githooks/pre-push` maps every non-zero to 1), the
 * marker is NOT cleared, and the debt is still owed. What changes is the reading
 * a human gets — an unmet prerequisite with a command that clears it, instead of
 * a false claim about a generated file.
 *
 * @param {string} output the child's combined stdout+stderr
 * @param {number} exitCode the child's exit status
 * @param {string} fromDir where to resolve from when the child named no importer
 * @returns {null | { headline: string, detail: string[], fix: string, kind: string }}
 *   `null` when the gate RAN and reached a verdict of its own — the caller must
 *   keep reporting that as `stale`, which is what it is.
 */
export function gateCouldNotRun(output, exitCode, fromDir) {
  const text = String(output ?? '');

  // -- Shape 3: the child already answered in this exact frame --
  // Propagated rather than re-derived. The child knows which package it wanted
  // and why; re-classifying from here would be a second opinion about a fact
  // already reported, and the two could disagree.
  const refused = text.match(/^\s*(\S+): PREREQUISITE NOT MET(?: — (.+))?$/m);
  if (exitCode === EXIT_PREREQUISITE_NOT_MET || refused) {
    return {
      kind: 'gate-refused',
      headline: refused?.[2]
        ? `the gate refused to measure — ${refused[2]}`
        : `the gate refused to measure, reporting an unmet prerequisite of its own`,
      detail: [
        `\`${refused?.[1] ?? 'the gate'}\` exited ${exitCode} — ${EXIT_PREREQUISITE_NOT_MET} is`,
        `\`EXIT_PREREQUISITE_NOT_MET\`, the code #11557 gave "nothing was measured". It said so`,
        `in its own words:`,
        ``,
        ...text.split('\n').filter(Boolean).slice(0, 6).map((l) => `  ${l.trim()}`),
      ],
      fix: INSTALL_FIX,
    };
  }

  // -- Shape 1: the runner is not on PATH --
  // Anchored on the shell's own line rather than on the words "not found", which
  // a gate's prose may legitimately contain. `sh` (dash) writes `sh: 1: tsx: not
  // found`; bash writes `bash: line 1: tsx: command not found`.
  const runner = text.match(/^(?:sh|bash|dash|zsh): (?:line )?\d+: ([^:\n]+): (?:command )?not found$/m);
  if (runner || exitCode === 127) {
    const cmd = runner?.[1] ?? '';
    return {
      kind: 'runner-missing',
      headline: cmd
        ? `the gate's runner \`${cmd}\` is not installed`
        : 'the gate\'s runner is not installed',
      detail: [
        cmd
          ? `The gate's script starts with \`${cmd}\`, and the shell could not find it. Runners`
          : 'The shell could not find the command the gate\'s script starts with. Runners',
        `like \`tsx\` live in \`node_modules/.bin\`, so a checkout with no \`node_modules\` has none`,
        `of them and the gate's own code was never reached.`,
      ],
      fix: INSTALL_FIX,
    };
  }

  // -- Shape 2: node could not link the gate's module graph --
  // Reconstructed as an error for `classifyImportFailure`, so the FOUR-way
  // diagnosis #11824 measured (uninstalled / unbuilt workspace package / broken
  // install / a dependency of a whole package) is the one reported here too,
  // rather than a fourth-hand "run pnpm install" that is wrong for two of them.
  const link = text.match(/Error \[(ERR_MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED)\]: ([^\n]+)/);
  if (link) {
    const message = link[2];
    const pkg = message.match(/Cannot find package '([^']+)'/)?.[1] ?? '';
    const importer = message.match(/imported from (\S+)/)?.[1] ?? '';
    const verdict = classifyImportFailure(
      pkg || message,
      { code: link[1], message },
      importer ? dirname(importer) : fromDir,
    );
    // `broken` with no headline is `classifyImportFailure`'s "not my story" — it
    // means the package RESOLVED and then threw, which is a real gate failure.
    if (verdict.kind === 'broken' && !verdict.headline) return null;
    return {
      kind: verdict.kind,
      headline: verdict.headline,
      detail: [
        `The gate never ran a check: node could not LINK its module graph, which it does`,
        `for the whole graph before any module body executes. node reported:`,
        ``,
        `  ${message}`,
        ``,
        ...verdict.detail,
      ],
      fix: verdict.fix,
    };
  }

  return null;
}

function runCheck(script, cwd) {
  try {
    execSync(`pnpm -s ${script}`, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, output: '', code: 0 };
  } catch (err) {
    return {
      ok: false,
      code: typeof err?.status === 'number' ? err.status : 1,
      output: `${err?.stdout?.toString() ?? ''}${err?.stderr?.toString() ?? ''}`.trim(),
    };
  }
}

/**
 * One refusal for a run in which one or more gates could not run.
 *
 * The FRAME is `reportPrerequisiteNotMet`'s — what is unmet, why, the command
 * that clears it, and the load-bearing half, that nothing was measured. Only the
 * `detail` is written here, because that is the half #11824's header reserves for
 * the gate: the reason this site could not measure is that it SPAWNS its gates,
 * which is a fact about this file and about no other importer of that frame.
 *
 * When several gates could not run the first one carries the diagnosis and the
 * rest are named. They share a cause in every measured case (no `node_modules`),
 * and printing four near-identical `pnpm install` paragraphs buries the one line
 * a reader needs.
 */
function prerequisiteVerdict(unmeasured) {
  const [{ prereq: first }] = unmeasured;
  const rest = unmeasured.slice(1).map((u) => `\`${u.check}\``);
  return {
    kind: first.kind,
    pkg: '',
    headline: unmeasured.length === 1
      ? `\`${unmeasured[0].check}\` could not run: ${first.headline}`
      : `${unmeasured.length} of this run's gates could not run: ${first.headline}`,
    detail: [
      'This check neither regenerates nor compares bytes: for each deferred artifact it',
      'SPAWNS the `check:` gate that proves the artifact current, and reads the verdict.',
      `${unmeasured.length === 1 ? 'That gate' : 'Those gates'} never reached one.`,
      '',
      ...first.detail,
      ...(rest.length ? ['', `Also unmeasured, same run: ${rest.join(', ')}.`] : []),
      '',
      '⚠️ The debt is NOT cleared and this is still a refusal: the marker keeps every',
      'deferred path, and the next commit or push meets it again. What is withheld is',
      'the VERDICT — that these artifacts are stale — not the obligation to check them.',
    ],
    fix: first.fix,
  };
}

function main({ prePush = false } = {}) {
  const gitDir = gitDirPath();
  // -- What "pending" is, and what it is NOT (#15722) --
  //
  // The pending set is READ FROM THE MARKER. It is not derived from a diff, and
  // in particular it is not "every `merge=os-regen` path that changed between the
  // previous and the new HEAD". The only writer of a path line is `markPending`
  // in `scripts/git-merge-regen.mjs`, which git calls only when it actually runs
  // the merge driver on a path — i.e. only when a text merge was attempted and
  // declined.
  //
  // So a FAST-FORWARD records nothing: git moves the ref and checks out the
  // upstream tree without invoking a single merge driver. #15722 reported the
  // opposite as a second defect and it was measured and WITHDRAWN — from a branch
  // at `e13ede817^`, `git pull --ff-only origin main` across a commit that changed
  // `content/docs/permissions/system-context.mdx` leaves no marker and this check
  // exits 0 with no output, deps installed or not. What the reporting seat hit was
  // a marker from an EARLIER real merge that half 1 had made impossible to clear:
  // the gate could never pass without `node_modules`, so the marker was never
  // removed and every later push in that worktree met it, fast-forward or not.
  // The fixture below pins the fast-forward reading so a "fix" cannot re-derive
  // the predicate from a diff.
  const marker = join(gitDir, PENDING_MARKER);
  const { paths: pending, deferral } = readMarker(marker);
  if (!pending.length) {
    // Nothing deferred (or a record with no paths left to owe): the marker has no
    // debt to collect, so it cannot get stuck. Same clearing property as before.
    if (deferral) rmSync(marker, { force: true });
    return 0;
  }
  const merging = prePush ? null : mergeInProgress(gitDir);

  const entries = pending.map((p) => ({ path: p, entry: entryForPath(p) })).filter((x) => x.entry);
  const unknown = pending.filter((p) => !entryForPath(p));
  // Enumerated once, here rather than per gate: `gateCwd` needs an owner-to-directory
  // answer and this is the repo's one parse of the workspace globs.
  const workspace = workspacePackages(REPO_ROOT);

  console.error(
    `\nos-regen: ${pending.length} generated artifact(s) were merged WITHOUT a text merge and must be `
      + `regenerated from the merged tree${prePush ? ' before this push' : ' before this commit'}.\n`,
  );

  // Group by gate: `gen:schema` owns two artifacts, so running it twice is waste.
  const byCheck = new Map();
  for (const { path, entry } of entries) {
    const g = byCheck.get(entry.check) ?? { entry, paths: [] };
    g.paths.push(path);
    byCheck.set(entry.check, g);
  }

  let blocked = 0;
  /** Artifacts whose gate could not RUN — blocked, but with no verdict behind it. */
  const unmeasured = [];
  for (const [check, { entry, paths }] of byCheck) {
    if (entry.readsDist && distIsStale()) {
      blocked++;
      console.error(
        `  ✗ ${paths.join(', ')}\n`
          + `      ${check} reads packages/spec/dist, which is older than src — NOT running it.\n`
          + `      On a stale dist this gate reports phantom removals and the generator WRITES them.\n`
          + `      pnpm --filter @objectstack/spec build && ${ownerRunCommand(ownerOf(entry), entry.gen)}`,
      );
      continue;
    }
    // Same shape one artifact over (#4723). The gate would refuse on its own —
    // `build-docs.ts` carries the guard, so every caller is covered, not just
    // this one — but running it here would spend the spawn only to reprint a
    // message this hook can state with the merge context already in hand.
    if (entry.readsSchemaTree && schemaTreeIsStale()) {
      blocked++;
      console.error(
        `  ✗ ${paths.join(', ')}\n`
          + `      ${check} reads packages/spec/json-schema/, which is missing or older than src —\n`
          + `      NOT running it. That tree is gitignored, so a merge never brings it with them.\n`
          + `      pnpm --filter @objectstack/spec gen:schema && ${ownerRunCommand(ownerOf(entry), entry.gen)}`,
      );
      continue;
    }
    const cwd = gateCwd(entry, workspace);
    const { ok, output, code } = runCheck(check, cwd);
    if (ok) {
      console.error(`  ✓ ${paths.join(', ')} — current`);
      continue;
    }
    blocked++;
    const detail = output.split('\n').filter(Boolean).slice(0, 3).map((l) => `        ${l}`).join('\n');
    // A gate that could not RUN answered nothing (#15722). It still counts as
    // BLOCKED — the artifact is not proven current, so the marker keeps it and the
    // refusal stands — but the line says what happened rather than naming the file.
    const prereq = gateCouldNotRun(output, code, cwd);
    if (prereq) {
      unmeasured.push({ check, paths, prereq });
      console.error(
        `  ⚠ ${paths.join(', ')} — NOT MEASURED (\`${check}\` could not run)\n`
          + `${detail ? `${detail}\n` : ''}      Fix:  ${prereq.fix}`,
      );
      continue;
    }
    console.error(`  ✗ ${paths.join(', ')} — stale\n${detail ? `${detail}\n` : ''}`
      + `      ${ownerRunCommand(ownerOf(entry), entry.gen)}`);
  }

  for (const p of unknown) {
    blocked++;
    console.error(`  ✗ ${p} — recorded as pending but absent from scripts/regen-artifacts.mjs (cannot verify)`);
  }

  const action = decide({ blocked, merging, deferral, allowDefer: !prePush });
  const owed = `the ${blocked} stale artifact(s) above`;

  if (action === 'defer') {
    recordDeferral(marker, merging);
    console.error(
      `\nos-regen: this is a MERGE commit — ${owed} are DEFERRED to the next commit, not passed.\n`
        + `  Recorded against ${merging.head.slice(0, 12)} + ${merging.mergeHeads.map((h) => h.slice(0, 12)).join(' ')}.\n`
        + '  The merge lands as its own commit on purpose (`scripts/pm/os-regen-merge.sh` step 3): the\n'
        + '  os-regen driver exits 0 while silently dropping one side, so only a separate regeneration\n'
        + '  commit on a known-good base tells "what main brought" apart from "what your change produces".\n'
        + '\n  ⚠️ The NEXT commit must discharge this — regenerate, `git add`, commit. Until it does, every\n'
        + '  commit is refused, a second merge cannot defer on top, and `git push` is refused too.\n',
    );
    return 0;
  }

  // -- An unmet prerequisite is not a verdict about the artifact (#15722) --
  //
  // Placed BELOW `defer` on purpose. Deferring is not a claim that anything is
  // stale — it is "this merge owes a check, collect it at the next commit" — and
  // a merge commit that cannot run its gates owes exactly that. Refusing here
  // instead would put back the #8047 defect this file's header is about: a merge
  // commit refused by one in-repo authority for doing what another one
  // prescribes, whose learned workaround was skipping the whole hook.
  //
  // Every REMAINING action is a verdict, and a verdict is what this run does not
  // have. So the refusal is reported in #11557's landed frame and exits
  // `EXIT_PREREQUISITE_NOT_MET` — distinct from a finding's 1, and non-zero, so
  // `.githooks/pre-push` still refuses the push and the marker still keeps its
  // debt. Nothing is cleared here: `reportPrerequisiteNotMet` exits before the
  // `rmSync` at the bottom of this function can be reached.
  if (unmeasured.length) {
    const subjects = unmeasured.flatMap((u) => u.paths);
    reportPrerequisiteNotMet(
      import.meta.url,
      prerequisiteVerdict(unmeasured),
      `${subjects.join(', ')} ${subjects.length === 1 ? 'is' : 'are'} stale`,
    );
  }

  if (action === 'refuse-second-deferral') {
    console.error(
      `\nos-regen: a deferral is already outstanding (taken at ${deferral.head.slice(0, 12)}) and ${owed}\n`
        + '  are still stale, so THIS merge cannot defer on top of it. A deferral is one commit deep by\n'
        + '  construction — any deeper and it is an escape hatch, not the split-commit procedure.\n'
        + '  Discharge the first one (regenerate + commit), then merge again.\n',
    );
    return 1;
  }

  if (action === 'refuse-undischarged') {
    console.error(
      `\nos-regen: the deferral taken on the merge commit at ${deferral.head.slice(0, 12)} is UNDISCHARGED —\n`
        + (prePush
          ? `  this push still owes ${owed}. A merge may defer its regeneration to the next commit;\n`
            + '  it may not defer it past the push, which is the last moment anything local can see it.\n'
          : `  this is the commit that owes ${owed}. Regenerate them and \`git add\` them.\n`)
        + '  (`scripts/pm/os-regen-merge.sh` prints the step-4 chain for the surface you touched.)\n',
    );
    return 1;
  }

  if (action === 'refuse-stale') {
    console.error(
      `\nRegenerate ${owed}, \`git add\` them, and ${prePush ? 'commit the result before pushing' : 'commit again'}.\n`
        + '  This check clears itself the moment they are current — nothing to reset by hand.\n'
        + '  Landing a merge? `bash scripts/pm/os-regen-merge.sh` runs the sanctioned sequence — its merge\n'
        + '  auto-commits first with no hook run at all (git skips pre-commit for a merge it completes\n'
        + '  itself), so THIS refusal, on the ordinary commit right after, is that sequence\'s designed\n'
        + '  collection point — not a deferral. Regeneration follows as its own commit; every artifact\n'
        + '  above also has a required gate on the PR.\n',
    );
    return 1;
  }

  if (prePush && blocked) {
    // Unreachable via `decide` — `allowDefer: false` routes every blocked push into
    // one of the refusals above. Kept as a floor: a future case that forgets the
    // push path must not let a stale artifact out of the machine by falling through.
    console.error('\nos-regen: refusing to push with deferred artifacts still stale.\n');
    return 1;
  }

  rmSync(marker, { force: true });
  console.error(
    action === 'discharged'
      ? 'os-regen: deferred regeneration discharged — all artifacts current, marker cleared.\n'
      : 'os-regen: all deferred artifacts are current — marker cleared.\n',
  );
  return 0;
}

// `check:generated --fix` imports `distIsStale` from here, so nothing may run on
// import — only when this file IS the entry point.
const invokedDirectly = isEntrypoint(import.meta.url);

/* ------------------------------------------------ self-test: battery roster */

// The self-test's own battery roster and floor (#13799).
//
// `noDist && noTree && armed && table && fixture` was this self-test's ONLY
// success condition, so "every sub-check held" and "the sub-checks never ran"
// printed the same line. A callee whose body stops doing its work still returns
// whatever its last surviving statement produces, and the green verdict below
// then claims this file's whole deferred-merge wiring is sound. Closed the way
// the Tier C pilot closed it (PR #15326, `git-merge-regen.mjs`): what is pinned
// is the registered NAMES, not a number.
//
// -- Why the CALLEE NAME is the battery --
//
// This file has no `selfTest()` entry function: the `--self-test` dispatch at
// the bottom invokes THREE named callees, each printing its own section and
// returning a boolean. So the roster's unit is the CALLEE, and its label is the
// one the SOURCE ALREADY CARRIES -- the function's own name. Nothing is invented
// and nothing is judged per comment, and a set difference names WHICH sub-check
// stopped rather than saying only that something did.
// `registerCase('<calleeName>')` is the FIRST statement of every callee, above
// any early return, so what the ledger records is that the callee RAN -- which
// is why each floor is 1 rather than the number of assertions the callee
// happens to contain.
//
// STOP -- the three callees' own inner sinks are NOT batteries here, and they
// are worth naming because all three are different shapes: `fixtureSelfTest`'s
// `check()` helper (14 calls), `decisionTableSelfTest`'s literal 8-row table
// with its driving loop, and `prePushIsArmedSelfTest`'s bare boolean. Recipe A
// (PR #15271, `check-sdui-manifest`) does make a table row a battery -- for a
// file whose SELF-TEST *is* the table: one literal table, one driving loop over
// it, one sink. Here the table is a local of ONE callee among three, and that
// callee already reduces its rows to a single returned verdict of its own.
// Flooring those rows would floor one callee's internals while the other two
// stayed at callee granularity -- a roster whose unit changes per entry. The
// rule: the battery is the unit the DISPATCH names.
//
// STOP -- the TWO assertions written INLINE in the dispatch block (`noDist`,
// `noTree`) are deliberately OUTSIDE this roster, and that is a DECLARED GAP,
// not an oversight (ruled Q1 = A on #13799; the pilot and batches 7a/7b set the
// precedent). They are not callees: the dispatch names no unit for them, so
// there is no name the source already carries. Inventing a label would put a
// hand-written string into a roster whose entire property is that every entry
// is read off a declaration, and hoisting them into named callees is a reshape
// with its own card, never a rider here. What the gap costs, stated plainly:
// those two lines can stop running and this floor will not say so.
//
// STOP -- a pinned TOTAL is not the repair: one callee dropping all its work
// keeps a total "right" the moment a sibling grows.
//
// The counts are a FLOOR, not an equality -- a callee that grows a second
// registration must not red. 1 is the honest floor for a callee: the dispatch
// reaches it exactly once per run.
const SELF_TEST_BATTERIES = Object.freeze({
  prePushIsArmedSelfTest: 1,
  decisionTableSelfTest: 1,
  fixtureSelfTest: 1,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too. This pin is also half of
// the duplicate refusal: two dispatch entries naming ONE callee collapse to one
// key in the literal above, so the roster falls below this number; the
// roster/dispatch cross-check in `batteryFloorFailures()` is the other half, and
// it names WHICH callee was listed twice.
const SELF_TEST_BATTERY_FLOOR = 3;

// The key a registration is filed under when a callee registers no name at all.
// It is not a declared battery, so it reds by the same set difference rather
// than silently inflating whichever battery registered last.
const UNATTRIBUTED_BATTERY = '(no callee named)';

// The battery ledger, read by `batteryFloorFailures()` from the dispatch block
// at the very bottom of this file. It is MODULE-level rather than local to a
// self-test body because this file HAS no self-test body: the registrations
// happen inside three separate callees and the floor is read at the dispatch's
// verdict site, so the ledger has to outlive every one of those frames.
//
// Named for the roster's role, deliberately WITHOUT a self-test spelling:
// `check:pm-dispatch-gates` anchors on a top-level declaration whose NAME spells
// self-test, and every such name owes a row in its COMPOUND_ANCHOR_LEDGER. The
// three callee names above already spell self-test and already carry their rows;
// an object KEY is not a column-0 declaration, so the roster owes no new row.
// `battery` is also the accurate word.
const batterySeen = new Map();

/**
 * Record that a self-test callee RAN.
 *
 * Called as the FIRST statement of each of the three callees the `--self-test`
 * dispatch invokes -- above any early return, so a callee that bails out early
 * still reports that it ran, and the floor is never met by a frame that returned
 * before doing anything.
 */
function registerCase(name) {
  const key = name ?? UNATTRIBUTED_BATTERY;
  batterySeen.set(key, (batterySeen.get(key) ?? 0) + 1);
}

/**
 * The floor: every declared callee RAN (#13799).
 *
 * Evaluated at the dispatch's verdict site -- after all three callees have had
 * their chance and immediately before the success line -- and reached only from
 * the `--self-test` branch, so a production `pre-commit` / `pre-push` run never
 * reads the ledger at all.
 *
 * @param {string[]} invoked the callee names the dispatch block actually invokes
 * @returns {string[]} floor breaches; empty means the floor held
 */
function batteryFloorFailures(invoked) {
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const problems = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    problems.push(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} -- a battery deleted from the roster takes its own floor with it.`,
    );
  }

  // -- Roster vs dispatch, both directions --
  // `invoked` is read off the dispatch's own list of callees, so this pair says
  // WHICH name lost its counterpart. A declared name nothing invokes would also
  // read DID NOT RUN below; naming it here reports the cause (nothing calls it)
  // rather than only the symptom (nothing registered).
  const duplicated = [...new Set(invoked.filter((name, i) => invoked.indexOf(name) !== i))];
  if (duplicated.length) {
    problems.push(
      `the dispatch invokes ${duplicated.map((n) => JSON.stringify(n)).join(', ')} more than once -- `
        + 'two entries naming one callee are ONE battery, so the second can stop running while the '
        + 'first keeps the floor met.',
    );
  }
  for (const name of invoked) {
    if (declared.includes(name)) continue;
    problems.push(
      `the dispatch invokes "${name}", which is not declared in SELF_TEST_BATTERIES -- a callee `
        + 'nothing declares is a sub-check nothing floors.',
    );
  }
  for (const name of declared) {
    if (invoked.includes(name)) continue;
    problems.push(
      `SELF_TEST_BATTERIES declares "${name}", which the dispatch block does not invoke -- a floor `
        + 'over a battery nothing can reach.',
    );
  }

  // -- Roster vs ledger, both directions --
  for (const [name, count] of batterySeen) {
    if (declared.includes(name)) continue;
    problems.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES -- a case attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    problems.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN -- 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed that sub-check holds.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} -- cases that used to run no longer do.`,
    );
  }

  if (problems.length) {
    problems.push(
      'A battery at or below its floor means a sub-check STOPPED RUNNING -- the battery is the bug, '
        + 'not the number. Find what stopped registering (a deleted invocation, a renamed callee, a '
        + '`registerCase()` moved below an early return) and restore it.',
    );
  }
  return problems;
}

/**
 * Replay the deferred-merge sequence against a THROWAWAY git repo (#8047).
 *
 * This behaviour is a property of a PAIR of commits — accept here, collect there
 * — which no single-tree assertion can express, so the fixture builds the pair.
 * The worked precedent it is shaped after is PR #7851: merge commit `cbea40d`
 * (parents `c57e636` + `e3c8ed0`) followed by regeneration `7e4799f`.
 *
 * The gates are redirected at the fixture's own `package.json` via
 * `OS_REGEN_GATE_CWD`, so `check:spec-changes` is a one-line stub the fixture
 * flips from failing to passing — the two-commit shape is what is under test, not
 * the spec gates, and spawning the real ones here would make the self-test cost
 * a full spec build.
 */
function fixtureSelfTest() {
  registerCase('fixtureSelfTest');
  const dir = mkdtempSync(join(tmpdir(), 'os-regen-defer-'));
  const git = (args, opts = {}) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  const results = [];
  const check = (label, cond) => {
    results.push(cond);
    console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  };

  /**
   * Run the real script inside the fixture, with the stub gate in the given state.
   *
   * ⚠️ This WRITES `package.json` into the fixture worktree, and it is called while
   * a merge is in progress. That is only safe because the stub is kept out of the
   * index — see the `info/exclude` note below, and #9258 for what it cost when it
   * was not.
   */
  /**
   * What the stub gate DOES, per state.
   *
   * The two prerequisite states are REAL failures, not printed imitations of one.
   * `unloadable` makes node fail to resolve a package that does not exist, which
   * is the same `ERR_MODULE_NOT_FOUND` a gate takes in a checkout with no
   * `node_modules` — node links the whole graph before any body runs, so this
   * cannot be faked by a script that prints a stack and exits. `runner-missing`
   * hands the shell a command that is not on PATH, the shape 10 of the 13
   * registered gates take without `node_modules` (`sh: 1: tsx: not found`). A
   * fixture that echoed the text instead would pass against an implementation
   * that matched on the text and nothing else — which is the whole risk here.
   */
  const GATE_STUBS = {
    clean: 'exit 0',
    // A gate that RAN and found the artifact stale. The control for every case
    // below: this one must keep today's verdict exactly.
    stale: 'exit 1',
    unloadable: `node --input-type=module -e "import 'os-regen-fixture-absent-pkg';"`,
    'runner-missing': 'os-regen-fixture-absent-runner --check',
    // A gate that already refused in #11557's landed frame, exiting 3.
    // ⛔ No backticks in the message: this string is a package.json script, run by
    // the shell, and a backtick inside its double quotes is command substitution.
    'gate-refused':
      'node -e "console.error(\'stub-gate: PREREQUISITE NOT MET — the dependency yaml is not installed\'); process.exit(3)"',
  };

  const runHook = (gate, args = []) => {
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify({ name: 'os-regen-fixture', scripts: { 'check:spec-changes': GATE_STUBS[gate] } }, null, 2)}\n`,
    );
    // `spawnSync`, not `execFileSync`: every message this script prints goes to
    // STDERR, which execFileSync returns only on the failure path — capturing the
    // accept-path wording is half of what is under test here.
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, OS_REGEN_GATE_CWD: dir },
    });
    return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };

  try {
    git(['init', '-q', '-b', 'main', '.']);
    git(['config', 'user.email', 'fixture@objectstack.test']);
    git(['config', 'user.name', 'os-regen fixture']);
    git(['config', 'core.hooksPath', '/dev/null']); // the fixture drives the script itself
    const gitDir = git(['rev-parse', '--absolute-git-dir']).trim();

    // `package.json` here is the HARNESS's gate stub — `runHook` rewrites it to flip
    // the stub `check:spec-changes` between passing and failing — not part of the
    // two-commit scenario under test. It must therefore never enter the index, and
    // this repo-local exclude is what keeps that true: the `git add -A` on `side2`
    // below otherwise sweeps the stub into a commit, and from that point on every
    // `runHook` call made DURING a merge leaves a tracked file whose stat data no
    // longer matches the index entry the merge just recorded.
    //
    // `git merge --abort` is a `reset --merge`, which refuses to discard a tracked
    // file that is not up to date — so the fixture crashed there, and crashed only
    // SOMETIMES, because git compares mtime at one-second granularity: the abort
    // survived exactly when the rewrite happened to land in the same wall-clock
    // second as the merge's index write, and failed when it landed in the next one.
    // The stub's CONTENT is identical either way; the file is only ever stat-dirty,
    // which is why nothing in the fixture's own assertions could see it coming.
    //
    // Measured on #9258: two crashes in five CI runs across four PRs that never
    // touched this script; reproduced 10/10 by delaying the rewrite past a second
    // boundary, and 0/10 at that same delay with this exclude in place.
    //
    // `.git/info/exclude` and not a `.gitignore`: the latter would itself be a
    // tracked file inside the merges under test, changing the scenario to protect
    // the harness. `mkdirSync` because a custom `init.templateDir` need not ship
    // `info/`, and a fixture that guards against flakiness may not add one.
    mkdirSync(join(gitDir, 'info'), { recursive: true });
    appendFileSync(join(gitDir, 'info', 'exclude'), '\n# the self-test gate stub (#9258) — never track it\npackage.json\n');

    const marker = join(gitDir, PENDING_MARKER);
    const pendingPath = 'packages/spec/spec-changes.json'; // a real REGEN_ARTIFACTS entry
    const write = (f, c) => writeFileSync(join(dir, f), c);

    write('f.txt', 'base\n');
    git(['add', '-A']);
    git(['commit', '-qm', 'base']);
    git(['checkout', '-qb', 'side']);
    write('s.txt', 'side\n');
    git(['add', '-A']);
    git(['commit', '-qm', 'side']);
    git(['checkout', '-q', 'main']);
    write('f.txt', 'main moved\n');
    git(['add', '-A']);
    git(['commit', '-qm', 'main moves']);

    // A merge left uncommitted — the state `pre-commit` sees when it runs for a
    // merge commit — with the driver's marker set, artifacts stale.
    git(['merge', '--no-commit', '--no-ff', 'side'], { stdio: ['ignore', 'pipe', 'pipe'] });
    writeFileSync(marker, `${pendingPath}\n`);

    const merge = runHook('stale');
    check('a MERGE commit with stale artifacts is ACCEPTED as a deferral', merge.code === 0);
    check('  …and says so — "DEFERRED", not a silent pass', /DEFERRED to the next commit/.test(merge.out));
    check('  …and points at the sanctioned procedure, never at skipping the hook',
      /os-regen-merge\.sh/.test(merge.out) && !/no-verify/.test(merge.out));
    const recorded = readMarker(marker).deferral;
    check('  …recording the merge it was taken on', Boolean(recorded?.head) && recorded.mergeHeads.length === 1);
    git(['commit', '-q', '--no-verify', '-m', 'merge side (regeneration follows)']);

    // Still stale one commit later: the deferral is now due, and this is where the
    // pre-fix hook and this one must AGREE — both refuse.
    const due = runHook('stale');
    check('the NEXT commit is REFUSED while the deferral is undischarged', due.code === 1);
    check('  …naming the merge that owes it', /UNDISCHARGED/.test(due.out));

    // A second merge cannot stack a second deferral on the first.
    git(['checkout', '-qb', 'side2', 'main~1']);
    write('s2.txt', 'side2\n');
    git(['add', '-A']);
    git(['commit', '-qm', 'side2']);
    git(['checkout', '-q', 'main']);
    git(['merge', '--no-commit', '--no-ff', 'side2'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const second = runHook('stale');
    check('a SECOND merge cannot defer on top of an outstanding deferral', second.code === 1);
    check('  …so the exemption stays one commit deep', /one commit deep/.test(second.out));
    // The invariant that keeps the abort below deterministic, asserted where it is
    // load-bearing rather than left to the accident that used to hold it (#9258).
    // Deliberately a state assertion and not a retry: if the stub is in the index,
    // `merge --abort` fails on a coin flip, so only the state is reportable — the
    // symptom is not. It covers every `git add` above, not just the one that broke.
    check('  …with the gate stub still OUT of the index, so `merge --abort` cannot trip on it',
      git(['ls-files', '--', 'package.json']).trim() === '');
    git(['merge', '--abort']);

    // The push is the other event that can follow a merge: it must not carry an
    // undischarged deferral off the machine.
    const push = runHook('stale', ['--pre-push']);
    check('`--pre-push` REFUSES an undischarged deferral', push.code === 1);
    const pushDefers = /DEFERRED to the next commit/.test(push.out);
    check('  …and never defers, whatever the merge state', !pushDefers);

    // Discharge: the artifacts come current, exactly as the regeneration commit makes them.
    const discharged = runHook('clean');
    check('regeneration DISCHARGES the deferral and clears the marker', discharged.code === 0);
    check('  …saying which of the two clearing paths ran', /discharged/.test(discharged.out));
    check('  …and the marker is gone, so nothing can get stuck', !existsSync(marker));

    // ── #15722, half 1: a gate that could not RUN is not a verdict ───────────
    // The marker is rewritten with the same path and no deferral record, so the
    // action below is `refuse-stale` — the ordinary pre-push refusal, the one the
    // card was filed against.
    writeFileSync(marker, `${pendingPath}\n`);
    const unloadable = runHook('unloadable', ['--pre-push']);
    check('a gate that cannot LOAD is PREREQUISITE NOT MET, not `stale`',
      unloadable.code === EXIT_PREREQUISITE_NOT_MET && /PREREQUISITE NOT MET/.test(unloadable.out));
    check('  …and never calls the artifact stale, which is the false claim',
      !/— stale/.test(unloadable.out) && /NOT MEASURED/.test(unloadable.out));
    check('  …carrying the load-bearing half: that nothing was measured',
      /Nothing was measured/.test(unloadable.out));
    check('  …naming the package node could not find, not the artifact',
      /os-regen-fixture-absent-pkg/.test(unloadable.out));
    check('  …and the marker still holds the debt — a refusal clears nothing',
      existsSync(marker) && readMarker(marker).paths.includes(pendingPath));

    const runnerMissing = runHook('runner-missing', ['--pre-push']);
    check('a gate whose RUNNER is not installed refuses the same way',
      runnerMissing.code === EXIT_PREREQUISITE_NOT_MET && !/— stale/.test(runnerMissing.out));
    check('  …naming the command the shell could not find',
      /os-regen-fixture-absent-runner/.test(runnerMissing.out));

    const gateRefused = runHook('gate-refused', ['--pre-push']);
    check('a gate that ALREADY refused with an unmet prerequisite is propagated, not relabelled',
      gateRefused.code === EXIT_PREREQUISITE_NOT_MET && !/— stale/.test(gateRefused.out));
    check('  …quoting the gate\'s own words rather than a second opinion',
      /the dependency yaml is not installed/.test(gateRefused.out));

    // THE CONTROL. Everything above must leave this reading untouched: a gate that
    // RAN and exited non-zero for its own reason is a finding about the artifact,
    // and it keeps today's verdict and today's exit code.
    const genuine = runHook('stale', ['--pre-push']);
    check('a gate that RAN and failed is still `stale`, exit 1 — the grading is not a blanket pass',
      genuine.code === 1 && /— stale/.test(genuine.out) && !/PREREQUISITE NOT MET/.test(genuine.out));

    // ── #15722, half 2 (WITHDRAWN, pinned): a fast-forward is not a merge ────
    // The card's second half read the refusal as a predicate over paths changed
    // between the previous and the new HEAD. Measured, it is not: the pending set
    // is the marker, and git runs no merge driver for a fast-forward, so nothing
    // is recorded. This pins the reading that withdrew that half — and it fails
    // against exactly the "fix" the card proposed, a predicate derived from a diff.
    rmSync(marker, { force: true });
    git(['checkout', '-qb', 'ff-behind', 'main~1']);
    git(['checkout', '-q', 'main']);
    mkdirSync(join(dir, 'packages/spec'), { recursive: true });
    write(pendingPath, 'upstream moved the generated artifact\n');
    git(['add', '-A']);
    git(['commit', '-qm', 'main regenerates the artifact']);
    git(['checkout', '-q', 'ff-behind']);
    const ff = git(['merge', '--ff-only', 'main']);
    const fastForwarded = /Fast-forward/.test(ff) && git(['rev-parse', 'HEAD']).trim() === git(['rev-parse', 'main']).trim();
    check('a --ff-only pull across a changed merge=os-regen artifact IS a fast-forward', fastForwarded);
    check('  …and writes no marker, so there is nothing pending', !existsSync(marker));
    const afterFf = runHook('stale', ['--pre-push']);
    check('  …so the push is ACCEPTED — a fast-forward is not a merge without a text merge',
      afterFf.code === 0 && afterFf.out.trim() === '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return results.every(Boolean);
}

/**
 * The pre-push hook must be executable **in the index**, not just on this disk —
 * git silently ignores a non-executable hook, printing at most an
 * `advice.ignoredHook` note nobody reads. `git-merge-regen.mjs --self-test`
 * already asserts this for `.githooks/pre-commit`; the assertion lives here for
 * its sibling because `check:merge-driver` runs both halves, so the coverage
 * lands in the same gate either way, and a disarmed pre-push means an
 * undischarged deferral leaves the machine in silence.
 */
function prePushIsArmedSelfTest() {
  registerCase('prePushIsArmedSelfTest');
  let mode = '';
  try {
    mode = execFileSync('git', ['ls-files', '-s', '.githooks/pre-push'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim().split(/\s+/)[0] ?? '';
  } catch (err) {
    console.log(`  ✗ could not stat .githooks/pre-push: ${err?.message ?? err}`);
    return false;
  }
  const ok = mode === '100755';
  console.log(
    ok
      ? '  ✓ .githooks/pre-push is executable in the index (100755)'
      : `  ✗ .githooks/pre-push is mode ${mode || '<untracked>'} in the index, not 100755.\n`
        + '      Git IGNORES a non-executable hook — the deferral would never be collected.\n'
        + '      Fix: git update-index --chmod=+x .githooks/pre-push',
  );
  return ok;
}

/** The five `decide` cases, including the ones a fixture cannot reach. */
function decisionTableSelfTest() {
  registerCase('decisionTableSelfTest');
  const cases = [
    [{ blocked: 0, merging: null, deferral: null }, 'clear'],
    [{ blocked: 0, merging: null, deferral: { head: 'a' } }, 'discharged'],
    [{ blocked: 2, merging: { head: 'a' }, deferral: null }, 'defer'],
    [{ blocked: 2, merging: { head: 'a' }, deferral: { head: 'b' } }, 'refuse-second-deferral'],
    [{ blocked: 2, merging: null, deferral: { head: 'b' } }, 'refuse-undischarged'],
    [{ blocked: 2, merging: null, deferral: null }, 'refuse-stale'],
    // `--pre-push`: deferring is off, so a merge in progress cannot buy a pass.
    [{ blocked: 2, merging: { head: 'a' }, deferral: null, allowDefer: false }, 'refuse-stale'],
    [{ blocked: 2, merging: { head: 'a' }, deferral: { head: 'b' }, allowDefer: false }, 'refuse-second-deferral'],
  ];
  let ok = true;
  for (const [input, expected] of cases) {
    const got = decide(input);
    if (got !== expected) ok = false;
    console.log(
      `  ${got === expected ? '✓' : '✗'} blocked=${input.blocked} merging=${input.merging ? 'y' : 'n'} `
        + `deferral=${input.deferral ? 'y' : 'n'} allowDefer=${input.allowDefer !== false ? 'y' : 'n'} → ${got}`
        + (got === expected ? '' : ` (expected ${expected})`),
    );
  }
  return ok;
}

if (invokedDirectly) {
  if (process.argv.includes('--self-test')) {
    // Touches no repo state: the interesting logic is the staleness rules, and
    // their dangerous direction is "says fresh when stale".
    //
    // STOP -- these TWO assertions are written INLINE here rather than inside a
    // named callee, so they are outside SELF_TEST_BATTERIES and the floor below
    // cannot see them stop running (ruled Q1 = A on #13799). The gap, and why
    // labelling or hoisting them is not this card's business, is stated at the
    // roster declaration above.
    const noDist = distIsStale(join(REPO_ROOT, 'scripts')) === true;
    console.log(`${noDist ? '✓' : '✗'} a directory with no dist/ reads as STALE (conservative default)`);
    const noTree = schemaTreeIsStale(join(REPO_ROOT, 'scripts')) === true;
    console.log(`${noTree ? '✓' : '✗'} a directory with no json-schema/ reads as STALE (conservative default)`);

    // The three callees as a literal LIST rather than three bare calls, so the
    // names this block invokes are data the floor below can cross-check the
    // roster against, in both directions. The names are read off the function
    // declarations themselves (`fn.name`), so a renamed callee moves this list
    // with it and cannot drift from the roster in silence. Each entry carries
    // the section banner that already sat immediately above its call, so what is
    // printed is byte-identical to the three banner + `const ... = callee()`
    // pairs this replaces.
    //
    // EVALUATION ORDER AND COMPLETENESS ARE UNCHANGED, on the red path too. The
    // original invoked all three eagerly -- one `const` per callee, executed
    // unconditionally -- and only THEN reduced the five booleans with `&&`, so
    // the short-circuit was always over VALUES, never over calls. `.map()` runs
    // the same three in the same order: nothing that used to run stops, and
    // nothing that used to be skipped now runs.
    const callees = [
      ['\ndeferred-merge collection point:', prePushIsArmedSelfTest],
      ['\ndeferred-merge decision table:', decisionTableSelfTest],
      ['\ndeferred-merge sequence, replayed on a throwaway repo:', fixtureSelfTest],
    ];
    const results = callees.map(([banner, run]) => {
      console.log(banner);
      return run();
    });

    // -- The assertion floor, at the verdict site --
    // There is no verdict site inside a self-test body here, because there is no
    // self-test body: this dispatch IS the verdict site, and the reduction below
    // is the verdict. So the floor is evaluated here, after every callee has had
    // its chance and immediately before the success line -- the only place a run
    // in which a callee never ran can still be stopped from reporting that the
    // self-test passed. It sits inside the `--self-test` branch, so the
    // production path (`main()`, which `pre-commit` and `pre-push` spawn) never
    // reads the ledger.
    const floorBreaches = batteryFloorFailures(callees.map(([, run]) => run.name));
    for (const breach of floorBreaches) console.error(`✗ self-test floor: ${breach}`);

    // The verdict is an explicit BRANCH rather than a ternary over
    // `process.exit`, so the failure path literally IS a `process.exit(1)`.
    // That is what `measure-self-test-floor.mjs` reads as a floor that PRODUCES
    // A FAILURE rather than one that merely names a roster: this file's previous
    // `process.exit(ok ? 0 : 1)` classified NONE on that instrument even with a
    // sound floor above it. The success line's text is unchanged.
    const failures = [noDist, noTree, ...results].filter((ok) => !ok).length + floorBreaches.length;
    if (failures > 0) {
      console.log(`\n✗ self-test failed -- ${failures} failure(s) (cases and floor).`);
      process.exit(1);
    }
    console.log('\n✓ check-regen-pending self-test passed.');
    process.exit(0);
  }
  process.exit(main({ prePush: process.argv.includes('--pre-push') }));
}
