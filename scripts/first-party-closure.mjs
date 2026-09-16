#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * first-party-closure — the ONE answer to "which files travel with this script
 * when it is copied into a throwaway repo?" (#16421)
 *
 * Several gates in this tree prove something about ANOTHER script by COPYING it
 * into a temp git repo and running it there, because nothing short of that
 * script's own verdict settles the claim. A copy is only runnable if every
 * first-party module it imports travels with it; miss one and the fixture dies
 * on `ERR_MODULE_NOT_FOUND`, which reads as "the assertion broke" rather than
 * "the fixture is incomplete".
 *
 * ## Why this is derived and not a list
 *
 * It WAS a list — twice, in two files, for the same gate. The two staging sites
 * of `check-adr-0087-registration.mjs` each carried a hand-written manifest
 * (`['invoked-as.mjs', 'js-comment-mask.mjs']`), and each carried a comment
 * telling the next author to remember to update it. Measured: when that gate
 * gained ONE import — `pm/check-clause2-carriers.mjs`, whose own closure is nine
 * modules deep — the first site was updated in the same edit and the second was
 * not, so `check:objectui-changeset` went red in CI with an error naming neither
 * the import nor the manifest. A rule that is enforced by remembering is a rule
 * with a measured failure rate, and here it was one in two.
 *
 * So the manifest is COMPUTED from the same edges Node will resolve. A staging
 * site cannot drift from the real module graph, because it is no longer holding
 * an opinion about it.
 *
 * ## ⛔ Statement-shaped matches only
 *
 * A bare regex over the source harvests every specifier sitting inside a STRING
 * in a self-test fixture — this tree's gates are full of them
 * (`"import { x } from './does-not-exist.mjs';"` is a real line in
 * `pm/dispatch-gates.mjs`, written to be parsed, never to be resolved). Both
 * patterns below therefore anchor at a line start: an `import`/`export`
 * statement, and the closing brace of a multi-line one. A quoted fixture is
 * preceded by its quote and reaches neither.
 *
 * ⚠️ A specifier that resolves to nothing THROWS. The alternative — skipping it
 * — reproduces the exact defect this module exists to remove, one layer up: the
 * closure would come back short, the copy would die on `ERR_MODULE_NOT_FOUND`,
 * and the error would again name neither cause.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/**
 * The two line-anchored shapes a first-party edge is written in.
 *
 * ⛔ Not exported as a convenience to build a third reader from: the whole point
 * is that the edge set has one spelling. It is exported so a gate can ASSERT on
 * it — `check-adr-0087-registration.mjs`'s fixture pins that the quoted-fixture
 * case is refused, and that assertion needs the patterns it is asserting about.
 */
export const FIRST_PARTY_EDGE_PATTERNS = Object.freeze([
  /^[ \t]*(?:import|export)[^'"\n]*from[ \t]*['"](\.[^'"\n]+)['"]/gm,
  /^[ \t]*\}[ \t]*from[ \t]*['"](\.[^'"\n]+)['"]/gm,
]);

/**
 * The relative specifiers ONE source file imports, in source order, deduped.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function firstPartyImportEdges(source) {
  const out = [];
  const text = String(source ?? '');
  for (const pattern of FIRST_PARTY_EDGE_PATTERNS) {
    // A `g` regex carries state, and these live at module scope: reset before
    // each use or the second caller starts reading from wherever the first
    // stopped. That failure is order-dependent and intermittent, which is the
    // worst shape a fixture helper can have.
    pattern.lastIndex = 0;
    for (const m of text.matchAll(pattern)) if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Every first-party module reachable from `entryRel`, INCLUDING `entryRel`.
 *
 * Paths come back repo-relative and in walk order, which is the order a staging
 * site wants: the entry first, then what it needs.
 *
 * @param {string} entryRel — repo-relative path of the entry module.
 * @param {{ root: string }} options — the repo root `entryRel` is relative to.
 * @returns {string[]}
 */
export function firstPartyModuleClosure(entryRel, { root }) {
  if (!root || !isAbsolute(root)) throw new Error(`firstPartyModuleClosure: \`root\` must be an absolute path, got ${JSON.stringify(root)}`);
  const seen = [];
  const walk = (rel) => {
    if (seen.includes(rel)) return;
    const abs = resolve(root, rel);
    if (!existsSync(abs)) {
      throw new Error(
        `firstPartyModuleClosure: ${rel} does not exist under ${root}.\n` +
        '    An edge was harvested from a source file and did not resolve. Either the walk read a\n' +
        '    specifier it should not have (see the statement-shaped rule in this module\'s header),\n' +
        '    or the import really is broken — and both are worth a loud stop rather than a copy that\n' +
        '    dies later on ERR_MODULE_NOT_FOUND naming neither cause.',
      );
    }
    seen.push(rel);
    // Only a JS module has edges to follow. A relative `.json` import is real
    // and must travel with the copy, so it is COLLECTED — it is simply not read
    // for further edges.
    if (!/\.m?js$/.test(rel)) return;
    for (const spec of firstPartyImportEdges(readFileSync(abs, 'utf8'))) {
      walk(relative(root, resolve(root, dirname(rel), spec)));
    }
  };
  walk(entryRel);
  return seen;
}

/**
 * Copy `entryRel`'s whole closure into a sandbox, at the same relative paths.
 *
 * The one line a staging site needs. `write` is the site's own writer, because
 * every one of them already has one that makes parent directories — handing the
 * closure back through the caller's writer keeps this module free of any opinion
 * about how the sandbox is built.
 *
 * @param {string} entryRel
 * @param {{ root: string, write: (rel: string, text: string) => void }} options
 * @returns {string[]} the paths written, for a caller that wants to assert on them.
 */
export function stageFirstPartyClosure(entryRel, { root, write }) {
  const closure = firstPartyModuleClosure(entryRel, { root });
  for (const rel of closure) write(rel, readFileSync(join(root, rel), 'utf8'));
  return closure;
}
