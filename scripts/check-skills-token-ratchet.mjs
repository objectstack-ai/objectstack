#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * published-skills TOKEN ratchet (#10473, extended #12392) — shrink-only
 * ceilings on every HAND-AUTHORED file in the catalog that ships to customer
 * projects, not merely on each skill's SKILL.md.
 *
 *   node scripts/check-skills-token-ratchet.mjs               # the gate
 *   node scripts/check-skills-token-ratchet.mjs --self-test   # verify the checker
 *
 * ## Why a ceiling here at all
 *
 * Maintainer ruling, 2026-08-21, on PR #10402 (verbatim, untranslated):
 * 「10402 需要整体考虑 skills 的长度,不能为了一个小功能扩写很多。」 That PR had
 * added +111 lines to the published bundle for one small feature. The principle
 * was established; nothing enforced it, and the only control left was a
 * reviewer remembering the ruling — which this board's history says is the
 * expensive way to rediscover a rule.
 *
 * `skills/` is loaded WHOLE into customer agent context windows. Its length is
 * therefore not a repo-hygiene question: it is a per-token cost paid again in
 * every customer session, in every customer project, forever. That is the cost
 * curve this gate prices.
 *
 * ## Relationship to the `.claude/**` line ratchet
 *
 * `scripts/pm/check-skill-line-ratchet.mjs` is the proven precedent and this
 * gate mirrors its discipline deliberately. The two are SEPARATE gates over
 * SEPARATE roots, and that separation is the design, not an accident:
 *
 *   - that one prices `.claude/**` in LINES, a surface read per seat session
 *     and per Routine fire inside THIS repo;
 *   - this one prices `skills/**` in TOKENS, a surface read by customer
 *     projects.
 *
 * Its header states that the published catalog is outside ITS map and that
 * extending coverage there is a policy change needing a maintainer's ruling.
 * That ruling is the one quoted above, and this file is how it landed — as a
 * second gate with its own cost unit, rather than as a row bolted onto a map
 * built for a different unit. Its self-test still correctly pins that no
 * `skills/` key appears in ITS map.
 *
 * ## The counting convention — `ceil(utf8 bytes / 4)`, and its limits
 *
 * Tokens, not lines, because tokens are what a context window is billed in: a
 * re-wrap that halves the line count changes the customer's cost by nothing.
 *
 * The count is `Math.ceil(Buffer.byteLength(text, 'utf8') / 4)`. Three reasons
 * this beats a real tokenizer HERE:
 *
 *   - DETERMINISM. A ratchet's numbers are pinned constants. A tokenizer's
 *     output is a function of its vocabulary version, so a dependency bump
 *     would silently re-price all eleven ceilings — a ratchet that moves when
 *     nobody edited a file is not a ratchet.
 *   - NO DEPENDENCY. The workspace carries no tokenizer today (checked at
 *     landing: no `tiktoken` / `gpt-tokenizer` / `gpt-3-encoder` in any
 *     manifest). Adding one to make a lint gate's numbers prettier is not a
 *     trade this gate needs. Refused on that merit alone, not by a fence: root
 *     dependencies as a CLASS are not #9465 territory -- the GATE INVOCATION
 *     IDIOM note at the top of `.github/workflows/lint.yml` carries that lane's
 *     verbatim scope, and it is pointed at rather than restated here.
 *   - INDEPENDENTLY REPRODUCIBLE. Anyone can audit a ceiling without running
 *     this script: `ceil($(wc -c < file) / 4)`. A tokenizer's count can only be
 *     checked by re-running the tokenizer.
 *
 * ~4 bytes per token is the standard rule of thumb for BPE over English prose
 * and markdown, which is what this catalog is. Its KNOWN limitation, stated
 * rather than hidden: it UNDER-prices CJK, where 3 UTF-8 bytes buy 0.75 units
 * while a real tokenizer charges roughly 1–2 per character. Measured across the
 * catalog when the ceilings were pinned: 235 CJK codepoints against ~117,000
 * units — 0.2%, an order of magnitude below the ratchet's own resolution. If
 * the catalog ever turns substantially non-Latin, the convention needs
 * revisiting rather than the ceilings.
 *
 * ⚠️ Counts produced here are comparable ONLY against other counts produced
 * here. They are not an estimate of any specific model's tokenizer, and the
 * ceilings below are pinned in this convention — changing the convention
 * re-prices every one of them.
 *
 * ## The ratchet discipline (shrink-only, per file)
 *
 *   - New text is paid for by DELETING text in the SAME FILE. Genuine deletion:
 *     a re-wrap moves no tokens and pays nothing.
 *   - A ceiling may be LOWERED by any PR that shrinks its file. Lowering is
 *     always legitimate and encouraged; the report line below prints every
 *     file's headroom on every run so a shrink is visible the moment it lands.
 *   - Going the other way lands only in a PR whose body quotes a maintainer
 *     ruling authorizing it — the same evidence bar the `.claude/**` ratchet
 *     uses.
 *
 * ## Enumeration, never a hand list
 *
 * The catalog is read off the filesystem — every file under every published
 * skill directory, walked recursively — and a discovered AUTHORED file with no
 * ceiling is RED. A hand-maintained list would let the twelfth published skill
 * land unpriced, which is precisely the hole the ruling is about — the bundle
 * grows by a whole file, and every existing ceiling stays green. Missing file
 * or empty read is RED, never a pass (#4690: a gate that cannot find its input
 * must fail, not skip).
 *
 * ## What is priced, and what is deliberately NOT — the boundary (#12392)
 *
 * ⚠️ Read this before concluding the gate prices `skills/**` as a category. It
 * does not, and the shape of the exception is the whole point of this section.
 * Until #12392 this gate priced ONLY `skills/<name>/SKILL.md` — 11 files — while
 * the bundle that ships is 50. The other 37% (`rules/**`, `evals/**`, the
 * hand-authored `references/*.md`) carried no ceiling at all, so an author could
 * add thousands of tokens of `rules/*.md` and truthfully report a `+0` package
 * delta against the only number this gate produced. The population below is the
 * repair; this paragraph exists so the boundary is legible WITHOUT diffing the
 * population against the filesystem, which is what #12392 was filed about.
 *
 * Three populations, and each one's reason:
 *
 *   1. PRICED — every hand-authored file inside a published skill directory.
 *      A published skill directory is a child of `skills/` carrying a SKILL.md;
 *      everything under it ships into the customer project together, so
 *      everything under it is priced together. `SKILL.md`, `rules/**`,
 *      `evals/**` and hand-authored `references/**` are all this.
 *
 *   2. EXCLUDED — GENERATOR-OWNED outputs. `skills/<name>/references/_index.md`
 *      is written by `gen:skill-refs` and `references/react-blocks.md` +
 *      `contracts/react-blocks.contract.json` by `gen:react-blocks`. A ceiling
 *      on a generated file reds on a legitimate REGENERATION — a spec author
 *      moves an indexed headline, the generator faithfully rewrites the index,
 *      and this gate stops them. That is the wrong actor: the generated bytes
 *      are a function of the schema source, so the author who could pay the
 *      ratchet's price by deleting text is not the author the red would land on.
 *      Their cost is still MEASURED and printed below — excluded from
 *      RATCHETING is not excluded from the bundle total.
 *
 *   3. OUTSIDE — `skills/README.md`. Not inside any published skill directory:
 *      it is the catalog's own front page (and itself carries a generated index
 *      block from `build-skill-docs.ts`), not content an agent loads with a
 *      skill. The exclusion is structural, not a carve-out.
 *
 * ## The one definition of "generator-owned" — reused, never re-authored
 *
 * Membership in population 2 is decided by `generatedExceptionFor()` from
 * `scripts/pm/check-governed-merges.mjs` — the register the maintainer ruled
 * into existence for exactly this question (#11705, 2026-08-25, on the
 * governed-merge fork): "The exemption is **enumerated from the generator**,
 * never a hand-copied path list … Extend that registry; ⛔ do not author a
 * second mechanism." This gate obeys that literally: it imports the register's
 * membership test rather than restating which paths are generated. Two
 * definitions of "generator-owned" that can drift is the failure this avoids —
 * if a generator's output set changes, it changes in ONE place and both the
 * governed-merge fork and this ratchet follow it.
 *
 * ⚠️ Known limit of the reuse, stated rather than hidden. The register's rows
 * answer the QUESTION cheaply (a narrowing regexp) and prove the ANSWER
 * expensively (recompute the generator, compare bytes). This gate runs in the
 * pre-build lint group with no toolchain, so it can only take the cheap half.
 * The residual risk is one-directional and small: a hand-authored file whose
 * path matches a generated spelling — an `_index.md` under a skill the
 * generator does not write — would be excluded rather than priced. It is closed
 * by PINNING the excluded set in `--self-test`: the excluded paths are asserted
 * by name, so a new one cannot appear without reddening this gate's own
 * self-test and getting a human's eyes. The pin is not a second definition; it
 * is a tripwire on the first one.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { isEntrypoint } from './invoked-as.mjs';
