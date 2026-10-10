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

/**
 * The CEL keywords an identifier-shaped path segment can collide with: the
 * lexer reads each as a literal (`true`, `false`, `null`) or an operator
 * (`in`), never as a name — so neither `in[0]` nor `record.in` reaches the
 * variable or the key. Part of {@link CEL_CLAIMED_IDENTIFIERS}.
 */
export const CEL_KEYWORDS: ReadonlySet<string> = new Set(['true', 'false', 'null', 'in']);

/**
 * **Every identifier CEL claims before a flow variable can** — a variable of
 * one of these names is unreachable as a bare identifier, so {@link celPath}
 * reads a path whose HEAD is one through the flow scope's `vars` map, the route
 * it already takes for a `$`-named head (`{list.0}` → `vars["list"][0]`).
 *
 * Read off the CEL implementation the formula engine builds,
 * `@marcbachmann/cel-js` 8.0.0 (what `@objectstack/formula` resolves), not off
 * the CEL language definition — a set from memory would be the wrong set: the
 * definition's `timestamp`, `duration` and `dyn` are functions here, not
 * bindings, and a variable of those names reads fine. Four groups:
 *
 *  - **the type identifiers** — `lib/registry.js`'s `TYPES`, which the
 *    registry binds as constants of type `type` when an environment is built
 *    (`for (const n in TYPES) this.registerConstant(n, 'type', TYPES[n])`): a
 *    variable named `list` evaluates to the CEL type `list`, and `list[0]`
 *    fails `Cannot index type 'type' with type 'int'`;
 *  - **the namespace constants** — `google` (`lib/functions.js`, the
 *    `google.protobuf.*` type names), `cel` (`lib/macros.js`, `cel.bind`) and
 *    `optional` (`lib/optional.js`, bound because the engine builds with
 *    `enableOptionalTypes: true`);
 *  - **the reserved words** — `lib/globals.js`'s `RESERVED`, which the parser
 *    refuses as an identifier (`Reserved identifier: for`);
 *  - **the keywords** — {@link CEL_KEYWORDS}.
 *
 * The first two groups are exactly what the built environment's
 * `getDefinitions().variables` lists. Pinned name by name, through the built
 * engine, by `value-slot-template-grammar.test.ts` in `service-automation`.
 */
export const CEL_CLAIMED_IDENTIFIERS: ReadonlySet<string> = new Set([
  'bool', 'bytes', 'double', 'int', 'list', 'map', 'null_type', 'string', 'type', 'uint',
  'cel', 'google', 'optional',
  'as', 'break', 'const', 'continue', 'else', 'for', 'function', 'if', 'import', 'let', 'loop', 'namespace',
  'package', 'return', 'var', 'void', 'while', '__proto__', 'prototype',
  ...CEL_KEYWORDS,
]);

/**
 * **Every identifier the flow CEL scope binds over a flow variable of the same
 * name** — the flow runtime's claims, beside CEL's own
 * ({@link CEL_CLAIMED_IDENTIFIERS}). `service-automation`'s
 * `AutomationEngine.celScope` spreads the flow's variables at the top level
 * and then binds these two after the spread, so each wins over a variable
 * that shares its name:
 *
 *  - `vars` — the variables namespace itself (`vars.x`, `vars["$error"]`), so
 *    for a variable named `vars`, `vars[0]` reads the namespace and fails
 *    `No such key: 0`;
 *  - `current_user` — the run's user (ADR-0068's canonical root), or `null`
 *    when the run has none, so for a variable named `current_user`,
 *    `current_user.name` reads the run user.
 *
 * {@link celPath} reads a path whose head is one of these through `vars`
 * (`vars["vars"][0]`, `vars["current_user"].name`), the route a CEL-claimed
 * head already takes. The spec cannot import the runtime, so this list is
 * measured from `celScope`; `value-slot-template-grammar.test.ts` in that
 * package evaluates both spellings for a variable of each name, so a name the
 * scope starts binding without a line here reddens there.
 */
export const FLOW_SCOPE_CLAIMED_IDENTIFIERS: ReadonlySet<string> = new Set(['vars', 'current_user']);

/**
 * Whether a path's head is read through `vars` — a `$`-named variable (CEL has
 * no identifier spelling for one), one of {@link CEL_CLAIMED_IDENTIFIERS}, or
 * one of {@link FLOW_SCOPE_CLAIMED_IDENTIFIERS}.
 */
export function celHeadReadsThroughVars(head: string): boolean {
  return head.startsWith('$') || CEL_CLAIMED_IDENTIFIERS.has(head) || FLOW_SCOPE_CLAIMED_IDENTIFIERS.has(head);
}

/**
 * A template path as CEL: `a.b.0` → `a.b[0]`. A head CEL cannot read as the
 * variable is read through `vars` ({@link celHeadReadsThroughVars}:
 * `vars["$error"].message`, `vars["list"][0]`, `vars["vars"][0]`), and a
 * later segment that is a keyword is indexed by name (`record["in"]`).
 */
