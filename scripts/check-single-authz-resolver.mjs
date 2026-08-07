#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Guards the single source of truth for request authorization resolution
// (`resolveAuthzContext`, @objectstack/core). Prevents the two regressions that
// motivated the extraction:
//   1. A NEW request-context resolver copy. The original bug: the REST server
//      kept its own resolver that drifted from the dispatcher's and silently
//      dropped `sys_user_role`, so custom-role grants didn't apply over REST.
//   2. An entry point that stops delegating to the shared resolver.
//
// Heuristic for (1): a non-test source file that references BOTH `sys_user_role`
// and `sys_user_permission_set` is doing request-context role+permission
// aggregation — the resolver's job — and must be the canonical module (or an
// explicitly allow-listed non-resolver, e.g. seed definitions).
//
//   node scripts/check-single-authz-resolver.mjs
//   node scripts/check-single-authz-resolver.mjs --self-test
//
// ## Dead scan roots are a hard error (#4930)
//
// Check (1) is a *scan*: it concludes "no duplicate resolver exists" from having
// read every TypeScript source under SCAN_ROOTS. `walk()` used to open with
// `try { entries = readdirSync(dir); } catch { return out; }`, so a root that was
// renamed, moved or made unreadable produced zero files — and zero files produce
// zero errors, which is character-for-character the same verdict as a clean
// workspace. The scan cannot tell you it never ran; only its (unprinted) file
// count could, and nobody reads a count that is not printed.
//
// A whole-`packages/` rename also happens to be caught downstream, because both
// DELEGATORS live under that same root and check (2) reports them missing. That
// is luck, not coverage, and it misdirects the diagnosis: the operator is told
// two files are missing when the actual event is that the duplicate-resolver
// scan read nothing at all. Move either delegator out of `packages/`, or add a
// second scan root, and that downstream crutch goes silent — the #4916 shape,
// one refactor away. So the roots are resolved up front and a dead one fails the
// gate BY NAME, before any conclusion is drawn from the scan.
//
// Deliberately no whitelist and no `optional: true` marker. `packages/` is a
// git-tracked directory with tracked files; no checkout that can run
// `pnpm check:authz-resolver` at the repo root is legitimately missing it. An
// optional marker "just in case" is a supported way to silence this failure
// instead of fixing the rename — the empty `catch {}` again, spelled politely.
// Should a root ever become legitimately absent, that is a decision to record
// with its condition and a test, not a check to relax.
//
// ## An empty scan is a hard error too (#5916)
//
// Resolving the roots is only half of it, and the half above cannot see the other:
// a root that resolves, is readable, and simply yields NO file leaves the check
// iterating an empty corpus and reporting zero errors — "no duplicate resolver
// exists", concluded from nothing. `assertRootsResolvable` is satisfied the whole
// time; the directory is right there. The corpus is what left: a subtree migrated
// out of `packages/`, sources renamed to an extension `walk` does not collect, or
// the walk filter narrowed. Nothing in the output distinguishes that from clean.
//
// So each declared root must also YIELD at least one file. The floor is computed
// by this very walk — "every root in SCAN_ROOTS > 0 files" — deliberately NOT a
// recorded high-water mark: a ratchet would need maintaining on every legitimate
// move, and the failure it buys (a corpus that shrank but is not empty) is not the
// one that turns this gate vacuous. Same shape as `check-doc-authoring.mjs`, which
// closed this exact gap for the docs corpus (#4932); #4690 is where "an extraction
// that finds nothing must be red" was first written down.
//
// The floor is per-root and never a total: with more than one root, a single
// populated one would otherwise cover for every evaporated sibling — which is the
// silent narrowing this assertion exists to stop.
//
// ## The extension filter is a family, not a suffix string (#6070)
//
// The failure above names its own successor — "sources renamed to an extension `walk`
// does not collect" — and that case was already live on the day #5916 landed. The
// collector tested `e.endsWith('.ts')`, and `'x.mts'.endsWith('.ts')` is **false** (the
// character before `ts` is `m`, not `.`), so every `.mts` / `.cts` source under
// `packages/` — twelve of them, all build/liveness scripts under `packages/spec/scripts/` —
// stayed out of the corpus, and check (1)'s "no duplicate resolver exists" was concluded
// from a set that structurally excluded them.
//
// Neither corpus assertion above can see this, by construction. `packages/` resolves,
// and it yields well over a thousand `.ts` files — far above a per-root floor of one —
// while every `.mts` under it is invisible. A floor answers "did this root produce
// anything"; it can never answer "did it produce everything the root declares".
//
// So the filter is an extension FAMILY (`SCANNED_EXT` / `EXCLUDED_EXT`), not a suffix
// string, and the exclusions move with it in the same step — widening only the collector
// would re-plant the same bug one level down, with `x.test.mts` scannable while
// `x.test.ts` is not. None of the twelve files trips check (1)'s heuristic, so the wider
// corpus changes no verdict today; what changes is that the verdict is now drawn from
// what the gate says it reads.

