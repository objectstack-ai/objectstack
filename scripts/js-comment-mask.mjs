#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * js-comment-mask -- the ONE answer to "is this span a comment, or code?"
 *
 *   node scripts/js-comment-mask.mjs --self-test
 *
 * Every source-scanning gate in this tree has to separate code from prose
 * before it decides anything: a docblock naming a retired error code is not a
 * producer of that code, and a paragraph explaining why an alias is wrong is
 * not an alias. Each gate used to answer that question with its own private
 * `stripComments`, and the copies had drifted into two families with two
 * different failure modes -- both silent, and in opposite directions.
 *
 * ## The two families, and why neither was safe
 *
 * **Naive regex** -- `src.replace(/\/\*[\s\S]*?\*\//g, '')` and a `//`-to-end-
 * of-line rule. A regex has no idea what a string literal is, so any source
 * carrying a block-comment OPENER inside a string opens a PHANTOM comment that
 * runs to the next real terminator, usually a docblock far below, deleting every
 * line of real code in between. The trigger shapes are ordinary: a glob, a route wildcard, a URL
 * (the `//` rule), a `/*` mentioned inside a template. The gate then reports
 * clean over code it never looked at -- the failure direction AGENTS.md names
 * as worse than no verifier at all, because it reports success.
 *
 * **String-aware scanner, regex-blind** -- tracks strings and templates, but
 * treats a `/` as division. A regex literal whose character class holds a quote
 * character (`/["'`]/` -- and this tree really writes those) opens a phantom
 * STRING instead. Because a scanner SKIPS string spans, every comment inside
 * the phantom span is never blanked, and the gate reads genuinely commented-out
 * text as live code: it FABRICATES a hit rather than missing one. A backtick is
 * the worst of them, because a template is not line-bounded and the phantom
 * span runs to the next backtick, or to end of file.
 *
 * So the two questions are one question, and a scanner has to know about all
 * three literal forms to answer it. That is what lives here, once.
 *
 * ## Blank, never delete
 *
 * Comment spans are replaced with spaces, newlines kept, so every byte offset
 * and every line number survives the mask. A gate that deletes comments reports
 * findings against line numbers that no longer exist in the file it read, and
 * the drift is invisible until someone opens the file at the reported line.
 *
 * ## The direction it fails in -- a guarantee this module once claimed falsely
 *
 * Over-masking is the direction to fail in: a gate that over-masks under-
 * reports loudly the next time someone re-derives its scope, while a gate that
 * under-masks manufactures findings out of prose and burns a reader's
 * afternoon proving the sentence it quoted meant the opposite.
 *
 * This header used to state that as a property -- "cannot fabricate a lead".
 * It was not one. Measured on 2026-08-21 (#10427): walk every
 * `.{ts,tsx,mts,cts,js,mjs,cjs,jsx}` file in the tree (minus `node_modules`,
 * `dist`, `.next`, `build`, `.turbo`, `coverage`), parse each with
 * `@typescript-eslint/parser` (`{ comment: true, range: true }`), and diff the
 * comment ranges it reports against this scan's `comment` array byte for byte.
 * Over 4,739 files, 16 disagreed -- 15 in the FABRICATES direction, up to
 * 10,252 comment bytes handed to a caller as live code in a single file. The
 * cause was the template scan above; the same sweep after the fix disagrees on
 * 0 files.
 *
 * That sweep is a SCRIPT now, not a paragraph (#10640):
 *
 *   node scripts/check-comment-mask-corpus.mjs
 *
 * It runs in CI on every pull request, and it carries the control that makes
 * its green mean something -- `--masker <path>` re-derives the 16 files above
 * against the pre-fix implementation. When this description and that script
 * disagree, the script is the one that ran.
 *
 * The lesson is about the claim, not the bug. A failure DIRECTION is a
 * property of an implementation, not of an intention, and this one cannot be
 * read off the code -- it took an independent parser over the whole tree to
 * find out which way the module actually failed. So the honest statement is
 * the one that can be re-derived: the shapes below are pinned, the sweep just
 * described is the way to check the rest, and neither direction is promised by
 * construction. Re-run both after touching `scanSource`.
 *
 * Neither is the stronger instrument -- that ordering was claimed here once
 * and both directions of it have since been measured, on the same tree, in one
 * sitting (#10640). Deleting the brace counting inside `${...}` fails the case
 * below that was written from that mutation, and the sweep reads 0
 * disagreements over 4,741 files, because the tree does not write the shape.
 * Dropping `return` from `REGEX_AFTER_KEYWORD` passes all 23 cases below, and
 * the sweep names `scripts/check-test-source-alias.mjs`, where
 * `return /(^|[^a-z])dist\//` is written today. The self-test pins shapes
 * someone thought of, the sweep finds shapes the tree actually contains, and
 * neither substitutes for the other.
 *
 * ## The regex recogniser is SHARED; its position rule is NOT (#15487)
 *
 * "Does a `/` here open a RegularExpressionLiteral?" is two questions, and they
 * have different numbers of right answers.
 *
 * The WALK -- the character class, the backslash sequences, the line-terminator
 * refusal, the flags, and the `REGEX_AFTER_KEYWORD` set a position rule reads --
 * has exactly one right answer, ECMA-262's. A second copy of it can therefore
 * only drift, and the paragraph above measures what a drifted copy costs here:
 * dropping `return` from that set passes all 23 pinned cases and is caught only
 * by the corpus sweep. So the walk lives ONCE, in `walkRegexBody` below, and
 * `check-dispatcher-error-vocabulary.mjs` -- which grew its own copy closing
 * #14742 -- imports it rather than keeping one.
 *
 * The POSITION RULE has two right answers, because its two consumers fail in
 * deliberately opposite directions. This module MASKS, so it over-masks safely:
 * `}`, a bare `<`/`>` and `++`/`--` are read as regex positions, and a `/` whose
 * body does not close on its line still costs the rest of that line (198 such
 * positions on this tree, every one a JSX closing tag). That gate SCANS, and a
 * scanner that skips a span it invented desynchronises silently, so it reads
 * every undecidable position as division. Neither rule is the better one; each
 * is the right one for its consumer. Extracting either would hand the other
 * consumer a failure direction it was written to avoid.
 *
 * ⇒ the walk is imported, the rule is a PARAMETER (`makeRegexRecogniser`), and
 * this module's own rule stays inline in `scanSource` where its state machine
 * already lives. `--self-test` drives the exported recogniser in BOTH
 * directions, and the gate's `--self-test` still pins the two RULES against
 * each other -- on the fixtures where they must agree, and on the divergence
 * itself.
 */

