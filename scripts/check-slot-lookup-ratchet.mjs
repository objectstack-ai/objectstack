#!/usr/bin/env node
// check-slot-lookup-ratchet — the #4251 sweep ratchet, enforced.
//
// `eslint.config.mjs` bans erasing a service-lookup result to `any`
// (#4127/#4214/#4251) across all of packages/, and grandfathers the files that
// still hold pre-existing sites by listing them in
// scripts/slot-lookup-baseline.json. ESLint's `ignores` alone cannot express a
// ratchet: an ignored file is ignored completely, so NEW erasures added to a
// listed file ride the existing entry in total silence — the same
// declared-but-unchecked shape this whole work line keeps finding (#4320's
// options configured a block that never ran; nothing checked the promise).
//
// So the baseline carries COUNTS, and this script is what makes them mean
// something. It fails when:
//   • a file NOT in the baseline reports a site (that already fails `pnpm lint`
//     — reported here too so one command explains the whole picture), or
//   • a baselined file's count INCREASES (new erasure hiding behind an old
//     entry — the invisible move), or
//   • a baselined file's count DECREASED or the file is clean/gone (progress!)
//     — run with --update to ratchet the baseline down and commit it.
//
//   node scripts/check-slot-lookup-ratchet.mjs [--update]
//
// The counts are produced by running ESLint itself with the baseline's
// `ignores` lifted, and reports are matched by the rule's exact message
// (imported from the config). The counter therefore cannot drift from the
// rule: change the selectors and this re-measures against them.
//
// Sweeping a file means typing its lookups (pass the slot's contract), then
// `--update` to drop or shrink its entry. Entries only ever go down; a batch
// that adds one is doing the opposite of the job.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

import eslintConfig, { SLOT_LOOKUP_ANY_MESSAGE } from '../eslint.config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const BASELINE_PATH = 'scripts/slot-lookup-baseline.json';

/**
 * The POPULATION this gate re-measures, as the repo-relative subtree it really
 * reads. Everything below is derived from it, so what the gate declares and
 * what the gate scans cannot become two different facts.
 *
 * ## Why a gate declaring its own population is load-bearing (#9700, #9626)
 *
 * `scripts/pm/dispatch-gates.mjs` builds every dispatch's gate list by scanning
 * each gate's own source for the path literals it operates on. Before this
 * declaration, the only literals in this file were its OUTPUT
 * (`scripts/slot-lookup-baseline.json`) and the ref the monotonicity check
 * diffs against (`origin/main`) — neither of which is a file this gate reads.
 * So the derivation scored this gate `silent` for every card in the tree: not
 * "irrelevant", but "its sources name paths, none of which cover yours", which
 * the residue summary calls its weakest claim and explicitly not a clearance.
 *
 * That cost real CI rounds on cards that could not have known to run it: #9391
 * (a `priority:p0` auth guard that added five `getService` lookups typed `any`)
 * and again PR #9695. Both went red in `Lint & Repo Gates` on a gate that
 * appeared in NEITHER half of their dispatch's derivation.
 *
 * ## Why the subtree, and why it is the constant the target derives from
 *
 * The hint language `dispatch-gates` compares in is repo-relative paths with
 * globs collapsed, so an extension glob carries no information there:
 * `packages/**` + `/*.{ts,tsx,mts,cts}` is what ESLint needs, but that spelling
 * is not even extractable as a hint (brace expansion is outside the scanner's
 * accepted path charset) and collapses to something that matches no file. The
 * declaration is therefore the SUBTREE, and the ESLint target is one
 * concatenation away from it rather than a second literal — the same shape
 * #9639 used for `check:doc-anchors` (`CONTENT_GLOB`, with its root derived),
 * and for the same reason: a declaration that can drift from the scan is worse
 * than none, because it replaces a silent gate with a lying one.
 *
 * ## The cost of declaring it, decided rather than assumed
 *
 * `packages/**` is broad: this gate is now named for every card whose surface
 * is under `packages/`, and a card that edits a package README or manifest gets
 * a lead it does not need. That trade is the one `CHANGE_KIND_GATES` already
 * decided for the three structurally identical whole-tree ratchets in
 * `dispatch-gates.mjs`, and it is decided the same way here — by what the gate
 * costs to run needlessly. Measured on this tree: 46s, no build required, and a
 * failure names the offending file and line. A seat that runs it needlessly
 * loses seconds; a seat that is never prompted loses a CI round.
 *
 * Two things a seat prompted by this declaration needs to know, and neither is
 * visible from a green `pnpm lint`:
 *   • `pnpm lint` passing proves NOTHING for a file in the baseline — it is
 *     grandfathered by `ignores`, so ESLint says nothing about new erasures
 *     added to it. This ratchet is the only thing that sees them.
 *   • the repair is to TYPE the lookup against its slot's contract. Never
 *     `--update` the baseline upward; entries only ever go down.
 */
