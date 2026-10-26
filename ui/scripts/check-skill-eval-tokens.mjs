#!/usr/bin/env node
/**
 * Every `must_contain` token of every `skills/<bundle>/evals/*.json` must be
 * something the skill bundle actually TEACHES — present as a WHOLE token in the
 * bundle's own markdown.
 *
 * Run:  node scripts/check-skill-eval-tokens.mjs        (also `pnpm check:skill-eval-tokens`)
 *       node scripts/check-skill-eval-tokens.mjs --list        # every row + both oracles' counts
 *       node scripts/check-skill-eval-tokens.mjs --measure     # BOTH red lists, side by side
 *       node scripts/check-skill-eval-tokens.mjs --self-test   # fixtures, both directions
 * Exit: 0 = every `must_contain` token is taught, and the population is non-empty.
 *       1 = THE GATE RAN AND FOUND ERRORS. A token no guide teaches, an eval
 *           assertion of the wrong shape, or a stale baseline row. Everything
 *           printed above the summary is a verdict about an eval.
 *       2 = THE GATE COULD NOT RUN, so nothing printed above is a verdict about
 *           any eval: no eval population, no guide corpus, or an eval file that
 *           does not parse. Fix the tree and re-run. Never read this as an eval
 *           defect, and never as a pass.
 *
 * ## The gap this closes (objectui#7461)
 *
 * `skills/objectui/evals/*.json` grade an answering agent by `must_contain` /
 * `must_not_contain` tokens. Nothing checked that a `must_contain` token was
 * something the skill teaches, so an eval could require a word the guides never
 * say and grade nothing forever. The class has been cleaned BY HAND twice:
 *
 *   - objectui#7360 (PR #7408): six assertions graded tokens their own guide
 *     never taught; one passed only by accidental substring.
 *   - objectui#7405 (PR #7422): three more — `create` matched a mocked
 *     dataSource method, `view` matched the tail of `// vite preview`, and
 *     `visible` was untaught and was re-pointed to the taught `hidden`.
 *
 * Both rounds were found by a human reading, which is exactly the economics
 * `check-skills-paths.mjs` and `check-skill-examples.mjs` were built to end for
 * their own surfaces. `check-skill-examples.mjs` names this check in its
 * "Deliberately NOT answered here" list, item 4, as a different oracle over a
 * different corpus — this file is that check.
 *
 * ## THE ORACLE: bundle-wide, and what the losing option would have cost
 *
 * The load-bearing decision is which guide set a token has to appear in. Two
 * candidates, both measured at the branch point over all 125 `must_contain`
 * tokens of all 33 evals in all 11 eval files:
 *
 *   | oracle                                  | red rows on day one |
 *   |-----------------------------------------|---------------------|
 *   | BUNDLE-WIDE (every `.md` in the bundle)  | 0 of 125           |
 *   | PER-GUIDE (`guides/BASENAME.md` only)    | 14 of 125          |
 *
 * ⭐ CHOSEN: BUNDLE-WIDE. The reasoning, on the four axes this repository's
 * dispatch requires, with the long-term axis weighted heaviest:
 *
 * **1. Real business need — measured, not assumed.** The consumer of an eval is
 * an answering agent, and what it loads is the WHOLE bundle. `SKILL.md` is a
 * router: its "Where to go" table names all eleven guides, and its rules block
 * says the three files under `rules/` are "the anchor for every rule the guides
 * only cue" and are to be read "before writing schemas". So the corpus an eval
 * is answered from is the bundle, and an oracle narrower than the corpus asserts
 * a fact the artifact does not support. The disagreement comment 5514262423
 * flagged is exactly this: `evals/page-builder.json` eval 1 requires
 * `registerComponent`, which is taught once — in `guides/plugin-development.md`,
 * the file `SKILL.md` routes "package a custom renderer or field widget as a
 * plugin" to. That eval is honest; per-guide would call it a defect.
 *
 * **2. Long-term soundness (weighted heaviest).** Per-guide is not even TOTAL
 * over today's corpus, and that is a structural fault rather than a missing
 * mapping row. `evals/protocol.json` has no `guides/protocol.md`: its guide is
 * `rules/protocol.md`. Twelve of per-guide's fourteen red rows are that one
 * file, red for the sole reason that the oracle cannot find a file. Adopting
 * per-guide would therefore mean inventing a second, undeclared convention
 * ("`guides/BASENAME.md`, or `rules/BASENAME.md`, or ...") whose only job is to
 * repair the oracle — and then baselining twelve rows that name no defect. A
 * baseline that large on a 125-row population is the shape this repository has
 * repeatedly measured people learning to ignore. Bundle-wide needs no mapping
 * table, no baseline, and stays correct when a twelfth guide or a second bundle
 * lands.
 *
 * **3. Making AI-written code hard to get wrong.** Both oracles catch the whole
 * class the two hand sweeps found — a token NOTHING teaches. What bundle-wide
 * gives up is narrower than it looks: only "taught, but in a sibling file",
 * which for a whole-bundle reader is not an error at all. What actually closed
 * the false-negative half is the WHOLE-TOKEN rule below, and that is orthogonal
 * to the oracle — it applies under either.
 *
 * **4. Startup scope discipline.** Bundle-wide lands green on day one with an
 * EMPTY baseline and no follow-up programme. Per-guide would land a fourteen-row
 * debt list, twelve rows of which are oracle artefacts that no per-row skills
 * decision can ever retire, plus the mapping convention needed to make it run.
 *
 * ⛔ The losing option is not deleted, it is kept RE-DERIVABLE: `--measure`
 * prints BOTH red lists on every invocation, so the fourteen rows above are a
 * number anyone can reproduce rather than a claim in a merged pull request body.
 *
 * ## WHOLE TOKENS, and the one false positive this rule does NOT close
 *
 * A token counts only as a whole token, never as a substring. The boundary rule
 * is stated here because half the corpus is not identifier-shaped:
 *
 *   IDENT_CHAR is `[A-Za-z0-9_$]`. An occurrence of the literal token counts if
 *     - its FIRST character is an IDENT_CHAR  -> the character before it must
 *       not be an IDENT_CHAR (or there is none), and
 *     - its LAST character is an IDENT_CHAR   -> the character after it must not
 *       be an IDENT_CHAR (or there is none).
 *   A token that is not identifier-shaped at an end gets NO boundary at that
 *   end. So an identifier token is matched on word boundaries, while a token
 *   like a quoted key or an operator degrades to an exact substring — which is
 *   what such a token means. Matching is CASE-SENSITIVE: these are identifiers
 *   and JSON keys, and case-folding would let `Type` vouch for `type`.
 *
 * The rule is pinned in `--self-test` against the three false positives
 * objectui#7405 measured, and the third one is the honest limit of this gate:
 *
 *   - `view` inside `// vite preview`      -> substring 1, WHOLE 0. Caught.
 *   - `FieldWidgetProps` inside
 *     `FieldWidgetPropsSchema`             -> substring 1, WHOLE 0. Caught.
 *   - `create` inside `create: vi.fn()`    -> substring 1, WHOLE 1. NOT caught,
 *     and cannot be: `create` really is a whole token there. The mismatch is
 *     SEMANTIC — the eval meant the form mode, the guide had a mocked
 *     dataSource method. ⚠️ A green from this gate therefore means "the bundle
 *     says this word somewhere", never "the bundle teaches the thing the eval
 *     means". That second question is a human reading and this gate does not
 *     claim it. Saying so here is the difference between a stated boundary and
 *     a silent one.
 *
 * ## `must_not_contain` is NOT validated against the guides, deliberately
 *
 * It gets a SHAPE check (a non-empty string) and nothing else. objectui#7370
 * spelled one entry as a quoted JSON key fragment rather than the bare word,
 * precisely because a bare word would fail any answer that names the rule while
 * following it. An entry there is a token the answer must AVOID, so "no guide
 * says it" is the healthy case; a check that validated it the way it validates
 * `must_contain` would have the polarity backwards and would red on the entries
 * that are most carefully chosen. `--self-test` pins that direction.
 *
 * ## The baseline: declared, SHRINK-ONLY, and EMPTY at landing
 *
 * `KNOWN_UNTAUGHT_EVAL_TOKENS` is empty today, because the chosen oracle has no
 * red rows. It exists anyway, in the shape `check-doc-fence-languages.mjs`
 * landed for `KNOWN_UNHIGHLIGHTED_TS_FENCES`, because the alternative landing
 * route for the first future red is editing an eval row or guide prose — and
 * objectui#7461 rules that out in as many words: re-pointing a row is a per-row
 * skills decision, never a mechanical one. Without a declared list, the first
 * red forces the mechanical edit the card forbids.
 *
 *   - a red row NOT in the list fails — a newly untaught token cannot land;
 *   - a row IN the list whose red is GONE fails as STALE and names itself, the
 *     remedy being to delete the line. No supported route adds one silently.
 *
 * That second direction is what stops an empty list from decaying into a
 * permit: the list can only ever shrink, so a row parked in it is visible debt
 * with a stated owner, not an exemption.
 *
 * ## What this gate deliberately does NOT answer
 *
 *   1. **Whether the guide teaches what the eval MEANS.** See the `create` case
 *      above. Word presence is the mechanical half; the semantic half stays a
 *      human reading, which is why the red list is described as a starting list
 *      for per-row judgement rather than a work queue to be cleared.
 *   2. **Whether an eval's `expected_output` is reachable.** A different oracle
 *      over a different corpus.
 *   3. **Whether `must_contain` is EMPTY.** An eval that asserts nothing is a
 *      real question and a different one; the count is printed on every run so
 *      it cannot hide, and no verdict is taken on it here.
 *   4. **`.claude/skills/**`.** This gate's root is the PUBLISHED bundle, the
 *      governed surface objectui#7461 was filed about — the same boundary
 *      `check-skill-examples.mjs` states for itself.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * The prose root this gate walks. One entry today: the PUBLISHED skill bundles.
 * Stated here as a decision rather than left to be read off the walker — see
 * "What this gate deliberately does NOT answer" item 4 for why `.claude/skills`
 * is not in it.
 */
