// cli-build-prerequisite — the one answer to "is the workspace CLI built?",
// shared by the gates that shell out to the BUILT CLI.
//
// `packages/cli/bin/run.js` is a four-line SOURCE stub handing off to
// `@oclif/core`, so it is present in an unbuilt tree and proves nothing. What a
// gate actually depends on is the compiled command surface oclif resolves from
// `oclif.commands.target` — and when that is missing, the CLI answers nothing and
// the gate blames whichever input file it happened to be holding.
//
// #5217 wrote these two pure functions inside `check-i18n-bundles.mjs`; #5862
// found the identical missing precondition one `lint.yml` step away, in
// `check-i18n-coverage.mjs`. They live here, in one module, rather than as two
// copies: the knowledge they encode is not obvious — oclif's hard wrapping below
// is the whole reason the naive implementation fails — and a copy is a second
// source of truth that gets fixed on one side only (#5186).
//
// What is deliberately NOT shared is the WORDING. Only the gate knows what it did
// not check, and "nothing was checked" is the load-bearing half of the message.
//
// #7681 added the SECOND prerequisite these gates run on, in the same shape and
// for the same reason: the CLI can be built and a gate still unable to run,
// because the command it invokes loads the workspace's OWN packages and one of
// them has a `dist/` older than its source. `looksLikeStaleWorkspaceDist` is that
// classifier. It is a sibling of the first, never a widening of it — an unbuilt
// CLI and a stale dependency are different facts with different remedies, and the
// two signatures must not match each other's corpus.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** This module lives in `scripts/`, so the repo root is one level up (#11394). */
const REPO_ROOT = resolve(HERE, '..');

/**
 * A repo-relative path, resolved against the module-derived root — the ONE seam
 * between this module's vocabulary and the filesystem (#11394), the shape #10907
 * put on `check-i18n-coverage.mjs` one file over.
 *
 * EXPORTED, unlike that gate's private `at()`, because the vocabulary is: this
 * module hands its consumers a repo-relative `file`, and a consumer that then
 * asks the filesystem about it has to reach the same disk this module read from.
 * Identical in value to `check-i18n-coverage.mjs`'s `at()` — both files live in
 * `scripts/` — and deliberately not imported from it: that gate imports THIS
 * module, so taking its root would be a cycle, and the anchor is two lines.
 */
export const atRepoRoot = (rel) => join(REPO_ROOT, rel);

// Repo-relative ON PURPOSE, and NOT to be anchored (#10907's note, restated here
// because #11394 anchored the reads around them). These spellings are the text
// every consumer's error messages and rerun commands are written in, and `CLI` is
// an argv path spawned against a cwd of the repo root. `atRepoRoot` above is the
// one seam that turns them into paths on disk, so the vocabulary stays relative
// while every READ is anchored. Making them absolute would rewrite the commands
// this repo tells a reader to run.
/** The bin stub every gate spawns. A source file — its presence means nothing. */
export const CLI = 'packages/cli/bin/run.js';
/** The package whose `oclif` block declares where the built commands land. */
export const CLI_PKG = 'packages/cli';
/**
 * That manifest as ONE whole path, rather than joined from `CLI_PKG` at the read.
 *
 * The value is identical either way; what changes is what a CALLER inherits.
 * scripts/pm/dispatch-gates.mjs follows a gate's first-party imports and reads
 * this module's module-body literals as population for every gate that imports
 * it (#11190) — and a join base is indistinguishable, from out there, from a
 * whole-package subtree claim. The manifest is the one file this module opens,
 * so this module spells it, which is what lets the `inherited-population`
 * marker below name it: that declaration may only NARROW to paths its module
 * really spells, never invent one.
 */
const CLI_PKG_JSON = 'packages/cli/package.json';
/** The one command that satisfies the prerequisite, for every gate that reports it. */
export const CLI_BUILD_FIX = 'pnpm exec turbo run build --filter=@objectstack/cli';