const POPULATION_GLOB = 'packages/**';

/** What ESLint is asked to lint: every TS dialect inside the declared population. */
const LINT_TARGET = `${POPULATION_GLOB}/*.{ts,tsx,mts,cts}`;

const update = process.argv.includes('--update');
const baseline = JSON.parse(readFileSync(resolve(repoRoot, BASELINE_PATH), 'utf8'));
const baselinedFiles = new Set(Object.keys(baseline));

// The lint config with the grandfathering removed — every baselined file is
// measured as if it were already swept. Only the block that carries this rule
// is touched; every other config entry passes through untouched so the run
// stays byte-identical to `pnpm lint` in all other respects.
const carriesRule = (entry) => {
  const rule = entry?.rules?.['no-restricted-syntax'];
  return Array.isArray(rule) && rule.some((r) => r?.message === SLOT_LOOKUP_ANY_MESSAGE);
};

const measuringConfig = eslintConfig.map((entry) =>
  carriesRule(entry)
    ? { ...entry, ignores: (entry.ignores ?? []).filter((p) => !baselinedFiles.has(p)) }
    : entry,
);

if (!eslintConfig.some(carriesRule)) {
  console.error(
    'check-slot-lookup-ratchet: no config block carries the slot-lookup rule.\n' +
    'The rule was renamed, removed, or its message changed without updating\n' +
    'SLOT_LOOKUP_ANY_MESSAGE — refusing to report "clean" for a rule that is\n' +
    'no longer being measured.',
  );
  process.exit(2);
}

// The declaration above states what this gate READS, and a dispatch pastes it
// into a prompt as a lead. It is only true while it agrees with the scope the
// RULE is configured for — the config block's own `files`. Copies in two files
// drift silently, so the agreement is asserted rather than assumed: if the rule
// is ever rescoped (another extension, another root, a second block), this
// refuses to run instead of measuring a population that no longer matches
// either what `pnpm lint` enforces or what `dispatch-gates` was told.
const ruleScopes = eslintConfig.filter(carriesRule).flatMap((entry) => entry.files ?? []);
if (ruleScopes.length !== 1 || ruleScopes[0] !== LINT_TARGET) {
  console.error(
    'check-slot-lookup-ratchet: the declared population no longer matches the\n' +
    'scope the rule is configured for.\n' +
    `  declared here: ${LINT_TARGET}\n` +
    `  rule is scoped to: ${ruleScopes.join(', ') || '(nothing)'}\n` +
    'Update POPULATION_GLOB/LINT_TARGET in this file to match eslint.config.mjs.\n' +
    'This declaration is read by scripts/pm/dispatch-gates.mjs to decide which\n' +
    'cards are told to run this gate, so a stale one is a wrong lead, not a\n' +
    'cosmetic mismatch — refusing rather than measuring the wrong set.',
  );
  process.exit(2);
}

const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: true,
  baseConfig: measuringConfig,
  // Match the root `lint` script: this repo lints with --no-inline-config on
  // purpose, so an eslint-disable comment must not shrink a count here either.
  allowInlineConfig: false,
});

const results = await eslint.lintFiles([LINT_TARGET]);

const current = {};
for (const result of results) {
  const hits = result.messages.filter((m) => m.message === SLOT_LOOKUP_ANY_MESSAGE).length;
  if (hits > 0) current[relative(repoRoot, result.filePath).replace(/\\/g, '/')] = hits;
}

