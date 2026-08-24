#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * import-prerequisite — the ONE answer to "can this gate load the package it
 * imports?", for the gates that import a dependency instead of spawning the CLI.
 *
 *   node scripts/import-prerequisite.mjs --self-test
 *
 * ## The defect this exists to remove
 *
 * A fresh per-task worktree — the checkout shape `CLAUDE.md` mandates — has no
 * `node_modules` until `pnpm install` runs. Most gates in `scripts/` are
 * dependency-free by design and run fine there. The ones that import `typescript`,
 * `yaml`, `semver`, `eslint` or `github-slugger` do not, and they used to say so
 * with a node-internals stack trace:
 *
 *   node:internal/modules/package_json_reader:314
 *     throw new ERR_MODULE_NOT_FOUND(packageName, fileURLToPath(base), null);
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'yaml' imported from
 *     /home/user/objectstack-<task>/scripts/check-ci-filter-parity.mjs
 *   exit 1
 *
 * Exit 1 from an unmet prerequisite and exit 1 from a real finding are the same
 * reading. The expensive direction is not the lost minutes: a dev who assumes
 * "this needs an install" and moves on has recorded a gate as RUN when it never
 * executed a single assertion, and a seat that reads the stack as a verdict
 * reports a false RED against whatever landed most recently. Both were measured
 * in one shift — twenty-nine root gates die this way on a fresh worktree, and one
 * near-miss had a new repo-wide gate reported red on `main` when the real reading
 * was NOT MEASURED.
 *
 * ## Why the guard has to sit at the import, not in front of it
 *
 * `ERR_MODULE_NOT_FOUND` is thrown while node LINKS the module graph, which
 * completes for the whole graph before any module BODY runs. So a preflight
 * imported at the top of a gate — the obvious first design, and the one that
 * reads as correct — never executes: the link fails first and the stack trace is
 * unchanged. The failing import itself must become deferred (a dynamic `import()`
 * the gate hands over as a thunk), which is the one shape that puts a catchable
 * boundary around it.
 *
 * The thunk is written in the CALLER, deliberately. Resolution is relative to the
 * importing module, and these gates live in two trees with different installed
 * closures (`scripts/` and `packages/lint/scripts/`). A helper that did
 * `await import(specifier)` itself would answer about ITS OWN directory, which is
 * how a correctly-installed package gets reported missing — the confident wrong
 * diagnosis `cli-build-prerequisite.mjs` refuses one file over.
 *
 * ## Unbuilt is not broken, and neither is a missing sub-dependency
 *
 * A probe that reports "not installed" for anything that throws would replace one
 * misleading verdict with another. Three failures reach this module wearing the
 * same `ERR_MODULE_NOT_FOUND` code, and they have three different remedies:
 *
 *   • the package has no directory at all            → `pnpm install`
 *   • a `@objectstack/*` package is there but its
 *     entry point is not on disk                     → build that package
 *   • the package loaded and something IT imports
 *     was missing                                    → a broken/partial install
 *
 * and a fourth arrives with a different code entirely — the package resolved and
 * its own body threw (a SyntaxError, a failed top-level call). That one is a real
 * defect in an installed dependency, this module has no standing to prescribe for
 * it, and it is RETHROWN untouched so the stack survives.
 *
 * Following `cli-build-prerequisite.mjs`: the FRAME is shared, the claim about
 * what went unmeasured stays with the gate. Only the gate knows what it did not
 * check, and "nothing was measured" is the load-bearing half of the message.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKSPACE_SCOPE, workspaceBuildFix } from './cli-build-prerequisite.mjs';
import { isEntrypoint } from './invoked-as.mjs';

/** `pnpm install` at the repo root — the one remedy for an absent dependency. */
export const INSTALL_FIX = 'pnpm install';

/**
 * The package a bare specifier names, subpath removed: `yaml/util` -> `yaml`,
 * `@objectstack/spec/system` -> `@objectstack/spec`. Returns '' for a relative or
 * absolute specifier, which this module never classifies.
 */
