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
 * reading — which is why the guarded refusal below does NOT keep that number
 * (see `EXIT_PREREQUISITE_NOT_MET`). The expensive direction is not the lost
 * minutes: a dev who assumes
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
 *
 * ## The exit code is 3 — the class every sibling already answers these words with
 *
 * A refusal here exits `EXIT_PREREQUISITE_NOT_MET`, and the printed advisory
 * says the same number in the same stroke. That constant's comment carries the
 * argument, the five sites that had already written the contract, and the true
 * half of the counter-argument this replaced.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WORKSPACE_SCOPE, workspaceBuildFix } from './cli-build-prerequisite.mjs';
import { isEntrypoint } from './invoked-as.mjs';

/** `pnpm install` at the repo root — the one remedy for an absent dependency. */
export const INSTALL_FIX = 'pnpm install';

/**
 * The exit-code contract, NAMED rather than spelled inline at each site, so the
 * self-test pins the value each path actually returns instead of a comment
 * about it — `check-test-completeness.mjs`'s shape, and the one
 * `check-type-check-coverage.mjs` adopted in PR #13982.
 *
 * ## Why 3, when this frame argued for 1 until #13983
 *
 * Because 3 is what every OTHER gate in this repo means by these two words.
 * Measured on this tree, `PREREQUISITE NOT MET` is already exit 3 in five
 * places: `check-test-completeness.mjs` (`EXIT_PREREQUISITE_NOT_MET`, argued at
 * length in its header), `check-dual-build-cjs-loads.mjs` (`EXIT_PREREQ`),
 * `check-type-check-coverage.mjs`, and `pm/check-half-states.mjs` — whose
 * constant `pm/ci-failure.mjs` IMPORTS rather than re-picks. It is not only
 * declared: `half-state-patrol.yml` branches on the number (`exitCode === 3`)
 * to render "the runner could not reach the board" instead of "the sweep
 * failed", so a consumer that reads 3 by value already exists.
 *
 * ⚠️ The argument this replaces stood in this file, and half of it was right:
 * *"a second failure code would be a new contract nobody asked for"*.
 *
 *   • The half that HOLDS: nothing mechanical changes. Every consumer of the
 *     gates that import this frame treats any non-zero as failure — measured,
 *     not assumed: the `&&` chains in the root `package.json`, the bare `run:`
 *     steps in `lint.yml`/`ci.yml`, and `required-set-patrol.yml`, which
 *     branches on `== '0'` / `!= '0'` and nothing finer. ⛔ This change buys
 *     zero CI benefit today and must not be sold as if it did.
 *   • The half that does NOT: it is not a new contract. The contract was
 *     already written, by the five sites above. What this frame was doing was
 *     CONTRADICTING it from the largest inheritance surface in the repo — the
 *     closing paragraph of `prerequisiteNotMetText` is printed verbatim by 45
 *     importing gates. A reader (or a gate-reconciling agent) who learned "3
 *     means nothing was measured" from those five read all 45 backwards.
 *
 * ⛔ ONLY the prerequisite branch has a code of its own. A gate's real verdict
 * is still that gate's own exit 1, and this module never touches it. And the
 * refusal itself is unchanged: what a refusal SAYS, when it fires, and that it
 * fires at all were all correct already.
 */
export const EXIT_PREREQUISITE_NOT_MET = 3;

/**
 * A gate's real verdict — NOT this module's to produce. Named here for the one
 * thing the advisory has to do that the number alone cannot: say which code it
 * is distinct FROM.
 */
export const EXIT_FINDINGS = 1;

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
 * The repo root at or above a directory: the nearest ancestor holding
 * `pnpm-workspace.yaml`. '' when none does.
 *
 * ⚠️ The marker is the workspace manifest and NOT `.git`, which looks like the
 * more obvious choice and is wrong for the exact checkout shape `CLAUDE.md`
 * mandates. In a linked worktree — `git worktree add ../objectstack-<task>` —
 * `.git` is a FILE containing a `gitdir:` pointer, not a directory (measured
 * here: 70 bytes, ASCII). A walk testing `statSync('.git').isDirectory()`
 * therefore steps straight PAST the worktree root, finds nothing above it, and
 * reports no root at all — in the one tree every agent actually works in.
 * `existsSync` on `.git` would survive that, but the workspace manifest is the
 * marker this repo already publishes for "repo root" (AGENTS.md names
 * `findUp(existsSync(join(dir, 'pnpm-workspace.yaml')))` as the spelling), so
 * it is the one used here rather than a second convention.
 *
 * NEAREST wins, as node and pnpm resolve. The tree holds a second
 * `pnpm-workspace.yaml`, under `packages/create-objectstack/src/templates/blank/`
 * — a scaffold template, containing no gate and importing nothing, so no
 * importer resolves through it. A "highest wins" walk would be the riskier rule:
 * it can climb OUT of the repo when the checkout sits inside another workspace.
 */