import { isEntrypoint } from './invoked-as.mjs';

/** A character that can end an identifier -- i.e. a value, so `/` is division. */
export const IDENT_CHAR = /[\w$]/;

/**
 * Keywords after which a `/` opens a REGEX, not a division. `return /x/` reads
 * as a value character followed by a slash, and only the keyword tells them
 * apart. Measured cost of omitting this: a gate whose corpus contained
 * `return /["`]/.test(s)` fabricated hits out of every comment below it.
 */
export const REGEX_AFTER_KEYWORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'case', 'delete', 'void',
  'yield', 'await', 'new', 'do', 'else', 'throw',
]);

/**
 * LineTerminator -- the four the grammar names, not just `\n`.
 *
 * `RegularExpressionNonTerminator` EXCLUDES one, which is why a `/` whose body
 * does not close on its line was never a regex literal.
 */
export const isRegexLineTerminator = (c) =>
  c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029';

/**
 * [#15487] The SHARED half of "does a `/` here open a RegularExpressionLiteral?"
 * -- the literal WALK: the character class, the backslash sequences, the
 * line-terminator refusal and the flags.
 *
 * `at` is the index of a `/` the CALLER has already decided sits in a position
 * where an expression may begin. That decision is the half this function does
 * NOT make, and the reason it does not is the whole design:
 *
 *   the walk is one algorithm with one right answer, so a second copy of it can
 *   only drift; the POSITION RULE has two right answers, because the two
 *   consumers fail in deliberately opposite directions.
 *
 * A MASKER fails safe by over-masking: reading a division as a regex costs it a
 * span of over-masked bytes, and it under-reports loudly the next time someone
 * re-derives its scope. A SCANNER that skips a span it invented desynchronises
 * silently, which is strictly worse -- so `check-dispatcher-error-vocabulary`
 * reads every undecidable position as division. Extracting one of those two
 * rules into here would hand one consumer the other's failure direction.
 *
 * ## The outcome, not a verdict
 *
 * `closed: true` means `end` is the index of the closing `/`. `closed: false`
 * means the body ran into a LineTerminator or EOF and `end` is where it
 * stopped -- and the caller decides what THAT means, for the same reason:
 * `scanSource` below over-masks to `end` and reads on (198 positions on this
 * tree, every one a JSX closing tag in a `.tsx` file), while a scanner answers
 * "not a regex at all" and skips nothing. A shared function that returned only
 * a verdict would have picked one of those two, silently, for both.
 *
 * @param {string} src
 * @param {number} at index of the opening `/`
 * @returns {{ end: number, closed: boolean }}
 */
export function walkRegexBody(src, at) {
  const n = src.length;
  const first = src[at + 1];
  // RegularExpressionFirstChar admits neither `*` nor `/` -- the grammar's own
  // reason `/*` and `//` are comments and can never open a regex literal.
  if (first === undefined || first === '*' || first === '/') return { end: at + 1, closed: false };
  let inClass = false;
  for (let i = at + 1; i < n; i += 1) {
    const c = src[i];
    if (isRegexLineTerminator(c)) return { end: i, closed: false };
    if (c === '\\') {
      // RegularExpressionBackslashSequence :: `\` RegularExpressionNonTerminator
      if (i + 1 >= n || isRegexLineTerminator(src[i + 1])) return { end: i, closed: false };
      i += 1;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue; // a `/`, a quote or a backtick in here is an ORDINARY CHARACTER
    }
    if (c === '[') { inClass = true; continue; }
    if (c === '/') return { end: i, closed: true }; // flags are IdentifierPartChars -- code bytes
  }
  return { end: n, closed: false };
}

/**
 * [#15487] Bind a POSITION RULE to the shared walk above, once, and get back
 * the recogniser a caller can then use without repeating its own rule at every
 * call site.
 *
 *   const regexLiteralAt = makeRegexRecogniser({ mayBeginAt: myPositionRule });
 *   regexLiteralAt(src, at)  // -> index of the closing `/`, or -1
 *
 * A FACTORY rather than a per-call `regexLiteralAt(src, at, { mayBeginAt })`
 * option: `check-dispatcher-error-vocabulary.mjs` calls its recogniser from
 * fifteen places, and an option threaded through fifteen call sites is fifteen
 * chances to pass the other consumer's rule -- the drift this consolidation
 * exists to end, re-created one layer up. Binding it once makes "this module's
 * position rule is THIS one" a fact about the module rather than a convention
 * its call sites have to keep.
 *
 * There is no default rule, and omitting one throws: a default would be one of
 * the two failure directions, silently handed to whichever caller forgot.
 *
 * @param {{ mayBeginAt: (src: string, at: number) => boolean }} options
 * @returns {(src: string, at: number) => number}
 */
export function makeRegexRecogniser(options) {
  // ⛔ No `= {}` default on this parameter, and the reason is mechanical:
  // `Function.length` counts the parameters BEFORE the first defaulted one, so a
  // default here reports this function as taking ZERO required arguments and
  // `check-declaration-mirrors` reds the hand-written `.d.mts` next door for
  // declaring one. The DECLARATION is the honest side -- the options really are
  // required, since there is no default rule -- so the guard is written longhand
  // rather than destructured, which also keeps the message below instead of
  // letting a bare destructuring TypeError replace it with one that explains
  // nothing.
  const mayBeginAt = options == null ? undefined : options.mayBeginAt;
  if (typeof mayBeginAt !== 'function') {
    throw new TypeError(
      'makeRegexRecogniser({ mayBeginAt }) needs a position rule, and there is no default: the two '
        + 'consumers of this walk answer the undecidable positions in deliberately OPPOSITE directions '
        + '(a masker over-masks safely, a scanner must never skip a span it invented), so a default '
        + 'would hand one of them the other\'s failure mode without a diff to notice it.',
    );
  }
  return function regexLiteralAt(src, at) {
    if (src[at] !== '/') return -1;
    if (!mayBeginAt(src, at)) return -1;
    const { end, closed } = walkRegexBody(src, at);
    return closed ? end : -1;
  };
}

