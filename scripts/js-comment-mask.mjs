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
 * It was not one. Measured on 2026-08-21 (#10427) by diffing this scan's mask
 * against `@typescript-eslint/parser`'s comment ranges over 4,733 files: 16
 * disagreed, and 15 of them in the FABRICATES direction, up to 10,252 comment
 * bytes handed to a caller as live code in a single file. The cause was the
 * template scan above; the same sweep after the fix disagrees on 0 files.
 *
 * The lesson is about the claim, not the bug. A failure DIRECTION is a
 * property of an implementation, not of an intention, and this one cannot be
 * read off the code -- it took an independent parser over the whole tree to
 * find out which way the module actually failed. So the honest statement is
 * the one that can be re-derived: the shapes below are pinned, the sweep that
 * measured them is the way to check the rest, and neither direction is
 * promised by construction. Re-run it after touching `scanSource`.
 */

/** A character that can end an identifier -- i.e. a value, so `/` is division. */
import { isEntrypoint } from './invoked-as.mjs';

const IDENT_CHAR = /[\w$]/;

/**
 * Keywords after which a `/` opens a REGEX, not a division. `return /x/` reads
 * as a value character followed by a slash, and only the keyword tells them
 * apart. Measured cost of omitting this: a gate whose corpus contained
 * `return /["`]/.test(s)` fabricated hits out of every comment below it.
 */
const REGEX_AFTER_KEYWORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'case', 'delete', 'void',
  'yield', 'await', 'new', 'do', 'else', 'throw',
]);

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
 * @returns {{ comment: Uint8Array, literal: Uint8Array }}
 */
export function scanSource(source) {
  const n = source.length;
  const comment = new Uint8Array(n);
  const literal = new Uint8Array(n);
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
    if (c === '/' && !(IDENT_CHAR.test(prev) || prev === ')' || prev === ']')) {
      i++; // regex literal: `/` after anything that is not a value
      let inClass = false;
      while (i < n && source[i] !== '\n') {
        const ch = source[i];
        if (ch === '\\' && i + 1 < n) {
          literal[i] = 1;
          literal[++i] = 1;
          i++;
          continue;
        }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
        literal[i] = 1;
        i++;
      }
      if (i < n && source[i] === '/') i++;
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
        interpolations.push([frame.start, i + 1]);
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
  for (const frame of templates) if (frame.braces > 0 && frame.start >= 0) interpolations.push([frame.start, n]);
  for (const [start, end] of interpolations) for (let k = start; k < end; k++) literal[k] = 1;
  return { comment, literal };
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
  let failed = 0;
  for (const [name, src] of cases) {
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

  if (failed) {
    console.error(`\u2717 js-comment-mask self-test: ${failed} of ${cases.length} case(s) failed.`);
    process.exit(1);
  }
  console.log(`\u2713 js-comment-mask self-test: ${cases.length} cases pass.`);
}

// Executed only as a CLI. Importing this module must have NO side effect: the
// gates below it are the callers, and a shared module that exits on import is
// a shared module nobody can share.
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    console.error('usage: node scripts/js-comment-mask.mjs --self-test');
    process.exit(2);
  }
}