/**
 * The CLI's COMPILED surface — the tree `tsc -p packages/cli/tsconfig.build.json`
 * turns into the `dist/commands` oclif resolves a spawned command out of.
 *
 * A bare coupling constant: nothing here reads it, and it is declared for the
 * reason check-i18n-bundles.mjs declares its two registry modules (#9144). It
 * is the only tree under `packages/cli` whose edit can change what a consumer's
 * spawn ANSWERS, so a declaration naming the stub and the manifest alone would
 * leave every consumer blind to exactly the edit that moves its verdict — the
 * shape #11190 exists to prevent, arriving by the other door. Deliberately the
 * subtree and not a file list: the consumers spawn whole commands (`os i18n
 * extract`, `os lint`), not one module, and a file list here would be the
 * hand-written path map this derivation refuses.
 */
const CLI_SRC = 'packages/cli/src';

// What a consumer of this module READS under `packages/cli`, and therefore all
// of it a consumer inherits (#12500). `CLI_PKG` above is a join base and the
// vocabulary of every message here, never a tree anything opens — but inherited
// whole it named all 322 tracked files of the package for `check:i18n` and
// `check:i18n-coverage`, 210 of them (the 100-file test suite, the package
// docs, the vitest config, the sibling app-nav gate script) unable to change a
// byte of the `dist/` those two gates spawn. The gates' own refusal text is
// exemplary, so a card that skipped the build read NOT MEASURED rather than
// green: the price was never a false verdict, it was a full CLI closure build
// bought per card to measure two gates the diff provably could not move.
//
// Build CONFIGURATION is deliberately NOT declared. A tsconfig-only edit that
// changes the shipped command surface loses one lead — one card, one CI round,
// the direction this derivation errs in everywhere — against the ~10 minutes
// each false lead charged. `CLI_SRC` is a prefix, so the ~101 `*.test.ts` files
// interleaved under `src/` stay named; `hintCovers` matches subtrees, and a
// declaration cannot express "the compiled subset of this tree".
// dispatch-gates: inherited-population packages/cli/bin/run.js packages/cli/package.json packages/cli/src -- a consumer spawns the stub, parses the manifest for oclif.commands.target, and resolves its command out of the dist/ compiled from src/; `packages/cli` itself is this module's join base and message vocabulary, not a tree any consumer opens (#12500)

/**
 * The npm scope every workspace package publishes under (`create-objectstack` is
 * the one exception, and no gate's input imports it). It is used for exactly one
 * decision: whether a failed module specifier names a package THIS repo builds —
 * which is the difference between "that package's `dist/` is stale, rebuild it"
 * and a diagnosis this module has no standing to make about someone else's
 * dependency.
 *
 * Hardcoded rather than derived, and the drift direction is why that is safe: if
 * the scope is ever renamed, `looksLikeStaleWorkspaceDist` stops matching and its
 * callers fall back to the verdict they gave before it existed. A stale constant
 * costs a missed classification here, never a confident wrong one.
 */
export const WORKSPACE_SCOPE = '@objectstack';

/** Rebuilds one workspace package and the packages it depends on. */
export function workspaceBuildFix(pkg) {
  return `pnpm exec turbo run build --filter=${pkg}`;
}

/**
 * Where oclif will look for a command, derived from the CLI package's own
 * `oclif.commands.target` (#5217). Pure: takes the parsed package.json and the
 * command id as oclif topic/command parts, returns a repo-relative path or a
 * reason it cannot tell.
 *
 * Derived rather than hardcoded for the same reason the extract flags come from
 * each config's docstring: `dist/commands` is the CLI's declaration of where its
 * commands live, and a gate that restates it would keep probing the old path for
 * a release after someone moves it — passing while checking nothing.
 *
 * @param {any} pkgJson parsed `packages/cli/package.json`
 * @param {string[]} commandId e.g. `['i18n', 'extract']`, or `['lint']`
 * @returns {{ file: string } | { unknown: string }}
 */