/**
 * One left-to-right pass over a JS source, flagging every character as COMMENT
 * content and/or LITERAL content (inside a string, template or regex). Both
 * come back as same-length byte arrays, so a caller can blank a span without
 * moving any other offset.
 *
 * The literal flag covers a literal's CONTENT, not its delimiters, so a caller
 * blanking comments still sees every string intact. Template interiors are
 * reported as literal through `${...}` as well, so a caller reading raw
 * characters sees them either way.
 *
 * That is the FLAG. The SCAN of an interpolation is not the same question, and
 * conflating the two is the defect #10427 measured: `${...}` was walked as
 * plain literal text on the reasoning that its braces are balanced by
 * construction, which is true of the braces and false of everything else the
 * interpolation may hold. It is code, so it can hold a nested template
 * (``${xs.map((x) => `<${x}>`)}``, exactly how this tree formats a list of
 * names), a backtick inside a regex or a string (`packages/cli`'s `quoteIdent`
 * writes both), or a brace inside a string. Reading a nested opener as the
 * outer template's CLOSER flipped the parity of every backtick after it, and
 * the phantom span ran to the next backtick anywhere in the file. So the
 * interpolation is scanned as code here -- the same loop, with the same string,
 * regex and comment branches -- and its bytes are flagged literal at the end.
 *
 * @param {string} source
 * @returns {{ comment: Uint8Array, literal: Uint8Array, interpolation: Uint8Array }}
 */
export function scanSource(source) {
  const n = source.length;
  const comment = new Uint8Array(n);
  const literal = new Uint8Array(n);
  // The code bytes INSIDE `${...}` — see the closing block of this function.
  const interpolation = new Uint8Array(n);
  let i = 0;
  let prev = ''; // last significant CODE character
  let word = ''; // ...and the identifier it is the tail of, if any

  // Open templates, innermost last. `braces` is the `{` depth inside the
  // frame's CURRENT interpolation: 0 means the scanner is in that template's
  // literal BODY, and > 0 means it is inside `${...}`, where the language says
  // the bytes are code. `start` is where that `${` began.
  const templates = [];
  // Closed `${...}` spans, flushed to `literal` after the pass -- see the
  // closing block of this function for why they are not flagged inline.
  const interpolations = [];

  // A shebang is a comment to node; it is also the one line whose slashes are
  // neither division nor a regex.
  if (source.startsWith('#!')) {
    while (i < n && source[i] !== '\n') comment[i++] = 1;
  }

  while (i < n) {
    const frame = templates.length ? templates[templates.length - 1] : null;

    // A template's literal BODY: every byte is content until `${` opens an
    // interpolation, a backtick closes the template, or the file ends.
    if (frame && frame.braces === 0) {
      const ch = source[i];
      if (ch === '\\' && i + 1 < n) {
        literal[i] = 1;
        literal[++i] = 1;
        i++;
        continue;
      }
      if (ch === '`') {
        templates.pop();
        // A NESTED template's delimiters are the outer template's content.
        if (templates.length) literal[i] = 1;
        i++;
        prev = 'x'; // a value just ended
        word = '';
        continue;
      }
      if (ch === '$' && source[i + 1] === '{') {
        literal[i] = 1;
        literal[i + 1] = 1;
        frame.braces = 1;
        frame.start = i;
        i += 2;
        prev = ''; // `${/re/.test(x)}` -- the interpolation starts a fresh expression
        word = '';
        continue;
      }
      literal[i] = 1;
      i++;
      continue;
    }

    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') comment[i++] = 1;
      continue;
    }
    if (c === '/' && next === '*') {
      comment[i++] = 1;
      comment[i++] = 1;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) comment[i++] = 1;
      if (i < n) comment[i++] = 1;
      if (i < n) comment[i++] = 1;
      continue;
    }
    if (c === "'" || c === '"') {
      i++; // the opening quote is code, so a caller can still pair it
      while (i < n && source[i] !== c && source[i] !== '\n') {
        literal[i] = 1;
        if (source[i] === '\\' && i + 1 < n) literal[++i] = 1;
        i++;
      }
      if (i < n && source[i] === c) i++;
      prev = 'x'; // a value just ended
      word = '';
      continue;
    }
    if (c === '`') {
      // A template OPENS here -- at the top level, or nested inside a `${...}`
      // this same loop is already reading as code. The body, and the matching
      // closer, are handled by the template-body branch above.
      if (templates.length) literal[i] = 1;
      templates.push({ braces: 0, start: -1 });
      i++;
      continue;
    }
    // A regex literal: a `/` after anything that is not a value. THIS is this
    // module's position rule and it stays here (#15487) -- `}`, a bare `<`/`>`
    // and `++`/`--` are read as regex positions, which over-masks safely and is
    // the OPPOSITE of what `check-dispatcher-error-vocabulary.mjs` needs. The
    // WALK is shared; see `walkRegexBody` for why exactly that line is drawn.
    if (c === '/' && !(IDENT_CHAR.test(prev) || prev === ')' || prev === ']')) {
      const { end, closed } = walkRegexBody(source, i);
      // The body is content; the delimiters are code, so a caller can pair them.
      for (let k = i + 1; k < end; k++) literal[k] = 1;
      // Unclosed on its line -> resume AT the terminator and read on, having
      // over-masked the rest of the line. That is this module's failure
      // direction, not the walk's opinion.
      i = closed ? end + 1 : end;
      prev = 'x';
      word = '';
      continue;
    }
    if (c === '/' && REGEX_AFTER_KEYWORD.has(word)) {
      // `return /x/` -- a value character precedes, but it is a keyword.
      prev = '';
      word = '';
      continue; // re-read this `/` with prev cleared, as a regex
    }
    // Inside `${...}`: balance the braces, so the interpolation ends at ITS
    // `}` and not at one quoted inside it. A `{` or `}` in a string, regex or
    // comment never reaches here -- its own branch consumed it already.
    if (frame && frame.braces > 0) {
      if (c === '{') frame.braces++;
      else if (c === '}' && --frame.braces === 0) {
        interpolations.push([frame.start, i + 1, true]);
        frame.start = -1;
      }
    }
    if (!/\s/.test(c)) {
      prev = c;
      word = IDENT_CHAR.test(c) ? word + c : '';
    }
    i++;
  }

  // `${...}` is CODE to the language, and the scan above reads it as code so a
  // backtick quoted inside it cannot flip the template's parity. The flag it
  // reports is the documented one: an interpolation's bytes are the enclosing
  // template's LITERAL content, marked in one pass at the end because the span
  // is only known once its closing brace is found. An unterminated one (EOF
  // inside `${`) still gets flagged, so truncated source cannot leak code
  // bytes into a caller's "this is not a literal" test.
  for (const frame of templates) if (frame.braces > 0 && frame.start >= 0) interpolations.push([frame.start, n, false]);
  // Snapshot BEFORE the blanket flush below: a byte the scan already called a
  // literal (a nested template's body, a quoted string inside the expression)
  // is content wherever it sits, and must not come back as code.
  const wasLiteral = literal.slice();
  for (const [start, end] of interpolations) for (let k = start; k < end; k++) literal[k] = 1;

  // ── `interpolation`: the third array, and why it is not just `!literal` ──
  //
  // Ported from objectui (objectui#6092, landed there as PR objectui#6133) for
  // #11838. `literal` above is the DOCUMENTED answer and does not move: an
  // interpolation's bytes are the enclosing template's literal content, and
  // every existing caller keeps exactly the mask it had.
  //
  // But that answer is wrong for one question, and the question is load-bearing
  // enough to have forced the array's existence downstream. A guard written
  //
  //   import.meta.url === `file://${process.argv[1]}`
  //
  // is the spelling `invoked-as.mjs`'s header singles out as the worst of the
  // family — it goes inert with NO SYMLINK AT ALL, percent-encoding apart from
  // `argv[1]` in any directory whose name needs encoding. Under
  // `comment || literal` those bytes are prose, so a gate scanning for
  // hand-typed guards reads that line as a string and reports clean. Measured
  // here on 644ad5043 (#11838): 0 findings for the template spelling, 1 for the
  // plain one; measured downstream: objectui's first cut of `check-entry-guard`
  // listed 28 of that tree's 29 hand-typed guards and silently omitted exactly
  // this one. This tree does not write the spelling today, which is precisely
  // why the gate has to see it before the first author does.
  //
  // So this array marks the bytes an interpolation contributes as CODE, which
  // a caller can subtract from `literal` to get a view the language would
  // execute. It is NOT `!literal`: the `${` and its closing `}` stay masked, so
  // a caller counting brackets over the subtracted view stays balanced, and a
  // NESTED template's body inside the interpolation stays masked too, because
  // those bytes really are content. Both exclusions are pinned in the
  // self-test; without them the subtracted view either desyncs a bracket
  // counter or hands back string content as code, which is the fabrication
  // direction this module's header calls the worse one.
  for (const [start, end, terminated] of interpolations) {
    // `[start, end)` spans `${` … `}`; the interior is what the language runs.
    // An unterminated span (EOF inside `${`) has no closing brace to skip.
    const stop = terminated ? end - 1 : end;
    for (let k = start + 2; k < stop; k++) if (!wasLiteral[k]) interpolation[k] = 1;
  }
  // ── the delimiters of EVERY span, including a nested one ────────────────
  //
  // A second pass, and it is not tidiness. `${a ${b} c}` cannot happen, but
  // `${xs.map((v) => `n${v}`)}` does: the INNER `${` is flagged literal inline
  // by its own template frame, while the inner `}` is only reached by the
  // blanket flush — so the inner `}` looked like interior code of the OUTER
  // span and came back as a brace with no opener. Measured while porting to
  // objectui: it desynced `check-entry-guard.mjs`'s top-level statement slicer
  // badly enough that four files whose dispatch really is guarded were reported
  // as running on import. A delimiter is a delimiter no matter whose interior
  // it sits in.
  for (const [start, end, terminated] of interpolations) {
    interpolation[start] = 0;
    if (start + 1 < n) interpolation[start + 1] = 0;
    if (terminated) interpolation[end - 1] = 0;
  }
  return { comment, literal, interpolation };
}