// THE membership test for "generator-owned", imported rather than restated —
// see the boundary section in the header. #11705's ruling forbids a second
// mechanism, so this gate consults the register the governed-merge fork owns.
import { generatedExceptionFor } from './pm/check-governed-merges.mjs';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = resolve(HERE, '..');
const SKILLS_DIR = join(REPO_ROOT, 'skills');

/** The compliance token. Byte-identical to every instrumented gate's const (#8435). */
const RATCHET_AUTHORITY_MARKER = '⛔ MAINTAINER-ONLY';

/** How the numbers below were produced. Printed on every run — see the header. */
export const TOKEN_CONVENTION = 'ceil(utf8 bytes / 4)';

/**
 * Where each pinned number was measured. Two bases, deliberately.
 *
 * `main` is the ordinary basis. `pending10402` is PR #10402's branch head: that
 * PR is reviewed and waiting on a maintainer's hand-merge, and it grows the two
 * files named in `from10402`. Pinning those two at main's counts would have
 * this gate turn red the moment an already-approved PR lands — a gate that
 * reds on the merge it was never about teaches authors to ignore it.
 *
 * ⚠️ The resulting headroom on those two files is NOT budget. It is #10402's
 * already-spent text, priced ahead of its merge; when that PR lands the
 * headroom returns to zero on its own and the next author is back to paying by
 * deletion.
 */
