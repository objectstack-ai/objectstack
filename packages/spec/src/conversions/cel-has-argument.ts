// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `has()` argument reading the stored-shape listing uses (#25281) — which
 * `has(…)` calls in a CEL source hand the macro an argument that is not a `.`
 * field selection.
 *
 * ## Why a reading of its own lives here
 *
 * The door that refuses the shape is `@objectstack/lint`'s
 * `visibility-predicate-has-argument`, and its verdict is the engine's: it
 * walks the AST `@objectstack/formula` parses, and its suite pins that walk
 * against `celEngine.compile` in both directions. This package depends on
 * neither, so the listing in `refused-shapes.ts` cannot ask that door. It
 * reads the source here instead, with the same test on the token stream: the
 * argument of a one-argument `has(` call is a field selection exactly when it
 * carries no operator outside brackets and ends in `.` followed by a name.
 *
 * ⚠️ This is a LISTING reading, never a gate: nothing here refuses anything,
 * and a site it lists is one the door refuses. `cel-has-argument.test.ts` holds
 * it to the shapes the engine was measured on, and lint's
 * `validate-visibility-predicates.stored-listing.test.ts` holds the listing equal
 * to the door's refusal over the same predicates. It reads a source the front
 * end refuses for another reason the same way, so a predicate that is also
 * broken CEL can be listed here while the door names its syntax fault first —
 * both send the owner to the same predicate.
 *
 * ⚠️ Internal to `packages/spec`: not re-exported.
 */

/** A `has()` call whose argument the engine refuses, and how it was written. */
export interface HasArgumentRefusal {
  /** The argument as written. */
  readonly argument: string;
  /** `bare` — a name alone; `index` — an index as the last step; `other` — anything else. */
  readonly kind: 'bare' | 'index' | 'other';
}

interface Token {
  kind: 'id' | 'num' | 'str' | 'punct';
  text: string;
  start: number;
  end: number;
}

/** Two-character operators, so `.?`, `==` and the rest stay one token. */
const TWO_CHAR = new Set(['.?', '==', '!=', '<=', '>=', '&&', '||']);

/** Operators that make an argument something other than a selection when they sit outside brackets. */
const OPERATORS = new Set(['||', '&&', '==', '!=', '<', '<=', '>', '>=', '+', '-', '*', '/', '%', '?', ':', '!']);

/** CEL literals spelled like names. */
const LITERAL_NAMES = new Set(['true', 'false', 'null']);

const NAME_START = /[A-Za-z_]/;
const NAME_PART = /[A-Za-z0-9_]/;
const NUMBER = /^(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)[uU]?/;
const STRING_PREFIX = /^[rRbB]{1,2}$/;

/**
 * The token stream of `source`, or `null` when a string literal is left open
 * (the front end refuses that source as not CEL, and nothing here reads it).
 */
function tokenize(source: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (NAME_START.test(c)) {
      let j = i + 1;
      while (j < source.length && NAME_PART.test(source[j]!)) j++;
      const word = source.slice(i, j);
      // `r'…'`, `b"…"`, `rb'''…'''`: a prefix glued to a quote opens a string.
      if (STRING_PREFIX.test(word) && (source[j] === '"' || source[j] === "'")) {
        const end = stringEnd(source, j, /[rR]/.test(word));
        if (end === null) return null;
        out.push({ kind: 'str', text: source.slice(i, end), start: i, end });
        i = end;
        continue;
      }
      out.push({ kind: 'id', text: word, start: i, end: j });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = stringEnd(source, i, false);
      if (end === null) return null;
      out.push({ kind: 'str', text: source.slice(i, end), start: i, end });
      i = end;
      continue;
    }
    const num = /\d/.test(c) ? NUMBER.exec(source.slice(i)) : null;
    if (num) {
      out.push({ kind: 'num', text: num[0], start: i, end: i + num[0].length });
      i += num[0].length;
      continue;
    }
    const two = source.slice(i, i + 2);
    const text = TWO_CHAR.has(two) ? two : c;
    out.push({ kind: 'punct', text, start: i, end: i + text.length });
    i += text.length;
  }
  return out;
}

/** The index just past the string literal whose opening quote is at `at`, or `null` when it never closes. */
function stringEnd(source: string, at: number, raw: boolean): number | null {
  const quote = source[at]!;
  const delimiter = source.startsWith(quote.repeat(3), at) ? quote.repeat(3) : quote;
  let i = at + delimiter.length;
  while (i < source.length) {
    if (!raw && source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source.startsWith(delimiter, i)) return i + delimiter.length;
    i++;
  }
  return null;
}

const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);

/** The index of the token that closes the bracket opened at `open`, or -1. */
function closing(tokens: readonly Token[], open: number): number {
  let depth = 0;
  for (let j = open; j < tokens.length; j++) {
    const t = tokens[j]!;
    if (t.kind !== 'punct') continue;
    if (OPEN.has(t.text)) depth++;
    else if (CLOSE.has(t.text) && --depth === 0) return j;
  }
  return -1;
}

/** How the engine reads one `has()` argument: `null` for a field selection, the refused kind otherwise. */
function argumentKind(arg: readonly Token[]): HasArgumentRefusal['kind'] | null {
  let a = arg;
  // `has((record.a))` is `has(record.a)`: grouping adds no node.
  while (a.length >= 2 && a[0]!.text === '(' && closing(a, 0) === a.length - 1) a = a.slice(1, -1);
  if (a.length === 1 && a[0]!.kind === 'id' && !LITERAL_NAMES.has(a[0]!.text)) return 'bare';
  let depth = 0;
  for (const t of a) {
    if (t.kind === 'punct' && OPEN.has(t.text)) depth++;
    else if (t.kind === 'punct' && CLOSE.has(t.text)) depth--;
    else if (depth === 0 && ((t.kind === 'punct' && OPERATORS.has(t.text)) || (t.kind === 'id' && t.text === 'in'))) {
      return 'other';
    }
  }
  const last = a[a.length - 1];
  const beforeLast = a[a.length - 2];
  if (last?.kind === 'id' && beforeLast?.kind === 'punct' && beforeLast.text === '.') return null;
  if (last?.kind === 'punct' && last.text === ']') return 'index';
  return 'other';
}

/**
 * Every `has(…)` call in `source`, in source order, whose single argument the
 * engine refuses as `has() invalid argument`. A member call (`x.has(y)`), a
 * `has(` inside a string literal, and a call with no argument or with several
 * are not listed: the engine either does not read them as the macro or refuses
 * them under another message.
 */
export function refusedHasArguments(source: string): HasArgumentRefusal[] {
  if (typeof source !== 'string' || !source.includes('has')) return [];
  const tokens = tokenize(source);
  if (!tokens) return [];
  const out: HasArgumentRefusal[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== 'id' || t.text !== 'has' || tokens[i + 1]?.text !== '(') continue;
    const before = tokens[i - 1];
    if (before?.kind === 'punct' && (before.text === '.' || before.text === '.?')) continue;
    const close = closing(tokens, i + 1);
    if (close < 0) continue;
    const arg = tokens.slice(i + 2, close);
    if (arg.length === 0) continue;
    let depth = 0;
    let several = false;
    for (const a of arg) {
      if (a.kind !== 'punct') continue;
      if (OPEN.has(a.text)) depth++;
      else if (CLOSE.has(a.text)) depth--;
      else if (depth === 0 && a.text === ',') several = true;
    }
    if (several) continue;
    const kind = argumentKind(arg);
    if (kind) out.push({ kind, argument: source.slice(arg[0]!.start, arg[arg.length - 1]!.end) });
  }
  return out;
}