export function repoRootFrom(dir) {
  let d = resolve(dir);
  for (;;) {
    if (existsSync(join(d, 'pnpm-workspace.yaml'))) return d;
    const parent = dirname(d);
    if (parent === d) return '';
    d = parent;
  }
}

/**
 * The importer spelled the way the reader can actually RUN it.
 *
 * The gate NAME is a basename and is correct as one (it is what the headline
 * says, and what the gate is called). The COMMAND is not a name, it is a path,
 * and interpolating the basename into a hard-coded `scripts/` directory was
 * right for the 42 importers under `scripts/**` and wrong for the three under
 * `packages/lint/scripts/**`: it printed `node scripts/check-doc-formula-
 * expressions.mjs`, which does not exist. Copy-pasting it answered
 * `Cannot find module` at exit 1 — so a banner whose whole purpose is to stop a
 * reader misreading an exit code handed them a THIRD failure, wearing a
 * finding's exit code, one level down from the defect this module removes.
 *
 * Falls back to the ABSOLUTE path when no root is found, never to the old
 * basename guess. An absolute path always runs; a relative path invented
 * against a root that was never located is the confident wrong answer this
 * module exists to refuse.
 *
 * Emitted with POSIX separators: the result is a shell command, not a path for
 * this process to open.
 */