/** Replace every flagged character with a space, keeping newlines and offsets. */
export function blank(source, flags) {
  const out = source.split('');
  for (let k = 0; k < out.length; k++) if (flags[k] && out[k] !== '\n') out[k] = ' ';
  return out.join('');
}

/**
 * The source with its COMMENT characters REMOVED but every newline kept.
 *
 * The same scanner as `maskComments`, projected differently: line NUMBERS
 * survive (a comment line becomes an empty line) but byte offsets do not, and
 * the text gets much shorter.
 *
 * ## Why both projections exist, measured
 *
 * Blanking is the safer default and the only one that can carry a byte offset.
 * But a caller that scans the result with a lazy regex pays for every byte the
 * mask leaves behind: `check-test-source-alias.mjs` matches imports with
 * `(?:import|export)\s+([\s\S]*?)\s*from` , and a lazy `[\s\S]*?` walked
 * across the whitespace runs blanking leaves is quadratic in the comment bytes.
 * Converting that gate to `maskComments` alone took its runtime from 6.4s to
 * 5m27s on this tree -- same verdict, 51x the cost. Deleting the comment
 * characters instead restores it, and that gate reports package-level findings,
 * so it never needed the offsets.
 *
 * Pick by what the caller does with the result: reports a LINE or an offset
 * into the original text -> `maskComments`; feeds a scanner and reports neither
 * -> `stripComments`.
 */
export function stripComments(source) {
  const { comment } = scanSource(source);
  let out = '';
  for (let k = 0; k < source.length; k++) {
    if (!comment[k] || source[k] === '\n') out += source[k];
  }
  return out;
}

/**
 * The source with its COMMENT spans blanked -- line, block and shebang.
 *
 * Strings, templates and regex literals are left INTACT: a gate's signal is
 * usually itself a string literal, so "drop everything quoted" would erase the
 * thing being looked for. Only prose goes.
 */
