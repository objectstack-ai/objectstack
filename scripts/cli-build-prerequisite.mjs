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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The bin stub every gate spawns. A source file — its presence means nothing. */
export const CLI = 'packages/cli/bin/run.js';
/** The package whose `oclif` block declares where the built commands land. */
export const CLI_PKG = 'packages/cli';
/** The one command that satisfies the prerequisite, for every gate that reports it. */
export const CLI_BUILD_FIX = 'pnpm exec turbo run build --filter=@objectstack/cli';

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
  const flat = String(text ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*›\s*/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.match(/Error:\s*command\b.*?\bnot found\b/)?.[0] ?? '';
}

/**
 * `oclifCommandFileFor` against the real `packages/cli/package.json`.
 *
 * Both failure modes come back as one `unknown` REASON rather than a guessed
 * path, because a probe that cannot read the declaration must not turn a
 * correctly-built workspace red: the caller prints the reason and defers to its
 * in-loop signature net, which is the actual enforcement.
 *
 * @param {string[]} commandId
 * @returns {{ file: string } | { unknown: string }}
 */
export function resolveCliCommandFile(commandId) {
  let pkgJson;
  try {
    pkgJson = JSON.parse(readFileSync(join(CLI_PKG, 'package.json'), 'utf8'));
  } catch (e) {
    return { unknown: `could not read ${CLI_PKG}/package.json (${e.message})` };
  }
  return oclifCommandFileFor(pkgJson, commandId);
}