export const SCAN_ROOTS = ['skills'];

/**
 * A skill BUNDLE is any directory under a scan root that contains an `evals/`
 * directory. The oracle corpus is every `.md` under THAT bundle — which is what
 * "the answering agent loads the whole skill" means when there is more than one
 * skill. Today there is exactly one bundle, `skills/objectui`, so this is
 * identical to "every `.md` under `skills/`"; it is written per-bundle so it
 * stays correct rather than accidentally right.
 */
export const ORACLE = 'bundle-wide';

/** Characters that continue an identifier, for the whole-token boundary rule. */
export const IDENT_CHAR = /[A-Za-z0-9_$]/;

/**
 * This gate's exit codes, named so callers and tests can talk about them.
 * `couldNotRun` is deliberately distinct from `tokensUntaught`; see the header.
 * The numbers are this repository's convention (`check-skill-examples.mjs`,
 * `check-doc-snippet-types.mjs`, `check-eager-closure-budget.mjs`), and each
 * gate names them for itself so no gate's exit contract is a side effect of
 * importing another one.
 */
export const EXIT_CODES = {
  /** Every `must_contain` token is taught, and something was actually checked. */
  verified: 0,
  /** The gate RAN. An eval row or a baseline row is at fault. */
  tokensUntaught: 1,
  /** The gate COULD NOT RUN. Nothing it printed is a verdict about any eval. */
  couldNotRun: 2,
};