export function maskComments(source) {
  return blank(source, scanSource(source).comment);
}

// ---------------------------------------------------------------------------
// Self-test -- the shapes, not the corpus
// ---------------------------------------------------------------------------

/**
 * A green run over today's tree proves only that today's tree lacks the shape.
 * These cases ARE the contract, and each one is valid JavaScript, so the
 * expected answer is the one the language gives rather than the one a
 * particular implementation happens to produce.
 *
 * `REAL` marks source that must SURVIVE the mask (dropping it BLINDS the gate);
 * `GHOST` marks genuinely commented-out text that must NOT survive (keeping it
 * makes the gate FABRICATE a finding out of prose).
 */

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'js-comment-mask self-test reached its verdict';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failed === 0` used to be this self-test's ONLY success condition, so "every
// case held" and "the cases never ran" printed the same line. Closed the PR
// #13487 way: what is pinned is the registered NAMES, not a number.
//
// This self-test is TABLE-DRIVEN — one literal `cases` table, one loop over it,
// and a sink (`failed++`) that writes only when a case FAILS. Routing THAT sink
// through `registerCase()` would register a case only when it fails: a fully
// green run would register 0 and every battery would read DID NOT RUN, the
// floor inverted rather than installed. So the roster is the table's own rows.
// Each row LABEL is a declared battery, verbatim, with a floor of 1, and
// `registerCase(name)` is the first statement of the driving loop body — so the
// case is attributed to the row actually being run, whatever that row asserts
// afterwards. There is no `battery()` opener: for a table-driven self-test the
// ROW is the battery, so attribution is the loop variable rather than a
// most-recently-opened section.
//
// ⛔ A pinned TOTAL is not the repair, and neither is a roster DERIVED from the
// table: `cases.length` moves with the table, so a deleted row would delete its
// own floor. The roster below is a LITERAL the table is checked against, which
// is what lets a deleted or renamed row name ITSELF in the refusal.
//
// The counts are a FLOOR, not an equality — a row that grows into several
// registrations must not red. 1 is the honest floor for a table row: the loop
// reaches it exactly once per run.
//
// SCOPE, stated so the next reader does not mistake the number: the
// `interpolation` section below the corpus loop is NOT a second literal table.
// Its rows exist only because an `x(...)` call pushed them onto `extra` at
// runtime, so a roster taken from that loop would be DERIVED — a deleted `x`
// call would silently delete its own floor, which is the one defect this shape
// exists to prevent. Those twelve assertions are therefore left exactly as they
// are, and the verdict line keeps counting them separately, as it always has.
// Flooring them needs the literal-roster treatment of its own and is not a
// table-row question.
const SELF_TEST_BATTERIES = Object.freeze({
  'string containing a block-comment opener': 1,
  'URL inside a string': 1,
  'bare // inside a string': 1,
  'block-comment opener inside a template literal': 1,
  'regex character class holding a double quote': 1,
  'regex character class holding a BACKTICK first': 1,
  'markdown regex carrying a backtick': 1,
  'regex literal containing an escaped //': 1,
  'line comment immediately after a colon': 1,
  'regex literal after the `return` keyword': 1,
  'regex literal after the `case` keyword': 1,
  'shebang is a comment': 1,
  'division after a paren, then a quote-bearing regex': 1,
  'nested template inside an interpolation': 1,
  'escaped backtick inside a template, without nesting': 1,
  'template nested inside a nested template': 1,
  'template spanning lines, carrying a nested template': 1,
  'a backtick inside a regex inside an interpolation': 1,
  'an object literal, then a nested template, in one interpolation': 1,
  'a brace and a backtick quoted inside an interpolation': 1,
  'a real comment inside an interpolation': 1,
  'a genuine docblock is still removed': 1,
  'a genuine line comment is still removed': 1,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too. This pin is also half of
// the duplicate-label refusal: two rows sharing a label collapse to ONE key in
// the literal above, so the roster falls below this number; the table
// cross-check in the floor block is the other half, and names WHICH label
// collided.
const SELF_TEST_BATTERY_FLOOR = 23;

// ── The SHARED RECOGNISER section's own roster and floor (#15487) ──────────
//
// The `interpolation` assertions below the corpus loop are pushed onto `extra`
// by `x(...)` calls, so a roster taken from them would be DERIVED and a deleted
// call would delete its own floor. The header says that section is owed the
// literal-roster treatment; the section added here does not inherit the debt —
// it declares its rows the way the table does, as a LITERAL this file is
// checked against, so a deleted or renamed assertion names ITSELF in the
// refusal instead of quietly lowering the count.
const SELF_TEST_RECOGNISER_BATTERIES = Object.freeze({
  'the exported walk closes a quote-bearing regex at its final `/`': 1,
  '...and that is exactly the span scanSource flagged literal': 1,
  'a character class hides `/` and every quote from the walk': 1,
  'the walk REPORTS an unclosed body rather than deciding what it means': 1,
  'RegularExpressionFirstChar excludes `*` and `/`, whatever the position rule says': 1,
  'OVER-MASKING mode reads a `/` after `}` as a regex literal': 1,
  'NEVER-SKIP mode reads the same `/` as division': 1,
  'both modes agree wherever the WALK is what decides': 1,
  'omitting mayBeginAt throws instead of defaulting to a failure direction': 1,
});
const SELF_TEST_RECOGNISER_FLOOR = 9;

export function selfTest() {
  const BT = String.fromCharCode(96); // backtick, kept out of the literal below
  const cases = [
    ['string containing a block-comment opener',
      ["const AUTH = '/api/v1/auth/*';", "err.code = 'REAL';", '/** docblock far below */'].join('\n')],
    ['URL inside a string',
      "const DOCS = 'https://objectstack.ai/docs'; err.code = 'REAL';"],
    ['bare // inside a string',
      "const GLOB = 'packages//src'; err.code = 'REAL';"],
    ['block-comment opener inside a template literal',
      ['const HINT = ' + BT + 'use /* to open a block comment' + BT + ';', "err.code = 'REAL';", '/** doc */'].join('\n')],
    ['regex character class holding a double quote',
      ['const Q = /["\'' + BT + ']/g;', "/* err.code = 'GHOST' */", "err.code = 'REAL';"].join('\n')],
    ['regex character class holding a BACKTICK first',
      ['const Q = /[' + BT + '\'"]/g;', "/* err.code = 'GHOST' */", "err.code = 'REAL';"].join('\n')],
    ['markdown regex carrying a backtick',
      ['const H = /^(#{1,6})\\s(.*)$|^(' + BT + '{3,})/gm;', "/* err.code = 'GHOST' */", "err.code = 'REAL';"].join('\n')],
    ['regex literal containing an escaped //',
      "const P = /https:\\/\\//; err.code = 'REAL';"],
    ['line comment immediately after a colon',
      ["const m = { a:// err.code = 'GHOST'", "  1 };", "err.code = 'REAL';"].join('\n')],
    ['regex literal after the `return` keyword',
      ['function f(s) { return /["' + BT + ']/.test(s); }', "/* err.code = 'GHOST' */", "err.code = 'REAL';"].join('\n')],
    ['regex literal after the `case` keyword',
      ["switch (true) { case /['" + BT + "]/.test(x): break; }", "/* err.code = 'GHOST' */", "err.code = 'REAL';"].join('\n')],
    ['shebang is a comment',
      ['#!/usr/bin/env node', "/* err.code = 'GHOST' */", "err.code = 'REAL';"].join('\n')],
    ['division after a paren, then a quote-bearing regex',
      ['const r = (a) / b;', 'const q = /["' + BT + ']/g;', "/* err.code = 'GHOST' */", "err.code = 'REAL';"].join('\n')],
    // Templates whose interior puts a real backtick where a flat scan expects
    // the closer. Each pins BOTH sides: a genuine comment that must go, and
    // live code after it that must stay. A parity flip anywhere in the line
    // moves one of the two, so neither assertion can pass by accident.
    ['nested template inside an interpolation',
      ['const g = ' + BT + '${xs.map((x) => ' + BT + '\\' + BT + '${x}\\' + BT + BT + ").join(', ')} tail" + BT + ';',
        "/* err.code = 'GHOST' */", "err.code = 'REAL';"].join('\n')],
    ['escaped backtick inside a template, without nesting',
      ['const t = ' + BT + 'a \\' + BT + ' b' + BT + ';',
        "/* err.code = 'GHOST' */", "err.code = 'REAL';"].join('\n')],
    // Depth alone is NOT a defect shape: matched backticks pair off whatever a
    // scan believes about nesting, and this case stayed green under every
    // mutation of the fix that produced it (#10427). It is here for coverage of
    // the depth-2 path. The shapes that DO discriminate are the ones below,
    // where nesting meets an escape or a quoted backtick and the pairing breaks.
    ['template nested inside a nested template',
      ['const d = ' + BT + '${rows.map((r) => ' + BT + '${r.cells.map((c) => ' + BT + '<${c}>' + BT + ").join('')}" + BT + ").join('')}" + BT + ';',
        "/* err.code = 'GHOST' */", "err.code = 'REAL';"].join('\n')],
    ['template spanning lines, carrying a nested template',
      ['const m = ' + BT + 'head',
        '  ${xs.map((x) => ' + BT + '\\' + BT + '${x}\\' + BT + BT + ").join(', ')}",
        'tail' + BT + ';', "/* err.code = 'GHOST' */", "err.code = 'REAL';"].join('\n')],
    // The interpolation is CODE, so a backtick or a brace QUOTED inside it is
    // neither a delimiter nor a nesting level. Both shapes are live in this
    // tree (`quoteIdent` in packages/cli writes the first one verbatim), and a
    // scan that only counts `${`/`}` desyncs on both.
    ['a backtick inside a regex inside an interpolation',
      ['const q = ' + BT + '\\' + BT + '${name.replace(/' + BT + "/g, '" + BT + BT + "')}\\" + BT + BT + ';',
        "/* err.code = 'GHOST' */", "err.code = 'REAL';"].join('\n')],
    ['an object literal, then a nested template, in one interpolation',
      ['const o = ' + BT + '${fmt({ a: 1 }, ' + BT + '\\' + BT + BT + ')} tail' + BT + ';',
        "/* err.code = 'GHOST' */", "err.code = 'REAL';"].join('\n')],
    ['a brace and a backtick quoted inside an interpolation',
      ['const b = ' + BT + "${fmt({ a: 1 }, '" + BT + "')} tail" + BT + ';',
        "/* err.code = 'GHOST' */", "err.code = 'REAL';"].join('\n')],
    ['a real comment inside an interpolation',
      ['const c = ' + BT + "${x /* err.code = 'GHOST' */} tail" + BT + ';', "err.code = 'REAL';"].join('\n')],
    ['a genuine docblock is still removed',
      ['/** Retired: err.code = ' + "'GHOST'" + ' must never come back. */', "err.code = 'REAL';"].join('\n')],
    ['a genuine line comment is still removed',
      ["// err.code = 'GHOST'", "err.code = 'REAL';"].join('\n')],
  ];

  // Both projections are driven, on every shape: they share one scanner, so a
  // shape either family gets wrong is a scanner bug, and a disagreement between
  // them about what IS a comment is the thing that must never ship.
  // The ledger this self-test's floor is evaluated against (#13489).
  const batterySeen = new Map();
  const registerCase = (name) => {
    batterySeen.set(name, (batterySeen.get(name) ?? 0) + 1);
  };

  let failed = 0;
  for (const [name, src] of cases) {
    registerCase(name);
    const masked = maskComments(src);
    const stripped = stripComments(src);
    const problems = [];
    for (const [proj, out] of [['mask', masked], ['strip', stripped]]) {
      if (/REAL/.test(src) && !/REAL/.test(out)) problems.push(`${proj}: BLINDS (real code removed)`);
      if (/GHOST/.test(src) && /GHOST/.test(out)) problems.push(`${proj}: FABRICATES (comment text survived)`);
      if (src.split('\n').length !== out.split('\n').length) problems.push(`${proj}: line count changed`);
    }
    if (masked.length !== src.length) problems.push(`mask: offset drift (${src.length} -> ${masked.length})`);
    if (stripped.length > src.length) problems.push('strip: grew');
    if (problems.length) failed++;
    console.log(`  ${problems.length ? '\u2717' : '\u2713'} ${name}${problems.length ? ' -- ' + problems.join('; ') : ''}`);
  }

  // \u2500\u2500 the `interpolation` array (ported from objectui#6092; #11838) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  //
  // Driven directly rather than through the GHOST/REAL corpus above, because
  // the property is about a SUBTRACTED view (`literal` minus `interpolation`)
  // that no existing caller asks for. Every case states what the view must
  // contain and what it must NOT \u2014 a one-sided assertion here would pass on an
  // array that flags everything.
  const codeView = (src) => {
    const { comment, literal, interpolation } = scanSource(src);
    const flags = new Uint8Array(src.length);
    for (let k = 0; k < flags.length; k++) flags[k] = comment[k] || (literal[k] && !interpolation[k]);
    return blank(src, flags);
  };
  const extra = [];
  const x = (name, ok, detail) => extra.push([name, Boolean(ok), detail]);

  const guard = 'if (import.meta.url === ' + BT + 'file://${process.argv[1]}' + BT + ') {}';
  x('the percent-encoding guard is CODE in the subtracted view', codeView(guard).includes('process.argv[1]'), codeView(guard));
  // The documented `comment || literal` view \u2014 what every existing caller
  // computes, and the reason the third array had to exist at all.
  const documentedView = (src) => {
    const { comment, literal } = scanSource(src);
    const flags = new Uint8Array(src.length);
    for (let k = 0; k < flags.length; k++) flags[k] = comment[k] || literal[k];
    return blank(src, flags);
  };
  x('...and still a LITERAL under the documented comment||literal view, which is unchanged',
    !documentedView(guard).includes('process.argv[1]'), documentedView(guard));
  x('the template body around it stays masked', !codeView(guard).includes('file://'), codeView(guard));

  const delim = 'const s = ' + BT + 'a${ b }c' + BT + ';';
  const dv = codeView(delim);
  x('the ${ and } delimiters stay masked, so a bracket counter stays balanced',
    (dv.match(/[{}]/g) || []).length === 0, dv);
  x('...while the expression inside them is code', dv.includes('b'), dv);

  const nested = 'const t = ' + BT + '${xs.map((v) => ' + BT + 'x${v}y' + BT + ').join("")}' + BT + ';';
  const nv = codeView(nested);
  x('a NESTED template body inside an interpolation stays masked', !nv.includes('x') || !/x\$?\{?v/.test(nv), nv);
  x('...while the interpolation expression around it is code', nv.includes('xs.map'), nv);

  const inner = 'const t = ' + BT + '${xs.map((v) => ' + BT + 'n${v}' + BT + ')}' + BT + ';';
  const iv = codeView(inner);
  x('a NESTED interpolation contributes NO unbalanced brace to the code view',
    (iv.match(/\{/g) || []).length === (iv.match(/\}/g) || []).length, iv);
  x('...and the outer interpolation expression is still code', iv.includes('xs.map'), iv);

  const quoted = 'const q = ' + BT + '${f("process.argv[1]")}' + BT + ';';
  x('a STRING quoted inside an interpolation is not code', !codeView(quoted).includes('process.argv[1]'), codeView(quoted));

  const plain = "const s = 'process.argv[1]';";
  x('an ordinary string literal is untouched by any of this', !codeView(plain).includes('process.argv[1]'), codeView(plain));

  const unterminated = 'const u = ' + BT + '${ g(';
  x('an unterminated interpolation does not throw and yields its code', codeView(unterminated).includes('g('), codeView(unterminated));

  for (const [name, ok, detail] of extra) {
    if (!ok) failed++;
    console.log(`  ${ok ? '\u2713' : '\u2717'} ${name}${ok ? '' : ' -- ' + JSON.stringify(detail)}`);
  }
  // \u2500\u2500 the SHARED RECOGNISER, driven in BOTH position modes (#15487) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  //
  // `walkRegexBody` is the half that has ONE right answer, so it is asserted
  // without reference to any position rule. `makeRegexRecogniser` is the half
  // that has TWO, so it is driven twice — once in each of the directions the
  // two consumers of this module deliberately fail in. The pair is the point:
  // an assertion in one mode alone would pass on a recogniser that ignored its
  // parameter entirely, which is the drift this consolidation exists to end.
  //
  // The two rules below are DEMONSTRATIONS, not copies of either consumer's:
  // each is the smallest rule that differs at the character under test, so
  // nothing here can go stale when a real rule is re-argued. `scanSource`'s own
  // rule stays inline in `scanSource`, and the scanner's stays in
  // `check-dispatcher-error-vocabulary.mjs`, which is the whole design.
  const recog = [];
  const xr = (name, ok, detail) => recog.push([name, Boolean(ok), detail]);

  const overMasking = makeRegexRecogniser({ mayBeginAt: () => true });
  const neverSkip = makeRegexRecogniser({
    mayBeginAt: (src, at) => {
      let k = at - 1;
      while (k >= 0 && /\s/.test(src[k])) k -= 1;
      return src[k] !== '}';
    },
  });

  const cls = 'x = /[' + BT + "'\"]/.test(s);";
  const clsAt = cls.indexOf('/[');
  const clsClose = cls.indexOf('/.test');
  xr('the exported walk closes a quote-bearing regex at its final `/`',
    walkRegexBody(cls, clsAt).closed && walkRegexBody(cls, clsAt).end === clsClose,
    [walkRegexBody(cls, clsAt), clsClose]);
  // The masker RUNS this walk, so its flags and the walk's answer are one fact
  // stated twice. If they ever part, `scanSource` has grown a second walk.
  const clsLit = scanSource(cls).literal;
  let lastLit = -1;
  for (let k = 0; k < cls.length; k++) if (clsLit[k]) lastLit = k;
  xr('...and that is exactly the span scanSource flagged literal',
    lastLit + 1 === clsClose && clsLit[clsAt] === 0 && clsLit[clsClose] === 0, [lastLit, clsClose]);
  // `/[`'"/]/g` — the class holds a `/`, and the walk must not close on it.
  const klass = '/[' + BT + "'\"/]/g";
  xr('a character class hides `/` and every quote from the walk',
    walkRegexBody(klass, 0).closed && walkRegexBody(klass, 0).end === klass.lastIndexOf('/'),
    [walkRegexBody(klass, 0), klass.lastIndexOf('/')]);

  const unclosed = 'x = /never closed\ny;';
  const walkedOff = walkRegexBody(unclosed, 4);
  xr('the walk REPORTS an unclosed body rather than deciding what it means',
    walkedOff.closed === false && walkedOff.end === unclosed.indexOf('\n')
      && overMasking(unclosed, 4) === -1,
    walkedOff);
  xr('RegularExpressionFirstChar excludes `*` and `/`, whatever the position rule says',
    overMasking('x = // not a regex\ny;', 4) === -1 && overMasking('x = /* not a regex */ y;', 4) === -1
      && walkRegexBody('x = /* c */ y;', 4).closed === false,
    [overMasking('x = // not a regex\ny;', 4), overMasking('x = /* not a regex */ y;', 4)]);

  // The DIVERGENCE, in both directions. After a `}` the language cannot decide
  // without parser state: a masker answers "regex" and over-masks a span, a
  // scanner answers "division" and skips nothing. Both answers are correct for
  // their consumer, which is why this is a parameter and not a bug.
  const brace = 'if (x) { f() }\n/re/.test(y);';
  const braceAt = brace.indexOf('\n') + 1;
  xr('OVER-MASKING mode reads a `/` after `}` as a regex literal',
    overMasking(brace, braceAt) === braceAt + 3, overMasking(brace, braceAt));
  xr('NEVER-SKIP mode reads the same `/` as division',
    neverSkip(brace, braceAt) === -1, neverSkip(brace, braceAt));
  xr('both modes agree wherever the WALK is what decides',
    overMasking(cls, clsAt) === clsClose && neverSkip(cls, clsAt) === clsClose,
    [overMasking(cls, clsAt), neverSkip(cls, clsAt), clsClose]);

  // Three facts, one row: it throws with NO argument, it throws on a non-function
  // rule, and the message is this module's own rather than a destructuring
  // TypeError. The ARITY is pinned here too — `makeRegexRecogniser.length` is
  // what `check-declaration-mirrors` compares against the `.d.mts`, and a `= {}`
  // default silently drops it to 0. That was a real CI red, and it belongs in
  // the module's own self-test rather than only in a gate one layer away.
  const caught = (fn) => { try { fn(); return null; } catch (e) { return e; } };
  const noArg = caught(() => makeRegexRecogniser());
  const junkRule = caught(() => makeRegexRecogniser({ mayBeginAt: 'yes' }));
  const names = (e) => e instanceof TypeError && e.message.includes('needs a position rule');
  xr('omitting mayBeginAt throws instead of defaulting to a failure direction',
    names(noArg) && names(junkRule) && makeRegexRecogniser.length === 1,
    [noArg && noArg.message, junkRule && junkRule.message, makeRegexRecogniser.length]);

  for (const [name, ok, detail] of recog) {
    if (!ok) failed++;
    console.log(`  ${ok ? '\u2713' : '\u2717'} ${name}${ok ? '' : ' -- ' + JSON.stringify(detail)}`);
  }

  const total = cases.length + extra.length + recog.length;

  // ── The floor: every declared row RAN, and ran its case (#13489) ───────
  //
  // Evaluated after every row has had its chance and BEFORE the verdict, so the
  // success line below can only be printed by a run in which the set of rows
  // that registered EQUALS the set declared. A set difference names WHICH row
  // stopped; a count says only that something did.
  const floorFailure = (message) => {
    console.error(`✗ self-test floor: ${message}`);
    failed++;
  };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  const rowLabels = cases.map(([name]) => name);
  const duplicated = [...new Set(rowLabels.filter((name, i) => rowLabels.indexOf(name) !== i))];
  if (duplicated.length > 0) {
    floorBreached = true;
    floorFailure(
      `the cases table uses ${duplicated.map((n) => JSON.stringify(n)).join(', ')} as a row label more than once — ` +
        'two rows sharing a label are ONE battery, so the second can stop running while the first keeps the floor met.',
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — a case attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed that case holds.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  // The same treatment for the shared-recogniser section (#15487).
  const declaredRecogniser = Object.keys(SELF_TEST_RECOGNISER_BATTERIES);
  if (declaredRecogniser.length < SELF_TEST_RECOGNISER_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_RECOGNISER_BATTERIES declares ${declaredRecogniser.length} assertions, below the pinned ` +
        `${SELF_TEST_RECOGNISER_FLOOR} — an assertion deleted from the roster takes its own floor with it.`,
    );
  }
  const recogniserRan = recog.map(([name]) => name);
  for (const name of recogniserRan) {
    if (declaredRecogniser.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `shared-recogniser assertion "${name}" ran but is not declared in ` +
        'SELF_TEST_RECOGNISER_BATTERIES — an assertion attributed to no declared row is one nothing floors.',
    );
  }
  for (const name of declaredRecogniser) {
    if (recogniserRan.filter((n) => n === name).length >= SELF_TEST_RECOGNISER_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      `shared-recogniser assertion "${name}" DID NOT RUN — the verdict below would have claimed the ` +
        'exported walk and its position parameter are both pinned when one of them is not.',
    );
  }

  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the ' +
        'number. Find what stopped registering (a deleted row, a renamed label, a loop that no longer ' +
        'reaches it) and restore it.',
    );
  }

  if (failed) {
    console.error(`\u2717 js-comment-mask self-test: ${failed} failure(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(
    `\u2713 js-comment-mask self-test: ${total} cases pass (${cases.length} mask/strip corpus, `
      + `${extra.length} interpolation view, ${recog.length} shared recogniser).`,
  );

  return SELF_TEST_VERDICT;
}

// Executed only as a CLI. Importing this module must have NO side effect: the
// gates below it are the callers, and a shared module that exits on import is
// a shared module nobody can share.
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ js-comment-mask self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  }
  else {
    console.error('usage: node scripts/js-comment-mask.mjs --self-test');
    process.exit(2);
  }
}