export const CEILING_BASIS = {
  main: '465bfce90',
  pending10402: '7228d6c25',
  from10402: ['skills/objectstack-data/SKILL.md', 'skills/objectstack-platform/SKILL.md'],
  /**
   * Every ceiling below was RE-MEASURED after the internal issue-id strip, on
   * this sha plus that change. Maintainer ruling 2026-08-23: strip the internal
   * issue-id references from the published catalog, per-file ceiling drops
   * landing in the same PR.
   *
   * The re-measure supersedes both bases above as the origin of the numbers —
   * they are kept because they still explain the SHAPE of the two rows that
   * carried a second basis, not because any current number is read from them.
   * ⚠️ #10402's reserved headroom was already spent when this landed:
   * `objectstack-data` measured 13817 against a 13817 ceiling on the base
   * below — exactly zero, which is the header's "the headroom returns to zero
   * on its own", observed.
   *
   * Several rows drop by MORE than their file shrank, because a lowering also
   * reclaims whatever slack the row already carried (`objectstack-formula`
   * shrank 34 and its ceiling drops 53). That is the ratchet working as
   * designed: shrink-only means a ceiling may be lowered to the measurement
   * whenever one is taken, not merely by the size of the day's deletion.
   */
  strippedInternalIds: '3f571a6d2',
  /**
   * #12392's extension basis. Every row added below the `SKILL.md` block was
   * measured on this sha — a fresh `origin/main` tree — and initialised AT its
   * measurement, so each of the 27 newly-priced files starts with exactly zero
   * headroom. The `SKILL.md` rows were NOT re-measured by that change and keep
   * `strippedInternalIds` as their origin; this basis explains only the new
   * rows, which is why it is a separate field rather than a rewrite of the one
   * above.
   */
  bundleExtension: 'c026b0d2d',
};

/**
 * Measured counts, in the convention above. SHRINK-ONLY: lower freely, and see
 * the header for what the other direction costs.
 *
 * Basis: `main` = 465bfce90 for every file, EXCEPT the two files PR #10402
 * touches (`objectstack-data`, `objectstack-platform`), measured from that PR's
 * branch head `7228d6c25` — see {@link CEILING_BASIS}.
 */
