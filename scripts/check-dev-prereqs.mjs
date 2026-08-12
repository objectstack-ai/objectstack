#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

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
 *     - A HAND-EDITED dist. The hash covers inputs, not outputs. Nothing here
 *       can see someone editing `dist/index.mjs` directly, and nothing should
 *       have to.
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
 *                                                  # for the package in cwd
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
 *      cannot enumerate members must fail loudly, not pass vacuously — #4690)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'url';

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

/** Where a build records the hash of the inputs it was built from. */
const STAMP_BASENAME = '.build-input-hash';

/** What an amplifier's build script must contain for its stamp to be maintained. */
const STAMP_INVOCATION = 'check-dev-prereqs.mjs --stamp';

/** Per-package build configuration that changes the output without being under src/. */
const PACKAGE_BUILD_CONFIG = ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'tsup.config.ts', 'tsdown.config.ts'];

/** Thrown for conditions that must fail the gate rather than shrink its coverage. */
class CoverageError extends Error {}

/**
 * Workspace member directories, from pnpm-workspace.yaml — the workspace's own
 * declaration of what it contains. Only `<dir>/*` and literal paths are
 * understood; anything else throws instead of silently covering less.
 */
function workspaceDirs(root) {
  const file = path.join(root, 'pnpm-workspace.yaml');
  if (!existsSync(file)) throw new CoverageError(`${rel(root, file)} is missing — cannot enumerate workspace packages.`);

  const lines = readFileSync(file, 'utf-8').split('\n');
  const start = lines.findIndex((l) => /^packages:\s*$/.test(l));
  if (start === -1) throw new CoverageError(`pnpm-workspace.yaml has no 'packages:' list — cannot enumerate workspace packages.`);

  const patterns = [];
  for (const line of lines.slice(start + 1)) {
    const item = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (!item) {
      if (/^\S/.test(line)) break; // next top-level key ends the list
      continue; // blank line or comment inside the list
    }
    patterns.push(item[1].replace(/^['"]|['"]$/g, ''));
  }

  const dirs = [];
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) continue; // exclusion: nothing to enumerate
    if (pattern.includes('**') || pattern.slice(0, -2).includes('*')) {
      throw new CoverageError(
        `pnpm-workspace.yaml pattern '${pattern}' is not a shape this gate can expand.\n` +
          `  Teach scripts/check-dev-prereqs.mjs the new pattern shape — silently covering fewer\n` +
          `  packages would make this gate pass vacuously.`,
      );
    }
    if (!pattern.endsWith('/*')) {
      dirs.push(path.join(root, pattern));
      continue;
    }
    const parent = path.join(root, pattern.slice(0, -2));
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules') dirs.push(path.join(parent, entry.name));
    }
  }
  return dirs;
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
const rel = (root, p) => path.relative(root, p) || '.';
const posixRel = (root, p) => rel(root, p).split(path.sep).join('/');

/**
 * Global build inputs, read from turbo.json's own `globalDependencies` rather
 * than restated here: the build's declaration of what invalidates every package
 * is the freshness definition's too, and a new entry there is covered without
 * anyone remembering this file. Only literal paths are understood — a glob would
 * silently hash fewer inputs, so it throws.
 */
function globalBuildInputs(root) {
  const file = path.join(root, 'turbo.json');
  if (!existsSync(file)) throw new CoverageError(`turbo.json is missing — cannot determine the build's global inputs, so freshness cannot be judged.`);
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    throw new CoverageError(`turbo.json is not readable as JSON (${err.message}) — cannot determine the build's global inputs.`);
  }
  const declared = cfg.globalDependencies ?? [];
  if (!Array.isArray(declared)) throw new CoverageError(`turbo.json 'globalDependencies' is not an array — cannot determine the build's global inputs.`);
  return declared.map((entry) => {
    if (typeof entry !== 'string' || entry.includes('*') || entry.startsWith('$')) {
      throw new CoverageError(
        `turbo.json globalDependencies entry ${JSON.stringify(entry)} is not a shape this gate can hash.\n` +
          `  Teach scripts/check-dev-prereqs.mjs the new shape — hashing fewer inputs than the build\n` +
          `  reads would make the freshness verdict pass vacuously.`,
      );
    }
    return path.join(root, entry);
  });
}