import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ROOT = process.cwd();
const CANONICAL = 'packages/core/src/security/resolve-authz-context.ts';

// Files allowed to reference both role tables WITHOUT being a request resolver.
const ALLOW = new Set([
  CANONICAL,
  // Seed/definition of the default permission sets + role bindings — not a resolver.
  'packages/plugins/plugin-security/src/objects/default-permission-sets.ts',
]);

// Entry points that MUST delegate to the shared resolver (never re-inline it).
const DELEGATORS = [
  'packages/rest/src/rest-server.ts',
  'packages/runtime/src/security/resolve-execution-context.ts',
];

// Every directory check (1) claims to have read. Relative to the repo root.
const SCAN_ROOTS = ['packages'];

const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__']);

/**
 * The extension family check (1) reads, and the two shapes excluded from it.
 *
 * Two regexes, deliberately paired and deliberately parallel. `SCANNED_EXT` replaces an
 * `e.endsWith('.ts')` that silently skipped `.mts` / `.cts` (see the header, #6070);
 * `EXCLUDED_EXT` carries the SAME family through the test/declaration exclusions, so the
 * widening cannot leave them one extension behind. The repo has no `.test.mts` or `.d.cts`
 * today — the shapes are excluded anyway, because the exclusion states what a test or
 * declaration file IS, not an inventory of the ones that happen to exist.
 */
const SCANNED_EXT = /\.[mc]?ts$/;
const EXCLUDED_EXT = /\.(?:test|d)\.[mc]?ts$/;

/** A declared scan root that could not be resolved to a directory. Carries the names. */
class DeadRootError extends Error {
  constructor(dead) {
    super(`unresolvable scan root(s): ${dead.map((d) => `${d.root} — ${d.reason}`).join('; ')}`);
    this.name = 'DeadRootError';
    this.dead = dead;
    /** @type {string[]} just the root names, for callers that only need to point. */
    this.roots = dead.map((d) => d.root);
  }
}

/**
 * Resolve every declared scan root before reading anything; throw naming the ones
 * that are not directories. See the header for why there is no optional-root flag.
 *
 * @throws {DeadRootError}
 */
function assertRootsResolvable(root = ROOT, roots = SCAN_ROOTS) {
  const dead = [];
  for (const rel of roots) {
    let st = null;
    try {
      st = statSync(join(root, rel));
    } catch (err) {
      dead.push({
        root: rel,
        reason: err?.code === 'ENOENT' ? 'does not exist' : `cannot be read (${err?.code ?? err})`,
      });
      continue;
    }
    if (!st.isDirectory()) dead.push({ root: rel, reason: 'exists but is not a directory' });
  }
  if (dead.length) throw new DeadRootError(dead);
}

/**
 * Every non-test TypeScript source under `dir`, recursively — `.ts`, `.mts` and `.cts`
 * alike (`SCANNED_EXT`), minus the test and declaration shapes of each (`EXCLUDED_EXT`).
 *
 * Nothing here is wrapped in a catch: an unresolvable root fails loudly above, and
 * an error *inside* the walk (a vanished file, a permission fault) means the corpus
 * was only partly read — which must not be reported as "no duplicate resolver".
 */
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (SCANNED_EXT.test(e) && !EXCLUDED_EXT.test(e)) out.push(p);
  }
  return out;
}

/**
 * A declared scan root that resolved to a directory and yielded no file to scan.
 * Carries the names, and the total the run would otherwise have reasoned over.
 */
