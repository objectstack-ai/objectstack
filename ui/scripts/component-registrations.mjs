// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * component-registrations -- the ONE answer to "which component keys does this
 * source register?"
 *
 * Four pins read `packages/layout/src/index.ts` for the list of keys
 * `registerLayout()` registers, and each of them used to carry its own copy of
 * one regex:
 *
 *     ComponentRegistry\.register\(\s*'([^']+)'
 *
 * `packages/layout/src/__tests__/guide-layout-sidebar-nav-doc.test.ts` (the
 * guide's key table), `.../app-shell-not-a-component-key.test.tsx` (`app-shell`
 * is absent), `.../readme-registration-keys.test.ts` (the README's key list) and
 * `scripts/__tests__/side-effects-declaration-consistency.test.ts` (every key
 * survives a side-effect-only bundle).
 *
 * ## Why the copies were a defect and not merely duplication (objectui#4894)
 *
 * That regex accepts ONE quote character. Nothing in this repository enforces
 * single quotes -- there is no `.prettierrc`, no `prettier` field in
 * `package.json` and no `quotes` rule in `eslint.config.js` -- so
 * `ComponentRegistry.register("some-key", ...)` is legal, lints clean, passes
 * CI, and is invisible to all four readers at once. The input surface was one
 * quote character narrower than the readers believed, and nothing watched the
 * part that was missing.
 *
 * The three failure modes it produced were NOT the same, which is why "widen the
 * regex" was not the whole job:
 *
 *   - the two doc-parity pins RED WITH A BACKWARDS DIAGNOSIS. The doc lists the
 *     key correctly, the source read misses it, and the message says "the doc
 *     names a key that is not registered" -- sending the reader off to break a
 *     correct page.
 *   - the side-effect pin goes GREEN AND SILENT. Its `toBeGreaterThanOrEqual(5)`
 *     floor is satisfied by "5 single-quoted + 1 double-quoted", so the missing
 *     key's "survives the bundle" assertion simply never runs.
 *   - the `app-shell` pin misses a double-quoted re-registration on its SOURCE
 *     face only; its live-registry assertion (`ComponentRegistry.getConfig` /
 *     `has`) still catches it. That one has a second line of defence.
 *
 * objectui#4860 considered extracting this module and deliberately declined,
 * because at that moment it would have been de-duplication only: editing three
 * intentionally self-contained pin files to serve a fourth. That reasoning was
 * right then. It stopped applying when the shared blind spot was measured --
 * this is now "widen in one place, four benefit", which is a correctness reason
 * rather than a tidiness one.
 *
 * ## What the extraction owes in exchange
 *
 * Four guards that fail independently are more robust than four that share a
 * dependency, and this module spends some of that. So it is a TESTED module --
 * `scripts/__tests__/component-registrations.test.ts` is its own pin, and it
 * covers the non-vacuity case first: a shared reader that silently returned `[]`
 * would convert four green-because-empty pins into one bug, which is strictly
 * worse than the four copies were.
 *
 * It extracts only the EXTRACTION. What the four call sites ASSERT stays theirs
 * -- they check four different things, and merging those is the coupling
 * actually worth avoiding.
 *
 * ## Two refusals, not one
 *
 * `readComponentRegistrations` throws rather than returning a short list when:
 *
 *   1. it finds NO register call at all (the vacuity case -- the pins above are
 *      all set-difference or absence assertions, every one of which passes
 *      trivially on an empty list);
 *   2. it finds a register call whose key it CANNOT READ -- a computed key, a
 *      template with an interpolation, an unterminated literal. This is the
 *      objectui#4894 shape generalised past the quote character: any call this
 *      reader cannot see is a key that drops out of all four pins in silence.
 *      Widening from one quote to three does not close that class; refusing to
 *      under-read does.
 *
 * ## Comments and strings are not code
 *
 * The scan is comment- and literal-aware via `scripts/js-comment-mask.mjs`, this
 * tree's one answer to "is this span code, or prose". The old regexes had no
 * such idea, and `packages/layout/src/index.ts` carries a note saying so: the
 * retired `app-shell` call is DESCRIBED there rather than quoted, because a
 * verbatim copy inside a comment read to those regexes as a live registration.
 * That workaround is no longer load-bearing here -- but it is left in place,
 * because this module is not the only thing that has ever read that file.
 */

import { scanSource } from './js-comment-mask.mjs';

/**
 * `ComponentRegistry.register(`, allowing the whitespace a formatter may insert.
 * The member access is matched rather than assumed adjacent so a wrapped call
 * (`ComponentRegistry\n  .register(`) is a call, not an invisible one.
 */
const REGISTER_CALL = /ComponentRegistry\s*\.\s*register\s*\(/g;

/** The three ways this language spells a string literal. */
const QUOTES = new Set(["'", '"', '`']);

/** 1-based line number of `index` in `source`. */
function lineOf(source, index) {
  let line = 1;
  for (let k = 0; k < index; k++) if (source[k] === '\n') line += 1;
  return line;
}

/**
 * The key argument of a register call whose `(` ends at `from`, or `null` when
 * this reader cannot read it.
 *
 * `null` is never "no key" -- it is "a key is there and I cannot see it", which
 * the caller turns into a refusal.
 */
function readKeyArgument(source, from) {
  let i = from;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  const quote = source[i];
  if (!QUOTES.has(quote)) return null;
  let key = '';
  for (let k = i + 1; k < source.length; k++) {
    const ch = source[k];
    // An escape or an interpolation means the key is not a plain literal, and a
    // reader that guessed at either would be back to reporting a key that is
    // not the one the registry gets.
    if (ch === '\\') return null;
    if (quote === '`' && ch === '$' && source[k + 1] === '{') return null;
    if (ch === '\n') return null;
    if (ch === quote) return key.length > 0 ? key : null;
    key += ch;
  }
  return null;
}

/**
 * @typedef {object} RegistrationScan
 * @property {string[]} keys      Component keys, in source order.
 * @property {number}   calls     `ComponentRegistry.register(` calls found in CODE.
 * @property {{ line: number, text: string }[]} unreadable
 *           Calls whose key this reader could not read -- `calls` minus `keys`.
 */

/**
 * Every `ComponentRegistry.register` call in `source`, without judging the
 * result. The primitive; `readComponentRegistrations` is what call sites want.
 *
 * @param {string} source
 * @returns {RegistrationScan}
 */
export function findComponentRegistrations(source) {
  const { comment, literal } = scanSource(source);
  const keys = [];
  const unreadable = [];
  let calls = 0;
  for (const found of source.matchAll(REGISTER_CALL)) {
    const at = found.index;
    // A commented-out call is not a registration, and neither is a mention of
    // one inside a string or a template. `js-comment-mask` flags a literal's
    // CONTENT (not its delimiters), and it flags `${...}` interiors too, so this
    // one test covers both prose forms.
    if (comment[at] || literal[at]) continue;
    calls += 1;
    const key = readKeyArgument(source, at + found[0].length);
    if (key === null) {
      const eol = source.indexOf('\n', at);
      unreadable.push({
        line: lineOf(source, at),
        text: (eol === -1 ? source.slice(at) : source.slice(at, eol)).trim(),
      });
      continue;
    }
    keys.push(key);
  }
  return { keys, calls, unreadable };
}

/**
 * The component keys `source` registers -- or a thrown error saying why this
 * reader will not answer.
 *
 * @param {string} source     The file's text.
 * @param {string} sourceLabel Repo-relative path, for the diagnostics.
 * @returns {RegistrationScan}
 */
export function readComponentRegistrations(source, sourceLabel) {
  const scan = findComponentRegistrations(source);

  if (scan.calls === 0) {
    throw new Error(
      [
        `No \`ComponentRegistry.register\` call was found in ${sourceLabel}.`,
        '',
        'Every pin that reads this list asserts a set difference or an absence, and all of',
        'those pass trivially on an empty list -- so an empty read is reported as a failure',
        'here rather than handed back as a fact (objectui#4894). Either the registrations',
        'really are gone (then the pins have to be rewritten, not re-pointed), or this reader',
        'has stopped seeing them: scripts/component-registrations.mjs.',
      ].join('\n'),
    );
  }

  if (scan.unreadable.length > 0) {
    throw new Error(
      [
        `${sourceLabel} registers a component key this reader cannot read:`,
        ...scan.unreadable.map((call) => `  line ${call.line}: ${call.text}`),
        '',
        'The key argument is not a plain string literal (a computed key, an interpolated',
        'template, an escape). Returning the other keys and dropping this one is precisely',
        'the objectui#4894 failure: the doc-parity pins would then red saying the DOC names an',
        'unregistered key -- pointing the reader at a correct page -- and the side-effect pin',
        'would go green without ever asserting this key survives the bundle.',
        '',
        'Write the key as a plain literal, or teach scripts/component-registrations.mjs to',
        'resolve this form -- do not let it be read as absent.',
      ].join('\n'),
    );
  }

  return scan;
}