/** Every file under `dir`, sorted, node_modules excluded. */
function filesUnder(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(p, out);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

/**
 * sha256 over a package's build inputs — the freshness definition, in one place,
 * used by BOTH `--stamp` (at build time) and the gate (at boot time). They must
 * be the same function or the comparison means nothing, which is why the stamper
 * lives in this file rather than in a script of its own.
 *
 * Framing is length-prefixed (`<path>:<bytes>` then the bytes), so no separator
 * can be forged by a file's contents and no control character is needed to
 * delimit records.
 */
function buildInputHash(root, pkgDir) {
  const src = path.join(pkgDir, 'src');
  if (!existsSync(src)) {
    throw new CoverageError(`${posixRel(root, pkgDir)}/src does not exist, so there is nothing to hash — this gate cannot vouch for its dist.`);
  }
  const inputs = [...filesUnder(src)];
  for (const name of PACKAGE_BUILD_CONFIG) inputs.push(path.join(pkgDir, name));
  inputs.push(...globalBuildInputs(root));

  const seen = new Set();
  const records = [];
  for (const file of inputs) {
    const key = posixRel(root, file);
    if (seen.has(key)) continue;
    seen.add(key);
    records.push([key, file]);
  }
  records.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const hash = createHash('sha256');
  for (const [key, file] of records) {
    // An ABSENT input is hashed as absent rather than skipped: creating a
    // tsconfig where there was none changes how the package builds, so it has
    // to change the hash.
    if (!existsSync(file)) {
      hash.update(`${key}:absent\n`);
      continue;
    }
    const bytes = readFileSync(file);
    hash.update(`${key}:${bytes.length}\n`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

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
    if (!buildScript.includes(STAMP_INVOCATION)) {
      throw new CoverageError(
        `${relDir} is a declared amplifier but its build script no longer ends with '${STAMP_INVOCATION}'.\n` +
          `  Nothing would write ${relDir}/dist/${STAMP_BASENAME}, so this check would pass on any dist,\n` +
          `  however old. Restore the stamp step, or drop ${relDir} from AMPLIFIERS on purpose.`,
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
  const hash = buildInputHash(root, dir);
  writeFileSync(path.join(dist, STAMP_BASENAME), `${hash}\n`);
  console.log(`✓ ${relDir}/dist/${STAMP_BASENAME} ← ${hash.slice(0, 16)}…`);
  return 0;
}

/**
 * --self-test — a gate only ever observed green is indistinguishable from a gate
 * that matches nothing (#4690). These fixtures drive `inspect` to every verdict
 * and pin the exclusions that keep it from printing a red whose fix is wrong.
 */
function selfTest() {
  const failures = [];
  const expect = (label, actual, wanted) => {
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

  try {
    // 1. Built workspace → green, and the count reflects what was inspected.
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
    const fresh = fixture('fresh');
    write(fresh, 'packages/a/package.json', JSON.stringify({ name: '@f/a', main: 'dist/index.js' }));
    expect('fresh/fix', inspect(fresh, []).fix, 'pnpm install && pnpm build');

    // 4. Exclusions: a package is only judged on an entry point under dist/.
    //    Pins the three shapes that must NEVER produce a red here, because
    //    `pnpm build` is not their fix: @objectstack/console (dist built by
    //    build-console.sh; declares no entry but package.json), @objectstack/docs
    //    (no entry point, filtered out of `pnpm build`), and the examples
    //    (entry is a .ts source file). See header.
    const excluded = fixture('excluded', { installed: true });
    write(excluded, 'packages/console/package.json', JSON.stringify({ name: '@f/console', exports: { './package.json': './package.json' }, files: ['dist'] }));
    write(excluded, 'packages/docs/package.json', JSON.stringify({ name: '@f/docs', scripts: { build: 'next build' } }));
    write(excluded, 'packages/example/package.json', JSON.stringify({ name: '@f/example', main: './objectstack.config.ts', exports: { '.': './objectstack.config.ts' } }));
    v = inspect(excluded, []);
    expect('excluded/checked', v.checked, 0);
    expect('excluded/missing', v.missing.length, 0);

    // 5. Nested and literal member patterns both expand.
    const nested = fixture('nested', { members: ['packages/plugins/*', 'packages/spec'], installed: true });
    write(nested, 'packages/plugins/driver-sql/package.json', JSON.stringify({ name: '@f/driver-sql', main: 'dist/index.js' }));
    write(nested, 'packages/spec/package.json', JSON.stringify({ name: '@f/spec', main: 'dist/index.js' }));
    v = inspect(nested, []);
    expect('nested/checked', v.checked, 2);
    expect('nested/missing', v.missing.length, 2);

    // 6. A member pattern this gate cannot expand must fail loudly, never
    //    silently cover fewer packages.
    const opaque = fixture('opaque', { members: ['packages/**'], installed: true });
    expect('opaque/throws', threwCoverage(() => inspect(opaque, [])), 'CoverageError');

    // 7. No pnpm-workspace.yaml at all → same loud failure.
    const rootless = path.join(tmp, 'rootless');
    mkdirSync(rootless, { recursive: true });
    expect('rootless/throws', threwCoverage(() => inspect(rootless, [])), 'CoverageError');

    // ── FRESHNESS (#5864) ────────────────────────────────────────────────────

    // 8. Stamped by its own build → fresh, and the pass line says what it now
    //    vouches for AND what it still does not.
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
    const untouched = amplifierFixture('untouched');
    capture(() => stamp(untouched, path.join(untouched, 'packages/spec'), ['packages/spec']));
    const touched = path.join(untouched, 'packages/spec/src/index.ts');
    const future = new Date(Date.now() + 3_600_000);
    writeFileSync(touched, readFileSync(touched)); // rewrite: new mtime, same bytes
    utimesSync(touched, future, future);
    expect('mtime/still-fresh', inspect(untouched, ['packages/spec']).freshness[0]?.state, 'fresh');

    // 11. Absence of the freshness input is red, not a shrug (#4690): a dist
    //     built before this stamp existed is exactly #5726's tree.
    const unstamped = amplifierFixture('unstamped');
    v = inspect(unstamped, ['packages/spec']);
    expect('unstamped/state', v.freshness[0]?.state, 'unstamped');
    const unstampedRed = capture(() => report(v));
    expect('unstamped/exit-code', unstampedRed.code, 1);
    expect('unstamped/names-stamp', unstampedRed.text.includes(STAMP_BASENAME), true);
    expect('unstamped/one-fix', (unstampedRed.text.match(/pnpm build/g) || []).length, 1);

    // 12. A stamp that is not a sha256 (truncated, hand-written, half-flushed)
    //     is unverifiable, and unverifiable is red — never "close enough".
    const garbled = amplifierFixture('garbled');
    capture(() => stamp(garbled, path.join(garbled, 'packages/spec'), ['packages/spec']));
    write(garbled, 'packages/spec/dist/' + STAMP_BASENAME, 'not-a-hash\n');
    expect('garbled/state', inspect(garbled, ['packages/spec']).freshness[0]?.state, 'unstamped');

    // 13. Declared = enforced, in BOTH directions. An amplifier whose build
    //     script stopped stamping must fail loudly (otherwise this gate passes
    //     on any dist forever), and --stamp from an unlisted package must refuse
    //     (otherwise a stamp is written that nobody reads).
    const unstamping = amplifierFixture('unstamping', { build: 'tsup' });
    expect('drift/build-script-lost-stamp', threwCoverage(() => inspect(unstamping, ['packages/spec'])), 'CoverageError');
    expect('drift/stamp-refuses-unlisted', capture(() => stamp(stampedRoot, path.join(stampedRoot, 'packages/spec'), [])).code, 1);

    // 14. Every other way the freshness half can lose its subject is red too.
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
    const halfBuilt = amplifierFixture('half-built');
    capture(() => stamp(halfBuilt, path.join(halfBuilt, 'packages/spec'), ['packages/spec']));
    write(halfBuilt, 'packages/other/package.json', JSON.stringify({ name: '@f/other', main: 'dist/index.js' }));
    v = inspect(halfBuilt, ['packages/spec']);
    expect('precedence/missing', v.missing.length, 1);
    expect('precedence/freshness-not-consulted', v.freshness.length, 0);
    const halfRed = capture(() => report(v));
    expect('precedence/verdict-lines', halfRed.text.split('\n').filter((l) => l.startsWith('✗')).length, 1);
    expect('precedence/is-the-build-one', halfRed.text.includes('The workspace is not built'), true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\n✗ check:dev-prereqs --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`    ${f}`);
    console.error('');
    return 1;
  }
  console.log('✓ check:dev-prereqs --self-test — every verdict reachable, exclusions and freshness coverage pinned (16 cases).');
  return 0;
}

if (process.argv.includes('--self-test')) {
  process.exit(selfTest());
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