// ── The debt list ───────────────────────────────────────────────────────────

/**
 * ⛔ SHRINK-ONLY. Rows spelled exactly as `rowKey()` builds them:
 *
 *     skills/<bundle>/evals/<file>.json eval <id> <token>
 *
 * EMPTY at landing, because the bundle-wide oracle has no red rows over the
 * corpus at objectui#7461's branch point. The header says why an empty list
 * still earns its place, and why the only supported direction is down.
 *
 * ⚠️ The row key is bundle-QUALIFIED (it carries the full repo-relative eval
 * path) where objectui#7461 sketched a bare `evals/FILE.json`. Same granularity
 * — one file, one eval, one token, so a per-row fix removes exactly one line —
 * but it stays unambiguous if a second skill bundle ever lands beside
 * `objectui`. The token is everything after `eval <id> ` and is never re-split,
 * so a token containing spaces is safe here.
 *
 * @type {ReadonlySet<string>}
 */
export const KNOWN_UNTAUGHT_EVAL_TOKENS = new Set([]);

// ── The whole-token rule ─────────────────────────────────────────────────────

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The boundary rule from the header, as a regular expression. A boundary is
 * asserted on an end only when the token's own character at that end is an
 * IDENT_CHAR, so a token that is not identifier-shaped at an end degrades to an
 * exact substring there.
 */
export function wholeTokenPattern(token) {
  const left = IDENT_CHAR.test(token[0]) ? '(?<![A-Za-z0-9_$])' : '';
  const right = IDENT_CHAR.test(token[token.length - 1]) ? '(?![A-Za-z0-9_$])' : '';
  return new RegExp(`${left}${escapeRegExp(token)}${right}`, 'g');
}

