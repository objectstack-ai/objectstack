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
// read every `.ts` under SCAN_ROOTS. `walk()` used to open with
// `try { entries = readdirSync(dir); } catch { return out; }`, so a root that was
// renamed, moved or made unreadable produced zero files — and zero files produce
// zero errors, which is character-for-character the same verdict as a clean
// workspace. The scan cannot tell you it never ran; only its (unprinted) file
// count could, and nobody reads a count that is not printed.
//
// Today a whole-`packages/` rename happens to be caught downstream, because both
// DELEGATORS live under that same root and check (2) reports them missing. That
// is luck, not coverage, and it misdirects the diagnosis: the operator is told
// two files are missing when the actual event is that the duplicate-resolver
// scan read nothing at all. Move either delegator out of `packages/`, or add a
// second scan root, and the vacuous scan goes fully silent — the #4916 shape,
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
 * Every non-test `.ts` file under `dir`, recursively.
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
    else if (e.endsWith('.ts') && !e.endsWith('.test.ts') && !e.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** The corpus check (1) reasons over. Throws {@link DeadRootError} if a root is dead. */
function collectScanFiles(root = ROOT, roots = SCAN_ROOTS) {
  assertRootsResolvable(root, roots);
  const out = [];
  for (const rel of roots) walk(join(root, rel), out);
  return out;
}

/**
 * Both invariants over `root`. Throws {@link DeadRootError} rather than returning a
 * verdict when the scan could not read what it claims to have read.
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

// ── Self-test ───────────────────────────────────────────────────────────────
//
// A guard that cannot fail is not a guard. Both invariants are driven over a real
// temporary tree with the real walker, and the dead-root failure is proved in both
// directions — red when a root is renamed away, green when it is restored.

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
    write('packages/rest/dist/x.ts', "sys_user_role sys_user_permission_set\n");
    expect('tests, .d.ts and dist/ are out of scope', audit(dir).length, 0);

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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\n✗ check-single-authz-resolver self-test failed:\n${failures.join('\n')}\n`);
    process.exit(1);
  }
  console.log(
    '✓ check-single-authz-resolver self-test: duplicate detection, delegation, and the dead-root ' +
    'hard error (red when the scan root is renamed, green when restored) all hold.',
  );
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  let errors;
  try {
    errors = audit();
  } catch (err) {
    if (!(err instanceof DeadRootError)) throw err;
    reportDeadRoots(err);
    process.exit(1);
    return;
  }

  if (errors.length) {
    console.error('✗ check:authz-resolver failed:\n\n' + errors.join('\n\n') + '\n');
    process.exit(1);
  }
  console.log('✓ check:authz-resolver: single shared authorization resolver intact; both entry points delegate.');
}

main();