export const CEILINGS = new Map([
  // Every row re-measured after the internal issue-id strip — see
  // CEILING_BASIS.strippedInternalIds. `(was N)` is the ceiling this replaced.
  ['skills/objectstack-ai/SKILL.md', 6806], //          -18 (was 6824)
  // -12 (was 6331): the `http.server` decision-table row dropped a trailing
  // clause that taught `contributes.routes` as a key that "parses but serves
  // nothing". The key is retired — an authored entry is now REFUSED, carrying
  // the removal prescription — so the clause described a state the runtime no
  // longer has. Lowered to the measurement, per the shrink-only discipline.
  ['skills/objectstack-api/SKILL.md', 6319],
  // 12511 -> 12643 (#11348): the flow value-expression section documented the
  // expression surface but not the function vocabulary (round/floor/ceil/abs/
  // min/max); an unknown function fails at RUNTIME, not at flow-save, so the
  // published teaching is the only guard. +132 tokens, compressed to minimum.
  // Maintainer ruling 2026-08-25 (option B1, raise the ceiling), verbatim and
  // untranslated: 「我看到了,你分析过了,接受你的建议」.
  ['skills/objectstack-automation/SKILL.md', 12643],
  ['skills/objectstack-data/SKILL.md', 13783], //       -34 (was 13817)
  ['skills/objectstack-formula/SKILL.md', 6002], //     -53 (was 6055)
  ['skills/objectstack-i18n/SKILL.md', 6338], //        -11 (was 6349)
  ['skills/objectstack-platform/SKILL.md', 12705], //   -11 (was 12716)
  // 14239 -> 14391: the pull-directed split-resolution order joined the decision
  // frame (maintainer ruling 2026-08-27, verbatim and untranslated: 「tong y 4」 —
  // accepting the four-rule set), and this file carries TWO enforced frame copies
  // (check:skill-frame-sync COPIES), so the rule ships to third-party installers
  // with the frame it amends — the #5130 drift is exactly a frame-semantics change
  // that skipped this mirror. +152 tokens across both copies, compressed to the
  // minimal anchor form; the raising PR's body carries the arithmetic.
  ['skills/objectstack-pm-dispatch/SKILL.md', 14391],
  ['skills/objectstack-query/SKILL.md', 5552], //       -17 (was 5569)
  // 25125 -> 25143: the CRM UI Blueprint — the catalog's module-completeness
  // list, and the only place an agent is told what a finished module contains —
  // priced `src/views/**`, `src/apps/**`, dashboards and reports but never the
  // DATASET those last two bind, so an agent grew the app face and left the
  // analytics face silently empty (a module shipped with views, nav, approvals
  // and permissions was simply absent from the report builder). Maintainer
  // ruling 2026-08-31, director seat batch #15, verbatim and untranslated:
  // 「同意」 — accepting option C, whose text is: 「发布技能与文档的「长模块」路径
  // 必须把 dataset 声明列为模块完整性的一部分」. Arithmetic, in bytes because that
  // is what this convention divides: +204 for the new blueprint row, -7 for the
  // Reports row it lets shrink, and -77 for a sentence deleted in the same file
  // that restated report binding a second time inside its own paragraph — +120
  // net, 25113 -> 25143 tokens. The row's 12 tokens of headroom absorb part of
  // it, so the CEILING moves 18. The raising PR's body carries the same numbers.
  ['skills/objectstack-ui/SKILL.md', 25143],
  ['skills/objectstack-upgrade/SKILL.md', 8333], //      -2 (was 8335)

  // ── the #12392 extension: the rest of the AUTHORED bundle ────────────────
  // Every row below is an INITIAL measurement, taken on
  // CEILING_BASIS.bundleExtension, of a file that shipped to every customer
  // project while carrying no ceiling at all. They are initialised AT the
  // measurement, which is what makes this a pure ratchet installation and not
  // a budget grant: every one of these files starts with exactly zero
  // headroom, so the next token added to any of them is paid for by deleting
  // one from the same file — the same terms `SKILL.md` has had since #10473.
  // ⚠️ Nothing here is an invitation to grow to a number; see the shrink-only
  // section in the header for what the other direction costs.

  // objectstack-data — the heaviest unpriced surface by a wide margin.
  // `references/data-hooks.md` alone was larger than nine of the eleven
  // SKILL.md ceilings, which is the single fact that made #12392 a defect
  // rather than an observation.
  ['skills/objectstack-data/evals/README.md', 143],
  ['skills/objectstack-data/references/data-hooks.md', 12611],
  ['skills/objectstack-data/rules/datasources.md', 911],
  ['skills/objectstack-data/rules/field-types.md', 3584],
  ['skills/objectstack-data/rules/hooks.md', 2195],
  ['skills/objectstack-data/rules/indexing.md', 3241],
  ['skills/objectstack-data/rules/lifecycle.md', 1590],
  ['skills/objectstack-data/rules/naming.md', 773],
  ['skills/objectstack-data/rules/relationships.md', 3778],
  ['skills/objectstack-data/rules/validation.md', 3024],

  // objectstack-platform
  ['skills/objectstack-platform/evals/README.md', 514],
  ['skills/objectstack-platform/references/plugin-hooks.md', 2628],
  ['skills/objectstack-platform/rules/bootstrap-patterns.md', 1093],
  ['skills/objectstack-platform/rules/plugin-hooks-events.md', 985],
  ['skills/objectstack-platform/rules/plugin-lifecycle.md', 2408],
  ['skills/objectstack-platform/rules/service-registry.md', 2331],

  // objectstack-query
  ['skills/objectstack-query/evals/README.md', 567],
  ['skills/objectstack-query/rules/aggregation.md', 2357],
  ['skills/objectstack-query/rules/filters.md', 2149],
  ['skills/objectstack-query/rules/pagination.md', 1382],

  // objectstack-automation
  ['skills/objectstack-automation/evals/README.md', 414],
  ['skills/objectstack-automation/evals/approvals/test-revise-loop.md', 1329],

  // objectstack-ui — the two authored eval files; its `references/react-blocks.md`
  // and `contracts/react-blocks.contract.json` are generator-owned and carry no
  // row here on purpose (see the boundary section).
  ['skills/objectstack-ui/evals/README.md', 289],
  ['skills/objectstack-ui/evals/analytics-inline-vs-dataset.json', 1102],

  // the remaining skills' eval notes
  ['skills/objectstack-ai/evals/README.md', 315],
  ['skills/objectstack-api/evals/README.md', 546],
  ['skills/objectstack-i18n/evals/README.md', 411],
]);

/**
 * The catalog's token count for one file's text.
 *
 * @param {string} text
 * @returns {number}
 */
export function countTokens(text) {
  if (text.length === 0) return 0;
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}

/**
 * Every file that ships inside a published skill — read off the filesystem,
 * never a hand list, walked RECURSIVELY (#12392).
 *
 * A directory under `skills/` carrying no SKILL.md is not a published skill and
 * is skipped whole; `skills/README.md` is not inside a skill directory and never
 * appears (population 3 in the header). The walk is what makes a twelfth FILE
 * inside an existing skill as impossible to land unpriced as a twelfth skill.
 *
 * @param {string} [root]
 * @returns {string[]} repo-relative paths, sorted
 */
export function discoverBundleFiles(root = REPO_ROOT) {
  const skillsDir = root === REPO_ROOT ? SKILLS_DIR : join(root, 'skills');
  const found = [];

  /** @param {string} rel */
  const walk = (rel) => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) found.push(child);
    }
  };

  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rel = `skills/${entry.name}`;
    if (!existsSync(join(root, rel, 'SKILL.md'))) continue;
    walk(rel);
  }
  return found.sort();
}

/**
 * Is this bundle path a generator's output? The register's row, or null.
 *
 * A thin, DELIBERATE pass-through: the reason it exists is to be the single
 * place this gate touches the boundary, so a reader (and the self-test) can see
 * that the answer comes from `check-governed-merges.mjs` and from nowhere else.
 * ⛔ Never replace this with a local regexp — see the header's "one definition".
 *
 * @param {string} rel
 * @returns {{id: string, generator: string} | null}
 */
export function generatorOwning(rel) {
  return generatedExceptionFor(rel);
}

/**
 * @param {string} rel
 * @param {number} tokens
 * @param {number | undefined} ceiling
 * @param {{id: string, generator: string} | null} [generated] the register row owning this path
 * @returns {{ok: boolean, msg: string}}
 */