export function celPath(path: string): string {
  const [head, ...rest] = path.split('.');
  let out = celHeadReadsThroughVars(head!) ? `vars["${head}"]` : head!;
  for (const segment of rest) {
    if (/^\d+$/.test(segment)) out += `[${segment}]`;
    else if (CEL_KEYWORDS.has(segment)) out += `["${segment}"]`;
    else out += `.${segment}`;
  }
  return out;
}

/**
 * The CEL spelling of the run user's id — what `{$User.Id}` read
 * (`resolveToken` answers it with the run's `userId`). The flow CEL scope
 * binds `current_user` to the run's `EvalUser`, and to `null` when the run has
 * no user (ADR-0068, ADR-0118 D1, D4), so in a user-less run this read fails.
 */
export const CEL_RUN_USER_ID = 'current_user.id';

/**
 * {@link CEL_RUN_USER_ID} guarded for a run with no user — a schedule, or a
 * record change made by a system write. It answers `null` there, where the
 * template answered nothing.
 */
export const CEL_RUN_USER_ID_GUARDED = 'current_user != null ? current_user.id : null';

/**
 * Whether a `user` token reads the run user's id — `$User.Id`, the one
 * `$User` path `resolveToken` answers from the run (its first segment is
 * `Id`, and the rest is ignored). Every other path reads a user object no
 * run carries.
 */
export function isRunUserIdToken(inner: string): boolean {
  return inner.trim().slice('$User.'.length).split('.')[0] === 'Id';
}

/**
 * Why a `$User.<path>` token other than the id ({@link isRunUserIdToken}) has
 * nothing to convert, and what to write for the value it meant: it never
 * resolved, and `current_user` carries only what the run holds, so an email
 * or a name is read from the user record by `current_user.id`. `write` is how
 * the remedy's last step spells the record's field — an envelope in a value
 * slot, a hole in a text slot.
 */
export function runUserPathNeverResolved(text: string, write: (path: string) => string): string {
  return (
    `\`${text}\` never resolved in any shipped run: it read a user object no run carries, so the template `
    + 'wrote nothing here. `current_user` carries only what the run holds — `id`, '
    + '`positions`, `organizationId`, `isPlatformAdmin`. For the user\'s email or name, read the user record by '
    + `\`current_user.id\`: compute the id into a variable with an \`assignment\` node (\`assignments: { uid: `
    + `{ dialect: 'cel', source: '${CEL_RUN_USER_ID}' } }\`), read the record with a \`get_record\` node `
    + '(`objectName: \'sys_user\'`, `filter: { id: \'{uid}\' }`, `outputVariable: \'me\'`), and write '
    + `${write('me.email')} or ${write('me.name')}.`
  );
}

/**
 * One lexeme of a template expression, in the order the alternatives are
 * tried: a quoted string (its content is never rewritten), a number, a
 * variable path in the interpolator's own spelling ({@link VARIABLE_PATH},
 * numeric segments included), or any single other character.
 */
const EXPRESSION_LEXEME =
  /(["'])(?:\\[\s\S]|(?!\1)[^\\])*\1|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z_$][\w$]*(?:\.(?:[A-Za-z_$][\w$]*|\d+))*|[\s\S]/g;

/**
 * A template expression as CEL — what the interpolator computed, spelled so
 * the CEL value envelope evaluates it:
 *
 *  - every variable path is written by {@link celPath}'s rule, the one a
 *    lone path token gets: `int * 2` → `vars["int"] * 2` (a head CEL claims),
 *    `items.0 * 2` → `items[0] * 2` (an index), `$error.code + 1` →
 *    `vars["$error"].code + 1`. A name in call position (`round(`) is a
 *    function, a member selected off something else (`(x).y`) is not a head,
 *    and the keywords (`true`, `false`, `null`, `in`) are CEL's own, so each
 *    of those is left as written;
 *  - every integer divisor is written as a double (`/ 100` → `/ 100.0`), so
 *    CEL divides as the template did.
 *
 * Text inside a quoted string is never rewritten.
 */
export function celExpression(inner: string): string {
  const lexemes = inner.match(EXPRESSION_LEXEME) ?? [];
  const significant = (from: number, step: 1 | -1): string | undefined => {
    for (let at = from + step; at >= 0 && at < lexemes.length; at += step) {
      if (!/^\s$/.test(lexemes[at]!)) return lexemes[at];
    }
    return undefined;
  };
  let out = '';
  for (let at = 0; at < lexemes.length; at++) {
    const lexeme = lexemes[at]!;
    if (lexeme === '/') {
      const next = lexemes.findIndex((candidate, index) => index > at && !/^\s$/.test(candidate));
      if (next !== -1 && /^\d+$/.test(lexemes[next]!) && lexemes[next + 1] !== '.') {
        out += `/ ${lexemes[next]}.0`;
        at = next;
        continue;
      }
      out += lexeme;
      continue;
    }
    if (/^[A-Za-z_$]/.test(lexeme)) {
      const isCall = significant(at, 1) === '(';
      const isMember = significant(at, -1) === '.';
      const isKeyword = CEL_KEYWORDS.has(lexeme);
      out += isCall || isMember || isKeyword ? lexeme : celPath(lexeme);
      continue;
    }
    out += lexeme;
  }
  return out;
}
