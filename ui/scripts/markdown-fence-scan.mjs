#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * markdown-fence-scan -- the ONE answer to "does this line OPEN a fenced code
 * block, and what is allowed to close it?" (objectui#9194)
 *
 *   node scripts/markdown-fence-scan.mjs --self-test
 *
 * ## The defect this module exists to make unrepresentable
 *
 * Two doc gates -- `check-doc-component-types.mjs` and
 * `check-doc-expression-carriage.mjs` -- each carried this predicate, verbatim:
 *
 *     const fence = /^\s*```(\S*)\s*$/.exec(line);
 *
 * `(\S*)` is greedy over non-space, so a FOUR-backtick opener matched as a
 * three-backtick opener whose *language* was the leftover backtick plus the real
 * language. Three things then went wrong at once, on a page that is legitimately
 * teaching nested fences (`content/docs/plugins/plugin-markdown.mdx`):
 *
 *   1. a language that does not exist -- a backtick-bearing string -- got its
 *      own column in the per-language census;
 *   2. two PHANTOM fences with empty bodies, both reporting a successful parse,
 *      because the object-BODY retry wraps `''` into `{}` and `{}` parses. An
 *      empty non-fence was therefore counted as a successfully parsed fence in
 *      the coverage figures;
 *   3. the nesting INVERTED -- the four-backtick line opened, the real inner
 *      opener CLOSED, and the code between them sat outside any fence and was
 *      invisible to both gates while the parse rate still read healthy.
 *
 * The bounded instance was two markers in one file. The hazard is the SHAPE: an
 * ODD number of stray markers desynchronises fence pairing for the rest of the
 * file, so both gates judge the wrong bodies and report a clean coverage figure
 * over a region the instrument mis-read (the objectui#8334 family).
 *
 * ## The rule, which is CommonMark's and not this repo's invention
 *
 * A fenced code block opens on a RUN of at least three backticks or at least
 * three tildes, and closes only on a run of the SAME character that is AT LEAST
 * AS LONG, carrying no info string. That is what makes a shorter run inside a
 * longer one ordinary body text, which is precisely how a page teaches nested
 * fences. The info string of a BACKTICK fence may not contain a backtick --
 * which is what structurally prevents a language capture from ever holding one
 * again, rather than detecting it after the fact.
 *
 * ## Two deliberate divergences from strict CommonMark, both measured
 *
 *   - **Indentation is not capped at three spaces.** CommonMark says a marker
 *     indented four or more spaces is indented code, not a fence. The replaced
 *     predicates accepted any leading whitespace, and tightening that here would
 *     silently DROP fences the gates read today -- a behaviour change no card has
 *     asked for. Tightening is still a separate card, but it is no longer a FREE
 *     one, and this passage used to say it was.
 *
 *     Counted, not recalled: every marker line under `.github/prompts/**`, read
 *     at fdd4ab90a7 -- 34 of them, 22 indented zero to three spaces and 12
 *     indented four. All 12 are in `.github/prompts/component.prompt.md` (lines
 *     57, 68, 99, 107, 115, 123, 129, 139, 164, 171, 202, 208, every one of them
 *     at indent exactly 4), and they pair into SIX fenced blocks, not twelve.
 *     Re-derive rather than trusting this block if it matters -- it is a reading
 *     with a date on it, not a contract.
 *
 *     ⚠️ This passage used to close with "which is on neither gate's scan
 *     surface". That was true when written, of the two gates this module then
 *     served -- and objectui#9331 falsified it: `check-prompt-component-keys.mjs`
 *     became a consumer, and its scan surface is exactly `.github/prompts` (its
 *     `PROMPT_DIR`). So capping indentation would now change how that gate reads
 *     six blocks of `component.prompt.md`: from fenced code, which it skips, to
 *     prose, which it judges. Nothing moves TODAY -- this module and both
 *     predicates it replaced all accept any leading whitespace, which is exactly
 *     what makes objectui#9331's conversion behaviour-neutral on that file.
 *   - **Blank-info and multi-token info are both accepted as openers.** The
 *     replaced predicates required the whole info string to be one non-space
 *     token (`\s*$` after the capture), so a ```` ```ts title="a.ts" ```` line
 *     was not a fence at all and its body was read as prose. Accepting it is
 *     CommonMark and is behaviour-neutral on today's corpus: the same sweep
 *     found ZERO marker lines with a multi-token info string, and zero tilde
 *     fences.
 *
 * ## Why this is a MODULE and not two patched copies
 *
 * The two gates already share a module boundary -- one imports the other's doc
 * surface constants -- so there was no extraction cost to weigh, and "N
 * separately-correct copies" is the family this tree keeps paying for
 * (objectstack#17681, the objectui#7448 family). A copy that is separately
 * correct today is a copy that drifts silently tomorrow: the card's own closing
 * sentence is that a fix applied to one gate can leave the other behind.
 * `scripts/__tests__/markdown-fence-scan.test.ts` is the recurrence guard -- it
 * fails if either gate grows a private fence predicate again.
 *
 * Prior art, deliberately named rather than re-derived: `body-dialect-census.mjs`
 * (`keepFencedCodeOnly`) and `check-doc-fence-languages.mjs` were already
 * run-aware and already carried the "closes on a run at least as long" comment.
 * They are offset-based and self-contained respectively; this module is the
 * line-based spelling the two doc gates need, and it is the one a third gate
 * should import instead of writing a fourth.
 */