class EmptyRootError extends Error {
  constructor(empty, total) {
    super(`scan root(s) contributed no scannable TypeScript file: ${empty.join(', ')} (total scanned: ${total})`);
    this.name = 'EmptyRootError';
    /** @type {string[]} the roots that yielded nothing. */
    this.roots = empty;
    /** @type {number} files found across all roots — 0 when the whole scan evaporated. */
    this.total = total;
  }
}

/**
 * The corpus check (1) reasons over.
 *
 * Each declared root must resolve AND yield at least one file: a root that resolves
 * but holds nothing is the same evaporation as one that does not resolve, minus the
 * ENOENT that made the first kind detectable (#5916). See the header for why the
 * floor is computed here rather than recorded as a high-water mark.
 *
 * @throws {DeadRootError} a declared root is not a directory.
 * @throws {EmptyRootError} a declared root resolved but contributed no file.
 */
function collectScanFiles(root = ROOT, roots = SCAN_ROOTS) {
  assertRootsResolvable(root, roots);
  const out = [];
  const empty = [];
  for (const rel of roots) {
    const before = out.length;
    walk(join(root, rel), out);
    if (out.length === before) empty.push(rel);
  }
  if (empty.length) throw new EmptyRootError(empty, out.length);
  return out;
}

/**
 * Both invariants over `root`. Throws {@link DeadRootError} / {@link EmptyRootError}
 * rather than returning a verdict when the scan could not read what it claims to
 * have read.
 */
function audit(root = ROOT) {
  const errors = [];

  // (1) No duplicate request-context resolver.
  for (const abs of collectScanFiles(root)) {
    const rel = abs.slice(root.length + 1);
    if (ALLOW.has(rel)) continue;
    const src = readFileSync(abs, 'utf8');
    if (src.includes('sys_user_role') && src.includes('sys_user_permission_set')) {
      errors.push(
        `Possible duplicate authorization resolver: ${rel}\n` +
        `  references BOTH sys_user_role and sys_user_permission_set. Request-context\n` +
        `  role/permission resolution must live ONLY in ${CANONICAL} (resolveAuthzContext),\n` +
        `  shared by every transport. If this file needs both for a non-resolution reason,\n` +
        `  add it to ALLOW in scripts/check-single-authz-resolver.mjs.`,
      );
    }
  }

  // (2) Entry points still delegate to the shared resolver.
  for (const rel of DELEGATORS) {
    let src;
    try { src = readFileSync(join(root, rel), 'utf8'); } catch { errors.push(`Delegator missing: ${rel}`); continue; }
    if (!src.includes('resolveAuthzContext')) {
      errors.push(
        `${rel} no longer delegates to resolveAuthzContext.\n` +
        `  Every HTTP entry point must resolve authorization via the shared\n` +
        `  @objectstack/core resolver — do not re-inline session/role/permission reads.`,
      );
    }
  }

  return errors;
}

function reportDeadRoots(err) {
  console.error('\n✗ check:authz-resolver: declared scan root(s) do not resolve, so the duplicate-resolver\n' +
    '  scan would have concluded "none found" from zero files:\n');
  for (const d of err.dead) console.error(`  ${d.root} — ${d.reason}`);
  console.error(
    `\nEvery entry in SCAN_ROOTS (scripts/check-single-authz-resolver.mjs) must be a directory in` +
    `\nthe checkout, and this check runs from the repo root. If a directory was renamed or moved,` +
    `\nupdate SCAN_ROOTS to follow it; if it was deleted, remove the entry deliberately. Do NOT` +
    `\nrestore a tolerant skip: this used to be \`catch { return out; }\`, and a dead root simply` +
    `\nmade the scan read zero files while the gate kept printing green (#4930).\n`,
  );
}