const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));

if (update) {
  writeFileSync(resolve(repoRoot, BASELINE_PATH), JSON.stringify(sorted, null, 2) + '\n');
  const files = Object.keys(sorted).length;
  const sites = Object.values(sorted).reduce((a, b) => a + b, 0);
  console.log(`slot-lookup baseline updated: ${sites} site(s) in ${files} file(s).`);
  process.exit(0);
}

const errors = [];
for (const [file, count] of Object.entries(sorted)) {
  const allowed = baseline[file];
  if (allowed === undefined) {
    errors.push(
      `${file}: NEW service-lookup erasure (${count} site(s)). Pass the slot's ` +
      `contract type instead of \`any\` — see eslint.config.mjs and issue #4251. ` +
      `This file is not grandfathered, and the baseline never grows.`,
    );
  } else if (count > allowed) {
    errors.push(
      `${file}: erasure count grew ${allowed} → ${count}. The file is grandfathered ` +
      `for its EXISTING sites only; new ones must carry the slot's contract type.`,
    );
  }
}
for (const [file, allowed] of Object.entries(baseline)) {
  const now = sorted[file];
  if (now === undefined) {
    errors.push(
      `${file}: baselined file is clean/gone (was ${allowed}) — ratchet DOWN: run ` +
      `\`pnpm check:slot-lookup --update\` and commit the baseline.`,
    );
  } else if (now < allowed) {
    errors.push(
      `${file}: erasure count fell ${allowed} → ${now} — ratchet DOWN: run ` +
      `\`pnpm check:slot-lookup --update\` and commit the baseline.`,
    );
  }
}

// The key set must only ever SHRINK. Counts alone cannot see the last move:
// a genuinely-erasing NEW file added to the baseline matches its own count and
// sails through, which would turn the grandfather list into a general-purpose
// mute button. The reference is the baseline as it stands on the merge base
// with origin/main — on a sweep branch keys only disappear, and on main the
// merge base is HEAD, so the comparison is a no-op there.
let monotonicity = null;
try {
  const git = (...args) =>
    execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let base;
  for (const ref of ['origin/main', 'main']) {
    try { base = git('merge-base', 'HEAD', ref); break; } catch { /* try the next ref */ }
  }
  if (base) {
    const previous = JSON.parse(git('show', `${base}:${BASELINE_PATH}`));
    const added = Object.keys(baseline).filter((f) => !(f in previous));
    monotonicity = { base: base.slice(0, 7), added };
  }
} catch {
  // No git, a shallow clone without the base, or the baseline is new on this
  // branch (`git show` fails). Reported below rather than passed over — a
  // check that cannot run must not read as a check that passed.
}

if (monotonicity?.added.length) {
  for (const file of monotonicity.added) {
    errors.push(
      `${file}: ADDED to the baseline (not present at ${monotonicity.base}). The ` +
      `grandfather list is not a mute button — it only ever shrinks. Type this ` +
      `file's lookups instead; see issue #4251.`,
    );
  }
}

const totalSites = Object.values(sorted).reduce((a, b) => a + b, 0);
const totalFiles = Object.keys(sorted).length;

if (errors.length > 0) {
  console.error(`✗ slot-lookup ratchet (${errors.length} problem(s)):\n`);
  for (const e of errors) console.error(`  • ${e}`);
  console.error(
    `\nUnswept: ${totalSites} site(s) in ${totalFiles} file(s). ` +
    `Sweeping is #4251's batch work — see SLOT_LOOKUP_UNSWEPT in eslint.config.mjs.`,
  );
  process.exit(1);
}

console.log(
  `✓ slot-lookup ratchet holds: ${totalSites} unswept site(s) in ${totalFiles} file(s), ` +
  `none new. Every other file under packages/ is covered by \`pnpm lint\`.`,
);
console.log(
  monotonicity
    ? `  baseline key set verified against ${monotonicity.base}: no files added.`
    : `  NOT verified: could not read the baseline at the merge base with main ` +
      `(no git, shallow clone, or the baseline is new here), so "no files added" ` +
      `is unchecked this run.`,
);