export function importerCommandPath(importerUrl) {
  const file = fileURLToPath(importerUrl);
  const root = repoRootFrom(dirname(file));
  if (!root) return file;
  const rel = relative(root, file);
  // A path that climbs out of the root is not repo-relative in any useful
  // sense; print the absolute one rather than a `../..` chain.
  if (!rel || rel.startsWith('..')) return file;
  return rel.split(sep).join('/');
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
 * Load a dependency, or refuse with a diagnosis and exit
 * `EXIT_PREREQUISITE_NOT_MET`.
 *
 * The code and the printed advisory move together — a number changed without
 * the prose would leave 45 gates inheriting a FALSE advisory, which is worse
 * than either number consistently applied. Why 3, and what did not change, is
 * on the constant. The reading a caller MUST be able to make is still in the
 * printed text, which says nothing was measured; the code is what a reader who
 * sees only the number gets, and it now agrees with the text.
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
 *
 * ── The pipe-shape advisory, and why it says what it says ──────────────────
 *
 * Every importer of this module inherits the closing paragraph verbatim, so a
 * wrong claim there is wrong in every gate at once. Measured here 2026-08-31 on
 * node 22.22.2 / bash 5, one refusing gate plus constructed producers:
 *
 *   node scripts/check-test-completeness.mjs            -> 3   (no pipe)
 *   … 2>&1 | tail -4   $? = 0   ${PIPESTATUS[0]} = 3   pipefail -> 3
 *   … 2>&1 | head -1   $? = 0   ${PIPESTATUS[0]} = 3   pipefail -> 3
 *
 * So the false green is `$?` after ANY pipe — it is the LAST command's status,
 * and `head`/`tail` both essentially never fail. It is NOT a property of one
 * shape, and choosing a different shape does not repair it.
 *
 * ⚠️ `| head -N` does close the read end early and the producer DOES take EPIPE
 * — proven by a producer that prints what it caught — but node ignores SIGPIPE
 * and swallows the stdout write error, so the gate still reaches its own exit:
 * a producer instrumented to exit 7 reported `${PIPESTATUS[0]}` = 7 through
 * `| head -1`. ⛔ Do NOT write that `| head` turns `${PIPESTATUS[0]}`/`pipefail`
 * green; it does not, and an earlier draft of this advisory said so. What `head`
 * really costs is the VERDICT TEXT (truncated), and — for a producer that does
 * not ignore SIGPIPE, unlike node — a real code replaced by 141: `seq 1
 * 100000000 | head -1` reports `${PIPESTATUS[0]}` = 141. That is a false RED,
 * the opposite direction.
 *
 * `selfTest` pins the four load-bearing clauses below.
 */
export function reportPrerequisiteNotMet(importerUrl, verdict, measures) {
  console.error(prerequisiteNotMetText(importerUrl, verdict, measures));
  process.exit(EXIT_PREREQUISITE_NOT_MET);
}

/**
 * The text `reportPrerequisiteNotMet` prints, as a value — so the self-test can
 * assert on the advisory without spawning a process or stubbing `process.exit`.
 */
function prerequisiteNotMetText(importerUrl, verdict, measures) {
  const gate = fileURLToPath(importerUrl).split('/').pop().replace(/\.mjs$/, '');
  // The path to RUN and the name to CALL IT BY are two different strings, and
  // only the first moves. ⛔ The `/tmp/${gate}.log` sink below keeps the
  // BASENAME on purpose: a repo-relative path there would spell
  // `/tmp/packages/lint/scripts/….log`, whose parent directories do not exist,
  // so the redirect fails and the reader is handed a broken command again —
  // the same defect, relocated one token to the right.
  const command = importerCommandPath(importerUrl);
  const subject = measures ? `whether ${measures}` : `what it gates`;
  return (
    `\n${gate}: PREREQUISITE NOT MET — ${verdict.headline}\n\n` +
      verdict.detail.map((l) => (l ? `  ${l}` : '')).join('\n') +
      `\n\n  Fix:  ${verdict.fix}\n\n` +
      `  Nothing was measured: this gate exited before running a single check, so this\n` +
      `  result says NOTHING about ${subject}. It is NOT a finding, and it is not\n` +
      `  evidence that anything in the tree is wrong.\n` +
      `  (Exit code ${EXIT_PREREQUISITE_NOT_MET}, distinct from a finding's ${EXIT_FINDINGS} — capture it BEFORE any pipe:\n` +
      `  \`node ${command} > /tmp/${gate}.log 2>&1; echo "EXIT=$?"\`.\n` +
      `  Piped, \`$?\` is the LAST command's status, and \`head\`/\`tail\` essentially never fail — that\n` +
      `  is the false green, and no pipe shape repairs it. \`\${PIPESTATUS[0]}\`/\`pipefail\` do recover\n` +
      `  this gate's own code: \`| tail\` reads to EOF and forwards it, while \`| head -N\` closes the\n` +
      `  read end early — the gate takes EPIPE, its verdict text is TRUNCATED, and a producer that\n` +
      `  dies on SIGPIPE reports 141 rather than what it meant to say.)`
  );
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

    // ── the printed COMMAND: a path the reader can run, not a name ──────────
    //
    // A REAL tree again, for this module's standing reason: the derivation
    // turns on files being on disk, and a model would agree with an
    // implementation that never looked.
    //
    // The fixture is shaped like the checkout every agent actually works in —
    // a LINKED WORKTREE, whose `.git` is a FILE holding a `gitdir:` pointer.
    // That shape is the whole reason the marker is the workspace manifest, and
    // the negative control below is what turns that from a preference into a
    // measurement.
    const wt = join(dir, 'objectstack-issue-fixture');
    mkdirSync(join(wt, 'scripts'), { recursive: true });
    mkdirSync(join(wt, 'packages', 'lint', 'scripts'), { recursive: true });
    writeFileSync(join(wt, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    writeFileSync(join(wt, '.git'), `gitdir: ${join(dir, 'common', 'worktrees', 'wt')}\n`);

    const advisoryFor = (abs) =>
      prerequisiteNotMetText(pathToFileURL(abs).href, { headline: 'h', detail: ['d'], fix: 'f' }, undefined);
    const lintGate = join(wt, 'packages', 'lint', 'scripts', 'check-doc-formula-expressions.mjs');
    const rootGate = join(wt, 'scripts', 'check-ci-filter-parity.mjs');

    // (a) THE DEFECT, in both directions. The negative is the load-bearing
    // one: `node scripts/check-doc-formula-expressions.mjs` is the exact string
    // this card exists to stop printing, and it names a file that has never
    // existed.
    t('a packages/lint/scripts importer prints its REAL repo-relative path',
      advisoryFor(lintGate).includes('`node packages/lint/scripts/check-doc-formula-expressions.mjs > '),
      advisoryFor(lintGate));
    t('⛔ and NEVER the `scripts/` basename guess, which names no file on disk',
      !advisoryFor(lintGate).includes('node scripts/check-doc-formula-expressions.mjs'));

    // (b) The 42 importers under `scripts/**` inherit this line verbatim, so
    // the spelling is pinned WHOLE — command, log sink and the `echo` that
    // captures the code before any pipe.
    t('a scripts/** importer still prints `scripts/NAME.mjs`, spelling unchanged',
      advisoryFor(rootGate).includes(
        '`node scripts/check-ci-filter-parity.mjs > /tmp/check-ci-filter-parity.log 2>&1; echo "EXIT=$?"`'),
      advisoryFor(rootGate));

    // (c) The marker choice, as a paired measurement rather than an assertion.
    const gitIsDirectoryWalk = (from) => {
      let d = resolve(from);
      for (;;) {
        try {
          if (statSync(join(d, '.git')).isDirectory()) return d;
        } catch { /* absent here; keep walking */ }
        const parent = dirname(d);
        if (parent === d) return '';
        d = parent;
      }
    };
    t('the workspace-manifest walk finds the worktree root',
      repoRootFrom(join(wt, 'packages', 'lint', 'scripts')) === wt);
    t('NEGATIVE CONTROL: a `.git`-isDirectory walk finds NO root in a worktree shape',
      gitIsDirectoryWalk(join(wt, 'packages', 'lint', 'scripts')) === '' && statSync(join(wt, '.git')).isFile());

    // (d) No locatable root: absolute, which always runs. ⛔ Never a relative
    // path invented against a root that was never found.
    const orphanGate = join(dir, 'no-marker', 'scripts', 'check-orphan-fixture.mjs');
    mkdirSync(dirname(orphanGate), { recursive: true });
    t('an importer with no locatable root prints an ABSOLUTE path, always runnable',
      importerCommandPath(pathToFileURL(orphanGate).href) === orphanGate,
      importerCommandPath(pathToFileURL(orphanGate).href));
    t('⛔ and never a relative path invented against a root that was not found',
      !advisoryFor(orphanGate).includes('`node scripts/check-orphan-fixture.mjs'));

    // (e) Triage's explicit boundary on this card: the HEADLINE gate name is a
    // basename and is CORRECT as one. Only the command was wrong.
    t('the headline still names the gate by BASENAME, never by path',
      advisoryFor(lintGate).includes('\ncheck-doc-formula-expressions: PREREQUISITE NOT MET')
        && !advisoryFor(lintGate).includes('packages/lint/scripts/check-doc-formula-expressions: PREREQUISITE'),
      advisoryFor(lintGate));

    // (f) The log sink keeps the basename too — `/tmp/packages/lint/scripts/
    // ….log` names directories that do not exist, so a blanket substitution
    // would hand back a broken command one token to the right.
    t('the /tmp log sink keeps the BASENAME — a repo-relative one names absent directories',
      advisoryFor(lintGate).includes('> /tmp/check-doc-formula-expressions.log 2>&1')
        && !advisoryFor(lintGate).includes('/tmp/packages/lint'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // ── the inherited pipe-shape advisory ───────────────────────────────────
  // Pinned HERE and nowhere else, because this is the one copy 45 importers
  // print. The clauses are the four the advisory is for; the negative one is
  // the load-bearing one, since the wrong claim it excludes reads perfectly
  // plausible and shipped once already.
  const advisory = prerequisiteNotMetText(
    new URL('file:///repo/scripts/check-fixture-gate.mjs').href,
    { headline: 'h', detail: ['d'], fix: 'f' },
    undefined,
  );
  t('the advisory prescribes capturing the code BEFORE any pipe',
    advisory.includes('capture it BEFORE any pipe') && advisory.includes('> /tmp/check-fixture-gate.log 2>&1'),
    advisory);
  t('the advisory names the shape-independent false green: `$?` is the LAST command\'s status',
    advisory.includes("`$?` is the LAST command's status") && advisory.includes('no pipe shape repairs it'));
  t('the advisory keeps `| tail` as the shape that FORWARDS the true status',
    advisory.includes('`| tail` reads to EOF and forwards it'));
  t('the advisory names `| head -N` and the EPIPE mechanism, with its real cost',
    advisory.includes('`| head -N` closes the') && advisory.includes('EPIPE')
      && advisory.includes('TRUNCATED') && advisory.includes('141'));
  // ⛔ The claim this gate must never make again: measured 2026-08-31, `| head`
  // does NOT defeat `${PIPESTATUS[0]}`/`pipefail` — node ignores SIGPIPE and
  // reaches its own exit. See the mechanism note on `reportPrerequisiteNotMet`.
  t('the advisory does NOT claim a pipe shape defeats `${PIPESTATUS[0]}`/`pipefail`',
    !/turns even .*PIPESTATUS.*green|reads green either way/.test(advisory));

  // ── the exit-code CLASS, and the advisory that must move with it ──────────
  //
  // Pinned over the FUNCTION BODIES rather than over the constant alone —
  // PR #13982's shape, for the same reason it gave: the regression that costs
  // something is not a mistyped constant. It is a `process.exit(1)` written
  // back into the refusal by an author who never thought about exit codes, or a
  // number typed into the advisory instead of interpolated. Either leaves the
  // constant reading 3, every consumer green (they all treat any non-zero as
  // failure, so 1-instead-of-3 is invisible to all of them), and a message that
  // still reads perfectly right. Nothing else in this repo would notice.
  const hardcodesExitCall = (fn) => /process\.exit\(\s*\d/.test(fn.toString());
  const spellsALiteralCode = (fn) => /Exit code \d/.test(fn.toString());
  t('the refusal exits through the named constant, never a literal',
    !hardcodesExitCall(reportPrerequisiteNotMet), reportPrerequisiteNotMet.toString());
  t('the advisory INTERPOLATES the code rather than spelling one',
    !spellsALiteralCode(prerequisiteNotMetText));
  // The NEGATIVE CONTROLS, and the reason the two cases above are measurements
  // rather than tautologies: each predicate is run against a function that does
  // the forbidden thing and must SEE it. Without these, one typo in either
  // regex passes forever — a pin that cannot fail is not a pin. ⛔ Neither
  // control is ever CALLED; they exist to be read by `toString()`.
  const controlHardcodedExit = () => { process.exit(1); };
  const controlLiteralAdvisory = () => `  (Exit code 1 — capture it BEFORE any pipe:`;
  t('NEGATIVE CONTROL: the literal-exit pin can still fail', hardcodesExitCall(controlHardcodedExit));
  t('NEGATIVE CONTROL: the literal-advisory pin can still fail', spellsALiteralCode(controlLiteralAdvisory));

  // The same shape for the directory. The regression that costs something here
  // is not a mistyped path: it is an author interpolating the gate NAME back
  // into a hard-coded `scripts/` because the headline beside it does exactly
  // that. It would read correct, stay green for the 42 gates under `scripts/`,
  // and be wrong only for the three that are the whole point of this pin.
  const hardcodesScriptsDir = (fn) => /`node scripts\//.test(fn.toString());
  const controlHardcodedScriptsDir = () => `  \`node scripts/${'gate'}.mjs > /tmp/x.log\``;
  t('the advisory INTERPOLATES the importer path rather than hard-coding `scripts/`',
    !hardcodesScriptsDir(prerequisiteNotMetText));
  t('NEGATIVE CONTROL: the hard-coded-directory pin can still fail',
    hardcodesScriptsDir(controlHardcodedScriptsDir));

  t('the refusal class is 3 — the code four sibling gates answer these words with',
    EXIT_PREREQUISITE_NOT_MET === 3, String(EXIT_PREREQUISITE_NOT_MET));
  t('the refusal class is distinct from a finding and from a pass',
    EXIT_PREREQUISITE_NOT_MET !== EXIT_FINDINGS && EXIT_PREREQUISITE_NOT_MET !== 0);
  t('the advisory names its own code AND the finding code it is distinct from',
    advisory.includes(`Exit code ${EXIT_PREREQUISITE_NOT_MET}`)
      && advisory.includes(`a finding's ${EXIT_FINDINGS}`), advisory);
  // The one stroke Zone 1.2 of this card is about: a stale spelling anywhere in
  // the text is a false advisory inherited by all 45 importers.
  t('the advisory carries NO stale spelling of the old code',
    !/Exit code 1\b/.test(advisory), advisory);

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