export function verdict(rel, tokens, ceiling, generated = null) {
  if (tokens === 0) {
    return { ok: false, msg: `${rel} read as empty — refusing to treat a missing/empty input as a pass (#4690).` };
  }
  if (generated) {
    // A ceiling on a generator's output is a contradiction, not a stricter
    // setting: it reds on the next regeneration and the author it stops cannot
    // pay by deleting text, because they did not write the bytes. Caught here
    // rather than left to be discovered by the regeneration that trips it.
    if (ceiling !== undefined) {
      return {
        ok: false,
        msg:
          `${rel} carries a CEILINGS row but is a GENERATOR-OWNED output (\`${generated.generator}\`, register row `
          + `\`${generated.id}\`). Generated files are measured, never ratcheted: a ceiling here reds on a legitimate `
          + 'regeneration, and the author that red lands on did not write the bytes and cannot pay by deleting them. '
          + 'Remove the row — the file stays in the printed bundle total either way.',
      };
    }
    return {
      ok: true,
      msg: `${rel} is ${tokens} tokens — generator-owned (\`${generated.generator}\`), measured but not ratcheted.`,
    };
  }
  if (ceiling === undefined) {
    return {
      ok: false,
      msg:
        `${rel} is a hand-authored published bundle file carrying no ceiling, measured now at ${tokens} tokens. `
        + 'Every authored file in the catalog is priced, because an unpriced file is unpriced growth — the '
        + 'bundle grows by a whole file while every existing ceiling stays green. That hole is what #12392 '
        + 'measured: a file inside an existing skill used to land unpriced even though a whole new skill could not. '
        + 'If this path is in fact a generator output, it belongs in the register in '
        + '`scripts/pm/check-governed-merges.mjs` (#11705) — never in a second list here. '
        + `${RATCHET_AUTHORITY_MARKER}: adding a CEILINGS row prices new text into the bundle `
        + 'that ships to every customer project, which is the maintainer ruling this ratchet '
        + 'implements — not a step an author takes while landing the file.',
    };
  }
  if (tokens > ceiling) {
    return {
      ok: false,
      msg:
        `${rel} is ${tokens} tokens; the ratchet ceiling is ${ceiling} (over by ${tokens - ceiling}). `
        + 'The published catalog is loaded whole into every customer agent context window, so its '
        + 'length is a per-token cost paid again in every customer session. New text is paid for by '
        + 'deleting text IN THE SAME FILE — genuine deletion, never a re-wrap, which moves no tokens '
        + 'and pays nothing. Loosening a ceiling to fit new text is not the fix: these ceilings are '
        + 'shrink-only. The other direction lands only in a PR whose body quotes a maintainer ruling '
        + `authorizing it. ${RATCHET_AUTHORITY_MARKER}`,
    };
  }
  return { ok: true, msg: `${rel} is ${tokens} tokens (ceiling ${ceiling}; headroom ${ceiling - tokens}).` };
}

/**
 * The price tag, printed on SUCCESS AND FAILURE alike (#10473 direction 2).
 *
 * The visibility half of the mechanism package: every PR's CI log carries the
 * bundle's current cost and each file's distance from its ceiling, so growth is
 * legible in review even in the runs where nothing crosses a line.
 *
 * @param {Array<{rel: string, tokens: number, ceiling: number | undefined}>} rows
 */
export function reportLines(rows) {
  const out = [`── published skills bundle — price tag (convention: ${TOKEN_CONVENTION})`];
  let pricedTokens = 0;
  let pricedCeiling = 0;
  let generatedTokens = 0;
  for (const { rel, tokens, ceiling, generated } of rows) {
    if (generated) {
      generatedTokens += tokens;
      out.push(`   ${rel.padEnd(58)} ${String(tokens).padStart(6)} /      —   (generated)`);
      continue;
    }
    pricedTokens += tokens;
    pricedCeiling += ceiling ?? 0;
    const delta = ceiling === undefined ? 'unpriced' : `${tokens - ceiling >= 0 ? '+' : ''}${tokens - ceiling}`;
    const shown = ceiling === undefined ? 'none' : String(ceiling);
    out.push(`   ${rel.padEnd(58)} ${String(tokens).padStart(6)} / ${shown.padStart(6)}   (${delta})`);
  }
  const net = pricedTokens - pricedCeiling;
  // Three lines, because #12392's complaint was that this gate could not
  // produce a whole-tree `skills/**` delta: its reading was byte-identical
  // before and after a PR that changed three published files. The generated
  // subtotal is what makes the last line a real bundle number rather than the
  // ratcheted subset wearing that name.
  out.push(
    `   ${'ratcheted (authored)'.padEnd(58)} ${String(pricedTokens).padStart(6)} / ${String(pricedCeiling).padStart(6)}`
    + `   (${net >= 0 ? '+' : ''}${net})`,
  );
  out.push(`   ${'generator-owned (measured, not ratcheted)'.padEnd(58)} ${String(generatedTokens).padStart(6)} /      —`);
  out.push(`   ${'bundle total (whole shipped tree)'.padEnd(58)} ${String(pricedTokens + generatedTokens).padStart(6)}`);
  return out;
}

