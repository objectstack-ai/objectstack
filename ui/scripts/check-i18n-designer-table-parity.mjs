#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The metadata-admin designer's OWN string tables must stay paired (objectui#8834).
 *
 * Run:  node scripts/check-i18n-designer-table-parity.mjs   (also `pnpm check:i18n-designer-parity`)
 * Exit: 0 = every `en` row has a `zh` row and every shared row carries the same
 *           `{placeholders}`, 1 = it does not
 *
 * ## The gap this closes
 *
 * `packages/app-shell/src/views/metadata-admin/i18n.ts` carries the Studio
 * designer's own module-local string tables — ~3600 lines of user-visible text
 * — and until this gate NOTHING checked that the two halves of a pair follow
 * each other. The two shipped i18n gates are blind to it BY CONSTRUCTION, which
 * is measured rather than assumed (objectui#8388, comment 5592768866, quoted in
 * the header of `check-i18n-dead-keys.mjs`):
 *
 *   - `check-i18n-call-site-keys.mjs` resolves call sites against the `en`
 *     PACK, and classifies this module `module-local table` by declaration and
 *     skips it outright.
 *   - `check-i18n-en-drift.mjs` read the TEN LOCALE PACKS. This table is not one
 *     of them. (objectui#8834 also gave that gate this table as a SEPARATE
 *     population — see below for why that leg lives there and not here.)
 *
 * `check-i18n-dead-keys.mjs` does sweep this table, but it asks about DEAD keys
 * and its corpus is deliberately the UNION of both tables (`:674-676`), so a
 * one-sided key is not a subject to it at all — it is just "a key of this
 * bundle". And that script is a REPORT that runs in no workflow. So: add an
 * English string, forget the Chinese one, and every gate in this repo is green.
 *
 * ## Why this is a SEPARATE script and not another leg of the dead-keys sweep
 *
 * `check:i18n-dead-keys` is invoked in NO file under `.github/workflows/`
 * (measured, with the lit control that the same probe DOES find
 * `check:i18n-keys` at `ci.yml:487` and `check:i18n-drift` at `:500`), and that
 * is by design — its own header says "This is a REPORT, not a gate". A leg
 * added there could never be observed red in CI, which is precisely the disease
 * objectui#8834 exists to cure.
 *
 * ## Why the VALUE-drift leg is not here either
 *
 * "The `en` value changed and `zh` did not" is an EVENT in a diff, not a state
 * of the tree, and `check-i18n-en-drift.mjs` already owns that mechanism and
 * says so of itself: "What a gate can decide is the event". Its designer
 * population, added by the same card, answers that half. Everything in THIS
 * file is a whole-table state invariant, decidable on any single commit with no
 * base to diff against. Each leg lands in the mechanism that owns it.
 *
 * ## What is enforced, and what is only reported
 *
 * ENFORCED — `en` is a SUBSET of `zh`, per pair. Every key the `en` table
 * declares must have a `zh` row. This is the direction an author actually gets
 * wrong: they add or rename an English string and the Chinese one does not
 * follow.
 *
 * ENFORCED — placeholder parity over the SHARED keys, per pair. The two values
 * must carry the same set of `{token}` names, read with `tFormat()`'s own regex
 * (`i18n.ts`: `template.replace(/\{(\w+)\}/g, …)`). A translation that dropped
 * `{count}` renders a sentence with a hole in it at runtime, and no key-shaped
 * gate can see it.
 *
 * REPORTED, NEVER ENFORCED — `zh`-only keys, minus the three families below.
 * The other direction is NOT symmetric here and must not be gated:
 * `ENGINE_STRINGS_ZH` carries 55 keys `ENGINE_STRINGS_EN` deliberately lacks,
 * and in all three families an `en` row would be a REGRESSION rather than a
 * gap (see `ZH_ONLY_FAMILIES`). So the enforced half lands green with an EMPTY
 * exemption ledger — there is no ledger a wrong entry could silently disable —
 * and the residue is printed instead, so a NEW and unintentional one-sided
 * `zh` family is still visible to a reader.
 *
 * ⚠️ The asymmetry between the two halves is the whole design: a wrong entry in
 * the subtraction below costs one missing line of output; a wrong entry in a
 * gate's exemption ledger silently disables the gate.
 *
 * ## What is NOT checked, deliberately
 *
 * Whether a value is "actually translated". One side is English and the other
 * Chinese, so the values SHOULD differ; and two sides that are literally equal
 * are routinely correct (proper nouns, API names such as `highlightFields`,
 * `AI`). Any check that reaches for meaning is a translator wearing a regex —
 * the same argument `check-i18n-en-drift.mjs` makes at length under
 * "Typography is NOT exempt", from two shipped defects.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectDesignerKeys, DESIGNER_TABLE } from './check-i18n-dead-keys.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

