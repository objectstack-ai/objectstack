#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * typecheck-configs -- the ONE answer to "which tsconfig files does this
 * package's `typecheck` script put in front of tsc?"
 *
 *   node scripts/typecheck-configs.mjs --self-test
 *
 * ## Why this is a shared module and not a copy in each gate
 *
 * Two gates need this predicate and they need the SAME one:
 *
 *   * `check-type-check-coverage.mjs` asks it to decide which programs
 *     ACCOUNT for a package's files -- a config no script invokes reads as
 *     coverage and delivers none (#5286).
 *   * `check-type-source-resolution.mjs` asks it to decide which programs are
 *     in its POPULATION at all. That gate read each package's `tsconfig.json`
 *     and only that one, so the sibling `tsconfig.test.json` this repo
 *     PRESCRIBES as the supported repair for a hidden test layer was a whole
 *     tsc program outside its declared population (#11490). Measured on
 *     `packages/triggers/trigger-record-change`: the same 7 test files with the
 *     same four dist-resolved type imports were REPORTED when put through the
 *     build config and SILENT through the prescribed sibling -- so following
 *     the house pattern was what made the exposure invisible.
 *
 * A second copy of the regex is how those two answers drift apart, and the
 * symptom of drift is a green gate on either side. One rule, one home, one set
 * of cases -- the shape `workspace-enumerator.mjs` and `invoked-as.mjs` use.
 *
 * ## What the answer IS, and the one property a consumer must handle
 *
 * A SET OF BASENAMES (`tsconfig.json`, `tsconfig.test.json`), never paths. The
 * match is `tsconfig[\w.-]*\.json`, whose character class excludes `/`, so a
 * reference written with a directory (`-p ../shared/tsconfig.test.json`) is
 * credited under its BASENAME as though it named the package's own file.
 *
 * That is a property, not a bug to route around here: both consumers resolve
 * the answer against the package directory, so a name with no file behind it
 * is dropped. It is stated out loud because the residual case is real -- a
 * package that BOTH reaches for a config in another directory AND carries a
 * same-named file of its own would credit the wrong one. Measured on this tree
 * while #11490 was implemented: 0 of the workspace's package.json files
 * reference any tsconfig with a directory prefix, so the case has no instance
 * today. Do not "fix" it by loosening the class to admit `/` without deciding
 * what a config OUTSIDE the package means to each caller -- the two callers do
 * not want the same thing there.
 */

import { isEntrypoint } from './invoked-as.mjs';

/**
 * The `typecheck` script, plus every same-package script it delegates to, as a
 * list of the script bodies in visit order.
 *
 * A LIST rather than a joined blob, because the two readers want different
 * things from it. `configsNamedByTypecheck` only ever asks "does this text
 * mention X" and a blob answers that; `check-type-check-coverage.mjs`'s
 * GENERATED_COVERED also asks "does X run BEFORE tsc", and that is only
 * decidable INSIDE one script body, where text order is shell order. Across
 * bodies the concatenation order is visit order, which has nothing to do with
 * execution order -- `typecheck: 'pnpm gen && tsc'` + `gen: 'next typegen'`
 * joins to `... tsc ... next typegen` while running the generator first, so a
 * blob would red a correct config. Keeping the bodies apart is what lets that
 * case ABSTAIN instead (#10880).
 *
 * @param {Record<string, unknown>} scripts  A package.json `scripts` object.
 * @returns {string[]}
 */
export function typecheckScriptChain(scripts) {
  const visited = new Set();
  const chain = [];
  const visit = (name, depth) => {
    if (depth > 4 || visited.has(name) || typeof scripts[name] !== 'string') return;
    visited.add(name);
    chain.push(scripts[name]);
    for (const m of scripts[name].matchAll(/\b(?:pnpm(?:\s+run)?|npm\s+run|yarn(?:\s+run)?)\s+([\w:.-]+)/g)) {
      visit(m[1], depth + 1);
    }
  };
  visit('typecheck', 0);
  return chain;
}

/**
 * Which tsconfig files does the `typecheck` script actually put in front of
 * tsc? Expanded through same-package `pnpm <script>` / `npm run <script>`
 * indirection, because a package that splits the work across two scripts is
 * still running both. A bare `tsc` reads `tsconfig.json`, so any mention of tsc
 * credits the default config; every other config must be NAMED (`-p
 * tsconfig.test.json`), which is what keeps a decorative sibling config from
 * reading as coverage (#5286).
 *
 * @param {Record<string, unknown>} scripts  A package.json `scripts` object.
 * @returns {Set<string>}  Config BASENAMES -- see this module's header.
 */
export function configsNamedByTypecheck(scripts) {
  const text = typecheckScriptChain(scripts).map((s) => ` ${s}`).join('');
  const named = new Set();
  for (const m of text.matchAll(/tsconfig[\w.-]*\.json/g)) named.add(m[0]);
  if (/\btsc\b/.test(text)) named.add('tsconfig.json');
  return named;
}

// ---------------------------------------------------------------------------
// Self-test -- the cases live with the rule, and both gates fold them in
// ---------------------------------------------------------------------------

const NAMED_CASES = [
  { label: 'a bare tsc credits the default config only', scripts: { typecheck: 'tsc --noEmit' }, expect: ['tsconfig.json'] },
  {
    label: 'an explicitly named sibling config counts',
    scripts: { typecheck: 'tsc --noEmit && tsc --noEmit -p tsconfig.test.json' },
    expect: ['tsconfig.json', 'tsconfig.test.json'],
  },
  {
    label: 'one level of `pnpm <script>` indirection is followed',
    scripts: { typecheck: 'tsc --noEmit && pnpm check:tests', 'check:tests': 'tsx x.mts --project tsconfig.test.json' },
    expect: ['tsconfig.json', 'tsconfig.test.json'],
  },
  {
    label: 'a config no script names is not coverage, however present the file is',
    scripts: { typecheck: 'tsc --noEmit', 'some:other': 'tsc -p tsconfig.test.json' },
    expect: ['tsconfig.json'],
  },
  { label: 'no typecheck script names nothing', scripts: {}, expect: [] },
  // #11490. The two ways a package can put its tests in front of tsc must come
  // back as DIFFERENT program sets, or the population widening that card asked
  // for has nothing to widen: the prescribed sibling route names a SECOND
  // config, dropping the build config's exclusion names one.
  {
    label: 'the prescribed sibling route names TWO programs',
    scripts: { typecheck: 'tsc --noEmit && tsc --noEmit -p tsconfig.test.json' },
    expect: ['tsconfig.json', 'tsconfig.test.json'],
  },
  // A directory-prefixed reference is credited under its BASENAME -- the
  // property this module's header states. Pinned rather than left to a reading,
  // because a consumer that stopped resolving names against the package
  // directory would silently start crediting another package's file.
  {
    label: 'a directory-prefixed reference comes back as a BASENAME',
    scripts: { typecheck: 'tsc --noEmit -p ../shared/tsconfig.test.json' },
    expect: ['tsconfig.json', 'tsconfig.test.json'],
  },
];

const CHAIN_CASES = [
  { label: 'no typecheck script is an empty chain', scripts: {}, expect: 0 },
  { label: 'a lone typecheck script is one body', scripts: { typecheck: 'tsc' }, expect: 1 },
  {
    label: 'delegation adds the delegate body',
    scripts: { typecheck: 'tsc && pnpm check:tests', 'check:tests': 'tsc -p tsconfig.test.json' },
    expect: 2,
  },
  { label: 'a cycle terminates instead of recursing', scripts: { typecheck: 'pnpm a', a: 'pnpm typecheck' }, expect: 2 },
];

/** How many cases `selfTest` holds -- for a folding gate's printed tally. */
export const SELF_TEST_CASE_COUNT = NAMED_CASES.length + CHAIN_CASES.length;

/**
 * @returns {string[]}  One string per failed case; empty means pass.
 */
export function selfTest() {
  const failures = [];

  for (const c of NAMED_CASES) {
    const got = [...configsNamedByTypecheck(c.scripts)].sort();
    if (JSON.stringify(got) !== JSON.stringify([...c.expect].sort())) {
      failures.push(
        `configsNamedByTypecheck -- ${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`,
      );
    }
  }

  for (const c of CHAIN_CASES) {
    const got = typecheckScriptChain(c.scripts).length;
    if (got !== c.expect) {
      failures.push(`typecheckScriptChain -- ${c.label}: expected ${c.expect} body/bodies, got ${got}`);
    }
  }

  return failures;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const failures = selfTest();
    for (const failure of failures) console.error(`  - ${failure}`);
    if (failures.length > 0) {
      console.error(`typecheck-configs --self-test FAILED: ${failures.length} of ${SELF_TEST_CASE_COUNT} case(s)`);
      process.exit(1);
    }
    console.log(`typecheck-configs --self-test OK -- ${SELF_TEST_CASE_COUNT} cases hold.`);
  } else {
    console.log('usage: node scripts/typecheck-configs.mjs --self-test');
  }
}
