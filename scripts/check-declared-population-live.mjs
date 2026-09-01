#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-declared-population-live (#13519) -- a gate family that DECLARES a path
 * population must declare at least one path that reaches the tree.
 *
 *   node scripts/check-declared-population-live.mjs              # the sweep (the gate)
 *   node scripts/check-declared-population-live.mjs --list       # every family and its verdict
 *   node scripts/check-declared-population-live.mjs --self-test  # the rule itself
 *
 * ## The failure this exists for, and why nothing could see it
 *
 * The dispatch derivation scans a gate script's module body for path-shaped
 * string literals and treats them as the population that gate reads. The
 * admission test is "quoted, and looks like a repo path" -- which a repo SLUG
 * passes. So a gate whose only such literal was `<owner>/<name>` declared a
 * population of exactly one path, and that path names no tracked file at all.
 *
 * The result is not an error and not an empty answer. It is a family whose
 * declared population is DEAD, printed as an ordinary silence -- byte for byte
 * the output a gate with no literals produces, and indistinguishable from it by
 * anyone reading the brief. The gate in question sweeps every workflow file in
 * the tree; it appeared on no card that edited one, for as long as it existed.
 *
 * ⛔ The repair for that gate is NOT this gate's name in a table, and neither is
 * this file. This lane's triage has ruled three times that "add a gate name to
 * the derivation" is the repair that keeps shipping the same red under the next
 * gate's name. Each under-declaring gate was repaired where the read lives -- a
 * literal population declaration in its own module body, held against the very
 * constant it reads from, so a moved read reds in that gate's own self-test.
 * What is added HERE is the property none of them can hold about itself: that a
 * declaration which reaches nothing is refused OUT LOUD instead of passing for
 * a gate that declared nothing. It names no gate, and it holds for the gate
 * written next year.
 *
 * ## The rule, and why it is per-FAMILY rather than per-literal
 *
 * A family is judged only on the literals it declares ITSELF -- an inherited
 * population belongs to the module it was declared in and is judged there.
 *
 *   - declares nothing            -> nothing to be wrong about. Not a finding:
 *                                    "this gate has no path population" is a
 *                                    legitimate and separately declarable fact.
 *   - declares n, >= 1 reaches    -> live.
 *   - declares n, none reaches    -> REFUSED.
 *
 * Per-literal would be the stricter rule and it is WRONG here, measured rather
 * than assumed: real gates carry path-shaped literals that are not populations
 * -- a repo slug for an API call, a sentinel path that must not exist, a
 * remedy sentence's example. Refusing each of those individually would turn a
 * gate red for spelling a string, and the remedy would be to hide the string,
 * which teaches exactly the wrong lesson. What cannot be defended is a family
 * whose WHOLE declaration is dead: there, the gate is telling the derivation it
 * reads a population and the derivation is reading none.
 *
 * ## Why this is a gate and not a line in the derivation's own self-test
 *
 * The tool's self-test is the right home for claims about the DERIVATION. This
 * is a claim about the TREE -- about what gate authors have written -- and it
 * moves with files this tool does not own. It also has to be able to red
 * without the derivation being wrong, which is the opposite of what a tool
 * self-test asserts.
 *
 * ## What was measured before choosing this rule (at 45b9051248)
 *
 * The rule that suggests itself first is stronger and was implemented and
 * REFUSED: "a gate that enumerates a directory must carry a watch-hint
 * declaration". Over the 193 discovered gate files, 114 enumerate a directory
 * and 86 of those carry no declaration under any spelling of the idiom. A gate
 * shipping with 86 findings is an allowlist with a verdict attached, and an
 * allowlist of gate names is the repair this lane has already ruled against.
 * Most of those 86 are not defects either: they declare their population as
 * ordinary path literals, which is the normal way and invisible to a scan for
 * the idiom.
 *
 * The rule this file ships found exactly 2 families in the same fleet, both of
 * them real: the lead gate above, and one whose only path-shaped literal is the
 * `<owner>/<name>` placeholder inside a refusal message -- a gate that has no
 * path population and can now say so. No allowlist, no ratchet, no names.
 */

import process from 'node:process';

import { discoverFamilies, hintCovers, trackedFiles, watchHintTree } from './pm/dispatch-gates.mjs';
import { isEntrypoint } from './invoked-as.mjs';