export { DESIGNER_TABLE };

/**
 * The paired tables this gate judges — ITS OWN list, deliberately not
 * `DESIGNER_TABLE_CONSTS`.
 *
 * That constant is the dead-keys sweep's own corpus, and its companion
 * `DESIGNER_KEY_ROOTS` (`engine.` / `designer.` / `perm.`) does not cover
 * `TYPE_LABELS_*` or `DOMAIN_LABELS_*` keys, which are bare identifiers such as
 * `object` and `data`. Widening it to reach them would change what THAT gate
 * sweeps, as a side effect nobody asked for.
 *
 * A pair is `{ label, en, zh }` and adding one is a single line. Measured on
 * this checkout when the list was seeded, through the shipped extractor with
 * none of its stale-detection loosened: `ENGINE_STRINGS` 1657/1712,
 * `TYPE_LABELS` 36/36, `DOMAIN_LABELS` 9/9 — 0 `en`-only keys and 0 placeholder
 * mismatches across all three, so this gate arrives green on all three.
 */
export const DESIGNER_TABLE_PAIRS = [
  { label: 'ENGINE_STRINGS', en: 'ENGINE_STRINGS_EN', zh: 'ENGINE_STRINGS_ZH' },
  { label: 'TYPE_LABELS', en: 'TYPE_LABELS_EN', zh: 'TYPE_LABELS_ZH' },
  { label: 'DOMAIN_LABELS', en: 'DOMAIN_LABELS_EN', zh: 'DOMAIN_LABELS_ZH' },
];

/** Every constant the pair list names, in declaration order. */
export const DESIGNER_PAIR_CONSTS = DESIGNER_TABLE_PAIRS.flatMap((pair) => [pair.en, pair.zh]);

/**
 * The `zh`-only key families that are DELIBERATE, subtracted from the REPORT
 * and — never — from the gate.
 *
 * Each entry carries its reason and its in-file citation, and both are printed
 * on the same line as the family, so a reader of the output can check the claim
 * without leaving it. An entry with no citation is not admissible: the reason a
 * family is one-sided is a fact about a consumer, and a claim about a consumer
 * that names no consumer is an assertion.
 *
 * ⛔ A citation is `{ file, anchor }` and the anchor is TEXT, ⛔ never a line
 * number (objectui#8875 clause 3, on the maintainer's ruling of 2026-09-10:
 * 跨文件的「某文件第几行」引用， 这种完全没必要吧，是否应该避免). These three
 * addresses were stored literals pointing INTO another file, so every one of
 * them was one unrelated edit away from naming the wrong line — silently, since
 * nothing here ever followed them. An anchor is checked: this gate's test
 * asserts the text is actually present in the file, which a line number never
 * could be. ⚠️ The anchor must be a string that occurs exactly once, or the
 * citation stops locating anything.
 *
 * These prefixes decide only what a REPORT prints. They can never make a
 * failing gate pass, which is why a prefix is safe here and would not be in an
 * exemption ledger — a prefix ledger swallows an entire family's future
 * one-sided keys, the wide-head hazard `check-i18n-dead-keys.mjs` already
 * reasons about at `MIN_HEAD_SEGMENTS`.
 */
export const ZH_ONLY_FAMILIES = [
  {
    prefix: 'engine.flowNode.',
    reason:
      'zh-only by design: for English the flow palette falls back to the engine descriptor’s own ' +
      'server-authoritative name/description, so an `en` row would OVERRIDE the server',
    citation: {
      file: 'packages/app-shell/src/views/metadata-admin/i18n.ts',
      anchor: 'resolved by translateNodeLabel/Hint',
    },
  },
  {
    prefix: 'engine.enum.type.',
    reason:
      'zh-only by construction: translateEnumOption returns the raw value before it ever touches the ' +
      'table for any non-zh locale (`if (!isZhLocale(locale)) return value;`), so an `en` row is unreachable',
    citation: {
      file: 'packages/app-shell/src/views/metadata-admin/i18n.ts',
      anchor: 'export function translateEnumOption',
    },
  },
  {
    prefix: 'engine.packages.form.help.',
    reason:
      'zh-only on purpose: with no `en` row tOptional returns undefined, helpText drops out, and the row ' +
      'falls back to ManifestSchema’s .describe() in @objectstack/spec — an `en` row would copy that ' +
      'text into a second producer, against AGENTS.md #0.1',
    citation: {
      file: 'packages/app-shell/src/views/metadata-admin/package-schema.ts',
      anchor: 'en-US deliberately has NO entry',
    },
  },
];

