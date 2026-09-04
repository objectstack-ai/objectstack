#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-i18n-walk-parity — every translation GROUP `@objectstack/spec` declares
 * is a group the CLI extractor actually walks.
 *
 *   node scripts/check-i18n-walk-parity.mjs              # the parity verdict
 *   node scripts/check-i18n-walk-parity.mjs --list       # declared / walked / ledger, side by side
 *   node scripts/check-i18n-walk-parity.mjs --self-test  # the classifiers, no build needed
 *
 * ## The defect class, which has now recurred five times
 *
 * A translation key family lands in `packages/spec` with a RESOLVER that reads
 * it, and the CLI EXTRACTOR that produces the coverage population is updated
 * later, or not at all. Between those two moments every gate is green while the
 * ratchet measures a population it cannot see — `os i18n extract` scaffolds no
 * key for the family, so no translator is ever asked for one, so
 * `check:i18n-coverage` counts a debt of zero and reports OK.
 *
 *   flow screens             resolver landed, extractor followed one release later
 *   nested page components   `translatePage` learned depth; the walker did not
 *   bulk actions             \
 *   datasets                  >  three families at once: declared, each with a
 *   object validation msgs   /   reader, and ZERO keys produced
 *   inline object actions +  the walker's own header records this one, from
 *   object-nested listViews  before the four above ("scaffoldable but ungated,
 *                            which is how English approval buttons shipped")
 *
 * Every one was found by a person noticing. The measurement that closes the
 * loop did not exist; this file is it. The property that makes it worth its
 * cost is not that it is thorough — it is that it would have failed on the day
 * the three-family change landed, which is exactly what the four earlier
 * instances lacked.
 *
 * ## What it compares, and why it is not a derivation
 *
 * ⛔ This gate does NOT derive the extractor from the resolvers. That was
 * measured and rejected: the two enumerations answer different questions over
 * different inputs — a resolver reads the SERVED document shape, the walker
 * reads the AUTHORED stack config; key identity is the walker's own problem (a
 * view container's default list resolves its registry name and emits no key of
 * its own); the `inline` / `sourceValue` split exists only walker-side and
 * turns on renderer fallbacks that live in another repo; and the deliberate
 * exclusions live in a third place again.
 *
 * What IS machine-readable is the half that keeps drifting: the key FACE. So
 * the comparison is deliberately coarse and total —
 *
 *   declared  the top-level keys of `translationDataShape()`, read off the
 *             BUILT `TranslationDataSchema`'s zod shape. The contract, not the
 *             source text: a gate that greps the `.ts` file would agree with a
 *             comment and disagree with the schema.
 *   walked    the `path[0]` of every entry `collectExpectedEntries` produces
 *             over one fixture that authors a member of every group. The
 *             walker's own output, not a transcription of its header.
 *   ledger    the groups that legitimately have no extractor face at all, each
 *             carrying the REASON. Holds three entries by the 2026-09-04
 *             ruling, and only shrinks from there (below).
 *
 * and the assertion is two set differences:
 *
 *   declared \ (walked ∪ ledger) = ∅     an unwalked group — the defect class
 *   ledger \ declared            = ∅     a stale ledger entry
 *   ledger ∩ walked              = ∅     a stale ledger entry (it IS walked)
 *
 * ## Why the unit is the TOP-LEVEL group and not every leaf key
 *
 * Because that is the unit the two sides can both name. `path[0]` is what the
 * walker emits and a top-level shape key is what the schema declares; below
 * that line the two vocabularies stop corresponding — the shape says
 * `dimensions.<d>.label` is a record of strict objects, the walker says it is
 * one `pushOptional` inside a loop, and neither is derivable from the other.
 * The liveness ledger for this same schema draws the boundary in the same
 * place and says so out loud: "WALK BOUNDARY: every group is a z.record keyed
 * by target names — the drill sees each record's VALUE shape one level; the
 * deeper per-key conventions … are governed by the resolvers cited per row".
 * A per-leaf gate would be a second, hand-maintained face of the walker, which
 * is the thing this repo removes rather than adds.
 *
 * The cost of the coarse unit is stated rather than hidden: a group that gains
 * a NEW LEAF the walker does not emit stays green here. That is a narrower
 * defect than a whole family with no keys at all, and it is the one the
 * per-family pin tests under `packages/cli/test/i18n-*-coverage.test.ts` are
 * for.
 *
 * ## The exemption ledger, and the two constraints that keep it honest
 *
 * Some groups may legitimately have no extractor face — a group keyed by
 * strings no stack config declares cannot be scaffolded from one. A gate that
 * can say "this one legitimately has none" OUT LOUD is worth building; a gate
 * whose ledger grows quietly is worse than no gate, because it converts a
 * visible drift into an invisible one. So:
 *
 *   1. Every entry carries the reason the group has no extractor face. A blank
 *      or placeholder reason fails — see `LEDGER_REASON_FLOOR`.
 *   2. It is SHRINK-ONLY, in the `KNOWN_IMPORT_UNSAFE` shape one file over: a
 *      stale entry fails and names itself, and `LEDGER_CEILING` refuses growth
 *      the author did not edit in the same diff. Both directions of that
 *      ratchet are enforced — a ceiling above the real size fails too, so the
 *      number can only be walked down.
 *
 * ⛔ A red is not a ledger entry, and the ledger path is MAINTAINER-ONLY. "This
 * group legitimately has no extractor face" is a decision with a reason
 * attached, owned by whoever owns the walker; putting a group in here to get to
 * green is the same silence this gate exists to break, now with a comment on
 * it. The unwalked-group message names that owner beside the offer, which is
 * what `check:ratchet-remedy-authority` requires of a remedy that expands a
 * shrink-only registry (#8435) — remedy 1, emitting the group, is the landing
 * author's and is offered freely.
 *
 * ## What it requires, and what it refuses to do without
 *
 * Both sides are read from BUILT output — `packages/spec/dist` for the schema
 * and `packages/cli/dist` for the walker — the same prerequisite
 * `check-i18n-coverage.mjs` states one file over, and for the same reason: an
 * unbuilt tree makes the walker unimportable, and a gate that falls back to
 * source text would answer a different question with the same exit code.
 * "Prefer failing to falling back": the prerequisite verdict is a HARD failure
 * that says it measured NOTHING, never a skip. An empty declared or walked set
 * is refused for the same reason — zero groups is a broken scan, not a schema
 * with nothing in it.
 *
 * `--self-test` needs neither: it drives the pure classifiers against recorded
 * samples, exactly as its sibling does.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
// Imported for the remedy vocabulary — and, deliberately, for what a consumer
// of that module INHERITS as its declared population: `packages/cli/src`, the
// tree whose compiled output is this gate's walked side. A card that deletes an
// emitter from the walker is exactly the card that must see this gate named in
// its brief, and that is the edge this import buys.
import { CLI_BUILD_FIX, workspaceBuildFix } from './cli-build-prerequisite.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** This script lives in `scripts/`, so the repo root is one level up. */
const REPO_ROOT = resolve(HERE, '..');
/** The ONE seam between this module's repo-relative vocabulary and the disk. */
const at = (rel) => join(REPO_ROOT, rel);

// ── The two built inputs, and the fixture ───────────────────────────────────

/** The DECLARED side: `TranslationDataSchema`, from the built spec. */
const SPEC_SYSTEM_DIST = 'packages/spec/dist/system/index.mjs';
/** The WALKED side: `collectExpectedEntries`, from the built CLI. */
const CLI_WALKER_DIST = 'packages/cli/dist/utils/i18n-extract.js';
/** The schema module a reader edits when a group is added. Named, never read. */
const TRANSLATION_SCHEMA_SRC = 'packages/spec/src/system/translation.zod.ts';
/** The walker a reader edits when a group has no emitter. Named, never read. */
const WALKER_SRC = 'packages/cli/src/utils/i18n-extract.ts';
/** A stack config authoring one member of every group the walker can reach. */
const FIXTURE = 'scripts/fixtures/i18n-walk-parity/every-group.stack.json';

/**
 * The population this gate READS, spelled as a literal array so the dispatch
 * derivation can extract it (a computed spelling contributes nothing and the
 * gate silently drops out of every card's brief). `packages/cli/src` arrives
 * inherited from `cli-build-prerequisite.mjs`; what this declaration adds is
 * the OTHER side — the schema whose group set is half of the comparison, and
 * the fixture whose thinness could fake a red.
 */
const DECLARED_WATCH_HINTS = [
  'packages/spec/src/system/translation.zod.ts/**',
  'scripts/fixtures/i18n-walk-parity/**',
];

// ── The exemption ledger ────────────────────────────────────────────────────

/**
 * ⛔ SHRINK-ONLY, and every line in it was RULED IN — never added to reach
 * green. Groups that legitimately have no extractor face, keyed by group name,
 * valued by the REASON.
 *
 * It no longer starts empty. On this gate's own first red the maintainer ruled
 * (#14653, 2026-09-04, comment 5535827386) that all three unwalked groups enter
 * here with their reasons, and `LEDGER_CEILING` moved 0 → 3 in that same diff.
 * Each entry below is that decision written down, with the reason that carries
 * it — the ⛔ MAINTAINER-ONLY act the unwalked-group message names, performed
 * by the owner it names rather than by a landing author getting past a check.
 *
 * `settings` is the one DEFERRAL among the three, and it says so out loud so
 * that nobody reads the exemption as the answer: its terminal state — a
 * registry-driven emitter on the `metadataForms` precedent, or removal from the
 * per-app schema — is held on #15178.
 *
 * Read the class-level note above before adding anything here. The one-line
 * version: a red belongs to whoever owns the walker, an entry here is a
 * decision and not a way past one, and growth stays MAINTAINER-ONLY — from here
 * the ledger only ever shrinks.
 */
const KNOWN_NO_EXTRACTOR_FACE = Object.freeze({
  messages:
    'Keyed by arbitrary ids composed at the `i18n.t()` call sites (plugin-audit\'s activity-feed and '
    + 'mention strings); no registry and no stack config enumerates that id set, so there is no face for '
    + 'an extractor to walk.',
  settingsCommon:
    'The Settings UI\'s own five source-badge labels (env / global / tenant / user / default) — the '
    + 'console\'s words in every app rather than any app\'s own, ruled out of the per-app bundles on '
    + '#7646.',
  settings:
    'Keyed by `SettingsManifest.namespace`, and manifests are platform code '
    + '(`packages/services/service-settings/src/manifests/*.manifest.ts`), not authored metadata: no stack '
    + 'config carries them, and no consumer asks for per-app settings translations today. A DEFERRAL, not '
    + 'a fact — the terminal state (a registry-driven emitter on the `metadataForms` precedent, or removal '
    + 'from the per-app schema) is held on #15178.',
});

/**
 * The ledger's size ceiling. Growth requires editing this number in the same
 * diff as the entry, which is the whole mechanism: it makes growth a reviewed
 * act rather than a line nobody re-reads. Shrink-only in both directions — a
 * ceiling above the real size fails as slack, so it can only be walked down.
 */
const LEDGER_CEILING = 3;

/**
 * A reason must be a real sentence. The floor is 24 characters and a
 * placeholder-word refusal, because the failure this ledger has to survive is
 * not a missing reason (unrepresentable — the value IS the reason) but a
 * pro-forma one: `datasets: 'n/a'` passes any non-empty test and records
 * nothing anyone can re-judge later.
 */
const LEDGER_REASON_FLOOR = 24;
const PLACEHOLDER_REASON = /^(?:todo|tbd|n\/?a|none|nil|-+|\?+)$/i;

// ── Pure classifiers ────────────────────────────────────────────────────────

/**
 * Problems with the ledger's own SHAPE, independent of any measurement.
 * @param {Record<string, unknown>} ledger
 * @returns {{ group: string, why: string }[]}
 */
export function ledgerShapeProblems(ledger) {
  const problems = [];
  for (const [group, reason] of Object.entries(ledger ?? {})) {
    if (typeof reason !== 'string' || reason.trim() === '') {
      problems.push({ group, why: 'carries no reason — the reason IS the entry' });
      continue;
    }
    const trimmed = reason.trim();
    if (PLACEHOLDER_REASON.test(trimmed)) {
      problems.push({ group, why: `reason is a placeholder (${JSON.stringify(trimmed)}), not a reason` });
      continue;
    }
    if (trimmed.length < LEDGER_REASON_FLOOR) {
      problems.push({
        group,
        why: `reason is ${trimmed.length} characters, under the ${LEDGER_REASON_FLOOR}-character floor`,
      });
    }
  }
  return problems;
}

/**
 * The shrink-only ratchet on the ledger's size, both directions.
 * @param {Record<string, unknown>} ledger
 * @param {number} ceiling
 */
export function ledgerRatchetProblems(ledger, ceiling) {
  const size = Object.keys(ledger ?? {}).length;
  if (size > ceiling) {
    return [
      `the ledger holds ${size} entr${size === 1 ? 'y' : 'ies'} against a ceiling of ${ceiling} — `
      + 'growth is a reviewed act: raise LEDGER_CEILING in the same diff as the entry, or do not add it',
    ];
  }
  if (size < ceiling) {
    return [
      `LEDGER_CEILING is ${ceiling} but the ledger holds ${size} — ratchet it down to ${size}. `
      + 'Slack in a shrink-only ceiling is how one silently becomes an allowlist',
    ];
  }
  return [];
}

/**
 * The parity verdict itself. Sets in, findings out — no I/O, no globals.
 *
 * @param {{ declared: Iterable<string>, walked: Iterable<string>, ledger: Record<string, unknown> }} input
 */
export function parityVerdict({ declared, walked, ledger }) {
  const declaredSet = new Set(declared);
  const walkedSet = new Set(walked);
  const ledgerKeys = Object.keys(ledger ?? {});

  const unwalked = [...declaredSet].filter((g) => !walkedSet.has(g) && !ledgerKeys.includes(g)).sort();
  const staleUndeclared = ledgerKeys.filter((g) => !declaredSet.has(g)).sort();
  const staleWalked = ledgerKeys.filter((g) => declaredSet.has(g) && walkedSet.has(g)).sort();

  return { unwalked, staleUndeclared, staleWalked };
}

/** Zero groups on either side is a broken scan, never a clean tree. */
export function emptyPopulationProblems(declared, walked) {
  const problems = [];
  if ([...declared].length === 0) {
    problems.push(`no translation groups read from ${SPEC_SYSTEM_DIST} — a schema with no groups is a broken read, not a verdict`);
  }
  if ([...walked].length === 0) {
    problems.push(`the walker produced no entries for ${FIXTURE} — an empty walk cannot disagree with anything`);
  }
  return problems;
}

// ── Reading the two sides ───────────────────────────────────────────────────

/** A hard prerequisite failure: says what it did NOT measure, and exits. */
function reportPrerequisiteNotMet(headline, lines) {
  console.error(`❌  check:i18n-walk-parity — PREREQUISITE NOT MET: ${headline}\n`);
  for (const line of lines) console.error(`  ${line}`);
  console.error(
    '\n  NOTHING was measured. This is not "no unwalked groups" — the comparison'
    + '\n  never ran. Build the workspace and run it again:'
    + `\n\n    ${CLI_BUILD_FIX}`
    + `\n    ${workspaceBuildFix('@objectstack/spec')}`
    + '\n',
  );
  process.exit(1);
}

async function loadBuilt(rel, what) {
  if (!existsSync(at(rel))) {
    reportPrerequisiteNotMet(`${what} is not built`, [
      'This gate reads the CONTRACT and the WALKER from built output, so that it',
      'compares what ships rather than what the source text says. That output is',
      'not there:',
      '',
      `  ${rel}`,
    ]);
  }
  try {
    return await import(pathToFileURL(at(rel)).href);
  } catch (err) {
    reportPrerequisiteNotMet(`${what} could not be loaded`, [
      `  ${rel}`,
      '',
      `${err?.message ?? err}`,
      '',
      'A workspace package this module imports has no `dist/` yet, so the walk',
      'could not be run at all.',
    ]);
  }
  return undefined;
}

/** The declared side: top-level keys of the built `TranslationDataSchema`. */
export function declaredGroupsOf(mod) {
  const schema = mod?.TranslationDataSchema;
  const shape = schema?.shape;
  if (!shape || typeof shape !== 'object') {
    reportPrerequisiteNotMet('TranslationDataSchema exposes no zod shape', [
      `  ${SPEC_SYSTEM_DIST} exported ${schema === undefined ? 'no TranslationDataSchema' : 'a TranslationDataSchema with no .shape'}.`,
      '',
      'The declared side is read off the schema OBJECT on purpose — a text scan of',
      `${TRANSLATION_SCHEMA_SRC} would agree with a comment and`,
      'disagree with the contract. If the schema stopped being a strict object,',
      'this gate needs re-pointing, not a fallback.',
    ]);
  }
  return Object.keys(shape).sort();
}

/** The walked side: `path[0]` of every entry the walker emits for the fixture. */
export function walkedGroupsOf(mod, config) {
  const collect = mod?.collectExpectedEntries;
  if (typeof collect !== 'function') {
    reportPrerequisiteNotMet('collectExpectedEntries is not exported by the built walker', [
      `  ${CLI_WALKER_DIST}`,
      '',
      `It is defined once, in ${WALKER_SRC}. A rename here is a`,
      're-point, never a fallback to a second walk.',
    ]);
  }
  // ⛔ An EMPTY warned set on purpose. `collectExpectedEntries` defaults to
  // skipping the groups the liveness ledger warns authors away from (`flows`
  // today), which is right for `os lint` and wrong here: this gate asks whether
  // the walker HAS an emitter, not whether the ledger currently lets it run.
  // Defaulting would report a gated group as unwalked and send someone to write
  // an emitter that already exists.
  const entries = collect(config, { warnedGroups: new Set() });
  return [...new Set(entries.map((e) => e?.path?.[0]).filter((g) => typeof g === 'string' && g))].sort();
}

// ── Reporting ───────────────────────────────────────────────────────────────

function reportUnwalked(unwalked) {
  console.error(
    `❌  check:i18n-walk-parity — ${unwalked.length} declared translation group(s) that the extractor does not walk:\n`,
  );
  for (const group of unwalked) console.error(`  ${group}  — declared in TranslationDataSchema, produced by no emitter`);
  console.error(
    '\n    A group with no emitter is a family nobody is ever asked to translate:'
    + '\n    `os i18n extract` scaffolds no key for it, so `check:i18n-coverage`'
    + '\n    measures a debt of zero and reports OK while the strings ship in English.'
    + '\n'
    + '\n    There are exactly two honest remedies, and picking between them is the'
    + '\n    decision this gate exists to force into the open:'
    + '\n'
    + `\n      1. EMIT IT. Walk the group in ${WALKER_SRC}`
    + `\n         (\`collectExpectedEntries\`) and author a member of it in ${FIXTURE},`
    + '\n         in the same change. This is the remedy for every instance so far.'
    + '\n'
    + '\n      2. LEDGER IT — ⛔ MAINTAINER-ONLY. Adding an entry to'
    + '\n         KNOWN_NO_EXTRACTOR_FACE (and raising LEDGER_CEILING to fit it)'
    + '\n         EXPANDS a shrink-only exemption ledger, which is the author'
    + '\n         excusing themselves from the check they just failed. "This group'
    + '\n         legitimately has no extractor face" is a decision with a reason and'
    + '\n         an owner — the maintainer of the walker — not a step the landing'
    + '\n         author takes to get to green. Report the red and let it be ruled on.'
    + '\n'
    + '\n    ⛔ Not a remedy: deleting the group from the fixture. That answers "does'
    + '\n    the walker produce this group" with "no" for a perfectly healthy walker.'
    + '\n',
  );
}

function reportStale(staleUndeclared, staleWalked) {
  const total = staleUndeclared.length + staleWalked.length;
  console.error(`❌  check:i18n-walk-parity — ${total} stale exemption-ledger entry/entries:\n`);
  for (const g of staleUndeclared) console.error(`  ${g}  — no longer declared by TranslationDataSchema`);
  for (const g of staleWalked) console.error(`  ${g}  — the walker DOES emit it now; the exemption is spent`);
  console.error(
    '\n    Good news, and the ledger has to say so: delete each line above from'
    + '\n    KNOWN_NO_EXTRACTOR_FACE and ratchet LEDGER_CEILING down to match. The'
    + '\n    list only ever shrinks, and a stale line is how one drifts into an'
    + '\n    allowlist nobody re-reads.\n',
  );
}

function list(declared, walked, ledger) {
  const ledgerKeys = new Set(Object.keys(ledger));
  const walkedSet = new Set(walked);
  console.log('check-i18n-walk-parity --list\n');
  console.log(`  declared (${declared.length}) — top-level keys of TranslationDataSchema`);
  for (const g of declared) {
    const state = walkedSet.has(g) ? 'walked' : ledgerKeys.has(g) ? 'ledgered' : 'UNWALKED';
    console.log(`    ${g.padEnd(18)} ${state}`);
  }
  const extra = walked.filter((g) => !declared.includes(g));
  console.log(`\n  walked (${walked.length}) — path[0] over ${FIXTURE}`);
  console.log(`    ${walked.join(', ') || '(none)'}`);
  if (extra.length) console.log(`    ⚠️  emitted but NOT declared: ${extra.join(', ')}`);
  console.log(`\n  ledger (${ledgerKeys.size}/${LEDGER_CEILING})`);
  for (const [g, reason] of Object.entries(ledger)) console.log(`    ${g}: ${reason}`);
  if (!ledgerKeys.size) console.log('    (empty — fully paid down)');
  return 0;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(wantList) {
  const specMod = await loadBuilt(SPEC_SYSTEM_DIST, 'the workspace spec package');
  const cliMod = await loadBuilt(CLI_WALKER_DIST, 'the workspace CLI');

  const declared = declaredGroupsOf(specMod);
  const fixture = JSON.parse(readFileSync(at(FIXTURE), 'utf8'));
  const walked = walkedGroupsOf(cliMod, fixture);
  const ledger = KNOWN_NO_EXTRACTOR_FACE;

  if (wantList) return list(declared, walked, ledger);

  const empty = emptyPopulationProblems(declared, walked);
  if (empty.length) {
    reportPrerequisiteNotMet('the population is empty', empty);
  }

  const shape = ledgerShapeProblems(ledger);
  const ratchet = ledgerRatchetProblems(ledger, LEDGER_CEILING);
  if (shape.length || ratchet.length) {
    console.error(`❌  check:i18n-walk-parity — the exemption ledger itself is malformed:\n`);
    for (const p of shape) console.error(`  ${p.group}  — ${p.why}`);
    for (const line of ratchet) console.error(`  ${line}`);
    console.error('');
    return 1;
  }

  const { unwalked, staleUndeclared, staleWalked } = parityVerdict({ declared, walked, ledger });
  if (unwalked.length) {
    reportUnwalked(unwalked);
    if (staleUndeclared.length || staleWalked.length) reportStale(staleUndeclared, staleWalked);
    return 1;
  }
  if (staleUndeclared.length || staleWalked.length) {
    reportStale(staleUndeclared, staleWalked);
    return 1;
  }

  console.log(
    `✓ check-i18n-walk-parity: ${declared.length} declared group(s), ${walked.length} walked, `
    + `${Object.keys(ledger).length} exempted — every declared group has an extractor face.`,
  );
  return 0;
}

// ── Self-test ───────────────────────────────────────────────────────────────

/**
 * Today's real names, RECORDED — the snapshot half of the pin. Read off the
 * built spec and the built walker on the tree this gate landed on. It is a
 * sample, not a second source of truth: the production run always re-measures.
 * What it buys is that the classifier's verdict over the REAL shape is pinned,
 * so weakening the rule reddens here even on a tree where production is red for
 * its own reasons.
 */
const RECORDED_DECLARED = [
  'apps', 'dashboards', 'datasets', 'flows', 'globalActions', 'messages',
  'metadataForms', 'objects', 'pages', 'settings', 'settingsCommon',
];
const RECORDED_WALKED = [
  'apps', 'dashboards', 'datasets', 'flows', 'globalActions', 'metadataForms', 'objects', 'pages',
];
/**
 * …and the verdict those two produce against an EMPTY ledger — which, since the
 * 2026-09-04 ruling, is also exactly the shipped ledger's key set.
 */
const RECORDED_UNWALKED = ['messages', 'settings', 'settingsCommon'];

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures.length === 0` used to be this self-test's ONLY success
// condition, so "every case held" and "the cases never ran" printed the
// same line. Closed the way PR #13487 validated on check-doc-authoring:
// what is pinned is the registered NAMES, not a number. The floor requires
// the OPENED set to equal the DECLARED set with each battery at or above
// its own count.
//
// This file declares ONE battery, opened at the top of the self-test body. It
// carries fewer than the two named section banners the sectioning criterion
// needs, and ⛔ a comment is NOT promoted to a section head — that is a
// judgement per comment this transplant does not make. The hoisted single
// battery is the shape PR #14896, PR #15003 and PR #15217 landed for exactly
// this case.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The count is a FLOOR, not an equality — adding cases is ordinary work and must
// not red. A battery BELOW its floor means cases stopped running; the remedy is
// to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'check-i18n-walk-parity self-test': 23,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 1;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

let selfTestReachedVerdict = false;

function selfTest() {
  // The battery ledger this self-test's floor is evaluated against (#13489).
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  battery('check-i18n-walk-parity self-test');
  const failures = [];
  let cases = 0;
  // Counted, never transcribed: a hand-typed case count in the success line is a
  // number that goes stale the first time a case is added, and a self-test whose
  // own report is wrong is the last place to keep one.
  const eq = (what, got, want) => {
    registerCase();
    cases += 1;
    const a = JSON.stringify(got);
    const b = JSON.stringify(want);
    if (a !== b) failures.push(`${what}: got ${a}, want ${b}`);
  };

  // 1 — parity holds when every declared group is walked.
  eq('clean parity', parityVerdict({ declared: ['a', 'b'], walked: ['a', 'b'], ledger: {} }),
    { unwalked: [], staleUndeclared: [], staleWalked: [] });

  // 2 — a group ADDED to the schema with no walker change is named.
  eq('declared group with no emitter', parityVerdict({ declared: ['a', 'b'], walked: ['a'], ledger: {} }).unwalked, ['b']);

  // 3 — a group whose emitter was DELETED is named. Same classifier, the other
  //     provenance: the card's executable criterion names both directions and a
  //     rule that only saw one of them would read as covering both.
  eq('emitter deleted', parityVerdict({ declared: ['a', 'b', 'c'], walked: ['a', 'c'], ledger: {} }).unwalked, ['b']);

  // 4 — …unless the ledger names it with a reason.
  eq('ledgered group is not unwalked',
    parityVerdict({ declared: ['a', 'b'], walked: ['a'], ledger: { b: 'no stack config declares a member of this group' } }),
    { unwalked: [], staleUndeclared: [], staleWalked: [] });

  // 5 — a ledger entry with no reason fails.
  eq('blank reason', ledgerShapeProblems({ b: '' }).length, 1);
  eq('whitespace reason', ledgerShapeProblems({ b: '   ' }).length, 1);
  eq('non-string reason', ledgerShapeProblems({ b: null }).length, 1);

  // 6 — …and so does a pro-forma one, which is the shape that actually happens.
  eq('placeholder reason', ledgerShapeProblems({ b: 'n/a' }).length, 1);
  eq('short reason', ledgerShapeProblems({ b: 'no face' }).length, 1);
  eq('real reason accepted', ledgerShapeProblems({ b: 'no stack config declares a member of this group' }).length, 0);

  // 7 — a ledger entry for a group the schema no longer declares is STALE.
  eq('stale: undeclared', parityVerdict({ declared: ['a'], walked: ['a'], ledger: { gone: 'a reason long enough to pass the floor' } }).staleUndeclared, ['gone']);

  // 8 — a ledger entry for a group that IS walked is STALE.
  eq('stale: now walked', parityVerdict({ declared: ['a', 'b'], walked: ['a', 'b'], ledger: { b: 'a reason long enough to pass the floor' } }).staleWalked, ['b']);

  // 9/10 — the size ratchet, both directions.
  eq('ledger growth refused', ledgerRatchetProblems({ b: 'x' }, 0).length, 1);
  eq('ceiling slack refused', ledgerRatchetProblems({}, 1).length, 1);
  eq('ledger at ceiling', ledgerRatchetProblems({}, 0).length, 0);

  // 11/12 — an empty side is a broken scan, not a verdict.
  eq('empty declared refused', emptyPopulationProblems([], ['a']).length, 1);
  eq('empty walked refused', emptyPopulationProblems(['a'], []).length, 1);
  eq('both populated', emptyPopulationProblems(['a'], ['a']).length, 0);

  // 13 — the recorded sample: the classifier's verdict over today's REAL names.
  eq('recorded sample', parityVerdict({ declared: RECORDED_DECLARED, walked: RECORDED_WALKED, ledger: {} }).unwalked, RECORDED_UNWALKED);
  // 14 — the SHIPPED ledger, pinned three ways so the ruling that filled it
  //      cannot erode into an allowlist: it names exactly the recorded unwalked
  //      set (nothing more, nothing less), every reason survives the gate's own
  //      reason checks, and its size is the ceiling — the ratchet classifier, so
  //      an entry added without the ceiling, or a ceiling raised without the
  //      entry, reddens here as well as in production.
  eq('shipped ledger: keys are exactly the recorded unwalked set',
    Object.keys(KNOWN_NO_EXTRACTOR_FACE).sort(), RECORDED_UNWALKED);
  eq('shipped ledger: every reason passes the reason checks',
    ledgerShapeProblems(KNOWN_NO_EXTRACTOR_FACE).length, 0);
  eq('shipped ledger: size is exactly LEDGER_CEILING',
    ledgerRatchetProblems(KNOWN_NO_EXTRACTOR_FACE, LEDGER_CEILING).length, 0);
  eq('recorded sample: hints are live', DECLARED_WATCH_HINTS.length > 0, true);

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ────
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  // The floor's refusal joins the SAME sink the cases use — `failures`, read by
  // the verdict below — so a breached floor cannot be printed over by the
  // success line.
  const floorFailure = (message) => { failures.push(message); };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }

  if (failures.length) {
    console.error(`✗ check-i18n-walk-parity self-test: ${failures.length} failure(s) (cases and floor):\n`);
    for (const f of failures) console.error(`  ${f}`);
    console.error('');
    selfTestReachedVerdict = true;
    return 1;
  }

  console.log(
    `✓ check-i18n-walk-parity self-test: ${cases} cases pass — an added declared group and a deleted `
    + 'emitter are both named, a ledgered group is not, a blank/placeholder/short reason is refused, '
    + 'a stale entry (undeclared, or now walked) fails, the size ratchet refuses growth AND slack, '
    + 'an empty side is refused, the recorded sample of today\'s real group names reproduces its verdict, '
    + 'and the SHIPPED ledger is pinned to exactly that recorded unwalked set — every reason passing the '
    + 'reason checks, its size exactly at the ceiling.',
  );
  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv;
  if (argv.includes('--self-test')) {
    const code = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-i18n-walk-parity self-test: selfTest() returned without reaching its\n'
        + 'verdict, so no success line was printed. Exiting 0 here would report a\n'
        + 'self-test that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    process.exit(code);
  }
  process.exit(await main(argv.includes('--list')));
}
