#!/usr/bin/env node
/**
 * Validates that every workspace package is actually linted by CI.
 *
 * The sibling of scripts/check-type-check-coverage.mjs, for the same reason:
 * `pnpm lint` runs `turbo run lint`, and turbo silently skips any package with
 * no `lint` script — so a package without one is not "clean", it is unlinted.
 * That is how `apps/console`, the largest surface in the repo, went unlinted
 * while carrying 14 ESLint errors that nobody had ever seen (#2923).
 *
 * The stakes are concrete: every `object-ui/*` rule that `eslint.config.js`
 * sets to `error` is a ratchet — added specifically so a new violation fails
 * CI. Those ratchets are worthless in a package that never runs ESLint.
 *
 * That sentence deliberately neither counts those rules nor lists where they
 * came from. It used to do both, and it was wrong on the day it was written: a
 * verbatim copy of the enumeration #3261 removed from
 * `.github/workflows/lint.yml`, short by the same rule, left behind because
 * that fix only touched the workflow (#3279). A hand-copied enumeration drifts
 * by construction, and a stale one still reads as authoritative — so the next
 * person deciding whether their new rule is inside this gate gets a confident,
 * wrong answer. `eslint.config.js` is the only honest list, each rule carrying
 * its own ADR/issue in the comment beside it, and
 * `scripts/__tests__/lint-workflow.test.ts` fails if a count or a rule name
 * reappears here.
 *
 * Run:  node scripts/check-lint-coverage.mjs
 * Exit: 0 = OK, 1 = coverage regressed or the list is stale
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ── Known gaps ───────────────────────────────────────────────────────────────
// Packages with outstanding ESLint *errors*, so they cannot carry a `lint`
// script without turning CI red. Warnings do not matter here — ESLint only
// fails on errors unless `--max-warnings` is set, and it deliberately is not
// (warnings repo-wide run into the thousands, dominated by `no-explicit-any`;
// see #2923). No exact count on purpose: this line and the matching paragraph
// in `.github/workflows/lint.yml` used to quote the same hand-maintained
// figure, which every added `any` aged and nothing ever recomputed — two copies
// free to drift apart, and apart from reality (#3274).
//
// Every entry is real debt: fix the errors, add `"lint": "eslint ."`, then
// delete the entry.
//
// Empty since #2927 closed the last two (`@object-ui/console`, 14 errors, and
// `@object-ui/runner`, 3). Every workspace package now runs ESLint. Adding an
// entry here is a deliberate admission that a package ships known errors — do
// it with an issue number, and treat it as temporary.
const DEBT = {};

// ── Collect workspace packages ───────────────────────────────────────────────
const GROUPS = ["packages", "apps", "examples"];

function collect() {
  const out = [];
  for (const group of GROUPS) {
    let entries;
    try {
      entries = readdirSync(resolve(root, group));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = join(group, entry);
      const manifest = resolve(root, dir, "package.json");
      try {
        statSync(manifest);
      } catch {
        continue;
      }
      const pkg = JSON.parse(readFileSync(manifest, "utf8"));
      if (!pkg.name) continue;
      out.push({
        name: pkg.name,
        dir,
        hasScript: Boolean(pkg.scripts?.lint),
      });
    }
  }
  return out;
}

const packages = collect();
const byName = new Map(packages.map((p) => [p.name, p]));

const errors = [];

// 1. Undeclared gap — a package that never runs ESLint.
for (const pkg of packages) {
  if (pkg.hasScript) continue;
  if (DEBT[pkg.name]) continue;
  errors.push(
    `${pkg.name} (${pkg.dir}) has no "lint" script, so \`pnpm lint\` skips it entirely.\n` +
      `      Add  "lint": "eslint ."  to its package.json. If it still has ESLint errors,\n` +
      `      add it to DEBT in scripts/check-lint-coverage.mjs with an error count.`
  );
}

// 2. Ratchet — a declared gap that has been closed must leave the list.
//
// ⛔ The tail this ratchet appends may not put a GitHub closing keyword
// (`close`/`fix`/`resolve`, any tense) immediately in front of the anchor it
// names. This message exists to be QUOTED: the discipline around a DEBT entry
// is to take the INTERMEDIATE reading — the package linted, the entry not yet
// deleted — and paste it into the pull request as proof the work landed. A
// keyword in front of the number makes every such quote a card-closing trigger
// in the merge path, which ends the anchor silently, from a body whose author
// was being careful. GitHub's parser does no sentence parsing, so hedging the
// sentence around it buys nothing. Keep the instruction, lose the keyword, and
// spell the anchor `objectui#` rather than a bare `#` so the reference cannot
// match the closing grammar at all. This gate was reworded onto that shape
// alone; the siblings the same repair would reach were reported rather than
// widened into (objectui#9595). The precedent this wording came from is
// recorded in the pin named below, beside the code that reads it. ⛔ Do not
// re-answer that here, and ⛔ do not name which other gates carry the shape
// today: a sentence in this banner about another gate's source is a reading
// taken once, by someone who is not looking at that file, and re-derived
// never. Such a sentence does not stay true; it only waits. The one that stood
// here, and how it went stale, are on objectui#9906. Pinned by
// scripts/__tests__/check-lint-coverage-closing-keyword.test.ts, which reads
// this module's text rather than trusting this comment — this paragraph
// included, for the naming of any other gate.
for (const name of Object.keys(DEBT)) {
  const pkg = byName.get(name);
  if (!pkg) {
    errors.push(`${name} is listed in DEBT but is not a workspace package any more — delete the entry.`);
  } else if (pkg.hasScript) {
    errors.push(
      `${name} now has a "lint" script — delete its DEBT entry so the gap cannot reopen` +
        `${DEBT[name].issue ? `, and objectui#${DEBT[name].issue} can be ended once that work is done` : ""}.`
    );
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
const linted = packages.filter((p) => p.hasScript).length;
const debtCount = Object.keys(DEBT).length;
const debtErrors = Object.values(DEBT).reduce((sum, d) => sum + d.errors, 0);

if (errors.length === 0) {
  console.log(
    `✅  lint coverage: ${linted}/${packages.length} packages linted, ` +
      `${debtCount} with outstanding errors (${debtErrors} total).`
  );
  process.exit(0);
}

console.error("❌  lint coverage regressed:\n");
for (const message of errors) {
  console.error(`    • ${message}`);
}
console.error(
  "\nA package with no `lint` script is not clean — turbo skips it and CI sees nothing.\n" +
    "See https://github.com/objectstack-ai/objectui/issues/2923 for why this guard exists."
);
process.exit(1);