export function packageNameOf(specifier) {
  const s = String(specifier ?? '');
  if (!s || s.startsWith('.') || s.startsWith('/') || s.startsWith('node:')) return '';
  const parts = s.split('/');
  return s.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Walk `node_modules` upward from a directory, exactly as node's resolver does,
 * and return the first directory that holds the package — or '' when none does.
 *
 * Filesystem rather than `import.meta.resolve`, for two reasons. It answers about
 * the CALLER's directory (the resolver API resolves from whoever calls it), and
 * it separates "no directory" from "directory present, entry point missing" —
 * the distinction the whole classification below turns on, which any resolve()
 * collapses into one throw.
 */
export function findPackageDir(pkg, fromDir) {
  if (!pkg) return '';
  let dir = resolve(fromDir);
  for (;;) {
    const candidate = join(dir, 'node_modules', ...pkg.split('/'));
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    // SELF-REFERENCE, and it is not an edge case here: a package's own gates
    // import the package by NAME, and node resolves that through the nearest
    // enclosing package.json rather than through `node_modules` — so no link
    // exists to find. Missing this branch made `packages/lint`'s own gate report
    // "`@objectstack/lint` is not installed — run pnpm install" on a tree where
    // it was installed and merely unbuilt: the confident wrong diagnosis, with
    // the wrong remedy, which is the defect this module exists to end.
    if (isSelfReference(dir, pkg)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return '';
    dir = parent;
  }
}

/**
 * Is `dir` itself the package `pkg`, as node's self-reference resolution asks?
 * Node requires the enclosing package.json to declare BOTH a matching `name` and
 * an `exports` field — without `exports` the specifier does not resolve at all,
 * and answering yes there would invent a package that node cannot reach.
 */
function isSelfReference(dir, pkg) {
  const manifestPath = join(dir, 'package.json');
  if (!existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return manifest?.name === pkg && Boolean(manifest?.exports);
  } catch {
    return false;
  }
}

/**
 * Does an installed package have the entry point its own package.json declares?
 *
 * Deliberately shallow: it reads the DEFAULT entry (`exports` root, else `main`,
 * else `index.js`) and asks whether that file is on disk. It is not a resolver
 * and must not become one — a workspace package that has never been built is
 * missing its whole `dist/`, so the default entry is absent whenever any entry
 * is, and a conditional-exports walk would add failure modes to a probe whose
 * only job is to avoid inventing a diagnosis.
 *
 * `{ unknown }` when the declaration cannot be read or names nothing this can
 * check — the caller then keeps the verdict it had, never a guess.
 */
export function entryPointOnDisk(pkgDir) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  } catch (e) {
    return { unknown: `could not read ${join(pkgDir, 'package.json')} (${e.message})` };
  }
  const target = defaultEntryTarget(manifest);
  if (!target) return { unknown: 'package.json declares no default entry point' };
  const file = join(pkgDir, target.replace(/^\.\//, ''));
  let present = false;
  try {
    present = statSync(file).isFile();
  } catch {
    present = false;
  }
  return { file, present };
}

/** The first string a package.json's default entry declaration bottoms out in. */
function defaultEntryTarget(manifest) {
  const seen = new Set();
  const pick = (node) => {
    if (typeof node === 'string') return node;
    if (!node || typeof node !== 'object' || seen.has(node)) return '';
    seen.add(node);
    // Condition order mirrors what node picks for an ESM import of the package
    // root; `default` last, as the spec requires it to be written.
    for (const key of ['node', 'import', 'require', 'default', '.']) {
      if (key in node) {
        const hit = pick(node[key]);
        if (hit) return hit;
      }
    }
    return '';
  };
  const fromExports = pick(manifest?.exports);
  return fromExports || (typeof manifest?.main === 'string' ? manifest.main : '') || '';
}

/** Is a package present with the entry point its own manifest declares? */
function isWholePackage(pkg, fromDir) {
  const dir = findPackageDir(pkg, fromDir);
  return Boolean(dir) && entryPointOnDisk(dir).present === true;
}

/**
 * The package node says it could not find, read out of its own error text.
 *
 * node writes the specifier it failed on, which is a PACKAGE for a bare import
 * (`Cannot find package 'yaml' imported from …`) and an absolute PATH when a
 * package's own entry point is gone (`Cannot find module '/…/packages/lint/dist/
 * index.mjs'`). Only the first names a package directly; the second is reduced by
 * the caller through `findPackageDir`, so this returns '' for it rather than
 * guessing a name out of a path.
 */
export function missingPackageFromMessage(message) {
  const m = String(message ?? '').match(/Cannot find package '([^']+)'/);
  return m ? packageNameOf(m[1]) : '';
}

/**
 * Which of the four failures happened — pure, so `--self-test` can pin every
 * branch without an uninstalled tree to run on.
 *
 * @param {string} specifier the package the gate asked for
 * @param {unknown} err what the deferred import threw
 * @param {string} fromDir the importing gate's directory
 * @returns {{ kind: 'not-installed'|'workspace-unbuilt'|'dependency-missing'|'broken',
 *             pkg: string, headline: string, detail: string[], fix: string }}
 */
export function classifyImportFailure(specifier, err, fromDir) {
  const requested = packageNameOf(specifier);
  const code = err && typeof err === 'object' ? err.code : '';
  const message = err && typeof err === 'object' ? String(err.message ?? '') : String(err);

  // A code other than the resolver's two means the package RESOLVED and then
  // failed. Not this module's story to tell.
  if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
    return { kind: 'broken', pkg: requested, headline: '', detail: [], fix: '' };
  }

  // What node could not find is not always what the gate asked for. A gate that
  // imports a LOCAL module (`../eslint.config.mjs`) fails on a package that
  // module reached for, and a gate that imports a present package can fail on
  // one of ITS dependencies. Classify the package that is actually absent —
  // naming the requested specifier instead would prescribe installing something
  // already installed, the confident wrong diagnosis this family refuses.
  const named = missingPackageFromMessage(message);
  const pkg = named || requested;
  const reachedThrough = pkg && requested !== pkg ? specifier : '';

  if (!pkg) {
    // Nothing nameable: a relative specifier whose failure text this module does
    // not recognise. Defer rather than invent one.
    return { kind: 'broken', pkg: '', headline: '', detail: [], fix: '' };
  }

  const pkgDir = findPackageDir(pkg, fromDir);

  if (!pkgDir) {
    // The gate asked for a bare package that IS present and whole, and the miss
    // came from inside it: `pnpm install` ran but left the store incomplete.
    // A different fact from an uninstalled tree, so it keeps its own verdict.
    const viaWholePackage = reachedThrough && requested && isWholePackage(requested, fromDir);
    if (viaWholePackage) {
      return {
        kind: 'dependency-missing',
        pkg,
        headline: `\`${requested}\` is installed, but \`${pkg}\` — which it imports — is not`,
        detail: [
          `This gate imports \`${specifier}\`. That package is present and its entry point is`,
          `on disk, so it is not the missing piece. node reported:`,
          ``,
          `  ${message.split('\n')[0]}`,
          ``,
          `That is a broken or partial install rather than an uninstalled tree.`,
        ],
        fix: INSTALL_FIX,
      };
    }
    return {
      kind: 'not-installed',
      pkg,
      headline: `the dependency \`${pkg}\` is not installed`,
      detail: [
        ...(reachedThrough
          ? [
              `This gate imports \`${reachedThrough}\`, which reaches for \`${pkg}\` — and no`,
              `\`node_modules/${pkg}\` exists on the resolution path from ${fromDir}.`,
            ]
          : [
              `This gate imports \`${specifier}\`, and no \`node_modules/${pkg}\` exists on the`,
              `resolution path from ${fromDir}.`,
            ]),
        ``,
        `A fresh worktree has no \`node_modules\` until \`pnpm install\` runs. Most gates in`,
        `\`scripts/\` are dependency-free and run there unchanged; this one is not.`,
      ],
      fix: INSTALL_FIX,
    };
  }

  const entry = entryPointOnDisk(pkgDir);
  const isWorkspace = pkg.startsWith(`${WORKSPACE_SCOPE}/`);

  if (entry.present === false && isWorkspace) {
    return {
      kind: 'workspace-unbuilt',
      pkg,
      headline: `the workspace package \`${pkg}\` is not built`,
      detail: [
        `\`${pkg}\` resolves to this repo's own sources, but the entry point its`,
        `package.json declares is not on disk:`,
        ``,
        `  ${entry.file}`,
        ``,
        `Installing does not build it. This gate imports the package's COMPILED output,`,
        `so the source being present proves nothing.`,
      ],
      fix: workspaceBuildFix(pkg),
    };
  }

  if (entry.present === false) {
    return {
      kind: 'broken',
      pkg,
      headline: `the dependency \`${pkg}\` is installed but incomplete`,
      detail: [
        `\`${pkgDir}\` exists, but the entry point its package.json declares is missing:`,
        ``,
        `  ${entry.file}`,
        ``,
        `That is a broken or partial install, not an unbuilt tree.`,
      ],
      fix: INSTALL_FIX,
    };
  }

  // The package itself is present and whole, so the specifier that could not be
  // found is one IT reached for. Saying "install `yaml`" here would be the
  // confident wrong diagnosis; name what node actually said instead.
  return {
    kind: 'dependency-missing',
    pkg,
    headline: `\`${pkg}\` is installed, but something it imports is not`,
    detail: [
      `\`${pkgDir}\` is present and its entry point is on disk, so \`${pkg}\` itself is not`,
      `the missing piece. node reported:`,
      ``,
      `  ${message.split('\n')[0]}`,
      ``,
      `That is a broken or partial install rather than a missing dependency.`,
    ],
    fix: INSTALL_FIX,
  };
}

