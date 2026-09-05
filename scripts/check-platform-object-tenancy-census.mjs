#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-platform-object-tenancy-census -- the platform-object tenancy census is
 * held to the tree, and an exclusion mechanism nobody has adjudicated reds
 * rather than joining a total (#14957).
 *
 *   node scripts/check-platform-object-tenancy-census.mjs
 *   node scripts/check-platform-object-tenancy-census.mjs --self-test
 *
 * ## The failure this exists for, in both of the directions it happened
 *
 * `packages/objectql/src/tenancy/platform-object-tenancy.ts` carried the census
 * as PROSE: three digits and a parenthetical explaining them. Nothing re-derived
 * it, so it was true only until the population moved, and it failed silently
 * when it did -- twice, in the two different ways a hand-written count can:
 *
 *   1. A WRONG REASON behind a RIGHT total. The parenthetical read "24
 *      `managedBy: 'better-auth'`, plus `sys_sso_provider`'s `tenancy.enabled:
 *      false`". All 25 were `managedBy: 'better-auth'` and `sys_sso_provider`
 *      was one OF them; `sys_api_key` carries `tenancy.enabled: false` too and
 *      was not named. `24 + 1 = 25` is right, which is exactly why neither a
 *      reader nor a gate caught it. That count reached a PR body and a filed
 *      card, and two independent re-measurements were spent proving a correct
 *      file correct.
 *   2. A RIGHT reason behind a STALE total. Commit efb3513178 (PR #15155, from
 *      #15024, 2026-09-04 04:37:18Z) declared `systemFields: { tenant: false }`
 *      on `sys_metadata_activation`. The object left the machinery's reach and
 *      84 / 25 / 59 became 84 / 26 / 58. The same commit updated the GATED page
 *      next door and left the ungated prose alone, with CI green throughout.
 *
 * ⇒ Failure 2 also brought a THIRD exclusion mechanism into a taxonomy that had
 *   two, which is the shape this gate refuses hardest: see the third verdict.
 *
 * ## Three verdicts, and the third is the one worth having
 *
 * 1. **The artefact equals the tree.** A DRIFT check, deliberately not an anchor
 *    check: the artefact carries no line numbers, so a pure displacement cannot
 *    move it and there is exactly one mechanical repair path
 *    (`node scripts/platform-object-tenancy-census.mjs --write`).
 * 2. **The header still points here.** Grain 1's fix was to DELETE the digits,
 *    so what is left to protect is the pointer and the predicate sentence. These
 *    are required to be PRESENT, not to be right -- a count is exactly what must
 *    not come back, and the way it comes back is by someone helpfully restating
 *    "for reference" what the artefact already says.
 * 3. ⭐ **No unexplained exclusion.** An object the predicate puts outside the
 *    machinery for which no declared mechanism is found is an ERROR, never a
 *    default. This is the announce-never-absorb rule, and it is the verdict that
 *    would have fired on #15155's third mechanism the day it landed. It is the
 *    same shape `tenant-audit-census.mjs` gives an unplaceable receiver, for the
 *    same reason: a census that quietly widens a bucket to fit a new arrival
 *    publishes a total that no longer means what its predicate says.
 *
 * ## Why `--self-test` is not optional here
 *
 * Verdicts 1 and 3 are MATCHING RULES, and a matching rule cannot detect its own
 * regression on a clean tree: green means the finding set is empty, weakening a
 * rule can only shrink that set, and the empty set is the fixed point of
 * shrinking. The production run reads identically before and after the rule
 * breaks. `--self-test` supplies the adversarial inputs a clean tree by
 * construction does not contain -- a mutated artefact, and an exclusion with no
 * reason -- and is the only instrument watching either rule.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import {
  ARTEFACT,
  EXCLUSION_REASONS,
  HEADER,
  PREDICATE_SOURCES,
  renderArtefact,
  runCensus,
  selfTest as censusSelfTest,
  unexplainedExclusions,
} from './platform-object-tenancy-census.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * The subtree spelling of this gate's population, for
 * `scripts/pm/dispatch-gates.mjs` (the `ROOT_DIR_WATCH_HINTS` idiom).
 *
 * This gate's population is genuinely wide and genuinely bounded: every object
 * DECLARATION in the tree decides a row (`packages/**\/*.object.ts`), the two
 * predicate sources decide every row's verdict, the artefact is the compared
 * side, and the header is verdict 2's subject. The first is a `packages`
 * subtree walk and the last three are file literals this module and the
 * generator it imports already spell -- the extractor reads those directly, so
 * only the walk root needs declaring.
 *
 * ⛔ Nothing in this gate reads this array; it is provenance, never a lookup
 * key. `--self-test` pins it against the roots actually walked, in both
 * directions, so a declaration cannot drift into describing a population this
 * gate does not have (which is worse than no declaration: it replaces a silent
 * gate with a lying one).
 */
export const ROOT_DIR_WATCH_HINTS = ['packages/**'];

/**
 * Sentences the header must still carry.
 *
 * Required to be SAID, not to be right -- the tree itself is the authority on
 * the numbers, and these strings are what keeps a reader who lands on the
 * header from re-deriving a count by hand instead of running the census.
 */
export const HEADER_MARKERS = [
  {
    text: ARTEFACT,
    why: 'the header must point at the derived artefact, since it no longer states the census itself',
  },
  {
    text: 'resolveTenantFieldName',
    why: 'the header must name the PREDICATE; a pointer to a number with no predicate recreates the trap with fresher digits',
  },
  {
    text: 'registered schema',
    why: 'the predicate is answered on the REGISTERED schema, and the authored/registered distinction is the half the original prose left out',
  },
];

/** `--self-test` sets this only after printing its verdict; `main` reads it. */
let selfTestReachedVerdict = false;

export function run(root = ROOT) {
  const findings = [];

  const census = runCensus(root);

  // Verdict 3 first: an unexplained exclusion makes every total below suspect,
  // so it is reported as its own thing rather than as a diff line.
  for (const name of unexplainedExclusions(census)) {
    const row = census.objects.find((r) => r.name === name);
    findings.push(
      `[unexplained-exclusion] ${name} (${row.file}) is OUTSIDE the machinery's reach and no declared\n`
      + `    mechanism explains it. The census knows: ${EXCLUSION_REASONS.map((r) => r.id).join(', ')}.\n`
      + '    ⛔ Do NOT widen an existing reason to fit it. Adjudicate the new mechanism, then add it to\n'
      + '    EXCLUSION_REASONS in scripts/platform-object-tenancy-census.mjs with the reasoning that admits it.',
    );
  }

  // Verdict 1.
  const want = renderArtefact(census);
  const got = readFileSync(join(root, ARTEFACT), 'utf8');
  if (got !== want) {
    let committed = null;
    try { committed = JSON.parse(got); } catch { /* reported as unparseable below */ }
    const deltas = [];
    if (committed && committed.totals) {
      for (const key of ['registered', 'inReach', 'outOfReach']) {
        if (committed.totals[key] !== census.totals[key]) {
          deltas.push(`totals.${key}: committed ${committed.totals[key]} -> tree ${census.totals[key]}`);
        }
      }
      const byName = new Map((committed.objects ?? []).map((r) => [r.name, r]));
      for (const row of census.objects) {
        const before = byName.get(row.name);
        if (!before) { deltas.push(`+ ${row.name} (${row.reach}) is new to the population`); continue; }
        if (before.reach !== row.reach) deltas.push(`~ ${row.name}: ${before.reach} -> ${row.reach}`);
        else if (JSON.stringify(before.reasons) !== JSON.stringify(row.reasons)) {
          deltas.push(`~ ${row.name} reasons: ${JSON.stringify(before.reasons)} -> ${JSON.stringify(row.reasons)}`);
        }
      }
      const live = new Set(census.objects.map((r) => r.name));
      for (const row of committed.objects ?? []) if (!live.has(row.name)) deltas.push(`- ${row.name} left the population`);
    }
    findings.push(
      `[census-drift] ${ARTEFACT} no longer matches the tree.\n`
      + (deltas.length > 0 ? `${deltas.map((d) => `    ${d}`).join('\n')}\n` : '    (the committed file could not be read as a census)\n')
      + '    Repair: node scripts/platform-object-tenancy-census.mjs --write\n'
      + '    ⛔ Do not hand-edit a digit to close this — the artefact is derived, and a hand-reconciled\n'
      + '    number is the exact failure the census replaced.',
    );
  }

  // Verdict 2.
  const header = readFileSync(join(root, HEADER), 'utf8');
  for (const marker of HEADER_MARKERS) {
    if (!header.includes(marker.text)) {
      findings.push(
        `[header-pointer] ${HEADER} no longer contains "${marker.text}" — ${marker.why}.`,
      );
    }
  }

  return { findings, census };
}

export function selfTest(root = ROOT) {
  let failures = 0;
  const t = (what, got, want = true) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failures++;
    console.log(`  ${ok ? '✓' : '✗'} ${what}${ok ? '' : `\n      got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  };

  // The generator's battery runs FIRST and its result is folded in: this gate's
  // verdict is an equality, and an equality between two identically-wrong sides
  // holds. The classifiers on the derived side have no other instrument.
  const generatorFailed = censusSelfTest(root) !== 0;
  console.log('check-platform-object-tenancy-census');
  t('the generator self-test passes', !generatorFailed);

  const live = run(root);
  t('the live tree is clean', live.findings, []);

  // ⭐ POSITIVE CONTROL for verdict 1. A mutated artefact must red — and the
  // mutation is a single digit, the smallest thing a drift can be.
  {
    const census = live.census;
    const mutated = { ...census, totals: { ...census.totals, inReach: census.totals.inReach + 1 } };
    t('a one-digit artefact mutation is NOT byte-equal to the fresh render',
      renderArtefact(mutated) !== renderArtefact(census));
    // The comparison itself, exercised without touching the file on disk.
    t('…and the comparison the gate makes rejects it',
      renderArtefact(mutated) !== readFileSync(join(root, ARTEFACT), 'utf8'));
  }

  // ⭐ POSITIVE CONTROL for verdict 3, the announce-never-absorb rule. The live
  // tree has no unexplained exclusion (asserted above), so the adversarial row
  // is supplied here.
  {
    const planted = {
      ...live.census,
      objects: [...live.census.objects, { name: 'sys_planted_probe', file: 'x.object.ts', reach: 'out', tenantField: null, reasons: [] }],
    };
    t('an out-of-reach row with no reason is reported', unexplainedExclusions(planted), ['sys_planted_probe']);
    // The opposite direction, so the rule cannot be satisfied by reporting
    // everything: a row WITH a reason is not an unexplained exclusion, and an
    // in-reach row is never one however it is declared.
    const explained = {
      ...live.census,
      objects: [
        ...live.census.objects,
        { name: 'sys_planted_explained', file: 'x.object.ts', reach: 'out', tenantField: null, reasons: ['systemFields: false'] },
        { name: 'sys_planted_in_reach', file: 'x.object.ts', reach: 'in', tenantField: 'organization_id', reasons: [] },
      ],
    };
    t('…and a reasoned exclusion, or an in-reach row, is not', unexplainedExclusions(explained), []);
  }

  // ⭐ POSITIVE CONTROL for verdict 2, both directions.
  {
    const header = readFileSync(join(root, HEADER), 'utf8');
    t('the header carries every required marker', HEADER_MARKERS.filter((m) => !header.includes(m.text)).map((m) => m.text), []);
    for (const marker of HEADER_MARKERS) {
      const without = header.split(marker.text).join('');
      t(`a header with "${marker.text}" removed fails its check`, !without.includes(marker.text));
    }
  }

  // The dispatch-gates declaration, derived from what this gate really reads so
  // that it cannot describe last month's population.
  {
    const walkRoots = ['packages'];
    t('every walk root without a separator has the subtree spelling declared',
      walkRoots.filter((r) => !r.includes('/')).every((r) => ROOT_DIR_WATCH_HINTS.includes(`${r}/**`)));
    t('and it declares nothing this gate does not walk',
      ROOT_DIR_WATCH_HINTS.every((h) => walkRoots.includes(h.replace(/\/\*+$/, ''))));
    // The file literals the extractor reads directly, asserted to still BE
    // literals in the module source rather than assembled at run time.
    const selfSource = readFileSync(join(ROOT, 'scripts/check-platform-object-tenancy-census.mjs'), 'utf8')
      + readFileSync(join(ROOT, 'scripts/platform-object-tenancy-census.mjs'), 'utf8');
    for (const literal of [ARTEFACT, HEADER, PREDICATE_SOURCES.injectedColumns, PREDICATE_SOURCES.tenantFieldResolver]) {
      t(`the family inherits the literal ${literal}`, selfSource.includes(literal));
    }
  }

  console.log(failures === 0
    ? `✓ check-platform-object-tenancy-census self-test: all checks pass (${live.census.totals.registered} objects, ${live.census.totals.outOfReach} outside the machinery)`
    : `✗ check-platform-object-tenancy-census self-test: ${failures} check(s) failed`);
  selfTestReachedVerdict = true;
  return failures === 0 ? 0 : 1;
}

export function main(argv = []) {
  if (argv.includes('--self-test')) {
    const code = selfTest(ROOT);
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-platform-object-tenancy-census self-test: selfTest() returned without reaching its\n'
        + '  verdict, so the exit code above describes nothing that was measured.',
      );
      return 1;
    }
    return code;
  }

  const { findings, census } = run(ROOT);
  if (findings.length === 0) {
    console.log(
      `✓ platform-object tenancy census matches the tree: ${census.totals.registered} platform-namespace `
      + `objects, ${census.totals.inReach} in the machinery's reach, ${census.totals.outOfReach} outside it, `
      + 'every exclusion explained by a declaration on its own schema.',
    );
    return 0;
  }
  console.error('✗ platform-object tenancy census\n');
  for (const finding of findings) console.error(`  ${finding}\n`);
  console.error(
    `  The predicate is: resolveTenantFieldName(REGISTERED schema) !== null — the engine's own resolver,\n`
    + `  on the schema AFTER ${PREDICATE_SOURCES.injectedColumns.split('/').pop()} has injected the tenant column.\n`
    + '  ⛔ managedBy is not the predicate.\n',
  );
  return 1;
}

if (isEntrypoint(import.meta.url)) process.exit(main(process.argv.slice(2)));
