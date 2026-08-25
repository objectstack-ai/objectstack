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
// And it REFUSES to report at all (exit 2) when a file in the population does
// not PARSE. ESLint's Node API returns a parse failure as a message carrying no
// rule id, which matches nothing this script counts, so before #10123 such a
// file contributed zero sites and this gate printed `✓ … holds` and exited 0 —
// a clean verdict on a file it had never read, while `pnpm lint` failed loudly
// on the same input. scripts/eslint-fatal-guard.mjs carries the measurement and
// why a fatal is the measurement failing rather than a finding.
//
//   node scripts/check-slot-lookup-ratchet.mjs [--update]
//   node scripts/check-slot-lookup-ratchet.mjs --self-test
//
// The counts are produced by running ESLint itself with the baseline's
// `ignores` lifted, and reports are matched by the rule's exact message
// (imported from the config). The counter therefore cannot drift from the
// rule: change the selectors and this re-measures against them.
//
// Sweeping a file means typing its lookups (pass the slot's contract), then
// `--update` to drop or shrink its entry. Entries only ever go down; a batch
// that adds one is doing the opposite of the job.
//
// ## Why this gate ships a `--self-test` (#12052)
//
// This is a shrink-only ratchet, and its production verdict is the emptiness of
// a finding set: green means nothing was found, weakening the rule can only
// SHRINK what is found, and the empty set is the fixed point of shrinking
// (`scripts/check-self-test-wired.mjs` opens with that argument). Of the 33
// shrink-only ratchets under `scripts/`, this one shipped NO `selfTest()` at
// all — and `check-self-test-wired.mjs` could not see the hole, because it
// enforces the mechanically decidable superset ("every script CI runs that
// ships a `--self-test` must have that self-test run by CI too"), which a gate
// shipping none is outside BY CONSTRUCTION.
//
// Two halves of this file are unreachable from a clean tree in the strict sense
// — no mutation of them moves the production verdict at all:
//
//   • `diffRatchet()`. On a tree that matches its baseline every comparison
//     branch is untaken, so deleting one is invisible. MEASURED (#12052):
//     deleting the `count > allowed` branch left `node
//     scripts/check-slot-lookup-ratchet.mjs` GREEN (exit 0, the same 107
//     site(s) in 25 file(s) line) while `--self-test` went RED naming the case.
//   • the two REFUSALS below (`ruleBlockProblem`, `populationScopeProblem`).
//     Both exist for a rule that has been renamed, rescoped or split, which is
//     precisely the state in which nothing else in this file is meaningful.
//
// The DETECTOR half is different, and this file states the difference rather
// than claiming a uniform blindness: because a fall below the baseline is
// itself an error here, a weakening broad enough to erase live sites reddens
// the production run too (MEASURED: narrowing SLOT_LOOKUPS to `resolveService`
// alone reddens both). What that argument does not cover is a weakening over a
// shape with no live sites, an over-fire (which the ratchet cannot see at all
// once a file is already baselined), or either refusal above. So the self-test
// drives the REAL rule — the one `eslint.config.mjs` exports and the production
// run counts — over synthetic sources, in BOTH directions: every erasure shape
// proved to REPORT, and every canonical spelling proved to stay SILENT.
//
// ⚠️ The silent half pins the rule that EXISTS. `check:slot-lookup` enforces
// that a lookup is TYPED; it does not check that the named type is COMPLETE.
// #11681 recorded a hand-written per-consumer interface that under-stated its
// consumer by a whole method while this gate stayed green, and was closed
// `not_planned` on 2026-08-25 — a completeness check has no ground truth for
// deliberately narrow per-consumer interfaces (the #4251 B4 decision for an
// OPTIONAL slot). So the narrow-interface fixture below asserts SILENCE on
// purpose: a case asserting completeness would pin a rule this gate does not
// have, and would go red the day someone reads it as a bug.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireDependency } from './import-prerequisite.mjs';
const { ESLint } = await requireDependency('eslint', () => import('eslint'), import.meta.url);