export const EXIT_FINDINGS = 1;
export const EXIT_REFUSED = 2;

/**
 * The verdict for ONE family, from its own declared literals and a reachability
 * oracle. Pure: the sweep passes the live corpus, the self-test passes a
 * fixture, and neither can be right about a rule the other is wrong about.
 *
 * @param {string[]} declared literals the family spells ITSELF (not inherited)
 * @param {(hint: string) => boolean} reaches
 * @returns {'no-declaration' | 'live' | 'dead'}
 */
export function declarationVerdict(declared, reaches) {
  const literals = [...new Set(declared ?? [])];
  if (literals.length === 0) return 'no-declaration';
  return literals.some((h) => reaches(h)) ? 'live' : 'dead';
}

/**
 * The literals a family declares in its OWN files, in declaration order.
 *
 * An inherited hint carries a `hintOrigin` recording the module it came from,
 * and that module is judged as its own family (or is a gate file, whose
 * population the follow deliberately leaves to it). Judging an inheritor for
 * its source's declaration would report the same fact once per importer and
 * point every copy at a file the importer's author does not own.
 */
export function ownDeclaredHints(entry) {
  return (entry.hints ?? []).filter((h) => !entry.hintOrigin?.has(h));
}

/** Every family's verdict over the live tree, in discovery order. */
export function sweep() {
  const files = trackedFiles();
  const tree = watchHintTree(files);
  const { byCheck } = discoverFamilies({ tree });
  // ONE reachability answer per distinct literal, memoised: the corpus sweep is
  // the expensive half and several families legitimately declare the same path.
  const cache = new Map();
  const reaches = (hint) => {
    if (!cache.has(hint)) cache.set(hint, files.some((f) => hintCovers(hint, f)));
    return cache.get(hint);
  };
  const rows = [];
  for (const [check, entry] of byCheck) {
    const declared = ownDeclaredHints(entry);
    rows.push({ check, declared, verdict: declarationVerdict(declared, reaches), files: entry.files ?? [] });
  }
  return { rows, families: byCheck.size, corpus: files.length };
}

/**
 * The remedy, spelled per finding rather than once in prose: the two ways out
 * are different edits in different places, and which one applies is a fact
 * about the gate that only its author can settle.
 */
function remedyFor(row) {
  return [
    `  ${row.check}`,
    `    declares: ${row.declared.join(', ')}`,
    `    files:    ${row.files.join(', ') || '(none resolved)'}`,
    '    None of those literals names a tracked path, so the derivation reads this family as',
    '    declaring NO population -- the same output a gate with no literals produces. Either:',
    '      (a) the gate DOES read a population: declare it in that gate\'s own module body as a',
    '          literal array (the ROOT_DIR_WATCH_HINTS idiom), and hold it against the constant',
    '          the gate reads from, in that gate\'s own --self-test; or',
    '      (b) the gate reads no population: say so with a',
    '          `dispatch-gates: no-path-population -- <reason>` marker, and stop spelling the',
    '          path-shaped literal that is being read as a declaration (a slug, a sentinel, an',
    '          example inside a message) so the marker does not contradict the derivation.',
  ].join('\n');
}

function main(argv) {
  const { rows, families, corpus } = sweep();
  if (argv.includes('--list')) {
    for (const row of rows) {
      console.log(`${row.verdict.padEnd(15)} ${row.check}${row.declared.length ? ` -- ${row.declared.join(', ')}` : ''}`);
    }
  }
  // An empty population is the one answer this gate must never print a green
  // over: "no family declares a dead population" is vacuously true of a
  // derivation that discovered nothing, and a discovery that silently returns
  // nothing is a live failure mode of the tool this gate reads through.
  const declaring = rows.filter((r) => r.verdict !== 'no-declaration');
  if (families === 0 || declaring.length === 0 || corpus === 0) {
    console.error(
      '✗ check:declared-population-live REFUSES: nothing was judged '
        + `(${families} famil(ies), ${declaring.length} declaring one, ${corpus} tracked file(s)). `
        + 'A run that judged no declaration says nothing about the tree.',
    );
    return EXIT_REFUSED;
  }
  const dead = rows.filter((r) => r.verdict === 'dead');
  if (dead.length > 0) {
    console.error(
      `✗ check:declared-population-live: ${dead.length} of ${declaring.length} declaring famil(ies) declare a `
        + 'population that reaches NOTHING in this tree.\n',
    );
    for (const row of dead) console.error(`${remedyFor(row)}\n`);
    return EXIT_FINDINGS;
  }
  console.log(
    `✓ check:declared-population-live — ${declaring.length} of ${families} famil(ies) declare a path population, `
      + `and every one of them reaches this tree's ${corpus} tracked file(s).`,
  );
  return 0;
}

