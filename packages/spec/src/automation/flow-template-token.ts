// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/flow-template-token
 *
 * **The single-brace `{…}` token grammar of the 17.x flow interpolator** — the
 * one reading of it the spec carries, shared by the two judges that retire it:
 * `flow-value-slot-template.ts` (the value slots, #19939) and
 * `flow-text-slot-template.ts` (the text slots, #22110).
 *
 * Which `{…}` the interpolator substitutes (`/\{([^{}]+)\}/`), and how it
 * dispatches a token — date macro, then `$User.`, then a variable path, then
 * arithmetic — are the regexes of `resolveToken` in `service-automation`'s
 * `builtin/template.ts`, copied here because the spec cannot import a
 * runtime. `value-slot-template-grammar.test.ts` in that package drives the
 * interpolator over the kept spellings and the refused ones, so the two
 * readings cannot drift apart unnoticed.
 *
 * ## ⛔ Package-internal — NOT a public export
 *
 * Deliberately absent from `automation/index.ts`: its callers are the two
 * judges above, and a published copy of a retired dialect's grammar would be a
 * new public surface for a spelling the platform is deleting.
 */

/** The interpolator's token — `interpolateString`'s `/\{([^{}]+)\}/g`. */
export const TEMPLATE_TOKEN = /\{([^{}]+)\}/g;

/** `resolveToken`'s `dateFnMatch`, verbatim: `NOW()` / `TODAY()` with an optional `± N` day offset. */
const DATE_MACRO = /^(NOW|TODAY)\s*\(\s*\)\s*(?:([+\-])\s*(\S+))?$/;

/** `resolveToken`'s direct-path test, verbatim: a variable and its dotted path, numeric segments included. */
const VARIABLE_PATH = /^[A-Za-z_$][\w$]*(?:\.(?:[A-Za-z_$][\w$]*|\d+))*$/;

/** `resolveToken`'s arithmetic character set, verbatim — outside it a token resolves to nothing. */
const ARITHMETIC_CHARSET = /^[\w\s+\-*/%().,?:<>=!&|"'$]+$/;

/**
 * An operator, or a call — any name in call position. The dialect resolves
 * only its six CEL-mirrored functions and refuses every other name at run
 * time, but either way the token is an expression, and its CEL spelling is
 * the same text: an unknown name is then refused by the envelope's own CEL
 * check, with a did-you-mean.
 */
const EXPRESSION_SHAPE = /[+\-*/%<>=!&|?]|[A-Za-z_$][\w$.]*\s*\(/;

/** What the interpolator does with one token — the dispatch order of `resolveToken`. */
export type TemplateTokenKind = 'date-macro' | 'user' | 'path' | 'expression' | 'unresolvable';

/** Classify one token's inner text the way `resolveToken` dispatches it. */
export function templateTokenKind(inner: string): TemplateTokenKind {
  const trimmed = inner.trim();
  if (!trimmed) return 'unresolvable';
  if (DATE_MACRO.test(trimmed)) return 'date-macro';
  if (trimmed.startsWith('$User.')) return 'user';
  if (VARIABLE_PATH.test(trimmed)) return 'path';
  if (ARITHMETIC_CHARSET.test(trimmed) && EXPRESSION_SHAPE.test(trimmed)) return 'expression';
  return 'unresolvable';
}

/** One `{…}` token of a string, as authored. */
export interface TemplateToken {
  /** The token with its braces, as written (`{record.name}`). */
  readonly text: string;
  /** The text between the braces, trimmed. */
  readonly inner: string;
  /** How the interpolator dispatches it. */
  readonly kind: TemplateTokenKind;
  /** Offset of {@link text} in the string. */
  readonly index: number;
}

/** Every `{…}` token the interpolator would substitute in `value`, in order. */
export function templateTokensOf(value: string): TemplateToken[] {
  const out: TemplateToken[] = [];
  for (const match of value.matchAll(TEMPLATE_TOKEN)) {
    out.push({ text: match[0], inner: match[1]!.trim(), kind: templateTokenKind(match[1]!), index: match.index ?? 0 });
  }
  return out;
}

/** A template path as CEL: `a.b.0` → `a.b[0]`; a `$`-named variable is read through `vars`. */
export function celPath(path: string): string {
  const [head, ...rest] = path.split('.');
  let out = head!.startsWith('$') ? `vars["${head}"]` : head!;
  for (const segment of rest) out += /^\d+$/.test(segment) ? `[${segment}]` : `.${segment}`;
  return out;
}

/** A template expression as CEL: every integer divisor written as a double, so CEL divides as the template did. */
export function celExpression(inner: string): string {
  return inner.replace(/\/\s*(\d+)(?![\d.])/g, '/ $1.0');
}