function reportEmptyRoots(err) {
  console.error('\n✗ check:authz-resolver: declared scan root(s) resolved but contributed no file, so the\n' +
    '  duplicate-resolver scan would have concluded "none found" from a corpus it never read:\n');
  for (const r of err.roots) console.error(`  ${r} — 0 files`);
  console.error(
    `\n${err.total} file(s) were found in total across all of SCAN_ROOTS.` +
    `\n\nEvery entry in SCAN_ROOTS (scripts/check-single-authz-resolver.mjs) must yield at least one` +
    `\nscannable .ts/.mts/.cts file. The root still being a directory is not enough — that is all #4930's` +
    `\ncheck can see. If the sources moved to a new directory, point SCAN_ROOTS at it; if the walk` +
    `\nfilter no longer matches them (a new extension, a widened SKIP_DIRS), fix the filter. Do NOT` +
    `\nlower this to a total count: one populated root would then cover for every evaporated one,` +
    `\nwhich is the silent narrowing this assertion exists to stop (#5916).\n`,
  );
}

// ── Self-test ───────────────────────────────────────────────────────────────
//
// A guard that cannot fail is not a guard. Both invariants are driven over a real
// temporary tree with the real walker, and both corpus failures are proved in both
// directions — red when a root is renamed away, red when a root that still resolves
// yields nothing, green when each is restored.