function run() {
  const covered = [...new Set([...discoverBundleFiles(), ...CEILINGS.keys()])].sort();
  const rows = [];
  let failed = 0;

  for (const rel of covered) {
    let text;
    try {
      text = readFileSync(join(REPO_ROOT, rel), 'utf8');
    } catch {
      console.error(`✗ check-skills-token-ratchet: cannot read ${rel} — red, not a skip (#4690).`);
      failed++;
      continue;
    }
    const tokens = countTokens(text);
    const ceiling = CEILINGS.get(rel);
    const generated = generatorOwning(rel);
    rows.push({ rel, tokens, ceiling, generated });
    const v = verdict(rel, tokens, ceiling, generated);
    if (!v.ok) {
      failed++;
      console.error(`✗ check-skills-token-ratchet: ${v.msg}`);
      continue;
    }
    console.log(`✓ check-skills-token-ratchet: ${v.msg}`);
  }

  const ratcheted = rows.filter((r) => !r.generated).length;

  console.log('');
  for (const line of reportLines(rows)) console.log(line);

  if (failed) {
    console.error(`\n✗ check-skills-token-ratchet: ${failed} of ${covered.length} published bundle file(s) failed their check.`);
    process.exit(1);
  }
  console.log(
    `\n✓ check-skills-token-ratchet: ${ratcheted} authored bundle file(s) within their ceilings; `
    + `${covered.length - ratcheted} generator-owned file(s) measured, not ratcheted.`,
  );
}

/**
 * A throwaway skills tree, so the WALK itself is pinned against something whose
 * shape this test controls. Without it the enumeration cases can only ask the
 * real tree, and a walk that quietly stopped recursing would still satisfy
 * every one of them by returning the SKILL.md files it did find.
 *
 * @returns {{root: string, cleanup: () => void}}
 */
