#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check:dev-prereqs — confirm the workspace is BUILT before `pnpm dev` boots it.
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
 *   - STILL LIVE. Hand-building the failing package prints 20+ TS errors that
 *     read exactly like real contract drift and are pure artefact of a stale
 *     `packages/spec/dist` (#5726 keeps that transcript as a vaccine).
 *
 * A 30-second build was packaged as an investigation. `dev` is the first local
 * entry point, so the cheapest place to answer it is here, before boot.
 *
 * WHAT IT CHECKS (criterion: declared = enforced)
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
 * WHAT IT DELIBERATELY DOES NOT CHECK
 *   - Staleness. Existence only. Comparing src/ mtimes against dist/ would fire
 *     on every fresh `git worktree add` (checkout rewrites source mtimes), i.e.
 *     a false red for everyone, which is how gates get ignored. A dist that
 *     exists but is stale is still #5726's other half; AGENTS.md §9 is the
 *     standing remedy (`pnpm install --frozen-lockfile && pnpm build` after a
 *     merge) and is not something a cheap probe can see.
 *
 *     That gap has a consequence this gate must not paper over: a green line here
 *     is reassurance, and on a STALE dist it is reassurance in the wrong
 *     direction — the developer has just been told the workspace is fine, so the
 *     fake drift that follows reads even more like a real bug. Hence the pass
 *     message says "artifacts present", never "the workspace is fine", and the
 *     gap is filed as #5864 rather than left implicit here.
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
 * CI IS UNAFFECTED. This is wired into the root `dev` / `dev:*` scripts only —
 * never into a workflow. CI builds before it runs anything that could trip
 * this, so the condition cannot occur there; #5726 and #5217 are both
 * local/worktree-only shapes.
 *
 * No env escape hatch, deliberately (check:console-sha has none either). To
 * boot a deliberately half-built workspace, call the underlying command
 * directly: `pnpm --filter @objectstack/example-showcase dev`.
 *
 * Usage:
 *   node scripts/check-dev-prereqs.mjs             # gate the workspace
 *   node scripts/check-dev-prereqs.mjs --self-test # prove it can go both ways
 *   pnpm check:dev-prereqs                         # self-test, then gate
 *
 * WHY THE `dev` CHAIN CALLS THIS WITH `node` AND NOT `pnpm check:dev-prereqs`
 *   A pnpm script hop costs ~0.7s before any of our code runs (measured on this
 *   repo: `pnpm check:console-sha` 0.74s total for ~0.04s of work). A guard whose
 *   entire value is being cheap should not spend that on the hot path, so the
 *   `dev` / `dev:*` chains invoke this file directly (~0.06s, no self-test) while
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
 *   0  built (or nothing declares a dist entry point — nothing to verify)
 *   1  not built; or the workspace layout could not be read (a gate that
 *      cannot enumerate members must fail loudly, not pass vacuously — #4690)
 */
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

/**
 * The verdict, as data: which declared build artifacts are absent, and which
 * single command fixes it. Split from the printing so --self-test can drive it.
 */
function inspect(root) {
  const missing = [];
  let checked = 0;

  for (const dir of workspaceDirs(root)) {
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

  // A workspace with no dependencies installed cannot run `pnpm build` at all
  // (turbo is not there), so the one-line fix has to include the install.
  const installed = existsSync(path.join(root, 'node_modules'));
  return { checked, missing, fix: installed ? 'pnpm build' : 'pnpm install && pnpm build' };
}

function report(verdict) {
  const { checked, missing, fix } = verdict;
  if (missing.length === 0) {
    console.log(`✓ ${checked} package build artifacts present (existence, not freshness).`);
    return 0;
  }

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

/**
 * --self-test — a gate only ever observed green is indistinguishable from a gate
 * that matches nothing (#4690). These fixtures drive `inspect` to both verdicts
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
  const fixture = (name, { members = ['packages/*'], installed = false } = {}) => {
    const rootDir = path.join(tmp, name);
    mkdirSync(rootDir, { recursive: true });
    writeFileSync(path.join(rootDir, 'pnpm-workspace.yaml'), `packages:\n${members.map((m) => `  - ${m}\n`).join('')}\nonlyBuiltDependencies:\n  - esbuild\n`);
    if (installed) mkdirSync(path.join(rootDir, 'node_modules'), { recursive: true });
    return rootDir;
  };

  try {
    // 1. Built workspace → green, and the count reflects what was inspected.
    const built = fixture('built', { installed: true });
    write(built, 'packages/a/package.json', JSON.stringify({ name: '@f/a', exports: { '.': { types: './dist/index.d.mts', default: './dist/index.mjs' } } }));
    write(built, 'packages/a/dist/index.mjs', 'export {};');
    write(built, 'packages/b/package.json', JSON.stringify({ name: '@f/b', main: 'dist/index.js' }));
    write(built, 'packages/b/dist/index.js', 'module.exports = {};');
    let v = inspect(built);
    expect('built/missing', v.missing.length, 0);
    expect('built/checked', v.checked, 2);
    expect('built/fix', v.fix, 'pnpm build');

    // 2. Unbuilt package → red, named, with the plain build fix.
    const unbuilt = fixture('unbuilt', { installed: true });
    write(unbuilt, 'packages/a/package.json', JSON.stringify({ name: '@f/a', exports: { '.': './dist/index.mjs' } }));
    write(unbuilt, 'packages/b/package.json', JSON.stringify({ name: '@f/b', main: 'dist/index.js' }));
    write(unbuilt, 'packages/b/dist/index.js', 'module.exports = {};');
    v = inspect(unbuilt);
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
    const green = capture(() => report(inspect(built)));
    expect('built/exit-code', green.code, 0);
    expect('built/one-line', green.text.trim().split('\n').length, 1);

    // 3. Dependencies absent → the one-line fix has to install first.
    const fresh = fixture('fresh');
    write(fresh, 'packages/a/package.json', JSON.stringify({ name: '@f/a', main: 'dist/index.js' }));
    expect('fresh/fix', inspect(fresh).fix, 'pnpm install && pnpm build');

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
    v = inspect(excluded);
    expect('excluded/checked', v.checked, 0);
    expect('excluded/missing', v.missing.length, 0);

    // 5. Nested and literal member patterns both expand.
    const nested = fixture('nested', { members: ['packages/plugins/*', 'packages/spec'], installed: true });
    write(nested, 'packages/plugins/driver-sql/package.json', JSON.stringify({ name: '@f/driver-sql', main: 'dist/index.js' }));
    write(nested, 'packages/spec/package.json', JSON.stringify({ name: '@f/spec', main: 'dist/index.js' }));
    v = inspect(nested);
    expect('nested/checked', v.checked, 2);
    expect('nested/missing', v.missing.length, 2);

    // 6. A member pattern this gate cannot expand must fail loudly, never
    //    silently cover fewer packages.
    const opaque = fixture('opaque', { members: ['packages/**'], installed: true });
    let threw = '';
    try {
      inspect(opaque);
    } catch (err) {
      threw = err instanceof CoverageError ? 'CoverageError' : 'other';
    }
    expect('opaque/throws', threw, 'CoverageError');

    // 7. No pnpm-workspace.yaml at all → same loud failure.
    const rootless = path.join(tmp, 'rootless');
    mkdirSync(rootless, { recursive: true });
    threw = '';
    try {
      inspect(rootless);
    } catch (err) {
      threw = err instanceof CoverageError ? 'CoverageError' : 'other';
    }
    expect('rootless/throws', threw, 'CoverageError');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\n✗ check:dev-prereqs --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`    ${f}`);
    console.error('');
    return 1;
  }
  console.log('✓ check:dev-prereqs --self-test — both verdicts reachable, exclusions pinned (7 cases).');
  return 0;
}

if (process.argv.includes('--self-test')) {
  process.exit(selfTest());
}

try {
  process.exit(report(inspect(ROOT)));
} catch (err) {
  if (err instanceof CoverageError) {
    console.error(`\n✗ check:dev-prereqs cannot enumerate the workspace, so it cannot vouch for the build.\n\n  ${err.message}\n`);
    process.exit(1);
  }
  throw err;
}