/**
 * `tFormat()`'s OWN placeholder regex, copied from `i18n.ts` verbatim:
 *
 *   template.replace(/\{(\w+)\}/g, (_m, name) => name in vars ? … : `{${name}}`)
 *
 * Copied rather than approximated because the question this leg asks is
 * "what will the runtime substitute", and only that expression answers it. A
 * looser pattern would report tokens the runtime never substitutes; a tighter
 * one would miss the ones it does.
 */
export const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

/** The sorted, de-duplicated placeholder names in one value. */
export function placeholdersOf(value) {
  return [...new Set(Array.from(value.matchAll(PLACEHOLDER_PATTERN), (match) => match[1]))].sort();
}

/**
 * Both halves of every pair, as `constant name -> (key -> value)`.
 *
 * Reads through the shipped extractor in `check-i18n-dead-keys.mjs` rather than
 * re-implementing the parse: see that function's header for why this repo
 * treats a second copy of a reader as a defect and not a convenience.
 */
export function readDesignerPairs(root, { source = null, label = DESIGNER_TABLE, require = true } = {}) {
  const { values } = collectDesignerKeys(root, {
    consts: DESIGNER_PAIR_CONSTS,
    source,
    label,
    withValues: true,
    require,
  });
  // Unreachable — `withValues` is requested right above. Asserted rather than
  // coerced to an empty map: an empty map would compare nothing and pass, which
  // is the one failure mode every gate in this family is built to refuse.
  if (values === null) throw new Error(`${label}: values were requested and not returned`);
  return values;
}

/** @typedef {Map<string, Map<string, string>>} DesignerTables */

/**
 * @typedef {{ pair: string, key: string }} MissingZh
 * @typedef {{ pair: string, key: string, en: string[], zh: string[], missing: string[], extra: string[] }} PlaceholderMismatch
 * @typedef {{ pair: string, key: string }} UnexplainedZhOnly
 */

/**
 * The two enforced invariants plus the reported residue, for one set of tables.
 *
 * @param {Map<string, Map<string, string>>} tables
 * @returns {{ missingZh: MissingZh[], placeholders: PlaceholderMismatch[],
 *             unexplainedZhOnly: UnexplainedZhOnly[], counters: Record<string, number>,
 *             familyCounts: Record<string, number>, pairSizes: Array<{ pair: string, en: number, zh: number }> }}
 */
export function analysePairs(tables, pairs = DESIGNER_TABLE_PAIRS, families = ZH_ONLY_FAMILIES) {
  /** @type {MissingZh[]} */ const missingZh = [];
  /** @type {PlaceholderMismatch[]} */ const placeholders = [];
  /** @type {UnexplainedZhOnly[]} */ const unexplainedZhOnly = [];
  const counters = { enKeys: 0, zhKeys: 0, sharedKeys: 0, keysWithPlaceholders: 0, zhOnly: 0, explainedZhOnly: 0 };
  const familyCounts = Object.fromEntries(families.map((family) => [family.prefix, 0]));
  const pairSizes = [];

  for (const pair of pairs) {
    const en = tables.get(pair.en);
    const zh = tables.get(pair.zh);
    if (!en || !zh) continue;
    pairSizes.push({ pair: pair.label, en: en.size, zh: zh.size });
    counters.enKeys += en.size;
    counters.zhKeys += zh.size;

    for (const [key, enValue] of en) {
      if (!zh.has(key)) {
        missingZh.push({ pair: pair.label, key });
        continue;
      }
      counters.sharedKeys += 1;
      const enTokens = placeholdersOf(enValue);
      const zhTokens = placeholdersOf(zh.get(key));
      if (enTokens.length > 0 || zhTokens.length > 0) counters.keysWithPlaceholders += 1;
      if (enTokens.join(' ') !== zhTokens.join(' ')) {
        placeholders.push({
          pair: pair.label,
          key,
          en: enTokens,
          zh: zhTokens,
          missing: enTokens.filter((token) => !zhTokens.includes(token)),
          extra: zhTokens.filter((token) => !enTokens.includes(token)),
        });
      }
    }

    for (const key of zh.keys()) {
      if (en.has(key)) continue;
      counters.zhOnly += 1;
      const family = families.find((candidate) => key.startsWith(candidate.prefix));
      if (family) {
        familyCounts[family.prefix] += 1;
        counters.explainedZhOnly += 1;
        continue;
      }
      unexplainedZhOnly.push({ pair: pair.label, key });
    }
  }

  return { missingZh, placeholders, unexplainedZhOnly, counters, familyCounts, pairSizes };
}