const { default: eslintConfig, SLOT_LOOKUP_ANY_MESSAGE } = await requireDependency('../eslint.config.mjs', () => import('../eslint.config.mjs'), import.meta.url);
import { lintFilesStrict, lintTextStrict } from './eslint-fatal-guard.mjs';
import { ensureStackHeadroom } from './eslint-stack-headroom.mjs';

// This gate lints IN-PROCESS, so it does not inherit the `--stack-size` the
// root `lint` script puts on ESLint's CLI entry, and this repo's deepest file
// does not parse without it (#10449). Re-exec once, before any linting — and
// before `--self-test` too, whose fixtures are only a fact about this gate if
// they are linted on the stack the gate actually runs with.
ensureStackHeadroom(fileURLToPath(import.meta.url));

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

const carriesRule = (entry) => {
  const rule = entry?.rules?.['no-restricted-syntax'];
  return Array.isArray(rule) && rule.some((r) => r?.message === SLOT_LOOKUP_ANY_MESSAGE);
};

/**
 * The config with a chosen set of `ignores` entries dropped from the block that
 * carries the rule — every baselined file measured as if it were already swept.
 * Every other config entry passes through untouched, so the run stays
 * byte-identical to `pnpm lint` in all other respects.
 */
function measuringConfig(drop, config = eslintConfig) {
  return config.map((entry) =>
    carriesRule(entry)
      ? { ...entry, ignores: (entry.ignores ?? []).filter((p) => !drop.has(p)) }
      : entry,
  );
}

/**
 * THE COUNTING PREDICATE. The rule reports from four shapes (three selectors
 * plus the `slot-lookup/no-any-assignment` plugin rule) under one exact
 * message, so the count is matched on the message and this gate never has to
 * know there are four. Shared by the production measurement and `--self-test`,
 * so a self-test case cannot pass through a counter the gate does not use.
 */
const countRuleHits = (messages) =>
  (messages ?? []).filter((m) => m.message === SLOT_LOOKUP_ANY_MESSAGE).length;

async function measure(drop) {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    baseConfig: measuringConfig(drop),
    // Match the root `lint` script: this repo lints with --no-inline-config on
    // purpose, so an eslint-disable comment must not shrink a count here either.
    allowInlineConfig: false,
  });
  // Not `eslint.lintFiles`: a parse failure inside the population is the
  // measurement failing, not a file with nothing to report, and it matches none
  // of the filters below. The guard names the file and stops (#10123).
  const results = await lintFilesStrict(eslint, [LINT_TARGET], {
    gate: 'check-slot-lookup-ratchet',
    repoRoot,
  });
  const counts = {};
  for (const result of results) {
    const hits = countRuleHits(result.messages);
    if (hits > 0) counts[relative(repoRoot, result.filePath).replace(/\\/g, '/')] = hits;
  }
  return counts;
}

const sortKeys = (counts) =>
  Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));

/**
 * REFUSAL 1: the rule is gone. Returns the refusal text, or null.
 *
 * A renamed rule, a removed one, or a changed message all produce the same
 * observable — zero reports — which is indistinguishable from a swept tree.
 */
function ruleBlockProblem(config) {
  if (config.some(carriesRule)) return null;
  return (
    'check-slot-lookup-ratchet: no config block carries the slot-lookup rule.\n' +
    'The rule was renamed, removed, or its message changed without updating\n' +
    'SLOT_LOOKUP_ANY_MESSAGE — refusing to report "clean" for a rule that is\n' +
    'no longer being measured.'
  );
}

/**
 * REFUSAL 2: the declaration above states what this gate READS, and a dispatch
 * pastes it into a prompt as a lead. It is only true while it agrees with the
 * scope the RULE is configured for — the config block's own `files`. Copies in
 * two files drift silently, so the agreement is asserted rather than assumed:
 * if the rule is ever rescoped (another extension, another root, a second
 * block), this refuses to run instead of measuring a population that no longer
 * matches either what `pnpm lint` enforces or what `dispatch-gates` was told.
 *
 * Returns the refusal text, or null.
 */