import { isEntrypoint } from './invoked-as.mjs';

/** A run of three or more backticks or tildes, with whatever follows it. */
const MARKER_RUN = /^\s*(`{3,}|~{3,})(.*)$/;

/** A closing marker carries a run and nothing else but whitespace. */
const CLOSING_RUN = /^\s*(`{3,}|~{3,})\s*$/;

/**
 * @typedef {object} OpenFence
 * @property {string} marker    the fence character, '`' or '~'
 * @property {number} run       how many of it opened the fence
 * @property {string} info      the full info string, trimmed
 * @property {string} lang      the first token of the info string ('' if none)
 */

/**
 * The opening fence this line is, or `null` if it is not one.
 *
 * ⛔ Never re-spell this test locally. A local spelling is how the two doc gates
 * ended up with one wrong answer each.
 *
 * @param {string} line one line of a markdown/MDX document, newline removed
 * @returns {OpenFence | null}
 */
export function openFence(line) {
  const m = MARKER_RUN.exec(line);
  if (!m) return null;
  const marker = m[1][0];
  const info = m[2].trim();
  // CommonMark: a backtick fence's info string may not contain a backtick.
  // This is what makes a backtick-bearing "language" unrepresentable, instead
  // of detectable after it has already been counted.
  if (marker === '`' && info.includes('`')) return null;
  return { marker, run: m[1].length, info, lang: info.split(/\s+/)[0] ?? '' };
}

/**
 * Does this line close the fence `open` opened? Same marker character, a run at
 * least as long, and no info string.
 *
 * @param {string} line
 * @param {OpenFence} open the fence returned by `openFence`
 * @returns {boolean}
 */
export function closesFence(line, open) {
  const m = CLOSING_RUN.exec(line);
  if (!m) return false;
  return m[1][0] === open.marker && m[1].length >= open.run;
}

/**
 * Controls. Every one of them is a shape this module got WRONG before it
 * existed, or a shape a future simplification would break.
 *
 * @returns {string[]} failures, empty when the instrument is sound
 */
export function selfTest() {
  /** @type {string[]} */
  const failures = [];
  const t = (name, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${name}: expected ${e}, got ${a}`);
  };

  // The instance objectui#9194 was filed for.
  t('a four-backtick opener keeps its real language', openFence('````markdown')?.lang, 'markdown');
  t('...and records the run that opened it', openFence('````markdown')?.run, 4);
  t('a three-backtick opener still reads its language', openFence('```json')?.lang, 'json');
  t('a bare opener has an empty language', openFence('```')?.lang, '');

  // The inversion: a shorter run inside a longer one is BODY, not a boundary.
  const four = openFence('````markdown');
  t('a three-backtick line does NOT close a four-backtick fence', closesFence('```javascript', four), false);
  t('...nor does a bare three-backtick line', closesFence('```', four), false);
  t('a four-backtick line closes it', closesFence('````', four), true);
  t('a LONGER run closes it too', closesFence('`````', four), true);
  const three = openFence('```json');
  t('a four-backtick line closes a three-backtick fence', closesFence('````', three), true);

  // No language may ever carry a backtick again -- structurally, not by report.
  t('an info string holding a backtick is not an opener', openFence('```js`x'), null);
  t('...and neither is a five-backtick run read as a language', openFence('`````markdown')?.lang, 'markdown');

  // A closer carries no info string.
  t('a run with an info string never closes', closesFence('```json', three), false);
  t('trailing whitespace still closes', closesFence('```   ', three), true);
  t('an indented closer still closes', closesFence('   ```', three), true);

  // Markers do not cross.
  const tilde = openFence('~~~json');
  t('a tilde fence reads its language', tilde?.lang, 'json');
  t('a backtick run does not close a tilde fence', closesFence('```', tilde), false);
  t('a tilde run does not close a backtick fence', closesFence('~~~', three), false);

  // Not fences.
  t('inline code is not a fence', openFence('use `x` here'), null);
  t('two backticks are not a fence', openFence('``x'), null);
  t('an info string may hold several tokens', openFence('```ts title="a.ts"')?.lang, 'ts');
  t('...and the full info string is kept', openFence('```ts title="a.ts"')?.info, 'ts title="a.ts"');

  return failures;
}

if (isEntrypoint(import.meta.url)) {
  const failures = selfTest();
  if (failures.length > 0) {
    console.error(`❌  markdown-fence-scan failed its own controls:\n${failures.map((f) => `      ${f}`).join('\n')}`);
    process.exit(1);
  }
  console.log('✅  markdown-fence-scan: all controls pass.');
}