if (isEntrypoint(import.meta.url)) {
  const argOf = (name) => {
    const index = process.argv.indexOf(name);
    return index > -1 ? process.argv[index + 1] : null;
  };
  const root = resolve(argOf('--root') ?? resolve(scriptDir, '..'));

  const tables = readDesignerPairs(root);
  const result = analysePairs(tables);

  // The same collapse guard `check-i18n-en-drift.mjs` opens with, for the same
  // reason: over an empty corpus every assertion below is trivially satisfied,
  // so a refactor that stopped reading the tables would report a confident
  // green. `--min-keys` exists because this gate's own tests run it over small
  // fixture tables; CI never passes it, and the DEFAULT is the number that
  // matters. It is a floor well under today's 1702, not a pin: adding strings
  // is routine and must not need this file edited.
  const minKeys = Number(argOf('--min-keys') ?? 1500);
  if (result.counters.enKeys < minKeys) {
    console.error(
      `The scan collapsed: the en side of ${DESIGNER_TABLE_PAIRS.length} pair(s) parsed to ` +
        `${result.counters.enKeys} keys, expected at least ${minKeys}. The extractor is broken, and an ` +
        'empty comparison would pass while asserting nothing.',
    );
    process.exit(1);
  }

  console.log(
    `${DESIGNER_TABLE}: ${result.pairSizes.map((size) => `${size.pair} ${size.en} en / ${size.zh} zh`).join(', ')} ` +
      `— ${result.counters.sharedKeys} shared key(s), ${result.counters.keysWithPlaceholders} of them ` +
      `carrying a {placeholder}, ${result.counters.zhOnly} zh-only key(s) ` +
      `(${result.counters.explainedZhOnly} in a documented family).`,
  );

  // The REPORT half. Printed on every run, red or green, and it never changes
  // the exit code — its whole job is to make a NEW one-sided zh family visible
  // to a reader without handing anyone a lever that can turn the gate off.
  console.log('\nzh-only keys, by documented family (report only — these never affect the exit code):');
  for (const family of ZH_ONLY_FAMILIES) {
    console.log(
      `  ${result.familyCounts[family.prefix]}  ${family.prefix}  ${family.reason} ` +
        `[${family.citation.file} -> ${family.citation.anchor}]`,
    );
  }
  if (result.unexplainedZhOnly.length === 0) {
    console.log('  0  <residue>  no zh-only key falls outside the families above.');
  } else {
    console.log(
      `  ${result.unexplainedZhOnly.length}  <residue>  zh-only key(s) in NO documented family. Not a ` +
        'failure, and not necessarily wrong — but nothing in this repo yet explains why the en side is absent:',
    );
    for (const finding of result.unexplainedZhOnly) console.log(`      ${finding.pair}: ${finding.key}`);
  }

  if (result.missingZh.length === 0 && result.placeholders.length === 0) {
    console.log('\nEvery en row has a zh row, and every shared row carries the same placeholders.');
    process.exit(0);
  }

  if (result.missingZh.length > 0) {
    console.error(`\n${result.missingZh.length} en key(s) with no zh row:\n`);
    for (const finding of result.missingZh) console.error(`  ${finding.pair}  ${finding.key}`);
    console.error(
      '\nAdd the zh row IN THIS PR. The Chinese designer falls back to echoing the raw key, so the\n' +
        'console renders `engine.…` at the user. The reverse direction (a zh row with no en row) is\n' +
        'NOT gated and is listed above instead — three families are one-sided on purpose.',
    );
  }

  if (result.placeholders.length > 0) {
    console.error(`\n${result.placeholders.length} shared key(s) whose two values carry different {placeholders}:\n`);
    for (const finding of result.placeholders) {
      console.error(`  ${finding.pair}  ${finding.key}`);
      console.error(`      en has: ${finding.en.length ? finding.en.map((name) => `{${name}}`).join(' ') : '(none)'}`);
      console.error(`      zh has: ${finding.zh.length ? finding.zh.map((name) => `{${name}}`).join(' ') : '(none)'}`);
      if (finding.missing.length > 0) {
        console.error(`      MISSING from zh: ${finding.missing.map((name) => `{${name}}`).join(' ')}`);
      }
      if (finding.extra.length > 0) {
        console.error(`      only in zh: ${finding.extra.map((name) => `{${name}}`).join(' ')}`);
      }
    }
    console.error(
      '\ntFormat() substitutes by NAME, so a token one side lacks is a hole in the rendered sentence\n' +
        '(the value keeps the literal `{token}`) or a variable that reaches nothing. Restore the token,\n' +
        'or rename it on both sides together.',
    );
  }

  console.error('\nSee the header of scripts/check-i18n-designer-table-parity.mjs.');
  process.exit(1);
}