function populationScopeProblem(config) {
  const ruleScopes = config.filter(carriesRule).flatMap((entry) => entry.files ?? []);
  if (ruleScopes.length === 1 && ruleScopes[0] === LINT_TARGET) return null;
  return (
    'check-slot-lookup-ratchet: the declared population no longer matches the\n' +
    'scope the rule is configured for.\n' +
    `  declared here: ${LINT_TARGET}\n` +
    `  rule is scoped to: ${ruleScopes.join(', ') || '(nothing)'}\n` +
    'Update POPULATION_GLOB/LINT_TARGET in this file to match eslint.config.mjs.\n' +
    'This declaration is read by scripts/pm/dispatch-gates.mjs to decide which\n' +
    'cards are told to run this gate, so a stale one is a wrong lead, not a\n' +
    'cosmetic mismatch — refusing rather than measuring the wrong set.'
  );
}

/**
 * Every failure this gate can report, as a pure function of the measured facts.
 * Kept pure so --self-test can drive it in BOTH directions without needing a
 * repo in a particular state — the comparison logic is the half of this script
 * that a green run over a clean tree cannot exercise at all.
 */
function diffRatchet({ baseline, current, addedBaselineKeys }) {
  const errors = [];

  for (const [file, count] of Object.entries(current)) {
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
    const now = current[file];
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
  // mute button.
  for (const file of addedBaselineKeys ?? []) {
    errors.push(
      `${file}: ADDED to the baseline. The grandfather list is not a mute button — it ` +
      `only ever shrinks. Type this file's lookups instead; see issue #4251.`,
    );
  }

  return errors;
}

/**
 * Baseline keys that are not present at the merge base with `main`, or null
 * when that reference could not be read.
 *
 * The reference is the baseline as it stands on the merge base with origin/main
 * — on a sweep branch keys only disappear, and on main the merge base is HEAD,
 * so the comparison is a no-op there.
 */
function baselineKeysAddedSinceMergeBase(baselineKeys) {
  try {
    const git = (...args) =>
      execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    let base;
    for (const ref of ['origin/main', 'main']) {
      try { base = git('merge-base', 'HEAD', ref); break; } catch { /* try the next ref */ }
    }
    if (!base) return null;
    const previous = JSON.parse(git('show', `${base}:${BASELINE_PATH}`));
    return { base: base.slice(0, 7), added: baselineKeys.filter((f) => !(f in previous)) };
  } catch {
    // No git, a shallow clone without the base, or the baseline is new on this
    // branch (`git show` fails). Reported by the caller rather than passed over
    // — a check that cannot run must not read as a check that passed.
    return null;
  }
}

// ---------------------------------------------------------------------------
// --self-test

/** A path inside the declared population, for fixtures linted as text. */
const FIXTURE_FILE = 'packages/__slot_lookup_selftest__/src/fixture.ts';

/**
 * A second fixture path, used ONLY as a synthetic grandfather entry.
 *
 * The grandfathering channel is what this whole gate exists to re-measure, and
 * pinning it against a real baseline key would make the pin evaporate on the
 * day the sweep finishes: at 0 entries there is no key to read, and a case that
 * silently stops asserting is worth less than no case (#12050). So the witness
 * is a PAIR built here — the same source, the same config, one synthetic
 * `ignores` entry apart — which stays exercised at baseline zero. The real
 * baseline is then checked too, when it has an entry to check.
 */
const FIXTURE_BASELINED = 'packages/__slot_lookup_selftest__/src/grandfathered.ts';

/** Erasure shapes that MUST report. One per shape the rule knows. */
const REPORTS = [
  ['selector 1 — `: any` on the declarator', "const svc: any = await deps.resolveService('auth', env);"],
  ['selector 2 — `as any` on the call', "const s = ctx.getService('settings') as any;"],
  ['selector 3 — the type-argument form', "const q = ctx.getService<any>('data');"],
  [
    'the plugin rule — declaration and lookup split apart (#4251)',
    "let ql: any; try { ql = ctx.getService('objectql'); } catch { /* optional */ }",
  ],
  [
    'the third lookup name is covered too',
    "const k = await kernel.getRequestKernelService<any>('auth');",
  ],
];

/**
 * Spellings that MUST stay silent. Every one of them is a shape the repo
 * deliberately writes, and a rule that reported them would be argued back out.
 */
const SILENT = [
  ['a typed lookup is the whole point', "const s = ctx.getService<ISettingsService>('settings');"],
  [
    // ⚠️ THE BOUNDARY, pinned deliberately (#11681, closed not_planned).
    // `SettingsReadSurface` names one method; the call reaches another. The
    // gate is TYPED-ness, never COMPLETEness — see this file's header.
    'a narrow per-consumer interface stays silent even where the call exceeds it',
    'interface SettingsReadSurface { get(key: string): Promise<unknown>; }\n' +
    "const s = ctx.getService<SettingsReadSurface>('settings');\n" +
    "await s.getMany(['a', 'b']);",
  ],
  ['an UNCONTRACTED_SLOTS slot is exempt BY NAME', "const p: any = ctx.getService('protocol');"],
  ['the same exemption through the type-argument form', "const m = ctx.getService<any>('mcp');"],
  ['`getObjectQL` is not a slot lookup', 'const q = ctx.getObjectQL() as any;'],
  ['an `as any` with no lookup in it', 'const x = compute() as any;'],
  [
    'the typed split declaration — the shape the sweep produces',
    "let i18n: II18nService | undefined; i18n = ctx.getService('i18n');",
  ],
  ['a non-any split declaration', "let ql: unknown; ql = ctx.getService('objectql');"],
];

/** The ratchet comparison, in both directions. `base` is two files deep. */
const DIFF_CASES = (() => {
  const baseline = { 'a.ts': 2, 'b.ts': 1 };
  return [
    ['identical is clean', { baseline, current: { ...baseline }, addedBaselineKeys: [] }, 0],
    ['a new file fails', { baseline, current: { ...baseline, 'c.ts': 1 }, addedBaselineKeys: [] }, 1],
    ['growth in a baselined file fails', { baseline, current: { 'a.ts': 3, 'b.ts': 1 }, addedBaselineKeys: [] }, 1],
    ['a fall must be ratcheted down', { baseline, current: { 'a.ts': 1, 'b.ts': 1 }, addedBaselineKeys: [] }, 1],
    ['a cleaned file must be dropped', { baseline, current: { 'a.ts': 2 }, addedBaselineKeys: [] }, 1],
    ['a key added to the baseline fails', { baseline, current: { ...baseline }, addedBaselineKeys: ['b.ts'] }, 1],
  ];
})();

async function selfTest() {
  const failures = [];
  const assert = (cond, msg) => { if (!cond) failures.push(msg); };

  /** Lint one fixture through a chosen config and COUNT it the way the gate does. */
  const hitsUnder = async (config, code, filePath = FIXTURE_FILE) => {
    const eslint = new ESLint({
      cwd: repoRoot,
      overrideConfigFile: true,
      baseConfig: config,
      allowInlineConfig: false,
    });
    // Counted, therefore guarded (#10599). A fixture that stops parsing yields
    // zero matching messages — exactly what the SILENT cases assert — so an
    // unguarded count here would read a TYPO as proof the rule is correctly
    // quiet. A fatal becomes a self-test failure naming the fixture.
    const [result] = await lintTextStrict(eslint, code, {
      filePath,
      warnIgnored: false,
      gate: 'check-slot-lookup-ratchet --self-test fixture',
      repoRoot,
      onFatal: (report) => { failures.push(report); return []; },
    });
    return countRuleHits(result?.messages);
  };

  // ── 1. The rule, in both directions, over synthetic sources. ──────────────
  //
  // The config is the REAL one from eslint.config.mjs with the baseline's
  // grandfathering lifted — the same construction `measure()` runs — so these
  // cases move with the rule and cannot be satisfied by a re-implementation.
  const baseline = JSON.parse(readFileSync(resolve(repoRoot, BASELINE_PATH), 'utf8'));
  const measuring = measuringConfig(new Set(Object.keys(baseline)));

  for (const [name, code] of REPORTS) {
    assert(await hitsUnder(measuring, code) >= 1, `expected a report for ${name}: ${code}`);
  }
  for (const [name, code] of SILENT) {
    const hits = await hitsUnder(measuring, code);
    assert(hits === 0, `expected NO report for ${name} (got ${hits}): ${code}`);
  }

  // ── 2. The grandfathering channel, as a synthetic witness pair. ───────────
  //
  // Same source, same config, one `ignores` entry apart. This is the move the
  // whole gate is built around — an ignored file is ignored COMPLETELY — so it
  // is proved rather than assumed, and proved in a way that survives the
  // baseline shrinking to zero entries.
  {
    const code = "const s = ctx.getService<any>('data');";
    const withEntry = eslintConfig.map((entry) =>
      carriesRule(entry)
        ? { ...entry, ignores: [...(entry.ignores ?? []), FIXTURE_BASELINED] }
        : entry,
    );
    const lifted = measuringConfig(new Set([FIXTURE_BASELINED]), withEntry);
    assert(
      (await hitsUnder(withEntry, code, FIXTURE_BASELINED)) === 0,
      'a grandfathered path must be silent while its entry stands — otherwise the ' +
      'baseline is not what silences a listed file, and this gate measures nothing new',
    );
    assert(
      (await hitsUnder(lifted, code, FIXTURE_BASELINED)) >= 1,
      'the SAME path must report once its entry is lifted — that lift is the whole ' +
      'measurement this gate performs',
    );
    assert(
      (await hitsUnder(withEntry, code)) >= 1,
      'a path that is not grandfathered must report under the blocking config',
    );

    // And the real baseline, when it still has an entry to prove it with. The
    // pair above is what keeps this half honest once it does not.
    const realEntry = Object.keys(baseline)[0];
    if (realEntry !== undefined) {
      assert(
        (await hitsUnder(eslintConfig, code, realEntry)) === 0,
        `a baselined path must be silent under the blocking config (${realEntry})`,
      );
      assert(
        (await hitsUnder(measuring, code, realEntry)) >= 1,
        `and must be measured once this gate lifts the grandfathering (${realEntry})`,
      );
    }
  }

  // ── 3. The ratchet comparison, in both directions. ────────────────────────
  for (const [name, input, expected] of DIFF_CASES) {
    const got = diffRatchet(input).length;
    assert(got === expected, `diffRatchet: ${name} — expected ${expected} error(s), got ${got}`);
  }

  // ── 4. Both refusals, in both directions. ─────────────────────────────────
  //
  // Neither is reachable from a tree where the rule is healthy, so a green
  // production run says nothing about either — they are the strictest case of
  // the argument in this file's header.
  {
    assert(ruleBlockProblem(eslintConfig) === null, 'the live config must carry the slot-lookup rule');
    const renamed = eslintConfig.map((entry) =>
      carriesRule(entry)
        ? { ...entry, rules: { ...entry.rules, 'no-restricted-syntax': ['error', { selector: 'X', message: 'renamed' }] } }
        : entry,
    );
    assert(
      ruleBlockProblem(renamed) !== null,
      'a config whose rule message changed must REFUSE, not report a clean tree',
    );

    assert(
      populationScopeProblem(eslintConfig) === null,
      'the declared population must match the scope the rule is configured for',
    );
    const rescoped = eslintConfig.map((entry) =>
      carriesRule(entry) ? { ...entry, files: ['packages/runtime/**/*.{ts,tsx,mts,cts}'] } : entry,
    );
    assert(
      populationScopeProblem(rescoped) !== null,
      'a rule narrowed back to one package must REFUSE — that narrower scope is the ' +
      'pre-#4251 state in which 77 of 80 known sites went unlinted while looking covered',
    );
    const doubled = [...eslintConfig, ...eslintConfig.filter(carriesRule)];
    assert(
      populationScopeProblem(doubled) !== null,
      'a SECOND block carrying the rule must REFUSE — the declaration names one scope',
    );
  }

  // ── 5. The counter and the rule cannot disagree. ──────────────────────────
  //
  // `countRuleHits` matches on the exact message, which is what lets four
  // report shapes be counted by a gate that knows of none of them.
  assert(
    countRuleHits([{ message: SLOT_LOOKUP_ANY_MESSAGE }, { message: 'something else' }]) === 1,
    'the counter must match the rule message exactly',
  );
  assert(
    /#4251/.test(SLOT_LOOKUP_ANY_MESSAGE) && /UNCONTRACTED_SLOTS/.test(SLOT_LOOKUP_ANY_MESSAGE),
    'the rule message must keep naming the sweep card and the one reviewable exemption ' +
    'channel — this repo lints with --no-inline-config, so an author who reads only the ' +
    'message must still be told where a legitimate `any` is declared',
  );

  if (failures.length > 0) {
    console.error(`✗ check-slot-lookup-ratchet --self-test: ${failures.length} failure(s).\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }

  console.log(
    `✓ check-slot-lookup-ratchet --self-test: the live rule reports all ${REPORTS.length} ` +
    `erasure shape(s) and stays silent on all ${SILENT.length} canonical spelling(s) ` +
    `(including the narrow per-consumer interface #11681 closed not_planned — this gate ` +
    `checks TYPED, never COMPLETE); the grandfathering channel proved both ways on a ` +
    `synthetic witness pair that survives baseline zero; ${DIFF_CASES.length} ratchet ` +
    `comparison case(s); and both refusals proved in both directions.`,
  );
}

// ---------------------------------------------------------------------------
// main

async function main() {
  const blocked = ruleBlockProblem(eslintConfig) ?? populationScopeProblem(eslintConfig);
  if (blocked !== null) {
    console.error(blocked);
    process.exit(2);
  }

  const update = process.argv.includes('--update');
  const baseline = JSON.parse(readFileSync(resolve(repoRoot, BASELINE_PATH), 'utf8'));
  const sorted = sortKeys(await measure(new Set(Object.keys(baseline))));

  if (update) {
    writeFileSync(resolve(repoRoot, BASELINE_PATH), JSON.stringify(sorted, null, 2) + '\n');
    const files = Object.keys(sorted).length;
    const sites = Object.values(sorted).reduce((a, b) => a + b, 0);
    console.log(`slot-lookup baseline updated: ${sites} site(s) in ${files} file(s).`);
    process.exit(0);
  }

  const monotonicity = baselineKeysAddedSinceMergeBase(Object.keys(baseline));
  const errors = diffRatchet({
    baseline,
    current: sorted,
    addedBaselineKeys: monotonicity?.added ?? [],
  });

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
    `none new, and every file in the population parsed. Every other file under ` +
    `packages/ is covered by \`pnpm lint\`.`,
  );
  console.log(
    monotonicity
      ? `  baseline key set verified against ${monotonicity.base}: no files added.`
      : `  NOT verified: could not read the baseline at the merge base with main ` +
        `(no git, shallow clone, or the baseline is new here), so "no files added" ` +
        `is unchecked this run.`,
  );
}

if (process.argv.includes('--self-test')) {
  await selfTest();
  process.exit(0);
}
await main();
