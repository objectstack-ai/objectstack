import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here —
// re-adding one is itself an error (TS2578). See objectui#3494.
import { blank, maskComments, scanSource } from '../js-comment-mask.mjs';

/**
 * ObjectUI — the `thresholds` closure claim, re-derived (objectui#6186 claim 2)
 *
 * ## What this file is for
 *
 * `packages/sdui-parser/src/dashboard-widget-options.ts` warns on a dashboard
 * widget `options` key that reaches no renderer. Its census header names
 * `thresholds` as the headline case, and the reason the warning is allowed to
 * fire on it is a CLOSURE CLAIM: nothing in this repository reads a
 * `thresholds` key. That claim used to be written TWICE — once in the census
 * header and once, in its own words, on
 * `content/docs/plugins/plugin-dashboard.mdx`. Two copies of one closure claim
 * drift apart independently, and neither copy knows when the other stops being
 * true.
 *
 * The 2026-08-25 maintainer ruling (batch adjudication close-out, decision B1)
 * settled what a doc may assert about a population it does not own: **bounded
 * or derivable**. A closure claim must either name a bounded population, or be
 * backed by a gate that re-derives it. A claim written in two places is
 * single-sourced — one copy states it, the other points.
 *
 * So: the census header is now the CANONICAL statement, the page points at it,
 * and single-sourcing is exactly what makes the surviving copy load-bearing.
 * This file is the other half of the ruling — it re-derives the claim from
 * source on every test run instead of trusting the paragraph that states it.
 *
 * ⛔ Why not a `toContain` pin on the prose. That is the defect objectui#6186
 * filed one level up: a test asserting a sentence is PRESENT cannot assert the
 * sentence is TRUE, and a green presence pin reads as coverage of the claim it
 * quotes. Land a renderer that reads the key tomorrow and a presence pin stays
 * green while the census, the warning and the page all turn false together.
 *
 * ## What the instrument can and cannot see — read before trusting a verdict
 *
 * It is a TEXT scan over comment- and literal-masked code, so it answers "does
 * any site in this repository access a key named `thresholds`". It matches the
 * three spellings an access can take — member (`x.thresholds`, including
 * optional chaining), computed with a literal key (`x['thresholds']`), and
 * destructured (`const { thresholds } = x`).
 *
 * Two stated biases, both deliberate:
 *
 *  - **A member-access WRITE matches too** (`x.thresholds = 1`). The claim is
 *    about reads, so this is the red-on-a-true-claim direction — accepted
 *    because a site that puts the key onto an object is something a human
 *    should look at before the warning keeps firing, and because no such site
 *    exists in this tree.
 *  - **A computed access through a VARIABLE key is invisible** (`x[k]` where
 *    `k === 'thresholds'`). Nothing can see that textually. The census test's
 *    leg 2 covers the one file where it would matter by REFUSING the shape:
 *    `packages/sdui-parser/src/__tests__/dashboard-widget-options-census.test.ts`
 *    fails loudly if `DatasetWidget.tsx` ever gains a computed access, a spread
 *    or a destructuring of the options bag.
 *
 * ⚠️ TWO masks, because the three spellings need different ones — measured,
 * not assumed: the positive control below caught this file getting it wrong on
 * the first run. A member access and a destructuring are CODE, so both are read
 * off source with comments AND string literals blanked; a mention of the key
 * inside a string is prose there. But a computed access spells its key AS a
 * string literal (`x['thresholds']`), so blanking literals erases the very
 * thing being looked for — that leg reads source with COMMENTS ONLY blanked.
 * Keeping literals visible costs one thing back, and it is paid rather than
 * declared: an access merely QUOTED inside a string (`"options['thresholds']"`)
 * looks identical to a real one. The literal flags settle it — in real code the
 * `[` is code and the key is the literal; in a quoted access the `[` is literal
 * too — so that leg requires the bracket itself to be code. This is not
 * theoretical: the gate reddened on its OWN fixture table and diagnostic
 * message the moment it was committed, which is the moment a tracked-files
 * population first contained it.
 *
 * Masking is what lets this scan read its own negative-control table, the
 * census header and this very docblock — all of which spell the key — without
 * reddening on any of them.
 *
 * ## Relationship to the census test
 *
 * They derive different halves and neither does the other's job:
 *
 *  - the census test re-derives the CONSUMED set (what the declared keys are,
 *    and what `DatasetWidget.tsx` really reads) — a claim about one render path;
 *  - this file re-derives the UNCONSUMED claim for `thresholds` — a claim about
 *    the whole repository, which is why it needs the whole repository.
 *
 * ⚠️ `format` and `invert`, the census's other two unconsumed keys, are
 * deliberately NOT scanned this way. Both are live keys in other vocabularies
 * (`measureField(...).format` is how a dataset-bound value is really formatted),
 * so a repo-wide bare scan would red on true claims — the failure the dispatch
 * on this card called the load-bearing risk, because an assertion that reds on
 * legitimate code gets deleted by the next person who hits it, and the claim
 * goes back to unguarded. Their claim is BOUNDED to the dataset-bound path
 * instead, and the census test's leg 2 derives that bound.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const CENSUS_MODULE = 'packages/sdui-parser/src/dashboard-widget-options.ts';
const DASHBOARD_PAGE = 'content/docs/plugins/plugin-dashboard.mdx';

/**
 * Comment- and literal-blanked source — the repo's ONE answer to
 * "is this span code, or prose?" (`scripts/js-comment-mask.mjs`). Masking only
 * ever REMOVES text, so a site found in the masked code implies the raw file
 * carries it.
 */