function fixtureTree() {
  const root = mkdtempSync(join(tmpdir(), 'skills-ratchet-'));
  const write = (rel, text) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  write('skills/README.md', '# catalog front page\n');
  write('skills/demo/SKILL.md', '# demo\n');
  write('skills/demo/rules/nested.md', '# nested rule\n');
  write('skills/demo/evals/deep/deeper/case.md', '# deep case\n');
  write('skills/demo/references/_index.md', '# generated index\n');
  write('skills/not-a-skill/notes.md', '# a directory with no SKILL.md\n');
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function selfTest() {
  const rel = 'skills/objectstack-ui/SKILL.md';
  const over = verdict(rel, 26000, 25154).msg;
  const unpriced = verdict('skills/objectstack-new/SKILL.md', 4000, undefined).msg;
  const discovered = discoverBundleFiles();
  const authored = discovered.filter((p) => !generatorOwning(p));
  const generated = discovered.filter((p) => generatorOwning(p));

  // The #12392 boundary fixtures, all real paths on this tree.
  const genIndex = 'skills/objectstack-ai/references/_index.md';
  const genContract = 'skills/objectstack-ui/contracts/react-blocks.contract.json';
  const authoredRef = 'skills/objectstack-data/references/data-hooks.md';
  const authoredRule = 'skills/objectstack-data/rules/relationships.md';
  const genGreen = verdict(genIndex, 754, undefined, generatorOwning(genIndex));
  const genPriced = verdict(genIndex, 754, 754, generatorOwning(genIndex));
  const unpricedNested = verdict(authoredRule, 3778, undefined, null).msg;

  const fixture = fixtureTree();
  let walked;
  try {
    walked = discoverBundleFiles(fixture.root);
  } finally {
    fixture.cleanup();
  }

  const skillMdCeilings = [...CEILINGS.entries()].filter(([p]) => p.endsWith('/SKILL.md'));

  const cases = [
    // ── ratchet semantics ────────────────────────────────────────────────
    ['under the ceiling -> green', verdict(rel, 25000, 25154).ok, true],
    ['at the ceiling -> green', verdict(rel, 25154, 25154).ok, true],
    ['over the ceiling -> red', verdict(rel, 25155, 25154).ok, false],
    ['empty read -> red, not a skip (#4690)', verdict(rel, 0, 25154).ok, false],
    ['the red names the file', over.includes(rel), true],
    ['the red names the measured count', over.includes('26000'), true],
    ['the red names the ceiling', over.includes('25154'), true],
    ['the red names the rule: deletion in the same file', over.includes('IN THE SAME FILE'), true],
    ['the red rejects a re-wrap as payment', over.includes('never a re-wrap'), true],
    // Shrink-only, pinned in the DIRECTION it runs: a file measured below its
    // ceiling is green and the green message reports the headroom, which is
    // what makes an opportunistic lowering visible. Nothing here rewrites a
    // ceiling — the map is edited by a person, in a PR, in one direction.
    ['shrink direction — a shrunk file is green and its headroom is reported',
      verdict(rel, 20000, 25154).ok && verdict(rel, 20000, 25154).msg.includes('headroom 5154'), true],
    ['the gate declares its registry shrink-only in author-facing text', over.includes('shrink-only'), true],

    // ── remedy authority (#8435) ─────────────────────────────────────────
    ['the over-ceiling remedy carries the authority token', over.includes(RATCHET_AUTHORITY_MARKER), true],
    ['the unpriced-file remedy carries the authority token', unpriced.includes(RATCHET_AUTHORITY_MARKER), true],
    // The convention's actual content: the author is never handed the steps for
    // loosening the ratchet. Pinned as an ABSENCE, because that is the shape
    // the failure takes — a helpful sentence appended a year from now.
    ['no remedy tells the author to raise a ceiling', /raise (?:the |a |its )?ceiling to|bump the ceiling|update the ceiling to/i.test(`${over} ${unpriced}`), false],
    ['the raise is bound to a quoted maintainer ruling', over.includes('quotes a maintainer ruling'), true],

    // ── the counting convention ──────────────────────────────────────────
    ['four ASCII bytes are one token', countTokens('abcd'), 1],
    ['five ASCII bytes round up to two', countTokens('abcde'), 2],
    ['the unit is UTF-8 BYTES, not JS characters (a 3-byte CJK char is not free)', countTokens('中'), 1],
    ['empty text counts zero, which the verdict turns red', countTokens(''), 0],

    // ── enumeration, never a hand list ───────────────────────────────────
    ['the catalog is discovered from disk', discovered.length > 0, true],
    ['every discovered file lives under a published skill directory',
      discovered.every((p) => /^skills\/[^/]+\/.+/.test(p)), true],
    // The hole the enumeration exists to close: a twelfth published skill must
    // not land unpriced. A hand list would simply not mention it.
    ['a discovered file with no ceiling is RED', verdict('skills/objectstack-new/SKILL.md', 4000, undefined).ok, false],
    ['the unpriced red names the file and its measured count',
      unpriced.includes('skills/objectstack-new/SKILL.md') && unpriced.includes('4000'), true],
    ['every discovered AUTHORED file carries a ceiling today', authored.filter((p) => !CEILINGS.has(p)), []],
    ['every ceiling names a file the enumeration finds', [...CEILINGS.keys()].filter((p) => !discovered.includes(p)), []],
    ['every ceiling is a positive integer',
      [...CEILINGS.values()].every((n) => Number.isInteger(n) && n > 0), true],

    // ── #12392: the walk actually recurses ───────────────────────────────
    // The vacuity direction, pinned on a tree this test built: a walk that
    // stopped at SKILL.md would pass every real-tree case above by returning
    // the 11 files it still found. These fail loudly instead.
    ['the walk descends past SKILL.md into rules/', walked.includes('skills/demo/rules/nested.md'), true],
    ['the walk descends arbitrarily deep', walked.includes('skills/demo/evals/deep/deeper/case.md'), true],
    ['a directory carrying no SKILL.md is skipped whole',
      walked.some((p) => p.startsWith('skills/not-a-skill/')), false],
    ['skills/README.md is outside the population (population 3)', walked.includes('skills/README.md'), false],
    ['the fixture walk finds exactly its four in-skill files', walked.length, 4],
    // The same non-vacuity, asserted against the REAL tree: the population must
    // be strictly larger than the SKILL.md set it used to be, or #12392's
    // extension has silently reverted to what it replaced.
    ['the real population is more than one file per skill', authored.length > skillMdCeilings.length, true],
    ['the real population reaches rules/ and hand-authored references/',
      authored.includes(authoredRule) && authored.includes(authoredRef), true],

    // ── #12392: the authored/generated boundary ──────────────────────────
    // The boundary is the register's answer, never a local regexp. These pin
    // that the reuse is wired and pointing the right way in BOTH directions.
    ['a generated _index.md is recognised as generator-owned', generatorOwning(genIndex)?.id, 'spec-skill-refs'],
    ['the react-blocks contract is recognised as generator-owned', generatorOwning(genContract)?.id, 'spec-react-blocks'],
    ['a hand-authored reference is NOT generator-owned', generatorOwning(authoredRef), null],
    ['a hand-authored rule is NOT generator-owned', generatorOwning(authoredRule), null],
    ['a SKILL.md is NOT generator-owned', generatorOwning(rel), null],
    // Generated files are measured, never ratcheted — and the green says so.
    ['a generator-owned file with no ceiling is GREEN, not an unpriced red', genGreen.ok, true],
    ['its green names the generator that owns it', genGreen.msg.includes('gen:skill-refs'), true],
    ['its green says measured-but-not-ratcheted', genGreen.msg.includes('not ratcheted'), true],
    // The contradiction guard: pricing a generated file reds on regeneration,
    // so the row itself is the error, caught here rather than by the regen.
    ['a CEILINGS row on a generator-owned file is RED', genPriced.ok, false],
    ['that red explains the wrong-actor reason', genPriced.msg.includes('regeneration'), true],
    ['no ceiling names a generator-owned path', [...CEILINGS.keys()].filter((p) => generatorOwning(p)), []],
    // The vacuity direction for the boundary predicate itself: a predicate that
    // answered "generated" for everything would price NOTHING and stay green.
    ['the boundary does not swallow the population', authored.length > 0, true],
    ['the boundary excludes something (it is not inert)', generated.length > 0, true],
    // THE TRIPWIRE (see the header's "known limit of the reuse"). The excluded
    // set is pinned by name, so a hand-authored file that happens to match a
    // generated spelling cannot slip out of pricing unnoticed — it changes this
    // list, reds here, and gets a human's eyes.
    ['the excluded set is exactly these generator-owned paths', generated, [
      'skills/objectstack-ai/references/_index.md',
      'skills/objectstack-api/references/_index.md',
      'skills/objectstack-automation/references/_index.md',
      'skills/objectstack-data/references/_index.md',
      'skills/objectstack-formula/references/_index.md',
      'skills/objectstack-i18n/references/_index.md',
      'skills/objectstack-platform/references/_index.md',
      'skills/objectstack-query/references/_index.md',
      'skills/objectstack-ui/contracts/react-blocks.contract.json',
      'skills/objectstack-ui/references/_index.md',
      'skills/objectstack-ui/references/react-blocks.md',
    ]],
    // The extension's own red, on a real newly-priced path: the message has to
    // name the authored-bundle rule, not the old SKILL.md-only one.
    ['the unpriced red covers a file INSIDE a skill, not just a new skill',
      unpricedNested.includes('hand-authored published bundle file'), true],
    ['the unpriced red routes a genuine generator output to the register, not to a second list',
      unpricedNested.includes('check-governed-merges.mjs') && unpricedNested.includes('never in a second list'), true],

    // ── the two-basis pin (#10402) ───────────────────────────────────────
    // Enforcement cannot hold this: both shas run perfectly green whatever they
    // say, because the gate never reads them. Without these cases the recorded
    // provenance drifts from the numbers it explains, silently.
    ['the main basis sha is recorded', CEILING_BASIS.main, '465bfce90'],
    ['the pending-#10402 basis sha is recorded', CEILING_BASIS.pending10402, '7228d6c25'],
    ['exactly the two #10402 files are pinned on the second basis',
      CEILING_BASIS.from10402.join(','),
      'skills/objectstack-data/SKILL.md,skills/objectstack-platform/SKILL.md'],
    ['both second-basis files carry a ceiling', CEILING_BASIS.from10402.every((p) => CEILINGS.has(p)), true],

    // ── the internal-id strip re-measure ─────────────────────────────────
    // Same reason as the two pins above: the gate never reads this sha, so a
    // recorded provenance that drifts from the numbers it explains does so in
    // silence. Pinned here, it moves only when someone means to move it.
    ['the internal-id-strip basis sha is recorded', CEILING_BASIS.strippedInternalIds, '3f571a6d2'],
    // The direction, asserted rather than assumed: this re-measure LOWERED the
    // bundle. A future edit that re-measures upward has to change this number
    // and meet the maintainer-ruling bar in the header while doing it.
    // ⚠️ Scoped to the SKILL.md rows since #12392 widened the map: summing ALL
    // ceilings would compare this re-measure's subtotal against a total that
    // now includes 27 rows it never touched, which is a different claim.
    // 117943 -> 118095: shifted by exactly the +152 ruling-authorized raise on
    // the pm-dispatch row (2026-08-27 「tong y 4」, see that row), so the strip's
    // lowering claim keeps its original slack instead of being silently eaten.
    ['the re-measure lowered the SKILL.md subtotal',
      skillMdCeilings.reduce((a, [, n]) => a + n, 0) < 118095, true],

    // ── the #12392 extension basis ───────────────────────────────────────
    // Same reasoning as the pins above: the gate never reads this sha, so it
    // drifts from the rows it explains in silence unless something pins it.
    ['the #12392 extension basis sha is recorded', CEILING_BASIS.bundleExtension, 'c026b0d2d'],
    // The extension's whole point, as a number: the priced population is no
    // longer one file per skill. If a future edit collapses it back, this is
    // the case that says so out loud.
    ['the extension priced more than the eleven SKILL.md files', CEILINGS.size > 11, true],
    ['every SKILL.md still carries its own ceiling', skillMdCeilings.length, 11],

    // ── the report line ──────────────────────────────────────────────────
    ['the report prints a whole-bundle total',
      reportLines([{ rel, tokens: 10, ceiling: 20 }]).some((l) => l.includes('bundle total (whole shipped tree)')), true],
    ['the report prints a per-file net delta against the ceiling',
      reportLines([{ rel, tokens: 30, ceiling: 20 }]).some((l) => l.includes('(+10)')), true],
    ['the report names the counting convention',
      reportLines([]).some((l) => l.includes(TOKEN_CONVENTION)), true],
    // #12392's headline complaint was that this gate could not produce a
    // whole-tree delta — its number was byte-identical across a PR that changed
    // three published files. A generated file must therefore move the bundle
    // total even though it moves no ceiling.
    ['a generator-owned file is counted in the bundle total',
      reportLines([{ rel: genIndex, tokens: 754, ceiling: undefined, generated: generatorOwning(genIndex) }])
        .some((l) => l.includes('bundle total (whole shipped tree)') && l.includes('754')), true],
    ['a generator-owned file is NOT counted into the ratcheted subtotal',
      reportLines([{ rel: genIndex, tokens: 754, ceiling: undefined, generated: generatorOwning(genIndex) }])
        .some((l) => l.includes('ratcheted (authored)') && / 0 \/ +0/.test(l)), true],
    ['the report separates the generator-owned subtotal',
      reportLines([]).some((l) => l.includes('generator-owned (measured, not ratcheted)')), true],
  ];

  let failed = 0;
  for (const [name, actual, expected] of cases) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  }
  if (failed) {
    console.error(`✗ check-skills-token-ratchet self-test: ${failed} of ${cases.length} case(s) failed.`);
    process.exit(1);
  }
  console.log(`✓ check-skills-token-ratchet self-test: ${cases.length} cases pass.`);
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else run();
}