/**
 * Load a dependency, or refuse with a diagnosis and exit 1.
 *
 * Exits 1, the code every real verdict uses: any wrapper treating non-zero as
 * failure keeps behaving identically, and a second failure code would be a new
 * contract nobody asked for. The reading a caller MUST be able to make is not in
 * the code — it is in the printed text, which says nothing was measured.
 *
 * @param {string} specifier e.g. `'typescript'`
 * @param {() => Promise<any>} load `() => import('typescript')`, written in the CALLER
 * @param {string} importerUrl the caller's `import.meta.url`
 * @param {{ measures?: string }} [options] what the gate would have judged, in the
 *   gate's own words — the one half of the message that is never shared
 */
export async function requireDependency(specifier, load, importerUrl, options = {}) {
  try {
    return await load();
  } catch (err) {
    const fromDir = dirname(fileURLToPath(importerUrl));
    const verdict = classifyImportFailure(specifier, err, fromDir);
    if (verdict.kind === 'broken' && !verdict.headline) throw err;
    reportPrerequisiteNotMet(importerUrl, verdict, options.measures);
  }
}

/**
 * `requireDependency` for the DEFAULT export — the shape `import ts from
 * 'typescript'` had.
 *
 * Reads `.default` strictly rather than falling back to the namespace. Both
 * package kinds these gates import provide it: a real ESM default export lands
 * there, and node synthesises `default` = `module.exports` for the CJS ones
 * (`typescript`, `semver`, `eslint`). A `?? namespace` fallback would paper over
 * the one case worth seeing — a package that stopped having a default export —
 * by handing the caller an object that is not the one it asked for.
 */