export function oclifCommandFileFor(pkgJson, commandId) {
  const target = pkgJson?.oclif?.commands?.target ?? pkgJson?.oclif?.commands;
  if (typeof target !== 'string' || !target) {
    return { unknown: `${CLI_PKG}/package.json declares no oclif.commands.target` };
  }
  const rel = target.replace(/^\.\//, '').replace(/\/+$/, '');
  return { file: join(CLI_PKG, rel, ...commandId.slice(0, -1), `${commandId.at(-1)}.js`) };
}

/**
 * oclif's own "command <id> not found", which is what an unbuilt (or half-built)
 * CLI answers with. The in-loop safety net for the probe below, and it has to
 * survive oclif's line wrapping to be worth anything: oclif hard-wraps that one
 * sentence across two or three ` › `-prefixed lines, at a width that depends on
 * the argument's length, so the real corpus contains BOTH
 *
 *   " ›   Error: command \n ›   i18n:extract:<path> not \n ›   found"
 *   " ›   Error: command i18n:extract:<path-broken\n ›   -mid-token> not found"
 *
 * — the second one split inside the path itself. A per-line regex (the obvious
 * first implementation, and the one that reads as correct) matches NEITHER. So
 * the prefixes come off and the whole text is flattened before matching.
 *
 * Returns the matched SENTENCE (re-joined into one readable line) so the caller
 * can quote it as evidence, or '' for no match. Returning the whole flattened
 * text instead is a trap this returned from once in review: a stale-dist run also
 * carries a node `Warning:` block above the error, and quoting the flattened text
 * put that unrelated block in the report while the actual sentence sat past the
 * truncation.
 *
 * @param {string} text combined stdout/stderr
 * @returns {string} the error sentence, or '' when this is not that failure
 */
export function looksLikeMissingCliCommand(text) {
  return flattenCliOutput(text).match(/Error:\s*command\b.*?\bnot found\b/)?.[0] ?? '';
}

/**
 * oclif's ` › ` prefixes off, every line joined, whitespace collapsed. Shared by
 * the classifiers below because a signature that a per-line regex can miss is the
 * defect both of them exist to avoid: oclif hard-wraps mid-sentence and even
 * mid-token, and node prints its own diagnostics as a frame plus a stack, so the
 * sentence worth matching is almost never alone on a line.
 */
function flattenCliOutput(text) {
  return String(text ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*›\s*/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A specifier's workspace package (`@scope/name`), or '' when it names none. */
const WORKSPACE_PACKAGE_IN_SPECIFIER = new RegExp(`(?:^|node_modules/)(${WORKSPACE_SCOPE}/[^/'"\\s]+)`);

/**
 * A DEPENDENCY whose build output no longer matches its source — the other
 * environment prerequisite a gate that shells out to the CLI depends on, and the
 * one `looksLikeMissingCliCommand` cannot see (#7681).
 *
 * The CLI can be perfectly built and the gate still unable to run: the extract /
 * lint the gate invokes loads the workspace's own packages, and a `dist/` older
 * than the source that added an export makes node refuse the import outright:
 *
 *   SyntaxError: The requested module '@objectstack/spec/system' does not provide
 *   an export named 'authorisesIrreversibleAction'
 *
 * That is an environment fact about one `dist/`, not a fact about the input file
 * the gate happened to be holding — so a gate must not fold it into a content
 * verdict about that input. #7681 is the measured case: `packages/spec/dist`
 * predated the commit that added the export, and `check-i18n-bundles` reported
 * "1 bundle problem(s) … extract failed", pointing the reader at i18n configs
 * that were never at fault, while its sibling `check-i18n-coverage` refused to
 * judge at all.
 *
 * DELIBERATELY NARROW — the mirror-image defect is a confident diagnosis pointing
 * somewhere innocent (#5862/#6033), so this claims a package only when the
 * specifier names one this repo builds:
 *
 *   • an export mismatch on a `@objectstack/*` specifier   → stale build output;
 *   • `Cannot find module` reaching INTO a `@objectstack/*` package's `dist/`
 *                                                          → no build output at all.
 *
 * Everything else keeps whatever verdict the caller gave before: a third party's
 * export mismatch (no rebuild this repo can prescribe), a `Cannot find module`
 * for a path that is not build output (not installed / a genuinely wrong import),
 * and CommonJS interop's differently-worded `Named export 'x' not found`, which is
 * an authoring problem and not staleness.
 *
 * @param {string} text combined stdout/stderr
 * @returns {{ kind: 'export-mismatch' | 'missing-output', pkg: string, missingExport: string, sentence: string } | null}
 */
export function looksLikeStaleWorkspaceDist(text) {
  const flat = flattenCliOutput(text);
  const mismatch = flat.match(/The requested module '([^']+)' does not provide an export named '([^']+)'/);
  if (mismatch) {
    const pkg = mismatch[1].match(WORKSPACE_PACKAGE_IN_SPECIFIER)?.[1] ?? '';
    return pkg ? { kind: 'export-mismatch', pkg, missingExport: mismatch[2], sentence: mismatch[0] } : null;
  }
  const missing = flat.match(/Cannot find (?:module|package) '([^']+)'/);
  if (missing) {
    const pkg = missing[1].match(WORKSPACE_PACKAGE_IN_SPECIFIER)?.[1] ?? '';
    if (pkg && /(?:^|\/)dist\//.test(missing[1])) {
      return { kind: 'missing-output', pkg, missingExport: '', sentence: missing[0] };
    }
  }
  return null;
}

/**
 * `oclifCommandFileFor` against the real `packages/cli/package.json`.
 *
 * The read is ANCHORED (#11394). It used to be `join(CLI_PKG, 'package.json')`
 * against the cwd, so from anywhere but the repo root it ENOENTed and the probe
 * deferred — not because the declaration was unreadable, but because it had been
 * looked for in the wrong place. Every off-root run of either consumer was
 * preceded by
 *
 *     check-i18n-coverage: could not read packages/cli/package.json (ENOENT …)
 *       — build prerequisite not pre-checked
 *
 * over a workspace that was fine, and on an UNBUILT tree it cost the diagnosis
 * outright: the one environment fact reached the in-loop net once per config
 * instead of being named once, up front.
 *
 * The deferral DIRECTION is unchanged and still correct — both failure modes come
 * back as one `unknown` REASON rather than a guessed path, because a probe that
 * cannot read the declaration must not turn a correctly-built workspace red: the
 * caller prints the reason and defers to its in-loop signature net, which is the
 * actual enforcement. What #11394 changed is which facts can reach it. Only a
 * genuinely unreadable or unshaped declaration does now; a foreign cwd does not.
 *
 * ⛔ Do not restore the cwd-relative read to reproduce a deferral. It was used as
 * one once — #11395's twelve-way cause split was measured through it — and that
 * reason discharged at `a1508766`: `groupFailuresByCause` keys a cause on a `fix`
 * drawn from a CLOSED set of constants, and the per-config rerun command is
 * rendered by the report, so the split cannot recur whether this probe defers or
 * not. A deferral for testing is `oclifCommandFileFor({ oclif: {} }, …)`, which is
 * pure and is what both consumers' `--self-test` already pins.
 *
 * @param {string[]} commandId
 * @returns {{ file: string } | { unknown: string }}
 */
export function resolveCliCommandFile(commandId) {
  let pkgJson;
  try {
    // The message stays repo-relative (it is the path a reader would `cat` from
    // the root); only the READ is anchored. node's own ENOENT text carries the
    // absolute path it tried, which is evidence rather than vocabulary.
    pkgJson = JSON.parse(readFileSync(atRepoRoot(CLI_PKG_JSON), 'utf8'));
  } catch (e) {
    return { unknown: `could not read ${CLI_PKG_JSON} (${e.message})` };
  }
  return oclifCommandFileFor(pkgJson, commandId);
}