function selfTest() {
  const failures = [];
  let checked = 0;
  const t = (name, ok, detail) => {
    checked += 1;
    if (!ok) failures.push(detail ? `${name} -- ${detail}` : name);
  };

  // ── The rule, on fixtures. Every case names the VERDICT, never "it returned
  //    something": the defect this gate exists for produces a coherent,
  //    plausible answer, and a case that only checked for an answer is green
  //    against it.
  const live = new Set(['a/b.mjs', 'c/d']);
  const reaches = (h) => live.has(h);
  t('a family that declares nothing is not a finding', declarationVerdict([], reaches) === 'no-declaration');
  t('…and neither is one whose hint list is absent', declarationVerdict(undefined, reaches) === 'no-declaration');
  t('one live literal is enough', declarationVerdict(['a/b.mjs'], reaches) === 'live');
  t(
    '…including alongside dead ones, which is the whole reason the rule is per-FAMILY',
    declarationVerdict(['owner/name', 'a/b.mjs'], reaches) === 'live',
  );
  t('a lone dead literal is the finding', declarationVerdict(['owner/name'], reaches) === 'dead');
  t('so is a whole declaration of dead ones', declarationVerdict(['owner/name', 'x/y'], reaches) === 'dead');
  t(
    'duplicates do not turn a dead declaration live',
    declarationVerdict(['owner/name', 'owner/name'], reaches) === 'dead',
  );

  // Inheritance: an inherited hint belongs to the module that declared it, and
  // must not rescue -- or condemn -- the family that inherited it.
  const inherited = { hints: ['owner/name', 'a/b.mjs'], hintOrigin: new Map([['a/b.mjs', 'scripts/shared.mjs']]) };
  t('an inherited hint is not part of what a family declares', ownDeclaredHints(inherited).join(',') === 'owner/name');
  t(
    '…so a family whose only LIVE hint is inherited is still declaring a dead population',
    declarationVerdict(ownDeclaredHints(inherited), reaches) === 'dead',
  );
  const noOrigin = { hints: ['a/b.mjs'] };
  t('a family with no origin map declares everything it spells', ownDeclaredHints(noOrigin).join(',') === 'a/b.mjs');

  // ── The live half: the fleet, and the two non-vacuity claims a count cannot
  //    make on its own.
  const { rows, families, corpus } = sweep();
  t(`the sweep discovers families to judge (${families})`, families > 0);
  t(`and a corpus to judge them against (${corpus} tracked files)`, corpus > 0);
  const declaring = rows.filter((r) => r.verdict !== 'no-declaration');
  t(
    `the fleet really carries declared populations, so a green is not vacuous (${declaring.length} declaring)`,
    declaring.length > 0,
  );
  t(
    'and it carries families that declare nothing, so the no-declaration branch is exercised too',
    rows.some((r) => r.verdict === 'no-declaration'),
  );
  // The oracle is not trivially true: a literal this tree cannot have must come
  // back dead through the SAME path the sweep uses.
  const files = trackedFiles();
  t(
    'the reachability oracle can answer NO for a path this tree does not have',
    !files.some((f) => hintCovers('no-such-dir-13519/no-such-file.mjs', f)),
  );
  // The YES side names the module this gate IMPORTS rather than this file:
  // untracked is exactly what a file looks like while it is being written, and
  // an oracle case that reds for its own newness proves nothing about the
  // oracle. This literal is inside the self-test body, which the hint extractor
  // masks, so it declares no population for this gate.
  t(
    '…and YES for one it does, so the oracle is not answering NO to everything',
    files.some((f) => hintCovers('scripts/pm/dispatch-gates.mjs', f)),
  );

  if (failures.length) {
    console.error(`check-declared-population-live --self-test: ${failures.length} of ${checked} assertion(s) FAILED\n`);
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log(`check-declared-population-live --self-test: ${checked} assertion(s) passed.`);
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  process.exit(argv.includes('--self-test') ? selfTest() : main(argv));
}