export async function requireDefaultExport(specifier, load, importerUrl, options = {}) {
  const namespace = await requireDependency(specifier, load, importerUrl, options);
  return namespace.default;
}

/**
 * The shared frame, in `check-i18n-coverage.mjs`'s wording and order: what is
 * unmet, why, the command that clears it, and — load-bearing — that nothing was
 * measured, so the exit code says nothing about the gate's actual question.
 */
export function reportPrerequisiteNotMet(importerUrl, verdict, measures) {
  const gate = fileURLToPath(importerUrl).split('/').pop().replace(/\.mjs$/, '');
  const subject = measures ? `whether ${measures}` : `what it gates`;
  console.error(
    `\n${gate}: PREREQUISITE NOT MET — ${verdict.headline}\n\n` +
      verdict.detail.map((l) => (l ? `  ${l}` : '')).join('\n') +
      `\n\n  Fix:  ${verdict.fix}\n\n` +
      `  Nothing was measured: this gate exited before running a single check, so this\n` +
      `  result says NOTHING about ${subject}. It is NOT a finding, and it is not\n` +
      `  evidence that anything in the tree is wrong.\n` +
      `  (Exit code 1 — but piping this gate reports the PIPE's status, so\n` +
      `  \`node scripts/${gate}.mjs | tail -4\` reads green either way. Use \`echo "EXIT=$?"\`.)`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Self-test — a REAL node_modules tree, not a model of one
// ---------------------------------------------------------------------------

/**
 * The classification turns on facts about directories and files, so the fixture
 * builds them: an absent package, a workspace package whose `dist/` was never
 * produced, a third party missing its own entry, and a whole one. A model would
 * agree with an implementation that never touched the disk — and "reports not
 * built when the real problem is something else" is the failure this gate's
 * diagnosis is supposed to end, not reproduce one level down.
 */
export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok: Boolean(ok), detail });
  const MNF = (msg) => Object.assign(new Error(msg), { code: 'ERR_MODULE_NOT_FOUND' });

  // ── the specifier → package reduction ─────────────────────────────────────
  t('a bare specifier is its own package', packageNameOf('yaml') === 'yaml');
  t('a subpath is dropped', packageNameOf('yaml/util') === 'yaml');
  t('a scoped package keeps both segments', packageNameOf('@objectstack/spec') === '@objectstack/spec');
  t('a scoped subpath drops only the subpath', packageNameOf('@objectstack/spec/system') === '@objectstack/spec');
  t('a relative specifier names no package', packageNameOf('./ts-parse.mjs') === '');
  t('a node: builtin names no package', packageNameOf('node:fs') === '');

  const dir = mkdtempSync(join(tmpdir(), 'import-prereq-'));
  try {
    const nm = join(dir, 'node_modules');
    const mk = (rel, manifest, entryRel) => {
      const d = join(nm, ...rel.split('/'));
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'package.json'), JSON.stringify(manifest));
      if (entryRel) {
        mkdirSync(dirname(join(d, entryRel)), { recursive: true });
        writeFileSync(join(d, entryRel), '// built\n');
      }
      return d;
    };

    // A workspace package linked but never built: manifest present, dist absent.
    mk('@objectstack/unbuilt-fixture', { name: '@objectstack/unbuilt-fixture', exports: { '.': { import: './dist/index.mjs' } } });
    // A third party whose declared entry is missing — a partial install.
    mk('partial-fixture', { name: 'partial-fixture', main: 'index.js' });
    // A whole package, entry point on disk.
    mk('whole-fixture', { name: 'whole-fixture', main: 'index.js' }, 'index.js');
    // A workspace package that IS built — proves the scope alone does not decide.
    mk('@objectstack/built-fixture', { name: '@objectstack/built-fixture', exports: { '.': { import: './dist/index.mjs' } } }, 'dist/index.mjs');

    const at = (spec, msg) => classifyImportFailure(spec, MNF(msg ?? `Cannot find package '${spec}'`), dir);

    // ── branch 1: nothing there at all ──────────────────────────────────────
    const absent = at('totally-absent-fixture');
    t('an absent package is not-installed', absent.kind === 'not-installed', absent.kind);
    t('an absent package prescribes install', absent.fix === INSTALL_FIX, absent.fix);

    // ── branch 2: workspace package present, never built ────────────────────
    const unbuilt = at('@objectstack/unbuilt-fixture');
    t('a linked-but-unbuilt workspace package is workspace-unbuilt', unbuilt.kind === 'workspace-unbuilt', unbuilt.kind);
    t('an unbuilt workspace package prescribes a BUILD, never an install',
      unbuilt.fix === workspaceBuildFix('@objectstack/unbuilt-fixture') && unbuilt.fix !== INSTALL_FIX, unbuilt.fix);
    t('an unbuilt workspace package names the entry point it looked for',
      unbuilt.detail.some((l) => l.includes('dist/index.mjs')));
    // The distinction this whole module exists to keep: unbuilt ≠ not installed.
    t('unbuilt and not-installed are DIFFERENT verdicts', unbuilt.kind !== absent.kind && unbuilt.fix !== absent.fix);

    // ── branch 3: a subpath import of the same unbuilt package ──────────────
    const unbuiltSub = classifyImportFailure(
      '@objectstack/unbuilt-fixture/system',
      Object.assign(new Error('no exports main'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }),
      dir,
    );
    t('a subpath of an unbuilt workspace package classifies the same way', unbuiltSub.kind === 'workspace-unbuilt', unbuiltSub.kind);

    // ── branch 4: third party present but incomplete ────────────────────────
    const partial = at('partial-fixture');
    t('a third party missing its entry is broken, NOT unbuilt', partial.kind === 'broken', partial.kind);
    t('a broken install says so rather than blaming the tree',
      partial.headline.includes('installed but incomplete'), partial.headline);

    // ── branch 5: the package is whole, so the miss came from inside it ──────
    const inner = at('whole-fixture', "Cannot find package 'some-transitive-dep' imported from /x/whole-fixture/index.js");
    t('a whole package whose OWN import failed is dependency-missing', inner.kind === 'dependency-missing', inner.kind);
    t('dependency-missing quotes what node actually said',
      inner.detail.some((l) => l.includes('some-transitive-dep')));
    t('dependency-missing does NOT claim the imported package is absent',
      !inner.headline.includes('is not installed'), inner.headline);

    // ── branch 6: a built workspace package ─────────────────────────────────
    const built = at('@objectstack/built-fixture', "Cannot find package 'inner-dep'");
    t('a BUILT workspace package is never reported unbuilt', built.kind !== 'workspace-unbuilt', built.kind);

    // ── branch 7: resolved-then-threw is not ours ───────────────────────────
    const threw = classifyImportFailure('whole-fixture', new SyntaxError('Unexpected token'), dir);
    t('a package that resolved and threw is broken with no headline (rethrown)',
      threw.kind === 'broken' && threw.headline === '', `${threw.kind}/${threw.headline}`);

    // ── the entry-point probe's own deferrals ───────────────────────────────
    t('an unreadable manifest defers rather than guessing',
      'unknown' in entryPointOnDisk(join(dir, 'no-such-package')));
    const noEntry = mk('no-entry-fixture', { name: 'no-entry-fixture' });
    t('a manifest declaring no entry defers rather than guessing',
      'unknown' in entryPointOnDisk(noEntry));
    t('a package with no declared entry is NOT reported unbuilt',
      at('no-entry-fixture').kind !== 'workspace-unbuilt');

    // ── a LOCAL module that reaches for an absent package ───────────────────
    // The shape three ratchet gates have: they import '../eslint.config.mjs',
    // and that file imports '@typescript-eslint/parser'. Naming the local module
    // as "not installed" would be nonsense; naming the package is the diagnosis.
    const viaLocal = classifyImportFailure(
      '../eslint.config.mjs',
      MNF("Cannot find package '@typescript-eslint/parser' imported from /repo/eslint.config.mjs"),
      dir,
    );
    t('a local module reaching for an absent package names the PACKAGE',
      viaLocal.kind === 'not-installed' && viaLocal.pkg === '@typescript-eslint/parser',
      `${viaLocal.kind}/${viaLocal.pkg}`);
    t('a local module miss says which module reached for it',
      viaLocal.detail.some((l) => l.includes('../eslint.config.mjs') && l.includes('reaches for')));
    t('a local module is never itself called uninstalled',
      !viaLocal.headline.includes('eslint.config'), viaLocal.headline);

    // ── a local module whose failure text names nothing ─────────────────────
    const opaque = classifyImportFailure('../eslint.config.mjs', MNF('something else entirely'), dir);
    t('an unrecognisable local failure defers rather than inventing a package',
      opaque.kind === 'broken' && opaque.headline === '', `${opaque.kind}/${opaque.headline}`);

    // ── the message parser on its own ───────────────────────────────────────
    t('a package miss is read out of the message', missingPackageFromMessage("Cannot find package 'yaml' imported from /x") === 'yaml');
    t('a scoped package miss keeps its scope',
      missingPackageFromMessage("Cannot find package '@typescript-eslint/parser' imported from /x") === '@typescript-eslint/parser');
    t('a PATH miss names no package -- findPackageDir reduces those',
      missingPackageFromMessage("Cannot find module '/repo/packages/lint/dist/index.mjs' imported from /x") === '');

    // ── SELF-REFERENCE: a package's own gate importing it by name ──────────
    // `packages/lint/scripts/*.mjs` imports '@objectstack/lint'. There is no
    // node_modules link for that — node resolves it through the enclosing
    // package.json — so a node_modules-only walk reports it uninstalled.
    const selfPkgDir = join(dir, 'self-pkg');
    mkdirSync(join(selfPkgDir, 'scripts'), { recursive: true });
    writeFileSync(
      join(selfPkgDir, 'package.json'),
      JSON.stringify({ name: '@objectstack/self-fixture', exports: { '.': { import: './dist/index.js' } } }),
    );
    t('a package is found from inside itself, with no node_modules link',
      findPackageDir('@objectstack/self-fixture', join(selfPkgDir, 'scripts')) === selfPkgDir);
    const selfUnbuilt = classifyImportFailure(
      '@objectstack/self-fixture',
      MNF("Cannot find module '" + join(selfPkgDir, 'dist/index.js') + "'"),
      join(selfPkgDir, 'scripts'),
    );
    t('a package\'s own gate on an unbuilt tree reports NOT BUILT, not "not installed"',
      selfUnbuilt.kind === 'workspace-unbuilt', selfUnbuilt.kind);
    t('and prescribes a build rather than an install',
      selfUnbuilt.fix === workspaceBuildFix('@objectstack/self-fixture'), selfUnbuilt.fix);

    // A name match with no `exports` is NOT self-reference: node cannot resolve
    // the bare specifier at all, so claiming the directory would invent a package.
    const noExports = join(dir, 'no-exports-pkg');
    mkdirSync(join(noExports, 'scripts'), { recursive: true });
    writeFileSync(join(noExports, 'package.json'), JSON.stringify({ name: '@objectstack/no-exports', main: 'index.js' }));
    t('a name match WITHOUT exports is not a self-reference',
      findPackageDir('@objectstack/no-exports', join(noExports, 'scripts')) === '');

    // ── findPackageDir walks upward, as node does ───────────────────────────
    const deep = join(dir, 'a', 'b', 'c');
    mkdirSync(deep, { recursive: true });
    t('a nested importer finds a package hoisted above it',
      findPackageDir('whole-fixture', deep) === join(nm, 'whole-fixture'));
    t('a package that is nowhere on the path is not found',
      findPackageDir('totally-absent-fixture', deep) === '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ import-prerequisite self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ import-prerequisite self-test: ${cases.length} cases pass — not-installed, workspace-unbuilt, ` +
      `broken-install and dependency-missing stay distinct, and a resolved-then-threw package is rethrown.`,
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  console.log('usage: node scripts/import-prerequisite.mjs --self-test');
}