/** How many times `token` occurs as a WHOLE token in `text`. Case-sensitive. */
export function countWholeToken(text, token) {
  if (token === '') return 0;
  return (text.match(wholeTokenPattern(token)) ?? []).length;
}

/**
 * How many times `token` occurs as a bare SUBSTRING. Kept only so the run can
 * SHOW the difference — a row that is substring-present and whole-token-absent
 * is precisely the class objectui#7405 found by hand, and printing the pair is
 * what makes "the whole-token rule is doing work" auditable instead of claimed.
 */
export function countSubstring(text, token) {
  if (token === '') return 0;
  return (text.match(new RegExp(escapeRegExp(token), 'g')) ?? []).length;
}

// ── Corpus walking ───────────────────────────────────────────────────────────

function walk(dir, predicate, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, predicate, out);
    else if (predicate(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Every skill bundle under the scan roots: a directory holding an `evals/`
 * directory. Returned sorted, with paths repo-relative and `/`-separated so the
 * output and the row keys read the same on every platform.
 */
export function listBundles(root) {
  const bundles = [];
  for (const scanRoot of SCAN_ROOTS) {
    const base = join(root, scanRoot);
    if (!existsSync(base) || !statSync(base).isDirectory()) continue;
    const seen = new Set();
    for (const evalFile of walk(base, (name) => name.endsWith('.json'))) {
      const evalsDir = dirname(evalFile);
      if (evalsDir.split(sep).pop() !== 'evals') continue;
      const bundleDir = dirname(evalsDir);
      if (seen.has(bundleDir)) continue;
      seen.add(bundleDir);
      bundles.push(bundleDir);
    }
  }
  return bundles.sort().map((dir) => ({ dir, rel: relative(root, dir).split(sep).join('/') }));
}

/** The row key. One file, one eval, one token — the unit a per-row fix removes. */
export function rowKey(evalPath, evalId, token) {
  return `${evalPath} eval ${evalId} ${token}`;
}

// ── Analysis ─────────────────────────────────────────────────────────────────

/**
 * Read the corpus and score every `must_contain` token under BOTH oracles. The
 * losing oracle is computed on every run rather than only under `--measure`, so
 * `--list` can show the disagreement and no separate code path can drift.
 *
 * Findings are split three ways, and the split IS the exit contract:
 *   - `preconditions` -> exit 2. The gate could not read the population.
 *   - `shapeFindings` -> exit 1. An assertion array is malformed.
 *   - `rows`          -> the judgement, reconciled against the baseline.
 */
export function analyze({ root, baseline = KNOWN_UNTAUGHT_EVAL_TOKENS }) {
  const preconditions = [];
  const shapeFindings = [];
  const rows = [];
  const bundles = [];

  for (const bundle of listBundles(root)) {
    const guideFiles = walk(bundle.dir, (name) => name.endsWith('.md'));
    const guides = guideFiles.map((full) => ({
      rel: relative(root, full).split(sep).join('/'),
      text: readFileSync(full, 'utf8'),
    }));
    if (guides.length === 0) {
      preconditions.push({
        site: bundle.rel,
        reason: 'no-guides',
        detail: 'the bundle holds eval files but no .md at all, so there is no corpus to score against',
      });
    }
    const bundleText = guides.map((g) => g.text).join('\n');

    const evalFiles = walk(join(bundle.dir, 'evals'), (name) => name.endsWith('.json'));
    const record = { rel: bundle.rel, guides: guides.map((g) => g.rel), evalFiles: [], evalCount: 0, emptyMustContain: 0 };

    for (const full of evalFiles) {
      const evalPath = relative(root, full).split(sep).join('/');
      record.evalFiles.push(evalPath);
      let doc;
      try {
        doc = JSON.parse(readFileSync(full, 'utf8'));
      } catch (error) {
        preconditions.push({
          site: evalPath,
          reason: 'unparseable',
          detail: `${error.message} — the population is incomplete, so a green over the rest would be a coverage claim this run cannot make`,
        });
        continue;
      }

      // The per-guide candidate the card names, measured but NOT adopted. Its
      // absence is recorded rather than repaired: 12 of its 14 red rows exist
      // only because this file is missing, which is the header's point.
      const basename = evalPath.split('/').pop().replace(/\.json$/, '');
      const perGuideRel = `${bundle.rel}/guides/${basename}.md`;
      const perGuide = guides.find((g) => g.rel === perGuideRel) ?? null;

      for (const item of doc.evals ?? []) {
        record.evalCount += 1;
        const assertions = item.assertions ?? {};
        const mustContain = assertions.must_contain ?? [];
        const mustNotContain = assertions.must_not_contain ?? [];

        if (Array.isArray(mustContain) && mustContain.length === 0) record.emptyMustContain += 1;

        for (const [field, list] of [
          ['must_contain', mustContain],
          ['must_not_contain', mustNotContain],
        ]) {
          if (!Array.isArray(list)) {
            shapeFindings.push({
              site: `${evalPath} eval ${item.id}`,
              reason: 'not-an-array',
              detail: `${field} is ${typeof list}, not an array`,
            });
            continue;
          }
          for (const token of list) {
            if (typeof token !== 'string' || token === '') {
              shapeFindings.push({
                site: `${evalPath} eval ${item.id}`,
                reason: 'bad-token',
                detail: `${field} holds ${JSON.stringify(token)} — every entry must be a non-empty string`,
              });
            }
          }
        }

        // ⛔ `must_not_contain` stops at the shape check above and is NEVER
        // scored against the guides. The header states why; the self-test pins
        // that an entry absent from every guide does not red.
        if (!Array.isArray(mustContain)) continue;
        for (const token of mustContain) {
          if (typeof token !== 'string' || token === '') continue;
          rows.push({
            key: rowKey(evalPath, item.id, token),
            evalPath,
            evalId: item.id,
            token,
            bundleWhole: countWholeToken(bundleText, token),
            bundleSubstring: countSubstring(bundleText, token),
            perGuideRel,
            perGuideExists: perGuide !== null,
            perGuideWhole: perGuide === null ? null : countWholeToken(perGuide.text, token),
            perGuideSubstring: perGuide === null ? null : countSubstring(perGuide.text, token),
          });
        }
      }
    }
    bundles.push(record);
  }

  if (bundles.length === 0) {
    preconditions.push({
      site: SCAN_ROOTS.join(', '),
      reason: 'no-bundles',
      detail: 'no directory under the scan roots holds an evals/ directory',
    });
  } else if (rows.length === 0 && preconditions.length === 0) {
    preconditions.push({
      site: SCAN_ROOTS.join(', '),
      reason: 'empty-population',
      detail: 'the bundles hold no must_contain token at all, so this run judged nothing',
    });
  }

  const redBundle = rows.filter((r) => r.bundleWhole === 0);
  const redPerGuide = rows.filter((r) => !r.perGuideExists || r.perGuideWhole === 0);
  const red = ORACLE === 'bundle-wide' ? redBundle : redPerGuide;

  const fresh = red.filter((r) => !baseline.has(r.key));
  const redKeys = new Set(red.map((r) => r.key));
  const stale = [...baseline].filter((key) => !redKeys.has(key)).sort();

  return { bundles, rows, preconditions, shapeFindings, red, redBundle, redPerGuide, fresh, stale };
}

// ── Verdict ──────────────────────────────────────────────────────────────────

const REMEDY =
  '\n    A `must_contain` token no guide in the bundle states as a WHOLE token.' +
  '\n    ⛔ Do NOT rewrite guide prose to teach the token, and do NOT drop or' +
  '\n    re-point the row mechanically — objectui#7461 rules both out: which of' +
  '\n    the two is right is a per-row skills decision, funded per row.' +
  '\n' +
  '\n    Land the judgement in a card, and if the gate must be green first, add' +
  '\n    the row VERBATIM to KNOWN_UNTAUGHT_EVAL_TOKENS in this script. That list' +
  '\n    is ⛔ SHRINK-ONLY: a row whose red goes away fails as STALE, so a parked' +
  '\n    row stays visible until someone retires it.';

function report(result) {
  for (const f of result.preconditions) console.error(`  ${f.site}  [${f.reason}]  ${f.detail}`);
  if (result.preconditions.length > 0) {
    console.error(
      `\nPRECONDITION NOT MET (exit ${EXIT_CODES.couldNotRun}) — the eval population or the guide ` +
        'corpus could not be read, so NO line above is a verdict about any eval. This is ' +
        '"I could not run", NOT "I ran and everything is taught": a gate that checks nothing must ' +
        'not report success (objectui#4846).',
    );
    return EXIT_CODES.couldNotRun;
  }

  const totalEvals = result.bundles.reduce((n, b) => n + b.evalCount, 0);
  const totalGuides = result.bundles.reduce((n, b) => n + b.guides.length, 0);
  const emptyMustContain = result.bundles.reduce((n, b) => n + b.emptyMustContain, 0);

  for (const f of result.shapeFindings) console.error(`  ${f.site}  [${f.reason}]  ${f.detail}`);
  for (const row of result.fresh) {
    const hint =
      row.bundleSubstring > 0
        ? ` (it appears ${row.bundleSubstring} time(s) as a SUBSTRING only — see the whole-token rule)`
        : ' (it appears nowhere in the bundle, in any form)';
    console.error(`  ${row.evalPath} eval ${row.evalId}  [untaught]  ${JSON.stringify(row.token)}${hint}`);
  }
  for (const key of result.stale) {
    console.error(`  ${key}  [stale-baseline]  this row is no longer red — delete its line, the list only shrinks`);
  }

  console.log(
    `Scanned ${result.bundles.length} skill bundle(s) under ${SCAN_ROOTS.join(', ')}: ` +
      `${result.bundles.reduce((n, b) => n + b.evalFiles.length, 0)} eval file(s), ${totalEvals} eval(s), ` +
      `${result.rows.length} must_contain token(s), scored against ${totalGuides} guide file(s).`,
  );
  console.log(
    `Oracle: ${ORACLE} — a token must occur as a WHOLE token (case-sensitive) somewhere in its own ` +
      "bundle's markdown. `must_not_contain` is shape-checked only and is never scored against the guides.",
  );
  console.log(
    `Baseline: ${KNOWN_UNTAUGHT_EVAL_TOKENS.size} row(s) declared in KNOWN_UNTAUGHT_EVAL_TOKENS (⛔ SHRINK-ONLY).`,
  );
  console.log(
    `Evals whose must_contain is EMPTY: ${emptyMustContain}. Printed so it cannot hide; no verdict is taken on it here.`,
  );
  console.log(
    `Red under the chosen oracle: ${result.red.length} (${result.fresh.length} beyond the baseline). ` +
      `Under the rejected per-guide oracle it would be ${result.redPerGuide.length} — re-derive both with --measure.`,
  );

  if (result.shapeFindings.length > 0 || result.fresh.length > 0 || result.stale.length > 0) {
    if (result.fresh.length > 0) console.error(REMEDY);
    console.error(`\nThe eval assertions above do not hold up (exit ${EXIT_CODES.tokensUntaught}).`);
    return EXIT_CODES.tokensUntaught;
  }
  console.log('\nEvery must_contain token is taught by its own skill bundle.');
  return EXIT_CODES.verified;
}

function measure(result) {
  const show = (label, rows, describe) => {
    console.log(`\n=== RED under ${label}: ${rows.length} of ${result.rows.length} ===`);
    for (const row of rows) console.log(`  ${row.key}${describe(row)}`);
    if (rows.length === 0) console.log('  (none)');
  };
  show('BUNDLE-WIDE whole-token  [CHOSEN]', result.redBundle, (row) =>
    row.bundleSubstring > 0 ? `   (substring-only: ${row.bundleSubstring})` : '',
  );
  show('PER-GUIDE whole-token  [rejected]', result.redPerGuide, (row) =>
    !row.perGuideExists
      ? `   (no ${row.perGuideRel} — the oracle cannot find a file, so this row names no defect)`
      : row.perGuideSubstring > 0
        ? `   (substring-only: ${row.perGuideSubstring})`
        : '',
  );
  const artefacts = result.redPerGuide.filter((r) => !r.perGuideExists).length;
  console.log(
    `\nOf the per-guide reds, ${artefacts} exist only because the basename-matching guide is MISSING ` +
      `and ${result.redPerGuide.length - artefacts} name a token taught elsewhere in the bundle. ` +
      'That split is the header\'s argument, measured rather than asserted.',
  );
}

function list(result) {
  console.log('  perGuide  bundle    row');
  for (const row of result.rows) {
    const pg = row.perGuideExists ? `${row.perGuideWhole}/${row.perGuideSubstring}` : 'NO-GUIDE';
    console.log(`  ${pg.padEnd(9)} ${`${row.bundleWhole}/${row.bundleSubstring}`.padEnd(9)} ${row.key}`);
  }
  console.log('  (counts are whole-token/substring; a pair like 0/3 is the class objectui#7405 found by hand)\n');
}

function main() {
  const argv = process.argv.slice(2);
  const result = analyze({ root: repoRoot });

  if (result.preconditions.length > 0) return report(result);
  if (argv.includes('--list')) list(result);
  if (argv.includes('--measure')) {
    measure(result);
    // `--measure` reports; it does not gate. It exists to keep the rejected
    // oracle's cost re-derivable rather than a claim in a merged PR body.
    console.log('');
    report(result);
    return EXIT_CODES.verified;
  }
  return report(result);
}

// ── Self-test ────────────────────────────────────────────────────────────────

/**
 * The rules pinned on FIXTURES rather than on the real bundle. A committed
 * fixture guide would have to contain a deliberately untaught eval, and
 * something else in this repository would eventually scan it — the reasoning
 * `check-skills-paths.test.ts` states for its own throwaway trees.
 *
 * Every case here is a direction this gate could fail in silently, and the six
 * objectui#7461 asks for are all present: a taught token passes; an untaught one
 * reds; a substring-only match reds; a `must_not_contain` entry never reds; an
 * empty population exits 2; and a baseline row suppresses exactly its own red
 * and nothing else.
 */
export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok: Boolean(ok), detail });

  const trees = [];
  const tree = (files) => {
    const dir = mkdtempSync(join(tmpdir(), 'check-skill-eval-tokens-'));
    trees.push(dir);
    for (const [rel, contents] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, contents);
    }
    return dir;
  };
  const evalDoc = (assertions) =>
    JSON.stringify({ skill_name: 'fixture', evals: [{ id: 1, prompt: 'p', expected_output: 'e', files: [], assertions }] });

  try {
    // ── the whole-token rule, on the three measured false positives ─────────
    t('a taught identifier is found as a whole token', countWholeToken('call scope.registerComponent(x)', 'registerComponent') === 1);
    t('`view` does NOT match inside `// vite preview`', countWholeToken('// vite preview', 'view') === 0, `got ${countWholeToken('// vite preview', 'view')}`);
    t('`view` DOES match when it stands alone', countWholeToken('the view name', 'view') === 1);
    t(
      '`FieldWidgetProps` does NOT match the head of `FieldWidgetPropsSchema`',
      countWholeToken('import { FieldWidgetPropsSchema } from "x";', 'FieldWidgetProps') === 0,
    );
    t(
      '⚠️ `create` DOES match `create: vi.fn()` — the stated limit, pinned so it is never mistaken for coverage',
      countWholeToken("create: vi.fn().mockResolvedValue({ id: '1' })", 'create') === 1,
    );
    t('substring counting still sees all three, which is why the rule exists',
      countSubstring('// vite preview', 'view') === 1 &&
        countSubstring('FieldWidgetPropsSchema', 'FieldWidgetProps') === 1);
    t('`xl` does not match inside `2xl` — a digit continues an identifier', countWholeToken('the 2xl step', 'xl') === 0);
    t('a non-identifier-shaped token degrades to an exact substring', countWholeToken('a "props": { b', '"props": {') === 1);
    t('a token that is identifier-shaped on ONE end binds on that end only', countWholeToken('format( and t( here', 't(') === 1);
    t('matching is case-sensitive', countWholeToken('Type is not type', 'type') === 1);
    t('an empty token never matches, rather than matching everywhere', countWholeToken('anything', '') === 0);

    // ── the corpus judgement, end to end ────────────────────────────────────
    const root = tree({
      'skills/fixture/guides/alpha.md': 'The alpha guide teaches registerComponent and charts.\n',
      'skills/fixture/rules/protocol.md': 'The protocol rule teaches hoisted nodes.\n',
      'skills/fixture/evals/alpha.json': evalDoc({
        must_contain: ['registerComponent', 'hoisted', 'chart', 'neverTaughtAnywhere'],
        must_not_contain: ['absolutelyNoGuideSaysThis', '"props": {'],
      }),
    });
    const r = analyze({ root, baseline: new Set() });
    const redKeys = r.red.map((x) => x.key);

    t('a token taught in the eval\'s OWN guide passes', !redKeys.some((k) => k.endsWith('registerComponent')));
    t(
      'a token taught in a SIBLING file of the bundle passes — this is the oracle',
      !redKeys.some((k) => k.endsWith('hoisted')),
      JSON.stringify(redKeys),
    );
    t('a token nothing teaches REDS', redKeys.some((k) => k.endsWith('neverTaughtAnywhere')));
    t(
      'a SUBSTRING-only match reds — `chart` inside `charts` is not taught',
      redKeys.some((k) => k.endsWith(' chart')),
      JSON.stringify(redKeys),
    );
    t('exactly those two are red, and nothing else', r.red.length === 2, JSON.stringify(redKeys));
    t(
      'a must_not_contain entry absent from EVERY guide does NOT red',
      !redKeys.some((k) => k.includes('absolutelyNoGuideSaysThis')) && r.shapeFindings.length === 0,
      JSON.stringify({ redKeys, shape: r.shapeFindings }),
    );
    t(
      'the rejected per-guide oracle would additionally red the sibling-taught token',
      r.redPerGuide.some((x) => x.token === 'hoisted') && !r.redBundle.some((x) => x.token === 'hoisted'),
    );

    // ── the baseline: exactly its own row, and only downwards ───────────────
    const chartKey = r.red.find((x) => x.token === 'chart').key;
    const baselined = analyze({ root, baseline: new Set([chartKey]) });
    t(
      'a baseline row suppresses exactly its own red',
      baselined.fresh.length === 1 && baselined.fresh[0].token === 'neverTaughtAnywhere',
      JSON.stringify(baselined.fresh.map((x) => x.key)),
    );
    t('...and nothing else — the other red survives it', baselined.red.length === 2 && baselined.stale.length === 0);
    t(
      'a baseline row whose red is GONE is STALE, so the list can only shrink',
      analyze({ root, baseline: new Set([chartKey, 'skills/fixture/evals/alpha.json eval 1 registerComponent']) }).stale
        .length === 1,
    );

    // ── shape checks on the assertion arrays ────────────────────────────────
    const badShape = analyze({
      root: tree({
        'skills/fixture/guides/alpha.md': 'taught\n',
        'skills/fixture/evals/alpha.json': evalDoc({ must_contain: ['taught', ''], must_not_contain: 'nope' }),
      }),
      baseline: new Set(),
    });
    t('an empty-string token is a SHAPE failure, not a silent always-red', badShape.shapeFindings.some((f) => f.reason === 'bad-token'));
    t('a non-array assertion list is a SHAPE failure', badShape.shapeFindings.some((f) => f.reason === 'not-an-array'));
    t('the shape failures do not become token reds', badShape.red.length === 0, JSON.stringify(badShape.red.map((x) => x.key)));

    // ── the preconditions: never 0 for "nothing checked" ────────────────────
    t(
      'a tree with NO bundle at all is a PRECONDITION, never a pass',
      analyze({ root: tree({ 'skills/fixture/guides/alpha.md': 'x\n' }), baseline: new Set() }).preconditions.some(
        (p) => p.reason === 'no-bundles',
      ),
    );
    t(
      'a bundle whose evals assert NO must_contain token is a PRECONDITION',
      analyze({
        root: tree({
          'skills/fixture/guides/alpha.md': 'x\n',
          'skills/fixture/evals/alpha.json': evalDoc({ must_contain: [], must_not_contain: [] }),
        }),
        baseline: new Set(),
      }).preconditions.some((p) => p.reason === 'empty-population'),
    );
    t(
      'a bundle with eval files but NO markdown is a PRECONDITION',
      analyze({
        root: tree({ 'skills/fixture/evals/alpha.json': evalDoc({ must_contain: ['x'], must_not_contain: [] }) }),
        baseline: new Set(),
      }).preconditions.some((p) => p.reason === 'no-guides'),
    );
    t(
      'an eval file that does not PARSE is a PRECONDITION, not a green over the rest',
      analyze({
        root: tree({
          'skills/fixture/guides/alpha.md': 'taught\n',
          'skills/fixture/evals/alpha.json': '{ "evals": [ }',
        }),
        baseline: new Set(),
      }).preconditions.some((p) => p.reason === 'unparseable'),
    );

    // ── the row key is the unit a per-row fix removes ───────────────────────
    t(
      'the row key names file, eval and token, and keeps a token containing spaces whole',
      rowKey('skills/x/evals/y.json', 3, 'await expect') === 'skills/x/evals/y.json eval 3 await expect',
    );
  } finally {
    for (const dir of trees) rmSync(dir, { recursive: true, force: true });
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  x ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`x check-skill-eval-tokens self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return EXIT_CODES.tokensUntaught;
  }
  console.log(
    `OK check-skill-eval-tokens self-test: ${cases.length} cases pass (the whole-token rule on all three ` +
      'measured false positives, both oracles on the sibling-taught row, must_not_contain never scored, ' +
      'the shrink-only baseline in both directions, and every precondition that must not read as a pass).',
  );
  return EXIT_CODES.verified;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : main());
}

export { main };