function codeOnly(source: string): string {
  const { comment, literal } = scanSource(source);
  const flags = new Uint8Array(source.length);
  for (let i = 0; i < source.length; i++) flags[i] = comment[i] || literal[i];
  return blank(source, flags);
}

/**
 * Every site in `source` that accesses a key named `thresholds`, reported as
 * `line: what`. Empty means the census claim holds for this file.
 */
function thresholdsKeySites(source: string): string[] {
  const code = codeOnly(source);
  // Every mask BLANKS rather than deletes, so offsets are shared across all
  // three views and one line lookup serves them all.
  const lineOf = (index: number) => source.slice(0, index).split('\n').length;
  const sites: string[] = [];

  // Member access, `.thresholds` and `?.thresholds` alike. The trailing `\b`
  // keeps `thresholdsCount` out; requiring the dot immediately before the name
  // keeps `alertThresholds` and every other camelCase suffix spelling out.
  for (const m of code.matchAll(/\.\s*thresholds\b/g)) {
    sites.push(`${lineOf(m.index ?? 0)}: member access \`${m[0].replace(/\s+/g, '')}\``);
  }

  // Computed access with a literal key — read off COMMENT-masked source, where
  // string literals survive. `codeOnly` would blank the key itself and this leg
  // could never fire (it silently did not, until the positive control caught
  // it). A variable key (`x[k]`) is invisible to any text scan and is declared
  // as such in this file's header.
  //
  // ⭐ The bracket must ITSELF be code. Keeping literals visible is what lets
  // this leg see `x['thresholds']`, but it also lets it see an access merely
  // QUOTED inside a string — which this very file does, in its fixture table and
  // in the diagnostic message three lines below. `scanSource`'s literal flags
  // answer the difference exactly: in real code the `[` is code and the KEY is
  // the literal; in a quoted access the `[` is literal too. Measured, not
  // assumed — the gate went red on its own source the moment it became a
  // tracked file, which is also when it first entered its own population.
  const commentMasked = maskComments(source);
  const { literal } = scanSource(source);
  for (const m of commentMasked.matchAll(/\[\s*(['"])thresholds\1\s*\]/g)) {
    const at = m.index ?? 0;
    if (literal[at]) continue;
    sites.push(`${lineOf(at)}: computed access \`['thresholds']\``);
  }

  // Destructuring. The trailing `=` is what separates a destructuring PATTERN
  // (`const { thresholds } = bag` — a read) from an object LITERAL
  // (`{ thresholds: [...] }` — a write, which authors the key rather than
  // consuming it, and which this repository's own test fixtures really do).
  // `[^{}]*` keeps the match inside one brace level, so a nested object cannot
  // be walked into by accident.
  for (const m of code.matchAll(/\{[^{}]*\bthresholds\b[^{}]*\}\s*=/g)) {
    sites.push(`${lineOf(m.index ?? 0)}: destructured from a bag`);
  }

  return sites;
}

describe('objectui#6186 claim 2 — the matcher discriminates before it is trusted', () => {
  // Fixtures rather than the tree, so both controls stay decidable when the
  // source moves. The POSITIVE control proves the assertion below can fail at
  // all; an assertion that cannot fail is the vacuous-green shape this whole
  // card is about.
  it('fires on every spelling a real access can take', () => {
    for (const source of [
      'const t = widget.options.thresholds;',
      'const t = widget.options?.thresholds;',
      "const t = options['thresholds'];",
      'const t = options["thresholds"];',
      'const { thresholds } = widget.options;',
      'const { limit, thresholds } = opts;',
      'function render({ thresholds } = {}) { return thresholds; }',
      'if (widget.options.thresholds) return null;',
    ]) {
      expect(thresholdsKeySites(source), source).not.toEqual([]);
    }
  });

  // ⭐ The load-bearing half. Every negative below is a spelling this repository
  // really writes, cited where it lives. An assertion that red on any of them
  // would be deleted by the first person who hit it, and the claim would be
  // back to unguarded — which is worse than never having written this file.
  it('stays silent on every near-spelling and prose mention this tree really carries', () => {
    for (const source of [
      '/** Alert thresholds */', //                          packages/types/src/data-protocol.ts:1590
      '// against configurable thresholds. Violations are recorded, deduplicated', // react/src/hooks/usePerformanceBudget.ts:128
      '// the total from `result.total` and offers the banner at the same thresholds.', // plugin-list ListView.crossPageSelectAll.test.tsx:222
      'const options = { thresholds: [{ value: 0.95, color: '+ "'success'" + ' }] };', // sdui-parser dashboard-widget-options.test.ts:61
      "expect(keys).toEqual(['format', 'invert', 'thresholds']);", // sdui-parser dashboard-widget-options.test.ts:98
      'const coverage = { thresholds: { lines: 40, functions: 33 } };', // vitest.config.mts coverage config
      "const note = 'enforces the configured coverage thresholds over it';", // scripts/dependabot-merge-gate.mjs:203
      'const t = budget.alertThresholds;', //                 camelCase suffix spelling
      'const t = cfg.thresholdsCount;', //                    prefix spelling
      'const t = thresholds;', //                             a bare local, not a KEY access
      'export function apply(thresholds: number[]) { return thresholds.length; }',
      '// widget.options.thresholds is not read by any renderer', // ⭐ self-reference: this repo's own prose
      "const fixture = 'const t = widget.options.thresholds;';", // ⭐ self-reference: a fixture table
      'const msg = `computed access [\'thresholds\']`;', //      ⭐ a template QUOTING an access
      "const fixture2 = \"const t = options['thresholds'];\";", // ⭐ this file's own fixture shape
    ]) {
      expect(thresholdsKeySites(source), source).toEqual([]);
    }
  });
});

describe('objectui#6186 claim 2 — the claim itself, re-derived from source', () => {
  it('nothing in this repository accesses a `thresholds` key', () => {
    // SCANNED POPULATION, stated because the claim says "in this repository":
    // every JS/TS-family file git tracks — `.ts`, `.tsx`, `.mts`, `.cts`, `.js`,
    // `.mjs`, `.cjs`, `.jsx`. 3,743 files on the tree this was written against.
    //
    // DERIVED, not listed, and derived from the same configuration the repo's
    // other whole-tree gates read: `node_modules`, `dist` and every build output
    // are untracked and so are out by construction.
    // `scripts/check-control-bytes.mjs` reads this repository the same way.
    //
    // The JS half is in on purpose. The census header's claim is about the whole
    // repository, not about its TypeScript; scanning only `.ts` would make the
    // gate assert LESS than the prose while looking like it covers it, which is
    // the exact defect objectui#6186 filed. Population and claim have to stay
    // co-extensive — narrow one, narrow the other in the same change.
    const tracked = execFileSync('git', ['ls-files', '-z'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\0')
      .filter((rel) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(rel));

    // The walk cannot collapse quietly. An empty population makes the assertion
    // below vacuous and green forever — a scan that finds nothing reads exactly
    // like a scan that found nothing wrong, which is the failure shape this card
    // is about, one level up.
    expect(tracked.length, 'the source walk found no JS/TS files at all').toBeGreaterThan(1000);

    const sites: string[] = [];
    for (const rel of tracked) {
      const source = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
      // Prefilter on the raw bytes. Masking only ever REMOVES text, so a site in
      // the masked code implies the raw file carries the name.
      if (!source.includes('thresholds')) continue;
      for (const site of thresholdsKeySites(source)) sites.push(`${rel}:${site}`);
    }

    expect(
      sites,
      `${CENSUS_MODULE} tells the reader that nothing in this repository reads a ` +
        '`thresholds` key, and the unconsumed-widget-option warning fires on that basis. ' +
        `These access one, so either the census or the access has to go:\n${sites.join('\n')}`,
    ).toEqual([]);
  });
});

describe('objectui#6186 claim 2 — the claim is single-sourced, and the pointer resolves', () => {
  const page = fs.readFileSync(path.join(repoRoot, DASHBOARD_PAGE), 'utf8');
  const census = fs.readFileSync(path.join(repoRoot, CENSUS_MODULE), 'utf8');

  /**
   * A docblock WRAPS. `toContain` over raw text therefore fails when someone
   * reflows a paragraph, which is a false red on an unchanged claim — so the
   * comment markers come off and the whitespace collapses first, and what is
   * asserted is the sentence rather than its line breaks.
   */
  const prose = (source: string) => source.replace(/^\s*\*\s?/gm, '').replace(/\s+/g, ' ');

  it('the canonical copy is the census header, and it still states the claim', () => {
    // Referential integrity, not a sentence pin: the page below points AT this
    // file, so the claim vanishing from it would leave the pointer aimed at
    // nothing while every test stayed green.
    expect(prose(census)).toContain('CANONICAL statement of that closure claim');
    expect(prose(census)).toContain('zero read sites repo-wide');
  });

  it('the page points at the canonical copy instead of restating it', () => {
    // The ruling: a claim written in two places is single-sourced — one copy
    // states it, the other points. What must not come back is a SECOND
    // independent wording of the closure claim on the page, which is what
    // objectui#6186 filed: the two copies drift apart and neither knows.
    expect(page).toContain(CENSUS_MODULE);
    expect(page, 'the page is restating the closure claim in its own words again').not.toMatch(
      /no renderer in this repository reads/i,
    );
  });

  it('the pointer names a file that really exists', () => {
    // A path in prose is a claim too. This one is cheap to re-derive, so it is.
    expect(fs.existsSync(path.join(repoRoot, CENSUS_MODULE))).toBe(true);
  });
});