function selfTest() {
  const failures = [];
  const expect = (label, got, want) => {
    if (got !== want) failures.push(`  ✗ ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };

  const dir = mkdtempSync(join(tmpdir(), 'check-authz-resolver-selftest-'));
  const write = (rel, body) => {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  };
  try {
    // A tree that mirrors the real one: the canonical resolver, an allow-listed
    // seed, two delegating entry points, and one innocent file.
    write(CANONICAL, "sys_user_role sys_user_permission_set\n");
    write('packages/plugins/plugin-security/src/objects/default-permission-sets.ts',
      "sys_user_role sys_user_permission_set\n");
    for (const d of DELEGATORS) write(d, "import { resolveAuthzContext } from '@objectstack/core';\n");
    write('packages/core/src/unrelated.ts', 'export const x = 1;\n');

    expect('a compliant tree passes', audit(dir).length, 0);

    // (1) — a second file reading both role tables is a duplicate resolver.
    write('packages/rest/src/my-own-resolver.ts', "sys_user_role sys_user_permission_set\n");
    const dupErrors = audit(dir);
    expect('a duplicate resolver is flagged', dupErrors.length, 1);
    expect('the duplicate is named',
      dupErrors[0]?.startsWith('Possible duplicate authorization resolver: packages/rest/src/my-own-resolver.ts'), true);
    rmSync(join(dir, 'packages/rest/src/my-own-resolver.ts'));

    // (1) — the walker must not report test/type files or skipped directories.
    write('packages/rest/src/__tests__/fake.ts', "sys_user_role sys_user_permission_set\n");
    write('packages/rest/src/x.test.ts', "sys_user_role sys_user_permission_set\n");
    // `.d.ts` was named in this assertion's label from the start but never written, so
    // the exclusion it claims to cover was never exercised. Added with the .mts/.cts
    // pass below, which extends that same exclusion to the rest of the family (#6070).
    write('packages/rest/src/x.d.ts', "sys_user_role sys_user_permission_set\n");
    write('packages/rest/dist/x.ts', "sys_user_role sys_user_permission_set\n");
    expect('tests, .d.ts and dist/ are out of scope', audit(dir).length, 0);

    // (1) — `.mts` / `.cts` are the same corpus (#6070). `'x.mts'.endsWith('.ts')` is
    // false, so the suffix-string collector walked past every module-extension source
    // under a root it claims to read in full. Pinned in BOTH directions, because either
    // one alone is satisfiable by a filter that collects nothing:
    //   * the corpus must GROW by exactly the collectable fixtures — a count a
    //     regressed filter cannot reach;
    //   * and the duplicates written in them must be CAUGHT AND NAMED — a verdict an
    //     empty corpus produces zero of, which is what made the original miss silent.
    const beforeExt = collectScanFiles(dir).length;
    write('packages/rest/src/esm-resolver.mts', "sys_user_role sys_user_permission_set\n");
    write('packages/rest/src/cjs-resolver.cts', "sys_user_role sys_user_permission_set\n");
    // The exclusions carry the same family: changing a test's or a declaration's
    // extension must not make it scannable. The repo has none of these four shapes
    // today — that is exactly why they are asserted here rather than trusted.
    for (const excluded of ['x.test.mts', 'x.test.cts', 'x.d.mts', 'x.d.cts']) {
      write(`packages/rest/src/${excluded}`, "sys_user_role sys_user_permission_set\n");
    }
    expect('.mts/.cts join the corpus and their test/declaration shapes stay out',
      collectScanFiles(dir).length, beforeExt + 2);
    const extErrors = audit(dir);
    expect('a duplicate resolver in .mts and one in .cts are both flagged', extErrors.length, 2);
    expect('the .mts duplicate is named', extErrors.some((e) =>
      e.startsWith('Possible duplicate authorization resolver: packages/rest/src/esm-resolver.mts')), true);
    expect('the .cts duplicate is named', extErrors.some((e) =>
      e.startsWith('Possible duplicate authorization resolver: packages/rest/src/cjs-resolver.cts')), true);
    for (const f of ['esm-resolver.mts', 'cjs-resolver.cts', 'x.test.mts', 'x.test.cts', 'x.d.mts', 'x.d.cts']) {
      rmSync(join(dir, 'packages/rest/src', f));
    }
    expect('removing the module-extension fixtures restores the green', audit(dir).length, 0);
    expect('...and restores the corpus to its previous size', collectScanFiles(dir).length, beforeExt);

    // (2) — an entry point that stops delegating.
    write(DELEGATORS[0], '// re-inlined the session/role reads here\n');
    const delErrors = audit(dir);
    expect('a non-delegating entry point is flagged', delErrors.length, 1);
    expect('the entry point is named', delErrors[0]?.startsWith(`${DELEGATORS[0]} no longer delegates`), true);
    write(DELEGATORS[0], "import { resolveAuthzContext } from '@objectstack/core';\n");
    expect('restoring the delegation clears it', audit(dir).length, 0);

    // --- Reverse proof for the dead-root hard error (#4930), made permanent. ---
    // Everything above ran green over a tree whose scan root resolves. That
    // observation is worth nothing on its own: the defect being fixed here is a
    // scan that concludes "clean" *because* it could not open its root. So break
    // the root the way a rename breaks it in the real repo, require red, require
    // the red to name the root, then restore it and require green again.
    // Red-then-green, in the same run, every run.
    const renamed = join(dir, 'packages-renamed-by-self-test');
    renameSync(join(dir, 'packages'), renamed);
    let deadErr = null;
    try { audit(dir); } catch (err) { deadErr = err; }
    expect('a renamed scan root throws instead of quietly scanning nothing',
      deadErr instanceof DeadRootError, true);
    expect('the failure names the dead root', deadErr?.roots?.join(',') ?? '<none>', 'packages');
    expect('the failure says why', deadErr?.dead?.[0]?.reason ?? '<none>', 'does not exist');

    // A root that exists but is not a directory is dead in the same way: the old
    // `catch { return out; }` swallowed its ENOTDIR exactly as it swallowed ENOENT.
    writeFileSync(join(dir, 'packages'), 'not a directory');
    let notDirErr = null;
    try { audit(dir); } catch (err) { notDirErr = err; }
    expect('a scan root that is a file is dead too',
      notDirErr?.dead?.[0]?.reason ?? '<none>', 'exists but is not a directory');

    rmSync(join(dir, 'packages'));
    renameSync(renamed, join(dir, 'packages'));

    // An entry the walk cannot stat INSIDE the root is the same defect one level
    // in: `catch { continue; }` used to drop it and carry on, so the scan reached
    // a "no duplicate resolver" verdict over files it never opened. A dangling
    // symlink is that case, deterministically.
    symlinkSync(join(dir, 'no-such-target'), join(dir, 'packages', 'dangling'));
    let partialErr = null;
    try { audit(dir); } catch (err) { partialErr = err; }
    expect('an entry the walk cannot stat is an error, not a smaller corpus', partialErr?.code, 'ENOENT');
    rmSync(join(dir, 'packages', 'dangling'));

    // ...and restoring the tree restores the green, so the reds above were caused
    // by the broken root and nothing else.
    expect('restoring the root makes the audit green again', audit(dir).length, 0);

    // --- Reverse proof for the empty-scan hard error (#5916), same discipline. ---
    // The direction was decided before it was run: a root that resolves and yields
    // nothing must be RED, and the red must name that root only. This is the case
    // #4930's assertion cannot reach — nothing is renamed, nothing is unreadable,
    // the directory is right there; the corpus is simply not in it any more.
    const baseline = collectScanFiles(dir).length;
    expect('the compliant tree yields a corpus to reason over', baseline > 0, true);

    // SCAN_ROOTS holds a single entry today, so "only that root is named" has to be
    // driven over an injected two-root list — the parameter `collectScanFiles` already
    // takes. Adding a second REAL scan root to prove a self-test point would be a
    // change to what the gate scans, which is not this assertion's business.
    const twoRoots = ['packages', 'tools'];
    mkdirSync(join(dir, 'tools'), { recursive: true });
    writeFileSync(join(dir, 'tools', 'notes.md'), 'sources moved to tools/src-new/\n');
    let oneEmptyErr = null;
    try { collectScanFiles(dir, twoRoots); } catch (err) { oneEmptyErr = err; }
    expect('a root that resolves but yields nothing is red', oneEmptyErr instanceof EmptyRootError, true);
    expect('the failure names the empty root', oneEmptyErr?.roots?.join(',') ?? '<none>', 'tools');
    expect('the failure does not blame the populated root',
      /packages/.test(oneEmptyErr?.roots?.join(',') ?? ''), false);
    // The populated root was still walked, so the total proves the run was not simply
    // aborted — and that a per-root floor is not a total floor.
    expect('the failure reports what the run did find', oneEmptyErr?.total ?? -1, baseline);

    write('tools/helper.ts', 'export const noop = () => {};\n');
    expect('one file under the empty root restores the green',
      collectScanFiles(dir, twoRoots).length, baseline + 1);
    rmSync(join(dir, 'tools'), { recursive: true, force: true });

    // ...and the extreme the issue named: every declared root resolves, the whole
    // scan finds nothing, and check (1) drew "no duplicate resolver" from zero files.
    // `audit` must surface THAT, not the downstream "Delegator missing" pair it used
    // to report — the misdiagnosis the header calls luck rather than coverage.
    const bare = mkdtempSync(join(tmpdir(), 'check-authz-resolver-selftest-empty-'));
    let allEmptyErr = null;
    let bareErrors = null;
    try {
      for (const rel of SCAN_ROOTS) mkdirSync(join(bare, rel), { recursive: true });
      try { bareErrors = audit(bare); } catch (err) { allEmptyErr = err; }
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
    expect('a scan that finds nothing at all is red, not a vacuous "no duplicates"',
      allEmptyErr instanceof EmptyRootError, true);
    expect('every empty root is named', allEmptyErr?.roots?.join(',') ?? '<none>', SCAN_ROOTS.join(','));
    expect('the zero total is reported', allEmptyErr?.total ?? -1, 0);
    expect('the empty scan is reported instead of a misleading delegator verdict', bareErrors, null);

    // Restoring the tree restores the green one last time, so every red above was
    // caused by the missing corpus and nothing else.
    expect('the untouched tree is still green', audit(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\n✗ check-single-authz-resolver self-test failed:\n${failures.join('\n')}\n`);
    process.exit(1);
  }
  console.log(
    '✓ check-single-authz-resolver self-test: duplicate detection, delegation, the extension ' +
    'family (.mts/.cts enter the corpus and their duplicates are named; .test./.d. shapes of ' +
    'every extension stay out), the dead-root hard error (red when the scan root is renamed, ' +
    'green when restored) and the empty-scan hard error (red when one declared root yields ' +
    'nothing and when the whole scan does, green when restored) all hold.',
  );
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  let errors;
  try {
    errors = audit();
  } catch (err) {
    if (err instanceof DeadRootError) {
      reportDeadRoots(err);
      process.exit(1);
      return;
    }
    if (err instanceof EmptyRootError) {
      reportEmptyRoots(err);
      process.exit(1);
      return;
    }
    throw err;
  }

  if (errors.length) {
    console.error('✗ check:authz-resolver failed:\n\n' + errors.join('\n\n') + '\n');
    process.exit(1);
  }
  console.log('✓ check:authz-resolver: single shared authorization resolver intact; both entry points delegate.');
}

main();
